const createArtNetDmxPacket = (universe, dmxData) => {
    const packet = Buffer.alloc(18 + dmxData.length);
    
    // Art-Net header
    packet.write('Art-Net\0', 0);    // ID
    packet.writeUInt16LE(0x5000, 8); // OpCode for DMX data
    packet.writeUInt16LE(14, 10);    // Protocol version
    packet.writeUInt8(0, 12);        // Sequence
    packet.writeUInt8(0, 13);        // Physical
    packet.writeUInt16LE(universe, 14); // Universe
    packet.writeUInt16BE(dmxData.length, 16); // Length
    
    // DMX data
    Buffer.from(dmxData).copy(packet, 18);
    
    return packet;
};

const parseArtNetPacket = (msg, rinfo) => {
    if (msg.length > 10 && msg.toString('utf8', 0, 8) === 'Art-Net\0') {
        const opcode = msg.readUInt16LE(8);
        if (opcode === 0x5000) { // DMX data
            const universe = msg.readUInt16LE(14);
            const length = msg.readUInt16BE(16);
            const dmxData = Array.from(msg.slice(18, 18 + length));
            return {
                universe,
                dmxData,
                sourceIp: rinfo.address,
                protocol: 'artnet'
            };
        }
    }
    return null;
};

module.exports = {
    createArtNetDmxPacket,
    parseArtNetPacket
};