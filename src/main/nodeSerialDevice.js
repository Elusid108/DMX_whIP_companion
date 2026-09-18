const { SerialPort } = require('serialport');

class NodeSerialDevice {
    constructor(path) {
        this.path = path;
        this._port = null;
        this._chunks = [];
        this._waiters = [];
        this._open = false;
        this.readable = this._makeReadable();
        this.writable = this._makeWritable();
    }

    getInfo() {
        return { usbVendorId: undefined, usbProductId: undefined };
    }

    _makeReadable() {
        const self = this;
        return {
            locked: false,
            getReader() {
                if (self.readable.locked) {
                    throw new Error('readable locked');
                }
                self.readable.locked = true;
                return {
                    read: () => self._readChunk(),
                    releaseLock: () => {
                        self.readable.locked = false;
                    },
                    cancel: async () => {
                        self.readable.locked = false;
                        self._wake();
                    }
                };
            }
        };
    }

    _makeWritable() {
        const self = this;
        return {
            locked: false,
            getWriter() {
                if (self.writable.locked) {
                    throw new Error('writable locked');
                }
                self.writable.locked = true;
                return {
                    write: (data) => self._write(data),
                    releaseLock: () => {
                        self.writable.locked = false;
                    },
                    close: async () => {
                        self.writable.locked = false;
                    }
                };
            }
        };
    }

    _wake() {
        const waiters = this._waiters.splice(0);
        waiters.forEach((resolve) => resolve());
    }

    _onData(buf) {
        this._chunks.push(Uint8Array.from(buf));
        this._wake();
    }

    _readChunk() {
        return new Promise((resolve) => {
            const take = () => {
                if (this._chunks.length) {
                    resolve({ value: this._chunks.shift(), done: false });
                    return true;
                }
                if (!this._open) {
                    resolve({ value: undefined, done: true });
                    return true;
                }
                return false;
            };
            if (take()) {
                return;
            }
            this._waiters.push(() => {
                take();
            });
        });
    }

    _write(data) {
        if (!this._port || !this._port.isOpen) {
            return Promise.reject(new Error('Serial port is not open'));
        }
        const buf = Buffer.from(data);
        return new Promise((resolve, reject) => {
            this._port.write(buf, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this._port.drain((drainErr) => {
                    if (drainErr) {
                        reject(drainErr);
                        return;
                    }
                    resolve();
                });
            });
        });
    }

    async open({ baudRate } = {}) {
        const rate = baudRate || 115200;
        if (this._port && this._port.isOpen) {
            if (this._port.baudRate !== rate) {
                await new Promise((resolve, reject) => {
                    this._port.update({ baudRate: rate }, (err) => (err ? reject(err) : resolve()));
                });
            }
            return;
        }
        this._chunks = [];
        this._port = new SerialPort({
            path: this.path,
            baudRate: rate,
            autoOpen: false
        });
        await new Promise((resolve, reject) => {
            this._port.open((err) => (err ? reject(err) : resolve()));
        });
        this._open = true;
        this._port.on('data', (buf) => this._onData(buf));
        this._port.on('close', () => {
            this._open = false;
            this._wake();
        });
        this._port.on('error', () => {
            this._open = false;
            this._wake();
        });
    }

    async setSignals({ requestToSend, dataTerminalReady } = {}) {
        if (!this._port || !this._port.isOpen) {
            return;
        }
        const patch = {};
        if (requestToSend !== undefined) {
            patch.rts = requestToSend;
        }
        if (dataTerminalReady !== undefined) {
            patch.dtr = dataTerminalReady;
        }
        if (!Object.keys(patch).length) {
            return;
        }
        await new Promise((resolve, reject) => {
            this._port.set(patch, (err) => (err ? reject(err) : resolve()));
        });
    }

    async close() {
        this._open = false;
        this._wake();
        if (!this._port) {
            return;
        }
        const port = this._port;
        this._port = null;
        if (port.isOpen) {
            await new Promise((resolve) => {
                port.close(() => resolve());
            });
        }
    }
}

module.exports = NodeSerialDevice;
