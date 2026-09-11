// Relay tests. Real sockets against a real server on an ephemeral port — the
// relay is small enough that stubbing it would only test the stub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelay, PROTOCOL } from './relay.mjs';

/** Boot a relay on a free port; every test gets its own. */
async function withRelay(fn, opts = {}) {
  const relay = createRelay({ serveGame: true, ...opts });
  const port = await relay.listen(0);
  const clients = [];
  try {
    await fn({
      port,
      relay,
      /** Connect a client that queues frames and can await the next one. */
      async client() {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const queue = [];
        const waiters = [];
        ws.addEventListener('message', (ev) => {
          const msg = JSON.parse(ev.data);
          if (waiters.length) waiters.shift()(msg);
          else queue.push(msg);
        });
        await new Promise((ok, bad) => {
          ws.addEventListener('open', ok, { once: true });
          ws.addEventListener('error', () => bad(new Error('connect failed')), { once: true });
        });
        const c = {
          ws,
          send(m) { ws.send(JSON.stringify(m)); },
          next(timeout = 2000) {
            if (queue.length) return Promise.resolve(queue.shift());
            return new Promise((ok, bad) => {
              const timer = setTimeout(() => bad(new Error('timed out waiting for a frame')), timeout);
              waiters.push((m) => { clearTimeout(timer); ok(m); });
            });
          },
          /** Nothing should arrive — used to prove a sender is not echoed to. */
          async silent(ms = 150) {
            await new Promise(r => setTimeout(r, ms));
            assert.equal(queue.length, 0, `expected silence, got ${JSON.stringify(queue)}`);
          },
          async join(room, name) {
            c.send({ t: 'join', v: PROTOCOL, room, name });
            return c.next();
          },
          close() { ws.close(); }
        };
        clients.push(c);
        return c;
      }
    });
  } finally {
    for (const c of clients) c.close();
    await relay.close();
  }
}

test('creating a room hands back a code and makes you the host', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    const joined = await a.join();
    assert.equal(joined.t, 'joined');
    assert.match(joined.room, /^[A-Z2-9]{4}$/);
    assert.equal(joined.host, joined.id);
    assert.deepEqual(joined.peers, []);
  });
});

test('a second client joins the same room and both learn about each other', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    const b = await h.client();
    const first = await a.join(undefined, 'Ada');
    const second = await b.join(first.room, 'Bo');

    // B sees A already seated, and agrees A is the host.
    assert.deepEqual(second.peers, [{ id: first.id, name: 'Ada' }]);
    assert.equal(second.host, first.id);

    // A is told B arrived.
    assert.deepEqual(await a.next(), { t: 'peer', id: second.id, name: 'Bo' });
  });
});

test('messages reach the other player verbatim and are not echoed back', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    const b = await h.client();
    const first = await a.join();
    await b.join(first.room);
    await a.next(); // the 'peer' notice

    const shot = { kind: 'turn', angle: 47, power: 62, weapon: 'mirv' };
    a.send({ t: 'msg', d: shot });

    const got = await b.next();
    assert.equal(got.t, 'msg');
    assert.equal(got.from, first.id);
    assert.deepEqual(got.d, shot, 'the relay must not touch the payload');
    await a.silent();
  });
});

test('a departure is announced and hands the host role on', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    const b = await h.client();
    const first = await a.join();
    const second = await b.join(first.room);
    await a.next(); // 'peer'

    a.close();
    const gone = await b.next();
    assert.equal(gone.t, 'gone');
    assert.equal(gone.id, first.id);
    assert.equal(gone.host, second.id, 'the remaining player becomes host');
  });
});

test('an emptied room is held open, so a dropped player can come back to it', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    const { room } = await a.join();
    a.close();
    await new Promise(r => setTimeout(r, 100));

    // The room used to be destroyed the instant it emptied, which lost the code
    // to any blip in the connection.
    assert.equal(h.relay.rooms.size, 1, 'still held');
    const back = await h.client();
    assert.equal((await back.join(room)).t, 'joined', 'the same code still works');
  });
});

test('a held room is forgotten once its grace period runs out', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    const { room } = await a.join();
    a.close();
    await new Promise(r => setTimeout(r, 300));

    assert.equal(h.relay.rooms.size, 0, 'swept');
    const b = await h.client();
    assert.equal((await b.join(room)).code, 'NO_ROOM');
  }, { roomGraceMs: 30, sweepMs: 20 });   // short enough to watch expire
});

test('health separates rooms in play from rooms merely held', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    await a.join();
    let health = await (await fetch(`http://127.0.0.1:${h.port}/health`)).json();
    assert.equal(health.rooms, 1);
    assert.equal(health.held, 0);

    a.close();
    await new Promise(r => setTimeout(r, 100));
    health = await (await fetch(`http://127.0.0.1:${h.port}/health`)).json();
    assert.equal(health.rooms, 0, 'nobody is in it');
    assert.equal(health.held, 1, 'but it is still there to come back to');
  });
});

test('room codes are case-insensitive', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    const { room } = await a.join();
    const b = await h.client();
    assert.equal((await b.join(room.toLowerCase())).t, 'joined');
  });
});

test('a fifth player is turned away rather than seated', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    const { room } = await a.join();
    for (let i = 0; i < 3; i++) {
      const c = await h.client();
      assert.equal((await c.join(room)).t, 'joined');
    }
    const fifth = await h.client();
    assert.equal((await fifth.join(room)).code, 'ROOM_FULL');
  });
});

test('a client speaking another protocol version is refused', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    a.send({ t: 'join', v: PROTOCOL + 1 });
    assert.equal((await a.next()).code, 'BAD_VERSION');
  });
});

test('junk and out-of-order frames are rejected, not crashed on', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    a.ws.send('not json at all');
    assert.equal((await a.next()).code, 'BAD_JSON');

    a.send({ t: 'msg', d: 1 });
    assert.equal((await a.next()).code, 'NOT_JOINED');

    a.send({ t: 'nonsense' });
    assert.equal((await a.next()).code, 'BAD_TYPE');

    // Still usable afterwards.
    assert.equal((await a.join()).t, 'joined');
  });
});

test('a flood is throttled instead of relayed', async () => {
  await withRelay(async (h) => {
    const a = await h.client();
    await a.join();
    // Fire the burst without waiting: a lone player in a room gets no reply to
    // a relayed message, so the only frame that can come back is the refusal.
    for (let i = 0; i < 200; i++) a.send({ t: 'msg', d: i });
    assert.equal((await a.next()).code, 'RATE');
  });
});

test('health reports the live room count', async () => {
  await withRelay(async (h) => {
    const before = await (await fetch(`http://127.0.0.1:${h.port}/health`)).json();
    assert.deepEqual(before,
      { ok: true, rooms: 0, held: 0, sockets: 0, protocol: PROTOCOL });
    const a = await h.client();
    await a.join();
    const after = await (await fetch(`http://127.0.0.1:${h.port}/health`)).json();
    assert.equal(after.rooms, 1);
  });
});

test('the dev server serves the game but nothing above the repo', async () => {
  await withRelay(async (h) => {
    const page = await fetch(`http://127.0.0.1:${h.port}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /__BARRAGE_TEST__/);

    const escape = await fetch(`http://127.0.0.1:${h.port}/../../../etc/passwd`);
    assert.ok(escape.status === 403 || escape.status === 404, `got ${escape.status}`);
  });
});

test('the game and the worker are always revalidated; the icons are not', async () => {
  await withRelay(async (h) => {
    const base = `http://127.0.0.1:${h.port}`;
    // Without this a deploy can stay invisible on a phone: the page's
    // <meta http-equiv="Cache-Control"> tags do nothing for HTTP caching, and
    // an installed copy would keep serving the build before last.
    for (const path of ['/', '/sw.js', '/manifest.webmanifest']) {
      const res = await fetch(base + path);
      assert.equal(res.headers.get('cache-control'), 'no-cache', path);
    }
    // Icons change only when the generator is re-run, and the worker's cache
    // version changes with them, so they are worth keeping.
    const icon = await fetch(`${base}/icon-192.png`);
    assert.match(icon.headers.get('cache-control'), /max-age=\d+/);
  });
});

test('an idle relay retires itself, but never while a room is being kept', async () => {
  let exited = 0;
  await withRelay(async (h) => {
    const a = await h.client();
    const { room } = await a.join();

    // Someone is connected: not idle, whatever the clock says.
    await new Promise(r => setTimeout(r, 220));
    assert.equal(exited, 0, 'a connected client is activity');
    assert.equal(h.relay.isIdle(), false);

    a.close();
    await new Promise(r => setTimeout(r, 220));
    // The room is now empty but still held for whoever comes back — the whole
    // reason this decision cannot be left to the platform, which cannot see it.
    assert.equal(h.relay.rooms.size, 1);
    assert.equal(h.relay.isIdle(), false, 'a held room is not idleness');
    assert.equal(exited, 0, 'and the process must not leave under it');

    // Once the grace runs out and the room is forgotten, there is nothing left.
    await new Promise(r => setTimeout(r, 400));
    assert.equal(h.relay.rooms.size, 0);
    assert.equal(h.relay.isIdle(), true);
    assert.ok(exited > 0, 'now it retires');

    const back = await h.client();
    assert.equal((await back.join(room)).code, 'NO_ROOM', 'and that code is gone');
  }, { roomGraceMs: 250, sweepMs: 50, idleExitMs: 60, onIdleExit: () => { exited++; } });
});

test('idle exit is off unless asked for', async () => {
  let exited = 0;
  await withRelay(async (h) => {
    await new Promise(r => setTimeout(r, 250));
    assert.equal(exited, 0, 'nothing retires a relay that was not told to');
  }, { sweepMs: 50, onIdleExit: () => { exited++; } });
});
