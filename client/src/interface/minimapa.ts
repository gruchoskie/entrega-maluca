// Minimapa (norte para cima): ruas, pontos de coleta/entrega, amigos e eventos.
import { CENTROS, ESTRADAS, LARG_RUA, LIMITE, PONTOS_COLETA, PONTOS_ENTREGA, TAM_BLOCO } from '../../../shared/cidade';
import type { JogoTick } from '../../../shared/protocolo';

const TAM = 140;
const ESC = TAM / (LIMITE * 2 + LARG_RUA);
const px = (v: number) => (v + LIMITE + LARG_RUA / 2) * ESC;

export interface DadosMinimapa {
  eu: { x: number; z: number; rumo: number } | null;
  amigos: { x: number; z: number; cor: string }[];
  carros: { x: number; z: number }[];
  jogo: JogoTick | null;
  meuId: string;
}

export class Minimapa {
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private fundo = document.createElement('canvas');

  constructor() {
    this.canvas.id = 'minimapa';
    this.canvas.width = this.canvas.height = TAM;
    this.g = this.canvas.getContext('2d')!;
    document.getElementById('hud')!.appendChild(this.canvas);

    // Camada estática: calçadas e ruas desenhadas uma vez
    this.fundo.width = this.fundo.height = TAM;
    const f = this.fundo.getContext('2d')!;
    f.fillStyle = '#7ecb62';
    f.fillRect(0, 0, TAM, TAM);
    f.fillStyle = '#d9dce6';
    for (const bx of CENTROS) for (const bz of CENTROS) f.fillRect(px(bx - TAM_BLOCO / 2), px(bz - TAM_BLOCO / 2), TAM_BLOCO * ESC, TAM_BLOCO * ESC);
    f.fillStyle = '#585d6c';
    for (const r of ESTRADAS) {
      f.fillRect(px(r - LARG_RUA / 2), 0, LARG_RUA * ESC, TAM);
      f.fillRect(0, px(r - LARG_RUA / 2), TAM, LARG_RUA * ESC);
    }
  }

  visivel(v: boolean) {
    this.canvas.style.display = v ? '' : 'none';
  }

  desenhar(d: DadosMinimapa) {
    const g = this.g;
    g.drawImage(this.fundo, 0, 0);

    for (const c of d.carros) {
      g.fillStyle = 'rgba(30,30,40,.7)';
      g.fillRect(px(c.x) - 1.5, px(c.z) - 1.5, 3, 3);
    }

    if (d.jogo) {
      const { pedidos, pacotes, evento } = d.jogo;
      if (evento && (evento.tipo === 'obras' || evento.tipo === 'buraco')) {
        g.fillStyle = evento.tipo === 'obras' ? '#ff7a2b' : '#15151c';
        g.beginPath();
        g.arc(px(evento.x), px(evento.z), evento.tipo === 'buraco' ? 5 : 4, 0, Math.PI * 2);
        g.fill();
      }
      g.font = 'bold 9px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const p of pedidos) {
        const pk = pacotes.find((x) => x.id === p.id);
        // Entrega: círculo
        const e = PONTOS_ENTREGA[p.entrega];
        g.fillStyle = p.cor;
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(px(e.x), px(e.z), 6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#fff';
        g.fillText(p.letra, px(e.x), px(e.z) + 0.5);
        // Coleta (ainda não pega): quadrado
        if (pk?.estado === 'coleta') {
          const c = PONTOS_COLETA[p.coleta];
          g.fillStyle = p.cor;
          g.fillRect(px(c.x) - 6, px(c.z) - 6, 12, 12);
          g.strokeRect(px(c.x) - 6, px(c.z) - 6, 12, 12);
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
      g.arc(px(a.x), px(a.z), 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    if (d.eu) {
      g.save();
      g.translate(px(d.eu.x), px(d.eu.z));
      g.rotate(Math.PI - d.eu.rumo); // 0 = para baixo (+z) no canvas
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
