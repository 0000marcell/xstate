import { assert } from 'chai';
import { Machine } from '../../src/index';

describe('Example: CD Player', () => {
  const cdMachine = new Machine({
    id: 'cd',
    initial: 'not_loaded',
    states: {
      not_loaded: {
        on: {
          INSERT_CD: 'loaded'
        }
      },
      loaded: {
        initial: 'stopped',

        on: {
          EJECT: 'not_loaded'
        },
        states: {
          stopped: {
            on: {
              PLAY: 'playing'
            }
          },
          playing: {
            on: {
              STOP: 'stopped',
              EXPIRED_END: 'stopped',
              EXPIRED_MID: 'playing',
              PAUSE: 'paused'
            }
          },
          paused: {
            initial: 'not_blank',
            states: {
              blank: { on: { TIMER: 'not_blank' } },
              not_blank: { on: { TIMER: 'blank' } }
            },
            on: {
              PAUSE: 'playing',
              PLAY: 'playing',
              STOP: 'stopped'
            }
          }
        }
      }
    }
  });

  const expected = {
    not_loaded: {
      INSERT_CD: 'loaded.stopped',
      FAKE: 'not_loaded'
    },
    loaded: {
      EJECT: 'not_loaded',
      FAKE: 'loaded.stopped'
    },
    'loaded.stopped': {
      PLAY: 'loaded.playing',
      EJECT: 'not_loaded',
      FAKE: 'loaded.stopped'
    },
    'loaded.playing': {
      EXPIRED_MID: 'loaded.playing',
      EXPIRED_END: 'loaded.stopped',
      STOP: 'loaded.stopped',
      EJECT: 'not_loaded',
      PAUSE: 'loaded.paused.not_blank',
      FAKE: 'loaded.playing'
    },
    'loaded.paused': {
      PAUSE: 'loaded.playing',
      PLAY: 'loaded.playing',
      TIMER: 'loaded.paused.blank',
      EJECT: 'not_loaded',
      STOP: 'loaded.stopped'
    },
    'loaded.paused.blank': {
      PAUSE: 'loaded.playing',
      PLAY: 'loaded.playing',
      TIMER: 'loaded.paused.not_blank',
      EJECT: 'not_loaded',
      STOP: 'loaded.stopped'
    }
  };

  Object.keys(expected).forEach(fromState => {
    Object.keys(expected[fromState]).forEach(actionType => {
      const toState = expected[fromState][actionType];

      it(`should go from ${fromState} to ${toState}`, () => {
        assert.equal(
          cdMachine.transition(fromState, actionType).value,
          toState
        );
      });
    });
  });
});
