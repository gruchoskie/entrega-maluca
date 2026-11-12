// A cidade: ruas, calçadas, prédios (instanciados), parques, praças com rampas e props empurráveis.
// O layout vem de shared/cidade.ts (igual para todos os jogadores e para o servidor).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CENTROS, ESTRADAS, LARG_RUA, LIMITE, TAM_BLOCO, gerarCidade } from '../../../shared/cidade';
import type { Fisica } from '../fisica/fisica';
import type { Mundo } from './mundo';
import { aleatorio } from './mundo';

export interface Cenario {
  /** Copia a pose dos corpos dinâmicos (caixotes e cones) para as malhas. */
  sincronizar(): void;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export function criarCenario(fis: Fisica, mundo: Mundo): Cenario {
  const { R, mundo: fm } = fis;
  const cena = mundo.cena;
  const cidade = gerarCidade();

  // ---------- Física estática: chão, paredes invisíveis, prédios, troncos ----------
  fm.createCollider(R.ColliderDesc.cuboid(900, 1, 900).setTranslation(0, -1, 0).setFriction(0.6));
  const L = LIMITE + 6;
  for (const [x, z, hx, hz] of [[L, 0, 5, L], [-L, 0, 5, L], [0, L, L, 5], [0, -L, L, 5]]) {
    fm.createCollider(R.ColliderDesc.cuboid(hx, 30, hz).setTranslation(x, 30, z).setRestitution(0.5));
  }
  for (const b of cidade.predios) {
    fm.createCollider(
      R.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z).setFriction(0.3).setRestitution(0.35),
    );
  }
  for (const a of mundo.arvores) {
    fm.createCollider(R.ColliderDesc.cylinder(1.6, 0.4 * a.s).setTranslation(a.x, 1.6, a.z));
  }

  // ---------- Ruas ----------
  const matRua = new THREE.MeshLambertMaterial({ color: '#4a4f5c' });
  const comp = LIMITE * 2 + LARG_RUA;
  for (const r of ESTRADAS) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(LARG_RUA, 0.05, comp), matRua);
    v.position.set(r, 0.025, 0);
    const h = new THREE.Mesh(new THREE.BoxGeometry(comp, 0.05, LARG_RUA), matRua);
    h.position.set(0, 0.03, r); // 5 mm acima: evita "briga" de profundidade no cruzamento
    v.receiveShadow = h.receiveShadow = true;
    cena.add(v, h);
  }

  // Faixas tracejadas no centro de cada rua (1 única chamada de desenho)
  const tracos: THREE.Matrix4[] = [];
  const pulaCruzamento = (c: number) => ESTRADAS.some((e) => Math.abs(c - e) < LARG_RUA / 2 + 2);
  for (const r of ESTRADAS) {
    for (let c = -LIMITE + 4; c < LIMITE; c += 8) {
      if (pulaCruzamento(c)) continue;
      tracos.push(new THREE.Matrix4().makeTranslation(r, 0.07, c)); // rua vertical (x = r)
      tracos.push(new THREE.Matrix4().compose(new THREE.Vector3(c, 0.075, r), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 2), _s));
    }
  }
  const faixas = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.02, 3.2), new THREE.MeshBasicMaterial({ color: '#ffe38a' }), tracos.length);
  tracos.forEach((t, i) => faixas.setMatrixAt(i, t));
  cena.add(faixas);

  // ---------- Quarteirões: calçada (só visual), parques e praças ----------
  const calcada = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TAM_BLOCO, 0.08, TAM_BLOCO),
    new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    CENTROS.length * CENTROS.length,
  );
  let i = 0;
  const cor = new THREE.Color();
  for (const bx of CENTROS) {
    for (const bz of CENTROS) {
      const parque = cidade.parques.some((p) => p.x === bx && p.z === bz);
      calcada.setMatrixAt(i, _m.makeTranslation(bx, 0.04, bz));
      calcada.setColorAt(i, cor.set(parque ? '#8fd16e' : '#c9ccd6'));
      i++;
    }
  }
  calcada.receiveShadow = true;
  cena.add(calcada);

  // ---------- Prédios: 1 InstancedMesh, cor por instância, sombreado no vão ----------
  const geoPredio = new THREE.BoxGeometry(1, 1, 1);
  const pos = geoPredio.attributes.position;
  const cores = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    const claro = pos.getY(v) > 0 ? 1 : 0.78; // base mais escura = volume
    cores.set([claro, claro, claro], v * 3);
  }
  geoPredio.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  const predios = new THREE.InstancedMesh(
    geoPredio,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    cidade.predios.length,
  );
  const telhados = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    cidade.predios.length,
  );
  cidade.predios.forEach((b, k) => {
    predios.setMatrixAt(k, _m.compose(_p.set(b.x, b.h / 2, b.z), _q.identity(), _s.set(b.w, b.h, b.d)));
    predios.setColorAt(k, cor.set(b.cor));
    telhados.setMatrixAt(k, _m.compose(_p.set(b.x, b.h + 0.3, b.z), _q.identity(), _s.set(b.w + 0.6, 0.6, b.d + 0.6)));
    telhados.setColorAt(k, cor.set(b.cor).multiplyScalar(0.6));
  });
  _s.set(1, 1, 1);
  predios.castShadow = predios.receiveShadow = true;
  telhados.castShadow = true;
  cena.add(predios, telhados);

  // ---------- Rampas das praças ----------
  for (const r of cidade.rampas) criarRampa(fis, cena, r.w, r.h, r.l, r.x, r.z, r.yaw);

  // ---------- Props dinâmicos: cones e caixotes (só locais; cada cliente tem os seus) ----------
  const rnd = aleatorio(21);
  const nCones = 48;
  const cones = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.35, 0.9, 6),
    new THREE.MeshLambertMaterial({ color: '#ff7a2b', flatShading: true }),
    nCones,
  );
  cones.castShadow = true;
  const corposCones: RAPIER.RigidBody[] = [];
  for (let k = 0; k < nCones; k++) {
    // Em fileiras ao longo das ruas, longe da largada
    let x: number, z: number;
    do {
      const rua = ESTRADAS[Math.floor(rnd() * ESTRADAS.length)];
      const t = (rnd() - 0.5) * 2 * (LIMITE - 10);
      const lado = (rnd() - 0.5) * (LARG_RUA - 3);
      [x, z] = rnd() < 0.5 ? [rua + lado, t] : [t, rua + lado];
    } while (Math.abs(x) < 12 && z > -25 && z < 12);
    const b = fm.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, 0.45, z).setAngularDamping(0.5));
    fm.createCollider(R.ColliderDesc.cylinder(0.45, 0.28).setMass(3).setFriction(0.5).setRestitution(0.35), b);
    corposCones.push(b);
  }
  cena.add(cones);

  // Pilhas de caixotes nas praças (para derrubar)
  const nCaixas = 36;
  const caixas = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    nCaixas,
  );
  caixas.castShadow = caixas.receiveShadow = true;
  const tons = ['#e8a54b', '#d98b3a', '#c9772e'];
  const corposCaixas: RAPIER.RigidBody[] = [];
  const pilhas: [number, number][] = [[-84 + 12, 28 + 12], [84 - 12, -28 - 12], [56 + 9, 28]];
  for (const [px, pz] of pilhas) {
    for (let a = 0; a < 3; a++) {
      for (let h = 0; h < 4 - a; h++) {
        if (corposCaixas.length >= nCaixas) break;
        const b = fm.createRigidBody(
          R.RigidBodyDesc.dynamic().setTranslation(px + a * 1.05, 0.5 + h * 1.01, pz).setAngularDamping(0.3),
        );
        fm.createCollider(R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setMass(18).setFriction(0.6).setRestitution(0.15), b);
        caixas.setColorAt(corposCaixas.length, cor.set(tons[corposCaixas.length % 3]));
        corposCaixas.push(b);
      }
    }
  }
  caixas.count = corposCaixas.length;
  cena.add(caixas);

  const copiar = (malha: THREE.InstancedMesh, corpos: RAPIER.RigidBody[]) => {
    for (let k = 0; k < corpos.length; k++) {
      const t = corpos[k].translation();
      const r = corpos[k].rotation();
      malha.setMatrixAt(k, _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s));
    }
    malha.instanceMatrix.needsUpdate = true;
  };
  return {
    sincronizar() {
      copiar(caixas, corposCaixas);
      copiar(cones, corposCones);
    },
  };
}

/** Rampa em cunha: sobe de z=-l/2 (chão) até z=+l/2 (altura h), no sistema local. */
function criarRampa(fis: Fisica, cena: THREE.Scene, w: number, h: number, l: number, x: number, z: number, yaw: number) {
  const { R, mundo } = fis;
  const a = w / 2;
  const b = l / 2;
  const v = [[-a, 0, -b], [a, 0, -b], [-a, 0, b], [a, 0, b], [-a, h, b], [a, h, b]];

  // Colisor: casco convexo dos 6 vértices
  const corpo = mundo.createRigidBody(
    R.RigidBodyDesc.fixed().setTranslation(x, 0, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
  );
  const desc = R.ColliderDesc.convexHull(new Float32Array(v.flat()));
  if (desc) mundo.createCollider(desc.setFriction(0.5), corpo);

  // Malha (DoubleSide evita se preocupar com a ordem dos vértices)
  const tris = [[0, 4, 5], [0, 5, 1], [2, 3, 5], [2, 5, 4], [0, 1, 3], [0, 3, 2], [0, 2, 4], [1, 5, 3]];
  const pos: number[] = [];
  for (const t of tris) for (const i of t) pos.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const malha = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#ffc23d', flatShading: true, side: THREE.DoubleSide }));
  malha.position.set(x, 0, z);
  malha.rotation.y = yaw;
  malha.castShadow = malha.receiveShadow = true;
  cena.add(malha);
}
