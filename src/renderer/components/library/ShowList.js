const React = require('react');

const ShowList = ({
    shows,
    selectedPath,
    loadedPath,
    onSelect
}) => {
    if (!shows.length) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'No shows in the library yet. Use New File or Import.');
    }

    return React.createElement('div', {
        className: 'flex flex-col gap-1 overflow-y-auto'
    },
        shows.map((show) => {
            const isSelected = show.filePath === selectedPath;
            const isLoaded = show.filePath === loadedPath;
            return React.createElement('button', {
                key: show.filePath,
                type: 'button',
                onClick: () => onSelect(show.filePath),
                className: `kv-row ${isSelected ? 'is-active' : ''}`
            },
                React.createElement('div', {
                    className: 'min-w-0'
                },
                    React.createElement('div', {
                        className: 'font-medium truncate text-sm'
                    }, show.displayName),
                    React.createElement('div', {
                        className: 'text-xs text-zinc-500 truncate'
                    }, isLoaded ? `${show.filename} · loaded` : show.filename)
                )
            );
        })
    );
};

module.exports = ShowList;
