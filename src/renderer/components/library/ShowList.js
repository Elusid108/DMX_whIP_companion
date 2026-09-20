const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;
const { findNode, flattenRows, folderContains } = require('../../../services/shared/libraryTree');

const FolderIcon = () => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'w-3.5 h-3.5 flex-none text-zinc-500',
    'aria-hidden': true
},
    React.createElement('path', { d: 'M3 7h6l2 2h10v10H3z' }),
    React.createElement('path', { d: 'M3 7V5h6l2 2' })
);

const Chevron = ({ open, onClick }) => React.createElement('button', {
    type: 'button',
    className: 'flex-none p-0.5 -ml-0.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
    'aria-label': open ? 'Collapse folder' : 'Expand folder',
    onClick: (event) => {
        event.stopPropagation();
        onClick();
    }
}, React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: `w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`,
    'aria-hidden': true
}, React.createElement('path', { d: 'M9 6l6 6-6 6' })));

const FolderPlusIcon = () => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'w-4 h-4',
    'aria-hidden': true
},
    React.createElement('path', { d: 'M3 7h6l2 2h10v10H3z' }),
    React.createElement('path', { d: 'M3 7V5h6l2 2' }),
    React.createElement('path', { d: 'M12 12v6M9 15h6' })
);

const PushSdIcon = () => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'w-4 h-4',
    'aria-hidden': true
},
    React.createElement('path', { d: 'M3 12h8' }),
    React.createElement('path', { d: 'M8 8l4 4-4 4' }),
    React.createElement('path', { d: 'M13 6.5h3.2L20 10v8.5a1.5 1.5 0 0 1-1.5 1.5h-5.5A1.5 1.5 0 0 1 11.5 17V8A1.5 1.5 0 0 1 13 6.5z' }),
    React.createElement('path', { d: 'M15 9.5v3M17.2 9.5v3' })
);

const parseMoveIds = (raw, fallback) => {
    if (Array.isArray(fallback) && fallback.length) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter(Boolean);
        }
    } catch (err) {
        // single id from older drops
    }
    return raw ? [raw] : [];
};

const dropHintFor = (row, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const intoFolder = row.node.type === 'folder' && y > rect.height * 0.28 && y < rect.height * 0.72;
    if (intoFolder) {
        return {
            parentId: row.node.id,
            index: (row.node.children || []).length,
            kind: 'into'
        };
    }
    if (y < rect.height / 2) {
        return { parentId: row.parentId, index: row.index, kind: 'before' };
    }
    return { parentId: row.parentId, index: row.index + 1, kind: 'after' };
};

const ShowList = ({
    tree,
    collapsed,
    selected,
    loadedPath,
    busy,
    playDisabled,
    onSelect,
    onRenameShow,
    onRenameFolder,
    onRenameCompilation,
    onCreateFolder,
    onToggleCollapsed,
    onMove,
    onPlay,
    onQueuePlay,
    onOpenPush,
    canPush,
    onSelectedIdsChange
}) => {
    const [editingId, setEditingId] = useState('');
    const [draft, setDraft] = useState('');
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [anchorId, setAnchorId] = useState('');
    const [dragIds, setDragIds] = useState([]);
    const [dropHint, setDropHint] = useState(null);
    const lastActivated = useRef('');

    useEffect(() => {
        if (onSelectedIdsChange) {
            onSelectedIdsChange([...selectedIds]);
        }
    }, [selectedIds, onSelectedIdsChange]);

    const collapsedSet = useMemo(() => new Set(collapsed || []), [collapsed]);
    const rows = useMemo(
        () => flattenRows(tree || [], 'root', 0, collapsedSet),
        [tree, collapsedSet]
    );
    const dragNodes = useMemo(
        () => dragIds.map((id) => findNode(tree || [], id)).filter(Boolean).map((found) => found.node),
        [dragIds, tree]
    );
    const activeId = useMemo(() => {
        if (!selected) {
            return '';
        }
        if (selected.type === 'folder' || selected.type === 'compilation') {
            return selected.id;
        }
        const found = flattenRows(tree || []).find((row) => (
            row.node.show && row.node.show.filePath === selected.filePath
        ));
        return found ? found.node.id : '';
    }, [selected, tree]);

    useEffect(() => {
        if (!activeId) {
            lastActivated.current = '';
            setSelectedIds(new Set());
            setAnchorId('');
            return;
        }
        if (lastActivated.current === activeId) {
            setSelectedIds((prev) => new Set([...prev].filter((id) => findNode(tree || [], id))));
            return;
        }
        lastActivated.current = activeId;
        setSelectedIds(new Set([activeId]));
        setAnchorId(activeId);
    }, [activeId, tree]);

    const activate = (node) => {
        lastActivated.current = node.id;
        if (node.type === 'folder') {
            onSelect({ type: 'folder', id: node.id });
            return;
        }
        if (node.type === 'compilation') {
            onSelect({ type: 'compilation', id: node.id });
            return;
        }
        if (node.show) {
            onSelect({ type: 'show', filePath: node.show.filePath });
        }
    };

    const beginEdit = (node) => {
        const value = node.type === 'folder'
            ? node.name
            : node.type === 'compilation'
                ? (node.compilation && node.compilation.name) || ''
                : (node.show && node.show.displayName) || '';
        setEditingId(node.id);
        setDraft(value);
    };

    const commitEdit = (node) => {
        const next = String(draft || '').trim();
        setEditingId('');
        if (!next) {
            return;
        }
        if (node.type === 'folder') {
            if (next !== node.name) {
                onRenameFolder(node.id, next);
            }
            return;
        }
        if (node.type === 'compilation') {
            const current = (node.compilation && node.compilation.name) || '';
            if (next !== current && onRenameCompilation) {
                onRenameCompilation(node.id, next);
            }
            return;
        }
        if (node.show && next !== node.show.displayName) {
            onRenameShow(node.show.filePath, next);
        }
    };

    const isActive = (node) => {
        if (!selected) {
            return false;
        }
        if (node.type === 'folder') {
            return selected.type === 'folder' && selected.id === node.id;
        }
        if (node.type === 'compilation') {
            return selected.type === 'compilation' && selected.id === node.id;
        }
        return selected.type === 'show' && node.show && selected.filePath === node.show.filePath;
    };

    const handleRowClick = (event, node) => {
        if (editingId === node.id) {
            return;
        }
        const ctrl = event.ctrlKey || event.metaKey;
        const shift = event.shiftKey;
        if (shift && anchorId) {
            const from = rows.findIndex((row) => row.node.id === anchorId);
            const to = rows.findIndex((row) => row.node.id === node.id);
            if (from >= 0 && to >= 0) {
                const lo = Math.min(from, to);
                const hi = Math.max(from, to);
                setSelectedIds(new Set(rows.slice(lo, hi + 1).map((row) => row.node.id)));
            } else {
                setSelectedIds(new Set([node.id]));
                setAnchorId(node.id);
            }
            activate(node);
            return;
        }
        if (ctrl) {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(node.id)) {
                    next.delete(node.id);
                } else {
                    next.add(node.id);
                }
                return next;
            });
            activate(node);
            return;
        }
        if (selectedIds.size === 1 && selectedIds.has(node.id) && isActive(node)) {
            beginEdit(node);
            return;
        }
        setSelectedIds(new Set([node.id]));
        setAnchorId(node.id);
        activate(node);
    };

    const canDropHint = (hint) => {
        if (!hint || !dragNodes.length) {
            return false;
        }
        const moving = new Set(dragIds);
        if (moving.has(hint.parentId)) {
            return false;
        }
        return dragNodes.every((node) => {
            if (node.id === hint.parentId) {
                return false;
            }
            if (node.type === 'folder' && hint.parentId !== 'root') {
                return !folderContains(node, hint.parentId);
            }
            return true;
        });
    };

    return React.createElement('div', {
        className: 'flex-1 min-h-0 flex flex-col'
    },
        React.createElement('div', {
            className: 'flex-none flex items-center gap-1 pb-2 border-b border-zinc-200 dark:border-zinc-800'
        },
            React.createElement('button', {
                type: 'button',
                className: 'btn-primary flex-1 justify-center min-w-0',
                disabled: busy || playDisabled,
                onClick: onPlay
            }, 'Import to Studio'),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet flex-none p-1.5',
                title: 'Push to SD',
                'aria-label': 'Push to SD',
                disabled: busy || !canPush,
                onClick: onOpenPush
            }, React.createElement(PushSdIcon)),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet flex-none p-1.5',
                title: 'New folder',
                'aria-label': 'New folder',
                disabled: busy,
                onClick: onCreateFolder
            }, React.createElement(FolderPlusIcon))
        ),
        React.createElement('div', {
            className: 'flex-1 min-h-0 overflow-y-auto py-2 flex flex-col gap-0.5'
        },
            rows.length === 0 && React.createElement('div', {
                className: 'text-sm text-zinc-500 italic p-2'
            }, 'No looks yet. Use New File or Import.'),
            rows.map((row) => {
                const { node, depth } = row;
                const selectedRow = selectedIds.has(node.id) || isActive(node);
                const loaded = (node.type === 'show' && node.show && node.show.filePath === loadedPath)
                    || (node.type === 'compilation' && node.compilation && node.compilation.dirPath === loadedPath);
                const label = node.type === 'folder'
                    ? node.name
                    : node.type === 'compilation'
                        ? (node.compilation && node.compilation.name) || 'Compilation'
                        : (node.show && node.show.displayName) || 'Untitled';
                const hintHere = dropHint
                    && dropHint.parentId === row.parentId
                    && dropHint.index === row.index
                    && dropHint.kind === 'before';
                const intoHere = dropHint && dropHint.kind === 'into' && dropHint.parentId === node.id;
                const open = node.type === 'folder' && !collapsedSet.has(node.id);
                return React.createElement(React.Fragment, {
                    key: node.id
                },
                    hintHere && React.createElement('div', {
                        className: 'h-0.5 mx-1 rounded-full bg-cyan-500',
                        style: { marginLeft: `${depth}rem` }
                    }),
                    React.createElement('div', {
                        className: 'flex items-stretch',
                        style: { marginLeft: `${depth}rem` }
                    },
                        depth > 0 && React.createElement('div', {
                            className: 'w-px my-1 mr-1 flex-none bg-zinc-300 dark:bg-zinc-700',
                            'aria-hidden': true
                        }),
                        React.createElement('div', {
                            className: `kv-row group ${selectedRow ? 'is-active' : ''} ${intoHere ? 'ring-1 ring-cyan-500' : ''}`,
                            draggable: !editingId,
                            onDragStart: (event) => {
                                const ids = selectedIds.has(node.id)
                                    ? rows.filter((item) => selectedIds.has(item.node.id)).map((item) => item.node.id)
                                    : [node.id];
                                if (!selectedIds.has(node.id)) {
                                    setSelectedIds(new Set([node.id]));
                                    setAnchorId(node.id);
                                    activate(node);
                                }
                                setDragIds(ids);
                                event.dataTransfer.setData('text/plain', JSON.stringify(ids));
                                event.dataTransfer.effectAllowed = 'move';
                            },
                            onDragEnd: () => {
                                setDragIds([]);
                                setDropHint(null);
                            },
                            onDragOver: (event) => {
                                event.preventDefault();
                                const hint = dropHintFor(row, event);
                                if (canDropHint(hint)) {
                                    event.dataTransfer.dropEffect = 'move';
                                    setDropHint(hint);
                                } else {
                                    event.dataTransfer.dropEffect = 'none';
                                    setDropHint(null);
                                }
                            },
                            onDrop: (event) => {
                                event.preventDefault();
                                const hint = dropHint || dropHintFor(row, event);
                                const moving = parseMoveIds(
                                    event.dataTransfer.getData('text/plain'),
                                    dragIds
                                );
                                const movingSet = new Set(moving);
                                const nodes = moving
                                    .map((id) => findNode(tree || [], id))
                                    .filter(Boolean)
                                    .map((found) => found.node);
                                const blocked = Boolean(hint && (
                                    movingSet.has(hint.parentId)
                                    || nodes.some((item) => item.id === hint.parentId
                                        || (item.type === 'folder' && hint.parentId !== 'root'
                                            && folderContains(item, hint.parentId)))
                                ));
                                setDragIds([]);
                                setDropHint(null);
                                if (hint && moving.length && !blocked) {
                                    onMove(moving, hint.parentId, hint.index);
                                }
                            },
                            onClick: (event) => handleRowClick(event, node)
                        },
                            node.type === 'folder'
                                ? React.createElement(Chevron, {
                                    open,
                                    onClick: () => onToggleCollapsed(node.id)
                                })
                                : React.createElement('span', {
                                    className: 'w-3.5 h-3.5 flex-none',
                                    'aria-hidden': true
                                }),
                            node.type === 'folder' && React.createElement(FolderIcon),
                            editingId === node.id
                                ? React.createElement('input', {
                                    className: 'field py-0.5 text-sm',
                                    value: draft,
                                    autoFocus: true,
                                    onClick: (event) => event.stopPropagation(),
                                    onChange: (event) => setDraft(event.target.value),
                                    onBlur: () => commitEdit(node),
                                    onKeyDown: (event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            commitEdit(node);
                                        }
                                        if (event.key === 'Escape') {
                                            setEditingId('');
                                        }
                                    }
                                })
                                : React.createElement('span', {
                                    className: `truncate text-sm flex-1 min-w-0 ${loaded ? 'text-cyan-600 dark:text-cyan-400' : ''}`
                                }, loaded ? `${label} · loaded` : label),
                            node.type === 'show' && node.show && node.show.filePath
                                && React.createElement('button', {
                                    type: 'button',
                                    className: 'flex-none p-0.5 rounded text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-cyan-500',
                                    title: 'Play',
                                    'aria-label': 'Play',
                                    disabled: busy,
                                    onClick: (event) => {
                                        event.stopPropagation();
                                        if (onQueuePlay) {
                                            onQueuePlay({
                                                filePath: node.show.filePath,
                                                name: (node.show && node.show.displayName) || label
                                            });
                                        }
                                    }
                                }, React.createElement('svg', {
                                    xmlns: 'http://www.w3.org/2000/svg',
                                    viewBox: '0 0 24 24',
                                    className: 'w-3.5 h-3.5',
                                    fill: 'currentColor',
                                    'aria-hidden': true
                                }, React.createElement('path', { d: 'M8 5.2v13.6L19.4 12z' })))
                        )
                    )
                );
            }),
            dropHint && dropHint.kind === 'after' && dropHint.parentId === 'root'
                && dropHint.index === (tree || []).length
                && React.createElement('div', {
                    className: 'h-0.5 mx-1 rounded-full bg-cyan-500'
                })
        )
    );
};

module.exports = ShowList;
