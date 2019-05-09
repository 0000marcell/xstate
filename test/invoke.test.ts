import {
  Machine,
  interpret,
  assign,
  sendParent,
  send,
  EventObject,
  StateValue
} from '../src/index';
import { assert } from 'chai';
import { actionTypes, done as _done, doneInvoke } from '../src/actions';
import { interval } from 'rxjs';
import { map, take } from 'rxjs/operators';

const user = { name: 'David' };

const fetchMachine = Machine<{ userId: string | undefined }>({
  id: 'fetch',
  context: {
    userId: undefined
  },
  initial: 'pending',
  states: {
    pending: {
      onEntry: send({ type: 'RESOLVE', user }),
      on: {
        RESOLVE: {
          target: 'success',
          cond: ctx => ctx.userId !== undefined
        }
      }
    },
    success: {
      type: 'final',
      data: { user: (_, e) => e.user }
    },
    failure: {
      onEntry: sendParent('REJECT')
    }
  }
});

const fetcherMachine = Machine({
  id: 'fetcher',
  initial: 'idle',
  context: {
    selectedUserId: '42',
    user: undefined
  },
  states: {
    idle: {
      on: {
        GO_TO_WAITING: 'waiting',
        GO_TO_WAITING_MACHINE: 'waitingInvokeMachine'
      }
    },
    waiting: {
      invoke: {
        src: fetchMachine,
        data: {
          userId: ctx => ctx.selectedUserId
        },
        onDone: {
          target: 'received',
          cond: (_, e) => {
            // Should receive { user: { name: 'David' } } as event data
            return e.data.user.name === 'David';
          }
        }
      }
    },
    waitingInvokeMachine: {
      invoke: {
        src: fetchMachine.withContext({ userId: '55' }),
        onDone: 'received'
      }
    },
    received: {
      type: 'final'
    }
  }
});

// @ts-ignore
const intervalMachine = Machine({
  id: 'interval',
  initial: 'counting',
  context: {
    interval: 10,
    count: 0
  },
  states: {
    counting: {
      invoke: {
        id: 'intervalService',
        src: ctx => cb => {
          const ivl = setInterval(() => {
            cb('INC');
          }, ctx.interval);

          return () => clearInterval(ivl);
        }
      },
      on: {
        '': {
          target: 'finished',
          cond: ctx => ctx.count === 3
        },
        INC: { actions: assign({ count: ctx => ctx.count + 1 }) },
        SKIP: 'wait'
      }
    },
    wait: {
      on: {
        // this should never be called if interval service is properly disposed
        INC: { actions: assign({ count: ctx => ctx.count + 1 }) }
      },
      after: {
        50: 'finished'
      }
    },
    finished: {
      type: 'final'
    }
  }
});

describe('invoke', () => {
  it('should start services (external machines)', done => {
    const childMachine = Machine({
      id: 'child',
      initial: 'init',
      states: {
        init: {
          onEntry: [sendParent('INC'), sendParent('INC')]
        }
      }
    });

    const someParentMachine = Machine(
      {
        id: 'parent',
        context: { count: 0 },
        initial: 'start',
        states: {
          start: {
            invoke: {
              src: 'child',
              id: 'someService',
              forward: true
            },
            on: {
              INC: { actions: assign({ count: ctx => ctx.count + 1 }) },
              '': {
                target: 'stop',
                cond: ctx => ctx.count === 2
              }
            }
          },
          stop: {
            type: 'final'
          }
        }
      },
      {
        services: {
          child: childMachine
        }
      }
    );

    let count: number;

    interpret(someParentMachine)
      .onTransition(state => {
        count = state.context.count;
      })
      .onDone(() => {
        // 1. The 'parent' machine will enter 'start' state
        // 2. The 'child' service will be run with ID 'someService'
        // 3. The 'child' machine will enter 'init' state
        // 4. The 'onEntry' action will be executed, which sends 'INC' to 'parent' machine twice
        // 5. The context will be updated to increment count to 2

        assert.equal(count, 2);
        done();
      })
      .start();
  });

  it('should forward events to services if forward: true', () => {
    const childMachine = Machine({
      id: 'child',
      initial: 'init',
      states: {
        init: {
          on: {
            FORWARD_DEC: {
              actions: [sendParent('DEC'), sendParent('DEC'), sendParent('DEC')]
            }
          }
        }
      }
    });

    const someParentMachine = Machine(
      {
        id: 'parent',
        context: { count: 0 },
        initial: 'start',
        states: {
          start: {
            invoke: {
              src: 'child',
              id: 'someService',
              forward: true
            },
            on: {
              DEC: { actions: assign({ count: ctx => ctx.count - 1 }) },
              FORWARD_DEC: undefined,
              '': {
                target: 'stop',
                cond: ctx => ctx.count === -3
              }
            }
          },
          stop: {
            type: 'final'
          }
        }
      },
      {
        services: {
          child: childMachine
        }
      }
    );

    let state: any;
    const service = interpret(someParentMachine)
      .onTransition(s => {
        state = s;
      })
      .onDone(() => {
        // 1. The 'parent' machine will not do anything (inert transition)
        // 2. The 'FORWARD_DEC' event will be forwarded to the 'child' machine (forward: true)
        // 3. On the 'child' machine, the 'FORWARD_DEC' event sends the 'DEC' action to the 'parent' thrice
        // 4. The context of the 'parent' machine will be updated from 2 to -1

        assert.deepEqual(state.context, { count: -3 });
      })
      .start();

    service.send('FORWARD_DEC');
  });

  it('should start services (explicit machine, invoke = config)', done => {
    interpret(fetcherMachine)
      .onDone(() => {
        done();
      })
      .start()
      .send('GO_TO_WAITING');
  });

  it('should start services (explicit machine, invoke = machine)', done => {
    interpret(fetcherMachine)
      .onDone(_ => {
        done();
      })
      .start()
      .send('GO_TO_WAITING_MACHINE');
  });

  it('should use the service overwritten by withConfig', done => {
    const childMachine = Machine({
      id: 'child',
      initial: 'init',
      states: {
        init: {}
      }
    });

    const someParentMachine = Machine(
      {
        id: 'parent',
        context: { count: 0 },
        initial: 'start',
        states: {
          start: {
            invoke: {
              src: 'child',
              id: 'someService',
              forward: true
            },
            on: {
              STOP: 'stop'
            }
          },
          stop: {
            type: 'final'
          }
        }
      },
      {
        services: {
          child: childMachine
        }
      }
    );

    interpret(
      someParentMachine.withConfig({
        services: {
          child: Machine({
            id: 'child',
            initial: 'init',
            states: {
              init: {
                onEntry: [sendParent('STOP')]
              }
            }
          })
        }
      })
    )
      .onDone(() => {
        done();
      })
      .start();
  });

  describe('parent to child', () => {
    const subMachine = Machine({
      id: 'child',
      initial: 'one',
      states: {
        one: {
          on: { NEXT: 'two' }
        },
        two: {
          onEntry: sendParent('NEXT')
        }
      }
    });

    it('should communicate with the child machine (invoke on machine)', done => {
      const mainMachine = Machine({
        id: 'parent',
        initial: 'one',
        invoke: {
          id: 'foo-child',
          src: subMachine
        },
        states: {
          one: {
            onEntry: send('NEXT', { to: 'foo-child' }),
            on: { NEXT: 'two' }
          },
          two: {
            type: 'final'
          }
        }
      });

      interpret(mainMachine)
        .onDone(() => {
          done();
        })
        .start();
    });

    it('should communicate with the child machine (invoke on created machine)', done => {
      interface MainMachineCtx {
        machine: typeof subMachine;
      }

      const mainMachine = Machine<MainMachineCtx>({
        id: 'parent',
        initial: 'one',
        context: {
          machine: subMachine
        },
        invoke: {
          id: 'foo-child',
          src: ctx => ctx.machine
        },
        states: {
          one: {
            onEntry: send('NEXT', { to: 'foo-child' }),
            on: { NEXT: 'two' }
          },
          two: {
            type: 'final'
          }
        }
      });

      interpret(mainMachine)
        .onDone(() => {
          done();
        })
        .start();
    });

    it('should communicate with the child machine (invoke on state)', done => {
      const mainMachine = Machine({
        id: 'parent',
        initial: 'one',
        states: {
          one: {
            invoke: {
              id: 'foo-child',
              src: subMachine
            },
            onEntry: send('NEXT', { to: 'foo-child' }),
            on: { NEXT: 'two' }
          },
          two: {
            type: 'final'
          }
        }
      });

      interpret(mainMachine)
        .onDone(() => {
          done();
        })
        .start();
    });

    it('should transition correctly if child invocation causes it to directly go to final state', done => {
      const doneSubMachine = Machine({
        id: 'child',
        initial: 'one',
        states: {
          one: {
            on: { NEXT: 'two' }
          },
          two: {
            type: 'final'
          }
        }
      });

      const mainMachine = Machine({
        id: 'parent',
        initial: 'one',
        states: {
          one: {
            invoke: {
              id: 'foo-child',
              src: doneSubMachine,
              onDone: 'two'
            },
            onEntry: send('NEXT', { to: 'foo-child' })
          },
          two: {
            on: { NEXT: 'three' }
          },
          three: {
            type: 'final'
          }
        }
      });

      const expectedStateValue = 'two';
      let currentState;
      interpret(mainMachine)
        .onTransition(current => (currentState = current))
        .start();
      setTimeout(() => {
        assert.equal(currentState.value, expectedStateValue);
        done();
      }, 30);
    });

    it('should work with invocations defined in orthogonal state nodes', done => {
      const pongMachine = Machine({
        id: 'pong',
        initial: 'active',
        states: {
          active: {
            type: 'final',
            data: { secret: 'pingpong' }
          }
        }
      });

      const pingMachine = Machine({
        id: 'ping',
        type: 'parallel',
        states: {
          one: {
            initial: 'active',
            states: {
              active: {
                invoke: {
                  id: 'pong',
                  src: pongMachine,
                  onDone: {
                    target: 'success',
                    cond: (_, e) => e.data.secret === 'pingpong'
                  }
                }
              },
              success: {
                type: 'final'
              }
            }
          }
        }
      });

      interpret(pingMachine)
        .onDone(() => {
          done();
        })
        .start();
    });
  });

  type PromiseExecutor = (
    resolve: (value?: any) => void,
    reject: (reason?: any) => void
  ) => void;

  const promiseTypes = [
    {
      type: 'Promise',
      createPromise(executor: PromiseExecutor): Promise<any> {
        return new Promise(executor);
      }
    },
    {
      type: 'PromiseLike',
      createPromise(executor: PromiseExecutor): PromiseLike<any> {
        // Simulate a Promise/A+ thenable / polyfilled Promise.
        function createThenable(promise: Promise<any>): PromiseLike<any> {
          return {
            then(onfulfilled, onrejected) {
              return createThenable(promise.then(onfulfilled, onrejected));
            }
          };
        }
        return createThenable(new Promise(executor));
      }
    }
  ];

  promiseTypes.forEach(({ type, createPromise }) => {
    describe(`with promises (${type})`, () => {
      const invokePromiseMachine = Machine({
        id: 'invokePromise',
        initial: 'pending',
        context: {
          id: 42,
          succeed: true
        },
        states: {
          pending: {
            invoke: {
              src: ctx =>
                createPromise(resolve => {
                  if (ctx.succeed) {
                    resolve(ctx.id);
                  } else {
                    throw new Error(`failed on purpose for: ${ctx.id}`);
                  }
                }),
              onDone: {
                target: 'success',
                cond: (ctx, e) => {
                  return e.data === ctx.id;
                }
              },
              onError: 'failure'
            }
          },
          success: {
            type: 'final'
          },
          failure: {
            type: 'final'
          }
        }
      });

      it('should be invoked with a promise factory and resolve through onDone', done => {
        interpret(invokePromiseMachine)
          .onDone(() => done())
          .start();
      });

      it('should be invoked with a promise factory and reject with ErrorExecution', done => {
        interpret(invokePromiseMachine.withContext({ id: 31, succeed: false }))
          .onDone(() => done())
          .start();
      });

      it('should be invoked with a promise factory and ignore unhandled onError target', done => {
        const promiseMachine = Machine({
          id: 'invokePromise',
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: () =>
                  createPromise(() => {
                    throw new Error('test');
                  }),
                onDone: 'success'
              }
            },
            success: {
              type: 'final'
            }
          }
        });

        interpret(promiseMachine)
          .onDone(() => assert.fail('should not be called'))
          .onStop(() => assert.fail('should not be called'))
          .start();
        // assumes that error was ignored before the timeout is processed
        setTimeout(() => done(), 30);
      });

      it('should be invoked with a promise factory and stop on unhandled onError target when on strict mode', done => {
        const promiseMachine = Machine({
          id: 'invokePromise',
          initial: 'pending',
          strict: true,
          states: {
            pending: {
              invoke: {
                src: () =>
                  createPromise(() => {
                    throw new Error('test');
                  }),
                onDone: 'success'
              }
            },
            success: {
              type: 'final'
            }
          }
        });

        interpret(promiseMachine)
          .onDone(() => assert.fail('should not be called'))
          .onStop(() => done())
          .start();
      });

      it('should be invoked with a promise factory and resolve through onDone for compound state nodes', done => {
        const promiseMachine = Machine({
          id: 'promise',
          initial: 'parent',
          states: {
            parent: {
              initial: 'pending',
              states: {
                pending: {
                  invoke: {
                    src: () => createPromise(resolve => resolve()),
                    onDone: 'success'
                  }
                },
                success: {
                  type: 'final'
                }
              },
              onDone: 'success'
            },
            success: {
              type: 'final'
            }
          }
        });

        interpret(promiseMachine)
          .onDone(() => done())
          .start();
      });

      it('should be invoked with a promise service and resolve through onDone for compound state nodes', done => {
        const promiseMachine = Machine(
          {
            id: 'promise',
            initial: 'parent',
            states: {
              parent: {
                initial: 'pending',
                states: {
                  pending: {
                    invoke: {
                      src: 'somePromise',
                      onDone: 'success'
                    }
                  },
                  success: {
                    type: 'final'
                  }
                },
                onDone: 'success'
              },
              success: {
                type: 'final'
              }
            }
          },
          {
            services: {
              somePromise: () => createPromise(resolve => resolve())
            }
          }
        );

        interpret(promiseMachine)
          .onDone(() => done())
          .start();
      });

      it('should assign the resolved data when invoked with a promise factory', done => {
        const promiseMachine = Machine({
          id: 'promise',
          context: { count: 0 },
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: () => createPromise(resolve => resolve({ count: 1 })),
                onDone: {
                  target: 'success',
                  actions: assign({ count: (_, e) => e.data.count })
                }
              }
            },
            success: {
              type: 'final'
            }
          }
        });

        let state: any;
        interpret(promiseMachine)
          .onTransition(s => {
            state = s;
          })
          .onDone(() => {
            assert.equal(state.context.count, 1);
            done();
          })
          .start();
      });

      it('should assign the resolved data when invoked with a promise service', done => {
        const promiseMachine = Machine(
          {
            id: 'promise',
            context: { count: 0 },
            initial: 'pending',
            states: {
              pending: {
                invoke: {
                  src: 'somePromise',
                  onDone: {
                    target: 'success',
                    actions: assign({ count: (_, e) => e.data.count })
                  }
                }
              },
              success: {
                type: 'final'
              }
            }
          },
          {
            services: {
              somePromise: () => createPromise(resolve => resolve({ count: 1 }))
            }
          }
        );

        let state: any;
        interpret(promiseMachine)
          .onTransition(s => {
            state = s;
          })
          .onDone(() => {
            assert.equal(state.context.count, 1);
            done();
          })
          .start();
      });

      it('should provide the resolved data when invoked with a promise factory', done => {
        let count = 0;

        const promiseMachine = Machine({
          id: 'promise',
          context: { count: 0 },
          initial: 'pending',
          states: {
            pending: {
              invoke: {
                src: () => createPromise(resolve => resolve({ count: 1 })),
                onDone: {
                  target: 'success',
                  actions: (_, e) => {
                    count = e.data.count;
                  }
                }
              }
            },
            success: {
              type: 'final'
            }
          }
        });

        interpret(promiseMachine)
          .onDone(() => {
            assert.equal(count, 1);
            done();
          })
          .start();
      });

      it('should provide the resolved data when invoked with a promise service', done => {
        let count = 0;

        const promiseMachine = Machine(
          {
            id: 'promise',
            initial: 'pending',
            states: {
              pending: {
                invoke: {
                  src: 'somePromise',
                  onDone: {
                    target: 'success',
                    actions: (_, e) => {
                      count = e.data.count;
                    }
                  }
                }
              },
              success: {
                type: 'final'
              }
            }
          },
          {
            services: {
              somePromise: () => createPromise(resolve => resolve({ count: 1 }))
            }
          }
        );

        interpret(promiseMachine)
          .onDone(() => {
            assert.equal(count, 1);
            done();
          })
          .start();
      });

      it('should be able to specify a Promise as a service', done => {
        const promiseMachine = Machine(
          {
            id: 'promise',
            initial: 'pending',
            context: { foo: true },
            states: {
              pending: {
                on: { BEGIN: 'first' }
              },
              first: {
                invoke: {
                  src: 'somePromise',
                  onDone: 'last'
                }
              },
              last: {
                type: 'final'
              }
            }
          },
          {
            services: {
              somePromise: (ctx, e) => {
                return createPromise((resolve, reject) => {
                  ctx.foo && e.payload ? resolve() : reject();
                });
              }
            }
          }
        );

        interpret(promiseMachine)
          .onDone(() => done())
          .start()
          .send({ type: 'BEGIN', payload: true });
      });
    });
  });

  describe('with callbacks', () => {
    it('should be able to specify a callback as a service', done => {
      const callbackMachine = Machine(
        {
          id: 'callback',
          initial: 'pending',
          context: { foo: true },
          states: {
            pending: {
              on: { BEGIN: 'first' }
            },
            first: {
              invoke: {
                src: 'someCallback'
              },
              on: {
                CALLBACK: {
                  target: 'last',
                  cond: (_, e) => e.data === 42
                }
              }
            },
            last: {
              type: 'final'
            }
          }
        },
        {
          services: {
            someCallback: (ctx, e) => cb => {
              if (ctx.foo && e.payload) {
                cb({ type: 'CALLBACK', data: 40 });
                cb({ type: 'CALLBACK', data: 41 });
                cb({ type: 'CALLBACK', data: 42 });
              }
            }
          }
        }
      );

      interpret(callbackMachine)
        .onDone(() => done())
        .start()
        .send({ type: 'BEGIN', payload: true });
    });

    it('should transition correctly if callback function sends an event', () => {
      const callbackMachine = Machine(
        {
          id: 'callback',
          initial: 'pending',
          context: { foo: true },
          states: {
            pending: {
              on: { BEGIN: 'first' }
            },
            first: {
              invoke: {
                src: 'someCallback'
              },
              on: { CALLBACK: 'intermediate' }
            },
            intermediate: {
              on: { NEXT: 'last' }
            },
            last: {
              type: 'final'
            }
          }
        },
        {
          services: {
            someCallback: () => cb => {
              cb('CALLBACK');
            }
          }
        }
      );

      const expectedStateValues = ['pending', 'first', 'intermediate'];
      const stateValues: StateValue[] = [];
      interpret(callbackMachine)
        .onTransition(current => stateValues.push(current.value))
        .start()
        .send('BEGIN');
      for (let i = 0; i < expectedStateValues.length; i++) {
        assert.equal(stateValues[i], expectedStateValues[i]);
      }
    });

    it('should transition correctly if callback function invoked from start and sends an event', () => {
      const callbackMachine = Machine(
        {
          id: 'callback',
          initial: 'idle',
          context: { foo: true },
          states: {
            idle: {
              invoke: {
                src: 'someCallback'
              },
              on: { CALLBACK: 'intermediate' }
            },
            intermediate: {
              on: { NEXT: 'last' }
            },
            last: {
              type: 'final'
            }
          }
        },
        {
          services: {
            someCallback: () => cb => {
              cb('CALLBACK');
            }
          }
        }
      );

      const expectedStateValues = ['idle', 'intermediate'];
      const stateValues: StateValue[] = [];
      interpret(callbackMachine)
        .onTransition(current => stateValues.push(current.value))
        .start()
        .send('BEGIN');
      for (let i = 0; i < expectedStateValues.length; i++) {
        assert.equal(stateValues[i], expectedStateValues[i]);
      }
    });

    // tslint:disable-next-line:max-line-length
    it('should transition correctly if transient transition happens before current state invokes callback function and sends an event', () => {
      const callbackMachine = Machine(
        {
          id: 'callback',
          initial: 'pending',
          context: { foo: true },
          states: {
            pending: {
              on: { BEGIN: 'first' }
            },
            first: {
              on: { '': 'second' }
            },
            second: {
              invoke: {
                src: 'someCallback'
              },
              on: { CALLBACK: 'third' }
            },
            third: {
              on: { NEXT: 'last' }
            },
            last: {
              type: 'final'
            }
          }
        },
        {
          services: {
            someCallback: () => cb => {
              cb('CALLBACK');
            }
          }
        }
      );

      const expectedStateValues = ['pending', 'second', 'third'];
      const stateValues: StateValue[] = [];
      interpret(callbackMachine)
        .onTransition(current => stateValues.push(current.value))
        .start()
        .send('BEGIN');
      for (let i = 0; i < expectedStateValues.length; i++) {
        assert.equal(stateValues[i], expectedStateValues[i]);
      }
    });

    it('should treat a callback source as an event stream', done => {
      interpret(intervalMachine)
        .onDone(() => done())
        .start();
    });

    it('should dispose of the callback (if disposal function provided)', done => {
      let state: any;
      const service = interpret(intervalMachine)
        .onTransition(s => {
          state = s;
        })
        .onDone(() => {
          // if intervalService isn't disposed after skipping, 'INC' event will
          // keep being sent
          assert.equal(
            state.context.count,
            0,
            'should exit interval service before the first event is sent'
          );
          done();
        })
        .start();

      // waits 50 milliseconds before going to final state.
      service.send('SKIP');
    });

    it('callback should be able to receive messages from parent', done => {
      const pingPongMachine = Machine({
        id: 'ping-pong',
        initial: 'active',
        states: {
          active: {
            invoke: {
              id: 'child',
              src: () => (next, onEvent) => {
                onEvent(e => {
                  if (e.type === 'PING') {
                    next('PONG');
                  }
                });
              }
            },
            onEntry: send('PING', { to: 'child' }),
            on: {
              PONG: 'done'
            }
          },
          done: {
            type: 'final'
          }
        }
      });

      interpret(pingPongMachine)
        .onDone(() => done())
        .start();
    });

    it('should call onError upon error (sync)', done => {
      const errorMachine = Machine({
        id: 'error',
        initial: 'safe',
        states: {
          safe: {
            invoke: {
              src: () => () => {
                throw new Error('test');
              },
              onError: {
                target: 'failed',
                cond: (_, e) => {
                  return e.data instanceof Error && e.data.message === 'test';
                }
              }
            }
          },
          failed: {
            type: 'final'
          }
        }
      });

      interpret(errorMachine)
        .onDone(() => done())
        .start();
    });

    it('should transition correctly upon error (sync)', () => {
      const errorMachine = Machine({
        id: 'error',
        initial: 'safe',
        states: {
          safe: {
            invoke: {
              src: () => () => {
                throw new Error('test');
              },
              onError: 'failed'
            }
          },
          failed: {
            on: { RETRY: 'safe' }
          }
        }
      });

      const expectedStateValue = 'failed';
      let currentState;
      interpret(errorMachine)
        .onTransition(current => (currentState = current))
        .start();
      assert.equal(currentState.value, expectedStateValue);
    });

    it('should call onError upon error (async)', done => {
      const errorMachine = Machine({
        id: 'asyncError',
        initial: 'safe',
        states: {
          safe: {
            invoke: {
              src: () => async () => {
                await true;
                throw new Error('test');
              },
              onError: {
                target: 'failed',
                cond: (_, e) => {
                  return e.data instanceof Error && e.data.message === 'test';
                }
              }
            }
          },
          failed: {
            type: 'final'
          }
        }
      });

      interpret(errorMachine)
        .onDone(() => done())
        .start();
    });

    it('should be able to be stringified', () => {
      const waitingState = fetcherMachine.transition(
        fetcherMachine.initialState,
        'GO_TO_WAITING'
      );

      assert.doesNotThrow(() => {
        JSON.stringify(waitingState);
      });

      assert.isString(waitingState.actions[0].activity!.src);
    });

    it('should throw error if unhandled (sync)', () => {
      const errorMachine = Machine({
        id: 'asyncError',
        initial: 'safe',
        states: {
          safe: {
            invoke: {
              src: () => () => {
                throw new Error('test');
              }
            }
          },
          failed: {
            type: 'final'
          }
        }
      });

      const service = interpret(errorMachine);
      assert.throws(() => service.start(), 'test');
    });

    it('should stop machine if unhandled error and on strict mode (async)', done => {
      const errorMachine = Machine({
        id: 'asyncError',
        initial: 'safe',
        // if not in strict mode we have no way to know if there
        // was an error with processing rejected promise
        strict: true,
        states: {
          safe: {
            invoke: {
              src: () => async () => {
                await true;
                throw new Error('test');
              }
            }
          },
          failed: {
            type: 'final'
          }
        }
      });

      interpret(errorMachine)
        .onStop(() => done())
        .start();
    });

    it('should ignore error if unhandled error and not on strict mode (async)', done => {
      const errorMachine = Machine({
        id: 'asyncError',
        initial: 'safe',
        // if not in strict mode we have no way to know if there
        // was an error with processing rejected promise
        strict: false,
        states: {
          safe: {
            invoke: {
              src: () => async () => {
                await true;
                throw new Error('test');
              }
            }
          },
          failed: {
            type: 'final'
          }
        }
      });

      interpret(errorMachine)
        .onDone(() => assert.fail('should not be called'))
        .onStop(() => assert.fail('should not be called'))
        .start();
      // assumes that error was ignored before the timeout is processed
      setTimeout(() => done(), 20);
    });

    describe('sub invoke race condition', () => {
      const anotherChildMachine = Machine({
        id: 'child',
        initial: 'start',
        states: {
          start: {
            on: { STOP: 'end' }
          },
          end: {
            type: 'final'
          }
        }
      });

      const anotherParentMachine = Machine({
        id: 'parent',
        initial: 'begin',
        states: {
          begin: {
            invoke: {
              src: anotherChildMachine,
              id: 'invoked.child',
              onDone: 'completed'
            },
            on: {
              STOPCHILD: {
                actions: send('STOP', { to: 'invoked.child' })
              }
            }
          },
          completed: {
            type: 'final'
          }
        }
      });

      it('ends on the completed state', done => {
        const events: EventObject[] = [];
        let state: any;
        const service = interpret(anotherParentMachine)
          .onTransition(s => {
            state = s;
          })
          .onEvent(e => {
            events.push(e);
          })
          .onDone(() => {
            assert.deepEqual(events.map(e => e.type), [
              actionTypes.init,
              'STOPCHILD',
              doneInvoke('invoked.child').type
            ]);
            assert.equal(state.value, 'completed');
            done();
          })
          .start();

        service.send('STOPCHILD');
      });
    });
  });

  describe('with observables', () => {
    const infinite$ = interval(10);

    it('should work with an infinite observable', done => {
      const obsMachine = Machine<{ count: number | undefined }>({
        id: 'obs',
        initial: 'counting',
        context: { count: undefined },
        states: {
          counting: {
            invoke: {
              src: () =>
                infinite$.pipe(
                  map(value => {
                    return { type: 'COUNT', value };
                  })
                )
            },
            on: {
              '': {
                target: 'counted',
                cond: ctx => ctx.count === 5
              },
              COUNT: { actions: assign({ count: (_, e) => e.value }) }
            }
          },
          counted: {
            type: 'final'
          }
        }
      });

      interpret(obsMachine)
        .onDone(() => {
          done();
        })
        .start();
    });

    it('should work with a finite observable', done => {
      const obsMachine = Machine<{ count: number | undefined }>({
        id: 'obs',
        initial: 'counting',
        context: { count: undefined },
        states: {
          counting: {
            invoke: {
              src: () =>
                infinite$.pipe(
                  take(5),
                  map(value => {
                    return { type: 'COUNT', value };
                  })
                ),
              onDone: {
                target: 'counted',
                cond: ctx => ctx.count === 4
              }
            },
            on: {
              COUNT: { actions: assign({ count: (_, e) => e.value }) }
            }
          },
          counted: {
            type: 'final'
          }
        }
      });

      interpret(obsMachine)
        .onDone(() => {
          done();
        })
        .start();
    });

    it('should receive an emitted error', done => {
      const obsMachine = Machine<{ count: number | undefined }>({
        id: 'obs',
        initial: 'counting',
        context: { count: undefined },
        states: {
          counting: {
            invoke: {
              src: () =>
                infinite$.pipe(
                  map(value => {
                    if (value === 5) {
                      throw new Error('some error');
                    }

                    return { type: 'COUNT', value };
                  })
                ),
              onError: {
                target: 'success',
                cond: (ctx, e) => {
                  assert.equal(e.data.message, 'some error');
                  return ctx.count === 4 && e.data.message === 'some error';
                }
              }
            },
            on: {
              COUNT: { actions: assign({ count: (_, e) => e.value }) }
            }
          },
          success: {
            type: 'final'
          }
        }
      });

      interpret(obsMachine)
        .onDone(() => {
          done();
        })
        .start();
    });
  });

  describe('nested invoked machine', () => {
    const pongMachine = Machine({
      id: 'pong',
      initial: 'active',
      states: {
        active: {
          on: {
            PING: {
              // Sends 'PONG' event to parent machine
              actions: sendParent('PONG')
            }
          }
        }
      }
    });

    // Parent machine
    const pingMachine = Machine({
      id: 'ping',
      initial: 'innerMachine',
      states: {
        innerMachine: {
          initial: 'active',
          states: {
            active: {
              invoke: {
                id: 'pong',
                src: pongMachine
              },
              // Sends 'PING' event to child machine with ID 'pong'
              onEntry: send('PING', { to: 'pong' }),
              on: {
                PONG: 'innerSuccess'
              }
            },
            innerSuccess: {
              type: 'final'
            }
          },
          onDone: 'success'
        },
        success: { type: 'final' }
      }
    });

    it('should create invocations from machines in nested states', done => {
      interpret(pingMachine)
        .onDone(() => done())
        .start();
    });
  });

  describe('multiple simultaneous services', () => {
    // @ts-ignore
    const multiple = Machine({
      id: 'machine',
      initial: 'one',

      context: {},

      on: {
        ONE: {
          actions: assign({
            one: 'one'
          })
        },

        TWO: {
          actions: assign({
            two: 'two'
          }),
          target: '.three'
        }
      },

      states: {
        one: {
          initial: 'two',
          states: {
            two: {
              invoke: [
                {
                  id: 'child',
                  src: () => cb => cb('ONE')
                },
                {
                  id: 'child2',
                  src: () => cb => cb('TWO')
                }
              ]
            }
          }
        },
        three: {
          type: 'final'
        }
      }
    });

    it('should start all services at once', done => {
      let state: any;
      const service = interpret(multiple)
        .onTransition(s => {
          state = s;
        })
        .onDone(() => {
          assert.deepEqual(state.context, { one: 'one', two: 'two' });
          done();
        });

      service.start();
    });

    const parallel = Machine({
      id: 'machine',
      initial: 'one',

      context: {},

      on: {
        ONE: {
          actions: assign({
            one: 'one'
          })
        },

        TWO: {
          actions: assign({
            two: 'two'
          }),
          target: '.three'
        }
      },

      states: {
        one: {
          initial: 'two',
          states: {
            two: {
              type: 'parallel',
              states: {
                a: {
                  invoke: {
                    id: 'child',
                    src: () => cb => cb('ONE')
                  }
                },
                b: {
                  invoke: {
                    id: 'child2',
                    src: () => cb => cb('TWO')
                  }
                }
              }
            }
          }
        },
        three: {
          type: 'final'
        }
      }
    });

    it('should run services in parallel', done => {
      let state: any;
      const service = interpret(parallel)
        .onTransition(s => {
          state = s;
        })
        .onDone(() => {
          assert.deepEqual(state.context, { one: 'one', two: 'two' });
          done();
        });

      service.start();
    });

    it('should not invoke a service if transient', done => {
      // Since an invocation will be canceled when the state machine leaves the
      // invoking state, it does not make sense to start an invocation in a state
      // that will be exited immediately
      let serviceCalled = false;
      const transientMachine = Machine({
        id: 'transient',
        initial: 'active',
        states: {
          active: {
            invoke: {
              id: 'doNotInvoke',
              src: async () => {
                serviceCalled = true;
              }
            },
            on: {
              '': 'inactive'
            }
          },
          inactive: {
            after: { 10: 'complete' }
          },
          complete: {
            type: 'final'
          }
        }
      });

      const service = interpret(transientMachine);

      service
        .onDone(() => {
          assert.isFalse(serviceCalled, 'service should not be called');
          done();
        })
        .start();
    });
  });
});
