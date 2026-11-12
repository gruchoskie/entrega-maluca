// Áudio via Web Audio API (sem arquivos): buzinas, motores. Música e efeitos vêm na Fase 6.
import type { Buzina } from '../../../shared/protocolo';

let ctx: AudioContext | null = null;
let mestre: GainNode | null = null;
let mudo = false;
try {
  mudo = localStorage.getItem('em-mudo') === '1';
} catch {
  /* sem armazenamento: tudo bem */
}

/** Navegadores só liberam áudio após um gesto do usuário. */
export function destravarAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    mestre = ctx.createGain();
    mestre.gain.value = mudo ? 0 : 1;
    mestre.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function estaMudo() {
  return mudo;
}

export function definirMudo(v: boolean) {
  mudo = v;
  try {
    localStorage.setItem('em-mudo', v ? '1' : '0');
  } catch {
    /* ignora */
  }
  if (mestre && ctx) mestre.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, 0.02);
}

export function saidaAudio(): { ctx: AudioContext; saida: GainNode } | null {
  return ctx && mestre ? { ctx, saida: mestre } : null;
}

// Notas (Hz) de cada tipo de buzina: [freq, duração em s]
const BUZINAS: Record<Buzina, { notas: [number, number][]; onda: OscillatorType }> = {
  padrao: { notas: [[392, 0.3]], onda: 'square' },
  patinho: { notas: [[620, 0.08], [520, 0.1], [620, 0.08], [520, 0.1]], onda: 'sawtooth' },
  caminhao: { notas: [[110, 0.7]], onda: 'sawtooth' },
  melodia: { notas: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.25]], onda: 'triangle' },
};

/** Toca a buzina; `volume` (0..1) permite ouvir os amigos mais baixo de longe. */
export function buzinar(tipo: Buzina = 'padrao', volume = 1) {
  destravarAudio();
  if (!ctx || !mestre || volume < 0.02) return;
  const { notas, onda } = BUZINAS[tipo];
  let t = ctx.currentTime;
  for (const [freq, dur] of notas) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * volume, t + 0.015);
    g.gain.setValueAtTime(0.16 * volume, t + dur - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(mestre);
    // Dois osciladores levemente desafinados = timbre de buzina
    for (const f of tipo === 'padrao' ? [freq, freq * 1.26] : [freq, freq * 1.01]) {
      const o = ctx.createOscillator();
      o.type = onda;
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    t += dur;
  }
}

/** Motor sintetizado: o tom e o volume acompanham a velocidade. */
export class Motor {
  private osc: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private ganho: GainNode | null = null;
  private filtro: BiquadFilterNode | null = null;

  private iniciar() {
    if (this.osc || !ctx || !mestre) return;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.filtro = ctx.createBiquadFilter();
    this.filtro.type = 'lowpass';
    this.filtro.frequency.value = 500;
    this.ganho = ctx.createGain();
    this.ganho.gain.value = 0;
    this.osc.connect(this.filtro);
    this.osc2.connect(this.filtro);
    this.filtro.connect(this.ganho);
    this.ganho.connect(mestre);
    this.osc.start();
    this.osc2.start();
  }

  /** @param vel 0..1 (fração da velocidade máxima)  @param volume 0..1 (distância) */
  atualizar(vel: number, volume: number, grave = 1) {
    if (!ctx) return;
    this.iniciar();
    if (!this.osc || !this.osc2 || !this.ganho || !this.filtro) return;
    const t = ctx.currentTime;
    const f = (38 + vel * 70) * grave;
    this.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.filtro.frequency.setTargetAtTime(280 + vel * 700, t, 0.05);
    this.ganho.gain.setTargetAtTime(volume * (0.025 + vel * 0.045), t, 0.08);
  }

  parar() {
    this.ganho?.gain.setTargetAtTime(0, ctx?.currentTime ?? 0, 0.03);
    const o = [this.osc, this.osc2];
    setTimeout(() => o.forEach((x) => x?.stop()), 300);
    this.osc = this.osc2 = null;
  }
}
