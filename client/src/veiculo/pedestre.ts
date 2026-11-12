// Entregador a pé (modo "mesmo carro"): corpo de cápsula no Rapier, andar simples e pulinho.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Chapeu } from '../../../shared/protocolo';
import type { Fisica } from '../fisica/fisica';
import type { EstadoControles } from '../interface/controles';
import { criarPedestre } from './modelos';

export const CENTRO_PEDESTRE = 0.65; // altura do centro da cápsula
const VEL = 6.2; // m/s
const Y = new THREE.Vector3(0, 1, 0);

export class Pedestre {
  readonly objeto = new THREE.Group(); // centro da cápsula (interpolado)
  readonly carga = new THREE.Group(); // pacote nas costas (coordenadas dos pés)
  rumo = 0;
  velocidade = 0;
  noChao = false;

  private modelo: THREE.Group;
  private corpo: RAPIER.RigidBody;
  private raio: RAPIER.Ray;
  private posAnt = new THREE.Vector3();
  private posAtu = new THREE.Vector3();
  private bufferPulo = 0;
  private passoAnim = 0;

  constructor(private fis: Fisica, cor: string, chapeu: Chapeu, x: number, z: number, yaw: number) {
    const { R, mundo } = fis;
    this.rumo = yaw;
    this.raio = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.corpo = mundo.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(x, CENTRO_PEDESTRE + 0.3, z).lockRotations().setCcdEnabled(true).setCanSleep(false),
    );
    mundo.createCollider(R.ColliderDesc.capsule(0.3, 0.35).setFriction(0).setRestitution(0).setMass(70), this.corpo);

    this.modelo = criarPedestre(cor, chapeu);
    this.modelo.position.y = -CENTRO_PEDESTRE;
    this.carga.position.y = -CENTRO_PEDESTRE;
    this.objeto.add(this.modelo, this.carga);
    this.posAtu.set(x, CENTRO_PEDESTRE + 0.3, z);
    this.posAnt.copy(this.posAtu);
  }

  pedirPulo() {
    this.bufferPulo = 0.15;
  }

  /** Passo de física (60 Hz): A/D giram, W/S andam (igual ao veículo, para a câmera seguir do mesmo jeito). */
  passo(dt: number, c: EstadoControles) {
    const b = this.corpo;
    const t = b.translation();
    const lv = b.linvel();
    this.raio.origin.x = t.x;
    this.raio.origin.y = t.y;
    this.raio.origin.z = t.z;
    this.noChao = !!this.fis.mundo.castRay(this.raio, CENTRO_PEDESTRE + 0.25, true, undefined, undefined, undefined, b);

    this.rumo -= c.direcao * 2.8 * dt;
    const alvo = c.acelerar >= 0 ? c.acelerar * VEL : c.acelerar * VEL * 0.5;
    const f = 1 - Math.exp(-14 * dt);
    const vx = lv.x + (Math.sin(this.rumo) * alvo - lv.x) * f;
    const vz = lv.z + (Math.cos(this.rumo) * alvo - lv.z) * f;
    let vy = lv.y;
    this.bufferPulo -= dt;
    if (this.bufferPulo > 0 && this.noChao) {
      vy = 7;
      this.bufferPulo = 0;
    }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
    this.velocidade = (vx * Math.sin(this.rumo) + vz * Math.cos(this.rumo));
    if (t.y < -15) b.setTranslation({ x: 0, y: 2, z: -10 }, true);
  }

  depoisDoPasso() {
    const t = this.corpo.translation();
    this.posAnt.copy(this.posAtu);
    this.posAtu.set(t.x, t.y, t.z);
  }

  atualizarVisual(dt: number, alfa: number) {
    this.objeto.position.lerpVectors(this.posAnt, this.posAtu, alfa);
    this.objeto.rotation.y = this.rumo;
    // Balançadinha ao andar
    const rel = Math.min(1, Math.abs(this.velocidade) / VEL);
    this.passoAnim += dt * (4 + rel * 8);
    this.modelo.position.y = -CENTRO_PEDESTRE + Math.abs(Math.sin(this.passoAnim)) * 0.09 * rel;
    this.modelo.rotation.x = rel * 0.08;
    this.modelo.rotation.z = Math.sin(this.passoAnim) * 0.05 * rel;
  }

  snapshot() {
    const t = this.corpo.translation();
    const v = this.corpo.linvel();
    const q = new THREE.Quaternion().setFromAxisAngle(Y, this.rumo);
    return { p: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z] };
  }

  destruir() {
    this.fis.mundo.removeRigidBody(this.corpo);
    this.objeto.parent?.remove(this.objeto);
  }
}
