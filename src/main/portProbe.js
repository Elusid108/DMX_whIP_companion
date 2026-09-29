const { SerialPort } = require('serialport');
const { parseWhipReply } = require('../services/shared/boardDetect');

// One whIP serial command (firmware serial_cmd: "whip <cmd>" -> one
// "@whip {json}" line). Opening the port does not reset the board: DTR and
// RTS stay at the driver default (both asserted), which neither the ESP32
// USB-Serial/JTAG nor the usual UART-bridge auto-reset treats as a reset.
// Resolves the parsed reply, or null when nothing answered in time (no
// whIP firmware, old firmware, or the ROM bootloader).
const whipQuery = (portPath, cmd, { timeoutMs = 1500 } = {}) => new Promise((resolve) => {
    let text = '';
    let settled = false;
    const timers = [];
    const port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
    const finish = (value) => {
        if (settled) {
            return;
        }
        settled = true;
        timers.forEach(clearTimeout);
        if (port.isOpen) {
            port.close(() => resolve(value));
        } else {
            resolve(value);
        }
    };
    const send = () => {
        if (!settled && port.isOpen) {
            port.write(`whip ${cmd}\n`);
        }
    };
    port.on('data', (buf) => {
        text += buf.toString('utf8');
        // Keep the tail only; a log replay on connect can be a few KB.
        if (text.length > 16384) {
            text = text.slice(-8192);
        }
        const reply = parseWhipReply(text);
        if (reply && reply.cmd === cmd.split(' ')[0]) {
            finish(reply);
        }
    });
    port.on('error', () => finish(null));
    port.open((err) => {
        if (err) {
            finish(null);
            return;
        }
        // Once right away and once more in case the first line landed while
        // the board was still printing its log replay.
        timers.push(setTimeout(send, 50));
        timers.push(setTimeout(send, Math.round(timeoutMs / 2)));
        timers.push(setTimeout(() => finish(null), timeoutMs));
    });
});

module.exports = { whipQuery };
