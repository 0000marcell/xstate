
import assert from 'assert';
import should from 'should';
import machine, { Signal } from '../dist/index';
import _ from 'lodash';

describe('machine', () => {
  let pedestrianMachine = {
    id: 'pedestrian',
    initial: true,
    states: [
      {
        id: 'walk',
        initial: true,
        transitions: [
          {
            event: 'PED_COUNTDOWN',
            target: 'wait'
          }
        ]
      },
      {
        id: 'wait',
        transitions: [
          {
            event: 'PED_COUNTDOWN',
            target: 'stop',
            cond: (data) => data.value >= 20
          }
        ]
      },
      {
        id: 'stop'
      }
    ]
  };

  let lightMachine = machine({
    states: [
      {
        id: 'green',
        initial: true,
        transitions: [
          {
            event: 'TIMER',
            target: 'yellow'
          },
          {
            event: 'POWER_OUTAGE',
            target: 'red'
          }
        ]
      },
      {
        id: 'yellow',
        transitions: [
          {
            event: 'TIMER',
            target: 'red'
          }
        ]
      },
      {
        id: 'red',
        states: [ pedestrianMachine ],
        transitions: [
          {
            event: 'TIMER',
            target: 'green'
          }
        ]
      }
    ]
  });

  describe('machine.states', () => {
    it('should properly register machine states', () => {
      assert.deepEqual(
        _.pluck(lightMachine.states, 'id'),
        ['green', 'yellow', 'red']);
    });

    it('should create instances of State class', () => {
      assert.ok(_.every(lightMachine.states,
        (state) => state.constructor.name === 'State'));
    });
  });

  describe('machine.transition()', () => {
    it('should properly transition states based on string event', () => {
      assert.deepEqual(
        lightMachine.transition('green', 'TIMER'),
        ['yellow']);

      assert.deepEqual(
        lightMachine.transition('green', 'POWER_OUTAGE'),
        ['red']);
    });

    it('should properly transition states based on signal-like object', () => {
      let signal = {
        event: 'TIMER'
      };

      assert.deepEqual(
        lightMachine.transition('yellow', signal),
        ['red']);
    });

    it('should return initial state(s) without any arguments for transition()', () => {
      assert.deepEqual(
        lightMachine.transition(),
        ['green']);
    });
  });
});