// UDP port on dgram. Each open() is one udp4 socket; bind errors reject,
// later errors go to onError listeners. interfaces() keeps the companion's
// list shape ('All Interfaces', 'Loopback', then every IPv4 adapter).
const dgram = require('dgram');
const os = require('os');

const open = (options = {}) => new Promise((resolve, reject) => {
    const socket = dgram.createSocket({
        type: 'udp4',
        reuseAddr: options.reuseAddr !== false,
        ...(options.multicastTtl ? { ttl: options.multicastTtl } : {})
    });
    const errorListeners = new Set();
    const onBindError = (err) => {
        try {
            socket.close();
        } catch (closeErr) {
            // already closed
        }
        reject(err);
    };
    socket.once('error', onBindError);
    socket.bind(options.port || 0, options.address || undefined, () => {
        socket.removeListener('error', onBindError);
        socket.on('error', (err) => errorListeners.forEach((fn) => fn(err)));
        if (options.recvBufferSize) {
            try {
                socket.setRecvBufferSize(options.recvBufferSize);
            } catch (err) {
                // the OS may clamp the buffer
            }
        }
        try {
            if (options.broadcast) {
                socket.setBroadcast(true);
            }
            if (options.multicastTtl) {
                socket.setMulticastTTL(options.multicastTtl);
            }
            if (options.multicastLoopback) {
                socket.setMulticastLoopback(true);
            }
            if (options.multicastInterface) {
                socket.setMulticastInterface(options.multicastInterface);
            }
        } catch (err) {
            if (options.strict) {
                socket.close();
                reject(err);
                return;
            }
        }
        let closed = false;
        resolve({
            port: socket.address().port,
            send: (bytes, port, host) => new Promise((res, rej) => {
                if (closed) {
                    rej(new Error('socket is closed'));
                    return;
                }
                socket.send(bytes, port, host, (err) => (err ? rej(err) : res()));
            }),
            onMessage: (fn) => {
                socket.on('message', fn);
            },
            onError: (fn) => {
                errorListeners.add(fn);
            },
            addMembership: (address, iface) => (iface ? socket.addMembership(address, iface) : socket.addMembership(address)),
            dropMembership: (address, iface) => (iface ? socket.dropMembership(address, iface) : socket.dropMembership(address)),
            close: () => {
                if (closed) {
                    return;
                }
                closed = true;
                try {
                    socket.close();
                } catch (err) {
                    // already closed
                }
            }
        });
    });
});

const interfaces = () => {
    const list = [
        { name: 'All Interfaces', ip: '0.0.0.0' },
        { name: 'Loopback', ip: '127.0.0.1' }
    ];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const addr of addrs || []) {
            if (addr.family === 'IPv4' && !addr.internal) {
                list.push({ name, ip: addr.address });
            }
        }
    }
    return list;
};

const localIps = () => {
    const set = new Set(['127.0.0.1']);
    for (const list of Object.values(os.networkInterfaces())) {
        for (const addr of list || []) {
            if (addr && addr.family === 'IPv4') {
                set.add(addr.address);
            }
        }
    }
    return set;
};

const createUdp = () => ({
    open,
    interfaces,
    localIps,
    describe: () => ({ artnet: true, sacn: true, broadcast: true, multicast: true })
});

module.exports = { createUdp };
