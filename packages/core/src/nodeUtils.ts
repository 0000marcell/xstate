import {
  toStatePath,
  toStatePaths,
  flatten,
  mapFilterValues,
  nestedPath,
  toArray,
  keys,
  warn,
  isArray,
  isFunction,
  isString,
  toGuard,
  isMachine,
  toTransitionConfigArray,
  normalizeTarget,
  toStateValue,
  mapContext,
  partition,
  updateContext,
  updateHistoryValue,
  mapValues
} from './utils';
import {
  StateValue,
  TransitionConfig,
  EventObject,
  HistoryValue,
  TransitionDefinition,
  DelayedTransitionDefinition,
  NullEvent,
  SingleOrArray,
  Typestate,
  DelayExpr,
  Guard,
  SCXML,
  GuardMeta,
  GuardPredicate,
  StateTransition,
  ActionObject,
  DoneEventObject,
  StateValueMap,
  AssignAction,
  RaiseAction,
  SendAction,
  LogAction,
  PureAction,
  RaiseActionObject,
  SendActionObject,
  SpecialTargets,
  ActivityActionObject
} from './types';
import { State, stateValuesEqual } from './State';
import {
  send,
  cancel,
  after,
  done,
  doneInvoke,
  error,
  toActionObjects,
  start,
  raise,
  stop,
  initEvent,
  actionTypes,
  resolveRaise,
  resolveSend,
  resolveLog,
  toActionObject
} from './actions';
import { IS_PRODUCTION } from './environment';
import {
  isLeafNode,
  getConfiguration,
  has,
  getChildren,
  isInFinalState,
  getValue
} from './stateUtils';
import { StateNode, NULL_EVENT, WILDCARD, STATE_IDENTIFIER } from './StateNode';
import { DEFAULT_GUARD_TYPE } from './constants';
import { createInvocableActor } from './Actor';

export const isStateId = (str: string) => str[0] === STATE_IDENTIFIER;

const validateArrayifiedTransitions = <TContext>(
  stateNode: StateNode<any, any, any>,
  event: string,
  transitions: Array<
    TransitionConfig<TContext, EventObject> & {
      event: string;
    }
  >
) => {
  const hasNonLastUnguardedTarget = transitions
    .slice(0, -1)
    .some(
      transition =>
        !('cond' in transition) &&
        !('in' in transition) &&
        (isString(transition.target) || isMachine(transition.target))
    );
  const eventText =
    event === NULL_EVENT ? 'the transient event' : `event '${event}'`;
  warn(
    !hasNonLastUnguardedTarget,
    `One or more transitions for ${eventText} on state '${stateNode.id}' are unreachable. ` +
      `Make sure that the default transition is the last one defined.`
  );
};
export function getCandidates<TEvent extends EventObject>(
  stateNode: StateNode<any, any, TEvent>,
  eventName: TEvent['type'] | NullEvent['type'] | '*'
) {
  if (stateNode.__cache.candidates[eventName]) {
    return stateNode.__cache.candidates[eventName];
  }
  const transient = eventName === NULL_EVENT;
  const candidates = stateNode.transitions.filter(transition => {
    const sameEventType = transition.eventType === eventName;
    // null events should only match against eventless transitions
    return transient
      ? sameEventType
      : sameEventType || transition.eventType === WILDCARD;
  }) as any;
  stateNode.__cache.candidates[eventName] = candidates;
  return candidates;
}
/**
 * All delayed transitions from the config.
 */
export function getDelayedTransitions<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>
): Array<DelayedTransitionDefinition<TContext, TEvent>> {
  const afterConfig = stateNode.config.after;
  if (!afterConfig) {
    return [];
  }
  const mutateEntryExit = (
    delay: string | number | DelayExpr<TContext, TEvent>,
    i: number
  ) => {
    const delayRef = isFunction(delay) ? `${stateNode.id}:delay[${i}]` : delay;
    const eventType = after(delayRef, stateNode.id);
    stateNode.entry.push(send(eventType, { delay }));
    stateNode.exit.push(cancel(eventType));
    return eventType;
  };
  const delayedTransitions = isArray(afterConfig)
    ? afterConfig.map((transition, i) => {
        const eventType = mutateEntryExit(transition.delay, i);
        return { ...transition, event: eventType };
      })
    : flatten(
        keys(afterConfig).map((delay, i) => {
          const configTransition = afterConfig[delay];
          const resolvedTransition = isString(configTransition)
            ? { target: configTransition }
            : configTransition;
          const resolvedDelay = !isNaN(+delay) ? +delay : delay;
          const eventType = mutateEntryExit(resolvedDelay, i);
          return toArray(resolvedTransition).map(transition => ({
            ...transition,
            event: eventType,
            delay: resolvedDelay
          }));
        })
      );
  return delayedTransitions.map(delayedTransition => {
    const { delay } = delayedTransition;
    return {
      ...formatTransition(stateNode, delayedTransition),
      delay
    };
  });
}
function formatTransition<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  transitionConfig: TransitionConfig<TContext, TEvent> & {
    event: TEvent['type'] | NullEvent['type'] | '*';
  }
): TransitionDefinition<TContext, TEvent> {
  const normalizedTarget = normalizeTarget(transitionConfig.target);
  const internal =
    'internal' in transitionConfig
      ? transitionConfig.internal
      : normalizedTarget
      ? normalizedTarget.some(
          _target => isString(_target) && _target[0] === stateNode.delimiter
        )
      : true;
  const { guards } = stateNode.machine.options;
  const target = resolveTarget(stateNode, normalizedTarget);
  return {
    ...transitionConfig,
    actions: toActionObjects(toArray(transitionConfig.actions)),
    cond: toGuard(transitionConfig.cond, guards),
    target,
    source: stateNode,
    internal,
    eventType: transitionConfig.event
  };
}
export function formatTransitions<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>
): Array<TransitionDefinition<TContext, TEvent>> {
  let onConfig: Array<
    TransitionConfig<TContext, EventObject> & {
      event: string;
    }
  >;
  if (!stateNode.config.on) {
    onConfig = [];
  } else if (Array.isArray(stateNode.config.on)) {
    onConfig = stateNode.config.on;
  } else {
    const {
      [WILDCARD]: wildcardConfigs = [],
      ...strictOnConfigs
    } = stateNode.config.on;
    onConfig = flatten(
      keys(strictOnConfigs)
        .map(key => {
          const arrayified = toTransitionConfigArray<TContext, EventObject>(
            key,
            strictOnConfigs![key as string]
          );
          if (!IS_PRODUCTION) {
            validateArrayifiedTransitions(stateNode, key, arrayified);
          }
          return arrayified;
        })
        .concat(
          toTransitionConfigArray(WILDCARD, wildcardConfigs as SingleOrArray<
            TransitionConfig<TContext, EventObject> & {
              event: '*';
            }
          >)
        )
    );
  }
  const doneConfig = stateNode.config.onDone
    ? toTransitionConfigArray(
        String(done(stateNode.id)),
        stateNode.config.onDone
      )
    : [];
  const invokeConfig = flatten(
    stateNode.invoke.map(invokeDef => {
      const settleTransitions: any[] = [];
      if (invokeDef.onDone) {
        settleTransitions.push(
          ...toTransitionConfigArray(
            String(doneInvoke(invokeDef.id)),
            invokeDef.onDone
          )
        );
      }
      if (invokeDef.onError) {
        settleTransitions.push(
          ...toTransitionConfigArray(
            String(error(invokeDef.id)),
            invokeDef.onError
          )
        );
      }
      return settleTransitions;
    })
  );
  const delayedTransitions = stateNode.after;
  const formattedTransitions = flatten(
    [...doneConfig, ...invokeConfig, ...onConfig].map(
      (
        transitionConfig: TransitionConfig<TContext, TEvent> & {
          event: TEvent['type'] | NullEvent['type'] | '*';
        }
      ) =>
        toArray(transitionConfig).map(transition =>
          formatTransition(stateNode, transition)
        )
    )
  );
  for (const delayedTransition of delayedTransitions) {
    formattedTransitions.push(delayedTransition as any);
  }
  return formattedTransitions;
}
function resolveTarget<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  _target: Array<string | StateNode<TContext, any, TEvent>> | undefined
): Array<StateNode<TContext, any, TEvent>> | undefined {
  if (_target === undefined) {
    // an undefined target signals that the state node should not transition from that state when receiving that event
    return undefined;
  }
  return _target.map(target => {
    if (!isString(target)) {
      return target;
    }
    const isInternalTarget = target[0] === stateNode.delimiter;
    // If internal target is defined on machine,
    // do not include machine key on target
    if (isInternalTarget && !stateNode.parent) {
      return getStateNodeByPath(stateNode, target.slice(1));
    }
    const resolvedTarget = isInternalTarget ? stateNode.key + target : target;
    if (stateNode.parent) {
      try {
        const targetStateNode = getStateNodeByPath(
          stateNode.parent,
          resolvedTarget
        );
        return targetStateNode;
      } catch (err) {
        throw new Error(
          `Invalid transition definition for state node '${stateNode.id}':\n${err.message}`
        );
      }
    } else {
      return getStateNodeByPath(stateNode, resolvedTarget);
    }
  });
}
/**
 * Resolves to the historical value(s) of the parent state node,
 * represented by state nodes.
 *
 * @param historyValue
 */
function resolveHistory<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  historyValue?: HistoryValue
): Array<StateNode<TContext, any, TEvent>> {
  if (stateNode.type !== 'history') {
    return [stateNode];
  }
  const parent = stateNode.parent!;
  if (!historyValue) {
    const historyTarget = stateNode.target;
    return historyTarget
      ? flatten(
          toStatePaths(historyTarget).map(relativeChildPath =>
            getFromRelativePath(parent, relativeChildPath)
          )
        )
      : getInitialStateNodes(parent);
  }
  const subHistoryValue = nestedPath<HistoryValue>(parent.path, 'states')(
    historyValue
  ).current;
  if (isString(subHistoryValue)) {
    return [getStateNode(parent, subHistoryValue)];
  }
  return flatten(
    toStatePaths(subHistoryValue!).map(subStatePath => {
      return stateNode.history === 'deep'
        ? getFromRelativePath(parent, subStatePath)
        : [parent.states[subStatePath[0]]];
    })
  );
}
export function getHistoryValue<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  relativeStateValue?: StateValue | undefined
): HistoryValue | undefined {
  if (!keys(stateNode.states).length) {
    return undefined;
  }
  return {
    current: relativeStateValue || stateNode.initialStateValue,
    states: mapFilterValues<
      StateNode<TContext, any, TEvent>,
      HistoryValue | undefined
    >(
      stateNode.states,
      (childNode, key) => {
        if (!relativeStateValue) {
          return getHistoryValue(childNode);
        }
        const subStateValue = isString(relativeStateValue)
          ? undefined
          : relativeStateValue[key];
        return getHistoryValue(
          childNode,
          subStateValue || childNode.initialStateValue
        );
      },
      childNode => !childNode.history
    )
  };
}
/**
 * Retrieves state nodes from a relative path to the state node.
 *
 * @param relativePath The relative path from the state node
 * @param historyValue
 */
function getFromRelativePath<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  relativePath: string[]
): Array<StateNode<TContext, any, TEvent>> {
  if (!relativePath.length) {
    return [stateNode];
  }
  const [stateKey, ...childStatePath] = relativePath;
  if (!stateNode.states) {
    throw new Error(
      `Cannot retrieve subPath '${stateKey}' from node with no states`
    );
  }
  const childStateNode = getStateNode(stateNode, stateKey);
  if (childStateNode.type === 'history') {
    return resolveHistory(childStateNode);
  }
  if (!stateNode.states[stateKey]) {
    throw new Error(
      `Child state '${stateKey}' does not exist on '${stateNode.id}'`
    );
  }
  return getFromRelativePath(stateNode.states[stateKey], childStatePath);
}
/**
 * Returns the leaf nodes from a state path relative to the state node.
 *
 * @param relativeStateNode The relative state node to retrieve the state nodes
 * @param history The previous state to retrieve history
 * @param resolveInitialStateNodes Whether state nodes should resolve to initial child state nodes
 */
export function getRelativeStateNodes<TContext, TEvent extends EventObject>(
  relativeStateNode: StateNode<TContext, any, TEvent>,
  historyValue?: HistoryValue,
  resolveInitialStateNodes: boolean = true
): Array<StateNode<TContext, any, TEvent>> {
  return resolveInitialStateNodes
    ? relativeStateNode.type === 'history'
      ? resolveHistory(relativeStateNode, historyValue)
      : getInitialStateNodes(relativeStateNode)
    : [relativeStateNode];
}
export function getInitialStateNodes<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>
): Array<StateNode<TContext, any, TEvent>> {
  if (isLeafNode(stateNode)) {
    return [stateNode];
  }
  // Case when state node is compound but no initial state is defined
  if (stateNode.type === 'compound' && !stateNode.initial) {
    if (!IS_PRODUCTION) {
      warn(
        false,
        `Compound state node '${stateNode.id}' has no initial state.`
      );
    }
    return [stateNode];
  }
  const initialStateNodePaths = toStatePaths(stateNode.initialStateValue!);
  return flatten(
    initialStateNodePaths.map(initialPath =>
      getFromRelativePath(stateNode, initialPath)
    )
  );
}
export function getInitialState<
  TContext,
  TStateSchema,
  TEvent extends EventObject,
  TTypestate extends Typestate<TContext>
>(
  stateNode: StateNode<TContext, TStateSchema, TEvent>,
  stateValue: StateValue,
  context?: TContext
): State<TContext, TEvent, TStateSchema, TTypestate> {
  const configuration = getStateNodes(stateNode, stateValue);
  return resolveTransition(
    stateNode,
    {
      configuration,
      entrySet: configuration,
      exitSet: [],
      transitions: [],
      source: undefined,
      actions: []
    },
    undefined,
    undefined,
    context
  );
}
/**
 * Returns the child state node from its relative `stateKey`, or throws.
 */
export function getStateNode<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  stateKey: string
): StateNode<TContext, any, TEvent> {
  if (isStateId(stateKey)) {
    return getStateNodeById(stateNode.machine, stateKey);
  }
  if (!stateNode.states) {
    throw new Error(
      `Unable to retrieve child state '${stateKey}' from '${stateNode.id}'; no child states exist.`
    );
  }
  const result = stateNode.states[stateKey];
  if (!result) {
    throw new Error(
      `Child state '${stateKey}' does not exist on '${stateNode.id}'`
    );
  }
  return result;
}
/**
 * Returns the state node with the given `stateId`, or throws.
 *
 * @param stateId The state ID. The prefix "#" is removed.
 */
export function getStateNodeById<TContext, TEvent extends EventObject>(
  fromStateNode: StateNode<TContext, any, TEvent>,
  stateId: string
): StateNode<TContext, any, TEvent> {
  const resolvedStateId = isStateId(stateId)
    ? stateId.slice(STATE_IDENTIFIER.length)
    : stateId;
  if (resolvedStateId === fromStateNode.id) {
    return fromStateNode;
  }
  const stateNode = fromStateNode.machine.idMap[resolvedStateId];
  if (!stateNode) {
    throw new Error(
      `Child state node '#${resolvedStateId}' does not exist on machine '${fromStateNode.id}'`
    );
  }
  return stateNode;
}
/**
 * Returns the relative state node from the given `statePath`, or throws.
 *
 * @param statePath The string or string array relative path to the state node.
 */
function getStateNodeByPath<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  statePath: string | string[]
): StateNode<TContext, any, TEvent> {
  if (typeof statePath === 'string' && isStateId(statePath)) {
    try {
      return getStateNodeById(stateNode, statePath.slice(1));
    } catch (e) {
      // try individual paths
      // throw e;
    }
  }
  const arrayStatePath = toStatePath(statePath, stateNode.delimiter).slice();
  let currentStateNode: StateNode<TContext, any, TEvent> = stateNode;
  while (arrayStatePath.length) {
    const key = arrayStatePath.shift()!;
    if (!key.length) {
      break;
    }
    currentStateNode = getStateNode(currentStateNode, key);
  }
  return currentStateNode;
}

/**
 * Returns the state nodes represented by the current state value.
 *
 * @param state The state value or State instance
 */
export function getStateNodes<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  state: StateValue | State<TContext, TEvent>
): Array<StateNode<TContext, any, TEvent>> {
  if (!state) {
    return [];
  }
  const stateValue =
    state instanceof State
      ? state.value
      : toStateValue(state, stateNode.machine.delimiter);

  if (isString(stateValue)) {
    const initialStateValue = getStateNode(stateNode, stateValue).initial;

    return initialStateValue !== undefined
      ? getStateNodes(stateNode, {
          [stateValue]: initialStateValue
        } as StateValue)
      : [stateNode.states[stateValue]];
  }

  const subStateKeys = keys(stateValue);
  const subStateNodes: Array<
    StateNode<TContext, any, TEvent>
  > = subStateKeys.map(subStateKey => getStateNode(stateNode, subStateKey));

  return subStateNodes.concat(
    subStateKeys.reduce(
      (allSubStateNodes, subStateKey) => {
        const subStateNode = getStateNodes(
          getStateNode(stateNode, subStateKey),
          stateValue[subStateKey]
        );

        return allSubStateNodes.concat(subStateNode);
      },
      [] as Array<StateNode<TContext, any, TEvent>>
    )
  );
}

export function nodesFromChild<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  childStateNode: StateNode<TContext, any, TEvent>
): Array<StateNode<TContext, any, TEvent>> {
  if (escapes(childStateNode, stateNode)) {
    return [];
  }

  const nodes: Array<StateNode<TContext, any, TEvent>> = [];
  let marker: StateNode<TContext, any, TEvent> | undefined = childStateNode;

  while (marker && marker !== stateNode) {
    nodes.push(marker);
    marker = marker.parent;
  }
  nodes.push(stateNode); // inclusive

  return nodes;
}

/**
 * Whether the given state node "escapes" the state node. If the `stateNode` is equal to or the parent of
 * the state node, it does not escape.
 */
export function escapes<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  escapeeNode: StateNode<TContext, any, TEvent>
): boolean {
  if (stateNode === escapeeNode) {
    return false;
  }

  let parent = stateNode.parent;

  while (parent) {
    if (parent === escapeeNode) {
      return false;
    }
    parent = parent.parent;
  }

  return true;
}

export function evaluateGuard<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  guard: Guard<TContext, TEvent>,
  context: TContext,
  _event: SCXML.Event<TEvent>,
  state: State<TContext, TEvent>
): boolean {
  const { guards } = stateNode.machine.options;
  const guardMeta: GuardMeta<TContext, TEvent> = {
    state,
    cond: guard,
    _event
  };

  if (guard.type === DEFAULT_GUARD_TYPE) {
    return (guard as GuardPredicate<TContext, TEvent>).predicate(
      context,
      _event.data,
      guardMeta
    );
  }

  const condFn = guards[guard.type];

  if (!condFn) {
    throw new Error(
      `Guard '${guard.type}' is not implemented on machine '${stateNode.machine.id}'.`
    );
  }

  return condFn(context, _event.data, guardMeta);
}

export function getActions<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  transition: StateTransition<TContext, TEvent>,
  currentContext: TContext,
  _event: SCXML.Event<TEvent>,
  prevState?: State<TContext>
): Array<ActionObject<TContext, TEvent>> {
  const prevConfig = getConfiguration(
    [],
    prevState ? getStateNodes(stateNode, prevState.value) : [stateNode]
  );
  const resolvedConfig = transition.configuration.length
    ? getConfiguration(prevConfig, transition.configuration)
    : prevConfig;

  for (const sn of resolvedConfig) {
    if (!has(prevConfig, sn)) {
      transition.entrySet.push(sn);
    }
  }
  for (const sn of prevConfig) {
    if (!has(resolvedConfig, sn) || has(transition.exitSet, sn.parent)) {
      transition.exitSet.push(sn);
    }
  }

  if (!transition.source) {
    transition.exitSet = [];

    // Ensure that root StateNode (machine) is entered
    transition.entrySet.push(stateNode);
  }

  const doneEvents = flatten(
    transition.entrySet.map(sn => {
      const events: DoneEventObject[] = [];

      if (sn.type !== 'final') {
        return events;
      }

      const parent = sn.parent!;

      events.push(
        done(sn.id, sn.data), // TODO: deprecate - final states should not emit done events for their own state.
        done(
          parent.id,
          sn.data ? mapContext(sn.data, currentContext, _event) : undefined
        )
      );

      if (parent.parent) {
        const grandparent = parent.parent;

        if (grandparent.type === 'parallel') {
          if (
            getChildren(grandparent).every(parentNode =>
              isInFinalState(transition.configuration, parentNode)
            )
          ) {
            events.push(done(grandparent.id, grandparent.data));
          }
        }
      }

      return events;
    })
  );

  transition.exitSet.sort((a, b) => b.order - a.order);
  transition.entrySet.sort((a, b) => a.order - b.order);

  const entryStates = new Set(transition.entrySet);
  const exitStates = new Set(transition.exitSet);

  const [entryActions, exitActions] = [
    flatten(
      Array.from(entryStates).map(entryNode => {
        return [
          ...entryNode.activities.map(activity => start(activity)),
          ...entryNode.entry
        ];
      })
    ).concat(doneEvents.map(raise) as Array<ActionObject<TContext, TEvent>>),
    flatten(
      Array.from(exitStates).map(exitNode => [
        ...exitNode.exit,
        ...exitNode.activities.map(activity => stop(activity))
      ])
    )
  ];

  const actions = toActionObjects(
    exitActions.concat(transition.actions).concat(entryActions),
    stateNode.machine.options.actions
  ) as Array<ActionObject<TContext, TEvent>>;

  return actions;
}

export function transitionLeafNode<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  stateValue: string,
  state: State<TContext, TEvent>,
  _event: SCXML.Event<TEvent>
): StateTransition<TContext, TEvent> | undefined {
  const ancestorStateNode = getStateNode(stateNode, stateValue);
  const next = ancestorStateNode.next(state, _event);

  if (!next || !next.transitions.length) {
    return stateNode.next(state, _event);
  }

  return next;
}

export function transitionCompoundNode<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  stateValue: StateValueMap,
  state: State<TContext, TEvent>,
  _event: SCXML.Event<TEvent>
): StateTransition<TContext, TEvent> | undefined {
  const subStateKeys = keys(stateValue);

  const childStateNode = getStateNode(stateNode, subStateKeys[0]);
  const next = transitionNode(
    childStateNode,
    stateValue[subStateKeys[0]],
    state,
    _event
  );

  if (!next || !next.transitions.length) {
    return stateNode.next(state, _event);
  }

  return next;
}
export function transitionParallelNode<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  stateValue: StateValueMap,
  state: State<TContext, TEvent>,
  _event: SCXML.Event<TEvent>
): StateTransition<TContext, TEvent> | undefined {
  const transitionMap: Record<string, StateTransition<TContext, TEvent>> = {};

  for (const subStateKey of keys(stateValue)) {
    const subStateValue = stateValue[subStateKey];

    if (!subStateValue) {
      continue;
    }

    const subStateNode = getStateNode(stateNode, subStateKey);
    const next = transitionNode(subStateNode, subStateValue, state, _event);
    if (next) {
      transitionMap[subStateKey] = next;
    }
  }

  const stateTransitions = keys(transitionMap).map(key => transitionMap[key]);
  const enabledTransitions = flatten(
    stateTransitions.map(st => st.transitions)
  );

  const willTransition = stateTransitions.some(st => st.transitions.length > 0);

  if (!willTransition) {
    return stateNode.next(state, _event);
  }
  const entryNodes = flatten(stateTransitions.map(t => t.entrySet));

  const configuration = flatten(
    keys(transitionMap).map(key => transitionMap[key].configuration)
  );

  return {
    transitions: enabledTransitions,
    entrySet: entryNodes,
    exitSet: flatten(stateTransitions.map(t => t.exitSet)),
    configuration,
    source: state,
    actions: flatten(
      keys(transitionMap).map(key => {
        return transitionMap[key].actions;
      })
    )
  };
}

export function transitionNode<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  stateValue: StateValue,
  state: State<TContext, TEvent>,
  _event: SCXML.Event<TEvent>
): StateTransition<TContext, TEvent> | undefined {
  // leaf node
  if (isString(stateValue)) {
    return transitionLeafNode(stateNode, stateValue, state, _event);
  }

  // hierarchical node
  if (keys(stateValue).length === 1) {
    return transitionCompoundNode(stateNode, stateValue, state, _event);
  }

  // orthogonal node
  return transitionParallelNode(stateNode, stateValue, state, _event);
}

export function resolveRaisedTransition<
  TContext,
  TEvent extends EventObject,
  TTypestate extends Typestate<TContext>
>(
  stateNode: StateNode<TContext, any, TEvent>,
  state: State<TContext, TEvent, any, TTypestate>,
  _event: SCXML.Event<TEvent> | NullEvent,
  originalEvent: SCXML.Event<TEvent>
): State<TContext, TEvent, any, TTypestate> {
  const currentActions = state.actions;

  state = stateNode.transition(state, _event as SCXML.Event<TEvent>);
  // Save original event to state
  state._event = originalEvent;
  state.event = originalEvent.data;
  state.actions.unshift(...currentActions);
  return state;
}

export function resolveTransition<
  TContext,
  TEvent extends EventObject,
  TTypestate extends Typestate<TContext>
>(
  stateNode: StateNode<TContext, any, TEvent>,
  stateTransition: StateTransition<TContext, TEvent>,
  currentState?: State<TContext, TEvent>,
  _event: SCXML.Event<TEvent> = initEvent as SCXML.Event<TEvent>,
  context: TContext = stateNode.machine.context!
): State<TContext, TEvent, any, TTypestate> {
  const { configuration } = stateTransition;
  // Transition will "apply" if:
  // - the state node is the initial state (there is no current state)
  // - OR there are transitions
  const willTransition =
    !currentState || stateTransition.transitions.length > 0;
  const resolvedStateValue = willTransition
    ? getValue(stateNode.machine, configuration)
    : undefined;
  const historyValue = currentState
    ? currentState.historyValue
      ? currentState.historyValue
      : stateTransition.source
      ? getHistoryValue(stateNode.machine, currentState.value)
      : undefined
    : undefined;
  const currentContext = currentState ? currentState.context : context;
  const actions = getActions(
    stateNode,
    stateTransition,
    currentContext,
    _event,
    currentState
  );

  const [assignActions, otherActions] = partition(
    actions,
    (action): action is AssignAction<TContext, TEvent> =>
      action.type === actionTypes.assign
  );

  const updatedContext = assignActions.length
    ? updateContext(currentContext, _event, assignActions, currentState)
    : currentContext;

  const resolvedActions = flatten(
    otherActions.map(actionObject => {
      switch (actionObject.type) {
        case actionTypes.raise:
          return resolveRaise(actionObject as RaiseAction<TEvent>);
        case actionTypes.send:
          const sendAction = resolveSend(
            actionObject as SendAction<TContext, TEvent>,
            updatedContext,
            _event,
            stateNode.machine.options.delays
          ) as ActionObject<TContext, TEvent>; // TODO: fix ActionTypes.Init

          if (!IS_PRODUCTION) {
            // warn after resolving as we can create better contextual message here
            warn(
              !isString(actionObject.delay) ||
                typeof sendAction.delay === 'number',
              // tslint:disable-next-line:max-line-length
              `No delay reference for delay expression '${actionObject.delay}' was found on machine '${stateNode.machine.id}'`
            );
          }

          return sendAction;
        case actionTypes.log:
          return resolveLog(
            actionObject as LogAction<TContext, TEvent>,
            updatedContext,
            _event
          );
        case actionTypes.pure:
          return (
            (actionObject as PureAction<TContext, TEvent>).get(
              updatedContext,
              _event.data
            ) || []
          );
        default:
          return toActionObject(
            actionObject,
            stateNode.machine.options.actions
          );
      }
    })
  );

  const [raisedEvents, nonRaisedActions] = partition(
    resolvedActions,
    (
      action
    ): action is
      | RaiseActionObject<TEvent>
      | SendActionObject<TContext, TEvent> =>
      action.type === actionTypes.raise ||
      (action.type === actionTypes.send &&
        (action as SendActionObject<TContext, TEvent>).to ===
          SpecialTargets.Internal)
  );

  let children = currentState ? currentState.children : [];
  for (const action of resolvedActions) {
    if (action.type === actionTypes.start) {
      children.push(createInvocableActor((action as any).actor));
    } else if (action.type === actionTypes.stop) {
      children = children.filter(childActor => {
        return (
          childActor.id !==
          (action as ActivityActionObject<TContext, TEvent>).actor.id
        );
      });
    }
  }

  const resolvedConfiguration = resolvedStateValue
    ? stateTransition.configuration
    : currentState
    ? currentState.configuration
    : [];

  const meta = resolvedConfiguration.reduce(
    (acc, subStateNode) => {
      if (subStateNode.meta !== undefined) {
        acc[subStateNode.id] = subStateNode.meta;
      }
      return acc;
    },
    {} as Record<string, string>
  );

  const isDone = isInFinalState(resolvedConfiguration, stateNode);

  const nextState = new State<TContext, TEvent, any, TTypestate>({
    value: resolvedStateValue || currentState!.value,
    context: updatedContext,
    _event,
    // Persist _sessionid between states
    _sessionid: currentState ? currentState._sessionid : null,
    historyValue: resolvedStateValue
      ? historyValue
        ? updateHistoryValue(historyValue, resolvedStateValue)
        : undefined
      : currentState
      ? currentState.historyValue
      : undefined,
    history:
      !resolvedStateValue || stateTransition.source ? currentState : undefined,
    actions: resolvedStateValue ? nonRaisedActions : [],
    meta: resolvedStateValue
      ? meta
      : currentState
      ? currentState.meta
      : undefined,
    events: [],
    configuration: resolvedConfiguration,
    transitions: stateTransition.transitions,
    children,
    done: isDone
  });

  nextState.changed =
    _event.name === actionTypes.update || !!assignActions.length;

  // Dispose of penultimate histories to prevent memory leaks
  const { history } = nextState;
  if (history) {
    delete history.history;
  }

  if (!resolvedStateValue) {
    return nextState;
  }

  let maybeNextState = nextState;

  if (!isDone) {
    const isTransient =
      stateNode._transient || configuration.some(sn => sn._transient);

    if (isTransient) {
      maybeNextState = resolveRaisedTransition(
        stateNode,
        maybeNextState,
        {
          type: actionTypes.nullEvent
        },
        _event
      );
    }

    while (raisedEvents.length) {
      const raisedEvent = raisedEvents.shift()!;
      maybeNextState = resolveRaisedTransition(
        stateNode,
        maybeNextState,
        raisedEvent._event,
        _event
      );
    }
  }

  // Detect if state changed
  const changed =
    maybeNextState.changed ||
    (history
      ? !!maybeNextState.actions.length ||
        !!assignActions.length ||
        typeof history.value !== typeof maybeNextState.value ||
        !stateValuesEqual(maybeNextState.value, history.value)
      : undefined);

  maybeNextState.changed = changed;

  // TODO: remove children if they are stopped
  maybeNextState.children = children;

  // Preserve original history after raised events
  maybeNextState.historyValue = nextState.historyValue;
  maybeNextState.history = history;

  return maybeNextState;
}

/**
 * Resolves a partial state value with its full representation in the state node's machine.
 *
 * @param stateValue The partial state value to resolve.
 */
export function resolveStateValue<TContext, TEvent extends EventObject>(
  stateNode: StateNode<TContext, any, TEvent>,
  stateValue: StateValue
): StateValue {
  if (!stateValue) {
    return stateNode.initialStateValue || {};
  }

  switch (stateNode.type) {
    case 'parallel':
      return mapValues(
        stateNode.initialStateValue as Record<string, StateValue>,
        (subStateValue, subStateKey) => {
          return subStateValue
            ? resolveStateValue(
                getStateNode(stateNode, subStateKey),
                stateValue[subStateKey] || subStateValue
              )
            : {};
        }
      );

    case 'compound':
      if (isString(stateValue)) {
        const subStateNode = getStateNode(stateNode, stateValue);

        if (
          subStateNode.type === 'parallel' ||
          subStateNode.type === 'compound'
        ) {
          return { [stateValue]: subStateNode.initialStateValue! };
        }

        return stateValue;
      }
      if (!keys(stateValue).length) {
        return stateNode.initialStateValue || {};
      }

      return mapValues(stateValue, (subStateValue, subStateKey) => {
        return subStateValue
          ? resolveStateValue(
              getStateNode(stateNode, subStateKey),
              subStateValue
            )
          : {};
      });

    default:
      return stateValue || {};
  }
}
