const isFolder = (node) => Boolean(node && node.type === 'folder');
const isShow = (node) => Boolean(node && node.type === 'show');
const isCompilation = (node) => Boolean(node && node.type === 'compilation');

const cloneTree = (items) => JSON.parse(JSON.stringify(items || []));

const walk = (items, visit, parent = null) => {
    (items || []).forEach((node, index) => {
        visit(node, parent, index);
        if (isFolder(node)) {
            walk(node.children, visit, node);
        }
    });
};

const findNode = (items, id) => {
    let found = null;
    walk(items, (node, parent, index) => {
        if (node.id === id) {
            found = {
                node,
                parent,
                index,
                siblings: parent ? parent.children : items
            };
        }
    });
    return found;
};

const folderContains = (folder, id) => {
    if (!folder) {
        return false;
    }
    if (folder.id === id) {
        return true;
    }
    let hit = false;
    walk(folder.children || [], (node) => {
        if (node.id === id) {
            hit = true;
        }
    });
    return hit;
};

const takeNode = (items, id) => {
    const found = findNode(items, id);
    if (!found) {
        return null;
    }
    const [node] = found.siblings.splice(found.index, 1);
    return node;
};

const childrenOf = (items, parentId) => {
    if (!parentId || parentId === 'root') {
        return items;
    }
    const found = findNode(items, parentId);
    if (!found || !isFolder(found.node)) {
        return null;
    }
    if (!Array.isArray(found.node.children)) {
        found.node.children = [];
    }
    return found.node.children;
};

const insertNode = (items, node, parentId, index) => {
    const children = childrenOf(items, parentId);
    if (!children) {
        throw new Error('Folder not found');
    }
    const at = index == null ? children.length : index;
    const clamped = Math.max(0, Math.min(at, children.length));
    children.splice(clamped, 0, node);
};

const moveNode = (items, id, parentId, index) => {
    const found = findNode(items, id);
    if (!found) {
        throw new Error('Item not found');
    }
    const fromParentId = found.parent ? found.parent.id : 'root';
    const fromIndex = found.index;
    const destParent = parentId || 'root';
    if (isFolder(found.node) && destParent !== 'root' && folderContains(found.node, destParent)) {
        throw new Error('Cannot move a folder into itself');
    }
    const node = takeNode(items, id);
    let destIndex = index == null ? null : index;
    if (destIndex != null && fromParentId === destParent && fromIndex < destIndex) {
        destIndex -= 1;
    }
    insertNode(items, node, destParent, destIndex);
    return items;
};

const dissolveFolder = (items, id) => {
    const found = findNode(items, id);
    if (!found || !isFolder(found.node)) {
        throw new Error('Folder not found');
    }
    const kids = found.node.children || [];
    found.siblings.splice(found.index, 1, ...kids);
    return items;
};

const renameFolder = (items, id, name) => {
    const found = findNode(items, id);
    if (!found || !isFolder(found.node)) {
        throw new Error('Folder not found');
    }
    found.node.name = name;
    return items;
};

const firstShowPath = (nodes) => {
    for (const node of nodes || []) {
        if (isShow(node) && node.show && node.show.filePath) {
            return node.show.filePath;
        }
        const nested = firstShowPath(node.children);
        if (nested) {
            return nested;
        }
    }
    return null;
};

const folderExists = (nodes, id) => Boolean(findNode(nodes, id));

const flattenRows = (nodes, parentId = 'root', depth = 0, collapsed) => {
    const hidden = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
    const rows = [];
    (nodes || []).forEach((node, index) => {
        rows.push({ node, parentId, index, depth });
        if (isFolder(node) && !hidden.has(node.id)) {
            rows.push(...flattenRows(node.children || [], node.id, depth + 1, hidden));
        }
    });
    return rows;
};

const collectFolderIds = (items) => {
    const ids = [];
    walk(items, (node) => {
        if (isFolder(node) && node.id) {
            ids.push(node.id);
        }
    });
    return ids;
};

const ancestorIds = (items, id) => {
    const ids = [];
    let found = findNode(items, id);
    let parent = found && found.parent;
    while (parent) {
        ids.push(parent.id);
        found = findNode(items, parent.id);
        parent = found && found.parent;
    }
    return ids;
};

const moveNodes = (items, ids, parentId, index) => {
    const unique = [];
    const seen = new Set();
    (ids || []).forEach((id) => {
        if (id && !seen.has(id) && findNode(items, id)) {
            seen.add(id);
            unique.push(id);
        }
    });
    const moving = unique.filter((id) => !ancestorIds(items, id).some((parent) => seen.has(parent)));
    if (!moving.length) {
        throw new Error('Item not found');
    }
    const destParent = parentId || 'root';
    moving.forEach((id) => {
        const found = findNode(items, id);
        if (isFolder(found.node) && destParent !== 'root' && folderContains(found.node, destParent)) {
            throw new Error('Cannot move a folder into itself');
        }
    });
    let destIndex = index;
    if (destIndex != null) {
        moving.forEach((id) => {
            const found = findNode(items, id);
            const fromParent = found.parent ? found.parent.id : 'root';
            if (fromParent === destParent && found.index < destIndex) {
                destIndex -= 1;
            }
        });
    }
    const nodes = moving.map((id) => takeNode(items, id)).filter(Boolean);
    nodes.forEach((node, offset) => {
        insertNode(items, node, destParent, destIndex == null ? null : destIndex + offset);
    });
    return items;
};

const pruneAndFill = (items, showIds, compilationIds = []) => {
    const known = new Set(showIds);
    const knownComps = new Set(compilationIds);
    const seen = new Set();
    const seenComps = new Set();
    const prune = (list) => {
        const next = [];
        (list || []).forEach((node) => {
            if (isShow(node) && known.has(node.id) && !seen.has(node.id)) {
                seen.add(node.id);
                next.push({ type: 'show', id: node.id });
                return;
            }
            if (isCompilation(node) && knownComps.has(node.id) && !seenComps.has(node.id)) {
                seenComps.add(node.id);
                next.push({ type: 'compilation', id: node.id });
                return;
            }
            if (isFolder(node) && node.id) {
                next.push({
                    type: 'folder',
                    id: String(node.id),
                    name: String(node.name || 'Folder'),
                    children: prune(node.children)
                });
            }
        });
        return next;
    };
    const tree = prune(items);
    const newComps = compilationIds
        .filter((id) => !seenComps.has(id))
        .map((id) => ({ type: 'compilation', id }));
    const newcomers = showIds
        .filter((id) => !seen.has(id))
        .map((id) => ({ type: 'show', id }));
    return [...newComps, ...newcomers, ...tree];
};

const hydrateTree = (items, showById, compilationById = new Map()) => (items || []).map((node) => {
    if (isShow(node)) {
        const show = showById.get(node.id);
        return show ? { type: 'show', id: node.id, show } : null;
    }
    if (isCompilation(node)) {
        const compilation = compilationById.get(node.id);
        return compilation ? { type: 'compilation', id: node.id, compilation } : null;
    }
    return {
        type: 'folder',
        id: node.id,
        name: node.name || 'Folder',
        children: hydrateTree(node.children, showById, compilationById).filter(Boolean)
    };
}).filter(Boolean);

const stripTree = (items) => (items || []).map((node) => {
    if (isShow(node)) {
        return { type: 'show', id: node.id };
    }
    if (isCompilation(node)) {
        return { type: 'compilation', id: node.id };
    }
    return {
        type: 'folder',
        id: node.id,
        name: node.name || 'Folder',
        children: stripTree(node.children)
    };
});

const SD_PATH_MAX = 63;
const INVALID_SEG = /[<>:"/\\|?*\x00-\x1f]/g;

const sanitizeSdSegment = (name) => {
    const trimmed = String(name || '').trim().replace(/\.dmx$/i, '');
    return trimmed.replace(INVALID_SEG, '').replace(/[. ]+$/g, '') || 'item';
};

const destFromSegments = (segments, fileName) => {
    const fileBase = sanitizeSdSegment(fileName);
    const dirs = (segments || []).map(sanitizeSdSegment).filter(Boolean);
    const joinDest = (parts, base) => `/${[...parts, `${base}.dmx`].join('/')}`;
    let dest = joinDest(dirs, fileBase);
    if (dest.length <= SD_PATH_MAX) {
        return dest;
    }
    const kept = dirs.slice();
    while (kept.length) {
        const prefix = `/${kept.join('/')}/`;
        const avail = SD_PATH_MAX - prefix.length - 4;
        if (avail >= 1) {
            return `${prefix}${fileBase.slice(0, avail)}.dmx`;
        }
        kept.shift();
        dest = joinDest(kept, fileBase);
        if (dest.length <= SD_PATH_MAX) {
            return dest;
        }
    }
    return `/${fileBase.slice(0, SD_PATH_MAX - 5)}.dmx`;
};

const collectLooks = (folder) => {
    const looks = [];
    walk(folder && folder.children, (node) => {
        if (isShow(node) && node.show && node.show.filePath) {
            looks.push({
                filePath: node.show.filePath,
                name: node.show.displayName || node.show.filename || node.id
            });
        }
    });
    return looks;
};

const collectLooksWithPath = (folder, prefix = []) => {
    const looks = [];
    const rootName = folder && folder.name ? folder.name : 'Folder';
    const visit = (nodes, segs) => {
        (nodes || []).forEach((node) => {
            if (isFolder(node)) {
                visit(node.children, [...segs, node.name || 'Folder']);
                return;
            }
            if (isShow(node) && node.show && node.show.filePath) {
                looks.push({
                    filePath: node.show.filePath,
                    name: node.show.displayName || node.show.filename || node.id,
                    dest: destFromSegments(segs, node.show.displayName || node.show.filename || node.id)
                });
            }
        });
    };
    visit(folder && folder.children, [...prefix, rootName]);
    return looks;
};

const flattenFolderStack = (folder) => {
    const rows = [];
    const visit = (nodes) => {
        (nodes || []).forEach((node) => {
            if (isFolder(node)) {
                rows.push({ kind: 'heading', id: node.id, name: node.name || 'Folder' });
                visit(node.children);
                return;
            }
            if (isShow(node) && node.show) {
                rows.push({ kind: 'look', id: node.id, show: node.show });
            }
            if (isCompilation(node) && node.compilation) {
                rows.push({ kind: 'compilation', id: node.id, compilation: node.compilation });
            }
        });
    };
    visit(folder && folder.children);
    return rows;
};

module.exports = {
    childrenOf,
    cloneTree,
    dissolveFolder,
    findNode,
    firstShowPath,
    flattenFolderStack,
    flattenRows,
    collectFolderIds,
    collectLooks,
    collectLooksWithPath,
    destFromSegments,
    sanitizeSdSegment,
    folderContains,
    folderExists,
    hydrateTree,
    insertNode,
    isCompilation,
    isFolder,
    isShow,
    moveNode,
    moveNodes,
    pruneAndFill,
    renameFolder,
    stripTree,
    takeNode
};
