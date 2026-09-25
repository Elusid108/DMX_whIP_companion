const React = require('react');

const START_OPTIONS = [
    ['none', 'No trigger'],
    ['signal-start', 'Signal start'],
    ['signal-modified', 'Signal modified'],
    ['channel', 'Channel']
];

const STOP_OPTIONS = [
    ['none', 'No trigger'],
    ['blackout', '5s blackout'],
    ['signal-cut', 'Signal cut'],
    ['channel', 'Channel']
];

const TriggerSelect = ({ label, value, options, onChange, disabled }) => React.createElement('label', {
    className: 'flex items-center gap-1.5 text-xs text-zinc-500'
},
    label,
    React.createElement('select', {
        className: 'field',
        value,
        disabled,
        'aria-label': label,
        onChange: (event) => onChange(event.target.value)
    }, options.map(([option, text]) => React.createElement('option', {
        key: option,
        value: option
    }, text)))
);

const TriggerChannelFields = ({ value, onChange, disabled, label }) => React.createElement('span', {
    className: 'flex items-center gap-1'
},
    React.createElement('select', {
        className: 'field',
        value: value.protocol,
        disabled,
        'aria-label': `${label} protocol`,
        onChange: (event) => onChange({ ...value, protocol: event.target.value })
    },
        React.createElement('option', { value: 'artnet' }, 'Art-Net'),
        React.createElement('option', { value: 'sacn' }, 'sACN')
    ),
    React.createElement('input', {
        className: 'field w-16',
        type: 'number',
        min: 0,
        title: 'Universe',
        'aria-label': `${label} universe`,
        value: value.universe,
        disabled,
        onChange: (event) => onChange({
            ...value,
            universe: Math.max(0, Math.round(Number(event.target.value) || 0))
        })
    }),
    React.createElement('input', {
        className: 'field w-16',
        type: 'number',
        min: 1,
        max: 512,
        title: 'Channel',
        'aria-label': `${label} channel`,
        value: value.channel,
        disabled,
        onChange: (event) => {
            let channel = Math.round(Number(event.target.value) || 1);
            if (channel < 1) {
                channel = 1;
            }
            if (channel > 512) {
                channel = 512;
            }
            onChange({ ...value, channel });
        }
    })
);

const RecordingControls = ({
    isRecording,
    isArmed,
    isPlaying,
    onNewFile,
    onCancelRecording,
    startMode,
    stopMode,
    startChannel,
    stopChannel,
    onStartMode,
    onStopMode,
    onStartChannel,
    onStopChannel
}) => {
    const locked = Boolean(isRecording || isArmed);
    return React.createElement(React.Fragment, null,
        React.createElement('button', {
            type: 'button',
            onClick: onNewFile,
            className: 'btn-quiet',
            disabled: isRecording || isArmed || isPlaying
        }, 'New File'),
        (isRecording || isArmed) && React.createElement('button', {
            type: 'button',
            onClick: onCancelRecording,
            className: 'btn-quiet'
        }, 'Cancel'),
        React.createElement(TriggerSelect, {
            label: 'Start',
            value: startMode,
            options: START_OPTIONS,
            disabled: locked,
            onChange: onStartMode
        }),
        startMode === 'channel' && React.createElement(TriggerChannelFields, {
            label: 'Start',
            value: startChannel,
            disabled: locked,
            onChange: onStartChannel
        }),
        React.createElement(TriggerSelect, {
            label: 'Stop',
            value: stopMode,
            options: STOP_OPTIONS,
            disabled: locked,
            onChange: onStopMode
        }),
        stopMode === 'channel' && React.createElement(TriggerChannelFields, {
            label: 'Stop',
            value: stopChannel,
            disabled: locked,
            onChange: onStopChannel
        })
    );
};

module.exports = RecordingControls;
