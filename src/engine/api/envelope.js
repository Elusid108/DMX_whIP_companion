// Message envelope for the engine API (docs/engine/API.md §1-2).
//
//   request: { id, kind: 'command' | 'query', name, payload }
//   reply:   { id, ok: true, result } | { id, ok: false, error: { code, message, data? } }
//   event:   { kind: 'event', name, payload }

const ERROR_CODES = Object.freeze({
    BAD_REQUEST: 'bad_request',
    NOT_FOUND: 'not_found',
    CONFLICT: 'conflict',
    UNAVAILABLE: 'unavailable',
    UNSUPPORTED_VERSION: 'unsupported_version',
    INTERNAL: 'internal'
});

const KINDS = new Set(['command', 'query']);
const NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

class EngineError extends Error {
    constructor(code, message, data) {
        super(message);
        this.name = 'EngineError';
        this.code = code;
        if (data !== undefined) {
            this.data = data;
        }
    }
}

const errorBody = (err) => {
    if (err instanceof EngineError) {
        const body = { code: err.code, message: err.message };
        if (err.data !== undefined) {
            body.data = err.data;
        }
        return body;
    }
    return { code: ERROR_CODES.INTERNAL, message: err && err.message ? err.message : String(err) };
};

const isValidName = (name) => typeof name === 'string' && NAME.test(name);

// Returns null when the envelope is well formed, else an EngineError.
const validateRequest = (envelope) => {
    if (!envelope || typeof envelope !== 'object') {
        return new EngineError(ERROR_CODES.BAD_REQUEST, 'Request must be an object');
    }
    if (typeof envelope.id !== 'string' || !envelope.id) {
        return new EngineError(ERROR_CODES.BAD_REQUEST, 'Request needs a string id');
    }
    if (!KINDS.has(envelope.kind)) {
        return new EngineError(ERROR_CODES.BAD_REQUEST, 'Request kind must be command or query', { kind: envelope.kind });
    }
    if (!isValidName(envelope.name)) {
        return new EngineError(ERROR_CODES.BAD_REQUEST, 'Request name must be dotted, like area.verb', { name: envelope.name });
    }
    if (envelope.payload !== undefined && (envelope.payload === null || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload))) {
        return new EngineError(ERROR_CODES.BAD_REQUEST, 'Request payload must be an object');
    }
    return null;
};

const request = (id, kind, name, payload = {}) => ({ id, kind, name, payload });
const reply = (id, result) => ({ id, ok: true, result });
const replyError = (id, err) => ({ id, ok: false, error: errorBody(err) });
const event = (name, payload = {}) => ({ kind: 'event', name, payload });

module.exports = {
    ERROR_CODES,
    EngineError,
    errorBody,
    isValidName,
    validateRequest,
    request,
    reply,
    replyError,
    event
};
