// Efeitos sonoros e música, todos sintetizados com Web Audio (sem arquivos).
import { destravarAudio, estaMudo, saidaAudio } from './audio';

let bufferRuido: AudioBuffer | null = null;
function ruido(ctx: AudioContext): AudioBuffer {
  if (!bufferRuido) {
    bufferRuido = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = bufferRuido.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return bufferRuido;
}

function tom(
  freq: number, fim: number, dur: number, vol: number,
  onda: OscillatorType = 'sine', atraso = 0, destino?: AudioNode,
) {
  const a = saidaAudio();
  if (!a) return;
  const t = a.ctx.currentTime + atraso;
  const o = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  o.type = onda;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, fim), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(destino ?? a.saida);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function chiado(dur: number, vol: number, freqFiltro: number, tipo: BiquadFilterType = 'lowpass', atraso = 0, destino?: AudioNode) {
  const a = saidaAudio();
  if (!a) return;
  const t = a.ctx.currentTime + atraso;
  const s = a.ctx.createBufferSource();
  s.buffer = ruido(a.ctx);
  const f = a.ctx.createBiquadFilter();
  f.type = tipo;
  f.frequency.value = freqFiltro;
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(destino ?? a.saida);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export type Efeito = 'batida' | 'moeda' | 'pegar' | 'quebrou' | 'perdido' | 'pulo' | 'evento' | 'contagem' | 'vai';

/** @param forca 0..1 (intensidade, usada na batida) */
export function efeito(tipo: Efeito, forca = 1) {
  if (estaMudo()) return;
  destravarAudio();
  const f = Math.max(0.15, Math.min(1, forca));
  switch (tipo) {
    case 'batida':
      chiado(0.25, 0.35 * f, 900 + f * 1500);
      tom(130, 40, 0.22, 0.4 * f, 'sine');
      break;
    case 'moeda':
      tom(988, 988, 0.09, 0.14, 'square');
      tom(1319, 1319, 0.3, 0.14, 'square', 0.09);
      tom(1976, 1976, 0.25, 0.06, 'triangle', 0.09);
      break;
    case 'pegar':
      tom(380, 760, 0.12, 0.18, 'triangle');
      break;
    case 'quebrou':
      chiado(0.35, 0.3, 3500);
      tom(520, 90, 0.4, 0.15, 'sawtooth');
      break;
    case 'perdido':
      tom(300, 110, 0.5, 0.15, 'sawtooth');
      break;
    case 'pulo':
      tom(260, 620, 0.14, 0.12, 'triangle');
      break;
    case 'evento':
      tom(660, 660, 0.12, 0.12, 'square');
      tom(520, 520, 0.12, 0.12, 'square', 0.14);
      tom(660, 660, 0.2, 0.12, 'square', 0.28);
      break;
    case 'contagem':
      tom(440, 440, 0.18, 0.18, 'square');
      break;
    case 'vai':
      tom(880, 880, 0.5, 0.2, 'square');
      break;
  }
}

// -----------------------------------------------------------------------------
// Música alegre em loop (gerada): baixo, melodia pentatônica e bateria simples
// -----------------------------------------------------------------------------
const BPM = 118;
const PASSO = 60 / BPM / 2; // colcheia
const RAIZES = [130.81, 98.0, 110.0, 87.31]; // C - G - Am - F (graves)
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
let timer = 0;
let proxNota = 0;
let passoMusica = 0;
let ganhoMusica: GainNode | null = null;

function agendar() {
  const a = saidaAudio();
  if (!a || !ganhoMusica) return;
  while (proxNota < a.ctx.currentTime + 0.35) {
    const atraso = proxNota - a.ctx.currentTime;
    const compasso = Math.floor(passoMusica / 8) % 4;
    const p = passoMusica % 8;
    const baixo = RAIZES[compasso] * (p === 4 ? 1.5 : 1);
    if (p % 2 === 0) tom(baixo, baixo, PASSO * 1.7, 0.2, 'triangle', atraso, ganhoMusica);
    if (Math.random() < 0.65 && (p % 2 === 0 || Math.random() < 0.3)) {
      const n = PENTA[Math.floor(Math.random() * PENTA.length)];
      tom(n, n, PASSO * 0.9, 0.07, 'square', atraso, ganhoMusica);
    }
    if (p % 4 === 0) tom(150, 45, 0.16, 0.35, 'sine', atraso, ganhoMusica); // bumbo
    if (p % 4 === 2) chiado(0.06, 0.07, 6000, 'highpass', atraso, ganhoMusica); // chimbal
    proxNota += PASSO;
    passoMusica++;
  }
}

export function iniciarMusica() {
  destravarAudio();
  const a = saidaAudio();
  if (!a || timer) return;
  ganhoMusica = a.ctx.createGain();
  ganhoMusica.gain.value = 0.32;
  ganhoMusica.connect(a.saida);
  proxNota = a.ctx.currentTime + 0.1;
  passoMusica = 0;
  timer = window.setInterval(agendar, 100);
}

export function pararMusica() {
  clearInterval(timer);
  timer = 0;
  ganhoMusica?.disconnect();
  ganhoMusica = null;
}
