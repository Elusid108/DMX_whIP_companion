const React = require('react');

const NetworkSelect = ({ selectedNic, networkInterfaces, onChange }) => {
    const handleChange = (e) => {
        const newNic = e.target.value;
        onChange(newNic);
    };

    return React.createElement('div', { 
        className: 'flex flex-col min-w-fit' 
    },
        React.createElement('label', { 
            className: 'block text-sm font-medium text-gray-700 mb-1'
        }, 'Network Interface'),
        React.createElement('select', {
            value: selectedNic,
            onChange: handleChange,
            className: 'border rounded p-2 w-fit'
        },
            networkInterfaces.map(nic =>
                React.createElement('option', {
                    key: nic.ip,
                    value: nic.ip
                }, `${nic.name} (${nic.ip})`)
            )
        )
    );
};

module.exports = NetworkSelect;