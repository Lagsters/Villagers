/**
 * Serwer sygnalizacyjny WebRTC: pokoje (kody 6 znakow), wymiana SDP/ICE, krotkotrwale dane logowania
 * TURN (coturn: use-auth-secret), limity polaczen, sprzatanie pokoi, healthcheck /health.
 * Serwer NIE liczy symulacji gry - po zestawieniu polaczen peery rozmawiaja bezposrednio.
 *
 * Uruchomienie: node server/signal.ts   (zmienne srodowiskowe opisane w docs/DEPLOY.md)
 */
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export interface ServerOptions {
  port: number;
  host?: string;
  /** sekret wspoldzielony z coturn (static-auth-secret); pusty = bez TURN */
  turnSecret?: string;
  /** adresy TURN, np. turn:przyklad.duckdns.org:3478?transport=udp */
  turnUrls?: string[];
  turnTtlSec?: number;
  maxRooms?: number;
  maxPeersPerRoom?: number;
  maxConnPerIp?: number;
  /** pokoj bez aktywnosci dluzej niz tyle ms jest usuwany */
  roomIdleMs?: number;
  /** dozwolone Origin (puste = wszystkie) */
  allowedOrigins?: string[];
  log?: (msg: string) => void;
}

interface Peer {
  id: string;
  ws: WebSocket;
  ip: string;
  room: Room | null;
  name: string;
  msgCount: number;
  msgWindow: number;
}

interface Room {
  code: string;
  host: Peer;
  peers: Map<string, Peer>;
  locked: boolean;
  lastActive: number;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MSG_BYTES = 64 * 1024;
const MAX_MSG_PER_SEC = 60;

export function turnCredentials(secret: string, peerId: string, ttlSec: number, nowSec = Math.floor(Date.now() / 1000)): { username: string; credential: string } {
  const username = `${nowSec + ttlSec}:${peerId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

export interface RunningServer {
  server: Server;
  port: number;
  close(): Promise<void>;
  stats(): { rooms: number; peers: number };
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const o = {
    turnTtlSec: 6 * 3600,
    maxRooms: 500,
    maxPeersPerRoom: 8,
    maxConnPerIp: 16,
    roomIdleMs: 3 * 3600 * 1000,
    turnUrls: [] as string[],
    allowedOrigins: [] as string[],
    log: (m: string) => console.log(`[signal] ${m}`),
    ...opts,
  };
  const rooms = new Map<string, Room>();
  const peers = new Map<string, Peer>();
  const perIp = new Map<string, number>();

  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url?.startsWith('/health?')) {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, peers: peers.size }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Osadnicy Doliny - serwer sygnalizacyjny');
  });
  const wss = new WebSocketServer({ server, maxPayload: MAX_MSG_BYTES });

  function send(p: Peer, msg: unknown): void {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(JSON.stringify(msg));
  }

  function iceServers(peerId: string): unknown[] {
    const list: unknown[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (o.turnSecret && o.turnUrls.length) {
      const c = turnCredentials(o.turnSecret, peerId, o.turnTtlSec);
      list.push({ urls: o.turnUrls, username: c.username, credential: c.credential });
    }
    return list;
  }

  function newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
    throw new Error('Brak wolnych kodow');
  }

  function leaveRoom(p: Peer): void {
    const r = p.room;
    if (!r) return;
    p.room = null;
    r.peers.delete(p.id);
    if (r.host === p) {
      for (const other of r.peers.values()) {
        send(other, { t: 'host-left' });
        other.room = null;
      }
      rooms.delete(r.code);
      o.log(`pokoj ${r.code} zamkniety (host wyszedl)`);
      return;
    }
    for (const other of r.peers.values()) send(other, { t: 'left', peer: p.id });
    if (r.peers.size === 0) rooms.delete(r.code);
  }

  function onMessage(p: Peer, raw: string): void {
    const now = Date.now();
    if (now - p.msgWindow > 1000) {
      p.msgWindow = now;
      p.msgCount = 0;
    }
    if (++p.msgCount > MAX_MSG_PER_SEC) {
      send(p, { t: 'error', code: 'rate' });
      return;
    }
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    if (p.room) p.room.lastActive = now;
    switch (m.t) {
      case 'create': {
        if (p.room) leaveRoom(p);
        if (rooms.size >= o.maxRooms) {
          send(p, { t: 'error', code: 'full' });
          return;
        }
        p.name = String(m.name ?? '').slice(0, 20);
        const code = newCode();
        const r: Room = { code, host: p, peers: new Map([[p.id, p]]), locked: false, lastActive: now };
        rooms.set(code, r);
        p.room = r;
        send(p, { t: 'created', room: code });
        o.log(`pokoj ${code} utworzony`);
        return;
      }
      case 'join': {
        const code = String(m.room ?? '').toUpperCase();
        const r = rooms.get(code);
        if (!r) {
          send(p, { t: 'error', code: 'noroom' });
          return;
        }
        if (r.locked) {
          send(p, { t: 'error', code: 'started' });
          return;
        }
        if (r.peers.size >= o.maxPeersPerRoom) {
          send(p, { t: 'error', code: 'roomfull' });
          return;
        }
        if (p.room) leaveRoom(p);
        p.name = String(m.name ?? '').slice(0, 20);
        r.peers.set(p.id, p);
        p.room = r;
        send(p, { t: 'joined', room: code, host: r.host.id });
        send(r.host, { t: 'peer', peer: p.id, name: p.name });
        return;
      }
      case 'signal': {
        const r = p.room;
        const to = r?.peers.get(String(m.to ?? ''));
        if (!r || !to) return;
        send(to, { t: 'signal', from: p.id, data: m.data });
        return;
      }
      case 'lock': {
        if (p.room && p.room.host === p) p.room.locked = true;
        return;
      }
      case 'leave':
        leaveRoom(p);
        return;
      case 'ping':
        send(p, { t: 'pong' });
        return;
    }
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const origin = req.headers.origin ?? '';
    if (o.allowedOrigins.length && !o.allowedOrigins.includes(origin)) {
      ws.close(1008, 'origin');
      return;
    }
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || req.socket.remoteAddress || '?';
    const n = (perIp.get(ip) ?? 0) + 1;
    if (n > o.maxConnPerIp) {
      ws.close(1008, 'too many');
      return;
    }
    perIp.set(ip, n);
    const p: Peer = { id: randomUUID().slice(0, 8), ws, ip, room: null, name: '', msgCount: 0, msgWindow: Date.now() };
    peers.set(p.id, p);
    send(p, { t: 'hello', peer: p.id, iceServers: iceServers(p.id) });
    ws.on('message', (data) => onMessage(p, data.toString()));
    ws.on('close', () => {
      leaveRoom(p);
      peers.delete(p.id);
      const c = (perIp.get(ip) ?? 1) - 1;
      if (c <= 0) perIp.delete(ip);
      else perIp.set(ip, c);
    });
    ws.on('error', () => ws.close());
  });

  // Sprzatanie nieaktywnych pokoi.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) {
      if (now - r.lastActive > o.roomIdleMs) {
        for (const p of r.peers.values()) {
          p.room = null;
          send(p, { t: 'host-left' });
        }
        rooms.delete(r.code);
      }
    }
  }, 60_000);
  sweep.unref();

  return new Promise((resolve) => {
    server.listen(o.port, o.host ?? '0.0.0.0', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : o.port;
      o.log(`nasluchuje na porcie ${port}`);
      resolve({
        server,
        port,
        stats: () => ({ rooms: rooms.size, peers: peers.size }),
        close: () => new Promise<void>((res) => {
          clearInterval(sweep);
          for (const p of peers.values()) p.ws.terminate();
          wss.close();
          server.close(() => res());
        }),
      });
    });
  });
}

// Uruchomienie z linii polecen.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('server/signal.ts')) {
  const env = process.env;
  startServer({
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    turnSecret: env.TURN_SECRET ?? '',
    turnUrls: (env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
