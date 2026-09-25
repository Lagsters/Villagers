/** Klient serwera sygnalizacyjnego (WebSocket) po stronie przegladarki. */

export interface SignalEvents {
  onPeer?(peer: string, name: string): void;
  onSignal?(from: string, data: unknown): void;
  onLeft?(peer: string): void;
  onHostLeft?(): void;
  onError?(code: string): void;
  onClose?(): void;
}

type Msg = Record<string, unknown> & { t: string };

export class SignalClient {
  private ws: WebSocket | null = null;
  peerId = '';
  iceServers: RTCIceServer[] = [];
  events: SignalEvents = {};
  private waiters: { t: string; res: (m: Msg) => void; rej: (e: Error) => void }[] = [];

  /** Laczy sie z serwerem i czeka na powitanie (id peera, serwery ICE). */
  connect(url: string, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e as Error);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error('Serwer sygnalizacyjny nie odpowiada'));
        ws.close();
      }, timeoutMs);
      ws.onmessage = (ev) => {
        let m: Msg;
        try {
          m = JSON.parse(String(ev.data)) as Msg;
        } catch {
          return;
        }
        if (m.t === 'hello') {
          clearTimeout(timer);
          this.peerId = String(m.peer);
          this.iceServers = (m.iceServers as RTCIceServer[]) ?? [];
          resolve();
          return;
        }
        this.dispatch(m);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Nie można połączyć się z serwerem sygnalizacyjnym'));
      };
      ws.onclose = () => {
        this.events.onClose?.();
        for (const w of this.waiters) w.rej(new Error('Połączenie z serwerem zamknięte'));
        this.waiters = [];
      };
    });
  }

  private dispatch(m: Msg): void {
    const i = this.waiters.findIndex((w) => w.t === m.t || (m.t === 'error' && (w.t === 'created' || w.t === 'joined')));
    if (i >= 0) {
      const w = this.waiters.splice(i, 1)[0];
      if (m.t === 'error') w.rej(new Error(String(m.code)));
      else w.res(m);
      return;
    }
    switch (m.t) {
      case 'peer': this.events.onPeer?.(String(m.peer), String(m.name ?? '')); break;
      case 'signal': this.events.onSignal?.(String(m.from), m.data); break;
      case 'left': this.events.onLeft?.(String(m.peer)); break;
      case 'host-left': this.events.onHostLeft?.(); break;
      case 'error': this.events.onError?.(String(m.code)); break;
    }
  }

  private request(msg: Msg, reply: string): Promise<Msg> {
    return new Promise((res, rej) => {
      this.waiters.push({ t: reply, res, rej });
      this.send(msg);
    });
  }

  send(m: Msg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  async create(name: string): Promise<string> {
    const m = await this.request({ t: 'create', name }, 'created');
    return String(m.room);
  }

  async join(room: string, name: string): Promise<string> {
    const m = await this.request({ t: 'join', room, name }, 'joined');
    return String(m.host);
  }

  signal(to: string, data: unknown): void {
    this.send({ t: 'signal', to, data });
  }

  lock(): void {
    this.send({ t: 'lock' });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

/** Czytelny opis kodu bledu serwera. */
export function signalErrorText(code: string): string {
  switch (code) {
    case 'noroom': return 'Nie ma pokoju o takim kodzie.';
    case 'started': return 'Gra w tym pokoju już się rozpoczęła.';
    case 'roomfull': return 'Pokój jest pełny (8 graczy).';
    case 'full': return 'Serwer jest przeciążony, spróbuj później.';
    case 'rate': return 'Za dużo wiadomości.';
    default: return code;
  }
}
