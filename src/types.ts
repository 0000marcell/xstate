import { StateNode } from "./index";
import State from "./State";

export type Action =
  | number
  | string
  | {
      type: string;
      [key: string]: any;
    };

// export type Condition

export type StateKey = string | State;

export interface StateValueMap {
  [key: string]: StateValue;
}

export type StateValue = string | StateValueMap;

export type Condition = (extendedState: any) => boolean;

export type Transition<TStateKey extends string = string> =
  | TStateKey
  | Record<TStateKey, Condition>;

export interface StateNodeConfig<
  TStateKey extends string = string,
  TActionType extends string = string
> {
  initial?: string;
  states?: Record<TStateKey, StateNodeConfig>;
  parallel?: boolean;
  key?: string;
  on?: Record<TActionType, Transition<TStateKey>>;
  parent?: StateNode;
}
