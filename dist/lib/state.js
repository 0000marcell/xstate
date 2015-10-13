'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _slicedToArray = (function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i['return']) _i['return'](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError('Invalid attempt to destructure non-iterable instance'); } }; })();

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _transition = require('./transition');

var _transition2 = _interopRequireDefault(_transition);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var STATE_DELIMITER = '.';

Array.prototype.log = function (msg) {
  console.log(msg, this);

  return this;
};

var State = (function () {
  function State(data) {
    var _this = this;

    var parent = arguments.length <= 1 || arguments[1] === undefined ? null : arguments[1];

    _classCallCheck(this, State);

    this.id = data.id || 'root';

    this._id = parent ? parent._id.concat(this.id) : [this.id];

    this.states = data.states ? data.states.map(function (state) {
      return new State(state, _this);
    }) : [];

    this.transitions = data.transitions ? data.transitions.map(function (transition) {
      return new _transition2['default'](transition);
    }) : [];

    this.initial = !!data.initial;

    this.final = !!data.final;
  }

  _createClass(State, [{
    key: 'mapStateRefs',
    value: function mapStateRefs() {
      var _this2 = this;

      this.states = this.states.map(function (state) {
        state.transitions = state.transitions.map(function (transition) {
          transition.targetState = _this2.getState(transition.target);

          return transition;
        });

        return state.mapStateRefs();
      });

      return this;
    }
  }, {
    key: 'relativeId',
    value: function relativeId() {
      var fromState = arguments.length <= 0 || arguments[0] === undefined ? null : arguments[0];

      if (!fromState) {
        return this.id;
      }

      return _lodash2['default'].zip(this._id, fromState._id).filter(function (_ref) {
        var _ref2 = _slicedToArray(_ref, 2);

        var a = _ref2[0];
        var b = _ref2[1];
        return !b;
      }).map(function (_ref3) {
        var _ref32 = _slicedToArray(_ref3, 1);

        var a = _ref32[0];
        return a;
      }).join('.');
    }
  }, {
    key: 'transition',
    value: function transition() {
      var _this3 = this;

      var fromState = arguments.length <= 0 || arguments[0] === undefined ? null : arguments[0];
      var signal = arguments.length <= 1 || arguments[1] === undefined ? null : arguments[1];

      var substateIds = this.getSubstateIds(fromState);
      var initialStates = this.states.filter(function (state) {
        return state.initial;
      });
      var nextStates = [];

      if (substateIds.length) {
        nextStates = this.getState(substateIds[0]).transition(substateIds.slice(1), signal);

        if (!nextStates.length) {
          nextStates = this.transitions.filter(function (transition) {
            return transition.isValid(signal);
          }).map(function (transition) {
            return transition.target;
          });
        } else if (!substateIds.slice(1)) {

          nextStates = nextStates.map(function (id) {
            return _this3.getState(id);
          }).filter(_lodash2['default'].identity).map(function (state) {
            return state.getInitialStates();
          }).reduce(function (a, b) {
            return a.concat(b);
          }, []);
        }
      } else if (initialStates.length) {
        nextStates = initialStates.map(function (state) {
          return state.transition(null, signal);
        }).reduce(function (a, b) {
          return a.concat(b);
        }).map(function (id) {
          return _this3.id + '.' + id;
        });
      } else if (signal) {
        nextStates = this.transitions.filter(function (transition) {
          return transition.isValid(signal);
        }).map(function (transition) {
          return transition.targetState.getInitialStates();
        }).reduce(function (a, b) {
          return a.concat(b);
        }, []);
      } else {
        nextStates = initialStates.concat(this.id);
      }

      return nextStates;
    }
  }, {
    key: 'getInitialStates',
    value: function getInitialStates() {
      var _this4 = this;

      var initialStates = this.states.filter(function (state) {
        return state.initial;
      });

      return initialStates.length ? initialStates.map(function (state) {
        return state.getInitialStates();
      }).reduce(function (a, b) {
        return a.concat(b);
      }, []).map(function (id) {
        return _this4.id + '.' + id;
      }) : [this.id];
    }
  }, {
    key: 'getSubstateIds',
    value: function getSubstateIds(fromState) {
      fromState = fromState || [];

      return _lodash2['default'].isArray(fromState) ? fromState : _lodash2['default'].isString(fromState) ? fromState.split(STATE_DELIMITER) : false;
    }
  }, {
    key: 'getState',
    value: function getState(substates) {
      substates = this.getSubstateIds(substates);

      if (!substates.length) {
        return this;
      }

      var substate = this.states.find(function (state) {
        return state.id === substates[0];
      });

      return substate ? substates.length > 1 ? substate.getState(substates.slice(1)) : substate : false;
    }
  }]);

  return State;
})();

exports['default'] = State;
module.exports = exports['default'];