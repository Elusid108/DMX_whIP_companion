const os = require('os');

const getNetworkInterfaces = () => {
    const interfaces = os.networkInterfaces();
    const validInterfaces = [
        { name: 'All Interfaces', ip: '0.0.0.0' },
        { name: 'Loopback', ip: '127.0.0.1' }
    ];

    for (const [name, addrs] of Object.entries(interfaces)) {
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) {
                validInterfaces.push({
                    name: name,
                    ip: addr.address
                });
            }
        }
    }

    return validInterfaces;
};

const safelyCloseSocket = (socket) => {
    try {
        if (socket && socket.address()) {
            socket.close();
        }
    } catch (error) {
        console.log('Socket was already closed or not running');
    }
};

module.exports = {
    getNetworkInterfaces,
    safelyCloseSocket
};