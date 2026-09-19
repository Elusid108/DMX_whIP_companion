const React = require('react');
const UniverseActivityGrid = require('./UniverseActivityGrid');

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

    return React.createElement('div', {
        className: `kv-row ${isSelected ? 'is-active' : ''}`
    },
        React.createElement('div', {
            className: 'flex items-start gap-2 w-full min-w-0'
        },
            React.createElement('input', {
                type: 'checkbox',
                checked: isChecked,
                onChange: onSelect,
                className: 'h-3.5 w-3.5 flex-none mt-0.5 accent-cyan-400'
            }),
            React.createElement('div', {
                className: 'flex flex-col min-w-0 flex-1 cursor-pointer',
                onClick: onClick
            },
                React.createElement('div', {
                    className: 'flex items-start gap-2 min-w-0'
                },
                    React.createElement('div', {
                        className: 'min-w-0 flex-1'
                    },
                        React.createElement('div', {
                            className: 'font-medium text-sm'
                        }, `Universe ${universeId}${isStale ? ' (Inactive)' : ''}`),
                        typeof fps === 'number' && React.createElement('div', {
                            className: 'text-xs text-zinc-500'
                        }, `FPS: ${fps}`)
                    ),
                    React.createElement(UniverseActivityGrid, {
                        protocol,
                        universeId
                    })
                ),
                React.createElement('div', {
                    className: 'text-xs text-zinc-500'
                }, `Channels: ${channels}`),
                React.createElement('div', {
                    className: 'text-xs text-zinc-500 truncate'
                }, `Source: ${sourceIp}`),
                sourceName && React.createElement('div', {
                    className: 'text-xs text-zinc-500 truncate'
                }, `Name: ${sourceName}`)
            )
        )
    );
};

module.exports = UniverseCell;
