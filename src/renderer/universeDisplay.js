const displayUniverse = (protocol, id) => {
    const n = Number(id);
    if (!Number.isFinite(n)) {
        return id;
    }
    return protocol === 'artnet' ? n + 1 : n;
};

module.exports = { displayUniverse };
