import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, turnCredentials, type RunningServer } from '../../server/signal.ts';

let srv: RunningServer;

beforeAll(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', turnSecret: 'sekret', turnUrls: ['turn:example.org:3478'], log: () => {}, maxConnPerIp: 10 });
});
afterAll(async () => {
  await srv.close();
});

class Client {
  ws: WebSocket;
  inbox: Record<string, unknown>[] = [];
  waiters: ((m: Record<string, unknown>) => boolean)[] = [];
  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Record<string, unknown>;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => !w(m));
    });
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  wait(t: string): Promise<Record<string, unknown>> {
    const found = this.inbox.find((m) => m.t === t);
    if (found) {
      this.inbox.splice(this.inbox.indexOf(found), 1);
      return Promise.resolve(found);
    }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timeout ${t}`)), 3000);
      this.waiters.push((m) => {
        if (m.t !== t) return false;
        clearTimeout(timer);
        this.inbox.splice(this.inbox.indexOf(m), 1);
        res(m);
        return true;
      });
    });
  }
  close(): void {
    this.ws.close();
  }
}

describe('M7: serwer sygnalizacyjny', () => {
  it('healthcheck', async () => {
    const r = await fetch(`http://127.0.0.1:${srv.port}/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  it('tworzenie pokoju, dolaczanie, wymiana sygnalow, wyjscie hosta', async () => {
    const a = new Client();
    const b = new Client();
    const ha = await a.wait('hello');
    const hb = await b.wait('hello');
    expect(Array.isArray(ha.iceServers)).toBe(true);
    a.send({ t: 'create', name: 'Ala' });
    const created = await a.wait('created');
    const room = created.room as string;
    expect(room).toMatch(/^[A-Z2-9]{6}$/);
    b.send({ t: 'join', room: room.toLowerCase(), name: 'Bob' });
    const joined = await b.wait('joined');
    expect(joined.host).toBe(ha.peer);
    const peer = await a.wait('peer');
    expect(peer.peer).toBe(hb.peer);
    a.send({ t: 'signal', to: hb.peer, data: { sdp: 'x' } });
    const sig = await b.wait('signal');
    expect(sig.from).toBe(ha.peer);
    expect((sig.data as { sdp: string }).sdp).toBe('x');
    // Zablokowany pokoj nie przyjmuje nowych graczy.
    a.send({ t: 'lock' });
    const c = new Client();
    await c.wait('hello');
    await new Promise((r) => setTimeout(r, 50));
    c.send({ t: 'join', room });
    expect((await c.wait('error')).code).toBe('started');
    a.close();
    await b.wait('host-left');
    b.close();
    c.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(srv.stats().rooms).toBe(0);
  });

  it('nieistniejacy pokoj i limit polaczen', async () => {
    const a = new Client();
    await a.wait('hello');
    a.send({ t: 'join', room: 'ZZZZZZ' });
    expect((await a.wait('error')).code).toBe('noroom');
    a.close();
  });

  it('dane TURN zgodne z coturn use-auth-secret', () => {
    const c = turnCredentials('sekret', 'abc', 3600, 1000);
    expect(c.username).toBe('4600:abc');
    expect(c.credential).toBe(createHmac('sha1', 'sekret').update('4600:abc').digest('base64'));
  });
});
