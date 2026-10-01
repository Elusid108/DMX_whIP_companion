// Timeline overview from a DMXREC file on disk. The bucketing itself is
// core code (src/engine/core/timelineOverview.js).
const fs = require('fs');
const { HEADER_SIZE, walkRecording } = require('./dmxRecording');
const core = require('../../engine/core/timelineOverview');
const { DEFAULT_BUCKET_MS, ingestSample, finalizeTracks, emptyTracks } = core;

const buildTimelineOverview = (filePath, options = {}) => {
    const bucketMs = Math.max(1, Number(options.bucketMs) || DEFAULT_BUCKET_MS);
    const stat = fs.statSync(filePath);
    const size = stat.size;

    if (size < HEADER_SIZE) {
        throw new Error('File is too small to be a recording');
    }

    const tracks = emptyTracks();
    walkRecording(filePath, (frameBuf, info) => {
        ingestSample(
            tracks,
            info.timestamp,
            info.universe,
            info.protocol,
            (ch) => frameBuf[10 + ch],
            bucketMs
        );
    });
    return finalizeTracks(tracks, bucketMs);
};

module.exports = {
    ...core,
    buildTimelineOverview
};
