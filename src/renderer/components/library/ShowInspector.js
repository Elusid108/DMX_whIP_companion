const React = require('react');
const { useEffect, useState } = React;

const formatDuration = (ms) => {
    const value = Number(ms) || 0;
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const hundredths = Math.floor((value % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${hundredths.toString().padStart(2, '0')}`;
};

const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (ms) => {
    if (!ms) {
        return '—';
    }
    return new Date(ms).toLocaleString();
};

const formatRate = (rate) => {
    if (!rate) {
        return '0';
    }
    return Number(rate).toFixed(1);
};

const protocolLabel = (protocols) => {
    if (!protocols || protocols.length === 0) {
        return '—';
    }
    return protocols.map((protocol) => (protocol === 'artnet' ? 'Art-Net' : 'sACN')).join(', ');
};

const Kv = ({ label, value }) => React.createElement('div', {
    className: 'kv-row text-sm'
},
    React.createElement('span', { className: 'text-xs text-zinc-500 w-24 flex-none' }, label),
    React.createElement('span', { className: 'truncate' }, value)
);

const ClickToEdit = ({
    value,
    placeholder,
    multiline,
    disabled,
    className,
    onCommit
}) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value || '');

    useEffect(() => {
        if (!editing) {
            setDraft(value || '');
        }
    }, [value, editing]);

    const commit = () => {
        setEditing(false);
        onCommit(draft);
    };

    if (!editing) {
        return React.createElement('button', {
            type: 'button',
            className: `text-left w-full min-h-[1.75rem] ${className || ''} ${value ? '' : 'text-zinc-500 italic'}`,
            disabled,
            onClick: () => setEditing(true)
        }, value || placeholder);
    }

    const shared = {
        className: 'field',
        value: draft,
        autoFocus: true,
        disabled,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
            if (event.key === 'Escape') {
                setDraft(value || '');
                setEditing(false);
            }
            if (event.key === 'Enter' && !multiline) {
                event.preventDefault();
                commit();
            }
        }
    };

    return multiline
        ? React.createElement('textarea', { ...shared, className: 'field min-h-[5rem]' })
        : React.createElement('input', shared);
};

const countLooks = (node) => {
    if (!node) {
        return 0;
    }
    return (node.children || []).reduce((sum, child) => {
        if (child.type === 'show') {
            return sum + 1;
        }
        return sum + countLooks(child);
    }, 0);
};

const ShowInspector = ({
    selection,
    show,
    folder,
    name,
    notes,
    busy,
    onNameChange,
    onNotesChange,
    onFolderNameChange,
    onDelete,
    onDeleteFolder
}) => {
    if (!selection) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'Select a look or folder.');
    }

    if (selection.type === 'folder') {
        const looks = countLooks(folder);
        return React.createElement('div', {
            className: 'overflow-y-auto h-full'
        },
            React.createElement('div', {
                className: 'flex flex-col gap-3 max-w-xl mx-auto w-full'
            },
                React.createElement(ClickToEdit, {
                    value: folder ? folder.name : '',
                    placeholder: 'Folder name',
                    disabled: busy,
                    className: 'text-lg font-medium',
                    onCommit: (value) => {
                        if (folder && folder.id) {
                            onFolderNameChange(folder.id, value);
                        }
                    }
                }),
                React.createElement('p', {
                    className: 'readout'
                }, looks === 1 ? '1 look' : `${looks} looks`),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-danger self-start',
                    disabled: busy,
                    onClick: onDeleteFolder
                }, 'Delete folder')
            )
        );
    }

    if (!show) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'Select a look to see details.');
    }

    return React.createElement('div', {
        className: 'overflow-y-auto h-full'
    },
        React.createElement('div', {
            className: 'flex flex-col gap-3 max-w-xl mx-auto w-full'
        },
            React.createElement(ClickToEdit, {
                value: name,
                placeholder: 'Untitled look',
                disabled: busy,
                className: 'text-lg font-medium',
                onCommit: onNameChange
            }),
            React.createElement(ClickToEdit, {
                value: notes,
                placeholder: 'Add notes',
                multiline: true,
                disabled: busy,
                onCommit: onNotesChange
            }),
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-1.5'
            },
                React.createElement(Kv, { label: 'Duration', value: formatDuration(show.duration) }),
                React.createElement(Kv, { label: 'Size', value: formatBytes(show.size) }),
                React.createElement(Kv, { label: 'Frames', value: String(show.frameCount || 0) }),
                React.createElement(Kv, { label: 'Packet rate', value: `${formatRate(show.packetRate)} /s` }),
                React.createElement(Kv, { label: 'Protocol', value: protocolLabel(show.protocols) }),
                React.createElement(Kv, { label: 'Created', value: formatDate(show.created) }),
                React.createElement(Kv, { label: 'Modified', value: formatDate(show.modified) })
            ),
            show.error && React.createElement('div', {
                className: 'text-sm text-red-500'
            }, show.error),
            show.perUniverse && show.perUniverse.length > 0 && React.createElement('div', {
                className: 'overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800'
            },
                React.createElement('table', {
                    className: 'w-full text-xs text-left'
                },
                    React.createElement('thead', null,
                        React.createElement('tr', {
                            className: 'text-zinc-500'
                        },
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Universe'),
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Protocol'),
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Packets'),
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Rate /s'),
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Woken ch')
                        )
                    ),
                    React.createElement('tbody', null,
                        show.perUniverse.map((row) => React.createElement('tr', {
                            key: `${row.protocol}-${row.id}`,
                            className: 'border-t border-zinc-200 dark:border-zinc-800'
                        },
                            React.createElement('td', { className: 'py-1.5 px-2' }, row.id),
                            React.createElement('td', { className: 'py-1.5 px-2' }, row.protocol === 'artnet' ? 'Art-Net' : 'sACN'),
                            React.createElement('td', { className: 'py-1.5 px-2' }, row.packets),
                            React.createElement('td', { className: 'py-1.5 px-2' }, formatRate(row.rate)),
                            React.createElement('td', { className: 'py-1.5 px-2' }, row.wokenChannels)
                        ))
                    )
                )
            ),
            React.createElement('button', {
                type: 'button',
                className: 'btn-danger self-start',
                disabled: busy,
                onClick: onDelete
            }, 'Delete')
        )
    );
};

module.exports = ShowInspector;
