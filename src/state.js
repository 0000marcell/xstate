
import Transition from './transition';
import difference from 'lodash/array/difference';
import unique from 'lodash/array/unique';
import isArray from 'lodash/lang/isArray';
import isString from 'lodash/lang/isString';
import find from 'lodash/collection/find';

import { parse } from './parser';
import Action from './action';

const STATE_DELIMITER = '.';

export default class State {
  constructor(data, parent = null) {
    data = isString(data)
      ? parse(data)
      : data;
      
    this.id = data.id || 'root';

    this._id = parent
      ? parent._id.concat(this.id)
      : [this.id];

    this.states = data.states
      ? data.states
        .map((state) => new State(state, this))
      : [];

    this.transitions = data.transitions
      ? data.transitions
        .map((transition) => new Transition(transition))
      : [];

    this.alphabet = this.getAlphabet();

    this.initial = !!data.initial;

    this.final = !!data.final;
  }

  mapStateRefs() {
    this.states = this.states.map((state) => {
      state.transitions = state.transitions.map((transition) => {
        transition.targetState = this.getState(transition.target);

        return Object.freeze(transition);
      });

      return state.mapStateRefs();
    });

    return Object.freeze(this);
  }

  relativeId(fromState = null) {
    return difference(this._id, fromState._id).join('.');
  }

  transition(fromState = null, action = null, returnFlag = true) {
    let substateIds = this.getSubstateIds(fromState);
    let initialStates = this.states
      .filter((state) => state.initial);
    let nextStates = [];
    let currentSubstate = substateIds.length
      ? this.getState(substateIds[0])
      : null;

    if (substateIds.length) {
      if (!currentSubstate) {
        return [];
      }

      nextStates = currentSubstate
        .transition(substateIds.slice(1), action, false);

      if (!nextStates.length) {
        nextStates = this.transitions
          .filter((transition) => transition.isValid(action))
          .map((transition) => transition.targetState.initialStates())
          .reduce((a, b) => a.concat(b), [])
      }
    } else if (initialStates.length) {
      nextStates = initialStates
        .map((state) => state.transition(null, action, false))
        .reduce((a, b) => a.concat(b), [])
    } else if (action) {
      nextStates = this.transitions
        .filter((transition) => transition.isValid(action))
        .map((transition) => transition.targetState.initialStates())
        .reduce((a, b) => a.concat(b), [])
    } else {
      nextStates = this.initialStates();
    }

    return returnFlag
      ? nextStates.map((state) => state.relativeId(this))
      : nextStates;
  }

  initialStates() {
    let _initialStates = this.states
      .filter((state) => state.initial);

    return _initialStates.length
      ? _initialStates.map((state) => state.initialStates())
        .reduce((a,b) => a.concat(b), [])
      : [this];
  }

  getSubstateIds(fromState) {
    if (!fromState) return [];

    if (fromState instanceof State) {
      return fromState._id;
    }

    fromState = fromState || [];

    return isArray(fromState)
      ? fromState
      : isString(fromState)
        ? fromState.split(STATE_DELIMITER)
        : false;
  }

  getState(substates) {
    if (substates instanceof State) {
      return substates;
    }

    substates = this.getSubstateIds(substates);

    if (!substates.length) {
      return this;
    }

    let substate = find(this.states,
      (state) => state.id === substates[0]);

    return substate
      ? substates.length > 1
        ? substate.getState(substates.slice(1))
        : substate
      : false;
  }

  getAlphabet() {
    return this.alphabet || unique(this.states
      .map((state) => state.getAlphabet())
      .concat(this.transitions
        .map((transition) => transition.event))
      .reduce((a,b) => a.concat(b), []));
  }

  isValidAction(action) {
    if (!action) return false;

    let actionType = (new Action(action)).type;

    return this.getAlphabet().indexOf(actionType) !== -1;
  }
}
