const React = require('react');

const AnimatedBar = React.memo(({ percentage }) => {
    return React.createElement('div', {
        className: 'absolute bottom-0 left-0 w-full bg-blue-100 transition-transform duration-100 origin-bottom',
        style: {
            transform: `scaleY(${percentage / 100})`,
            height: '100%'
        }
    });
}, (prev, next) => {
    return Math.abs(prev.percentage - next.percentage) < 1;
});

const DmxCell = React.memo(({ 
    index,
    value,
    displayFormat,
    selectedUniverse,
    showAnimations
}) => {
    const isChannelActive = value !== null;

    const formattedValue = React.useMemo(() => {
        if (selectedUniverse === null || !isChannelActive) return '0';
        
        switch(displayFormat) {
            case 'percent':
                return Math.round((value / 255) * 100) + '%';
            case 'hex':
                return value.toString(16).toUpperCase().padStart(2, '0');
            default: // decimal
                return value;
        }
    }, [value, displayFormat, selectedUniverse, isChannelActive]);

    const barPercentage = React.useMemo(() => {
        if (!showAnimations || selectedUniverse === null) return 0;
        return (value / 255) * 100;
    }, [value, showAnimations, selectedUniverse]);

    return React.createElement('div', { 
        className: 'flex flex-col items-center'
    },
        React.createElement('div', {
            className: 'text-xs font-medium text-gray-600 mb-1'
        }, index + 1),
        React.createElement('div', {
            className: 'relative w-full h-8'
        },
            showAnimations && selectedUniverse !== null && 
            React.createElement(AnimatedBar, {
                percentage: barPercentage
            }),
            React.createElement('div', {
                className: `absolute inset-0 text-sm p-1 rounded w-full text-center ${
                    selectedUniverse === null || !isChannelActive
                        ? 'bg-gray-400 border border-gray-500'
                        : 'bg-transparent border border-blue-200'
                }`
            }, formattedValue)
        )
    );
}, (prev, next) => {
    if (prev.selectedUniverse === null && next.selectedUniverse === null) return true;
    
    return (
        prev.value === next.value &&
        prev.displayFormat === next.displayFormat &&
        prev.selectedUniverse === next.selectedUniverse &&
        prev.showAnimations === next.showAnimations
    );
});

module.exports = DmxCell;