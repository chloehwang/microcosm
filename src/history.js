/*
 * @fileoverview All Microcosms have a history. This history keeps
 * track of outstanding actions, working with a Microcosm to determine
 * the next application state as actions move through different
 * states.
 * @flow
 */

import Action from './action'
import Emitter from './emitter'
import defaultUpdateStrategy from './default-update-strategy'
import { merge } from './utils'
import { BIRTH, START } from './lifecycle'
import { type Updater } from './default-update-strategy'

type HistoryOptions = {
  maxHistory?: number,
  batch?: boolean,
  updater?: (options: Object) => Updater
}

const DEFAULTS: HistoryOptions = {
  maxHistory: 1,
  batch: false,
  updater: defaultUpdateStrategy
}

class History extends Emitter {
  size: number
  limit: number
  updater: (options: Object) => Updater
  releasing: boolean
  release: () => void
  head: ?Action
  root: ?Action

  constructor(config: HistoryOptions) {
    super()

    let options = merge(DEFAULTS, config)

    this.size = 0
    this.limit = Math.max(1, options.maxHistory)

    this.updater = options.updater(options)

    // Track whether a release is pending. This prevents .wait() from getting
    // stuck in limbo
    this.releasing = false

    this.release = () => this.closeRelease()

    this.begin()
  }

  /**
   * Set the head of the tree to a target action. This has the effect
   * of controlling time in a Microcosm's history.
   */
  checkout(action: ?Action) {
    let sharedRoot = this.sharedRoot(action) || this.head

    this.head = action || this.head

    // Each action has a "next" property that tells the history how to
    //  move forward. Update that path back to the sharedRoot:
    let cursor = this.head
    while (cursor && cursor != sharedRoot) {
      let parent = cursor.parent

      if (parent) {
        parent.next = cursor
      }

      cursor = parent
    }

    this.setSize()

    if (sharedRoot) {
      this.reconcile(sharedRoot)
    }

    return this
  }

  /**
   * Toggle actions in bulk, then reconcile from the first action
   */
  toggle(actions: Action | Action[]) {
    let list = [].concat(actions)

    list.forEach(action => action.toggle(true))

    // determine oldest active action to reconcile on
    let toReconcile
    let toReconcileIndex = Infinity
    let actionCache = this.toArray()
    list.forEach(action => {
      let activeIndex = actionCache.indexOf(action)
      if (activeIndex >= 0 && activeIndex < toReconcileIndex) {
        toReconcileIndex = activeIndex
        toReconcile = action
      }
    })

    if (toReconcile) this.reconcile(toReconcile)
  }

  /**
   * Convert the active branch of history into an array.
   */
  toArray() {
    return this.map(n => n)
  }

  /**
   * Map over the active branch.
   */
  map(fn: (action: Action) => *, scope?: Object) {
    let items = []
    let cursor = this.root

    while (cursor) {
      items.push(fn.call(scope, cursor))

      if (cursor == this.head) break
      cursor = cursor.next
    }
    return items
  }

  /**
   * Return a promise that represents the resolution of all actions in
   * the current branch.
   */
  wait(): Promise<*> {
    let actions = this.toArray()

    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        let done = actions.every(action => action.complete)
        let errors = actions.filter(action => action.is('reject'))

        if (done) {
          this.off('release', checkStatus)

          if (errors.length) {
            reject(errors[0].payload)
          } else {
            resolve()
          }
        }
      }

      if (this.releasing === false) {
        checkStatus()
      }

      this.on('release', checkStatus)
    })
  }

  /**
   * Chain off of wait(). Provides a promise interface
   */
  then(pass?: Function, fail?: Function) {
    return this.wait().then(pass, fail)
  }

  /**
   * Setup the head and root action for a history. This effectively
   * starts or restarts history.
   */
  begin() {
    this.head = this.root = null
    this.append(START, 'resolve')
  }

  /**
   * Append a new action to the end of history
   */
  append(command: Command | Tagged, status?: ?Status): Action {
    let action = new Action(command, status)

    if (this.head) {
      this.head.lead(action)
    } else {
      // Always have a parent node, no matter what
      let birth = new Action(BIRTH, 'resolve')
      birth.adopt(action)

      this.root = action
    }

    this.head = action
    this.size += 1

    this._emit('append', action)

    action.on('change', this.reconcile, this)

    return action
  }

  /**
   * Remove an action from history, connecting adjacent actions
   * together to bridge the gap.
   */
  remove(action: Action) {
    if (action.isDisconnected()) {
      return
    }

    // cache linking references and activeness
    let parent = action.parent
    let next = action.next
    let wasActive = this.isActive(action)

    this.clean(action)

    // if there are no more actions left, we're done
    if (this.size <= 0) {
      this.begin()
      return
    }

    // reset head/root references if necessary
    if (action === this.head) {
      next = this.head = parent
    } else if (action === this.root) {
      this.root = next
    }

    // reconcile history if action was in active history branch
    if (next && wasActive && !action.disabled) {
      this.reconcile(next)
    }
  }

  /**
   * The actual clean up operation that purges an action from both
   * history, and removes all snapshots within tracking repos.
   */
  clean(action: Action) {
    this.size -= 1

    this._emit('remove', action)

    action.remove()
  }

  /**
   * Starting with a given action, emit events such that repos can
   * dispatch actions to domains in a consistent order to build a new
   * state. This is how Microcosm updates state.
   */
  reconcile(action: Action) {
    console.assert(this.head, 'History should always have a head node')
    console.assert(action, 'History should never reconcile ' + typeof action)

    let focus = action

    while (focus) {
      this._emit('update', focus)

      if (focus === this.head) {
        break
      } else {
        focus = focus.next
      }
    }

    this.archive()

    this._emit('reconcile', action)

    this.queueRelease()
  }

  /**
   * Batch releases by "queuing" an update. See `closeRelease`.
   */
  queueRelease() {
    if (this.releasing === false) {
      this.releasing = true
      this.updater(this.release)
    }
  }

  /**
   * Complete a release by emitting the "release" event. This function
   * is called by the updater for the given history. If batching is
   * enabled, it will be asynchronous.
   */
  closeRelease() {
    this.releasing = false
    this._emit('release')
  }

  /**
   * Instead of holding on to actions forever, Microcosm initiates an
   * archival process at the end of every reconciliation. If the
   * active branch of history is greater than the `limit` property,
   * signal that the action should be removed.
   */
  archive() {
    let size = this.size
    let root = this.root

    while (size > this.limit && root && root.complete) {
      size -= 1
      this._emit('remove', root.parent)
      root = root.next
    }

    if (root) {
      root.prune()
    }

    this.root = root
    this.size = size
  }

  /**
   * Update the size of the tree by bubbling up from the head to the
   * root.
   */
  setSize() {
    let action = this.head
    let size = 1

    while (action && action !== this.root) {
      action = action.parent
      size += 1
    }

    this.size = size
  }

  /**
   * Determine if provided action is within active history branch
   */
  isActive(action: Action) {
    let cursor = action

    while (cursor) {
      if (cursor === this.head) {
        return true
      }
      cursor = cursor.next
    }

    return false
  }

  /**
   * Starting with the provided action, navigate up the parent chain
   * until you find an action which is active. That action is the shared
   * root between the provided action and the current head.
   */
  sharedRoot(action: ?Action) {
    let cursor = action

    while (cursor) {
      if (this.isActive(cursor)) {
        return cursor
      }
      cursor = cursor.parent
    }
  }

  /**
   * Serialize history into JSON data
   */
  toJSON() {
    return {
      head: this.head ? this.head.id : null,
      root: this.root ? this.root.id : null,
      size: this.size,
      tree: this.root
    }
  }
}

export default History
