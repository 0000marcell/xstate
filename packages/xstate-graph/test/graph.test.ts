import { Machine, StateNode, State } from 'xstate';
import {
  getNodes,
  adjacencyMap,
  getSimplePaths,
  getShortestPaths
} from '../src/index';
import { getSimplePathsAsArray, getValueAdjacencyMap } from '../src/graph';
import { assign } from 'xstate';
// tslint:disable-next-line:no-var-requires

describe('@xstate/graph', () => {
  const pedestrianStates = {
    initial: 'walk',
    states: {
      walk: {
        on: {
          PED_COUNTDOWN: {
            target: 'wait',
            actions: ['startCountdown']
          }
        }
      },
      wait: {
        on: {
          PED_COUNTDOWN: 'stop'
        }
      },
      stop: {},
      flashing: {}
    }
  };

  const lightMachine = Machine({
    key: 'light',
    initial: 'green',
    states: {
      green: {
        on: {
          TIMER: 'yellow',
          POWER_OUTAGE: 'red.flashing',
          PUSH_BUTTON: [
            {
              actions: ['doNothing'] // pushing the walk button never does anything
            }
          ]
        }
      },
      yellow: {
        on: {
          TIMER: 'red',
          POWER_OUTAGE: '#light.red.flashing'
        }
      },
      red: {
        on: {
          TIMER: 'green',
          POWER_OUTAGE: 'red.flashing'
        },
        ...pedestrianStates
      }
    }
  });

  const condMachine = Machine<
    { id: string },
    any,
    { type: 'EVENT'; id: string } | { type: 'STATE' }
  >({
    key: 'cond',
    initial: 'pending',
    states: {
      pending: {
        on: {
          EVENT: [
            { target: 'foo', cond: (_, e) => e.id === 'foo' },
            { target: 'bar' }
          ],
          STATE: [
            { target: 'foo', cond: s => s.id === 'foo' },
            { target: 'bar' }
          ]
        }
      },
      foo: {},
      bar: {}
    }
  });

  const parallelMachine = Machine({
    type: 'parallel',
    key: 'p',
    states: {
      a: {
        initial: 'a1',
        states: {
          a1: {
            on: { 2: 'a2', 3: 'a3' }
          },
          a2: {
            on: { 3: 'a3', 1: 'a1' }
          },
          a3: {}
        }
      },
      b: {
        initial: 'b1',
        states: {
          b1: {
            on: { 2: 'b2', 3: 'b3' }
          },
          b2: {
            on: { 3: 'b3', 1: 'b1' }
          },
          b3: {}
        }
      }
    }
  });

  describe('getNodes()', () => {
    it('should return an array of all nodes', () => {
      const nodes = getNodes(lightMachine);
      expect(nodes.every(node => node instanceof StateNode)).toBe(true);
      expect(nodes.map(node => node.id).sort()).toEqual([
        'light.green',
        'light.red',
        'light.red.flashing',
        'light.red.stop',
        'light.red.wait',
        'light.red.walk',
        'light.yellow'
      ]);
    });

    it('should return an array of all nodes (parallel)', () => {
      const nodes = getNodes(parallelMachine);
      expect(nodes.every(node => node instanceof StateNode)).toBe(true);
      expect(nodes.map(node => node.id).sort()).toEqual([
        'p.a',
        'p.a.a1',
        'p.a.a2',
        'p.a.a3',
        'p.b',
        'p.b.b1',
        'p.b.b2',
        'p.b.b3'
      ]);
    });
  });

  describe('adjacencyMap()', () => {
    it('should return a flattened adjacency map', () => {
      expect(adjacencyMap(lightMachine)).toEqual({
        '"green"': {
          TIMER: { state: 'yellow' },
          POWER_OUTAGE: { state: { red: 'flashing' } },
          PED_COUNTDOWN: { state: 'green' },
          PUSH_BUTTON: { state: 'green' }
        },
        '"yellow"': {
          TIMER: { state: { red: 'walk' } },
          POWER_OUTAGE: { state: { red: 'flashing' } },
          PED_COUNTDOWN: { state: 'yellow' },
          PUSH_BUTTON: { state: 'yellow' }
        },
        '{"red":"walk"}': {
          TIMER: { state: 'green' },
          POWER_OUTAGE: { state: { red: 'flashing' } },
          PED_COUNTDOWN: { state: { red: 'wait' } },
          PUSH_BUTTON: { state: { red: 'walk' } }
        },
        '{"red":"flashing"}': {
          TIMER: { state: 'green' },
          POWER_OUTAGE: { state: { red: 'flashing' } },
          PED_COUNTDOWN: { state: { red: 'flashing' } },
          PUSH_BUTTON: { state: { red: 'flashing' } }
        },
        '{"red":"wait"}': {
          TIMER: { state: 'green' },
          POWER_OUTAGE: { state: { red: 'flashing' } },
          PED_COUNTDOWN: { state: { red: 'stop' } },
          PUSH_BUTTON: { state: { red: 'wait' } }
        },
        '{"red":"stop"}': {
          TIMER: { state: 'green' },
          POWER_OUTAGE: { state: { red: 'flashing' } },
          PED_COUNTDOWN: { state: { red: 'stop' } },
          PUSH_BUTTON: { state: { red: 'stop' } }
        }
      });
    });

    it('should return a flattened adjacency map (parallel)', () => {
      expect(adjacencyMap(parallelMachine)).toEqual({
        '{"a":"a1","b":"b1"}': {
          '1': { state: { a: 'a1', b: 'b1' } },
          '2': { state: { a: 'a2', b: 'b2' } },
          '3': { state: { a: 'a3', b: 'b3' } }
        },
        '{"a":"a2","b":"b2"}': {
          '1': { state: { a: 'a1', b: 'b1' } },
          '2': { state: { a: 'a2', b: 'b2' } },
          '3': { state: { a: 'a3', b: 'b3' } }
        },
        '{"a":"a3","b":"b3"}': {
          '1': { state: { a: 'a3', b: 'b3' } },
          '2': { state: { a: 'a3', b: 'b3' } },
          '3': { state: { a: 'a3', b: 'b3' } }
        }
      });
    });
  });

  describe('getShortestPaths()', () => {
    function formatPaths(pathMap): any {
      Object.keys(pathMap).forEach(key => {
        const data = pathMap[key] as any;
        data.state = {
          value: data.state.value,
          context: data.state.context
        };
        data.path.forEach(segment => {
          segment.state = {
            value: segment.state.value,
            context: segment.state.context
          };
        });
      });
      return pathMap;
    }

    it('should return a mapping of shortest paths to all states', () => {
      const paths = getShortestPaths(lightMachine) as any;

      expect(formatPaths(paths)).toEqual({
        '"green"': {
          state: { value: 'green', context: undefined },
          weight: 0,
          path: []
        },
        '"yellow"': {
          state: { value: 'yellow', context: undefined },
          weight: 1,
          path: [
            {
              state: { value: 'green', context: undefined },
              event: { type: 'TIMER' }
            }
          ]
        },
        '{"red":"flashing"}': {
          state: { value: { red: 'flashing' }, context: undefined },
          weight: 1,
          path: [
            {
              state: { value: 'green', context: undefined },
              event: { type: 'POWER_OUTAGE' }
            }
          ]
        },
        '{"red":"walk"}': {
          state: { value: { red: 'walk' }, context: undefined },
          weight: 2,
          path: [
            {
              state: { value: 'green', context: undefined },
              event: { type: 'TIMER' }
            },
            {
              state: { value: 'yellow', context: undefined },
              event: { type: 'TIMER' }
            }
          ]
        },
        '{"red":"wait"}': {
          state: { value: { red: 'wait' }, context: undefined },
          weight: 3,
          path: [
            {
              state: { value: 'green', context: undefined },
              event: { type: 'TIMER' }
            },
            {
              state: { value: 'yellow', context: undefined },
              event: { type: 'TIMER' }
            },
            {
              state: { value: { red: 'walk' }, context: undefined },
              event: { type: 'PED_COUNTDOWN' }
            }
          ]
        },
        '{"red":"stop"}': {
          state: { value: { red: 'stop' }, context: undefined },
          weight: 4,
          path: [
            {
              state: { value: 'green', context: undefined },
              event: { type: 'TIMER' }
            },
            {
              state: { value: 'yellow', context: undefined },
              event: { type: 'TIMER' }
            },
            {
              state: { value: { red: 'walk' }, context: undefined },
              event: { type: 'PED_COUNTDOWN' }
            },
            {
              state: { value: { red: 'wait' }, context: undefined },
              event: { type: 'PED_COUNTDOWN' }
            }
          ]
        }
      });
    });

    it('should return a mapping of shortest paths to all states (parallel)', () => {
      const paths = getShortestPaths(parallelMachine) as any;
      expect(formatPaths(paths)).toEqual({
        '{"a":"a1","b":"b1"}': {
          state: { value: { a: 'a1', b: 'b1' }, context: undefined },
          weight: 0,
          path: []
        },
        '{"a":"a2","b":"b2"}': {
          state: { value: { a: 'a2', b: 'b2' }, context: undefined },
          weight: 1,
          path: [
            {
              state: { value: { a: 'a1', b: 'b1' }, context: undefined },
              event: { type: '2' }
            }
          ]
        },
        '{"a":"a3","b":"b3"}': {
          state: { value: { a: 'a3', b: 'b3' }, context: undefined },
          weight: 1,
          path: [
            {
              state: { value: { a: 'a1', b: 'b1' }, context: undefined },
              event: { type: '3' }
            }
          ]
        }
      });
    });

    it('the initial state should have a zero-length path', () => {
      expect(
        getShortestPaths(lightMachine)[
          JSON.stringify(lightMachine.initialState.value)
        ].path
      ).toHaveLength(0);
    });

    xit('should not throw when a condition is present', () => {
      expect(() => getShortestPaths(condMachine)).not.toThrow();
    });

    it('should represent conditional paths based on context', () => {
      const paths = getShortestPaths(condMachine.withContext({ id: 'foo' }), {
        events: {
          EVENT: [{ type: 'EVENT', id: 'whatever' }],
          STATE: [{ type: 'STATE' }]
        }
      }) as any;
      Object.keys(paths).forEach(key => {
        expect(paths[key].state).toBeInstanceOf(State);
        const data = paths[key];

        data.state = {
          value: data.state.value,
          context: data.state.context
        };
        data.path.forEach(segment => {
          segment.state = {
            value: segment.state.value,
            context: segment.state.context
          };
        });
      });

      expect(paths).toEqual({
        '"pending" | {"id":"foo"}': {
          state: { value: 'pending', context: { id: 'foo' } },
          weight: 0,
          path: []
        },
        '"bar" | {"id":"foo"}': {
          state: { value: 'bar', context: { id: 'foo' } },
          weight: 1,
          path: [
            {
              state: { value: 'pending', context: { id: 'foo' } },
              event: { type: 'EVENT', id: 'whatever' }
            }
          ]
        },
        '"foo" | {"id":"foo"}': {
          state: { value: 'foo', context: { id: 'foo' } },
          weight: 1,
          path: [
            {
              state: { value: 'pending', context: { id: 'foo' } },
              event: { type: 'STATE' }
            }
          ]
        }
      });
    });
  });

  describe('getSimplePaths()', () => {
    function formatPaths(pathsMap): any {
      Object.keys(pathsMap).forEach(key => {
        const data = pathsMap[key] as any;
        data.state = { value: data.state.value, context: data.state.context };
        data.paths.forEach(path => {
          path.forEach(segment => {
            segment.state = {
              value: segment.state.value,
              context: segment.state.context
            };
          });
        });
      });

      return pathsMap;
    }

    it('should return a mapping of arrays of simple paths to all states', () => {
      const paths = getSimplePaths(lightMachine) as any;

      expect(formatPaths(paths)).toEqual({
        '"green"': {
          state: { value: 'green', context: undefined },
          paths: [[]]
        },
        '"yellow"': {
          state: { value: 'yellow', context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              }
            ]
          ]
        },
        '{"red":"walk"}': {
          state: { value: { red: 'walk' }, context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              }
            ]
          ]
        },
        '{"red":"wait"}': {
          state: { value: { red: 'wait' }, context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              }
            ]
          ]
        },
        '{"red":"stop"}': {
          state: { value: { red: 'stop' }, context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              },
              {
                state: { value: { red: 'wait' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              }
            ]
          ]
        },
        '{"red":"flashing"}': {
          state: { value: { red: 'flashing' }, context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              },
              {
                state: { value: { red: 'wait' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              },
              {
                state: { value: { red: 'stop' }, context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ],
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              },
              {
                state: { value: { red: 'wait' }, context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ],
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ],
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ],
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ]
          ]
        }
      });
    });

    const equivMachine = Machine({
      initial: 'a',
      states: {
        a: { on: { FOO: 'b', BAR: 'b' } },
        b: { on: { FOO: 'a', BAR: 'a' } }
      }
    });

    it('should return a mapping of simple paths to all states (parallel)', () => {
      const paths = getSimplePaths(parallelMachine);
      expect(formatPaths(paths)).toEqual({
        '{"a":"a1","b":"b1"}': {
          state: { value: { a: 'a1', b: 'b1' }, context: undefined },
          paths: [[]]
        },
        '{"a":"a2","b":"b2"}': {
          state: { value: { a: 'a2', b: 'b2' }, context: undefined },
          paths: [
            [
              {
                state: { value: { a: 'a1', b: 'b1' }, context: undefined },
                event: { type: '2' }
              }
            ]
          ]
        },
        '{"a":"a3","b":"b3"}': {
          state: { value: { a: 'a3', b: 'b3' }, context: undefined },
          paths: [
            [
              {
                state: { value: { a: 'a1', b: 'b1' }, context: undefined },
                event: { type: '2' }
              },
              {
                state: { value: { a: 'a2', b: 'b2' }, context: undefined },
                event: { type: '3' }
              }
            ],
            [
              {
                state: { value: { a: 'a1', b: 'b1' }, context: undefined },
                event: { type: '3' }
              }
            ]
          ]
        }
      });
    });

    it('should return multiple paths for equivalent transitions', () => {
      const paths = getSimplePaths(equivMachine);
      expect(formatPaths(paths)).toEqual({
        '"a"': { state: { value: 'a', context: undefined }, paths: [[]] },
        '"b"': {
          state: { value: 'b', context: undefined },
          paths: [
            [
              {
                state: { value: 'a', context: undefined },
                event: { type: 'FOO' }
              }
            ],
            [
              {
                state: { value: 'a', context: undefined },
                event: { type: 'BAR' }
              }
            ]
          ]
        }
      });
    });

    it('should return a single empty path for the initial state', () => {
      expect(getSimplePaths(lightMachine)['"green"'].paths).toEqual([[]]);
      expect(getSimplePaths(equivMachine)['"a"'].paths).toEqual([[]]);
    });

    it('should return value-based paths', () => {
      const countMachine = Machine<{ count: number }>({
        id: 'count',
        initial: 'start',
        context: {
          count: 0
        },
        states: {
          start: {
            on: {
              '': {
                target: 'finish',
                cond: ctx => ctx.count === 3
              },
              INC: {
                actions: assign({ count: ctx => ctx.count + 1 })
              }
            }
          },
          finish: {}
        }
      });

      const paths = getSimplePaths(countMachine, {
        events: {
          INC: [{ type: 'INC', value: 1 }]
        }
      });

      expect(formatPaths(paths)).toEqual({
        '"start" | {"count":0}': {
          state: { value: 'start', context: { count: 0 } },
          paths: [[]]
        },
        '"start" | {"count":1}': {
          state: { value: 'start', context: { count: 1 } },
          paths: [
            [
              {
                state: { value: 'start', context: { count: 0 } },
                event: { type: 'INC', value: 1 }
              }
            ]
          ]
        },
        '"start" | {"count":2}': {
          state: { value: 'start', context: { count: 2 } },
          paths: [
            [
              {
                state: { value: 'start', context: { count: 0 } },
                event: { type: 'INC', value: 1 }
              },
              {
                state: { value: 'start', context: { count: 1 } },
                event: { type: 'INC', value: 1 }
              }
            ]
          ]
        },
        '"finish" | {"count":3}': {
          state: { value: 'finish', context: { count: 3 } },
          paths: [
            [
              {
                state: { value: 'start', context: { count: 0 } },
                event: { type: 'INC', value: 1 }
              },
              {
                state: { value: 'start', context: { count: 1 } },
                event: { type: 'INC', value: 1 }
              },
              {
                state: { value: 'start', context: { count: 2 } },
                event: { type: 'INC', value: 1 }
              }
            ]
          ]
        }
      });
    });
  });

  describe('getSimplePathsAsArray()', () => {
    it('should return an array of shortest paths to all states', () => {
      const pathsArray = getSimplePathsAsArray(lightMachine) as any;
      pathsArray.forEach(pathData => {
        pathData.state = {
          value: pathData.state.value,
          context: pathData.state.context
        };
        pathData.paths.forEach(path => {
          path.forEach(segment => {
            segment.state = {
              value: segment.state.value,
              context: segment.state.context
            };
          });
        });
      });

      expect(pathsArray).toEqual([
        { state: { value: 'green', context: undefined }, paths: [[]] },
        {
          state: { value: 'yellow', context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              }
            ]
          ]
        },
        {
          state: { value: { red: 'walk' }, context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              }
            ]
          ]
        },
        {
          state: { value: { red: 'wait' }, context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              }
            ]
          ]
        },
        {
          state: { value: { red: 'stop' }, context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              },
              {
                state: { value: { red: 'wait' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              }
            ]
          ]
        },
        {
          state: { value: { red: 'flashing' }, context: undefined },
          paths: [
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              },
              {
                state: { value: { red: 'wait' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              },
              {
                state: { value: { red: 'stop' }, context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ],
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'PED_COUNTDOWN' }
              },
              {
                state: { value: { red: 'wait' }, context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ],
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: { red: 'walk' }, context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ],
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'TIMER' }
              },
              {
                state: { value: 'yellow', context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ],
            [
              {
                state: { value: 'green', context: undefined },
                event: { type: 'POWER_OUTAGE' }
              }
            ]
          ]
        }
      ]);
    });
  });

  describe('valueAdjacencyMap', () => {
    it('should map adjacencies', () => {
      const counterMachine = Machine<{ count: number; other: string }>({
        id: 'counter',
        initial: 'empty',
        context: { count: 0, other: 'something' },
        states: {
          empty: {
            on: {
              '': {
                target: 'full',
                cond: ctx => ctx.count === 5
              },
              INC: {
                actions: assign({ count: (ctx, e) => ctx.count + e.value })
              },
              DEC: { actions: assign({ count: ctx => ctx.count - 1 }) }
            }
          },
          full: {}
        }
      });

      const adj = getValueAdjacencyMap(counterMachine, {
        filter: state => state.context.count >= 0 && state.context.count <= 5,
        stateSerializer: state => {
          const ctx = { count: state.context.count };
          return JSON.stringify(state.value) + ' | ' + JSON.stringify(ctx);
        },
        events: {
          INC: [{ type: 'INC', value: 1 }]
        }
      });

      expect(adj).toHaveProperty('"full" | {"count":5}');
    });
  });
});
