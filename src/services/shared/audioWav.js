const PEAK_COUNT = 800;

const parseWavPcm16Stereo = (buf) => {
    if (!buf || buf.length < 44) {
        throw new Error('Audio file is too small');
    }
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Expected a WAV file');
    }

    let offset = 12;
    let channels = 0;
    let sampleRate = 0;
    let bits = 0;
    let dataStart = 0;
    let dataSize = 0;

    while (offset + 8 <= buf.length) {
        const id = buf.toString('ascii', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        const body = offset + 8;
        if (id === 'fmt ' && size >= 16) {
            channels = buf.readUInt16LE(body + 2);
            sampleRate = buf.readUInt32LE(body + 4);
            bits = buf.readUInt16LE(body + 14);
        } else if (id === 'data') {
            dataStart = body;
            dataSize = size;
            break;
        }
        offset = body + size + (size % 2);
    }

    if (bits !== 16 || channels !== 2 || sampleRate <= 0 || dataSize <= 0) {
        throw new Error('Expected 16-bit stereo WAV');
    }

    const bytesPerFrame = 4;
    const sampleCount = Math.floor(dataSize / bytesPerFrame);
    const durationMs = Math.round((sampleCount / sampleRate) * 1000);
    return {
        sampleRate,
        dataStart,
        dataSize,
        sampleCount,
        durationMs
    };
};

const buildPeaks = (buf, info, peakCount = PEAK_COUNT) => {
    const count = Math.max(2, Math.min(peakCount, info.sampleCount || peakCount));
    const hop = Math.max(1, Math.floor(info.sampleCount / count));
    const peaksL = new Array(count).fill(0);
    const peaksR = new Array(count).fill(0);
    for (let i = 0; i < count; i += 1) {
        const start = i * hop;
        let maxL = 0;
        let maxR = 0;
        for (let s = 0; s < hop && start + s < info.sampleCount; s += 1) {
            const off = info.dataStart + ((start + s) * 4);
            if (off + 4 > buf.length) {
                break;
            }
            const left = Math.abs(buf.readInt16LE(off));
            const right = Math.abs(buf.readInt16LE(off + 2));
            if (left > maxL) {
                maxL = left;
            }
            if (right > maxR) {
                maxR = right;
            }
        }
        peaksL[i] = Math.round((maxL / 32767) * 255);
        peaksR[i] = Math.round((maxR / 32767) * 255);
    }
    return { peaksL, peaksR };
};

const describeWav = (buf) => {
    const info = parseWavPcm16Stereo(buf);
    const peaks = buildPeaks(buf, info);
    return {
        durationMs: info.durationMs,
        sampleRate: info.sampleRate,
        ...peaks
    };
};

module.exports = {
    PEAK_COUNT,
    parseWavPcm16Stereo,
    buildPeaks,
    describeWav
};
