const React = require('react');
const { useEffect, useRef } = React;

const RecordingControls = ({
    selectedUniverses,
    isRecording,
    isPlaying,
    recordingPath,
    naming,
    nameDraft,
    onNameDraftChange,
    onNewFile,
    onNewFileCancel,
    onNewFileConfirm,
    onStartRecording,
    onStopRecording,
    onCancelRecording
}) => {
    const nameRef = useRef(null);

    useEffect(() => {
        if (naming && nameRef.current) {
            nameRef.current.focus();
            nameRef.current.select();
        }
    }, [naming]);

    return React.createElement(React.Fragment, null,
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
        }, 'Cancel'),

        naming && React.createElement('div', {
            className: 'flex items-center gap-1.5 min-w-0'
        },
            React.createElement('input', {
                ref: nameRef,
                className: 'field w-40',
                value: nameDraft,
                disabled: isRecording,
                placeholder: 'New recording name',
                onChange: (event) => onNameDraftChange(event.target.value),
                onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        onNewFileConfirm();
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        onNewFileCancel();
                    }
                }
            }),
            React.createElement('button', {
                type: 'button',
                className: 'btn-primary flex-none',
                disabled: isRecording || !String(nameDraft || '').trim(),
                onClick: onNewFileConfirm
            }, 'Create'),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet flex-none',
                disabled: isRecording,
                onClick: onNewFileCancel
            }, 'Cancel')
        )
    );
};

module.exports = RecordingControls;
