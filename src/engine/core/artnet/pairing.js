// Which ArtPollReply is a DMX whIP node. Contract owner: firmware
// artnet_rx.cpp (docs/ecosystem/CONTRACTS.md §2). src/main/ipc/network.js
// re-exports whipRejectReason so the firmware-compat rule's path stays true.
const WHIP_OEM = 0x00FF;
const WHIP_REPORT = /^#0001 \[[0-9a-f]{4}\] .+ v\d+\.\d+\.\d+/i;

// '' when the reply is a paired whIP node, else why it was rejected.
const whipRejectReason = (reply) => {
    if (!reply) {
        return 'no-reply';
    }
    if (reply.oem !== WHIP_OEM) {
        return `oem:${reply.oem}`;
    }
    if (reply.bindIndex !== 1) {
        return `bind:${reply.bindIndex}`;
    }
    if (reply.portType !== 0x80) {
        return `port:${reply.portType}`;
    }
    if (reply.style !== 0) {
        return `style:${reply.style}`;
    }
    if (!WHIP_REPORT.test(String(reply.nodeReport || ''))) {
        return `report:${reply.nodeReport || ''}`;
    }
    return '';
};

const isWhipPollReply = (reply) => !whipRejectReason(reply);

// MAC when the node has one, else its IP.
const deviceId = (reply) => {
    if (reply.mac && reply.mac !== '00:00:00:00:00:00') {
        return reply.mac;
    }
    return reply.ip || reply.sourceIp;
};

module.exports = { WHIP_OEM, WHIP_REPORT, whipRejectReason, isWhipPollReply, deviceId };
