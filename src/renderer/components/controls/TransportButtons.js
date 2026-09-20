const React = require('react');

const Glyph = ({ children, viewBox = '0 0 24 24' }) => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox,
    className: 'transport-glyph',
    fill: 'currentColor',
    'aria-hidden': true
}, children);

const ICONS = {
    back: React.createElement(Glyph, null,
        React.createElement('path', { d: 'M6 5h2.2v14H6zM18.5 6.2v11.6L9.4 12z' })
    ),
    play: React.createElement(Glyph, null,
        React.createElement('path', { d: 'M8 5.2v13.6L19.4 12z' })
    ),
    pause: React.createElement(Glyph, null,
        React.createElement('path', { d: 'M7.5 6h3.2v12H7.5zM13.3 6h3.2v12h-3.2z' })
    ),
    stop: React.createElement(Glyph, null,
        React.createElement('path', { d: 'M7 7h10v10H7z' })
    ),
    next: React.createElement(Glyph, null,
        React.createElement('path', { d: 'M15.8 5H18v14h-2.2zM5.5 6.2L14.6 12 5.5 17.8z' })
    ),
    record: React.createElement(Glyph, null,
        React.createElement('circle', { cx: 12, cy: 12, r: 8 })
    )
};

const TransportButton = ({ action, label, onClick, disabled, accent, record }) => React.createElement('button', {
    type: 'button',
    className: `transport-btn ${accent ? 'is-play' : ''} ${record ? 'is-record' : ''}`,
    title: label,
    'aria-label': label,
    disabled: Boolean(disabled),
    onClick
}, ICONS[action]);

const TransportButtons = ({
    isPlaying,
    isRecording,
    disabled,
    recordDisabled,
    onPlay,
    onPause,
    onStop,
    onBack,
    onNext,
    onRecord
}) => React.createElement('div', {
    className: 'transport-bar'
},
    React.createElement(TransportButton, {
        action: 'back',
        label: 'Back',
        onClick: onBack,
        disabled
    }),
    isPlaying
        ? React.createElement(TransportButton, {
            action: 'pause',
            label: 'Pause',
            onClick: onPause,
            disabled,
            accent: true
        })
        : React.createElement(TransportButton, {
            action: 'play',
            label: 'Play',
            onClick: onPlay,
            disabled,
            accent: true
        }),
    React.createElement(TransportButton, {
        action: 'stop',
        label: 'Stop',
        onClick: onStop,
        disabled
    }),
    React.createElement(TransportButton, {
        action: 'next',
        label: 'Next',
        onClick: onNext,
        disabled
    }),
    onRecord && React.createElement(TransportButton, {
        action: 'record',
        label: isRecording ? 'Stop recording' : 'Record',
        onClick: onRecord,
        disabled: recordDisabled,
        record: true
    })
);

module.exports = TransportButtons;
