import { assert } from 'chai';
import { useMemo } from 'react';
import * as React from 'react';
import { useMachine } from '../src';
import { Machine, assign, Interpreter, spawn } from 'xstate';
import {
  render,
  fireEvent,
  cleanup,
  waitForElement
} from 'react-testing-library';
import { doneInvoke } from '../../../lib/actions';

afterEach(cleanup);

describe('useMachine hook', () => {
  const context = {
    data: undefined
  };
  const fetchMachine = Machine<typeof context>({
    id: 'fetch',
    initial: 'idle',
    context,
    states: {
      idle: {
        on: { FETCH: 'loading' }
      },
      loading: {
        invoke: {
          src: 'fetchData',
          onDone: {
            target: 'success',
            actions: assign({
              data: (_, e) => e.data
            }),
            cond: (_, e) => e.data.length
          }
        }
      },
      success: {
        type: 'final'
      }
    }
  });

  const Fetcher = () => {
    const machine = useMemo(
      () =>
        Fetcher.machine.withConfig({
          services: {
            fetchData: () => new Promise(res => res('some data')),
            ...Fetcher.machine.options.services
          }
        }),
      []
    );

    const [current, send] = useMachine(machine);

    switch (current.value) {
      case 'idle':
        return <button onClick={_ => send('FETCH')}>Fetch</button>;
      case 'loading':
        return <div>Loading...</div>;
      case 'success':
        return (
          <div>
            Success! Data: <div data-testid="data">{current.context.data}</div>
          </div>
        );
      default:
        return null;
    }
  };

  Fetcher.machine = fetchMachine;

  it('should work with the useMachine hook', async () => {
    Fetcher.machine = fetchMachine.withConfig({
      services: {
        fetchData: () => new Promise(res => res('fake data'))
      }
    });

    const { getByText, getByTestId } = render(<Fetcher />);
    const button = getByText('Fetch');
    fireEvent.click(button);
    getByText('Loading...');
    await waitForElement(() => getByText(/Success/));
    const dataEl = getByTestId('data');
    assert.equal(dataEl.textContent, 'fake data');
  });

  it('should provide the service', () => {
    const Test = () => {
      const [, , service] = useMachine(fetchMachine);

      if (!(service instanceof Interpreter)) {
        throw new Error('service not instance of Interpreter');
      }

      return null;
    };

    render(<Test />);
  });

  it('should provide options for the service', () => {
    const Test = () => {
      const [, , service] = useMachine(fetchMachine, {
        execute: false
      });

      assert.isFalse(service.options.execute);

      return null;
    };

    render(<Test />);
  });

  it('should not spawn actors until service is started', async done => {
    const spawnMachine = Machine<any>({
      id: 'spawn',
      initial: 'start',
      context: { ref: undefined },
      states: {
        start: {
          entry: assign({
            ref: () => spawn(new Promise(res => res(42)), 'my-promise')
          }),
          on: {
            [doneInvoke('my-promise')]: 'success'
          }
        },
        success: {
          type: 'final'
        }
      }
    });

    const Spawner = () => {
      const [current] = useMachine(spawnMachine);

      switch (current.value) {
        case 'start':
          return <span data-testid="start" />;
        case 'success':
          return <span data-testid="success" />;
        default:
          return null;
      }
    };

    const { getByTestId } = render(<Spawner />);
    await waitForElement(() => getByTestId('success'));
    done();
  });
});
