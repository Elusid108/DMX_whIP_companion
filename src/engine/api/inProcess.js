// In-process client for the engine API: the same envelopes a socket would
// carry, without a socket. Electron's main process hosts one of these per
// window; tests host one per engine.

const { ERROR_CODES, EngineError, request, reply, replyError, validateRequest } = require('./envelope');
const { ENGINE_API_VERSION } = require('./version');

const createInProcessClient = (router, options = {}) => {
    const clientName = options.client || 'in-process';
    let nextId = 1;
    const owned = new Map();
    const streamListeners = new Set();
    let closed = false;

    // Raw envelope in, reply envelope out. engine.subscribe/unsubscribe are
    // answered here because a subscription belongs to this client.
    const send = async (envelope) => {
        if (closed) {
            return replyError(envelope && envelope.id ? envelope.id : '', new EngineError(ERROR_CODES.UNAVAILABLE, 'Client is closed'));
        }
        const bad = validateRequest(envelope);
        if (bad) {
            return replyError(envelope && typeof envelope.id === 'string' ? envelope.id : '', bad);
        }
        if (envelope.name === 'engine.subscribe' || envelope.name === 'engine.unsubscribe') {
            if (envelope.kind !== 'command') {
                return replyError(envelope.id, new EngineError(ERROR_CODES.BAD_REQUEST, `${envelope.name} is a command`));
            }
            try {
                if (envelope.name === 'engine.subscribe') {
                    const p = envelope.payload || {};
                    const id = subscribe(p.name, p.handler, { maxHz: p.maxHz, stream: p.stream });
                    return reply(envelope.id, { subscriptionId: id });
                }
                const p = envelope.payload || {};
                if (!unsubscribe(p.subscriptionId)) {
                    throw new EngineError(ERROR_CODES.NOT_FOUND, 'Unknown subscription', { subscriptionId: p.subscriptionId });
                }
                return reply(envelope.id, {});
            } catch (err) {
                return replyError(envelope.id, err);
            }
        }
        return router.handle(envelope, { client: clientName });
    };

    const call = async (kind, name, payload) => {
        const res = await send(request(`${clientName}-${nextId++}`, kind, name, payload || {}));
        if (!res.ok) {
            const err = new EngineError(res.error.code, res.error.message, res.error.data);
            throw err;
        }
        return res.result;
    };

    const command = (name, payload) => call('command', name, payload);
    const query = (name, payload) => call('query', name, payload);
    const hello = (payload = {}) => query('engine.hello', { clientApiVersion: ENGINE_API_VERSION, client: clientName, ...payload });

    // handler(payload) for events; handler({ header, bytes }) for streams.
    // Without a handler, stream frames go to onStream listeners.
    const subscribe = (name, handler, opts = {}) => {
        if (closed) {
            throw new EngineError(ERROR_CODES.UNAVAILABLE, 'Client is closed');
        }
        const deliver = typeof handler === 'function'
            ? handler
            : (opts.stream
                ? (frame, meta) => streamListeners.forEach((fn) => fn({ name: meta.name, ...frame }))
                : () => {});
        const id = router.subscribe({ name, maxHz: opts.maxHz, stream: opts.stream }, deliver);
        owned.set(id, name);
        return id;
    };

    const unsubscribe = (id) => {
        if (!owned.has(id)) {
            return false;
        }
        owned.delete(id);
        return router.unsubscribe(id);
    };

    const onStream = (fn) => {
        streamListeners.add(fn);
        return () => streamListeners.delete(fn);
    };

    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        for (const id of [...owned.keys()]) {
            router.unsubscribe(id);
        }
        owned.clear();
        streamListeners.clear();
    };

    return { send, command, query, hello, subscribe, unsubscribe, onStream, close, name: clientName };
};

module.exports = { createInProcessClient };
