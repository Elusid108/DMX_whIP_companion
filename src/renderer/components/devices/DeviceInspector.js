const React = require('react');

const Kv = ({ label, value }) => React.createElement('div', {
    className: 'kv-row text-sm'
},
    React.createElement('span', { className: 'text-xs text-zinc-500 w-24 flex-none' }, label),
    React.createElement('span', { className: 'truncate' }, value == null || value === '' ? '—' : String(value))
);

const formatSd = (sd) => {
    if (!sd) {
        return '—';
    }
    if (!sd.ok) {
        return 'not mounted';
    }
    return `${sd.size_mb} MB · ${sd.used_mb} used · ${sd.free_mb} free`;
};

const DeviceInspector = ({
    device,
    status,
    statusError,
    identifying,
    onIdentify
}) => {
    if (!device) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'Select a node to see details.');
    }

    const universes = (device.universes && device.universes.length)
        ? device.universes.join(', ')
        : String(device.universe ?? 0);
    const idle = Boolean(status) && !statusError;

    return React.createElement('div', {
        className: 'overflow-y-auto h-full'
    },
        React.createElement('div', {
            className: 'flex flex-col gap-2 w-[60%] mx-auto'
        },
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-1.5'
            },
                React.createElement(Kv, { label: 'Name', value: device.longName || device.shortName }),
                React.createElement(Kv, { label: 'IP', value: device.ip }),
                React.createElement(Kv, { label: 'MAC', value: device.mac }),
                React.createElement(Kv, { label: 'NIC', value: `${device.nicName} (${device.nicIp})` }),
                React.createElement(Kv, { label: 'Universe', value: universes }),
                React.createElement(Kv, { label: 'Seen', value: device.stale ? 'Stale' : 'Live' })
            ),
            statusError && React.createElement('div', {
                className: 'text-sm text-red-500'
            }, statusError),
            status && React.createElement('div', {
                className: 'grid grid-cols-2 gap-1.5'
            },
                React.createElement(Kv, { label: 'State', value: status.state }),
                React.createElement(Kv, { label: 'Firmware', value: status.ver }),
                React.createElement(Kv, { label: 'Brightness', value: status.bri }),
                React.createElement(Kv, { label: 'Protocol', value: status.proto }),
                React.createElement(Kv, { label: 'FPS', value: status.fps }),
                React.createElement(Kv, { label: 'Buffer', value: status.buf }),
                React.createElement(Kv, { label: 'STA IP', value: status.ip }),
                React.createElement(Kv, { label: 'SoftAP', value: status.ap_ip }),
                React.createElement(Kv, { label: 'SD', value: formatSd(status.sd) })
            ),
            React.createElement('div', {
                className: 'flex flex-wrap gap-1.5 pt-1'
            },
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-primary',
                    disabled: identifying || !idle || device.stale,
                    onClick: onIdentify
                }, identifying ? 'Identifying…' : 'Identify')
            )
        )
    );
};

module.exports = DeviceInspector;
