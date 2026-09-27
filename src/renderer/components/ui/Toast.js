const React = require('react');
const { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } = React;
const cx = require('./cx');
const { Close } = require('./icons');

const ToastContext = createContext(() => {});

const TONES = {
    info: 'border-line',
    ok: 'border-ok/60',
    warn: 'border-warn/60',
    danger: 'border-danger/60'
};

// toast('Saved') or toast({ message, tone: info|ok|warn|danger, timeout }).
// timeout 0 keeps it until dismissed. Newest sits at the bottom.
const ToastProvider = ({ children }) => {
    const [items, setItems] = useState([]);
    const nextId = useRef(1);
    const timers = useRef(new Map());

    const dismiss = useCallback((id) => {
        const timer = timers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
        setItems((list) => list.filter((item) => item.id !== id));
    }, []);

    const toast = useCallback((input) => {
        const opts = typeof input === 'string' ? { message: input } : (input || {});
        const id = nextId.current;
        nextId.current += 1;
        const timeout = opts.timeout === undefined ? 4000 : opts.timeout;
        setItems((list) => [...list.slice(-3), { id, message: opts.message, tone: opts.tone || 'info' }]);
        if (timeout > 0) {
            timers.current.set(id, setTimeout(() => dismiss(id), timeout));
        }
        return id;
    }, [dismiss]);

    useEffect(() => () => {
        timers.current.forEach((timer) => clearTimeout(timer));
        timers.current.clear();
    }, []);

    const value = useMemo(() => toast, [toast]);

    return React.createElement(ToastContext.Provider, { value },
        children,
        React.createElement('div', {
            className: 'fixed z-50 bottom-3 left-3 right-3 sm:left-auto sm:w-80 flex flex-col gap-2 pointer-events-none',
            role: 'status',
            'aria-live': 'polite'
        }, items.map((item) => React.createElement('div', {
            key: item.id,
            className: cx('pop-panel pointer-events-auto flex items-start gap-2 text-sm border-l-4', TONES[item.tone] || TONES.info)
        },
            React.createElement('span', { className: 'flex-1 min-w-0 break-words' }, item.message),
            React.createElement('button', {
                type: 'button',
                className: 'btn-ghost',
                title: 'Dismiss',
                'aria-label': 'Dismiss',
                onClick: () => dismiss(item.id)
            }, React.createElement(Close))
        )))
    );
};

const useToast = () => useContext(ToastContext);

module.exports = { ToastProvider, useToast };
