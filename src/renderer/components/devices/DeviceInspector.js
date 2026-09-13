const React = require('react');

const ORDER_PREFIX = /^(\d{2})_/;

const Field = ({ label, children }) => React.createElement('div', {
    className: 'flex flex-col gap-1'
},
    React.createElement('label', {
        className: 'text-xs font-medium text-zinc-500'
    }, label),
    children
);

const formatSd = (sd) => {
    if (!sd) {
        return 'no SD';
    }
    if (!sd.ok) {
        return 'SD not mounted';
    }
    return `SD ${sd.used_mb}/${sd.size_mb} MB`;
};

const sdDisplayName = (sdPath) => {
    const base = String(sdPath || '').split('/').pop() || '';
    return base.replace(/\.dmx$/i, '').replace(ORDER_PREFIX, '') || sdPath;
};

const heading = (text) => React.createElement('div', {
    className: 'text-xs font-medium text-zinc-500 pt-2'
}, text);

const DeviceInspector = ({
    device,
    status,
    statusError,
    identifying,
    busy,
    nodeName,
    sdPath,
    files,
    brightness,
    proto,
    fps,
    buf,
    wifiSsid,
    wifiPassword,
    networks,
    scanning,
    onNameChange,
    onSaveName,
    onIdentify,
    onSdPathChange,
    onPlay,
    onStop,
    onPrev,
    onNext,
    renaming,
    renameDraft,
    onRenameShow,
    onRenameDraftChange,
    onRenameConfirm,
    onRenameCancel,
    onPullShow,
    onBrightnessChange,
    onApplyBrightness,
    onProtoChange,
    onFpsChange,
    onBufChange,
    onApplyLive,
    onWifiSsidChange,
    onWifiPasswordChange,
    onWifiScan,
    onWifiConnect,
    onWifiForget
}) => {
    if (!device) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'Select a node to see details.');
    }

    const universes = (device.universes && device.universes.length)
        ? device.universes.join(', ')
        : String(device.universe ?? 0);
    const idle = Boolean(status) && !statusError && !device.stale;
    const play = status && status.play ? status.play : {};
    const dirs = Array.isArray(play.dirs) ? play.dirs : [];
    const fileList = Array.isArray(files) ? files : [];
    const sdOk = Boolean(status && status.sd && status.sd.ok);
    const disabled = busy || !idle;
    const meta = [
        device.ip,
        device.mac,
        `u${universes}`,
        status && status.ver ? `fw ${status.ver}` : null,
        status ? formatSd(status.sd) : null,
        device.stale ? 'stale' : null
    ].filter(Boolean).join(' · ');

    return React.createElement('div', {
        className: 'overflow-y-auto h-full'
    },
        React.createElement('div', {
            className: 'flex flex-col gap-2 w-[60%] mx-auto'
        },
            React.createElement('div', {
                className: 'flex items-start gap-2'
            },
                React.createElement('input', {
                    className: 'field text-lg font-medium',
                    value: nodeName,
                    disabled: disabled,
                    onChange: (event) => onNameChange(event.target.value)
                }),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet flex-none mt-0.5',
                    disabled: disabled || !String(nodeName || '').trim(),
                    onClick: onSaveName
                }, 'Save'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-primary flex-none mt-0.5',
                    disabled: identifying || disabled,
                    onClick: onIdentify
                }, identifying ? 'Identifying…' : 'Identify')
            ),
            React.createElement('div', {
                className: 'text-xs text-zinc-500 truncate',
                title: meta
            }, meta),
            statusError && React.createElement('div', {
                className: 'text-sm text-red-500'
            }, statusError),

            heading('Shows on this node'),
            !idle && React.createElement('p', {
                className: 'text-xs text-zinc-500'
            }, 'Idle HTTP is required to list and play files on the node.'),
            idle && !sdOk && React.createElement('p', {
                className: 'text-sm text-red-500'
            }, 'No SD card mounted.'),
            idle && sdOk && React.createElement(React.Fragment, null,
                dirs.length > 0 && React.createElement('div', {
                    className: 'text-xs text-zinc-500'
                }, `Folders: ${dirs.join(', ')}`),
                fileList.length === 0
                    ? React.createElement('p', {
                        className: 'text-sm text-zinc-500 italic'
                    }, 'No .dmx on the card.')
                    : React.createElement('div', {
                        className: 'flex flex-col gap-1'
                    },
                        fileList.map((file) => React.createElement('button', {
                            key: file,
                            type: 'button',
                            className: `kv-row text-sm ${sdPath === file ? 'is-active' : ''}`,
                            onClick: () => onSdPathChange(file)
                        },
                            React.createElement('span', {
                                className: 'truncate text-left'
                            }, sdDisplayName(file))
                        ))
                    ),
                play.now ? React.createElement('div', {
                    className: 'text-xs text-zinc-500'
                }, `Now: ${sdDisplayName(play.now)}`) : null,
                React.createElement('div', {
                    className: 'flex flex-wrap gap-1.5'
                },
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        disabled: disabled || fileList.length === 0,
                        onClick: onPrev
                    }, 'Prev'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-primary',
                        disabled: disabled || !sdPath,
                        onClick: onPlay
                    }, 'Play'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        disabled,
                        onClick: onStop
                    }, 'Stop'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        disabled: disabled || fileList.length === 0,
                        onClick: onNext
                    }, 'Next'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        disabled: disabled || !sdPath,
                        onClick: onRenameShow
                    }, 'Rename'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        disabled: disabled || !sdPath,
                        onClick: onPullShow
                    }, 'Pull to library')
                ),
                renaming && React.createElement('div', {
                    className: 'flex items-center gap-1.5'
                },
                    React.createElement('input', {
                        className: 'field',
                        value: renameDraft,
                        disabled,
                        autoFocus: true,
                        onChange: (event) => onRenameDraftChange(event.target.value)
                    }),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-primary flex-none',
                        disabled: disabled || !String(renameDraft || '').trim(),
                        onClick: onRenameConfirm
                    }, 'Save name'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet flex-none',
                        disabled,
                        onClick: onRenameCancel
                    }, 'Cancel')
                ),
                React.createElement('p', {
                    className: 'text-xs text-zinc-500'
                }, 'Shows are listed alphabetically. Library Load and the toolbar play from this PC.')
            ),

            heading('Brightness'),
            React.createElement(Field, { label: 'v (0–255)' },
                React.createElement('input', {
                    className: 'field',
                    type: 'number',
                    min: 0,
                    max: 255,
                    value: brightness,
                    disabled,
                    onChange: (event) => onBrightnessChange(event.target.value)
                })
            ),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet self-start',
                disabled,
                onClick: onApplyBrightness
            }, 'Apply brightness'),

            heading('Live protocol'),
            React.createElement('div', {
                className: 'grid grid-cols-3 gap-1.5'
            },
                React.createElement(Field, { label: 'Protocol' },
                    React.createElement('select', {
                        className: 'field',
                        value: proto,
                        disabled,
                        onChange: (event) => onProtoChange(event.target.value)
                    },
                        React.createElement('option', { value: 'auto' }, 'auto'),
                        React.createElement('option', { value: 'artnet' }, 'artnet'),
                        React.createElement('option', { value: 'sacn' }, 'sacn')
                    )
                ),
                React.createElement(Field, { label: 'FPS' },
                    React.createElement('select', {
                        className: 'field',
                        value: String(fps),
                        disabled,
                        onChange: (event) => onFpsChange(event.target.value)
                    },
                        [20, 30, 40, 60].map((value) => React.createElement('option', {
                            key: value,
                            value: String(value)
                        }, String(value)))
                    )
                ),
                React.createElement(Field, { label: 'Buffer' },
                    React.createElement('select', {
                        className: 'field',
                        value: String(buf),
                        disabled,
                        onChange: (event) => onBufChange(event.target.value)
                    },
                        [0, 1, 2, 3].map((value) => React.createElement('option', {
                            key: value,
                            value: String(value)
                        }, String(value)))
                    )
                )
            ),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet self-start',
                disabled,
                onClick: onApplyLive
            }, 'Apply live'),

            heading('Wi-Fi'),
            React.createElement('div', {
                className: 'flex flex-wrap gap-1.5'
            },
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet',
                    disabled,
                    onClick: onWifiScan
                }, scanning ? 'Scanning…' : 'Scan'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet',
                    disabled,
                    onClick: onWifiConnect
                }, 'Connect'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet',
                    disabled,
                    onClick: onWifiForget
                }, 'Forget')
            ),
            React.createElement(Field, { label: 'SSID' },
                networks.length > 0
                    ? React.createElement('select', {
                        className: 'field',
                        value: wifiSsid,
                        disabled,
                        onChange: (event) => onWifiSsidChange(event.target.value)
                    },
                        React.createElement('option', { value: '' }, 'Select a network'),
                        ...networks.map((net) => React.createElement('option', {
                            key: net.ssid,
                            value: net.ssid
                        }, `${net.ssid}${net.secure ? '' : ' (open)'} · ${net.rssi} dBm`))
                    )
                    : React.createElement('input', {
                        className: 'field',
                        value: wifiSsid,
                        disabled,
                        onChange: (event) => onWifiSsidChange(event.target.value)
                    })
            ),
            React.createElement(Field, { label: 'Password' },
                React.createElement('input', {
                    className: 'field',
                    type: 'password',
                    value: wifiPassword,
                    disabled,
                    autoComplete: 'off',
                    onChange: (event) => onWifiPasswordChange(event.target.value)
                })
            )
        )
    );
};

module.exports = DeviceInspector;
