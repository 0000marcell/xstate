import { assert } from "chai";
import { Machine } from "../src/index";

describe("machine", () => {
  const pedestrianStates = {
    initial: "walk",
    states: {
      walk: {
        on: {
          PED_COUNTDOWN: "wait"
        }
      },
      wait: {
        on: {
          PED_COUNTDOWN: "stop"
        }
      },
      stop: {
        final: true
      }
    }
  };

  const lightMachine = new Machine({
    id: "light",
    initial: "green",
    states: {
      green: {
        on: {
          TIMER: "yellow",
          POWER_OUTAGE: "red"
        }
      },
      yellow: {
        on: {
          TIMER: "red",
          POWER_OUTAGE: "red"
        }
      },
      red: {
        on: {
          TIMER: "green",
          POWER_OUTAGE: "red"
        },
        ...pedestrianStates
      }
    }
  });

  describe("machine.states", () => {
    it("should properly register machine states", () => {
      assert.deepEqual(Object.keys(lightMachine.states), [
        "green",
        "yellow",
        "red"
      ]);
    });
  });

  describe("machine.getState()", () => {
    it("should find a substate from a string state ID", () => {
      assert.equal(lightMachine.getState("yellow").id, "yellow");
    });

    it("should find a nested substate from a delimited string state ID", () => {
      assert.equal(lightMachine.getState("red.walk").id, "red.walk");
    });

    it("should throw for invalid substates", () => {
      assert.throws(() => lightMachine.getState("fake"));

      assert.throws(() => lightMachine.getState("fake.nested.substate"));

      assert.throws(() => lightMachine.getState("red.partially.fake"));
    });
  });

  describe("machine.events", () => {
    it("should return the set of actions accepted by machine", () => {
      assert.sameMembers(lightMachine.events, [
        "TIMER",
        "POWER_OUTAGE",
        "PED_COUNTDOWN"
      ]);
    });
  });
});
