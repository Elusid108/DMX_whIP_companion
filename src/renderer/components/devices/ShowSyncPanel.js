const React = require('react');
const { useEffect, useState } = React;
const ipcRenderer = require('../../ipc');

const ROLE_LABEL = { 1: 'Node', 2: 'Companion', 3: 'Show Host' };
const SHOWNET_LABEL = { host: 'Show Host', member: 'Member', standalone: 'Standalone' };

// Pick a Show Host and members, then write /shownet to each (they reboot
// onto the show network). This PC must join the show SSID to follow them.
const ShowNetwork = ({ peers, shownet }) => {
    const nodes = peers.filter((peer) => peer.role !== 2);
    const [ssid, setSsid] = useState('');
    const [pass, setPass] = useState('');
    const [ch, setCh] = useState(6);
    const [hostIp, setHostIp] = useState('');
    const [skip, setSkip] = useState({});
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState('');

    useEffect(() => {
        const host = Object.entries(shownet || {}).find(([, sn]) => sn && sn.role === 'host');
        if (host && !hostIp) {
            setHostIp(host[0]);
            if (!ssid && host[1].ssid) {
                setSsid(host[1].ssid);
                setCh(host[1].ch || 6);
            }
        }
    }, [shownet]);

    const apply = async (standalone) => {
        const targets = nodes.filter((node) => !skip[node.ip]);
        if (!targets.length) {
            setResult('Select at least one node.');
            return;
        }
        if (!standalone && (!ssid.trim() || !hostIp || pass.length < 8)) {
            setResult('Pick a Show Host and enter the SSID and an 8+ character password.');
            return;
        }
        const ask = standalone
            ? `Return ${targets.length} node(s) to standalone Wi-Fi? They reboot.`
            : `Make ${targets.find((n) => n.ip === hostIp) ? 'the chosen node the Show Host and the rest members' : 'these nodes members'} of "${ssid.trim()}"? They reboot onto it; join that network on this PC to keep managing them.`;
        if (!window.confirm(ask)) {
            return;
        }
        setBusy(true);
        setResult('');
        const lines = await Promise.all(targets.map(async (node) => {
            const role = standalone ? 'standalone' : (node.ip === hostIp ? 'host' : 'member');
            const res = await ipcRenderer.invoke('device-set-shownet', {
                ip: node.ip,
                role,
                ssid: ssid.trim(),
                pass,
                ch
            });
            return `${node.name || node.ip}: ${res && res.success ? SHOWNET_LABEL[role] : ((res && res.error) || 'failed')}`;
        }));
        setBusy(false);
        setResult(lines.join(' · '));
    };

    return React.createElement(Section, { title: 'Show network' },
        React.createElement('p', { className: 'text-xs text-zinc-500 px-1' },
            'One node runs its own 2.4 GHz Wi-Fi (10.77.0.1) and keeps the show clock; the others join it. No router needed.'),
        React.createElement('div', { className: 'grid grid-cols-1 sm:grid-cols-4 gap-2' },
            React.createElement('input', {
                className: 'field sm:col-span-2',
                placeholder: 'Show SSID',
                value: ssid,
                maxLength: 32,
                onChange: (e) => setSsid(e.target.value)
            }),
            React.createElement('input', {
                className: 'field',
                type: 'password',
                placeholder: 'Password (8+)',
                value: pass,
                maxLength: 63,
                onChange: (e) => setPass(e.target.value)
            }),
            React.createElement('select', {
                className: 'field',
                value: ch,
                onChange: (e) => setCh(Number(e.target.value))
            }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => React.createElement('option', { key: c, value: c }, `Channel ${c}`)))
        ),
        nodes.length === 0
            ? React.createElement(Empty, null, 'No nodes on the cue bus yet.')
            : nodes.map((node) => React.createElement(Row, { key: node.id },
                React.createElement('input', {
                    type: 'checkbox',
                    className: 'h-4 w-4 accent-cyan-400',
                    checked: !skip[node.ip],
                    'aria-label': `Include ${node.name || node.ip}`,
                    onChange: (e) => setSkip((prev) => ({ ...prev, [node.ip]: !e.target.checked }))
                }),
                React.createElement('span', { className: 'text-sm flex-1 min-w-[8rem] truncate' }, node.name || node.ip),
                React.createElement('span', { className: 'text-xs text-zinc-500' },
                    SHOWNET_LABEL[(shownet && shownet[node.ip] && shownet[node.ip].role) || 'standalone']),
                React.createElement('label', { className: 'flex items-center gap-1 text-xs' },
                    React.createElement('input', {
                        type: 'radio',
                        name: 'show-host',
                        className: 'h-4 w-4 accent-cyan-400',
                        checked: hostIp === node.ip,
                        onChange: () => setHostIp(node.ip)
                    }),
                    'Host')
            )),
        React.createElement('div', { className: 'flex flex-wrap gap-2' },
            React.createElement('button', {
                type: 'button',
                className: 'btn-primary',
                disabled: busy,
                onClick: () => apply(false)
            }, busy ? 'Applying…' : 'Apply show network'),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet',
                disabled: busy,
                onClick: () => apply(true)
            }, 'Back to standalone')
        ),
        result && React.createElement('p', { className: 'text-xs text-zinc-500 px-1' }, result)
    );
};

const clock = (ms) => {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const rtt = (us) => (us ? `${(us / 1000).toFixed(1)} ms` : '—');

const Section = ({ title, children, action }) => React.createElement('section', {
    className: 'flex flex-col gap-1.5'
},
    React.createElement('div', { className: 'flex items-center justify-between gap-2' },
        React.createElement('h3', { className: 'label-micro' }, title),
        action || null
    ),
    children
);

const Empty = ({ children }) => React.createElement('p', {
    className: 'text-sm text-zinc-500 italic px-1'
}, children);

const Row = ({ children, className = '' }) => React.createElement('div', {
    className: `flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 ${className}`
}, children);

// Show sync: the shared network clock, group cues running on the nodes, and
// the groups the companion can launch on every node that holds a slice.
const ShowSyncPanel = () => {
    const [state, setState] = useState(null);
    const [loopByGroup, setLoopByGroup] = useState({});
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        ipcRenderer.invoke('cuebus-state').then((next) => {
            if (alive) {
                setState(next);
            }
        }).catch(() => {});
        const onUpdate = (event, next) => setState(next);
        ipcRenderer.on('cuebus-update', onUpdate);
        return () => {
            alive = false;
            ipcRenderer.removeListener('cuebus-update', onUpdate);
        };
    }, []);

    const run = async (channel, payload) => {
        setError('');
        try {
            const result = await ipcRenderer.invoke(channel, payload);
            if (!result || !result.success) {
                setError((result && result.error) || 'Nothing to do');
            }
        } catch (err) {
            setError(err.message);
        }
    };

    if (!state) {
        return React.createElement(Empty, null, 'Listening on the cue bus…');
    }

    const peerName = (id) => {
        if (id === state.selfId) {
            return 'This PC';
        }
        const peer = state.peers.find((p) => p.id === id);
        return peer ? (peer.name || peer.ip) : `node ${Number(id).toString(16)}`;
    };
    const groupTitle = (hash) => {
        const entry = state.groups.find((g) => g.hash === hash);
        return entry ? entry.title || entry.group : `Group ${Number(hash).toString(16)}`;
    };

    return React.createElement('div', { className: 'flex flex-col gap-4 max-w-3xl w-full' },
        React.createElement(Section, { title: 'Network clock' },
            React.createElement(Row, null,
                React.createElement('span', { className: 'text-sm' },
                    'Master: ',
                    React.createElement('b', null, peerName(state.masterId))
                ),
                React.createElement('span', { className: 'text-xs text-zinc-500' },
                    state.isMaster
                        ? 'this PC keeps the time'
                        : (state.synced ? `synced · round trip ${rtt(state.rttUs)}` : 'syncing…')
                )
            )
        ),

        React.createElement(Section, { title: 'Running' },
            (state.streams || []).map((stream) => React.createElement(Row, { key: `stream-${stream.ip}` },
                React.createElement('span', { className: 'font-medium text-sm flex-1 min-w-[8rem] truncate' },
                    `Stream ${String(stream.path || '').split('/').pop().replace(/\.dmx$/i, '')}`),
                React.createElement('span', { className: 'text-xs text-zinc-500' },
                    `${stream.name || stream.ip} → ${stream.peers} node${stream.peers === 1 ? '' : 's'}`),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-danger',
                    onClick: () => run('device-stream-stop', { ip: stream.ip })
                }, 'Stop stream')
            )),
            state.cues.length === 0 && !(state.streams || []).length
                ? React.createElement(Empty, null, 'No group cue is running.')
                : state.cues.map((cue) => React.createElement(Row, { key: cue.group },
                    React.createElement('span', { className: 'font-medium text-sm flex-1 min-w-[8rem] truncate' },
                        groupTitle(cue.group)),
                    React.createElement('span', { className: 'readout text-xs' },
                        `${clock(cue.dur && cue.loop ? cue.posMs % cue.dur : cue.posMs)}${cue.dur ? ` / ${clock(cue.dur)}` : ''}`),
                    React.createElement('span', { className: 'text-xs text-zinc-500' },
                        `${cue.members.length} node${cue.members.length === 1 ? '' : 's'}${cue.paused ? ' · paused' : ''}${cue.loop ? ' · loop' : ''}`),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        onClick: () => run(cue.paused ? 'cuebus-resume' : 'cuebus-pause', { hash: cue.group })
                    }, cue.paused ? 'Resume' : 'Pause'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-danger',
                        onClick: () => run('cuebus-stop', { hash: cue.group })
                    }, 'Stop')
                ))
        ),

        React.createElement(Section, {
            title: 'Groups on the nodes',
            action: React.createElement('button', {
                type: 'button',
                className: 'btn-quiet',
                onClick: () => ipcRenderer.invoke('cuebus-refresh').then(setState).catch(() => {})
            }, 'Refresh')
        },
            state.groups.length === 0
                ? React.createElement(Empty, null, 'No synced shows found on the nodes. Push a look to two or more nodes to make one.')
                : state.groups.map((group) => React.createElement(Row, { key: group.hash },
                    React.createElement('span', { className: 'font-medium text-sm flex-1 min-w-[8rem] truncate', title: group.group },
                        group.title || group.group),
                    React.createElement('span', { className: 'text-xs text-zinc-500 truncate max-w-[16rem]' },
                        group.nodes.map((node) => node.name || node.ip).join(', ')),
                    React.createElement('label', { className: 'flex items-center gap-1 text-xs text-zinc-500' },
                        React.createElement('input', {
                            type: 'checkbox',
                            className: 'h-4 w-4 accent-cyan-400',
                            checked: Boolean(loopByGroup[group.hash]),
                            onChange: (event) => setLoopByGroup((prev) => ({ ...prev, [group.hash]: event.target.checked }))
                        }),
                        'Loop'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-primary',
                        onClick: () => run('cuebus-launch', { hash: group.hash, loop: Boolean(loopByGroup[group.hash]) })
                    }, 'Launch')
                ))
        ),

        React.createElement(Section, { title: 'On the cue bus' },
            state.peers.length === 0
                ? React.createElement(Empty, null, 'No nodes with firmware API 2 heard yet.')
                : state.peers.map((peer) => React.createElement(Row, { key: peer.id },
                    React.createElement('span', { className: 'text-sm flex-1 min-w-[8rem] truncate' }, peer.name || peer.ip),
                    React.createElement('span', { className: 'readout text-xs' }, peer.ip),
                    React.createElement('span', { className: 'text-xs text-zinc-500' },
                        `${ROLE_LABEL[peer.role] || 'Node'} · api ${peer.api}`),
                    React.createElement('span', { className: 'text-xs text-zinc-500' },
                        peer.isMaster ? 'clock master' : `rtt ${rtt(peer.rttUs)}`)
                ))
        ),

        React.createElement(ShowNetwork, { peers: state.peers, shownet: state.shownet }),

        error && React.createElement('p', { className: 'text-sm text-red-500', role: 'alert' }, error)
    );
};

module.exports = ShowSyncPanel;
