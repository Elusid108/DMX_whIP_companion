const React = require('react');
const { useEffect, useRef } = React;

const RecordingControls = ({
    selectedUniverses,
    isRecording,
    isPlaying,
    isLoading,
    recordingPath,
    naming,
    nameDraft,
    showLoad,
    onNameDraftChange,
    onNewFile,
    onNewFileCancel,
    onNewFileConfirm,
    onStartRecording,
    onStopRecording,
    onCancelRecording,
    onLoadFile
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

        recordingPath && React.createElement('button', {
            type: 'button',
            onClick: isRecording ? onStopRecording : onStartRecording,
            className: isRecording ? 'btn-danger' : 'btn-primary',
            disabled: isPlaying || (!isRecording && (!selectedUniverses || selectedUniverses.size === 0))
        }, isRecording ? 'STOP' : 'Record'),

        isRecording && React.createElement('button', {
            type: 'button',
            onClick: onCancelRecording,
            className: 'btn-quiet'
        }, 'Cancel'),

        showLoad && React.createElement('button', {
            type: 'button',
            onClick: onLoadFile,
            className: 'btn-quiet',
            disabled: isRecording || isLoading
        }, isLoading ? 'Loading...' : 'Load'),

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
