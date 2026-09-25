const React = require('react');
const { useEffect, useRef, useState } = React;
const { MIN_FIRMWARE_API, statusApi, apiTooOld } = require('../../../services/shared/firmwareCompat');

const ORDER_PREFIX = /^(\d{2})_/;
const GUEST_SCROLL_CSS = 'html, body { overflow: auto !important; }';
const TAB_BUTTONS = ['tabLive', 'tabPlay', 'tabPixels', 'tabSetup'];
const TAB_NAMES = {
    tabLive: 'live',
    tabPlay: 'play',
    tabPixels: 'pixels',
    tabSetup: 'setup'
};

const tabRestoreJs = (buttonId) => {
    const name = TAB_NAMES[buttonId] || 'live';
    return `(function(){
        if(!window.__whipTabWatch){
            window.__whipTabWatch=true;
            var buttons=document.querySelectorAll('.tabs button');
            for(var i=0;i<buttons.length;i++){
                buttons[i].addEventListener('click',function(){console.log('whip-tab:'+this.id);});
            }
        }
        if(${JSON.stringify(name)}==='live'||window.__whipTabWrap||typeof showTab!=='function') return;
        window.__whipTabWrap=true;
        var orig=showTab;
        var want=${JSON.stringify(name)};
        var hold=true;
        showTab=function(next){
            if(hold&&next==='live'){
                hold=false;
                return orig.call(this,want);
            }
            hold=false;
            return orig.apply(this,arguments);
        };
        orig(want);
    })();`;
};

const sdDisplayName = (sdPath) => {
    const base = String(sdPath || '').split('/').pop() || '';
    return base.replace(/\.dmx$/i, '').replace(ORDER_PREFIX, '') || sdPath;
};

const guestPath = (raw) => {
    if (!raw) {
        return '';
    }
    try {
        const url = new URL(raw);
        if (url.protocol !== 'http:') {
            return '';
        }
        const path = `${url.pathname || '/'}${url.search}${url.hash}`;
        return path.startsWith('/') ? path : `/${path}`;
    } catch (err) {
        return '';
    }
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
    onPullShow,
    onReboot
}) => {
    const pageRef = useRef('/');
    const tabRef = useRef('tabLive');
    const hostRef = useRef('');
    const srcRef = useRef('');
    const webviewRef = useRef(null);
    const [concealed, setConcealed] = useState(false);
    if (via !== hostRef.current) {
        hostRef.current = via || '';
        const path = pageRef.current || '/';
        srcRef.current = via
            ? `http://${via}${path.startsWith('/') ? path : `/${path}`}`
            : '';
        const nextConcealed = Boolean(via) && tabRef.current !== 'tabLive';
        if (nextConcealed !== concealed) {
            setConcealed(nextConcealed);
        }
    }
    const portalUrl = srcRef.current;
    const showPortal = Boolean(portalUrl) && Boolean(device) && !device.stale;

    useEffect(() => {
        const el = webviewRef.current;
        if (!el) {
            return undefined;
        }
        const remember = (event) => {
            const path = guestPath(event && event.url);
            if (path) {
                pageRef.current = path;
            }
        };
        const onReady = () => {
            const wanted = tabRef.current;
            const reveal = () => {
                el.style.visibility = 'visible';
                setConcealed(false);
            };
            if (typeof el.executeJavaScript === 'function') {
                const restore = el.executeJavaScript(tabRestoreJs(wanted));
                if (restore && typeof restore.then === 'function') {
                    restore.then(reveal, reveal);
                } else {
                    reveal();
                }
            } else {
                reveal();
            }
            if (typeof el.insertCSS !== 'function') {
                return;
            }
            const result = el.insertCSS(GUEST_SCROLL_CSS);
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        };
        const onConsole = (event) => {
            const msg = String((event && event.message) || '');
            if (msg.indexOf('whip-tab:') !== 0) {
                return;
            }
            const id = msg.slice('whip-tab:'.length);
            if (TAB_BUTTONS.indexOf(id) >= 0) {
                tabRef.current = id;
            }
        };
        el.addEventListener('did-navigate', remember);
        el.addEventListener('did-navigate-in-page', remember);
        el.addEventListener('dom-ready', onReady);
        el.addEventListener('console-message', onConsole);
        return () => {
            try {
                const path = guestPath(typeof el.getURL === 'function' ? el.getURL() : '');
                if (path) {
                    pageRef.current = path;
                }
            } catch (err) {
                // The guest is already gone.
            }
            el.removeEventListener('did-navigate', remember);
            el.removeEventListener('did-navigate-in-page', remember);
            el.removeEventListener('dom-ready', onReady);
            el.removeEventListener('console-message', onConsole);
        };
    }, [via, showPortal]);

    if (!device) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'Select a node to see details.');
    }

    const httpUp = Boolean(status) && !statusError && !device.stale && !liveLocked;
    const canReboot = Boolean(device.ip) && !device.stale && !busy && Boolean(status || liveLocked);
    const coverPortal = showPortal && !httpUp;
    const fileList = Array.isArray(files) ? files : [];
    const pullDisabled = busy || !httpUp || !pullPath;

    return React.createElement('div', {
        className: 'flex-1 flex flex-col max-w-xl mx-auto w-full min-h-[40rem]'
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
            statusError && React.createElement('div', {
                className: 'text-sm text-red-500'
            }, statusError)
        ),
        React.createElement('div', {
            className: 'relative flex-1 min-h-[28rem] rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-950'
        },
            showPortal
                ? React.createElement('webview', {
                    key: via,
                    ref: webviewRef,
                    src: portalUrl,
                    className: 'w-full h-full',
                    style: {
                        width: '100%',
                        height: '100%',
                        visibility: concealed ? 'hidden' : 'visible'
                    }
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
                }, busy ? 'Pulling…' : 'Pull'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet flex-none',
                    disabled: !canReboot,
                    onClick: onReboot
                }, 'Reboot')
            )
        )
    );
};

module.exports = DeviceInspector;
