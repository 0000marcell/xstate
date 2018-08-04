import { StateNode } from './StateNode';
import { State } from './State';
import { AssignAction } from './actions';

export type EventType = string | number;
export type ActionType = string | number;
export type MetaObject = Record<string, any>;

export interface EventObject {
  type: EventType;
  id?: string | number;
  [key: string]: any;
}
export interface ActionObject extends Record<string, any> {
  type: EventType;
}

export type DefaultExtState = Record<string, any> | undefined;

export type Event = EventType | EventObject;
export type InternalEvent = EventType | EventObject;
export type ActionFunction = ((
  extendedState: any,
  event?: EventObject
) => any | void);
export type InternalAction<TExtState = DefaultExtState> =
  | SendAction
  | AssignAction<TExtState>;
export type Action<TExtState = DefaultExtState> =
  | ActionType
  | ActionObject
  | InternalAction<TExtState>
  | ActionFunction;
export type StateKey = string | State<any>;

export interface StateValueMap {
  [key: string]: StateValue;
}

export type StateValue = string | StateValueMap;

export interface HistoryValue {
  states: Record<string, HistoryValue | undefined>;
  current: StateValue | undefined;
}

export type ConditionPredicate = (
  extendedState: any,
  event: EventObject,
  microstepState: StateValue
) => boolean;

export type Condition = string | ConditionPredicate;

export interface TransitionConfig<TExtState = DefaultExtState> {
  cond?: Condition;
  actions?: Array<Action<TExtState>>;
  in?: StateValue;
  internal?: boolean;
  target?: string | string[];
}

export interface TargetTransitionConfig<TExtState = DefaultExtState>
  extends TransitionConfig<TExtState> {
  target: string | string[] | undefined;
}

export type ConditionalTransitionConfig<TExtState = DefaultExtState> = Array<
  TransitionConfig<TExtState>
>;

export type Transition<TExtState = DefaultExtState> =
  | string
  | Record<string, TransitionConfig<TExtState>>
  | ConditionalTransitionConfig<TExtState>;

export type Activity = string | ActionObject;

export interface StateNodeConfig<TExtState = DefaultExtState> {
  key?: string;
  initial?: string | undefined;
  parallel?: boolean | undefined;
  /**
   * Indicates whether the state node is a history state node, and what
   * type of history:
   * shallow, deep, true (shallow), false (none), undefined (none)
   */
  history?: 'shallow' | 'deep' | boolean | undefined;
  states?:
    | Record<string, SimpleOrCompoundStateNodeConfig<TExtState>>
    | undefined;
  on?: Record<string, Transition<TExtState> | undefined>;
  onEntry?: Action<TExtState> | Array<Action<TExtState>>;
  onExit?: Action<TExtState> | Array<Action<TExtState>>;
  activities?: Activity[];
  parent?: StateNode;
  strict?: boolean | undefined;
  data?: object | undefined;
  id?: string | undefined;
  delimiter?: string;
}
export interface SimpleStateNodeConfig<TExtState>
  extends StateNodeConfig<TExtState> {
  initial?: undefined;
  parallel?: false | undefined;
  states?: undefined;
}

export interface HistoryStateNodeConfig<TExtState = DefaultExtState>
  extends SimpleStateNodeConfig<TExtState> {
  history: 'shallow' | 'deep' | true;
  target: StateValue | undefined;
}

export interface CompoundStateNodeConfig<TExtState = DefaultExtState>
  extends StateNodeConfig<TExtState> {
  initial?: string;
  parallel?: boolean;
  states: Record<string, SimpleOrCompoundStateNodeConfig<TExtState>>;
  history?: false | undefined;
}

export type SimpleOrCompoundStateNodeConfig<TExtState = DefaultExtState> =
  | CompoundStateNodeConfig<TExtState>
  | SimpleStateNodeConfig<TExtState>;

export interface MachineOptions {
  guards?: Record<string, ConditionPredicate>;
  actions?: Record<string, ActionObject | ActionFunction>;
}
export interface MachineConfig<TExtState = DefaultExtState>
  extends CompoundStateNodeConfig<TExtState> {
  key?: string;
  strict?: boolean;
  history?: false | undefined;
}
export interface StandardMachineConfig<TExtState = DefaultExtState>
  extends MachineConfig<TExtState> {
  initial: string;
  parallel?: false | undefined;
}

export interface ParallelMachineConfig<TExtState = DefaultExtState>
  extends MachineConfig<TExtState> {
  initial?: undefined;
  parallel: true;
}

export interface EntryExitEffectMap<TExtState = DefaultExtState> {
  entry: Array<Action<TExtState>>;
  exit: Array<Action<TExtState>>;
}

// export interface IStateNode<TExtState = DefaultExtState> {
//   key: string;
//   id: string;
//   initial: string | undefined;
//   parallel: boolean;
//   transient: boolean;
//   history: false | 'shallow' | 'deep';
//   states: Record<string, IStateNode<TExtState = DefaultExtState>>;
//   on?: Record<string, Transition<TExtState = DefaultExtState>>;
//   onEntry?: Action | Action[];
//   onExit?: Action | Action[];
//   parent: StateNode | undefined;
//   machine: Machine;
//   config: StateNodeConfig<TExtState = DefaultExtState>;
// }

export interface ComplexStateNode extends StateNode {
  initial: string;
  history: false;
}

export interface LeafStateNode extends StateNode {
  initial: never;
  parallel: never;
  states: never;
  parent: StateNode;
}

export interface HistoryStateNode extends StateNode {
  history: 'shallow' | 'deep';
  target: StateValue | undefined;
}

export interface Machine<TExtState = DefaultExtState>
  extends StateNode<TExtState> {
  id: string;
  initial: string | undefined;
  parallel: boolean;
  states: Record<string, StateNode<TExtState>>;
}

export interface StandardMachine<TExtState = DefaultExtState>
  extends Machine<TExtState> {
  initial: string;
  parallel: false;
}

export interface ParallelMachine<TExtState = DefaultExtState>
  extends Machine<TExtState> {
  initial: undefined;
  parallel: true;
}
export interface ActionMap<TExtState = DefaultExtState> {
  onEntry: Array<Action<TExtState>>;
  actions: Array<Action<TExtState>>;
  onExit: Array<Action<TExtState>>;
}

export interface EntryExitStates {
  entry: Set<StateNode>;
  exit: Set<StateNode>;
}

export interface ActivityMap {
  [activityKey: string]: boolean;
}
export type MaybeStateValueActionsTuple<TExtState = DefaultExtState> = [
  StateValue | undefined,
  ActionMap<TExtState>,
  ActivityMap | undefined
];

// tslint:disable-next-line:class-name
export interface StateTransition<TExtState = DefaultExtState> {
  value: StateValue | undefined;
  entryExitStates: EntryExitStates | undefined;
  actions: Array<Action<TExtState>>;
  paths: string[][];
}

export interface TransitionData<TExtState = DefaultExtState> {
  value: StateValue | undefined;
  actions: ActionMap<TExtState>;
  activities?: ActivityMap;
}

export interface ActivityAction extends ActionObject {
  activity: ActionType;
  data: {
    type: ActionType;
    [key: string]: any;
  };
  command?: ActionFunction;
}

export interface SendAction extends ActionObject {
  event: EventObject;
  delay?: number;
  id: string | number;
}
export interface SendActionOptions {
  delay?: number;
  id?: string | number;
}

export interface CancelAction extends ActionObject {
  sendId: string | number;
}

export interface Edge<TExtState = DefaultExtState> {
  event: string;
  source: StateNode;
  target: StateNode;
  cond?: Condition;
  actions: Array<Action<TExtState>>;
  meta?: MetaObject;
}
export interface NodesAndEdges<TExtState = DefaultExtState> {
  nodes: StateNode[];
  edges: Array<Edge<TExtState>>;
}

export interface Segment {
  /**
   * From state
   */
  state: StateValue;
  /**
   * Event from state
   */
  event: Event;
}

export interface PathMap {
  [key: string]: Segment[];
}

export interface PathItem {
  state: StateValue;
  path: Segment[];
}

export interface PathsItem {
  state: StateValue;
  paths: Segment[][];
}

export interface PathsMap {
  [key: string]: Segment[][];
}

export interface TransitionMap {
  state: StateValue | undefined;
}

export interface AdjacencyMap {
  [stateId: string]: Record<string, TransitionMap>;
}

export interface StateInterface<TExtState = DefaultExtState> {
  value: StateValue;
  history?: State<TExtState>;
  actions: Array<Action<TExtState>>;
  activities: ActivityMap;
  data: Record<string, any>;
  events: EventObject[];
  ext?: TExtState;
}
