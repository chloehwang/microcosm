import Transaction from '../src/Transaction'
import dispatch from '../src/dispatch'
import assert from 'assert'

describe('dispatch', function() {

  it ('returns state if not active', function() {
    let transaction = Transaction('foo')
    let store = {
      register() {
        return { foo: true }
      }
    }

    let state = {}
    let next  = dispatch([ [ 'test', store ] ], state, Transaction('test'))

    assert.equal(next, state)
  })

})