// Visual dos pacotes, marcadores de coleta/entrega (pilares de luz) e a seta guia.
import * as THREE from 'three';
import { PONTOS_COLETA, PONTOS_ENTREGA, RAIO_PONTO } from '../../../shared/cidade';
import type { PacoteInfo, PedidoInfo, TipoPacote } from '../../../shared/protocolo';
import { OFFSET_CARGA, type TipoVeiculo } from '../veiculo/modelos';

export const NOME_PACOTE: Record<TipoPacote, string> = {
  leve: 'Leve',
  pesado: 'Pesado',
  fragil: 'Frágil',
  liquido: 'Líquido',
};
export const ICONE_PACOTE: Record<TipoPacote, string> = { leve: '🎈', pesado: '🧱', fragil: '🥚', liquido: '💧' };
export const DICA_PACOTE: Record<TipoPacote, string> = {
  leve: 'cai fácil em batidas',
  pesado: 'deixa o veículo lento',
  fragil: 'quebra com impacto forte',
  liquido: 'derrama em curvas bruscas',
};

const lamb = (cor: string) => new THREE.MeshLambertMaterial({ color: cor, flatShading: true });

/** Modelo 3D de cada tipo de pacote (faixa colorida = cor do pedido). */
export function criarMeshPacote(tipo: TipoPacote, corPedido: string): THREE.Group {
  const g = new THREE.Group();
  const faixa = new THREE.MeshLambertMaterial({ color: corPedido });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
  };
  if (tipo === 'leve') {
    add(new THREE.BoxGeometry(0.8, 0.7, 0.8), lamb('#f3d9a0'), 0.35);
    add(new THREE.BoxGeometry(0.84, 0.12, 0.2), faixa, 0.5);
    add(new THREE.SphereGeometry(0.28, 8, 6), lamb('#ffffff'), 1.05); // balãozinho: é leve
  } else if (tipo === 'pesado') {
    add(new THREE.BoxGeometry(1.1, 0.8, 1.1), lamb('#5b6270'), 0.4);
    add(new THREE.BoxGeometry(1.14, 0.14, 1.14), faixa, 0.3);
    add(new THREE.BoxGeometry(0.5, 0.1, 0.5), lamb('#ffd23f'), 0.84);
  } else if (tipo === 'fragil') {
    add(new THREE.BoxGeometry(0.8, 0.8, 0.8), lamb('#ffb3c7'), 0.4);
    add(new THREE.BoxGeometry(0.84, 0.14, 0.84), faixa, 0.4);
    add(new THREE.BoxGeometry(0.3, 0.3, 0.3), lamb('#ffffff'), 0.95);
  } else {
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 10), lamb('#4aa8ff'), 0.45);
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 10), faixa, 0.55);
    add(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 8), lamb('#e8f4ff'), 0.96);
  }
  return g;
}

interface Item {
  grupo: THREE.Group;
  nova: boolean;
}

export interface ContextoPacotes {
  meuId: string;
  veiculo: { carga: THREE.Group; tipo: TipoVeiculo } | null;
  remotos: Map<string, { carga: THREE.Group; info: { veic: TipoVeiculo } }>;
}

export class PacotesVisuais {
  private itens = new Map<number, Item>();
  private lista: PacoteInfo[] = [];
  private pedidos = new Map<number, PedidoInfo>();
  private t = 0;

  constructor(private cena: THREE.Scene) {}

  definir(pacotes: PacoteInfo[], pedidos: PedidoInfo[]) {
    this.lista = pacotes;
    this.pedidos = new Map(pedidos.map((p) => [p.id, p]));
    const vivos = new Set(pacotes.map((p) => p.id));
    for (const [id, it] of this.itens) {
      if (!vivos.has(id)) {
        it.grupo.parent?.remove(it.grupo);
        this.itens.delete(id);
      }
    }
  }

  limpar() {
    this.definir([], []);
  }

  atualizar(dt: number, ctx: ContextoPacotes) {
    this.t += dt;
    const empilhados = new Map<string, number>();
    for (const p of this.lista) {
      let it = this.itens.get(p.id);
      if (!it) {
        const ped = this.pedidos.get(p.id);
        it = { grupo: criarMeshPacote(p.tipo, ped?.cor ?? '#ff5a5f'), nova: true };
        this.itens.set(p.id, it);
        this.cena.add(it.grupo);
      }
      const g = it.grupo;
      if (p.estado === 'carregado' && p.dono) {
        const alvo = p.dono === ctx.meuId ? ctx.veiculo : ctx.remotos.get(p.dono);
        const tipo = p.dono === ctx.meuId ? ctx.veiculo?.tipo : (alvo as { info: { veic: TipoVeiculo } } | undefined)?.info.veic;
        if (alvo && tipo) {
          if (g.parent !== alvo.carga) alvo.carga.add(g);
          const idx = empilhados.get(p.dono) ?? 0;
          empilhados.set(p.dono, idx + 1);
          const o = OFFSET_CARGA[tipo];
          g.position.set(o[0], o[1] + idx * 0.85 - 0.35, o[2]);
          g.rotation.set(0, 0, 0);
          continue;
        }
      }
      // Solto no mundo (ponto de coleta ou arremessado)
      if (g.parent !== this.cena) this.cena.add(g);
      const bob = p.estado === 'coleta' ? Math.sin(this.t * 2.5 + p.id) * 0.15 + 0.5 : 0;
      const alvoY = p.pos[1] - 0.45 + bob;
      if (it.nova || g.position.distanceToSquared(new THREE.Vector3(p.pos[0], alvoY, p.pos[2])) > 400) {
        g.position.set(p.pos[0], alvoY, p.pos[2]);
        it.nova = false;
      } else {
        const f = 1 - Math.exp(-14 * dt);
        g.position.x += (p.pos[0] - g.position.x) * f;
        g.position.y += (alvoY - g.position.y) * f;
        g.position.z += (p.pos[2] - g.position.z) * f;
      }
      g.rotation.y += dt * (p.estado === 'coleta' ? 1.2 : 4);
    }
  }
}

// -----------------------------------------------------------------------------
// Marcadores: pilares de luz + anel no chão + letra flutuante
// -----------------------------------------------------------------------------
function criarEtiqueta(texto: string, cor: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = cor;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#fff';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 52px "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(texto, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(4.2, 4.2, 1);
  s.position.y = 9;
  return s;
}

function criarBeacon(cor: string, texto: string): THREE.Group {
  const g = new THREE.Group();
  const mat = (o: number) =>
    new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false });
  const anel = new THREE.Mesh(new THREE.RingGeometry(RAIO_PONTO - 0.9, RAIO_PONTO, 40), mat(0.9));
  anel.rotation.x = -Math.PI / 2;
  anel.position.y = 0.08;
  const disco = new THREE.Mesh(new THREE.CircleGeometry(RAIO_PONTO - 0.9, 40), mat(0.22));
  disco.rotation.x = -Math.PI / 2;
  disco.position.y = 0.07;
  const pilar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 34, 14, 1, true), mat(0.2));
  pilar.position.y = 17;
  g.add(anel, disco, pilar, criarEtiqueta(texto, cor));
  return g;
}

export class Marcadores {
  private coletas = new Map<number, THREE.Group>();
  private entregas = new Map<number, THREE.Group>();
  private t = 0;

  constructor(private cena: THREE.Scene) {}

  definir(pedidos: PedidoInfo[], pacotes: PacoteInfo[]) {
    const ids = new Set(pedidos.map((p) => p.id));
    const emColeta = new Set(pacotes.filter((p) => p.estado === 'coleta').map((p) => p.id));
    const sincronizar = (mapa: Map<number, THREE.Group>, deve: (p: PedidoInfo) => boolean, criar: (p: PedidoInfo) => THREE.Group) => {
      for (const [id, g] of mapa) {
        const p = pedidos.find((x) => x.id === id);
        if (!ids.has(id) || !p || !deve(p)) {
          this.cena.remove(g);
          mapa.delete(id);
        }
      }
      for (const p of pedidos) {
        if (deve(p) && !mapa.has(p.id)) {
          const g = criar(p);
          mapa.set(p.id, g);
          this.cena.add(g);
        }
      }
    };
    sincronizar(this.coletas, (p) => emColeta.has(p.id), (p) => {
      const g = criarBeacon(p.cor, p.letra + ' 📦');
      g.position.set(PONTOS_COLETA[p.coleta].x, 0, PONTOS_COLETA[p.coleta].z);
      return g;
    });
    sincronizar(this.entregas, () => true, (p) => {
      const g = criarBeacon(p.cor, p.letra + ' 🏁');
      g.position.set(PONTOS_ENTREGA[p.entrega].x, 0, PONTOS_ENTREGA[p.entrega].z);
      return g;
    });
  }

  limpar() {
    this.definir([], []);
  }

  atualizar(dt: number) {
    this.t += dt;
    const pulso = 0.85 + Math.sin(this.t * 3) * 0.15;
    for (const g of [...this.coletas.values(), ...this.entregas.values()]) {
      g.children[2].scale.set(pulso, 1, pulso);
      g.children[3].position.y = 9 + Math.sin(this.t * 2) * 0.5;
    }
  }
}

// -----------------------------------------------------------------------------
// Seta guia acima do veículo
// -----------------------------------------------------------------------------
export class Seta {
  readonly grupo = new THREE.Group();
  private corpo: THREE.Mesh;
  private ponta: THREE.Mesh;
  private t = 0;

  constructor(cena: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 });
    const cone = new THREE.ConeGeometry(0.55, 1.2, 4);
    cone.rotateX(Math.PI / 2); // aponta para +Z
    this.ponta = new THREE.Mesh(cone, mat);
    this.ponta.position.z = 1.1;
    this.corpo = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 1.3), mat);
    this.corpo.position.z = 0.1;
    this.grupo.add(this.ponta, this.corpo);
    this.grupo.renderOrder = 9;
    this.ponta.renderOrder = this.corpo.renderOrder = 9;
    this.grupo.visible = false;
    cena.add(this.grupo);
  }

  atualizar(dt: number, de: THREE.Vector3, alvo: { x: number; z: number; cor: string } | null) {
    this.t += dt;
    if (!alvo) {
      this.grupo.visible = false;
      return;
    }
    this.grupo.visible = true;
    this.grupo.position.set(de.x, de.y + 3.3 + Math.sin(this.t * 4) * 0.15, de.z);
    this.grupo.rotation.y = Math.atan2(alvo.x - de.x, alvo.z - de.z);
    (this.ponta.material as THREE.MeshBasicMaterial).color.set(alvo.cor);
    (this.corpo.material as THREE.MeshBasicMaterial).color.set(alvo.cor);
  }
}
