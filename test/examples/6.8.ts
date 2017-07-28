import { assert } from 'chai';
import { Machine } from '../../src/index';

describe('Example 6.8', () => {
  const machine = new Machine({
    initial: 'A',
    states: {
      A: {
        on: {
          6: 'F'
        },
        initial: 'B',
        states: {
          B: {
            on: { 1: 'C' }
          },
          C: {
            on: { 2: 'E' }
          },
          D: {
            on: { 3: 'B' }
          },
          E: {
            on: { 4: 'B', 5: 'D' }
          }
        }
      },
      F: {
        on: {
          5: 'A.$history'
        }
      }
    }
  });

  const expected = {
    A: {
      1: 'A.C',
      6: 'F'
    },
    'A.B': {
      1: 'A.C',
      6: 'F',
      FAKE: 'A.B'
    },
    'A.C': {
      2: 'A.E',
      6: 'F',
      FAKE: 'A.C'
    },
    'A.D': {
      3: 'A.B',
      6: 'F',
      FAKE: 'A.D'
    },
    'A.E': {
      4: 'A.B',
      5: 'A.D',
      6: 'F',
      FAKE: 'A.E'
    },
    F: {
      5: 'A.B'
    }
  };

  Object.keys(expected).forEach(fromState => {
    Object.keys(expected[fromState]).forEach(actionType => {
      const toState = expected[fromState][actionType];

      it(`should go from ${fromState} to ${toState}`, () => {
        assert.equal(machine.transition(fromState, actionType).value, toState);
      });
    });
  });

  it('should respect the history mechanism', () => {
    const stateC = machine.transition('A.B', 1);
    const stateF = machine.transition(stateC, 6);
    const stateActual = machine.transition(stateF, 5);

    assert.equal(stateActual.value, 'A.C');
  });
});
