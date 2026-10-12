import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { listName, startServer, turnCredentials, type RoomInfo, type RunningServer } from '../../server/signal.ts';

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

  it('lista pokoi publicznych: na zywo, bez prywatnych i rozpoczetych, limit na adres', async () => {
    const [w, a, b, c, d, e] = Array.from({ length: 6 }, () => new Client());
    await Promise.all([w, a, b, c, d, e].map((x) => x.wait('hello')));
    const rooms = async (ok: (r: RoomInfo[]) => boolean): Promise<RoomInfo[]> => {
      for (;;) {
        const r = (await w.wait('rooms')).rooms as RoomInfo[];
        if (ok(r)) return r;
      }
    };
    w.send({ t: 'watch' });
    expect(await rooms(() => true)).toEqual([]);
    a.send({ t: 'create', name: 'Ala‮', public: true });
    const created = await a.wait('created');
    expect(created.public).toBe(true);
    a.send({ t: 'meta', map: 'dolina!', size: 96, players: 3 });
    b.send({ t: 'create', name: 'Prywatny' });
    expect((await b.wait('created')).public).toBe(false);
    expect(await rooms((r) => r[0]?.players === 3)).toEqual([{ room: created.room, name: 'Ala', map: 'DOLINA', size: 96, players: 3 }]);
    // Dolaczajacy do pokoju publicznego wie, ze laczy sie przez przekaznik.
    c.send({ t: 'join', room: created.room, name: 'Cyryl' });
    expect((await c.wait('joined')).public).toBe(true);
    // Drugi pokoj publiczny z tego samego adresu jest dozwolony, trzeci nie.
    d.send({ t: 'create', name: 'Kurwa', public: true });
    await d.wait('created');
    e.send({ t: 'create', name: 'E', public: true });
    expect((await e.wait('error')).code).toBe('publimit');
    expect((await rooms((r) => r.length === 2)).map((r) => r.name)).toEqual(['Gracz', 'Ala']);
    // Rozpoczeta gra znika z listy.
    a.send({ t: 'lock' });
    d.send({ t: 'lock' });
    expect(await rooms((r) => r.length === 0)).toEqual([]);
    for (const x of [w, a, b, c, d, e]) x.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('imie na liscie pokoi: wulgaryzmy i znaki sterujace', () => {
    expect(listName('Ala')).toBe('Ala');
    expect(listName('Łucja Żak')).toBe('Łucja Żak');
    expect(listName('  K.u.r.w.a ')).toBe('Gracz');
    expect(listName('PIERD0L')).toBe('Gracz');
    expect(listName('chuj')).toBe('Gracz');
    expect(listName('‮Ala\u0007')).toBe('Ala');
    expect(listName('')).toBe('Gracz');
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

  it('limit polaczen na adres: X-Real-IP tylko za zaufanym proxy', async () => {
    const opened = async (port: number, ip: string): Promise<boolean> => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { 'x-real-ip': ip } });
      const ok = await new Promise<boolean>((res) => {
        ws.on('message', () => res(true));
        ws.on('close', () => res(false));
      });
      if (ok) ws.close();
      return ok;
    };
    const proxied = await startServer({ port: 0, host: '127.0.0.1', log: () => {}, maxConnPerIp: 1, trustProxy: true });
    const direct = await startServer({ port: 0, host: '127.0.0.1', log: () => {}, maxConnPerIp: 1 });
    try {
      // Za proxy dwaj klienci z roznych adresow mieszcza sie w limicie 1 na adres.
      const keep = new WebSocket(`ws://127.0.0.1:${proxied.port}`, { headers: { 'x-real-ip': '1.1.1.1' } });
      await new Promise((res) => keep.on('message', res));
      expect(await opened(proxied.port, '2.2.2.2')).toBe(true);
      expect(await opened(proxied.port, '1.1.1.1')).toBe(false);
      keep.close();
      // Bez proxy naglowek nie omija limitu - liczy sie adres gniazda.
      const keep2 = new WebSocket(`ws://127.0.0.1:${direct.port}`, { headers: { 'x-real-ip': '1.1.1.1' } });
      await new Promise((res) => keep2.on('message', res));
      expect(await opened(direct.port, '2.2.2.2')).toBe(false);
      keep2.close();
    } finally {
      await proxied.close();
      await direct.close();
    }
  });
});
