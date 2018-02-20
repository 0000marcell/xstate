import { getEventType, toStatePath, toTrie, mapValues } from './utils';
import {
  Event,
  StateValue,
  Transition,
  Action,
  Machine,
  StandardMachine,
  ParallelMachine,
  SimpleOrCompoundStateNodeConfig,
  MachineConfig,
  ParallelMachineConfig,
  EventType,
  EventObject,
  ActionMap,
  StandardMachineConfig,
  TransitionConfig,
  ActivityMap,
  StateNodeConfig,
  Activity,
  StateTransition
} from './types';
import matchesState from './matchesState';
import mapState from './mapState';
import { State } from './State';
import { start, stop } from './actions';

const STATE_DELIMITER = '.';
const HISTORY_KEY = '$history';
const NULL_EVENT = '';
class StateNode implements StateNodeConfig {
  public key: string;
  public id: string;
  public relativeId: string;
  public initial?: string;
  public parallel?: boolean;
  public states: Record<string, StateNode>;
  public on?: Record<string, Transition | undefined>;
  public onEntry?: Action[];
  public onExit?: Action[];
  public activities?: Activity[];
  public strict: boolean;
  public parent?: StateNode;
  public machine: StateNode;
  public data: object | undefined;

  private __cache = {
    events: undefined as EventType[] | undefined,
    relativeValue: new Map() as Map<StateNode, StateValue>,
    initialState: undefined as StateValue | undefined
  };

  constructor(
    public config:
      | SimpleOrCompoundStateNodeConfig
      | StandardMachineConfig
      | ParallelMachineConfig
  ) {
    this.key = config.key || '(machine)';
    this.parent = config.parent;
    this.machine = this.parent ? this.parent.machine : this;
    this.id = this.parent
      ? this.parent.id + STATE_DELIMITER + this.key
      : this.key;
    this.relativeId =
      this.parent && this.parent.parent
        ? this.parent.relativeId + STATE_DELIMITER + this.key
        : this.key;
    this.initial = config.initial;
    this.parallel = !!config.parallel;
    this.states = (config.states
      ? mapValues<SimpleOrCompoundStateNodeConfig, StateNode>(
          config.states,
          (stateConfig, key) =>
            new StateNode({
              ...stateConfig,
              key,
              parent: this
            })
        )
      : {}) as Record<string, StateNode>;

    this.on = config.on;
    this.strict = !!config.strict;
    this.onEntry = config.onEntry
      ? ([] as Action[]).concat(config.onEntry)
      : undefined;
    this.onExit = config.onExit
      ? ([] as Action[]).concat(config.onExit)
      : undefined;
    this.data = config.data;
    this.activities = config.activities;
  }
  public getStateNodes(state: StateValue | State): StateNode[] {
    const stateValue = state instanceof State ? state.value : toTrie(state);

    if (typeof stateValue === 'string') {
      const initialStateValue = (this.states[stateValue] as StateNode).initial;

      return initialStateValue
        ? this.getStateNodes({ [stateValue]: initialStateValue })
        : [this.states[stateValue]];
    }

    const subStateKeys = Object.keys(stateValue);
    const subStateNodes: StateNode[] = subStateKeys.map(
      subStateKey => this.states[subStateKey]
    );

    return subStateNodes.concat(
      subStateKeys
        .map(subStateKey =>
          this.states[subStateKey].getStateNodes(stateValue[subStateKey])
        )
        .reduce((a, b) => a.concat(b))
    );
  }
  public handles(event: Event): boolean {
    const eventType = getEventType(event);

    if (this.on) {
      return eventType in this.on;
    }

    return false;
  }
  public transition(
    state: StateValue | State,
    event: Event,
    extendedState?: any
  ): State {
    if (this.strict) {
      const eventType = getEventType(event);
      if (this.events.indexOf(eventType) === -1) {
        throw new Error(
          `Machine '${this.id}' does not accept event '${eventType}'`
        );
      }
    }

    const stateTransition = this.transitionStateValue(
      state,
      event,
      extendedState
    );
    const nextState = this.stateTransitionToState(stateTransition, state);

    if (!nextState) {
      return State.inert(state);
    }

    // Try transitioning from "transient" states from the NULL_EVENT
    // until a state with non-transient transitions is found
    let maybeNextState: State | undefined = nextState;
    let nextStateFromInternalTransition: State;
    do {
      nextStateFromInternalTransition = maybeNextState;
      maybeNextState = this.stateTransitionToState(
        this.transitionStateValue(
          nextStateFromInternalTransition,
          NULL_EVENT,
          extendedState
        ),
        nextStateFromInternalTransition
      );
    } while (maybeNextState);

    // TODO: handle internally raised events

    return nextStateFromInternalTransition;
  }
  private stateTransitionToState(
    stateTransition: StateTransition,
    prevState: StateValue | State
  ): State | undefined {
    const {
      stateValue: nextStateValue,
      actions: nextActions,
      activities: nextActivities
    } = stateTransition;

    if (!nextStateValue) {
      return undefined;
    }

    const prevActivities =
      prevState instanceof State ? prevState.activities : undefined;

    const activities = { ...prevActivities, ...nextActivities };

    return new State(
      // next state value
      nextStateValue,
      // history
      State.from(prevState),
      // effects
      nextActions
        ? nextActions.onExit
            .concat(nextActions.actions)
            .concat(nextActions.onEntry)
        : [],
      // activities
      activities,
      // data
      this.getStateNodes(nextStateValue).reduce(
        (data, stateNode) => {
          data[stateNode.id] = stateNode.data;
          return data;
        },
        {} as Record<string, any>
      )
    );
  }
  private transitionStateValue(
    state: StateValue | State,
    event: Event,
    extendedState?: any
  ): StateTransition {
    const history = state instanceof State ? state.history : undefined;
    let stateValue = toTrie(state);

    if (typeof stateValue === 'string') {
      if (!this.states[stateValue]) {
        throw new Error(
          `State '${stateValue}' does not exist on machine '${this.id}'`
        );
      }

      const subStateNode = this.states[stateValue] as StateNode;
      if (subStateNode.states && subStateNode.initial) {
        // Get the initial state value
        const initialStateValue = subStateNode.initialState.value;
        stateValue = { [stateValue]: initialStateValue };
      } else {
        // Transition from the substate
        return subStateNode.next(
          event,
          history ? history.value : undefined,
          extendedState
        );
      }
    }

    // Potential transition tuples from parent state nodes
    const potentialStateTransitions: StateTransition[] = [];

    let nextStateValue = mapValues(stateValue, (subStateValue, subStateKey) => {
      const subHistory = history ? history.value[subStateKey] : undefined;
      const subState = new State(
        subStateValue,
        subHistory ? State.from(subHistory) : undefined
      );
      const subStateNode = this.states[subStateKey];
      const subStateTransition = subStateNode.transitionStateValue(
        subState,
        event,
        extendedState
      );

      if (!subStateTransition.stateValue) {
        potentialStateTransitions.push(
          subStateNode.next(
            event,
            history ? history.value : undefined,
            extendedState
          )
        );
      }

      return subStateTransition;
    });

    if (
      Array.prototype.every.call(Object.keys(nextStateValue), key => {
        return nextStateValue[key].stateValue === undefined;
      })
    ) {
      if (this.parallel) {
        if (potentialStateTransitions.length) {
          return potentialStateTransitions[0];
        }

        return {
          stateValue: undefined,
          actions: { onEntry: [], onExit: [], actions: [] },
          activities: undefined
        };
      }

      const subStateKey = Object.keys(nextStateValue)[0];

      // try with parent
      const {
        stateValue: parentNextValue,
        actions: parentNextActions,
        activities: parentActivities
      } = this.states[subStateKey].next(
        event,
        history ? history.value : undefined,
        extendedState
      );
      const nextActions = nextStateValue[subStateKey].actions;
      const activities = nextStateValue[subStateKey].activities;

      const allActivities = {
        ...activities,
        ...parentActivities
      };

      const allActions = parentNextActions
        ? nextActions
          ? {
              onEntry: [...nextActions.onEntry, ...parentNextActions.onEntry],
              actions: [...nextActions.actions, ...parentNextActions.actions],
              onExit: [...nextActions.onExit, ...parentNextActions.onExit]
            }
          : parentNextActions
        : nextActions;

      return {
        stateValue: parentNextValue,
        actions: allActions,
        activities: allActivities
      };
    }

    if (this.parallel) {
      nextStateValue = {
        ...mapValues(
          this.initialState.value as Record<string, StateValue>,
          subStateValue => ({
            stateValue: subStateValue,
            actions: { onEntry: [], onExit: [], actions: [] },
            activities: undefined
          })
        ),
        ...nextStateValue
      };
    }

    const finalActions: ActionMap = {
      onEntry: [],
      actions: [],
      onExit: []
    };
    const finalActivities: ActivityMap = {};
    const finalStateValue = mapValues(
      nextStateValue,
      (subStateTransition, key) => {
        const {
          stateValue: nextSubStateValue,
          actions: nextSubActions,
          activities: nextSubActivities
        } = subStateTransition;
        if (nextSubActions) {
          if (nextSubActions.onEntry) {
            finalActions.onEntry.push(...nextSubActions.onEntry);
          }
          if (nextSubActions.actions) {
            finalActions.actions.push(...nextSubActions.actions);
          }
          if (nextSubActions.onExit) {
            finalActions.onExit.push(...nextSubActions.onExit);
          }
        }
        if (nextSubActivities) {
          Object.assign(finalActivities, nextSubActivities);
        }

        if (!nextSubStateValue) {
          return stateValue[key];
        }

        return nextSubStateValue;
      }
    );

    return {
      stateValue: finalStateValue,
      actions: finalActions,
      activities: finalActivities
    };
  }

  private next(
    event: Event,
    history?: StateValue,
    extendedState?: any
  ): StateTransition {
    const eventType = getEventType(event);
    const actionMap: ActionMap = { onEntry: [], onExit: [], actions: [] };
    const activityMap: ActivityMap = {};

    if (this.onExit) {
      actionMap.onExit = this.onExit;
    }
    if (this.activities) {
      this.activities.forEach(activity => {
        activityMap[getEventType(activity)] = false;
        actionMap.onExit = actionMap.onExit.concat(stop(activity));
      });
    }

    if (!this.on || !this.on[eventType]) {
      return {
        stateValue: undefined,
        actions: actionMap,
        activities: activityMap
      };
    }

    const transition = this.on[eventType] as Transition;
    let nextStateString: string | undefined;

    if (typeof transition === 'string') {
      nextStateString = transition;
    } else {
      const candidates = Array.isArray(transition)
        ? transition
        : Object.keys(transition).map(key => ({
            ...transition[key],
            target: key
          }));

      for (const candidate of candidates) {
        const {
          cond,
          actions: transitionActions
        } = candidate as TransitionConfig;
        const extendedStateObject = extendedState || {};
        const eventObject: EventObject =
          typeof event === 'string' || typeof event === 'number'
            ? { type: event }
            : event;
        if (!cond || cond(extendedStateObject, eventObject)) {
          nextStateString = candidate.target;
          if (transitionActions) {
            actionMap.actions = actionMap.actions.concat(transitionActions);
          }
          break;
        }
      }
    }

    if (!nextStateString) {
      return {
        stateValue: undefined,
        actions: actionMap,
        activities: activityMap
      };
    }

    const nextStatePath = toStatePath(nextStateString);
    let currentState = this.parent;
    let currentHistory = history;
    let currentPath = this.key;

    nextStatePath.forEach(subPath => {
      if (!currentState || !currentState.states) {
        throw new Error(`Unable to read '${subPath}'`);
      }

      if (subPath === HISTORY_KEY) {
        if (currentHistory) {
          subPath =
            typeof currentHistory === 'object'
              ? Object.keys(currentHistory)[0]
              : currentHistory;
        } else if (currentState.initial) {
          subPath = currentState.initial;
        } else {
          throw new Error(
            `Cannot read '${HISTORY_KEY}' from state '${
              currentState.id
            }': missing 'initial'`
          );
        }
      } else if (subPath === NULL_EVENT) {
        actionMap.onExit = [];
        currentState = currentState.states[this.key];
        return;
      }

      currentState = currentState.states[subPath];

      if (currentState === undefined) {
        throw new Error(
          `Event '${event}' on state '${
            currentPath
          }' leads to undefined state '${nextStatePath.join(STATE_DELIMITER)}'.`
        );
      }

      if (currentState.onEntry) {
        actionMap.onEntry = actionMap.onEntry.concat(currentState.onEntry);
      }
      if (currentState.activities) {
        currentState.activities.forEach(activity => {
          activityMap[getEventType(activity)] = true;
          actionMap.onEntry = actionMap.onEntry.concat(start(activity));
        });
      }

      currentPath = subPath;

      if (currentHistory) {
        currentHistory = currentHistory[subPath];
      }
    });

    if (!currentState) {
      throw new Error('no state');
    }

    while (currentState.initial) {
      if (!currentState || !currentState.states) {
        throw new Error(`Invalid initial state`);
      }
      currentState = currentState.states[currentState.initial];

      if (currentState.onEntry) {
        actionMap.onEntry = actionMap.onEntry.concat(currentState.onEntry);
      }
      if (currentState.activities) {
        currentState.activities.forEach(activity => {
          activityMap[getEventType(activity)] = true;
          actionMap.onEntry = actionMap.onEntry.concat(start(activity));
        });
      }
    }

    return {
      stateValue: currentState.getRelativeValue(this.parent),
      actions: actionMap,
      activities: activityMap
    };
  }
  private get initialStateValue(): StateValue | undefined {
    this.__cache.initialState =
      this.__cache.initialState ||
      ((this.parallel
        ? mapValues(
            this.states as Record<string, StateNode>,
            state => state.initialStateValue
          )
        : this.initial) as StateValue);

    return this.__cache.initialState;
  }
  public get initialState(): State {
    const { initialStateValue } = this;

    if (!initialStateValue) {
      throw new Error(
        `Cannot retrieve initial state from simple state '${this.id}.'`
      );
    }

    const entryActions = this.getStateNodes(initialStateValue).reduce(
      (actions, stateNode) =>
        stateNode.onEntry ? actions.concat(stateNode.onEntry) : actions,
      [] as Action[]
    );

    return new State(initialStateValue, undefined, entryActions);
  }
  public getStates(stateValue: StateValue): StateNode[] {
    if (typeof stateValue === 'string') {
      return [this.states[stateValue]];
    }

    const stateNodes: StateNode[] = [];

    Object.keys(stateValue).forEach(key => {
      stateNodes.push(...this.states[key].getStates(stateValue[key]));
    });

    return stateNodes;
  }
  public getState(relativeStateId: string | string[]): StateNode | undefined {
    const statePath = toStatePath(relativeStateId);

    try {
      return statePath.reduce(
        (subState, subPath) => {
          if (!subState.states) {
            throw new Error(
              `Cannot retrieve subPath '${subPath}' from node with no states`
            );
          }
          return subState.states[subPath];
        },
        this as StateNode
      );
    } catch (e) {
      throw new Error(
        `State '${relativeStateId} does not exist on machine '${this.id}'`
      );
    }
  }
  get events(): EventType[] {
    if (this.__cache.events) {
      return this.__cache.events;
    }
    const { states } = this;
    const events = new Set(this.on ? Object.keys(this.on) : undefined);

    if (states) {
      Object.keys(states).forEach(stateId => {
        const state = states[stateId];
        if (state.states) {
          for (const event of state.events) {
            events.add(`${event}`);
          }
        }
      });
    }

    return (this.__cache.events = Array.from(events));
  }
  private getRelativeValue(toNode?: StateNode): StateValue {
    const memoizedRelativeValue = toNode
      ? this.__cache.relativeValue.get(toNode)
      : undefined;

    if (memoizedRelativeValue) {
      return memoizedRelativeValue;
    }

    const initialStateValue = this.initialStateValue;
    let relativeValue = initialStateValue
      ? {
          [this.key]: initialStateValue
        }
      : this.key;
    let currentNode: StateNode = this.parent as StateNode;

    while (currentNode && currentNode !== toNode) {
      const currentInitialState = currentNode.initialStateValue;
      relativeValue = {
        [currentNode.key]:
          typeof currentInitialState === 'object' &&
          typeof relativeValue === 'object'
            ? { ...currentInitialState, ...relativeValue }
            : relativeValue
      };
      currentNode = currentNode.parent as StateNode;
    }

    this.__cache.relativeValue.set(toNode as StateNode, relativeValue);

    return relativeValue;
  }
}

export interface MachineFactory {
  (config: MachineConfig | ParallelMachineConfig):
    | StandardMachine
    | ParallelMachine;
  standard: (config: MachineConfig) => StandardMachine;
  parallel: (config: ParallelMachineConfig) => ParallelMachine;
}

export function Machine(
  config: MachineConfig | ParallelMachineConfig
): StandardMachine | ParallelMachine {
  return new StateNode(config) as StandardMachine | ParallelMachine;
}

export { StateNode, State, matchesState, mapState };
