const React = require('react');

const NetworkSelect = ({
    selectedNic,
    networkInterfaces,
    onChange,
    label = 'NIC',
    disabled = false
}) => {
    const handleChange = (e) => {
        const newNic = e.target.value;
        onChange(newNic);
    };

    return React.createElement('div', {
        className: 'flex flex-col min-w-0'
    },
        React.createElement('label', {
            className: 'text-xs font-medium text-zinc-500 mb-0.5'
        }, label),
        React.createElement('select', {
            value: selectedNic,
            disabled,
            onChange: handleChange,
            className: 'field w-full py-1'
        },
            (networkInterfaces || []).map(nic =>
                React.createElement('option', {
                    key: nic.ip,
                    value: nic.ip
                }, `${nic.name} (${nic.ip})`)
            )
        )
    );
};

module.exports = NetworkSelect;
