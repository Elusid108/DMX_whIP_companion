const React = require('react');

const RecordingControls = ({
    isRecording,
    isPlaying,
    onNewFile,
    onCancelRecording
}) => React.createElement(React.Fragment, null,
    React.createElement('button', {
        type: 'button',
        onClick: onNewFile,
        className: 'btn-quiet',
        disabled: isRecording || isPlaying
    }, 'New File'),

    isRecording && React.createElement('button', {
        type: 'button',
        onClick: onCancelRecording,
        className: 'btn-quiet'
    }, 'Cancel')
);

module.exports = RecordingControls;
