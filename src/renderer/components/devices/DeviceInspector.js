const React = require('react');
const { MIN_FIRMWARE_API, statusApi, apiTooOld } = require('../../../services/shared/firmwareCompat');

const ORDER_PREFIX = /^(\d{2})_/;

const sdDisplayName = (sdPath) => {
    const base = String(sdPath || '').split('/').pop() || '';
    return base.replace(/\.dmx$/i, '').replace(ORDER_PREFIX, '') || sdPath;
};

const DeviceInspector = ({
    device,
    status,
    statusError,
    liveLocked,
    via,
    files,
    pullPath,
    busy,
    onPullPathChange,
    onPullShow
}) => {
    if (!device) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'Select a node to see details.');
    }

    const portalUrl = via ? `http://${via}/` : '';
    const httpUp = Boolean(status) && !statusError && !device.stale && !liveLocked;
    const showPortal = Boolean(portalUrl) && !device.stale;
    const coverPortal = showPortal && !httpUp;
    const fileList = Array.isArray(files) ? files : [];
    const pullDisabled = busy || !httpUp || !pullPath;

    return React.createElement('div', {
        className: 'h-full flex flex-col max-w-xl mx-auto w-full min-h-0'
    },
        React.createElement('div', {
            className: 'status-strip flex-none'
        },
            liveLocked && React.createElement('p', {
                className: 'text-xs text-amber-500'
            }, 'Live input — portal HTTP is down. Playback is parked.'),
            status && !liveLocked && status.live && React.createElement('p', {
                className: 'text-xs text-amber-500'
            }, 'Live input — Setup stays available. Playback is parked.'),
            status && apiTooOld(status) && React.createElement('p', {
                className: 'text-xs text-amber-500'
            }, `Firmware API ${statusApi(status)} is below companion minimum ${MIN_FIRMWARE_API}. Update the node from the Flash tab.`),
            !liveLocked && statusError && React.createElement('div', {
                className: 'text-sm text-red-500'
            }, statusError)
        ),
        React.createElement('div', {
            className: 'relative flex-1 min-h-0 rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-950'
        },
            showPortal
                ? React.createElement('webview', {
                    key: portalUrl,
                    src: portalUrl,
                    className: 'absolute inset-0 w-full h-full',
                    style: { width: '100%', height: '100%' }
                })
                : React.createElement('div', {
                    className: 'absolute inset-0 flex items-center justify-center text-sm text-zinc-500 italic p-4 text-center'
                }, device.stale
                    ? 'Node is stale — waiting for ArtPollReply.'
                    : 'Waiting for node HTTP…'),
            coverPortal && React.createElement('div', {
                className: 'absolute inset-0 flex items-center justify-center bg-zinc-950/80 text-sm text-zinc-300 p-4 text-center'
            }, liveLocked
                ? 'Live input — portal HTTP is down.'
                : (statusError || 'Node HTTP is unavailable.'))
        ),
        React.createElement('div', {
            className: 'flex-none pt-3 flex flex-col gap-1.5'
        },
            React.createElement('div', {
                className: 'label-micro'
            }, 'Pull to library'),
            React.createElement('div', {
                className: 'flex items-center gap-1.5'
            },
                React.createElement('select', {
                    className: 'field',
                    value: pullPath,
                    disabled: busy || !httpUp || fileList.length === 0,
                    onChange: (event) => onPullPathChange(event.target.value)
                },
                    fileList.length === 0
                        ? React.createElement('option', { value: '' }, httpUp ? 'No .dmx on the card' : 'Idle HTTP required')
                        : fileList.map((file) => React.createElement('option', {
                            key: file,
                            value: file
                        }, sdDisplayName(file)))
                ),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet flex-none',
                    disabled: pullDisabled,
                    onClick: onPullShow
                }, busy ? 'Pulling…' : 'Pull')
            )
        )
    );
};

module.exports = DeviceInspector;
