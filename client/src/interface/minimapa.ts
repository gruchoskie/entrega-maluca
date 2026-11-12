// Minimapa (norte para cima): ruas com letras/números (para o navegador "cantar" coordenadas),
// pontos de coleta/entrega, amigos, trânsito e eventos.
import {
  CENTROS, ESTRADAS, LARG_RUA, LIMITE, PONTOS_COLETA, PONTOS_ENTREGA, TAM_BLOCO, nomeRuaX, nomeRuaZ,
} from '../../../shared/cidade';
import type { JogoTick } from '../../../shared/protocolo';

export interface DadosMinimapa {
  eu: { x: number; z: number; rumo: number } | null;
  amigos: { x: number; z: number; cor: string }[];
  carros: { x: number; z: number }[];
  jogo: JogoTick | null; // já filtrado para o que este jogador pode ver
  meuId: string;
  rota?: { x: number; z: number }[] | null; // rota sugerida pelas ruas
}

export class Minimapa {
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private fundo = document.createElement('canvas');
  private tam = 140;

  /** Clique/toque no mapa (liga/desliga a rota sugerida). */
  aoClicar: () => void = () => {};

  constructor() {
    this.canvas.id = 'minimapa';
    this.canvas.style.pointerEvents = 'auto';
    this.canvas.title = 'Toque para ligar/desligar a rota sugerida';
    this.canvas.onclick = () => this.aoClicar();
    this.g = this.canvas.getContext('2d')!;
    document.getElementById('hud')!.appendChild(this.canvas);
    this.definirTamanho(140);
  }

  private get esc() {
    return this.tam / (LIMITE * 2 + LARG_RUA);
  }
  private px = (v: number) => (v + LIMITE + LARG_RUA / 2) * this.esc;

  /** Navegador usa um mapa bem maior (e com letras/números nas ruas). */
  definirTamanho(n: number) {
    this.tam = n;
    this.canvas.width = this.canvas.height = n;
    this.canvas.style.width = this.canvas.style.height = n + 'px';
    this.fundo.width = this.fundo.height = n;
    const f = this.fundo.getContext('2d')!;
    const px = this.px;
    const esc = this.esc;
    f.fillStyle = '#7ecb62';
    f.fillRect(0, 0, n, n);
    f.fillStyle = '#d9dce6';
    for (const bx of CENTROS) for (const bz of CENTROS) f.fillRect(px(bx - TAM_BLOCO / 2), px(bz - TAM_BLOCO / 2), TAM_BLOCO * esc, TAM_BLOCO * esc);
    f.fillStyle = '#585d6c';
    for (const r of ESTRADAS) {
      f.fillRect(px(r - LARG_RUA / 2), 0, LARG_RUA * esc, n);
      f.fillRect(0, px(r - LARG_RUA / 2), n, LARG_RUA * esc);
    }
    // Nomes das ruas: letras (ruas verticais) em cima, números (horizontais) à esquerda
    if (n >= 200) {
      f.font = `bold ${Math.round(n / 17)}px "Trebuchet MS", sans-serif`;
      f.textAlign = 'center';
      f.textBaseline = 'middle';
      f.lineWidth = 3;
      f.strokeStyle = 'rgba(20,20,50,.85)';
      f.fillStyle = '#fff';
      ESTRADAS.forEach((r, i) => {
        const a = nomeRuaX(i);
        const b = nomeRuaZ(i);
        f.strokeText(a, px(r), n * 0.035);
        f.fillText(a, px(r), n * 0.035);
        f.strokeText(b, n * 0.035, px(r));
        f.fillText(b, n * 0.035, px(r));
      });
    }
  }

  visivel(v: boolean) {
    this.canvas.style.display = v ? '' : 'none';
  }

  desenhar(d: DadosMinimapa) {
    const g = this.g;
    const px = this.px;
    const k = this.tam / 140; // fator de escala dos ícones
    g.drawImage(this.fundo, 0, 0);

    // Rota sugerida: linha tracejada amarela pelas ruas
    if (d.rota && d.rota.length > 1) {
      g.save();
      g.setLineDash([6 * k, 4 * k]);
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 3 * k;
      g.lineJoin = 'round';
      g.beginPath();
      d.rota.forEach((p, i) => (i === 0 ? g.moveTo(px(p.x), px(p.z)) : g.lineTo(px(p.x), px(p.z))));
      g.stroke();
      g.restore();
    }

    for (const c of d.carros) {
      g.fillStyle = 'rgba(30,30,40,.7)';
      g.fillRect(px(c.x) - 1.5 * k, px(c.z) - 1.5 * k, 3 * k, 3 * k);
    }

    if (d.jogo) {
      const { pedidos, pacotes, evento } = d.jogo;
      if (evento && (evento.tipo === 'obras' || evento.tipo === 'buraco')) {
        g.fillStyle = evento.tipo === 'obras' ? '#ff7a2b' : '#15151c';
        g.beginPath();
        g.arc(px(evento.x), px(evento.z), (evento.tipo === 'buraco' ? 5 : 4) * k, 0, Math.PI * 2);
        g.fill();
      }
      g.font = `bold ${Math.round(9 * k)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const p of pedidos) {
        if (p.estado === 'oferta') continue;
        const pk = pacotes.find((x) => x.id === p.id);
        // Entrega: círculo
        const e = PONTOS_ENTREGA[p.entrega];
        g.fillStyle = p.cor;
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(px(e.x), px(e.z), 6 * k, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#fff';
        g.fillText(p.letra, px(e.x), px(e.z) + 0.5);
        // Coleta (ainda não pega): quadrado
        if (pk?.estado === 'coleta') {
          const c = PONTOS_COLETA[p.coleta];
          g.fillStyle = p.cor;
          g.fillRect(px(c.x) - 6 * k, px(c.z) - 6 * k, 12 * k, 12 * k);
          g.strokeRect(px(c.x) - 6 * k, px(c.z) - 6 * k, 12 * k, 12 * k);
          g.fillStyle = '#fff';
          g.fillText(p.letra, px(c.x), px(c.z) + 0.5);
        } else if (pk?.estado === 'livre') {
          g.fillStyle = '#ff3b3b';
          g.fillText('!', px(pk.pos[0]), px(pk.pos[2]));
        }
      }
    }

    for (const a of d.amigos) {
      g.fillStyle = a.cor;
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px(a.x), px(a.z), 3.5 * k, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    if (d.eu) {
      g.save();
      g.translate(px(d.eu.x), px(d.eu.z));
      g.rotate(Math.PI - d.eu.rumo); // 0 = para baixo (+z) no canvas
      g.scale(k, k);
      g.fillStyle = '#fff';
      g.strokeStyle = '#2b2d5a';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 5);
      g.lineTo(0, 2);
      g.lineTo(-5, 5);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }
}
