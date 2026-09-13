const React = require('react');

const ShowList = ({
    shows,
    selectedPath,
    loadedPath,
    onSelect
}) => {
    if (!shows.length) {
        return React.createElement('div', {
            className: 'text-sm text-gray-500 italic p-3'
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
                className: `text-left p-2 rounded border ${
                    isSelected
                        ? 'bg-blue-100 border-blue-300'
                        : 'bg-white border-transparent hover:bg-gray-50'
                }`
            },
                React.createElement('div', {
                    className: 'font-medium truncate'
                }, show.displayName),
                React.createElement('div', {
                    className: 'text-xs text-gray-500 truncate'
                }, isLoaded ? `${show.filename} · loaded` : show.filename)
            );
        })
    );
};

module.exports = ShowList;
