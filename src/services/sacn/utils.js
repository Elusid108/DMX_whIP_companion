const crypto = require('crypto');

const createSacnDmxPacket = (universe, dmxData, options = {}) => {
    const multicastAddress = getMulticastAddress(universe);
    const sourceName = options.sourceName || 'DMX Monitor';
    const priority = options.priority || 100;
    const CID = options.cid || crypto.randomBytes(16);

    try {
        // Ensure DMX data is normalized
        const normalizedData = new Uint8Array(512).fill(0);
        dmxData.forEach((value, index) => {
            if (index < 512) normalizedData[index] = value;
        });

        // Create standard E1.31 packet
        const packet = Buffer.alloc(638); // Standard sACN packet size

        // Root Layer (bytes 0-37)
        packet[0] = 0x00;  // Preamble Size
        packet[1] = 0x10;  // Post-amble Size
        packet.write('ASC-E1.17\0\0\0', 4);  // ACN Packet Identifier (12 bytes)
        packet[16] = 0x70;  // Vector for Root layer

        // Framing Layer (bytes 38-115)
        packet.write(sourceName.padEnd(64, '\0'), 44);  // Source Name (64 bytes)
        packet[108] = priority;  // Priority (0-200)
        packet[113] = (universe >> 8) & 0xFF;  // Universe MSB
        packet[114] = universe & 0xFF;         // Universe LSB
        packet[115] = 0x00;  // Options Flags
        packet[116] = 0x02;  // Protocol Version (E1.31)

        // DMP Layer (bytes 116-637)
        packet[117] = 0x02;  // Vector
        packet[118] = 0xa1;  // Format
        packet[119] = 0x00;  // Start Code
        packet[124] = (normalizedData.length >> 8) & 0xFF;  // Property value count MSB
        packet[125] = normalizedData.length & 0xFF;         // Property value count LSB

        // DMX data
        Buffer.from(normalizedData).copy(packet, 126);

        return {
            packet,
            multicastAddress
        };
    } catch (error) {
        console.error('Error creating sACN packet:', error);
        throw error;
    }
};

const parseSacnPacket = (msg, rinfo) => {
    try {
        if (msg[0] === 0x00 && 
            msg[1] === 0x10 && 
            msg[4] === 0x41 && 
            msg[5] === 0x53 && 
            msg[6] === 0x43 && 
            msg[7] === 0x2d && 
            msg[8] === 0x45 && 
            msg[9] === 0x31 && 
            msg[10] === 0x2e && 
            msg[11] === 0x31 && 
            msg[12] === 0x37) {

            const universe = msg[113] << 8 | msg[114];
            let sourceName = '';
            for (let i = 44; i < 108; i++) {
                if (msg[i] === 0) break;
                sourceName += String.fromCharCode(msg[i]);
            }
            sourceName = sourceName.trim();
            
            const priority = msg[108];
            const dmxData = Array.from(msg.slice(126, 638));

            return {
                universe,
                dmxData,
                sourceName,
                sourceIp: rinfo.address,
                priority,
                protocol: 'sacn'
            };
        }
        return null;
    } catch (error) {
        console.error('Error parsing sACN packet:', error);
        return null;
    }
};

const getMulticastAddress = (universe) => {
    const low = universe % 256;
    const high = Math.floor(universe / 256);
    return `239.255.${high}.${low}`;
};

module.exports = {
    createSacnDmxPacket,
    parseSacnPacket,
    getMulticastAddress
};