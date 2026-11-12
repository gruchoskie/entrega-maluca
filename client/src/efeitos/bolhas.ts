// Balões de fala/emote que flutuam sobre os jogadores por alguns segundos.
import * as THREE from 'three';

interface Bolha {
  sprite: THREE.Sprite;
  nasceu: number;
  pai: THREE.Object3D;
}

function textura(texto: string): { tex: THREE.CanvasTexture; w: number } {
  const emoji = texto.length <= 2;
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d')!;
  g0.font = (emoji ? 'bold 64px' : 'bold 40px') + ' "Trebuchet MS", sans-serif';
  const largura = Math.max(110, Math.ceil(g0.measureText(texto).width) + 50);
  c.width = largura;
  c.height = 110;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#2b2d5a';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(4, 4, largura - 8, 80, 28);
  g.fill();
  g.stroke();
  g.beginPath(); // pontinha do balão
  g.moveTo(largura / 2 - 12, 82);
  g.lineTo(largura / 2, 106);
  g.lineTo(largura / 2 + 12, 82);
  g.closePath();
  g.fill();
  g.font = (emoji ? 'bold 56px' : 'bold 38px') + ' "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#2b2d5a';
  g.fillText(texto, largura / 2, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, w: largura };
}

export class Bolhas {
  private lista: Bolha[] = [];

  /** Mostra um balão sobre `pai` (o balão acompanha o objeto). */
  mostrar(pai: THREE.Object3D, texto: string, alturaBase = 3.6) {
    // Um balão por jogador: troca o anterior
    for (const b of this.lista.filter((x) => x.pai === pai)) this.remover(b);
    const { tex, w } = textura(texto);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set((w / 110) * 1.6, 1.6, 1);
    s.position.set(0, alturaBase, 0);
    s.renderOrder = 12;
    pai.add(s);
    this.lista.push({ sprite: s, nasceu: performance.now(), pai });
  }

  private remover(b: Bolha) {
    b.pai.remove(b.sprite);
    (b.sprite.material as THREE.SpriteMaterial).map?.dispose();
    b.sprite.material.dispose();
    this.lista = this.lista.filter((x) => x !== b);
  }

  atualizar(agora: number) {
    for (const b of [...this.lista]) {
      const t = (agora - b.nasceu) / 3200;
      if (t >= 1) this.remover(b);
      else {
        b.sprite.position.y = 3.6 + Math.min(t * 4, 0.5);
        (b.sprite.material as THREE.SpriteMaterial).opacity = t > 0.8 ? (1 - t) / 0.2 : 1;
      }
    }
  }
}
