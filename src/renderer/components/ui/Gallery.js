const React = require('react');
const { useRef, useState } = React;
const {
    Button,
    Checkbox,
    Dialog,
    EmptyState,
    Field,
    IconButton,
    Icons,
    Popover,
    ProgressBar,
    Select,
    Slider,
    StatusPill,
    Tabs,
    TextInput,
    Toggle,
    useToast
} = require('./index');

const SWATCHES = [
    'app', 'panel', 'surface', 'sunken', 'well', 'input', 'hover', 'selected',
    'line', 'edge', 'fg', 'fg-soft', 'muted', 'faint',
    'accent', 'mark', 'danger', 'ok', 'warn', 'artnet', 'sacn'
];

const Section = ({ title, children }) => React.createElement('section', {
    className: 'flex flex-col gap-2 p-3 rounded-ui border border-line bg-surface'
},
    React.createElement('h2', { className: 'label-micro' }, title),
    children
);

const Row = ({ children }) => React.createElement('div', {
    className: 'flex flex-wrap items-center gap-2'
}, children);

// Hidden UI-kit page (Ctrl+Shift+U) for checking components in both themes
// and at any window size.
const Gallery = ({ onToggleTheme }) => {
    const toast = useToast();
    const [tab, setTab] = useState('one');
    const [checked, setChecked] = useState(true);
    const [on, setOn] = useState(false);
    const [level, setLevel] = useState(40);
    const [committed, setCommitted] = useState(40);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [popOpen, setPopOpen] = useState(false);
    const popAnchor = useRef(null);

    return React.createElement('div', {
        className: 'flex-1 min-h-0 overflow-y-auto p-3'
    },
        React.createElement('div', {
            className: 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]'
        },
            React.createElement(Section, { title: 'Tokens' },
                React.createElement('div', { className: 'grid grid-cols-4 gap-1.5' },
                    SWATCHES.map((name) => React.createElement('div', { key: name, className: 'flex flex-col gap-0.5' },
                        React.createElement('div', {
                            className: 'h-6 rounded-ui-sm border border-line',
                            style: { background: `rgb(var(--c-${name}))` }
                        }),
                        React.createElement('span', { className: 'readout truncate' }, name)
                    ))
                ),
                React.createElement(Button, { onClick: onToggleTheme }, 'Toggle theme')
            ),
            React.createElement(Section, { title: 'Buttons' },
                React.createElement(Row, null,
                    React.createElement(Button, null, 'Quiet'),
                    React.createElement(Button, { active: true }, 'Active'),
                    React.createElement(Button, { variant: 'primary' }, 'Primary'),
                    React.createElement(Button, { variant: 'danger' }, 'Danger'),
                    React.createElement(Button, { disabled: true }, 'Disabled')
                ),
                React.createElement(Row, null,
                    React.createElement(IconButton, { label: 'Settings', icon: Icons.Cog }),
                    React.createElement(IconButton, { label: 'Repeat', icon: Icons.Repeat, pressed: on, onClick: () => setOn(!on) }),
                    React.createElement(IconButton, { label: 'Open', icon: Icons.Popout }),
                    React.createElement(IconButton, { label: 'Up', icon: Icons.ArrowUp, variant: 'ghost' }),
                    React.createElement(IconButton, { label: 'Down', icon: Icons.ArrowDown, variant: 'ghost' }),
                    React.createElement(IconButton, { label: 'Remove', icon: Icons.Close, variant: 'ghost' }),
                    React.createElement(IconButton, { label: 'More', icon: Icons.More, variant: 'ghost' })
                )
            ),
            React.createElement(Section, { title: 'Fields' },
                React.createElement(Field, { label: 'Name', hint: 'Shown on the node portal' },
                    React.createElement(TextInput, { defaultValue: 'whip-stage-left' })
                ),
                React.createElement(Field, { label: 'Protocol', error: 'Pick a protocol this node patches' },
                    React.createElement(Select, {
                        defaultValue: 'artnet',
                        options: [{ value: 'artnet', label: 'Art-Net' }, { value: 'sacn', label: 'sACN' }]
                    })
                ),
                React.createElement(Row, null,
                    React.createElement(Checkbox, { label: 'Select all', checked, onChange: (event) => setChecked(event.target.checked) }),
                    React.createElement(Toggle, { label: 'Park', checked: on, onChange: setOn })
                ),
                React.createElement(Slider, {
                    label: 'Level',
                    value: committed,
                    onInput: setLevel,
                    onCommit: (value) => {
                        setLevel(value);
                        setCommitted(value);
                    }
                }),
                React.createElement('span', { className: 'readout' }, `live ${level} · committed ${committed}`)
            ),
            React.createElement(Section, { title: 'Feedback' },
                React.createElement(Row, null,
                    React.createElement(StatusPill, { tone: 'ok' }, 'Online'),
                    React.createElement(StatusPill, { tone: 'warn' }, 'Shift'),
                    React.createElement(StatusPill, { tone: 'danger' }, 'Offline'),
                    React.createElement(StatusPill, { tone: 'accent' }, 'Master'),
                    React.createElement(StatusPill, { tone: 'muted' }, 'Idle')
                ),
                React.createElement(ProgressBar, { value: committed, label: 'Upload' }),
                React.createElement(ProgressBar, { value: null, label: 'Connecting' }),
                React.createElement(EmptyState, null, 'No nodes yet.'),
                React.createElement(EmptyState, {
                    title: 'Nothing running',
                    action: React.createElement(Button, { variant: 'primary', onClick: () => toast({ message: 'Launched', tone: 'ok' }) }, 'Launch')
                }, 'Launch a group from any node or from here.')
            ),
            React.createElement(Section, { title: 'Overlays' },
                React.createElement(Tabs, {
                    label: 'Example tabs',
                    value: tab,
                    onChange: setTab,
                    tabs: [
                        { id: 'one', label: 'Monitor' },
                        { id: 'two', label: 'Studio' },
                        { id: 'three', label: 'Library' },
                        { id: 'four', label: 'Disabled', disabled: true }
                    ]
                }),
                React.createElement(Row, null,
                    React.createElement(Button, { onClick: () => setDialogOpen(true) }, 'Open dialog'),
                    React.createElement(Button, {
                        ref: popAnchor,
                        'aria-expanded': popOpen,
                        onClick: () => setPopOpen((value) => !value)
                    }, 'Popover'),
                    React.createElement(Button, { onClick: () => toast('Saved to library') }, 'Toast'),
                    React.createElement(Button, { onClick: () => toast({ message: 'Upload failed: node busy', tone: 'danger', timeout: 0 }) }, 'Error toast')
                )
            )
        ),
        React.createElement(Popover, {
            open: popOpen,
            anchorRef: popAnchor,
            onClose: () => setPopOpen(false),
            label: 'Example popover',
            className: 'w-64'
        },
            React.createElement('p', { className: 'text-xs text-muted mb-2' }, 'Flips and clamps to the window.'),
            React.createElement(Button, { block: true, onClick: () => setPopOpen(false) }, 'Close')
        ),
        React.createElement(Dialog, {
            open: dialogOpen,
            onClose: () => setDialogOpen(false),
            title: 'Example dialog',
            subtitle: 'A bottom sheet under 640 px'
        },
            React.createElement('p', { className: 'text-sm mb-3' }, 'Escape, the backdrop or Cancel close it. Tab stays inside.'),
            React.createElement(Field, { label: 'Name' }, React.createElement(TextInput, { defaultValue: 'Look 1' })),
            React.createElement('div', { className: 'flex gap-1.5 mt-3' },
                React.createElement(Button, { block: true, className: 'flex-1', onClick: () => setDialogOpen(false) }, 'Cancel'),
                React.createElement(Button, { variant: 'primary', block: true, className: 'flex-1', onClick: () => setDialogOpen(false) }, 'OK')
            )
        )
    );
};

module.exports = Gallery;
