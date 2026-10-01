/**
 * UDP port. One `open` per socket; the engine binds Art-Net 6454 and sACN
 * 5568 receivers and ephemeral sender sockets through it.
 *
 * @typedef {Object} UdpOpenOptions
 * @property {number} [port=0] Local port (0 = ephemeral).
 * @property {string} [address] Local address to bind ('0.0.0.0' or undefined for all).
 * @property {boolean} [reuseAddr]
 * @property {boolean} [broadcast]
 * @property {number} [multicastTtl]
 * @property {boolean} [multicastLoopback]
 * @property {string} [multicastInterface] Outgoing multicast interface address.
 * @property {number} [recvBufferSize] Best effort; the OS may clamp it.
 *
 * @typedef {Object} UdpSocket
 * @property {number} port Bound local port.
 * @property {(bytes: Uint8Array, port: number, host: string) => Promise<void>} send
 * @property {(fn: (bytes: Uint8Array, rinfo: { address: string, port: number }) => void) => void} onMessage
 * @property {(fn: (err: Error) => void) => void} onError Errors after bind (bind errors reject `open`).
 * @property {(address: string, iface?: string) => void} addMembership
 * @property {(address: string, iface?: string) => void} dropMembership
 * @property {() => void} close
 *
 * @typedef {Object} UdpPort
 * @property {(options: UdpOpenOptions) => Promise<UdpSocket>} open
 * @property {() => Array<{ name: string, ip: string }>} interfaces IPv4 adapters, 'All Interfaces' and 'Loopback' first.
 * @property {() => Set<string>} localIps Every local IPv4 address (own-output detection).
 */
const assertUdp = (udp) => {
    if (!udp || typeof udp.open !== 'function' || typeof udp.interfaces !== 'function' || typeof udp.localIps !== 'function') {
        throw new Error('ports.udp needs open(), interfaces() and localIps()');
    }
    return udp;
};

module.exports = { assertUdp };
