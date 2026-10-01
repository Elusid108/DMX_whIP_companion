// Command / query registry plus the event bus with subscriptions.
//
// Handlers are (payload, context) -> result | Promise<result>. Subscribers
// are per client (the in-process client registers them); a subscription may
// carry maxHz, in which case events are coalesced (latest wins) and delivered
// at most that often. Emitters can ask whether a name has subscribers so a
// timer only runs while someone listens (the universe monitor does this).

const { ENGINE_API_VERSION } = require('./version');
const { ERROR_CODES, EngineError, validateRequest, reply, replyError } = require('./envelope');

const createRouter = (options = {}) => {
    const now = options.now || (() => Date.now());
    const setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer || ((id) => clearTimeout(id));
    const appVersion = options.appVersion || '0.0.0';
    const capabilities = options.capabilities || [];

    const commands = new Map();
    const queries = new Map();
    const subscriptions = new Map();
    const byName = new Map();
    const changeListeners = new Set();
    let nextSub = 1;
    // Optional host check run before every handler: returns an EngineError
    // to refuse the request (the lifecycle guard) or null to let it through.
    let guard = null;

    const register = (map, otherMap, kind, name, handler) => {
        if (typeof handler !== 'function') {
            throw new Error(`${kind} ${name} needs a handler`);
        }
        if (otherMap.has(name)) {
            throw new Error(`${name} is already registered as a ${kind === 'command' ? 'query' : 'command'}`);
        }
        map.set(name, handler);
    };

    const command = (name, handler) => register(commands, queries, 'command', name, handler);
    const query = (name, handler) => register(queries, commands, 'query', name, handler);

    const handle = async (envelope, context = {}) => {
        const bad = validateRequest(envelope);
        if (bad) {
            return replyError(envelope && typeof envelope.id === 'string' ? envelope.id : '', bad);
        }
        if (guard) {
            const blocked = guard(envelope);
            if (blocked) {
                return replyError(envelope.id, blocked);
            }
        }
        const map = envelope.kind === 'command' ? commands : queries;
        const handler = map.get(envelope.name);
        if (!handler) {
            const other = (envelope.kind === 'command' ? queries : commands).has(envelope.name);
            const err = other
                ? new EngineError(ERROR_CODES.BAD_REQUEST, `${envelope.name} is a ${envelope.kind === 'command' ? 'query' : 'command'}`, { name: envelope.name })
                : new EngineError(ERROR_CODES.NOT_FOUND, `Unknown ${envelope.kind} ${envelope.name}`, { name: envelope.name });
            return replyError(envelope.id, err);
        }
        try {
            const result = await handler(envelope.payload || {}, context);
            return reply(envelope.id, result === undefined ? {} : result);
        } catch (err) {
            return replyError(envelope.id, err);
        }
    };

    const notifyChange = (name) => {
        changeListeners.forEach((fn) => {
            try {
                fn(name, hasSubscribers(name));
            } catch (err) {
                console.error('Subscription listener error:', err);
            }
        });
    };

    // deliver(payload, meta) for events; deliver({ header, bytes }) for streams.
    const subscribe = ({ name, maxHz, stream } = {}, deliver) => {
        if (typeof name !== 'string' || !name) {
            throw new EngineError(ERROR_CODES.BAD_REQUEST, 'Subscription needs a name');
        }
        if (typeof deliver !== 'function') {
            throw new Error('Subscription needs a deliver function');
        }
        const hz = Number(maxHz);
        const sub = {
            id: `sub-${nextSub++}`,
            name,
            stream: Boolean(stream),
            deliver,
            intervalMs: Number.isFinite(hz) && hz > 0 ? 1000 / hz : 0,
            lastAt: -Infinity,
            pending: null,
            timer: null
        };
        subscriptions.set(sub.id, sub);
        if (!byName.has(name)) {
            byName.set(name, new Set());
        }
        byName.get(name).add(sub);
        notifyChange(name);
        return sub.id;
    };

    const unsubscribe = (id) => {
        const sub = subscriptions.get(id);
        if (!sub) {
            return false;
        }
        subscriptions.delete(id);
        const set = byName.get(sub.name);
        if (set) {
            set.delete(sub);
            if (!set.size) {
                byName.delete(sub.name);
            }
        }
        if (sub.timer) {
            clearTimer(sub.timer);
            sub.timer = null;
        }
        sub.pending = null;
        notifyChange(sub.name);
        return true;
    };

    const hasSubscribers = (name) => {
        const set = byName.get(name);
        return Boolean(set && set.size);
    };

    const onSubscriptionChange = (fn) => {
        changeListeners.add(fn);
        return () => changeListeners.delete(fn);
    };

    const flush = (sub) => {
        sub.timer = null;
        if (sub.pending) {
            const item = sub.pending;
            sub.pending = null;
            sub.lastAt = now();
            sub.deliver(item.payload, item.meta);
        }
    };

    const dispatch = (sub, payload, meta) => {
        if (!sub.intervalMs) {
            sub.deliver(payload, meta);
            return;
        }
        const t = now();
        const wait = sub.lastAt + sub.intervalMs - t;
        if (wait <= 0 && !sub.timer) {
            sub.lastAt = t;
            sub.deliver(payload, meta);
            return;
        }
        sub.pending = { payload, meta };
        if (!sub.timer) {
            sub.timer = setTimer(() => flush(sub), Math.max(1, Math.ceil(wait)));
        }
    };

    const emit = (name, payload = {}) => {
        const set = byName.get(name);
        if (!set) {
            return;
        }
        for (const sub of set) {
            if (!sub.stream) {
                dispatch(sub, payload, { name });
            }
        }
    };

    const emitStream = (name, header, bytes) => {
        const set = byName.get(name);
        if (!set) {
            return;
        }
        for (const sub of set) {
            if (sub.stream) {
                dispatch(sub, { header, bytes }, { name, stream: true });
            }
        }
    };

    const close = () => {
        for (const id of [...subscriptions.keys()]) {
            unsubscribe(id);
        }
        changeListeners.clear();
    };

    query('engine.hello', (payload = {}) => {
        const wanted = Number(payload.clientApiVersion);
        if (wanted !== ENGINE_API_VERSION) {
            throw new EngineError(
                ERROR_CODES.UNSUPPORTED_VERSION,
                `Engine serves API version ${ENGINE_API_VERSION}`,
                { apiVersion: ENGINE_API_VERSION }
            );
        }
        return { apiVersion: ENGINE_API_VERSION, appVersion, capabilities: capabilities.slice() };
    });

    return {
        command,
        query,
        handle,
        has: (name) => commands.has(name) || queries.has(name),
        setGuard: (fn) => {
            guard = typeof fn === 'function' ? fn : null;
        },
        subscribe,
        unsubscribe,
        hasSubscribers,
        onSubscriptionChange,
        emit,
        emitStream,
        close
    };
};

module.exports = { createRouter };
