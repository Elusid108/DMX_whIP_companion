// How known controllers light their buttons and pads. Faders keep the
// generic echo (same CC / pitch bend back), which moves motor faders and
// LED rings on every controller that has them.
//
// A profile turns (mapping, lit) into the MIDI messages that light that
// control. Sources: Akai APC mini mk2 / APC Key 25 mk2 communication
// protocols (RGB pads: velocity = palette colour, channel 1-7 = brightness
// 10-100 %; single-colour buttons: 0 off, 1 on, 2 blink); APC mk1 (0 off,
// 1 green, 3 red, 5 yellow); Behringer X-Touch Mini standard mode (buttons
// send notes 8-23 / 32-47 on ch 11, their LEDs are notes 0-15 on the global
// channel, velocity 1 on, 2 blink, 3-127 ignored); Mackie Control
// (X-Touch, X-Touch One/Extender/Mini in MC mode: 127 on, 1 blink).

const GREEN = 21; // Akai RGB palette
const noteOn = (ch, num, vel) => [0x90 | ((ch - 1) & 0x0f), num & 0x7f, vel & 0x7f];

const single = (onVel) => (map, lit) => (map.kind === 'note' ? [noteOn(map.ch, map.num, lit ? onVel : 0)] : null);

const PROFILES = [
    {
        id: 'apc-mini-mk2',
        label: 'Akai APC mini mk2',
        match: /APC\s*mini\s*mk\s*2|APC\s*mini\s*mk\s*II/i,
        // Pads 0-63 are RGB (channel 7 = full brightness); track 100-107,
        // scene 112-119 and the rest are single-colour on channel 1.
        led: (map, lit) => {
            if (map.kind !== 'note') {
                return null;
            }
            if (map.num <= 63) {
                return [noteOn(7, map.num, lit ? GREEN : 0)];
            }
            return [noteOn(1, map.num, lit ? 1 : 0)];
        }
    },
    {
        id: 'apc-key25-mk2',
        label: 'Akai APC Key 25 mk2',
        match: /APC\s*Key\s*25\s*mk\s*(2|II)/i,
        led: (map, lit) => {
            if (map.kind !== 'note' || map.ch !== 1) {
                return null; // the keys play notes on other channels
            }
            if (map.num <= 39) {
                return [noteOn(7, map.num, lit ? GREEN : 0)];
            }
            return [noteOn(1, map.num, lit ? 1 : 0)];
        }
    },
    {
        id: 'apc40-mk2',
        label: 'Akai APC40 mk2',
        match: /APC\s*40\s*mk\s*(2|II)/i,
        // Clip grid 32-71 is RGB; other buttons are single-colour.
        led: (map, lit) => {
            if (map.kind !== 'note') {
                return null;
            }
            if (map.num >= 32 && map.num <= 71) {
                return [noteOn(map.ch, map.num, lit ? GREEN : 0)];
            }
            return [noteOn(map.ch, map.num, lit ? 1 : 0)];
        }
    },
    {
        id: 'apc',
        label: 'Akai APC (mk1)',
        match: /APC\s*(mini|key\s*25|40|20)/i,
        led: single(1) // green on the clip grid, "on" elsewhere
    },
    {
        id: 'xtouch-mini',
        label: 'Behringer X-Touch Mini',
        match: /X-?TOUCH\s*MINI/i,
        led: (map, lit) => {
            if (map.kind !== 'note') {
                return null;
            }
            if (map.ch === 11) {
                // Standard mode: layer A buttons 8-23, layer B 32-47 light
                // LEDs 0-15. The LED channel is the global channel (1 by
                // default), so send it there and on 11.
                let led = -1;
                if (map.num >= 8 && map.num <= 23) {
                    led = map.num - 8;
                } else if (map.num >= 32 && map.num <= 47) {
                    led = map.num - 32;
                }
                if (led < 0) {
                    return null; // encoder push buttons have no LED
                }
                const vel = lit ? 1 : 0;
                return [noteOn(1, led, vel), noteOn(11, led, vel)];
            }
            // Mackie Control mode.
            return [noteOn(map.ch, map.num, lit ? 127 : 0)];
        }
    },
    {
        id: 'behringer-std',
        label: 'Behringer X-Touch / CMD',
        match: /X-?TOUCH|XTOUCH|\bCMD\b|BEHRINGER/i,
        // Mackie Control uses channel 1 (127 on); the standard MIDI modes use
        // 1 = on, 2 = blink and ignore higher values.
        led: (map, lit) => (map.kind === 'note'
            ? [noteOn(map.ch, map.num, lit ? (map.ch === 1 ? 127 : 1) : 0)]
            : null)
    },
    {
        id: 'bcx2000',
        label: 'Behringer BCF2000 / BCR2000',
        match: /BC[FR]\s*2000/i,
        led: null // generic echo sets their buttons and encoders
    }
];

const GENERIC = { id: 'generic', label: 'Generic MIDI', led: null };

const profileFor = (name, manufacturer = '') => (
    PROFILES.find((p) => p.match.test(String(name || ''))) ||
    (/behringer|music tribe/i.test(String(manufacturer || '')) ? PROFILES.find((p) => p.id === 'behringer-std') : null) ||
    GENERIC
);

// Messages that light (or darken) a mapped pad. onVel overrides the
// profile with a plain "same note/CC at this value" echo (for controllers
// no profile knows).
const padLight = (profile, map, lit, onVel) => {
    if (onVel) {
        const v = lit ? onVel : 0;
        if (map.kind === 'note') {
            return [noteOn(map.ch, map.num, v)];
        }
        if (map.kind === 'cc') {
            return [[0xb0 | ((map.ch - 1) & 0x0f), map.num & 0x7f, v]];
        }
        return null;
    }
    if (profile && profile.led) {
        const out = profile.led(map, lit);
        if (out) {
            return out;
        }
        if (map.kind === 'note') {
            return null;
        }
    }
    // Generic: same message, 127 / 0.
    if (map.kind === 'note') {
        return [noteOn(map.ch, map.num, lit ? 127 : 0)];
    }
    if (map.kind === 'cc') {
        return [[0xb0 | ((map.ch - 1) & 0x0f), map.num & 0x7f, lit ? 127 : 0]];
    }
    const v14 = lit ? 16383 : 0;
    return [[0xe0 | ((map.ch - 1) & 0x0f), v14 & 0x7f, (v14 >> 7) & 0x7f]];
};

module.exports = { GENERIC, PROFILES, padLight, profileFor };
