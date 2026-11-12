// Modelos lowpoly "fofos e bobos" dos três veículos, feitos só com primitivas.
// Convenção: frente do veículo = +Z local, origem no chão.
import * as THREE from 'three';

import type { Chapeu, TipoVeiculo } from '../../../shared/protocolo';
export type { TipoVeiculo };

export interface ConfigVeiculo {
  nome: string;
  velMax: number; // m/s
  aceleracao: number; // m/s²
  giro: number; // rad/s em baixa velocidade
  inclinacao: number; // quanto deita nas curvas (rad, só visual)
  molejo: number; // rigidez da "gelatina" visual (menor = mais mole)
  pulo: number; // velocidade vertical do pulo (m/s)
  // --- física ---
  massa: number; // kg
  caixa: [number, number, number]; // meia-largura, meia-altura, meio-comprimento do colisor
  raioRoda: number; // m (também define a altura do chão)
  zeta: number; // amortecimento da suspensão: menor = mais quicante
  aderencia: number; // 1 = normal; menor = derrapa mais
}

export const CONFIGS: Record<TipoVeiculo, ConfigVeiculo> = {
  scooter: {
    nome: 'Scooter', velMax: 22, aceleracao: 16, giro: 2.4, inclinacao: 0.45, molejo: 70, pulo: 8,
    massa: 120, caixa: [0.35, 0.5, 0.95], raioRoda: 0.32, zeta: 0.3, aderencia: 1,
  },
  van: {
    nome: 'Van', velMax: 17, aceleracao: 10, giro: 1.6, inclinacao: -0.16, molejo: 40, pulo: 6,
    massa: 400, caixa: [0.9, 0.8, 1.6], raioRoda: 0.4, zeta: 0.4, aderencia: 0.9,
  },
  carrinho: {
    nome: 'Carrinho de mão', velMax: 14, aceleracao: 20, giro: 3, inclinacao: 0.3, molejo: 30, pulo: 9,
    massa: 100, caixa: [0.55, 0.5, 1.1], raioRoda: 0.36, zeta: 0.22, aderencia: 1.1,
  },
};

export interface ModeloVeiculo {
  raiz: THREE.Group;
  rodas: THREE.Object3D[];
  raioRoda: number;
}

const matPreto = new THREE.MeshLambertMaterial({ color: '#2b2b33' });
const matCinza = new THREE.MeshLambertMaterial({ color: '#c9ced6' });
const matPele = new THREE.MeshLambertMaterial({ color: '#ffd2a8' });
const matBranco = new THREE.MeshLambertMaterial({ color: '#ffffff' });
const matVidro = new THREE.MeshLambertMaterial({ color: '#9fe3ff' });

function caixa(l: number, a: number, p: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(l, a, p), mat);
  m.position.set(x, y, z);
  return m;
}

function roda(raio: number, largura: number, x: number, z: number) {
  const g = new THREE.CylinderGeometry(raio, raio, largura, 10);
  g.rotateZ(Math.PI / 2); // eixo da roda ao longo de X
  const m = new THREE.Mesh(g, matPreto);
  m.position.set(x, raio, z);
  const calota = new THREE.Mesh(new THREE.BoxGeometry(largura + 0.02, raio * 0.9, raio * 0.3), matCinza);
  m.add(calota); // deixa o giro visível
  return m;
}

/** Chapéus cosméticos (origem = topo do capacete). */
function criarChapeu(tipo: Chapeu): THREE.Group | null {
  if (tipo === 'nenhum') return null;
  const g = new THREE.Group();
  const flat = (cor: string) => new THREE.MeshLambertMaterial({ color: cor, flatShading: true });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  if (tipo === 'cartola') {
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12), flat('#1c1c24'), 0, 0.02);
    add(new THREE.CylinderGeometry(0.25, 0.27, 0.45, 12), flat('#1c1c24'), 0, 0.26);
    add(new THREE.CylinderGeometry(0.265, 0.275, 0.08, 12), flat('#d33a4b'), 0, 0.1);
  } else if (tipo === 'cowboy') {
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 14), flat('#a8703a'), 0, 0.02);
    add(new THREE.CylinderGeometry(0.22, 0.3, 0.28, 10), flat('#a8703a'), 0, 0.17);
  } else if (tipo === 'coroa') {
    add(new THREE.CylinderGeometry(0.26, 0.28, 0.16, 10), flat('#ffd23f'), 0, 0.08);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(new THREE.ConeGeometry(0.06, 0.2, 5), flat('#ffd23f'), Math.cos(a) * 0.23, 0.26, Math.sin(a) * 0.23);
    }
    add(new THREE.SphereGeometry(0.05, 6, 5), flat('#e0245e'), 0, 0.1, 0.28);
  } else {
    add(new THREE.ConeGeometry(0.2, 0.5, 8), flat('#ff4fa3'), 0, 0.25);
    add(new THREE.SphereGeometry(0.07, 6, 5), flat('#ffe14d'), 0, 0.52);
  }
  return g;
}

/** Entregador cabeçudo de capacete. */
function entregador(cor: THREE.Material, chapeu: Chapeu = 'nenhum'): THREE.Group {
  const g = new THREE.Group();
  const corpo = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.6, 7), cor);
  corpo.position.y = 0.3;
  const cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.34, 9, 7), matPele);
  cabeca.position.y = 0.88;
  const capacete = new THREE.Mesh(
    new THREE.SphereGeometry(0.37, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    matBranco,
  );
  capacete.position.y = 0.92;
  const olho = new THREE.SphereGeometry(0.055, 6, 5);
  const oe = new THREE.Mesh(olho, matPreto);
  const od = new THREE.Mesh(olho, matPreto);
  oe.position.set(0.13, 0.86, 0.3);
  od.position.set(-0.13, 0.86, 0.3);
  g.add(corpo, cabeca, capacete, oe, od);
  const c = criarChapeu(chapeu);
  if (c) {
    c.position.y = 1.2;
    g.add(c);
  }
  return g;
}

export function criarModelo(tipo: TipoVeiculo, cor: string, chapeu: Chapeu = 'nenhum'): ModeloVeiculo {
  const raiz = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: cor, flatShading: true });
  const rodas: THREE.Object3D[] = [];
  let raioRoda = 0.35;

  if (tipo === 'scooter') {
    raioRoda = 0.32;
    rodas.push(roda(raioRoda, 0.22, 0, 0.75), roda(raioRoda, 0.22, 0, -0.7));
    raiz.add(
      caixa(0.45, 0.14, 1.1, mat, 0, 0.36, 0), // assoalho
      caixa(0.5, 0.42, 0.75, mat, 0, 0.62, -0.5), // traseira
      caixa(0.48, 0.1, 0.7, matPreto, 0, 0.88, -0.45), // banco
      caixa(0.42, 0.85, 0.14, mat, 0, 0.75, 0.62), // escudo frontal
      caixa(0.9, 0.08, 0.08, matPreto, 0, 1.22, 0.58), // guidão
      caixa(0.2, 0.16, 0.08, matBranco, 0, 0.95, 0.71), // farol
      caixa(0.55, 0.45, 0.5, matCinza, 0, 1.15, -0.95), // baú
    );
    const e = entregador(mat, chapeu);
    e.position.set(0, 0.92, -0.3);
    raiz.add(e);
  } else if (tipo === 'van') {
    raioRoda = 0.4;
    for (const x of [0.85, -0.85]) for (const z of [1.05, -1.05]) rodas.push(roda(raioRoda, 0.3, x, z));
    raiz.add(
      caixa(1.7, 1.5, 2.2, mat, 0, 1.2, -0.45), // baú alto e desajeitado
      caixa(1.7, 0.75, 1.0, mat, 0, 0.82, 1.15), // capô/cabine baixa
      caixa(1.5, 0.55, 0.06, matVidro, 0, 1.5, 0.67), // para-brisa
      caixa(0.3, 0.2, 0.06, matBranco, 0.55, 0.85, 1.66), // faróis
      caixa(0.3, 0.2, 0.06, matBranco, -0.55, 0.85, 1.66),
      caixa(1.8, 0.16, 0.16, matCinza, 0, 0.5, 1.68), // para-choque
    );
    const e = entregador(mat, chapeu);
    e.position.set(0.35, 1.1, 0.95);
    e.scale.setScalar(0.8);
    raiz.add(e);
  } else {
    raioRoda = 0.36;
    rodas.push(roda(raioRoda, 0.26, 0, 0.95), roda(0.2, 0.14, 0.42, -0.75), roda(0.2, 0.14, -0.42, -0.75));
    const cacamba = caixa(1.05, 0.5, 1.2, mat, 0, 0.82, 0.35);
    cacamba.rotation.x = -0.12;
    raiz.add(
      cacamba,
      caixa(0.08, 0.08, 1.3, matCinza, 0.45, 0.72, -0.8), // cabos
      caixa(0.08, 0.08, 1.3, matCinza, -0.45, 0.72, -0.8),
      caixa(0.5, 0.35, 0.4, matPreto, 0, 0.5, -0.5), // motorzinho
      caixa(0.08, 0.5, 0.08, matCinza, 0.2, 0.9, -0.6), // escapamento
    );
    const e = entregador(mat, chapeu);
    e.position.set(0, 0.6, -1.15);
    raiz.add(e);
  }

  for (const r of rodas) raiz.add(r);
  raiz.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { raiz, rodas, raioRoda };
}

/** Onde o primeiro pacote se encaixa (coordenadas do modelo; origem no chão). */
export const OFFSET_CARGA: Record<TipoVeiculo, [number, number, number]> = {
  scooter: [0, 1.75, -0.95],
  van: [0, 2.35, -0.45],
  carrinho: [0, 1.3, 0.35],
};
