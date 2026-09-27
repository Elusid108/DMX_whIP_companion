const React = require('react');
const cx = require('./cx');

// Muted "nothing here" line; with title / action it becomes a centred block.
const EmptyState = ({ title, action, size = 'sm', className, children }) => {
    if (!title && !action) {
        return React.createElement('p', {
            className: cx(size === 'xs' ? 'text-xs' : 'text-sm', 'text-muted italic', className)
        }, children);
    }
    return React.createElement('div', {
        className: cx('flex flex-col items-center justify-center gap-2 p-6 text-center', className)
    },
        title && React.createElement('div', { className: 'text-sm font-medium text-fg-soft' }, title),
        children && React.createElement('p', { className: 'text-xs text-muted max-w-sm' }, children),
        action
    );
};

// value 0-100, or null for an indeterminate bar.
const ProgressBar = ({ value, label, className }) => {
    const known = typeof value === 'number' && Number.isFinite(value);
    const percent = known ? Math.max(0, Math.min(100, value)) : 0;
    return React.createElement('div', {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': known ? Math.round(percent) : undefined,
        className: cx('h-1.5 rounded-full bg-hover overflow-hidden', className)
    },
        React.createElement('div', {
            className: cx('h-full bg-accent', !known && 'w-1/3 animate-pulse'),
            style: known ? { width: `${percent}%` } : undefined
        })
    );
};

const TONES = {
    ok: 'bg-ok/10 text-ok',
    warn: 'bg-warn/10 text-warn',
    danger: 'bg-danger/10 text-danger',
    accent: 'bg-accent/10 text-accent',
    muted: 'bg-hover text-muted'
};

const DOTS = {
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    accent: 'bg-accent',
    muted: 'bg-muted'
};

// tone: ok | warn | danger | accent | muted.
const StatusPill = ({ tone = 'muted', dot = true, className, title, children }) => React.createElement('span', {
    className: cx('status-pill', TONES[tone] || TONES.muted, className),
    title
},
    dot && React.createElement('span', {
        className: cx('h-1.5 w-1.5 rounded-full', DOTS[tone] || DOTS.muted),
        'aria-hidden': true
    }),
    children
);

module.exports = { EmptyState, ProgressBar, StatusPill };
