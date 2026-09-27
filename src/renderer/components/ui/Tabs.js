const React = require('react');
const { useRef } = React;
const cx = require('./cx');

// Tab strip with roving focus: arrows / Home / End move and select.
// tabs: [{ id, label, disabled }]. The strip scrolls sideways when narrow.
const Tabs = ({ tabs, value, onChange, label, className }) => {
    const refs = useRef({});
    const enabled = tabs.filter((tab) => !tab.disabled);
    // Keep the strip reachable by Tab even when no tab is selected.
    const focusId = enabled.some((tab) => tab.id === value)
        ? value
        : (enabled[0] && enabled[0].id);

    const move = (event) => {
        const index = enabled.findIndex((tab) => tab.id === value);
        let next = -1;
        if (event.key === 'ArrowRight') {
            next = (index + 1) % enabled.length;
        } else if (event.key === 'ArrowLeft') {
            next = (index - 1 + enabled.length) % enabled.length;
        } else if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = enabled.length - 1;
        }
        if (next < 0) {
            return;
        }
        event.preventDefault();
        const tab = enabled[next];
        const node = refs.current[tab.id];
        if (node) {
            node.focus();
        }
        onChange(tab.id);
    };

    return React.createElement('div', {
        role: 'tablist',
        'aria-label': label,
        className: cx('flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar', className),
        onKeyDown: move
    }, tabs.map((tab) => React.createElement('button', {
        key: tab.id,
        ref: (node) => {
            refs.current[tab.id] = node;
        },
        type: 'button',
        role: 'tab',
        'aria-selected': tab.id === value,
        tabIndex: tab.id === focusId ? 0 : -1,
        disabled: tab.disabled,
        className: cx('tab-btn', tab.id === value && 'is-active'),
        onClick: () => onChange(tab.id)
    }, tab.label)));
};

module.exports = Tabs;
