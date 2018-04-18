# Conditional Transitions (Guards)

Many times, you'll want a transition between states to only take place if certain conditions on the state (finite or extended) or the event are met. For instance, let's say you're creating a statechart for a search form:

```js
const searchMachine = Machine({
  initial: 'idle',
  states: {
    idle: {
      on: {
        SEARCH: 'searching'
      }
    },
    searching: {
      onEntry: ['executeSearch']
      // ...
    }
  }
});
```

The `'SEARCH'` event will be emitted in the form of an object with a search query, e.g.:

```js
const searchEvent = {
  type: 'SEARCH',
  query: 'goats'
}
```

Now suppose you only want search to be allowed if:
- the user is allowed to search (`.canSearch` in this example)
- the search event `query` is not empty.

This is a good use case for a "transition guard", which determines if a transition can occur given the state and the event. A **guard condition** is a function that takes two arguments:

- `extendedState`, which is specified as the 3rd argument to `machine.transition(...)`
- `eventObject`, which is the event represented as an object

and returns either `true` or `false`, which signifies whether the transition should be allowed to take place:

```js
const searchMachine = Machine({
  initial: 'idle',
  states: {
    idle: {
      on: {
        SEARCH: {
          searching: {
            // only transition to 'searching' if cond is true
            cond: (extState, eventObj) => {
              return extState.canSearch
                && eventObj.query
                && eventObj.query.length > 0;
            }
          }
        }
      }
    },
    searching: {
      onEntry: ['executeSearch']
      // ...
    },
    searchError: {
      // ...
    }
  }
});
```

Example of usage with extended state:

```js
// Atomic full app state
let fullState = {
  // finite state
  search: searchMachine.initialState,

  // extended state
  canSearch: false
};

const searchAttempt1 = searchMachine.transition(fullState.search, {
  type: 'SEARCH',
  query: 'goats'
}, fullState); // <= specify the full state as the 3rd argument
console.log(searchAttempt1.value);
// => 'idle' (no transition because canSearch == false)

fullState.canSearch = true;

const searchAttempt2 = searchMachine.transition(fullState.search, {
  type: 'SEARCH',
  query: ''
}, fullState); // <= specify the full state as the 3rd argument
console.log(searchAttempt1.value);
// => 'idle' (no transition because event query is empty)

const searchAttempt3 = searchMachine.transition(fullState.search, {
  type: 'SEARCH',
  query: 'goats'
}, fullState); // <= specify the full state as the 3rd argument
console.log(searchAttempt3.value);
// => 'searching'
console.log(searchAttempt3.actions);
// => ['executeSearch']
```

If you want to have a single event transition to different states in certain sitations you can supply an array of targets with conditions.

For example you can model a door that listens for an `OPEN` event, and opens if you are an admin and error if you are not:

```js
var machine = new Machine({
  id: 'door',
  initial: 'closed',
  states: {
    closed: {
      initial: 'idle',
      states: {
        'idle': {},
        'error': {}
      },
      on: {
        OPEN: [
          { target: 'opened', cond: (extState) => extState.isAdmin },
          { target: 'closed.error' }
        ]
      }
    },
    opened: {
      on: {
        CLOSE: 'closed',
      }
    },
  }
});

var fullState = { isAdmin: true };

var state = machine.initialState;
var state = machine.transition(state, 'OPEN', fullState);
console.log(state.value); // 'opened'

var state = machine.transition(state, 'CLOSE', fullState);
console.log(state.value); // { closed: 'idle' }

fullState.isAdmin = false;
var state = machine.transition(state, 'OPEN', fullState);
console.log(state.value); // { closed: 'error' }
```

**Notes:**
- The `cond` function should always be a pure function that only references the `extendedState` and `eventObject` arguments.
- Functions are not (easily) serializable in JSON. In future versions of `xstate`, alternative syntax for `cond` statements as plain strings or structured objects will be introduced to make it serializable.
  - Most statechart representations represent these conditions as plain strings.
- ⚠️ **Warning**: do _not_ overuse guard conditions. If something can be represented discretely as two or more separate events instead of multiple `conds` on a single event, it is preferable to avoid `cond` and use multiple events instead.
