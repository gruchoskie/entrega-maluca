// Eventos de caos decididos pelo servidor: chuva, trânsito intenso, obras, buraco gigante e vento.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { LARG_RUA } from '../../../shared/cidade';
import type { EventoCaos } from '../../../shared/protocolo';
import type { Fisica } from '../fisica/fisica';
import type { Veiculo } from '../veiculo/veiculo';
import type { Mundo } from './mundo';
import type { Transito } from './transito';

/** Riscos rápidos em volta da câmera (chuva caindo / vento soprando). */
class Linhas {
  readonly obj: THREE.LineSegments;
  private pos: Float32Array;
  private base: Float32Array; // posição local de cada risco
  private vel = new THREE.Vector3();

  constructor(private n: number, private caixa: number, private tamanho: number, cor: string, opac: number) {
    this.pos = new Float32Array(n * 6);
    this.base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.base[i * 3] = (Math.random() - 0.5) * caixa * 2;
      this.base[i * 3 + 1] = Math.random() * caixa;
      this.base[i * 3 + 2] = (Math.random() - 0.5) * caixa * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: opac, fog: false }));
    this.obj.frustumCulled = false;
    this.obj.visible = false;
  }

  definirVelocidade(v: THREE.Vector3) {
    this.vel.copy(v);
  }

  atualizar(dt: number, centro: THREE.Vector3) {
    const c = this.caixa;
    for (let i = 0; i < this.n; i++) {
      const b = this.base;
      b[i * 3] += this.vel.x * dt;
      b[i * 3 + 1] += this.vel.y * dt;
      b[i * 3 + 2] += this.vel.z * dt;
      // dá a volta dentro da caixa
      if (b[i * 3] > c) b[i * 3] -= 2 * c; else if (b[i * 3] < -c) b[i * 3] += 2 * c;
      if (b[i * 3 + 1] < 0) b[i * 3 + 1] += c; else if (b[i * 3 + 1] > c) b[i * 3 + 1] -= c;
      if (b[i * 3 + 2] > c) b[i * 3 + 2] -= 2 * c; else if (b[i * 3 + 2] < -c) b[i * 3 + 2] += 2 * c;
      const x = centro.x + b[i * 3];
      const y = b[i * 3 + 1];
      const z = centro.z + b[i * 3 + 2];
      const k = i * 6;
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      const l = this.tamanho / (this.vel.length() || 1);
      this.pos[k + 3] = x - this.vel.x * l;
      this.pos[k + 4] = y - this.vel.y * l;
      this.pos[k + 5] = z - this.vel.z * l;
    }
    (this.obj.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Caos {
  atual: EventoCaos | null = null;
  private chuva = new Linhas(450, 32, 1.3, '#cfe6ff', 0.55);
  private vento = new Linhas(90, 40, 3.2, '#ffffff', 0.5);
  private extras: { obj: THREE.Object3D; corpo?: RAPIER.RigidBody }[] = [];
  private intensidade = 0; // 0..1: transição suave da chuva
  private cooldownBuraco = 0;
  private corNevoa = new THREE.Color('#cfeeff');
  private corChuva = new THREE.Color('#8f9fb4');

  constructor(
    private fis: Fisica,
    private mundo: Mundo,
    private transito: Transito,
  ) {
    mundo.cena.add(this.chuva.obj, this.vento.obj);
    this.chuva.definirVelocidade(new THREE.Vector3(2, -34, 1));
  }

  /** Chamado a cada atualização do servidor. */
  aplicar(ev: EventoCaos | null, veiculo: Veiculo | null) {
    if ((ev?.id ?? 0) === (this.atual?.id ?? 0)) return;
    this.encerrar(veiculo);
    this.atual = ev;
    if (!ev) return;
    switch (ev.tipo) {
      case 'chuva':
        this.chuva.obj.visible = true;
        break;
      case 'transito':
        this.transito.setIntenso(true);
        break;
      case 'obras':
        this.criarObras(ev);
        break;
      case 'buraco':
        this.criarBuraco(ev);
        break;
      case 'vento':
        this.vento.obj.visible = true;
        this.vento.definirVelocidade(new THREE.Vector3(Math.sin(ev.ang) * 38, -1, Math.cos(ev.ang) * 38));
        break;
    }
  }

  private encerrar(veiculo: Veiculo | null) {
    this.chuva.obj.visible = false;
    this.vento.obj.visible = false;
    this.transito.setIntenso(false);
    if (veiculo) {
      veiculo.aderenciaMult = 1;
      veiculo.vento.set(0, 0, 0);
    }
    for (const e of this.extras) {
      this.mundo.cena.remove(e.obj);
      if (e.corpo) this.fis.mundo.removeRigidBody(e.corpo);
    }
    this.extras = [];
  }

  /** Barricadas atravessando 2/3 da rua (sobra uma brecha para passar). */
  private criarObras(ev: EventoCaos) {
    const { R, mundo } = this.fis;
    const cross = new THREE.Vector3(Math.cos(ev.ang), 0, -Math.sin(ev.ang));
    for (const off of [-4.6, -1.8, 1.0]) {
      const g = new THREE.Group();
      const faixa = (c: string, x: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: c }));
        m.position.set(x, 0.9, 0);
        g.add(m);
      };
      for (let i = 0; i < 4; i++) faixa(i % 2 ? '#ffffff' : '#ff7a2b', -1.05 + i * 0.7);
      for (const x of [-1.2, 1.2]) {
        const perna = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), new THREE.MeshLambertMaterial({ color: '#555' }));
        perna.position.set(x, 0.45, 0);
        g.add(perna);
      }
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      const x = ev.x + cross.x * off;
      const z = ev.z + cross.z * off;
      g.position.set(x, 0, z);
      g.rotation.y = ev.ang;
      this.mundo.cena.add(g);
      const corpo = mundo.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(x, 0.7, z).setRotation({ x: 0, y: Math.sin(ev.ang / 2), z: 0, w: Math.cos(ev.ang / 2) }),
      );
      mundo.createCollider(R.ColliderDesc.cuboid(1.4, 0.7, 0.3).setRestitution(0.3), corpo);
      this.extras.push({ obj: g, corpo });
    }
    // cones de aviso nas pontas
    for (const off of [-LARG_RUA / 2 + 0.5, 3.4]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 6), new THREE.MeshLambertMaterial({ color: '#ff7a2b' }));
      c.position.set(ev.x + cross.x * off, 0.5, ev.z + cross.z * off);
      this.mundo.cena.add(c);
      this.extras.push({ obj: c });
    }
  }

  private criarBuraco(ev: EventoCaos) {
    const g = new THREE.Group();
    const disco = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.08, 28), new THREE.MeshBasicMaterial({ color: '#15151c' }));
    disco.position.y = 0.09;
    const borda = new THREE.Mesh(new THREE.RingGeometry(6, 7, 28), new THREE.MeshLambertMaterial({ color: '#6b4a2f', side: THREE.DoubleSide }));
    borda.rotation.x = -Math.PI / 2;
    borda.position.y = 0.1;
    g.add(disco, borda);
    g.position.set(ev.x, 0, ev.z);
    this.mundo.cena.add(g);
    this.extras.push({ obj: g });
  }

  /** A cada quadro: efeitos contínuos (aderência, vento, buraco, clima). */
  atualizar(dt: number, veiculo: Veiculo | null, camPos: THREE.Vector3) {
    const ev = this.atual;
    const alvo = ev?.tipo === 'chuva' ? 1 : 0;
    this.intensidade += (alvo - this.intensidade) * (1 - Math.exp(-2 * dt));
    // Chuva escurece e fecha a névoa
    const f = this.intensidade;
    this.mundo.sol.intensity = 2.0 - 1.0 * f;
    this.mundo.hemi.intensity = 1.15 - 0.3 * f;
    const nevoa = this.mundo.cena.fog as THREE.Fog;
    nevoa.color.copy(this.corNevoa).lerp(this.corChuva, f);
    nevoa.far = 300 - 140 * f;
    if (this.chuva.obj.visible) this.chuva.atualizar(dt, camPos);
    if (this.vento.obj.visible) this.vento.atualizar(dt, camPos);

    if (!veiculo || !ev) return;
    if (ev.tipo === 'chuva') veiculo.aderenciaMult = 0.55;
    else if (ev.tipo === 'vento') veiculo.vento.set(Math.sin(ev.ang) * 4.5, 0, Math.cos(ev.ang) * 4.5);
    else if (ev.tipo === 'buraco') {
      this.cooldownBuraco -= dt;
      const p = veiculo.objeto.position;
      if (this.cooldownBuraco <= 0 && veiculo.noChao && Math.hypot(p.x - ev.x, p.z - ev.z) < 6) {
        this.cooldownBuraco = 1.2;
        veiculo.solavanco();
      }
    }
  }
}
