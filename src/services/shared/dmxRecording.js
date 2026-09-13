const MAGIC = 'DMXREC';
const HEADER_SIZE = 10;
const FRAME_SIZE = 522;
const CHUNK_TARGET = 64 * 1024;

const createHeader = (frameCount = 0) => {
    const buf = Buffer.alloc(HEADER_SIZE);
    buf.write(MAGIC, 0, 6, 'ascii');
    buf.writeUInt32LE(frameCount >>> 0, 6);
    return buf;
};

const encodeFrame = ({ timestamp, universe, protocol, data }) => {
    const buf = Buffer.alloc(FRAME_SIZE);
    buf.writeUInt32LE(Math.min(Math.max(timestamp >>> 0, 0), 4294967295), 0);
    buf.writeUInt32LE(universe >>> 0, 4);
    buf.writeUInt16LE(protocol === 'artnet' ? 0 : 1, 8);

    if (data) {
        const src = Buffer.isBuffer(data) ? data : Buffer.from(data);
        src.copy(buf, 10, 0, Math.min(512, src.length));
    }

    return buf;
};

const parseRecording = (fileData) => {
    if (!fileData || fileData.length < HEADER_SIZE) {
        throw new Error('File is too small to be a recording');
    }

    if (fileData.slice(0, 6).toString('ascii') !== MAGIC) {
        throw new Error('Invalid file format');
    }

    const frameCount = fileData.readUInt32LE(6);
    if (frameCount === 0) {
        throw new Error('Recording is empty');
    }

    const expected = HEADER_SIZE + frameCount * FRAME_SIZE;
    if (fileData.length !== expected) {
        throw new Error('File is truncated or invalid');
    }

    const frames = [];
    for (let i = 0; i < frameCount; i++) {
        const offset = HEADER_SIZE + i * FRAME_SIZE;
        frames.push({
            timestamp: fileData.readUInt32LE(offset),
            universe: fileData.readUInt32LE(offset + 4),
            protocol: fileData.readUInt16LE(offset + 8) === 0 ? 'artnet' : 'sacn',
            data: Array.from(fileData.slice(offset + 10, offset + FRAME_SIZE))
        });
    }
    return frames;
};

module.exports = {
    MAGIC,
    HEADER_SIZE,
    FRAME_SIZE,
    CHUNK_TARGET,
    createHeader,
    encodeFrame,
    parseRecording
};
