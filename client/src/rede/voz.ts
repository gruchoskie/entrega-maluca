// Chat de voz por proximidade: áudio direto entre os jogadores (WebRTC), com o servidor só repassando a sinalização.
// Cada jogador abre uma conexão com cada outro. O volume de cada voz cai com a distância entre os personagens.
import type * as THREE from 'three';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const PERTO = 8; // até esta distância (m) a voz vem com volume total
const LONGE = 42; // a partir daqui não se ouve mais

interface Par {
  pc: RTCPeerConnection;
  el: HTMLAudioElement;
  sender: RTCRtpSender | null;
  filaIce: RTCIceCandidateInit[];
  remotaPronta: boolean;
  analisador: AnalyserNode | null;
  nivel: number;
}

export class Voz {
  micLigado = false;
  /** Ids de quem está falando agora (inclui o meu). */
  falando = new Set<string>();
  private pares = new Map<string, Par>();
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private ctx: AudioContext | null = null;
  private analisadorLocal: AnalyserNode | null = null;
  private meuId = '';
  private ultimaMedida = 0;

  constructor(
    private enviar: (para: string, dados: unknown) => void,
    /** Posição de cada jogador no mundo (null = desconhecida). */
    private posDe: (id: string) => THREE.Vector3 | null,
    /** Posição de quem escuta (a câmera/personagem). */
    private posOuvinte: () => THREE.Vector3 | null,
  ) {}

  get suportado() {
    return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** Mantém uma conexão com cada jogador da sala (chamar quando a lista de jogadores mudar). */
  definirPares(meuId: string, ids: string[]) {
    this.meuId = meuId;
    if (!this.suportado) return;
    const vivos = new Set(ids.filter((i) => i !== meuId));
    for (const [id, p] of this.pares) {
      if (!vivos.has(id)) {
        p.pc.close();
        p.el.remove();
        this.pares.delete(id);
        this.falando.delete(id);
      }
    }
    for (const id of vivos) {
      if (!this.pares.has(id)) {
        const p = this.criarPar(id);
        // Quem tem o id "menor" começa a conversa (evita os dois criarem oferta ao mesmo tempo)
        if (meuId < id) void this.oferecer(id, p);
      }
    }
  }

  private criarPar(id: string): Par {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const el = document.createElement('audio');
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    const par: Par = { pc, el, sender: null, filaIce: [], remotaPronta: false, analisador: null, nivel: 0 };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.enviar(id, { ice: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      el.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void el.play().catch(() => {});
      this.medirNivel(par, e.streams[0] ?? new MediaStream([e.track]));
    };
    this.pares.set(id, par);
    return par;
  }

  private async oferecer(id: string, p: Par) {
    try {
      const t = p.pc.addTransceiver('audio', { direction: 'sendrecv' });
      p.sender = t.sender;
      if (this.track) await t.sender.replaceTrack(this.track);
      const o = await p.pc.createOffer();
      await p.pc.setLocalDescription(o);
      this.enviar(id, { sdp: p.pc.localDescription });
    } catch {
      /* conexão não deu certo: segue sem voz com esse jogador */
    }
  }

  /** Sinalização recebida de outro jogador. */
  async receber(de: string, dados: unknown) {
    if (!this.suportado) return;
    const d = dados as { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
    const p = this.pares.get(de) ?? this.criarPar(de);
    try {
      if (d.sdp) {
        await p.pc.setRemoteDescription(d.sdp);
        p.remotaPronta = true;
        if (d.sdp.type === 'offer') {
          const t = p.pc.getTransceivers()[0];
          if (t) {
            t.direction = 'sendrecv';
            p.sender = t.sender;
            if (this.track) await t.sender.replaceTrack(this.track);
          }
          const r = await p.pc.createAnswer();
          await p.pc.setLocalDescription(r);
          this.enviar(de, { sdp: p.pc.localDescription });
        }
        for (const c of p.filaIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      } else if (d.ice) {
        if (p.remotaPronta) await p.pc.addIceCandidate(d.ice).catch(() => {});
        else p.filaIce.push(d.ice);
      }
    } catch {
      /* ignora erros de negociação */
    }
  }

  /** Liga o microfone (pede permissão). @returns true se deu certo. */
  async ligarMic(): Promise<boolean> {
    if (!this.suportado) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.track = this.stream.getAudioTracks()[0];
      this.micLigado = true;
      for (const p of this.pares.values()) await p.sender?.replaceTrack(this.track);
      // Indicador "estou falando" (meu microfone)
      this.ctx ??= new AudioContext();
      this.analisadorLocal = this.ctx.createAnalyser();
      this.analisadorLocal.fftSize = 256;
      this.ctx.createMediaStreamSource(this.stream).connect(this.analisadorLocal);
      return true;
    } catch {
      this.micLigado = false;
      return false;
    }
  }

  desligarMic() {
    this.micLigado = false;
    for (const p of this.pares.values()) void p.sender?.replaceTrack(null);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.analisadorLocal = null;
    this.falando.delete(this.meuId);
  }

  private medirNivel(p: Par, s: MediaStream) {
    try {
      this.ctx ??= new AudioContext();
      p.analisador = this.ctx.createAnalyser();
      p.analisador.fftSize = 256;
      this.ctx.createMediaStreamSource(s).connect(p.analisador);
    } catch {
      /* sem indicador de fala */
    }
  }

  private rms(a: AnalyserNode) {
    const buf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(buf);
    let soma = 0;
    for (const v of buf) soma += ((v - 128) / 128) ** 2;
    return Math.sqrt(soma / buf.length);
  }

  /** A cada quadro: ajusta o volume de cada voz pela distância e atualiza quem está falando. */
  atualizar(agora: number) {
    const ouvinte = this.posOuvinte();
    for (const [id, p] of this.pares) {
      const pos = this.posDe(id);
      let v = 1;
      if (ouvinte && pos) {
        const d = ouvinte.distanceTo(pos);
        v = d <= PERTO ? 1 : Math.max(0, 1 - (d - PERTO) / (LONGE - PERTO));
        v *= v; // cai mais natural
      }
      p.el.volume = Math.min(1, v);
    }
    if (agora - this.ultimaMedida > 160) {
      this.ultimaMedida = agora;
      for (const [id, p] of this.pares) {
        if (p.analisador && this.rms(p.analisador) > 0.03 && p.el.volume > 0.05) this.falando.add(id);
        else this.falando.delete(id);
      }
      if (this.analisadorLocal && this.micLigado && this.rms(this.analisadorLocal) > 0.03) this.falando.add(this.meuId);
      else this.falando.delete(this.meuId);
    }
  }
}
