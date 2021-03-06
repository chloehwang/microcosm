import Microcosm, { STATUS } from 'microcosm'

const action = n => n

describe('getRegistration', function() {
  it('can use nested objects to return specific statuses', function() {
    let handler = jest.fn()

    class Repo extends Microcosm {
      setup() {
        this.addDomain('test', {
          register: {
            action: {
              reject: handler
            }
          }
        })
      }
    }

    let repo = new Repo()

    repo.append('action').reject()

    expect(handler).toHaveBeenCalled()
  })

  it('can chain domain handlers', function() {
    let format = text => text

    let repo = new Microcosm()

    repo.addDomain('word', {
      register() {
        return {
          [format]: [
            (state, string) => string,
            string => string.slice(0, 4),
            string => string.toUpperCase()
          ]
        }
      }
    })

    repo.push(format, 'test-string')

    expect(repo).toHaveState('word', 'TEST')
  })

  it('can chain effect handlers', function() {
    let a = jest.fn()
    let b = jest.fn()

    let repo = new Microcosm()

    repo.addEffect({
      register() {
        return {
          test: [a, b]
        }
      }
    })

    repo.push('test', 'foobar')

    expect(a).toHaveBeenCalledWith(repo, 'foobar')
    expect(b).toHaveBeenCalledWith(repo, 'foobar')
  })

  it.dev('throws if given an invalid status', function() {
    let repo = new Microcosm()

    // Registration does not happen if there are no registerable
    // domains
    repo.addDomain('test', {
      register: {}
    })

    expect(() => {
      repo.append(action, 'totally-missing')
    }).toThrow('Invalid action status totally-missing')
  })

  describe('Action aliasing', function() {
    for (let status in STATUS) {
      if (status === 'inactive') {
        continue
      }

      let alias = STATUS[status]

      it(`can inspect the ${status} status`, function() {
        let handler = jest.fn()

        class Repo extends Microcosm {
          setup() {
            this.addDomain('test', {
              register: {
                action: {
                  [status]: handler
                }
              }
            })
          }
        }

        let repo = new Repo()

        repo.append('action', status)

        expect(handler).toHaveBeenCalled()
      })

      it(`can register the ${alias} alias`, function() {
        let handler = jest.fn()

        class Repo extends Microcosm {
          setup() {
            this.addDomain('test', {
              register: {
                action: {
                  [status]: handler
                }
              }
            })
          }
        }

        let repo = new Repo()

        repo.append('action', status)

        expect(handler).toHaveBeenCalled()
      })
    }
  })

  it.dev(
    'prints the action name in the warning when a handler is undefined',
    function() {
      class Repo extends Microcosm {
        setup() {
          this.addDomain('test', {
            register: {
              getUser: undefined
            }
          })
        }
      }

      let repo = new Repo()

      expect(repo.prepare('getUser')).toThrow(
        'getUser key within a registration is undefined. Is it being referenced correctly?'
      )
    }
  )
})
