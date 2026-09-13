const React = require('react');
const { displayUniverse } = require('../../universeDisplay');

const UniverseCell = ({
    universe,
    protocol,
    isSelected,
    isChecked,
    onSelect,
    onClick
}) => {
    const universeId = universe?.id ?? universe?.universe ?? 'undefined';
    const channels = universe?.activeChannels ?? 0;
    const sourceIp = universe?.sourceIp ?? 'unknown';
    const sourceName = universe?.sourceName;
    const fps = universe?.fps;
    const isStale = universe?.stale;
    const label = displayUniverse(protocol, universeId);

    return React.createElement('div', {
        className: `kv-row ${isSelected ? 'is-active' : ''}`
    },
        React.createElement('div', {
            className: 'flex items-center gap-2 w-full min-w-0'
        },
            React.createElement('input', {
                type: 'checkbox',
                checked: isChecked,
                onChange: onSelect,
                className: 'h-3.5 w-3.5 flex-none accent-cyan-400'
            }),
            React.createElement('div', {
                className: 'flex-grow cursor-pointer min-w-0',
                onClick: onClick
            },
                React.createElement('div', {
                    className: 'font-medium text-sm'
                }, `Universe ${label}${isStale ? ' (Inactive)' : ''}`),
                React.createElement('div', {
                    className: 'text-xs text-zinc-500'
                }, `Channels: ${channels}`),
                React.createElement('div', {
                    className: 'text-xs text-zinc-500 truncate'
                }, `Source: ${sourceIp}`),
                sourceName && React.createElement('div', {
                    className: 'text-xs text-zinc-500 truncate'
                }, `Name: ${sourceName}`),
                typeof fps === 'number' && React.createElement('div', {
                    className: 'text-xs text-zinc-500'
                }, `FPS: ${fps}`)
            )
        )
    );
};

module.exports = UniverseCell;
