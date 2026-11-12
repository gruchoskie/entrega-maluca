// Partículas leves (um único Points com shader): poeira de derrapagem, faíscas de batida, confete de entrega.
import * as THREE from 'three';

const MAX = 600;

export class Particulas {
  readonly obj: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private cor = new Float32Array(MAX * 3);
  private tam = new Float32Array(MAX);
  private alfa = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private vida = new Float32Array(MAX); // tempo restante
  private vidaMax = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private cresce = new Float32Array(MAX);
  private tam0 = new Float32Array(MAX);
  private proximo = 0;
  private escala = { value: 800 };
  private _c = new THREE.Color();
  /** 1 = tudo; 0.5 = metade (qualidade média); 0 = desligado. */
  densidade = 1;

  constructor(cena: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('cor', new THREE.BufferAttribute(this.cor, 3));
    g.setAttribute('tam', new THREE.BufferAttribute(this.tam, 1));
    g.setAttribute('alfa', new THREE.BufferAttribute(this.alfa, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { escala: this.escala },
      vertexShader: `
        attribute vec3 cor; attribute float tam; attribute float alfa;
        varying vec3 vC; varying float vA; uniform float escala;
        void main() {
          vC = cor; vA = alfa;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = tam * escala / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          if (r > 0.5) discard;
          gl_FragColor = vec4(vC, smoothstep(0.5, 0.15, r) * vA);
        }`,
    });
    this.obj = new THREE.Points(g, mat);
    this.obj.frustumCulled = false;
    this.obj.renderOrder = 5;
    cena.add(this.obj);
  }

  /** Chamar ao redimensionar: converte tamanho em metros para pixels. */
  redimensionar(alturaPx: number, fovGraus: number) {
    this.escala.value = (alturaPx * 0.5) / Math.tan((fovGraus * Math.PI) / 360);
  }

  private emitir(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    c: THREE.Color, tam: number, vida: number, grav: number, cresce: number,
  ) {
    const i = this.proximo;
    this.proximo = (this.proximo + 1) % MAX;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.cor.set([c.r, c.g, c.b], i * 3);
    this.tam0[i] = this.tam[i] = tam;
    this.vida[i] = this.vidaMax[i] = vida;
    this.grav[i] = grav;
    this.cresce[i] = cresce;
    this.alfa[i] = 1;
  }

  /** Nuvenzinha de poeira/fumaça. */
  fumaca(x: number, y: number, z: number, cor = '#e8e2d6') {
    if (Math.random() > this.densidade) return;
    this._c.set(cor);
    this.emitir(x, y + 0.2, z, (Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2, this._c, 0.9, 0.7, -0.5, 1.6);
  }

  faiscas(x: number, y: number, z: number, n = 12) {
    n = Math.ceil(n * this.densidade);
    for (let k = 0; k < n; k++) {
      this._c.set(Math.random() < 0.5 ? '#ffe14d' : '#ffffff');
      const a = Math.random() * Math.PI * 2;
      const v = 3 + Math.random() * 6;
      this.emitir(x, y, z, Math.cos(a) * v, 2 + Math.random() * 5, Math.sin(a) * v, this._c, 0.28, 0.45, 18, 0);
    }
  }

  confete(x: number, y: number, z: number, n = 45) {
    const cores = ['#ff5a5f', '#ffe14d', '#4cd964', '#4a7bff', '#b061ff', '#ff7ac8'];
    n = Math.ceil(n * Math.max(0.4, this.densidade));
    for (let k = 0; k < n; k++) {
      this._c.set(cores[k % cores.length]);
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 5;
      this.emitir(x, y, z, Math.cos(a) * v, 7 + Math.random() * 6, Math.sin(a) * v, this._c, 0.35, 1.5, 14, 0);
    }
  }

  atualizar(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.vida[i] <= 0) {
        this.alfa[i] = 0;
        continue;
      }
      this.vida[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] = Math.max(0.05, this.pos[k + 1] + this.vel[k + 1] * dt);
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.vida[i] / this.vidaMax[i]);
      this.alfa[i] = Math.min(1, f * 1.6) * (this.cresce[i] > 0 ? 0.55 : 1);
      this.tam[i] = this.tam0[i] * (1 + (1 - f) * this.cresce[i]);
    }
    const a = this.obj.geometry.attributes;
    (a.position as THREE.BufferAttribute).needsUpdate = true;
    (a.cor as THREE.BufferAttribute).needsUpdate = true;
    (a.tam as THREE.BufferAttribute).needsUpdate = true;
    (a.alfa as THREE.BufferAttribute).needsUpdate = true;
  }
}
