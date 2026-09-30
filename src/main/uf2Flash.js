const fs = require('fs');
const os = require('os');
const path = require('path');
const { SerialPort } = require('serialport');
const { whipQuery } = require('./portProbe');
const { parseUf2Info } = require('../services/shared/boardDetect');

// RP2040 / RP2350 over USB. These boards take firmware as a UF2 file copied
// onto a small USB drive their bootloader shows:
//
//   1. the running firmware is told to restart into the bootloader
//      ("whip boot", or the 1200-baud touch for firmware without it);
//   2. the drive appears (INFO_UF2.TXT in its root names the chip);
//   3. firmware.uf2 is copied onto it; the board restarts by itself;
//   4. its serial port comes back and the board is set up over "whip" serial
//      commands.
//
// A drive cannot be matched to the serial port it came from, so steps 1-4 up
// to "port is back" run for one board at a time (bootLock).

const RP_VIDS = ['2E8A', '2886'];
const POLL_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRpPort = (port) => RP_VIDS.includes(String((port && port.vendorId) || '').toUpperCase());

const driveRoots = () => {
    if (process.platform === 'win32') {
        // A: and B: are floppies, C: is never a UF2 drive.
        return 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`);
    }
    const user = os.userInfo().username;
    const parents = process.platform === 'darwin'
        ? ['/Volumes']
        : [`/media/${user}`, `/run/media/${user}`, '/media'];
    const roots = [];
    parents.forEach((parent) => {
        try {
            fs.readdirSync(parent).forEach((name) => roots.push(path.join(parent, name)));
        } catch (err) {
            // no such mount parent on this system
        }
    });
    return roots;
};

// [{ root, model, boardId }] for every UF2 bootloader drive present.
const listUf2Drives = () => {
    const out = [];
    driveRoots().forEach((root) => {
        try {
            const text = fs.readFileSync(path.join(root, 'INFO_UF2.TXT'), 'utf8');
            out.push({ root, ...parseUf2Info(text) });
        } catch (err) {
            // not a UF2 drive
        }
    });
    return out;
};

const listRpPorts = async () => (await SerialPort.list()).filter(isRpPort);

// Opening and closing the port at 1200 baud is the Arduino signal to restart
// into the bootloader; the RP core follows it.
const touch1200 = (portPath) => new Promise((resolve) => {
    const port = new SerialPort({ path: portPath, baudRate: 1200, autoOpen: false });
    port.on('error', () => resolve());
    port.open((err) => {
        if (err) {
            resolve();
            return;
        }
        port.set({ dtr: false }, () => {
            setTimeout(() => port.close(() => resolve()), 100);
        });
    });
});

const waitFor = async (check, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value) {
            return value;
        }
        if (Date.now() >= end) {
            return null;
        }
        await sleep(POLL_MS);
    }
};

let bootLock = Promise.resolve();
const withBootLock = (work) => {
    const run = bootLock.then(work, work);
    bootLock = run.catch(() => {});
    return run;
};

// The drive's write ends when the bootloader has the last block and restarts,
// which can fail the close or the final write on some systems: once every
// byte was handed over, that is success.
const copyUf2 = async (data, root, onProgress) => {
    const target = path.join(root, 'firmware.uf2');
    const chunk = 64 * 1024;
    let written = 0;
    let handle = null;
    try {
        handle = await fs.promises.open(target, 'w');
        while (written < data.length) {
            const n = Math.min(chunk, data.length - written);
            await handle.write(data, written, n);
            written += n;
            onProgress(written, data.length);
        }
    } catch (err) {
        if (written < data.length) {
            throw new Error(`Copy to ${root} stopped at ${written} of ${data.length} bytes: ${err.message}`);
        }
    } finally {
        if (handle) {
            try {
                await handle.close();
            } catch (err) {
                // the drive is already gone
            }
        }
    }
};

const chipMatchesDrive = (board, drive) => {
    const want = String((board.detect && board.detect.uf2Board) || '').toUpperCase();
    const got = String(drive.boardId || '').toUpperCase();
    return !want || !got || want === got;
};

// Puts firmware on one board. port: its serial port path, or '' when the
// board is already in its bootloader (drive: that drive's root).
// Resolves { port, wasBlank } with the serial port the board came back on.
const flashUf2 = ({ port, drive, board, data, log, progress }) => withBootLock(async () => {
    const drivesBefore = new Set(listUf2Drives().map((item) => item.root));
    const portsBefore = new Set((await listRpPorts()).map((item) => item.path));
    let target = null;

    if (port) {
        progress({ percent: 0, label: 'Restarting into the bootloader' });
        const reply = await whipQuery(port, 'boot', { timeoutMs: 1200 });
        if (reply && reply.ok) {
            log('Firmware is restarting into its bootloader');
        } else {
            log('No answer to "whip boot"; using the 1200-baud touch');
            await touch1200(port);
        }
        target = await waitFor(
            () => listUf2Drives().find((item) => !drivesBefore.has(item.root)) || null,
            12000
        );
        if (!target) {
            throw new Error(
                'The board did not show its UF2 drive. Unplug it, hold B (BOOT) while plugging it in, then Refresh ports and flash the drive.'
            );
        }
        portsBefore.delete(port);
    } else {
        target = listUf2Drives().find((item) => item.root === drive) || null;
        if (!target) {
            throw new Error(`${drive} is not a UF2 drive any more. Refresh ports.`);
        }
    }

    if (!chipMatchesDrive(board, target)) {
        throw new Error(
            `${board.name} was chosen but the drive ${target.root} is a ${target.boardId} bootloader. Pick the matching board for this row.`
        );
    }
    log(`UF2 drive ${target.root} (${target.boardId || target.model || 'unknown'})`);
    progress({ percent: 5, label: 'Copying firmware' });
    await copyUf2(Buffer.from(data), target.root, (done, total) => {
        progress({ percent: 5 + Math.round((85 * done) / total), label: 'Copying firmware' });
    });

    progress({ percent: 92, label: 'Restarting' });
    const back = await waitFor(async () => {
        const ports = await listRpPorts();
        return ports.find((item) => item.path === port)
            || ports.find((item) => !portsBefore.has(item.path))
            || null;
    }, 20000);
    if (!back) {
        throw new Error('Firmware was copied but the board did not come back on a serial port. Unplug and plug it in again.');
    }
    return { port: back.path, wasBlank: !port };
});

// First answer to "whip id" after a restart (the port is there before the
// firmware listens).
const waitForId = async (portPath, timeoutMs = 12000) => waitFor(async () => {
    const reply = await whipQuery(portPath, 'id', { timeoutMs: 1000 });
    return reply && reply.ok ? reply : null;
}, timeoutMs);

// A "whip" command that must succeed.
const command = async (portPath, cmd, what) => {
    const reply = await whipQuery(portPath, cmd, { timeoutMs: 3000 });
    if (!reply) {
        throw new Error(`${what}: the board did not answer`);
    }
    if (!reply.ok) {
        throw new Error(`${what}: ${reply.error || 'refused'}`);
    }
    return reply;
};

// The firmware's reader takes no escapes inside strings.
const plain = (text) => String(text || '').replace(/["\\]/g, '').replace(/[\u0000-\u001f]/g, ' ');

// Name, brightness, button, SD pins and pixel patch over serial.
// current: the board's "whip get" reply (SD pins are only sent when they
// differ, since changing them remounts the card).
const provision = async (portPath, { names, bri, button, sdPins, pmapBlob }, log) => {
    const current = await command(portPath, 'get', 'Reading settings');
    const fields = [];
    if (names && names.long) {
        fields.push(`"name":"${plain(names.long)}"`);
        fields.push(`"short":"${plain(names.short || names.long).slice(0, 17)}"`);
    }
    if (Number.isInteger(bri)) {
        fields.push(`"bri":${bri}`);
    }
    fields.push(`"btn":${Number.isInteger(button) ? button : -1}`);
    const sd = current.sd || {};
    const sdDiffers = sdPins && ['cs', 'mosi', 'clk', 'miso'].some((key) => Number(sd[key]) !== Number(sdPins[key]));
    if (sdDiffers) {
        fields.push(`"sd":{"cs":${sdPins.cs},"mosi":${sdPins.mosi},"clk":${sdPins.clk},"miso":${sdPins.miso}}`);
    }
    await command(portPath, `set {${fields.join(',')}}`, 'Writing settings');
    if (names && names.long) {
        log(`Provisioning name=${names.long}`);
    }
    if (pmapBlob) {
        const reply = await command(portPath, `pmap ${Buffer.from(pmapBlob).toString('base64')}`, 'Writing the pixel patch');
        log(`Pixel patch written (${reply.segs} segment${reply.segs === 1 ? '' : 's'}, ${reply.px} px)`);
    }
    return command(portPath, 'get', 'Reading settings back');
};

module.exports = {
    isRpPort,
    listUf2Drives,
    flashUf2,
    waitForId,
    provision
};
