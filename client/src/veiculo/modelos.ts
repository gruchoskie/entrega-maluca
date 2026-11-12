// Modelos lowpoly "fofos e bobos" dos três veículos, feitos só com primitivas arredondadas.
// Convenção: frente do veículo = +Z local, origem no chão.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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

// ---------------------------------------------------------------------------
// Materiais e ajudantes
// ---------------------------------------------------------------------------
const lamb = (cor: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color: cor });
const brilho = (cor: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color: cor }); // faróis "acesos"
const matPreto = lamb('#2b2b33');
const matCinza = lamb('#c9ced6');
const matCinzaEscuro = lamb('#555a66');
const matPele = lamb('#ffd2a8');
const matBranco = lamb('#ffffff');
const matCalca = lamb('#3b3f58');
const matVidro = new THREE.MeshLambertMaterial({ color: '#9fe3ff', transparent: true, opacity: 0.6 });

const arred = (l: number, a: number, p: number, r = 0.08) =>
  new RoundedBoxGeometry(l, a, p, 3, Math.min(r, l / 2 - 0.001, a / 2 - 0.001, p / 2 - 0.001));

function malha(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Cápsula esticada entre dois pontos (braços, pernas, barras). */
function entre(a: THREE.Vector3, b: THREE.Vector3, raio: number, mat: THREE.Material) {
  const dir = b.clone().sub(a);
  const comp = Math.max(0.01, dir.length() - raio * 2);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(raio, comp, 4, 8), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Roda com pneu, calota clara e um "parafuso" que deixa o giro visível. */
function roda(raio: number, largura: number, x: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, raio, z);
  const pneu = new THREE.CylinderGeometry(raio, raio, largura, 16);
  pneu.rotateZ(Math.PI / 2); // eixo da roda ao longo de X
  const cubo = new THREE.CylinderGeometry(raio * 0.58, raio * 0.58, largura + 0.03, 12);
  cubo.rotateZ(Math.PI / 2);
  g.add(
    malha(pneu, matPreto),
    malha(cubo, lamb('#e8ecf2')),
    malha(new THREE.BoxGeometry(largura + 0.05, raio * 0.9, raio * 0.2), matCinzaEscuro),
  );
  return g;
}

/** Olhos grandes e bobos (branco + pupila). */
function olhos(x: number, y: number, z: number, raio: number, par = true) {
  const g = new THREE.Group();
  for (const lado of par ? [-1, 1] : [1]) {
    const o = new THREE.Group();
    o.position.set(par ? x * lado : x, y, z);
    o.add(
      malha(new THREE.SphereGeometry(raio, 14, 10), matBranco),
      malha(new THREE.SphereGeometry(raio * 0.5, 10, 8), matPreto, 0, -raio * 0.05, raio * 0.78),
    );
    g.add(o);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Chapéus cosméticos (origem = topo do capacete)
// ---------------------------------------------------------------------------
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
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 14), flat('#1c1c24'), 0, 0.02);
    add(new THREE.CylinderGeometry(0.25, 0.27, 0.45, 14), flat('#1c1c24'), 0, 0.26);
    add(new THREE.CylinderGeometry(0.265, 0.275, 0.08, 14), flat('#d33a4b'), 0, 0.1);
  } else if (tipo === 'cowboy') {
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 16), flat('#a8703a'), 0, 0.02);
    add(new THREE.CylinderGeometry(0.22, 0.3, 0.28, 12), flat('#a8703a'), 0, 0.17);
  } else if (tipo === 'coroa') {
    add(new THREE.CylinderGeometry(0.26, 0.28, 0.16, 12), flat('#ffd23f'), 0, 0.08);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(new THREE.ConeGeometry(0.06, 0.2, 5), flat('#ffd23f'), Math.cos(a) * 0.23, 0.26, Math.sin(a) * 0.23);
    }
    add(new THREE.SphereGeometry(0.05, 8, 6), flat('#e0245e'), 0, 0.1, 0.28);
  } else {
    add(new THREE.ConeGeometry(0.2, 0.5, 10), flat('#ff4fa3'), 0, 0.25);
    add(new THREE.SphereGeometry(0.07, 8, 6), flat('#ffe14d'), 0, 0.52);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Entregador: cabeçudo, de capacete, com cara de bobo (olhos, bochechas, sorriso)
// ---------------------------------------------------------------------------
interface PoseEntregador {
  mao?: [number, number, number]; // alvo das mãos (x é espelhado), no sistema do entregador
  pernas: 'sentado' | 'em-pe' | 'nenhuma';
}

function entregador(cor: THREE.Color, chapeu: Chapeu, pose: PoseEntregador): THREE.Group {
  const g = new THREE.Group();
  const roupa = lamb(cor);
  g.add(malha(new THREE.CapsuleGeometry(0.21, 0.28, 4, 10), roupa, 0, 0.36, 0)); // tronco
  g.add(malha(arred(0.34, 0.36, 0.16, 0.06), lamb(cor.clone().multiplyScalar(0.72)), 0, 0.42, -0.25)); // mochila

  // Cabeça
  g.add(malha(new THREE.SphereGeometry(0.36, 20, 16), matPele, 0, 0.92, 0));
  g.add(olhos(0.14, 0.9, 0.31, 0.095));
  for (const lado of [-1, 1]) {
    const b = malha(new THREE.SphereGeometry(0.06, 8, 6), lamb('#ff9aa8'), 0.25 * lado, 0.79, 0.26);
    b.scale.z = 0.5;
    g.add(b);
  }
  const sorriso = malha(new THREE.TorusGeometry(0.075, 0.018, 6, 14, Math.PI), matPreto, 0, 0.78, 0.335);
  sorriso.rotation.z = Math.PI; // arco para baixo
  g.add(sorriso);

  // Capacete branco com aba na cor do veículo
  g.add(malha(new THREE.SphereGeometry(0.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), matBranco, 0, 0.98, 0));
  g.add(malha(arred(0.44, 0.05, 0.22, 0.02), lamb(cor), 0, 1.0, 0.4));

  // Braços até as mãos
  if (pose.mao) {
    for (const lado of [-1, 1]) {
      const ombro = V(0.25 * lado, 0.52, 0);
      const mao = V(pose.mao[0] * lado, pose.mao[1], pose.mao[2]);
      g.add(entre(ombro, mao, 0.075, roupa), malha(new THREE.SphereGeometry(0.1, 10, 8), matPele, mao.x, mao.y, mao.z));
    }
  }
  // Pernas
  if (pose.pernas !== 'nenhuma') {
    for (const lado of [-1, 1]) {
      const quadril = V(0.13 * lado, 0.12, 0);
      const pe = pose.pernas === 'sentado' ? V(0.16 * lado, -0.5, 0.32) : V(0.14 * lado, -0.58, 0.06);
      if (pose.pernas === 'sentado') {
        const joelho = V(0.16 * lado, -0.02, 0.28);
        g.add(entre(quadril, joelho, 0.09, matCalca), entre(joelho, pe, 0.085, matCalca));
      } else g.add(entre(quadril, pe, 0.09, matCalca));
      g.add(malha(arred(0.16, 0.1, 0.28, 0.04), matPreto, pe.x, pe.y - 0.02, pe.z + 0.05));
    }
  }

  const c = criarChapeu(chapeu);
  if (c) {
    c.position.y = 1.3;
    g.add(c);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Veículos
// ---------------------------------------------------------------------------
export function criarModelo(tipo: TipoVeiculo, cor: string, chapeu: Chapeu = 'nenhum'): ModeloVeiculo {
  const raiz = new THREE.Group();
  const c = new THREE.Color(cor);
  const mat = lamb(c);
  const escura = lamb(c.clone().multiplyScalar(0.7));
  const clara = lamb(c.clone().lerp(new THREE.Color('#ffffff'), 0.5));
  const rodas: THREE.Object3D[] = [];
  let raioRoda = 0.35;

  if (tipo === 'scooter') {
    raioRoda = 0.32;
    rodas.push(roda(raioRoda, 0.22, 0, 0.75), roda(raioRoda, 0.22, 0, -0.7));
    const escudo = malha(arred(0.46, 0.85, 0.16, 0.07), mat, 0, 0.82, 0.66);
    escudo.rotation.x = -0.15;
    const guidao = malha(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8).rotateZ(Math.PI / 2), matPreto, 0, 1.24, 0.6);
    raiz.add(
      malha(arred(0.5, 0.12, 1.2, 0.05), escura, 0, 0.35, 0.05), // assoalho
      malha(arred(0.58, 0.5, 0.82, 0.16), mat, 0, 0.62, -0.5), // carenagem traseira
      malha(arred(0.52, 0.12, 0.74, 0.05), matPreto, 0, 0.92, -0.42), // banco
      escudo,
      malha(arred(0.32, 0.07, 0.6, 0.03), mat, 0, 0.7, 0.82), // paralama dianteiro
      guidao,
      malha(new THREE.SphereGeometry(0.06, 8, 6), matPreto, 0.46, 1.24, 0.6), // manoplas
      malha(new THREE.SphereGeometry(0.06, 8, 6), matPreto, -0.46, 1.24, 0.6),
      malha(new THREE.SphereGeometry(0.12, 12, 10), brilho('#fff6c0'), 0, 1.0, 0.76), // farol (um olhão)
      malha(arred(0.3, 0.1, 0.05, 0.02), brilho('#ff4a4a'), 0, 0.66, -0.93), // lanterna
      // baú de entregas
      malha(arred(0.64, 0.55, 0.6, 0.1), clara, 0, 1.17, -0.95),
      malha(arred(0.66, 0.12, 0.62, 0.05), mat, 0, 1.17, -0.95), // faixa na cor do jogador
      malha(arred(0.68, 0.07, 0.64, 0.03), escura, 0, 1.45, -0.95), // tampa
    );
    const e = entregador(c, chapeu, { mao: [0.46, 0.24, 0.82], pernas: 'sentado' });
    e.position.set(0, 0.95, -0.2);
    raiz.add(e);
  } else if (tipo === 'van') {
    raioRoda = 0.4;
    for (const x of [0.85, -0.85]) for (const z of [1.05, -1.05]) rodas.push(roda(raioRoda, 0.3, x, z));
    const nome = (x: number) => {
      const g = new THREE.Group();
      const disco = malha(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20).rotateZ(Math.PI / 2), lamb('#ffd23f'), x, 1.3, -0.45);
      const caixinha = malha(arred(0.05, 0.28, 0.28, 0.02), matBranco, x * 1.01, 1.3, -0.45);
      g.add(disco, caixinha);
      return g;
    };
    raiz.add(
      malha(arred(1.7, 1.5, 2.2, 0.28), mat, 0, 1.2, -0.45), // baú alto e desajeitado
      malha(arred(1.7, 0.7, 0.95, 0.2), mat, 0, 0.75, 1.1), // cabine (parte baixa, de janelas abertas)
      malha(arred(1.7, 0.12, 0.95, 0.05), mat, 0, 1.64, 1.1), // teto da cabine
      malha(arred(1.62, 0.52, 0.55, 0.15), mat, 0, 0.7, 1.55), // capô
      malha(arred(1.5, 0.5, 0.04, 0.015), matVidro, 0, 1.36, 1.54), // para-brisa
      malha(arred(0.04, 0.5, 0.8, 0.015), matVidro, 0.84, 1.36, 1.09), // vidros laterais
      malha(arred(0.04, 0.5, 0.8, 0.015), matVidro, -0.84, 1.36, 1.09),
      malha(arred(1.74, 0.16, 0.22, 0.06), matCinza, 0, 0.42, 1.78), // para-choque
      malha(arred(1.74, 0.16, 0.22, 0.06), matCinza, 0, 0.42, -1.58),
      malha(arred(1.72, 0.2, 2.0, 0.04), clara, 0, 0.78, -0.45), // faixa lateral clara
      malha(arred(0.55, 0.2, 0.34, 0.07), lamb('#ffd23f'), 0, 1.84, 1.1), // letreiro no teto
      malha(arred(0.3, 0.1, 0.06, 0.02), brilho('#ff4a4a'), 0.6, 0.78, -1.57), // lanternas
      malha(arred(0.3, 0.1, 0.06, 0.02), brilho('#ff4a4a'), -0.6, 0.78, -1.57),
      nome(0.86),
      nome(-0.86),
    );
    // Cara da van: olhos grandes no capô + sorriso
    const faceOlhos = olhos(0.45, 0.78, 1.78, 0.22);
    const sorriso = malha(new THREE.TorusGeometry(0.28, 0.035, 6, 18, Math.PI), matPreto, 0, 0.6, 1.83);
    sorriso.rotation.z = Math.PI;
    raiz.add(faceOlhos, sorriso);
    // Pilares da cabine
    for (const x of [-0.8, 0.8]) for (const z of [0.66, 1.52]) raiz.add(malha(new THREE.BoxGeometry(0.1, 0.56, 0.1), mat, x, 1.36, z));
    const e = entregador(c, chapeu, { pernas: 'nenhuma' });
    e.scale.setScalar(0.8);
    e.position.set(0.3, 0.55, 1.0);
    raiz.add(e);
  } else {
    raioRoda = 0.36;
    rodas.push(roda(raioRoda, 0.26, 0, 0.95), roda(0.2, 0.14, 0.42, -0.75), roda(0.2, 0.14, -0.42, -0.75));
    const cacamba = new THREE.Group();
    cacamba.position.set(0, 0.84, 0.35);
    cacamba.rotation.x = -0.12;
    cacamba.add(
      malha(arred(1.08, 0.52, 1.26, 0.18), mat, 0, 0, 0),
      malha(arred(0.9, 0.05, 1.08, 0.02), lamb('#26262e'), 0, 0.26, 0), // interior escuro
      malha(arred(1.12, 0.08, 1.3, 0.04), clara, 0, 0.25, 0), // borda clara
    );
    raiz.add(cacamba);
    // Olhinhos bobos na frente da caçamba
    raiz.add(olhos(0.26, 0.92, 0.99, 0.13));
    // Cabos, pernas e motorzinho
    for (const lado of [-1, 1]) {
      raiz.add(
        entre(V(0.4 * lado, 0.72, -0.2), V(0.45 * lado, 0.98, -1.5), 0.045, matCinza), // cabos
        malha(new THREE.SphereGeometry(0.07, 8, 6), matPreto, 0.45 * lado, 0.98, -1.5), // manoplas
        entre(V(0.4 * lado, 0.72, -0.4), V(0.42 * lado, 0.22, -0.75), 0.04, matCinzaEscuro), // apoios
      );
    }
    raiz.add(
      malha(arred(0.5, 0.38, 0.45, 0.1), matCinzaEscuro, 0, 0.52, -0.5), // motorzinho
      malha(new THREE.CylinderGeometry(0.05, 0.06, 0.45, 8), matCinza, 0.2, 0.95, -0.62), // escapamento
      malha(new THREE.SphereGeometry(0.07, 8, 6), brilho('#ffd23f'), 0.2, 1.2, -0.62), // faísca de entusiasmo
    );
    const e = entregador(c, chapeu, { mao: [0.45, 0.4, 0.1], pernas: 'em-pe' });
    e.position.set(0, 0.62, -1.4);
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
  scooter: [0, 1.8, -0.95],
  van: [0, 2.35, -0.45],
  carrinho: [0, 1.3, 0.35],
};
