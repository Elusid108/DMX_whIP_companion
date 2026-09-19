const React = require('react');
const { useEffect, useState } = React;

const formatMs = (ms) => {
    const value = Math.max(0, Number(ms) || 0);
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const hundredths = Math.floor((value % 1000) / 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(hundredths).padStart(2, '0')}`;
};

const protocolLabel = (protocols = []) => {
    if (!protocols.length) {
        return '—';
    }
    return protocols.map((item) => (item === 'sacn' ? 'sACN' : 'Art-Net')).join(' + ');
};

const ClipInspector = ({ info, x, y, onClose, onApply }) => {
    const [name, setName] = useState(info.name || '');
    const [startUniverse, setStartUniverse] = useState(info.outputStartUniverse || 0);
    const [startChannel, setStartChannel] = useState(info.outputStartChannel || 1);
    const [destIp, setDestIp] = useState(info.destIp || '');

    useEffect(() => {
        setName(info.name || '');
        setStartUniverse(info.outputStartUniverse || 0);
        setStartChannel(info.outputStartChannel || 1);
        setDestIp(info.destIp || '');
    }, [info]);

    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const apply = () => {
        const channel = Math.max(1, Math.min(512, Math.round(Number(startChannel) || 1)));
        const universe = Math.round(Number(startUniverse) || 0);
        onApply({
            name: name.trim() || info.name || 'Clip',
            universeOffset: universe - (info.startUniverse || 0),
            channelOffset: channel - 1,
            destIp: destIp.trim()
        });
    };

    return React.createElement('div', {
        className: 'timeline-inspector',
        style: { left: `${Math.max(8, x)}px`, top: `${Math.max(8, y)}px` },
        onPointerDown: (event) => event.stopPropagation()
    },
        React.createElement('div', { className: 'flex items-center justify-between gap-3 mb-2' },
            React.createElement('span', { className: 'text-xs font-semibold uppercase tracking-wide text-zinc-500' }, 'Clip'),
            React.createElement('button', { type: 'button', className: 'btn-quiet !px-1.5 !py-0.5', onClick: onClose }, 'Close')
        ),
        React.createElement('label', { className: 'timeline-inspector-field' },
            React.createElement('span', null, 'Name'),
            React.createElement('input', {
                className: 'field w-full',
                value: name,
                onChange: (event) => setName(event.target.value)
            })
        ),
        React.createElement('label', { className: 'timeline-inspector-field' },
            React.createElement('span', null, 'Start universe'),
            React.createElement('input', {
                className: 'field w-full',
                type: 'number',
                value: startUniverse,
                onChange: (event) => setStartUniverse(event.target.value)
            })
        ),
        React.createElement('label', { className: 'timeline-inspector-field' },
            React.createElement('span', null, 'Start channel'),
            React.createElement('input', {
                className: 'field w-full',
                type: 'number',
                min: 1,
                max: 512,
                value: startChannel,
                onChange: (event) => setStartChannel(event.target.value)
            })
        ),
        React.createElement('label', { className: 'timeline-inspector-field' },
            React.createElement('span', null, 'Destination IP'),
            React.createElement('input', {
                className: 'field w-full',
                placeholder: 'Broadcast / multicast',
                value: destIp,
                onChange: (event) => setDestIp(event.target.value)
            })
        ),
        React.createElement('dl', { className: 'timeline-inspector-meta' },
            React.createElement('dt', null, 'Protocols'),
            React.createElement('dd', null, protocolLabel(info.protocols)),
            React.createElement('dt', null, 'Universe span'),
            React.createElement('dd', null, info.universeCount
                ? `${info.startUniverse + (info.universeOffset || 0)}–${info.endUniverse + (info.universeOffset || 0)}`
                : '—'),
            React.createElement('dt', null, 'Woken channels'),
            React.createElement('dd', null, info.wokenChannels || 0),
            React.createElement('dt', null, 'Length'),
            React.createElement('dd', null, formatMs(info.durationMs)),
            React.createElement('dt', null, 'FPS'),
            React.createElement('dd', null, info.fps || 0),
            React.createElement('dt', null, 'Source in / out'),
            React.createElement('dd', null, `${formatMs(info.sourceInMs)} – ${formatMs(info.sourceOutMs)}`),
            React.createElement('dt', null, 'Track'),
            React.createElement('dd', null, (info.trackId || 0) + 1)
        ),
        React.createElement('div', { className: 'flex justify-end gap-1.5 mt-2' },
            React.createElement('button', { type: 'button', className: 'btn-quiet', onClick: onClose }, 'Cancel'),
            React.createElement('button', { type: 'button', className: 'btn-primary', onClick: apply }, 'Apply')
        )
    );
};

module.exports = ClipInspector;
