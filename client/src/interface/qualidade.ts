// Níveis de qualidade gráfica. No celular começa em "baixa"; se o FPS cair, o jogo desce sozinho.

export type Qualidade = 'alta' | 'media' | 'baixa';

export interface ConfigQualidade {
  nome: string;
  pixelRatio: number; // teto do devicePixelRatio
  sombras: boolean;
  tamanhoSombra: number;
  particulas: number; // 0..1 (densidade)
}

export const QUALIDADES: Record<Qualidade, ConfigQualidade> = {
  alta: { nome: 'Alta', pixelRatio: 2, sombras: true, tamanhoSombra: 2048, particulas: 1 },
  media: { nome: 'Média', pixelRatio: 1.5, sombras: true, tamanhoSombra: 1024, particulas: 0.6 },
  baixa: { nome: 'Baixa', pixelRatio: 1, sombras: false, tamanhoSombra: 1024, particulas: 0.3 },
};

const ORDEM: Qualidade[] = ['alta', 'media', 'baixa'];
const CHAVE = 'em-qualidade';

export function qualidadeInicial(celular: boolean): Qualidade {
  try {
    const salva = localStorage.getItem(CHAVE) as Qualidade | null;
    if (salva && salva in QUALIDADES) return salva;
  } catch {
    /* sem armazenamento */
  }
  return celular ? 'baixa' : 'alta';
}

export function salvarQualidade(q: Qualidade) {
  try {
    localStorage.setItem(CHAVE, q);
  } catch {
    /* ignora */
  }
}

export const proximaQualidade = (q: Qualidade) => ORDEM[(ORDEM.indexOf(q) + 1) % ORDEM.length];
/** Nível abaixo (para o ajuste automático); `null` se já está no mínimo. */
export const piorQualidade = (q: Qualidade): Qualidade | null => ORDEM[ORDEM.indexOf(q) + 1] ?? null;

/** Mede o FPS médio e avisa quando está baixo por tempo suficiente. */
export class MonitorFps {
  private frames = 0;
  private desde = performance.now();
  private ultimaTroca = performance.now();
  fps = 60;

  /** @returns true se é hora de reduzir a qualidade. */
  quadro(agora: number): boolean {
    this.frames++;
    if (agora - this.desde < 2000) return false;
    this.fps = (this.frames * 1000) / (agora - this.desde);
    this.frames = 0;
    this.desde = agora;
    if (this.fps < 38 && agora - this.ultimaTroca > 6000 && document.visibilityState === 'visible') {
      this.ultimaTroca = agora;
      return true;
    }
    return false;
  }

  reiniciar() {
    this.ultimaTroca = performance.now();
    this.frames = 0;
    this.desde = performance.now();
  }
}
