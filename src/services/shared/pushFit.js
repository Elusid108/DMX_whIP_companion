const { channelsPerPixel, normalizeOutputs } = require('./pixelMap');

const UNIVERSE_SIZE = 512;

const toAddr = (universe, channel) => (
    (Number(universe) || 0) * UNIVERSE_SIZE + (Math.max(1, Number(channel) || 1) - 1)
);

const fromAddr = (addr) => {
    const n = Math.max(0, Number(addr) || 0);
    return {
        universe: Math.floor(n / UNIVERSE_SIZE),
        channel: (n % UNIVERSE_SIZE) + 1
    };
};

const formatAddr = (universe, channel) => `U${universe}.${channel}`;

const formatSpan = (span) => {
    if (!span || span.activeChannels <= 0) {
        return 'no active channels';
    }
    return `${formatAddr(span.startUniverse, span.startChannel)}–${span.endUniverse}.${span.endChannel} · ${span.activeChannels} ch`;
};

const protoLabel = (protocol) => (
    protocol === 'sacn' ? 'sACN' : protocol === 'artnet' ? 'Art-Net' : String(protocol || '')
);

const liveLockedStatus = (status, error) => {
    if (status && status.live) {
        return true;
    }
    const msg = String(error || '');
    return /live|busy|lighting/i.test(msg);
};

const protoMatches = (deviceProto, fileProto) => {
    const device = String(deviceProto || 'auto').toLowerCase();
    if (!device || device === 'auto' || device === 'mixed') {
        return true;
    }
    return device === fileProto;
};

const pickFileSpan = (scan, deviceProto) => {
    const spans = (scan && scan.spans) || {};
    const device = String(deviceProto || 'auto').toLowerCase();
    if (device === 'sacn' && spans.sacn) {
        return { proto: 'sacn', span: spans.sacn };
    }
    if (device === 'artnet' && spans.artnet) {
        return { proto: 'artnet', span: spans.artnet };
    }
    if (spans.artnet && !spans.sacn) {
        return { proto: 'artnet', span: spans.artnet };
    }
    if (spans.sacn && !spans.artnet) {
        return { proto: 'sacn', span: spans.sacn };
    }
    if (spans.artnet && spans.sacn) {
        return spans.artnet.activeChannels >= spans.sacn.activeChannels
            ? { proto: 'artnet', span: spans.artnet }
            : { proto: 'sacn', span: spans.sacn };
    }
    if (scan && scan.activeChannels > 0) {
        const proto = (scan.protocols && scan.protocols[0]) || 'artnet';
        const ranges = (scan.perUniverse || [])
            .filter((entry) => (
                entry.wokenChannels > 0
                && (!entry.protocol || entry.protocol === proto)
            ))
            .map((entry) => ({
                universe: entry.id,
                protocol: entry.protocol || proto,
                firstCh: entry.firstWoken || 1,
                lastCh: entry.wokenChannels,
                firstAddr: toAddr(entry.id, entry.firstWoken || 1),
                lastAddr: toAddr(entry.id, entry.wokenChannels)
            }));
        return {
            proto,
            span: {
                startUniverse: scan.startUniverse || 0,
                startChannel: scan.startChannel || 1,
                endUniverse: scan.endUniverse || 0,
                endChannel: scan.endChannel || 1,
                activeChannels: scan.activeChannels,
                firstAddr: toAddr(scan.startUniverse || 0, scan.startChannel || 1),
                lastAddr: toAddr(scan.endUniverse || 0, scan.endChannel || 1),
                ranges
            }
        };
    }
    return { proto: 'artnet', span: null };
};

const segCapacity = (seg = {}) => {
    const chPx = Number(seg.ch_px) || channelsPerPixel(seg);
    const count = Math.max(0, Number(seg.count) || 0);
    return { count, chPx, capacity: count * chPx };
};

const output0Segs = (status) => {
    if (Array.isArray(status && status.outputs) && status.outputs[0] && Array.isArray(status.outputs[0].segs)) {
        return status.outputs[0].segs;
    }
    if (status && status.map) {
        return [status.map];
    }
    const outputs = normalizeOutputs(status || {});
    return (outputs[0] && outputs[0].segs) || [];
};

const deviceWindowFromStatus = (status) => {
    const outputs = Array.isArray(status && status.outputs) ? status.outputs : [];
    const segs = output0Segs(status);
    if (!segs.length) {
        return null;
    }
    const first = segs[0];
    const proto = String(first.proto || (status && status.proto) || 'auto').toLowerCase();
    const startCh = Math.max(1, Number(first.ch) || 1);
    const startArtNet = Number(first.artnet != null ? first.artnet : 0);
    const startSacn = Number(first.sacn != null ? first.sacn : startArtNet + 1);
    let capacity = 0;
    let count = 0;
    let chPx = 3;
    segs.forEach((seg) => {
        const next = segCapacity(seg);
        capacity += next.capacity;
        count += next.count;
        chPx = next.chPx || chPx;
    });
    if (capacity <= 0) {
        return null;
    }
    return {
        proto,
        startArtNet,
        startSacn,
        startCh,
        count,
        chPx,
        capacity,
        extraOutputs: outputs.length > 1,
        artnet: {
            startUni: startArtNet,
            startCh,
            firstAddr: toAddr(startArtNet, startCh),
            lastAddr: toAddr(startArtNet, startCh) + capacity - 1,
            capacity
        },
        sacn: {
            startUni: startSacn,
            startCh,
            firstAddr: toAddr(startSacn, startCh),
            lastAddr: toAddr(startSacn, startCh) + capacity - 1,
            capacity
        }
    };
};

const windowForProto = (device, fileProto) => {
    if (!device) {
        return null;
    }
    return fileProto === 'sacn' ? device.sacn : device.artnet;
};

const spanRanges = (span) => {
    if (!span) {
        return [];
    }
    if (Array.isArray(span.ranges) && span.ranges.length) {
        return span.ranges;
    }
    if (span.firstAddr == null || span.lastAddr == null) {
        return [];
    }
    return [{ firstAddr: span.firstAddr, lastAddr: span.lastAddr }];
};

const shiftRanges = (ranges, delta) => (ranges || []).map((range) => ({
    ...range,
    firstAddr: range.firstAddr + delta,
    lastAddr: range.lastAddr + delta
}));

const uncoveredCount = (firstAddr, lastAddr, windows) => {
    const span = lastAddr - firstAddr + 1;
    if (span <= 0) {
        return 0;
    }
    const cuts = (windows || [])
        .map((window) => ({
            start: Math.max(firstAddr, window.firstAddr),
            end: Math.min(lastAddr, window.lastAddr)
        }))
        .filter((window) => window.start <= window.end)
        .sort((a, b) => a.start - b.start);
    let last = firstAddr - 1;
    let covered = 0;
    cuts.forEach((window) => {
        const start = Math.max(window.start, last + 1);
        if (start <= window.end) {
            covered += window.end - start + 1;
            last = Math.max(last, window.end);
        }
    });
    return Math.max(0, span - covered);
};

const uncoveredRanges = (ranges, windows, delta = 0) => (
    (ranges || []).reduce((sum, range) => (
        sum + uncoveredCount(range.firstAddr + delta, range.lastAddr + delta, windows)
    ), 0)
);

const overlapRanges = (ranges, window, delta = 0) => {
    if (!window) {
        return null;
    }
    let first = null;
    let last = null;
    (ranges || []).forEach((range) => {
        const start = Math.max(range.firstAddr + delta, window.firstAddr);
        const end = Math.min(range.lastAddr + delta, window.lastAddr);
        if (start > end) {
            return;
        }
        if (first == null || start < first) {
            first = start;
        }
        if (last == null || end > last) {
            last = end;
        }
    });
    if (first == null) {
        return null;
    }
    return { firstAddr: first, lastAddr: last, activeChannels: last - first + 1 };
};

const containsRanges = (window, ranges) => (
    Boolean(window)
    && (ranges || []).length > 0
    && ranges.every((range) => (
        range.firstAddr >= window.firstAddr && range.lastAddr <= window.lastAddr
    ))
);

const containsSpan = (window, span) => containsRanges(window, spanRanges(span));

const startsMatch = (window, span) => (
    Boolean(window && span)
    && window.firstAddr === span.firstAddr
);

const pickSlide = (span, windows) => {
    if (!span) {
        return { delta: 0, uncovered: 0 };
    }
    const ranges = spanRanges(span);
    const aligned = uncoveredRanges(ranges, windows, 0);
    let best = { delta: 0, uncovered: aligned, abs: 0 };
    const starts = [...new Set((windows || []).map((window) => window.firstAddr))];
    starts.forEach((start) => {
        const delta = start - span.firstAddr;
        const uncovered = uncoveredRanges(ranges, windows, delta);
        const abs = Math.abs(delta);
        if (uncovered < best.uncovered || (uncovered === best.uncovered && abs < best.abs)) {
            best = { delta, uncovered, abs };
        }
    });
    return best;
};

const overlappingKind = (kind) => (
    kind === 'fit' || kind === 'shift' || kind === 'slice' || kind === 'slice-shift'
);

const destProtoFor = (deviceProto, fileProto) => {
    const device = String(deviceProto || 'auto').toLowerCase();
    if (device === 'artnet' || device === 'sacn') {
        return device;
    }
    return fileProto === 'sacn' ? 'sacn' : 'artnet';
};

const deviceRow = ({
    device,
    window,
    file,
    kind,
    level,
    label,
    slideDelta = 0,
    uncovered = 0,
    extra = {}
}) => {
    const dest = window ? fromAddr(window.firstAddr) : { universe: 0, channel: 1 };
    const overlap = window && file.span
        ? overlapRanges(spanRanges(file.span), window, slideDelta)
        : null;
    return {
        id: device.id,
        ip: device.ip,
        mac: device.mac || '',
        longName: device.longName || device.shortName || device.ip,
        shortName: device.shortName || '',
        proto: (window && destProtoFor(window.proto || (device.window && device.window.proto), file.proto))
            || file.proto,
        deviceProto: (device.window && device.window.proto) || 'auto',
        startUni: dest.universe,
        startCh: dest.channel,
        count: (device.window && device.window.count) || 0,
        chPx: (device.window && device.window.chPx) || 3,
        capacity: (device.window && device.window.capacity) || 0,
        extraOutputs: Boolean(device.window && device.window.extraOutputs),
        supportsSync: Boolean(device.supportsSync),
        kind,
        level,
        label,
        slideDelta,
        uncovered,
        fileStart: file.span
            ? { universe: file.span.startUniverse, channel: file.span.startChannel }
            : null,
        destStart: dest,
        overlap,
        destFirstAddr: overlap ? overlap.firstAddr : (window ? window.firstAddr : 0),
        destLastAddr: overlap ? overlap.lastAddr : (window ? window.lastAddr : 0),
        destProto: destProtoFor((device.window && device.window.proto) || 'auto', file.proto),
        ...extra
    };
};

const analyzeLook = (look, selected) => {
    const ready = selected.filter((row) => row.window && !row.live && !row.statusError);
    const fileFor = (row) => pickFileSpan(look.scan, row.window && row.window.proto);
    const primary = pickFileSpan(look.scan, ready[0] && ready[0].window && ready[0].window.proto);
    const devices = selected.map((row) => {
        if (row.live) {
            return deviceRow({
                device: row,
                window: row.window && windowForProto(row.window, primary.proto),
                file: primary,
                kind: 'live',
                level: 'red',
                label: 'Live locked'
            });
        }
        if (row.statusError || !row.window) {
            return deviceRow({
                device: row,
                window: null,
                file: primary,
                kind: 'no-status',
                level: 'red',
                label: row.statusError || 'No status'
            });
        }
        const file = fileFor(row);
        const window = windowForProto(row.window, file.proto);
        if (!file.span) {
            return deviceRow({
                device: row,
                window,
                file,
                kind: 'empty',
                level: 'red',
                label: 'File has no active channels'
            });
        }
        const matched = protoMatches(row.window.proto, file.proto);
        const exact = matched && startsMatch(window, file.span) && containsSpan(window, file.span);
        if (exact) {
            return deviceRow({
                device: row,
                window,
                file,
                kind: 'fit',
                level: 'green',
                label: 'Fits'
            });
        }
        const slideDelta = window.firstAddr - file.span.firstAddr;
        if (containsRanges(window, shiftRanges(spanRanges(file.span), slideDelta))) {
            const dest = fromAddr(window.firstAddr);
            return deviceRow({
                device: row,
                window,
                file,
                kind: 'shift',
                level: 'amber',
                label: `Will shift ${formatAddr(file.span.startUniverse, file.span.startChannel)} → ${formatAddr(dest.universe, dest.channel)}`,
                slideDelta
            });
        }
        return deviceRow({
            device: row,
            window,
            file,
            kind: 'needs-batch',
            level: 'amber',
            label: 'Needs other nodes'
        });
    });

    const batchable = devices.filter((row) => row.kind !== 'no-status' && row.kind !== 'live' && row.kind !== 'empty');
    const windows = batchable.map((row) => ({
        firstAddr: toAddr(row.startUni, row.startCh),
        lastAddr: toAddr(row.startUni, row.startCh) + row.capacity - 1
    }));
    const file = primary;
    let batch = {
        level: 'red',
        kind: 'uncovered',
        label: 'Uncovered',
        slideDelta: 0,
        uncovered: file.span ? file.span.activeChannels : 0,
        sync: false
    };

    if (!file.span) {
        batch.label = 'File has no active channels';
    } else if (!batchable.length) {
        batch.label = 'No idle nodes with a patch';
        batch.uncovered = file.span.activeChannels;
    } else if (batchable.every((row) => row.kind === 'fit')) {
        batch = {
            level: 'green',
            kind: 'fit',
            label: batchable.length > 1 ? 'Fits · sync group' : 'Fits',
            slideDelta: 0,
            uncovered: 0,
            sync: batchable.length > 1
        };
    } else if (batchable.every((row) => row.kind === 'fit' || row.kind === 'shift')) {
        const onlyShift = batchable.some((row) => row.kind === 'shift');
        batch = {
            level: onlyShift ? 'amber' : 'green',
            kind: onlyShift ? 'shift' : 'fit',
            label: onlyShift
                ? (batchable.length > 1 ? 'Will shift · sync group' : 'Will shift')
                : (batchable.length > 1 ? 'Fits · sync group' : 'Fits'),
            slideDelta: 0,
            uncovered: 0,
            sync: batchable.length > 1
        };
    } else {
        const slide = pickSlide(file.span, windows);
        devices.forEach((row, index) => {
            if (row.kind === 'no-status' || row.kind === 'live' || row.kind === 'empty') {
                return;
            }
            const window = windows[batchable.indexOf(row)] || windows[0];
            const overlap = overlapRanges(spanRanges(file.span), window, slide.delta);
            row.slideDelta = slide.delta;
            row.overlap = overlap;
            if (overlap) {
                const from = fromAddr(overlap.firstAddr);
                const to = fromAddr(overlap.lastAddr);
                row.destFirstAddr = overlap.firstAddr;
                row.destLastAddr = overlap.lastAddr;
                row.kind = slide.delta === 0 ? 'slice' : 'slice-shift';
                row.level = 'amber';
                row.label = `${slide.delta === 0 ? 'Slice' : 'Shift + slice'} ${formatAddr(from.universe, from.channel)}–${to.universe}.${to.channel}`;
            } else {
                row.kind = 'no-overlap';
                row.level = 'amber';
                row.label = 'No overlap';
            }
            devices[index] = row;
        });
        const overlapping = devices.filter((row) => overlappingKind(row.kind));
        const covered = Math.max(0, file.span.activeChannels - slide.uncovered);
        if (!overlapping.length) {
            batch = {
                level: 'red',
                kind: 'uncovered',
                label: 'No overlap',
                slideDelta: slide.delta,
                uncovered: slide.uncovered,
                sync: false
            };
        } else if (slide.uncovered === 0) {
            batch = {
                level: 'green',
                kind: slide.delta === 0 ? 'slice' : 'slice-shift',
                label: slide.delta === 0
                    ? (overlapping.length > 1 ? 'Split across nodes · sync' : 'Slice')
                    : (overlapping.length > 1 ? 'Shift + split · sync' : 'Shift + slice'),
                slideDelta: slide.delta,
                uncovered: 0,
                sync: overlapping.length > 1
            };
        } else {
            batch = {
                level: 'amber',
                kind: 'partial',
                label: `Partial · ${covered} of ${file.span.activeChannels} ch`,
                slideDelta: slide.delta,
                uncovered: slide.uncovered,
                sync: overlapping.length > 1
            };
            devices.forEach((row) => {
                if (overlappingKind(row.kind)) {
                    row.uncovered = slide.uncovered;
                }
            });
        }
    }

    const overlapping = devices.filter((row) => overlappingKind(row.kind));
    const blocked = !file.span || overlapping.length === 0;
    const fileLabel = file.span
        ? `${protoLabel(file.proto)} ${formatSpan(file.span)}`
        : 'No active channels';

    return {
        filePath: look.filePath,
        name: look.name,
        dest: look.dest || null,
        scanError: look.scan && look.scan.error,
        proto: file.proto,
        span: file.span,
        fileLabel,
        devices,
        batch,
        blocked
    };
};

const analyzePush = (looks, deviceStates) => {
    const selected = (deviceStates || []).map((row) => {
        const status = row.status || null;
        const error = row.statusError || '';
        return {
            id: row.id,
            ip: row.ip,
            mac: row.mac || '',
            longName: row.longName || row.shortName || row.ip,
            shortName: row.shortName || '',
            status,
            statusError: error,
            live: liveLockedStatus(status, error),
            window: status ? deviceWindowFromStatus(status) : null,
            supportsSync: Boolean(status && status.play && status.play.sync)
        };
    });

    const lookRows = (looks || []).map((look) => analyzeLook(look, selected));
    const anyPushable = lookRows.some((look) => !look.blocked);
    const blocked = !anyPushable;
    const anyShift = lookRows.some((look) => (
        look.batch.kind === 'shift' || look.batch.kind === 'slice-shift'
    ));
    const anySlice = lookRows.some((look) => (
        look.batch.kind === 'slice' || look.batch.kind === 'slice-shift'
    ));
    const anyPartial = lookRows.some((look) => look.batch.kind === 'partial');
    const needsSync = lookRows.some((look) => look.batch.sync);
    const firmwareSync = selected.some((row) => row.supportsSync);
    let pushLabel = 'Push';
    if (!anyPartial && anySlice) {
        pushLabel = 'Push split + sync';
    } else if (!anyPartial && anyShift) {
        pushLabel = 'Push and shift';
    }
    let overallKind = 'fit';
    let overallLevel = 'green';
    let overallLabel = needsSync ? 'Good to go · sync group' : 'Good to go';
    if (blocked) {
        overallKind = 'uncovered';
        overallLevel = 'red';
        const redLook = lookRows.find((look) => look.blocked);
        overallLabel = (redLook && redLook.batch.label) || 'Cannot push';
    } else if (anyPartial) {
        overallKind = 'partial';
        overallLevel = 'amber';
        const partialLook = lookRows.find((look) => look.batch.kind === 'partial');
        overallLabel = (partialLook && partialLook.batch.label) || 'Partial coverage';
    } else if (anySlice) {
        overallKind = anyShift ? 'slice-shift' : 'slice';
        overallLevel = 'green';
        overallLabel = anyShift ? 'Shift + split covered · sync' : 'Split covered · sync';
    } else if (anyShift) {
        overallKind = 'shift';
        overallLevel = 'amber';
        overallLabel = needsSync ? 'Will shift · sync group' : 'Will shift';
    }

    return {
        looks: lookRows,
        devices: selected.map((row) => ({
            id: row.id,
            ip: row.ip,
            mac: row.mac,
            longName: row.longName,
            window: row.window,
            live: row.live,
            statusError: row.statusError,
            supportsSync: row.supportsSync
        })),
        overall: {
            level: overallLevel,
            kind: overallKind,
            label: overallLabel,
            canPush: anyPushable && lookRows.length > 0 && selected.length > 0,
            pushLabel,
            needsSync,
            needsFirmwareSync: needsSync && !firmwareSync
        }
    };
};

const slicePlan = (lookRow, deviceId) => {
    const row = (lookRow.devices || []).find((item) => item.id === deviceId);
    if (!row || row.level === 'red' || row.kind === 'no-overlap') {
        return null;
    }
    const span = lookRow.span;
    if (!span) {
        return null;
    }
    return {
        filePath: lookRow.filePath,
        destPath: lookRow.dest || undefined,
        name: lookRow.name,
        proto: lookRow.proto,
        destProto: row.destProto,
        slideDelta: row.slideDelta || 0,
        destFirstAddr: row.destFirstAddr,
        destLastAddr: row.destLastAddr,
        kind: row.kind
    };
};

module.exports = {
    UNIVERSE_SIZE,
    toAddr,
    fromAddr,
    formatAddr,
    formatSpan,
    protoLabel,
    liveLockedStatus,
    protoMatches,
    pickFileSpan,
    deviceWindowFromStatus,
    windowForProto,
    uncoveredCount,
    uncoveredRanges,
    overlapRanges,
    analyzePush,
    slicePlan
};
