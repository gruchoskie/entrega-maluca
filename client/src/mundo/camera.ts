// Câmera de terceira pessoa: segue atrás do veículo; arrastar orbita e depois ela volta sozinha.
import * as THREE from 'three';
import type { EstadoControles } from '../interface/controles';

export class CameraSeguidora {
  readonly camera: THREE.PerspectiveCamera;
  private giroExtra = 0; // órbita manual em relação ao rumo do veículo
  private altura = 0.42; // ângulo de elevação (rad)
  private semMexer = 99; // segundos desde o último arrasto
  private rumoSuave = 0;
  private foco = new THREE.Vector3();
  private iniciada = false;
  private tremor = 0; // 0..1, decai sozinho

  /** Tremor de câmera nas batidas (amplitude 0..1). */
  tremer(a: number) {
    this.tremor = Math.max(this.tremor, Math.min(1, a));
  }

  constructor(aspecto: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspecto, 0.3, 400);
  }

  atualizar(dt: number, alvo: THREE.Vector3, rumo: number, velocidade: number, c: EstadoControles) {
    // Órbita manual
    if (c.camDX !== 0 || c.camDY !== 0) {
      this.giroExtra -= c.camDX * 0.006;
      this.altura = THREE.MathUtils.clamp(this.altura + c.camDY * 0.004, 0.12, 1.2);
      this.semMexer = 0;
    } else {
      this.semMexer += dt;
    }
    // Depois de 1,5 s sem mexer, volta para trás do veículo
    if (this.semMexer > 1.5) this.giroExtra *= Math.exp(-3 * dt);

    // Rumo suavizado (pelo caminho angular mais curto)
    if (!this.iniciada) {
      this.rumoSuave = rumo;
      this.foco.copy(alvo);
      this.iniciada = true;
    }
    const dif = Math.atan2(Math.sin(rumo - this.rumoSuave), Math.cos(rumo - this.rumoSuave));
    this.rumoSuave += dif * (1 - Math.exp(-4 * dt));
    this.foco.lerp(alvo, 1 - Math.exp(-10 * dt));

    // Afasta um pouco e abre o campo de visão com a velocidade
    const v = Math.min(1, Math.abs(velocidade) / 22);
    const dist = 7.5 + v * 2.5;
    const ang = this.rumoSuave + this.giroExtra;
    const horiz = Math.cos(this.altura) * dist;
    this.camera.position.set(
      this.foco.x - Math.sin(ang) * horiz,
      Math.max(0.8, this.foco.y + 0.6 + Math.sin(this.altura) * dist),
      this.foco.z - Math.cos(ang) * horiz,
    );
    if (this.tremor > 0.01) {
      const a = this.tremor * 0.45;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
      this.tremor *= Math.exp(-7 * dt);
    }
    this.camera.lookAt(this.foco.x, this.foco.y + 0.7, this.foco.z);

    const fov = 62 + v * 10;
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  redimensionar(aspecto: number) {
    this.camera.aspect = aspecto;
    this.camera.updateProjectionMatrix();
  }
}
