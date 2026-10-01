'use strict';

const Homey = require('homey');
const Device = require('./device.js')

// HmIP reports ACTIVITY_STATE as a numeric enum (0=UNKNOWN, 1=UP, 2=DOWN,
// 3=STABLE), while BidCos devices use the string form. Handle both.
const activivateStateToCoveringState = function (value) {
    if (value === "UP" || value === 1 || value === "1") {
        return "up"
    } else if (value === "DOWN" || value === 2 || value === "2") {
        return "down"
    }
    return "idle"
}

const convertSetKey = function (key, value) {
    if (value === "up") {
        return "LEVEL"
    } else if (value === "down") {
        return "LEVEL"
    }
    return "STOP"
}

const convertSetState = function (value) {
    if (value === "up") {
        return "1.0"
    } else if (value === "down") {
        return "0.0"
    }
    return true
}

// HmIP reports LEVEL in steps of 0.5%. The value 1.01 is the placeholder for
// "position unknown" and would otherwise show up as 101% in the UI.
const levelToPosition = function (value) {
    let level = parseFloat(value)
    if (isNaN(level)) {
        return undefined
    }
    if (level > 1) {
        return 1
    }
    if (level < 0) {
        return 0
    }
    return Math.round(level * 200) / 200
}

const capabilityMap = {
    "windowcoverings_set": {
        "channel": 3,
        "key": "LEVEL",
        "convert": levelToPosition,
        "set": {
            "key": "LEVEL",
            "channel": 4
        }
    },
    "windowcoverings_state": {
        "channel": 3,
        "key": "ACTIVITY_STATE",
        "convert": activivateStateToCoveringState,
        "set": {
            "key": "LEVEL",
            "channel": 4,
            "convert": convertSetState,
            "convertKey": convertSetKey
        }
    }
}


// A move taking longer than this discards the target state. Guards against a
// lost ACTIVITY_STATE event freezing the slider on a position never reached.
const MOVE_TIMEOUT = 180000

class HomematicDevice extends Device {

    onInit() {
        this._targetLevel = null;
        this._moving = false;
        this._moveTimer = null;
        super.onInit(capabilityMap);
    }

    _clearMove() {
        this._targetLevel = null;
        this._moving = false;
        if (this._moveTimer) {
            this.homey.clearTimeout(this._moveTimer);
            this._moveTimer = null;
        }
    }

    // Remember the target position whenever a move command goes out. Only then
    // are intermediate values suppressed - a move started at the wall switch has
    // no target and keeps being tracked live.
    setValue(channel, key, value) {
        if (key === 'LEVEL') {
            let target = typeof value === 'number' ? value : parseFloat(value);
            if (!isNaN(target)) {
                this._clearMove();
                this._targetLevel = target;
                this._moving = true;
                this._moveTimer = this.homey.setTimeout(() => {
                    this._clearMove();
                    this.getCapabilityValue('windowcoverings_set');
                }, MOVE_TIMEOUT);
            }
        } else if (key === 'STOP') {
            this._clearMove();
        }
        return super.setValue(channel, key, value);
    }

    async setCapabilityValue(name, value) {
        if (name === 'windowcoverings_state') {
            if (value === 'idle') {
                // Move finished: pull in the actual position once. If the target
                // was reached nothing changes visibly; if the move was interrupted
                // the slider snaps to the real value.
                let refresh = this._moving && this._targetLevel !== null;
                this._clearMove();
                if (refresh) {
                    this.getCapabilityValue('windowcoverings_set');
                }
            } else {
                this._moving = true;
            }
        } else if (name === 'windowcoverings_set' && this._moving && this._targetLevel !== null) {
            // Keep the slider on the requested position while travelling
            return;
        }

        return super.setCapabilityValue(name, value);
    }

    onDeleted() {
        this._clearMove();
        super.onDeleted();
    }

    initializeExtraEventListeners() {
        var self = this;
        for (let button = 1; button <= 2; button++) {
            self.bridge.on('event-' + self.deviceAddress + ':' + button + '-PRESS_SHORT', (value) => {
                self.driver.triggerButtonPressedFlow(self, { "button": button }, { "button": button, "pressType": "short" })
            });
            self.bridge.on('event-' + self.deviceAddress + ':' + button + '-PRESS_LONG', (value) => {
                self.driver.triggerButtonPressedFlow(self, { "button": button }, { "button": button, "pressType": "long" })
            });
        }

    }
}

module.exports = HomematicDevice;