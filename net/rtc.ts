/**
 * Polaczenie WebRTC z jednym peerem: RTCPeerConnection + DataChannel "game"
 * (niezawodny, uporzadkowany). Sygnaly (SDP, ICE) ida przez serwer sygnalizacyjny.
 */
import type { NetMsg } from './protocol.ts';

/** Diagnostyka polaczen: localStorage.debugNet = '1'. */
function debugOn(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('debugNet') === '1';
  } catch {
    return false;
  }
}
const DEBUG = debugOn();
function dbg(...a: unknown[]): void {
  if (DEBUG) console.log('[rtc]', ...a);
}

export class PeerLink {
  readonly peerId: string;
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private sendSignal: (data: unknown) => void;
  private pendingIce: RTCIceCandidateInit[] = [];
  onOpen: (() => void) | null = null;
  onMessage: ((m: NetMsg) => void) | null = null;
  onClose: (() => void) | null = null;
  private closed = false;

  constructor(peerId: string, iceServers: RTCIceServer[], sendSignal: (data: unknown) => void, initiator: boolean) {
    this.peerId = peerId;
    this.sendSignal = sendSignal;
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = (e) => {
      dbg(peerId, 'local cand', e.candidate ? e.candidate.candidate : '(koniec)');
      if (e.candidate) this.sendSignal({ ice: e.candidate.toJSON() });
    };
    this.pc.onicegatheringstatechange = () => dbg(peerId, 'gathering', this.pc.iceGatheringState);
    this.pc.oniceconnectionstatechange = () => dbg(peerId, 'ice', this.pc.iceConnectionState);
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      dbg(peerId, 'conn', st);
      if (st === 'failed' || st === 'closed') this.handleClose();
    };
    if (initiator) {
      this.setupChannel(this.pc.createDataChannel('game', { ordered: true }));
      void this.makeOffer();
    } else {
      this.pc.ondatachannel = (e) => this.setupChannel(e.channel);
    }
  }

  private setupChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => {
      dbg(this.peerId, 'channel open');
      this.onOpen?.();
    };
    dc.onclose = () => this.handleClose();
    dc.onmessage = (e) => {
      try {
        this.onMessage?.(JSON.parse(String(e.data)) as NetMsg);
      } catch {
        // uszkodzona wiadomosc - ignorujemy
      }
    };
  }

  private async makeOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ sdp: this.pc.localDescription });
  }

  /** Obsluga sygnalu od drugiej strony. */
  async signal(data: unknown): Promise<void> {
    const d = data as { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
    dbg(this.peerId, 'signal', d.sdp ? d.sdp.type : 'ice', d.ice?.candidate ?? '');
    try {
      await this.applySignal(d);
    } catch (e) {
      dbg(this.peerId, 'signal error', e);
    }
  }

  private async applySignal(d: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }): Promise<void> {
    if (d.sdp) {
      await this.pc.setRemoteDescription(d.sdp);
      for (const c of this.pendingIce) await this.pc.addIceCandidate(c);
      this.pendingIce = [];
      if (d.sdp.type === 'offer') {
        const ans = await this.pc.createAnswer();
        await this.pc.setLocalDescription(ans);
        this.sendSignal({ sdp: this.pc.localDescription });
      }
    } else if (d.ice) {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(d.ice);
      else this.pendingIce.push(d.ice);
    }
  }

  send(m: NetMsg): void {
    if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(m));
  }

  get open(): boolean {
    return !!this.dc && this.dc.readyState === 'open';
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }

  close(): void {
    this.handleClose();
    this.dc?.close();
    this.pc.close();
  }
}
