import { getActionType, toStatePath, toTrie, mapValues } from './utils';
import { Action, StateValue, IStateNodeConfig } from './types';
import matchesState from './matchesState';
import mapState from './mapState';
import State from './State';

const STATE_DELIMITER = '.';
const HISTORY_KEY = '$history';

class StateNode {
  public key?: string;
  public id: string;
  public initial?: string;
  public parallel?: boolean;
  public states?: Record<string, StateNode>;
  public on?: Record<string, string>;
  public parent?: StateNode;

  private _events?: string[];
  private _relativeValue: Map<StateNode, StateValue> = new Map();
  private _initialState: StateValue | undefined;
  constructor(config: IStateNodeConfig) {
    this.key = config.key;
    this.parent = config.parent;
    this.id = this.parent
      ? this.parent.id + STATE_DELIMITER + this.key
      : this.key;
    this.initial = config.initial;
    this.parallel = !!config.parallel;
    this.states = config.states
      ? mapValues(
          config.states,
          (stateConfig, key) =>
            new StateNode({
              ...stateConfig,
              key,
              parent: this
            })
        )
      : {};

    this.on = config.on;
  }
  public transition(
    state: StateValue | State,
    action: Action
  ): State | undefined {
    const nextStateValue = this._transition(state, action);

    if (!nextStateValue) {
      return undefined;
    }

    return new State(nextStateValue, State.from(state));
  }
  public _transition(
    state: StateValue | State,
    action: Action
  ): StateValue | undefined {
    if (!this.states) {
      return undefined;
    }
    const history = State.from(state).history;
    let stateValue = toTrie(state instanceof State ? state.value : state);

    if (typeof stateValue === 'string') {
      if (!this.states[stateValue]) {
        throw new Error('state doesnt exist');
      }

      const subState = this.states[stateValue];
      const initialState = subState.initialState;

      if (initialState) {
        stateValue = { [stateValue]: initialState };
      } else {
        return (
          subState.next(action, history ? history.value : undefined) ||
          undefined
        );
      }
    }

    let nextStateValue = mapValues(stateValue, (subStateValue, subStateKey) => {
      if (!this.states[subStateKey]) {
        return undefined;
      }

      const subHistory = history ? history.value[subStateKey] : undefined;
      const subState = new State(
        subStateValue,
        subHistory ? State.from(subHistory) : undefined
      );
      return this.states[subStateKey]._transition(subState, action);
    });

    if (
      Array.prototype.every.call(Object.keys(nextStateValue), key => {
        return nextStateValue[key] === undefined;
      })
    ) {
      if (this.parallel) {
        return undefined;
      }

      const subStateKey = Object.keys(nextStateValue)[0];
      return this.states[subStateKey].next(
        action,
        history ? history.value : undefined
      );
    }

    if (this.parallel) {
      nextStateValue = { ...(this.initialState as {}), ...nextStateValue };
    }

    return mapValues(nextStateValue, (value, key) => {
      if (value) {
        return value;
      }

      return stateValue[key];
    });
  }

  public next(action?: Action, history?: StateValue): StateValue | undefined {
    if (!action) {
      return this.key;
    }

    const actionType = getActionType(action);

    if (!this.on || !this.on[actionType]) {
      return undefined;
    }

    const nextPath = toStatePath(this.on[actionType]);
    let currentState = this.parent;
    let currentHistory = history;
    let currentPath = this.key;

    nextPath.forEach(subPath => {
      if (subPath === HISTORY_KEY) {
        if (currentHistory) {
          subPath =
            typeof currentHistory === 'object'
              ? Object.keys(currentHistory)[0]
              : currentHistory;
        } else {
          subPath = currentState.initial;
        }
      }
      if (typeof subPath === 'object') {
        subPath = Object.keys(subPath)[0];
      }

      currentState = currentState.states[subPath];

      if (currentState === undefined) {
        throw new Error(
          `Action '${action}' on state '${currentPath}' leads to undefined state '${nextPath}'.`
        );
      }

      currentPath = subPath;

      if (currentHistory) {
        currentHistory = currentHistory[subPath];
      }
    });

    while (currentState.initial) {
      currentState = currentState.states[currentState.initial];
    }

    return currentState.getRelativeValue(this.parent);
  }
  public getInitialState(): StateValue | undefined {
    console.warn(
      'machine.getInitialState() will be deprecated in 2.0. Please use machine.initialState instead.'
    );
    return this.initialState;
  }
  public get initialState(): StateValue | undefined {
    this._initialState =
      this._initialState ||
      (this.parallel
        ? mapValues(this.states, state => state.initialState)
        : this.initial);

    return this._initialState;
  }
  public getState(relativeStateId: string): StateNode | undefined {
    const statePath = toStatePath(relativeStateId);

    try {
      return statePath.reduce(
        (subState, subPath) => {
          return subState.states[subPath];
        },
        this as StateNode
      );
    } catch (e) {
      return undefined;
    }
  }
  get events(): string[] {
    if (this._events) {
      return this._events;
    }

    const events = new Set(this.on ? Object.keys(this.on) : undefined);

    Object.keys(this.states).forEach(stateId => {
      const state = this.states[stateId];
      if (state.states) {
        for (const event of state.events) {
          events.add(event);
        }
      }
    });

    return (this._events = Array.from(events));
  }
  public getRelativeValue(toNode?: StateNode): StateValue {
    const memoizedRelativeValue = this._relativeValue.get(toNode);

    if (memoizedRelativeValue) {
      return memoizedRelativeValue;
    }

    const initialState = this.initialState;
    let relativeValue = initialState
      ? {
          [this.key]: initialState
        }
      : this.key;
    let currentNode: StateNode = this.parent;

    while (currentNode && currentNode !== toNode) {
      const currentInitialState = currentNode.initialState;
      relativeValue = {
        [currentNode.key]:
          typeof currentInitialState === 'object' &&
          typeof relativeValue === 'object'
            ? { ...currentInitialState, ...relativeValue }
            : relativeValue
      };
      currentNode = currentNode.parent;
    }

    this._relativeValue.set(toNode, relativeValue);

    return relativeValue;
  }
}

function Machine(config: IStateNodeConfig): StateNode {
  return new StateNode(config);
}

export { StateNode, Machine, State, matchesState, mapState };
