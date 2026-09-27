// Joins class names, skipping falsy entries.
const cx = (...parts) => parts.filter(Boolean).join(' ');

module.exports = cx;
