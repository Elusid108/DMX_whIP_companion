const test = require('node:test');
const assert = require('node:assert/strict');
const { ENGINE_API_VERSION } = require('./version');
const { validateRequest, request, ERROR_CODES, EngineError } = require('./envelope');
const { createRouter } = require('./router');
const { createInProcessClient } = require('./inProcess');

test('envelope validation', () => {
    assert.equal(validateRequest(request('1', 'command', 'live.set', {})), null);
    assert.equal(validateRequest({ id: '1', kind: 'command', name: 'live.set' }), null);
    assert.equal(validateRequest(null).code, ERROR_CODES.BAD_REQUEST);
    assert.equal(validateRequest({ kind: 'command', name: 'a.b' }).code, ERROR_CODES.BAD_REQUEST);
    assert.equal(validateRequest({ id: '1', kind: 'event', name: 'a.b' }).code, ERROR_CODES.BAD_REQUEST);
    assert.equal(validateRequest({ id: '1', kind: 'query', name: 'nodots' }).code, ERROR_CODES.BAD_REQUEST);
    assert.equal(validateRequest({ id: '1', kind: 'query', name: 'a.b', payload: [] }).code, ERROR_CODES.BAD_REQUEST);
});

test('router: commands, queries, unknown names and thrown errors', async () => {
    const router = createRouter({ appVersion: '9.9.9', capabilities: ['x'] });
    router.command('demo.add', ({ a, b }) => ({ sum: a + b }));
    router.query('demo.fail', () => {
        throw new EngineError(ERROR_CODES.CONFLICT, 'busy', { why: 'test' });
    });
    router.query('demo.crash', () => {
        throw new Error('boom');
    });
    assert.throws(() => router.query('demo.add', () => {}), /already registered/);

    const ok = await router.handle(request('r1', 'command', 'demo.add', { a: 2, b: 3 }));
    assert.deepEqual(ok, { id: 'r1', ok: true, result: { sum: 5 } });

    const missing = await router.handle(request('r2', 'command', 'demo.nope'));
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, ERROR_CODES.NOT_FOUND);

    const wrongKind = await router.handle(request('r3', 'query', 'demo.add'));
    assert.equal(wrongKind.error.code, ERROR_CODES.BAD_REQUEST);

    const conflict = await router.handle(request('r4', 'query', 'demo.fail'));
    assert.deepEqual(conflict.error, { code: ERROR_CODES.CONFLICT, message: 'busy', data: { why: 'test' } });

    const crash = await router.handle(request('r5', 'query', 'demo.crash'));
    assert.deepEqual(crash.error, { code: ERROR_CODES.INTERNAL, message: 'boom' });

    const bad = await router.handle({ id: 7 });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, ERROR_CODES.BAD_REQUEST);
});

test('handshake carries the API version and rejects others', async () => {
    const router = createRouter({ appVersion: '1.2.3', capabilities: ['monitor'] });
    const client = createInProcessClient(router, { client: 'test' });
    const hello = await client.hello();
    assert.deepEqual(hello, { apiVersion: ENGINE_API_VERSION, appVersion: '1.2.3', capabilities: ['monitor'] });
    await assert.rejects(
        client.query('engine.hello', { clientApiVersion: ENGINE_API_VERSION + 1 }),
        (err) => err.code === ERROR_CODES.UNSUPPORTED_VERSION && err.data.apiVersion === ENGINE_API_VERSION
    );
    client.close();
});

test('events reach subscribers, rate limits coalesce, unsubscribe stops delivery', async () => {
    let t = 0;
    const timers = [];
    const router = createRouter({
        now: () => t,
        setTimer: (fn, ms) => {
            const id = { fn, at: t + ms };
            timers.push(id);
            return id;
        },
        clearTimer: (id) => {
            const i = timers.indexOf(id);
            if (i >= 0) timers.splice(i, 1);
        }
    });
    const tick = (ms) => {
        t += ms;
        for (const id of [...timers]) {
            if (id.at <= t) {
                timers.splice(timers.indexOf(id), 1);
                id.fn();
            }
        }
    };
    const client = createInProcessClient(router, { client: 'a' });
    const all = [];
    const limited = [];
    const changes = [];
    router.onSubscriptionChange((name, any) => changes.push(`${name}:${any}`));

    const id1 = client.subscribe('demo.tick', (p) => all.push(p.n));
    const id2 = client.subscribe('demo.tick', (p) => limited.push(p.n), { maxHz: 10 });
    assert.equal(router.hasSubscribers('demo.tick'), true);

    for (let n = 1; n <= 5; n += 1) {
        router.emit('demo.tick', { n });
        tick(20);
    }
    // 100 ms elapsed: unlimited saw all five, limited saw the first then the latest.
    assert.deepEqual(all, [1, 2, 3, 4, 5]);
    assert.deepEqual(limited, [1, 5]);
    tick(200);
    assert.deepEqual(limited, [1, 5], 'nothing pending after the flush');

    // Through the envelope too.
    const res = await client.send({ id: 's', kind: 'command', name: 'engine.subscribe', payload: { name: 'demo.other', handler: (p) => all.push(p) } });
    assert.equal(res.ok, true);
    router.emit('demo.other', 'x');
    assert.equal(all[all.length - 1], 'x');

    client.unsubscribe(id1);
    client.unsubscribe(id2);
    router.emit('demo.tick', { n: 6 });
    assert.deepEqual(all.filter((v) => v === 6), []);
    const un = await client.send({ id: 'u', kind: 'command', name: 'engine.unsubscribe', payload: { subscriptionId: res.result.subscriptionId } });
    assert.equal(un.ok, true);
    assert.equal(router.hasSubscribers('demo.other'), false);
    assert.equal(router.hasSubscribers('demo.tick'), false);
    assert.deepEqual(changes, ['demo.tick:true', 'demo.tick:true', 'demo.other:true', 'demo.tick:true', 'demo.tick:false', 'demo.other:false']);

    const bad = await client.send({ id: 'u2', kind: 'command', name: 'engine.unsubscribe', payload: { subscriptionId: 'nope' } });
    assert.equal(bad.error.code, ERROR_CODES.NOT_FOUND);
    client.close();
});

test('stream frames go to stream subscribers only, events to event subscribers only', () => {
    const router = createRouter();
    const client = createInProcessClient(router);
    const frames = [];
    const events = [];
    client.onStream((f) => frames.push(f));
    client.subscribe('grid.frame', null, { stream: true });
    client.subscribe('grid.frame', (p) => events.push(p));
    const bytes = new Uint8Array([1, 2, 3]);
    router.emitStream('grid.frame', { universe: 1 }, bytes);
    router.emit('grid.frame', { json: true });
    assert.deepEqual(frames, [{ name: 'grid.frame', header: { universe: 1 }, bytes }]);
    assert.deepEqual(events, [{ json: true }]);
    client.close();
    router.emitStream('grid.frame', { universe: 2 }, bytes);
    assert.equal(frames.length, 1, 'closed client receives nothing');
    assert.equal(router.hasSubscribers('grid.frame'), false);
});

test('client close is safe and later requests fail cleanly', async () => {
    const router = createRouter();
    const client = createInProcessClient(router);
    client.close();
    client.close();
    const res = await client.send(request('x', 'query', 'engine.hello', { clientApiVersion: 1 }));
    assert.equal(res.error.code, ERROR_CODES.UNAVAILABLE);
    assert.throws(() => client.subscribe('a.b', () => {}), (e) => e.code === ERROR_CODES.UNAVAILABLE);
});
