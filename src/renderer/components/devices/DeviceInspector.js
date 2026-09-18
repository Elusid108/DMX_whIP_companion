const React = require('react');
const { MIN_FIRMWARE_API, statusApi, apiTooOld } = require('../../../services/shared/firmwareCompat');

const ORDER_PREFIX = /^(\d{2})_/;

const Field = ({ label, children }) => React.createElement('div', {
    className: 'flex flex-col gap-1'
},
    React.createElement('label', {
        className: 'label-micro'
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

const formatPins = (status) => {
    const sd = status && status.pins && status.pins.sd;
    if (!sd) {
        return null;
    }
    return `sd ${sd.cs}/${sd.mosi}/${sd.clk}/${sd.miso}`;
};

const sdDisplayName = (sdPath) => {
    const base = String(sdPath || '').split('/').pop() || '';
    return base.replace(/\.dmx$/i, '').replace(ORDER_PREFIX, '') || sdPath;
};

const linkState = (device, status, liveLocked) => {
    if (device.stale) {
        return 'stale';
    }
    if (liveLocked || (status && status.live)) {
        return 'live';
    }
    if (status) {
        return 'idle';
    }
    return '—';
};

const DeviceInspector = ({
    device,
    status,
    statusError,
    liveLocked,
    identifying,
    busy,
    nodeName,
    playSrc,
    playPath,
    files,
    dirs,
    fileLoop,
    folderRep,
    folderN,
    brightness,
    proto,
    fps,
    buf,
    park,
    wifiSsid,
    wifiPassword,
    networks,
    scanning,
    faceTab,
    onFaceTab,
    onNameChange,
    onSaveName,
    onIdentify,
    onSelectPlay,
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
    onFileLoopChange,
    onFolderRepChange,
    onFolderNChange,
    onBrightnessChange,
    onProtoChange,
    onFpsChange,
    onBufChange,
    onParkChange,
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
    const httpUp = Boolean(status) && !statusError && !device.stale && !liveLocked;
    const live = liveLocked || Boolean(status && status.live);
    const playIdle = httpUp && !live;
    const play = status && status.play ? status.play : {};
    const fileList = Array.isArray(files) ? files : [];
    const dirList = Array.isArray(dirs) ? dirs : [];
    const sdOk = Boolean(status && status.sd && status.sd.ok);
    const setupDisabled = busy || !httpUp;
    const playDisabled = busy || !playIdle;
    const identifyDisabled = identifying || setupDisabled || live;
    const fileSelected = playSrc === 'file' && Boolean(playPath);
    const playReady = playIdle && sdOk && (
        playSrc === 'root' ||
        (playSrc === 'folder' && playPath) ||
        fileSelected
    );
    const nowText = play.now ? sdDisplayName(play.now) : 'stopped';
    const link = linkState(device, status, liveLocked);
    const meta = [
        device.ip,
        device.mac,
        `u${universes}`,
        status && status.ver ? `fw ${status.ver}` : null,
        status && status.api != null ? `api ${status.api}` : null,
        status && status.board ? status.board : null,
        status ? formatSd(status.sd) : null,
        formatPins(status),
        link,
        `now ${nowText}`
    ].filter(Boolean).join(' · ');

    const playRow = (src, path, label, kind) => {
        const on = playSrc === src && (src === 'root' || playPath === path);
        return React.createElement('button', {
            key: `${src}:${path}`,
            type: 'button',
            className: `kv-row text-sm ${on ? 'is-active' : ''}`,
            disabled: playDisabled || !sdOk,
            onClick: () => onSelectPlay(src, path)
        },
            React.createElement('span', {
                className: 'truncate text-left flex-1'
            }, label),
            React.createElement('span', {
                className: 'readout flex-none'
            }, kind)
        );
    };

    return React.createElement('div', {
        className: 'h-full flex flex-col max-w-xl mx-auto w-full min-h-0'
    },
        React.createElement('div', {
            className: 'status-strip flex-none'
        },
            React.createElement('div', {
                className: 'flex items-start gap-2'
            },
                React.createElement('input', {
                    className: 'field text-sm font-medium',
                    value: nodeName,
                    disabled: setupDisabled,
                    onChange: (event) => onNameChange(event.target.value)
                }),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet flex-none',
                    disabled: setupDisabled || !String(nodeName || '').trim(),
                    onClick: onSaveName
                }, 'Save'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-primary flex-none',
                    disabled: identifyDisabled,
                    onClick: onIdentify
                }, identifying ? 'Identifying…' : 'Identify')
            ),
            React.createElement('div', {
                className: 'readout truncate',
                title: meta
            }, meta),
            liveLocked && React.createElement('p', {
                className: 'text-xs text-amber-500'
            }, 'Live Art-Net/sACN is present. HTTP is parked — stop the stream for ~2 s to use Playback and Setup.'),
            live && !liveLocked && React.createElement('p', {
                className: 'text-xs text-amber-500'
            }, 'Live input — Playback is parked. Setup stays available.'),
            status && apiTooOld(status) && React.createElement('p', {
                className: 'text-xs text-amber-500'
            }, `Firmware API ${statusApi(status)} is below companion minimum ${MIN_FIRMWARE_API}. Update the node from the Flash tab.`),
            !liveLocked && statusError && React.createElement('div', {
                className: 'text-sm text-red-500'
            }, statusError)
        ),

        React.createElement('div', {
            className: 'flex-none flex gap-1 border-b border-zinc-200 dark:border-zinc-800'
        },
            ['playback', 'setup'].map((tab) => React.createElement('button', {
                key: tab,
                type: 'button',
                className: `tab-btn ${faceTab === tab ? 'is-active' : ''}`,
                onClick: () => onFaceTab(tab)
            }, tab === 'playback' ? 'Playback' : 'Setup'))
        ),

        faceTab === 'playback'
            ? React.createElement('div', {
                className: 'flex-1 min-h-0 overflow-y-auto pt-3 flex flex-col gap-2'
            },
                React.createElement('div', {
                    className: 'label-micro'
                }, 'Shows'),
                liveLocked && React.createElement('p', {
                    className: 'text-xs text-zinc-500'
                }, 'Shows return when live input goes silent (or set Park portal while live to No).'),
                live && !liveLocked && React.createElement('p', {
                    className: 'text-xs text-zinc-500'
                }, 'Playback stays parked while live input is present.'),
                !httpUp && !liveLocked && React.createElement('p', {
                    className: 'text-xs text-zinc-500'
                }, 'Idle HTTP is required to list and play files on the node.'),
                httpUp && !sdOk && React.createElement('p', {
                    className: 'text-sm text-red-500'
                }, 'No SD card mounted.'),
                httpUp && sdOk && React.createElement(React.Fragment, null,
                    React.createElement('div', {
                        className: 'flex flex-col gap-1'
                    },
                        playRow('root', '/', 'All .dmx in /', 'default'),
                        dirList.map((dir) => playRow('folder', dir, sdDisplayName(dir), 'dir')),
                        fileList.map((file) => playRow('file', file, sdDisplayName(file), '.dmx')),
                        dirList.length === 0 && fileList.length === 0 && React.createElement('p', {
                            className: 'text-xs text-zinc-500 italic px-1'
                        }, 'No .dmx on the card.')
                    ),
                    React.createElement('div', {
                        className: 'readout'
                    }, `Now ${nowText}`),
                    React.createElement('div', {
                        className: 'flex flex-wrap gap-1.5'
                    },
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet',
                            disabled: playDisabled || fileList.length === 0,
                            onClick: onPrev
                        }, 'Prev'),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-primary',
                            disabled: !playReady,
                            onClick: onPlay
                        }, 'Play'),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet',
                            disabled: playDisabled,
                            onClick: onStop
                        }, 'Stop'),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet',
                            disabled: playDisabled || fileList.length === 0,
                            onClick: onNext
                        }, 'Next'),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet',
                            disabled: playDisabled || !fileSelected,
                            onClick: onRenameShow
                        }, 'Rename'),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet',
                            disabled: playDisabled || !fileSelected,
                            onClick: onPullShow
                        }, 'Pull to library')
                    ),
                    renaming && React.createElement('div', {
                        className: 'flex items-center gap-1.5'
                    },
                        React.createElement('input', {
                            className: 'field',
                            value: renameDraft,
                            disabled: playDisabled,
                            autoFocus: true,
                            onChange: (event) => onRenameDraftChange(event.target.value)
                        }),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-primary flex-none',
                            disabled: playDisabled || !String(renameDraft || '').trim(),
                            onClick: onRenameConfirm
                        }, 'Save name'),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet flex-none',
                            disabled: playDisabled,
                            onClick: onRenameCancel
                        }, 'Cancel')
                    ),
                    playSrc === 'file' && React.createElement(Field, { label: 'Loop' },
                        React.createElement('select', {
                            className: 'field',
                            value: fileLoop,
                            disabled: playDisabled,
                            onChange: (event) => onFileLoopChange(event.target.value)
                        },
                            React.createElement('option', { value: 'one' }, 'This file'),
                            React.createElement('option', { value: 'all' }, 'All in this folder')
                        )
                    ),
                    playSrc === 'folder' && React.createElement(React.Fragment, null,
                        React.createElement(Field, { label: 'Repeat' },
                            React.createElement('select', {
                                className: 'field',
                                value: folderRep,
                                disabled: playDisabled,
                                onChange: (event) => onFolderRepChange(event.target.value)
                            },
                                React.createElement('option', { value: 'forever' }, 'Forever'),
                                React.createElement('option', { value: 'count' }, 'Set times')
                            )
                        ),
                        folderRep === 'count' && React.createElement(Field, { label: 'Times' },
                            React.createElement('input', {
                                className: 'field',
                                type: 'number',
                                min: 1,
                                max: 99,
                                value: folderN,
                                disabled: playDisabled,
                                onChange: (event) => onFolderNChange(event.target.value)
                            })
                        )
                    ),
                    React.createElement('p', {
                        className: 'text-xs text-zinc-500'
                    }, 'Shows are listed alphabetically. Library Load and the toolbar play from this PC.')
                )
            )
            : React.createElement('div', {
                className: 'flex-1 min-h-0 overflow-y-auto pt-3 flex flex-col gap-2'
            },
                React.createElement('div', {
                    className: 'label-micro'
                }, 'Radio'),
                React.createElement('div', {
                    className: 'flex flex-wrap gap-1.5'
                },
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        disabled: setupDisabled,
                        onClick: onWifiScan
                    }, scanning ? 'Scanning…' : 'Scan'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-primary',
                        disabled: setupDisabled || !String(wifiSsid || '').trim(),
                        onClick: onWifiConnect
                    }, 'Connect'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        disabled: setupDisabled,
                        onClick: onWifiForget
                    }, 'Forget')
                ),
                React.createElement('div', {
                    className: 'flex flex-col gap-1 max-h-40 overflow-y-auto'
                },
                    networks.length === 0
                        ? React.createElement('p', {
                            className: 'text-xs text-zinc-500 italic'
                        }, 'Scan to list 2.4 GHz networks.')
                        : networks.map((net) => React.createElement('button', {
                            key: net.ssid,
                            type: 'button',
                            className: `kv-row text-sm ${wifiSsid === net.ssid ? 'is-active' : ''}`,
                            disabled: setupDisabled,
                            onClick: () => onWifiSsidChange(net.ssid)
                        },
                            React.createElement('span', {
                                className: 'truncate text-left flex-1'
                            }, net.ssid || '(hidden)'),
                            React.createElement('span', {
                                className: 'readout flex-none'
                            }, `${net.secure ? 'lock' : 'open'} ${net.rssi} dBm`)
                        ))
                ),
                React.createElement(Field, { label: 'SSID' },
                    React.createElement('input', {
                        className: 'field',
                        value: wifiSsid,
                        disabled: setupDisabled,
                        autoComplete: 'off',
                        onChange: (event) => onWifiSsidChange(event.target.value)
                    })
                ),
                React.createElement(Field, { label: 'Password' },
                    React.createElement('input', {
                        className: 'field',
                        type: 'password',
                        value: wifiPassword,
                        disabled: setupDisabled,
                        autoComplete: 'off',
                        onChange: (event) => onWifiPasswordChange(event.target.value)
                    })
                ),
                status && (status.saved || status.ip) && React.createElement('div', {
                    className: 'readout'
                }, [
                    status.saved ? `saved ${status.saved} (connects at boot)` : null,
                    status.ip ? `STA ${status.ip}` : null
                ].filter(Boolean).join(' · ')),

                React.createElement('div', {
                    className: 'module-rule label-micro'
                }, 'Output'),
                React.createElement(Field, { label: 'Brightness' },
                    React.createElement('div', {
                        className: 'flex items-center gap-2'
                    },
                        React.createElement('input', {
                            className: 'flex-1 min-w-0 accent-cyan-500',
                            type: 'range',
                            min: 0,
                            max: 255,
                            value: brightness,
                            disabled: setupDisabled,
                            onChange: (event) => onBrightnessChange(event.target.value)
                        }),
                        React.createElement('input', {
                            className: 'field w-16 flex-none text-right readout',
                            type: 'number',
                            min: 0,
                            max: 255,
                            value: brightness,
                            disabled: setupDisabled,
                            onChange: (event) => onBrightnessChange(event.target.value)
                        })
                    )
                ),
                Number(brightness) > 64 && React.createElement('p', {
                    className: 'text-xs text-amber-500'
                }, 'This 8×8 can overheat above 64.'),
                React.createElement('div', {
                    className: 'grid grid-cols-3 gap-1.5'
                },
                    React.createElement(Field, { label: 'Protocol' },
                        React.createElement('select', {
                            className: 'field',
                            value: proto,
                            disabled: setupDisabled,
                            onChange: (event) => onProtoChange(event.target.value)
                        },
                            React.createElement('option', { value: 'auto' }, 'Auto'),
                            React.createElement('option', { value: 'artnet' }, 'Art-Net'),
                            React.createElement('option', { value: 'sacn' }, 'sACN')
                        )
                    ),
                    React.createElement(Field, { label: 'FPS' },
                        React.createElement('select', {
                            className: 'field',
                            value: String(fps),
                            disabled: setupDisabled,
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
                            disabled: setupDisabled,
                            onChange: (event) => onBufChange(event.target.value)
                        },
                            React.createElement('option', { value: '0' }, '0 latest'),
                            React.createElement('option', { value: '1' }, '1 frame'),
                            React.createElement('option', { value: '2' }, '2 frames'),
                            React.createElement('option', { value: '3' }, '3 frames')
                        )
                    )
                ),
                React.createElement(Field, { label: 'Park portal while live' },
                    React.createElement('select', {
                        className: 'field',
                        value: park,
                        disabled: setupDisabled,
                        onChange: (event) => onParkChange(event.target.value)
                    },
                        React.createElement('option', { value: 'yes' }, 'Yes'),
                        React.createElement('option', { value: 'no' }, 'No')
                    )
                )
            )
    );
};

module.exports = DeviceInspector;
