// Trânsito: carros NPC em circuitos retangulares nas ruas.
// A posição de cada carro depende só do relógio do servidor, então TODOS os jogadores veem
// os mesmos carros no mesmo lugar, sem gastar rede. Cada carro é um corpo cinemático (empurra, não é empurrado).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Fisica } from '../fisica/fisica';

interface Anel {
  R: number; // meia-largura do retângulo (rua central)
  d: number; // deslocamento da faixa (+ para dentro)
  v: number; // m/s
  normais: number;
  extras: number; // só aparecem no evento "trânsito intenso"
  inverso: boolean;
}
const ANEIS: Anel[] = [
  { R: 56, d: 3.6, v: 8.5, normais: 5, extras: 3, inverso: false },
  { R: 112, d: -3.6, v: 11, normais: 7, extras: 5, inverso: true },
];
const RC = 11; // raio das curvas

interface Carro {
  anel: number;
  fase: number; // metros no circuito
  extra: boolean;
  corpo: RAPIER.RigidBody;
  cor: THREE.Color;
}

const PALETA = ['#ff5a5f', '#ffd166', '#4a7bff', '#4cd964', '#ff8fa3', '#2ec4d6', '#f9f9f9', '#b061ff'];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const OCULTO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Ponto do retângulo arredondado percorrido em sentido anti-horário. */
function pontoNoAnel(H: number, s: number, out: { x: number; z: number; yaw: number }) {
  const L = 2 * (H - RC);
  const A = (Math.PI / 2) * RC;
  const P = 4 * (L + A);
  s = ((s % P) + P) % P;
  const lado = Math.floor(s / (L + A));
  let u = s - lado * (L + A);
  const arco = u > L;
  if (arco) u -= L;
  const e = H - RC;
  if (!arco) {
    // trechos retos
    if (lado === 0) { out.x = -e + u; out.z = -H; out.yaw = Math.PI / 2; }
    else if (lado === 1) { out.x = H; out.z = -e + u; out.yaw = 0; }
    else if (lado === 2) { out.x = e - u; out.z = H; out.yaw = -Math.PI / 2; }
    else { out.x = -H; out.z = e - u; out.yaw = Math.PI; }
  } else {
    const th = u / RC; // 0..π/2
    const base = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][lado] + th;
    const cx = [e, e, -e, -e][lado];
    const cz = [-e, e, e, -e][lado];
    out.x = cx + RC * Math.cos(base);
    out.z = cz + RC * Math.sin(base);
    out.yaw = Math.atan2(-Math.sin(base), Math.cos(base));
  }
  return P;
}

export class Transito {
  private carros: Carro[] = [];
  private intenso = false;
  private pose = { x: 0, z: 0, yaw: 0 };
  private corpoMesh: THREE.InstancedMesh;
  private cabine: THREE.InstancedMesh;
  private chassi: THREE.InstancedMesh;

  constructor(fis: Fisica, cena: THREE.Scene, private relogio: () => number) {
    const { R, mundo } = fis;
    let k = 0;
    ANEIS.forEach((a, ai) => {
      const total = a.normais + a.extras;
      const P = pontoNoAnel(a.R - a.d, 0, this.pose);
      for (let i = 0; i < total; i++) {
        const corpo = mundo.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
        mundo.createCollider(R.ColliderDesc.cuboid(0.95, 0.7, 1.9).setFriction(0.1).setRestitution(0.3), corpo);
        this.carros.push({
          anel: ai,
          fase: (i * P) / total + ai * 40,
          extra: i >= a.normais,
          corpo,
          cor: new THREE.Color(PALETA[k++ % PALETA.length]),
        });
      }
    });
    const n = this.carros.length;
    const mat = (c: string) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    this.corpoMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.7, 3.8), mat('#ffffff'), n);
    this.cabine = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.6, 2), mat('#ffffff'), n);
    this.chassi = new THREE.InstancedMesh(new THREE.BoxGeometry(1.95, 0.5, 3.1), mat('#26262e'), n);
    this.carros.forEach((c, i) => {
      this.corpoMesh.setColorAt(i, c.cor);
      this.cabine.setColorAt(i, _c.copy(c.cor).lerp(new THREE.Color('#bfe9ff'), 0.55));
    });
    for (const m of [this.corpoMesh, this.cabine, this.chassi]) {
      m.castShadow = true;
      m.frustumCulled = false;
      cena.add(m);
    }
  }

  setIntenso(v: boolean) {
    this.intenso = v;
  }

  private ativo(c: Carro) {
    return !c.extra || this.intenso;
  }

  private posicao(c: Carro, t: number) {
    const a = ANEIS[c.anel];
    const H = a.R - a.d;
    const P = pontoNoAnel(H, 0, this.pose);
    const s = c.fase + a.v * t;
    pontoNoAnel(H, a.inverso ? P - (((s % P) + P) % P) : s, this.pose);
    if (a.inverso) this.pose.yaw += Math.PI; // anda no sentido contrário
    return this.pose;
  }

  /** A cada passo de física: move os corpos cinemáticos. */
  passoFisico() {
    const t = this.relogio();
    for (const c of this.carros) {
      if (!this.ativo(c)) {
        c.corpo.setNextKinematicTranslation({ x: 0, y: -50, z: 0 });
        continue;
      }
      const p = this.posicao(c, t);
      c.corpo.setNextKinematicTranslation({ x: p.x, y: 0.95, z: p.z });
      _q.setFromAxisAngle(Y, p.yaw);
      c.corpo.setNextKinematicRotation(_q);
    }
  }

  atualizarVisual() {
    const t = this.relogio();
    this.carros.forEach((c, i) => {
      if (!this.ativo(c)) {
        this.corpoMesh.setMatrixAt(i, OCULTO);
        this.cabine.setMatrixAt(i, OCULTO);
        this.chassi.setMatrixAt(i, OCULTO);
        return;
      }
      const p = this.posicao(c, t);
      _q.setFromAxisAngle(Y, p.yaw);
      _s.set(1, 1, 1);
      const m = (dx: number, y: number, dz: number, mesh: THREE.InstancedMesh) => {
        // deslocamento local (dz = frente) rodado pelo rumo
        const sx = Math.sin(p.yaw);
        const cz = Math.cos(p.yaw);
        mesh.setMatrixAt(i, _m.compose(_p.set(p.x + sx * dz + cz * dx, y, p.z + cz * dz - sx * dx), _q, _s));
      };
      m(0, 0.85, 0, this.corpoMesh);
      m(0, 1.45, -0.2, this.cabine);
      m(0, 0.35, 0, this.chassi);
    });
    for (const m of [this.corpoMesh, this.cabine, this.chassi]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Posições atuais (para o minimapa). */
  posicoes(): { x: number; z: number }[] {
    const t = this.relogio();
    const r: { x: number; z: number }[] = [];
    for (const c of this.carros) if (this.ativo(c)) {
      const p = this.posicao(c, t);
      r.push({ x: p.x, z: p.z });
    }
    return r;
  }
}
