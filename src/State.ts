import {
  StateValue,
  ActivityMap,
  EventObject,
  StateInterface,
  HistoryValue,
  ActionObject,
  EventType,
  StateValueMap,
  StateConfig,
  ActionTypes,
  OmniEventObject,
  BuiltInEvent
} from './types';
import { EMPTY_ACTIVITY_MAP } from './constants';
import { matchesState, keys, isString } from './utils';
import { StateNode } from './StateNode';
import { nextEvents } from './stateUtils';

export function stateValuesEqual(
  a: StateValue | undefined,
  b: StateValue | undefined
): boolean {
  if (a === b) {
    return true;
  }

  if (a === undefined || b === undefined) {
    return false;
  }

  if (isString(a) || isString(b)) {
    return a === b;
  }

  const aKeys = keys(a as StateValueMap);
  const bKeys = keys(b as StateValueMap);

  return (
    aKeys.length === bKeys.length &&
    aKeys.every(key => stateValuesEqual(a[key], b[key]))
  );
}

export class State<TContext, TEvent extends EventObject = EventObject>
  implements StateInterface<TContext> {
  public value: StateValue;
  public context: TContext;
  public historyValue?: HistoryValue | undefined;
  public history?: State<TContext>;
  public actions: Array<ActionObject<TContext, TEvent>> = [];
  public activities: ActivityMap = EMPTY_ACTIVITY_MAP;
  public meta: any = {};
  public events: TEvent[] = [];
  public event: OmniEventObject<TEvent>;
  /**
   * Indicates whether the state has changed from the previous state. A state is considered "changed" if:
   *
   * - Its value is not equal to its previous value, or:
   * - It has any new actions (side-effects) to execute.
   *
   * An initial state (with no history) will return `undefined`.
   */
  public changed: boolean | undefined;
  /**
   * The state node tree representation of the state value.
   */
  public tree: Array<StateNode<TContext>>;
  /**
   * The next events that will cause a transition from the current state.
   */
  // @ts-ignore - getter for this gets configured in constructor so this property can stay non-enumerable
  public nextEvents: EventType[];
  /**
   * Creates a new State instance for the given `stateValue` and `context`.
   * @param stateValue
   * @param context
   */
  public static from<TC, TE extends EventObject = EventObject>(
    stateValue: State<TC, TE> | StateValue,
    context?: TC | undefined
  ): State<TC, TE> {
    if (stateValue instanceof State) {
      if (stateValue.context !== context) {
        return new State<TC, TE>({
          value: stateValue.value,
          context: context as TC,
          event: stateValue.event,
          historyValue: stateValue.historyValue,
          history: stateValue.history,
          actions: [],
          activities: stateValue.activities,
          meta: {},
          events: [],
          tree: [] // TODO: fix
        });
      }

      return stateValue;
    }

    const event = { type: ActionTypes.Init } as BuiltInEvent<TE>;

    return new State<TC, TE>({
      value: stateValue,
      context: context as TC,
      event,
      historyValue: undefined,
      history: undefined,
      actions: [],
      activities: undefined,
      meta: undefined,
      events: [],
      tree: [] // TODO: fix
    });
  }
  /**
   * Creates a new State instance for the given `config`.
   * @param config The state config
   */
  public static create<TC, TE extends EventObject = EventObject>(
    config: StateConfig<TC, TE>
  ): State<TC, TE> {
    return new State(config);
  }
  /**
   * Creates a new `State` instance for the given `stateValue` and `context` with no actions (side-effects).
   * @param stateValue
   * @param context
   */
  public static inert<TC, TE extends EventObject = EventObject>(
    stateValue: State<TC> | StateValue,
    context: TC
  ): State<TC, TE> {
    if (stateValue instanceof State) {
      if (!stateValue.actions.length) {
        return stateValue as State<TC, TE>;
      }
      const event = { type: ActionTypes.Init } as BuiltInEvent<TE>;

      return new State<TC, TE>({
        value: stateValue.value,
        context,
        event,
        historyValue: stateValue.historyValue,
        history: stateValue.history,
        activities: stateValue.activities,
        // @ts-ignore
        tree: stateValue.tree
      });
    }

    return State.from<TC, TE>(stateValue, context);
  }

  /**
   * Creates a new State instance.
   * @param value The state value
   * @param context The extended state
   * @param historyValue The tree representing historical values of the state nodes
   * @param history The previous state
   * @param actions An array of action objects to execute as side-effects
   * @param activities A mapping of activities and whether they are started (`true`) or stopped (`false`).
   * @param meta
   * @param events Internal event queue. Should be empty with run-to-completion semantics.
   * @param tree
   */
  constructor(config: StateConfig<TContext, TEvent>) {
    this.value = config.value;
    this.context = config.context;
    this.event = config.event;
    this.historyValue = config.historyValue;
    this.history = config.history;
    this.actions = config.actions || [];
    this.activities = config.activities || EMPTY_ACTIVITY_MAP;
    this.meta = config.meta || {};
    this.events = config.events || [];
    this.matches = this.matches.bind(this);
    this.toStrings = this.toStrings.bind(this);
    this.tree = config.tree || [];

    Object.defineProperty(this, 'nextEvents', {
      get: () => {
        return nextEvents(config.tree);
      }
    });
  }

  /**
   * Returns an array of all the string leaf state node paths.
   * @param stateValue
   * @param delimiter The character(s) that separate each subpath in the string state node path.
   */
  public toStrings(
    stateValue: StateValue = this.value,
    delimiter: string = '.'
  ): string[] {
    if (isString(stateValue)) {
      return [stateValue];
    }
    const valueKeys = keys(stateValue);

    return valueKeys.concat(
      ...valueKeys.map(key =>
        this.toStrings(stateValue[key]).map(s => key + delimiter + s)
      )
    );
  }

  public toJSON() {
    const { tree, ...jsonValues } = this;

    return jsonValues;
  }

  /**
   * Whether the current state value is a subset of the given parent state value.
   * @param parentStateValue
   */
  public matches(parentStateValue: StateValue): boolean {
    return matchesState(parentStateValue, this.value);
  }
}
