// Veículo de outro jogador: recebe posições pela rede e mostra com interpolação suave.
// Também tem um corpo cinemático no Rapier, então os veículos se empurram.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { JogadorInfo } from '../../../shared/protocolo';
import { Motor } from '../audio/audio';
import type { Fisica } from '../fisica/fisica';
import { CONFIGS, criarModelo, type ModeloVeiculo } from './modelos';

const ATRASO_MS = 130; // mostra o passado: dá tempo de chegarem 2 pacotes (jitter)

interface Snap {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

export class VeiculoRemoto {
  readonly grupo = new THREE.Group();
  readonly motor = new Motor();
  readonly carga = new THREE.Group(); // pacotes encaixados (coordenadas do modelo)
  velocidade = 0;
  capotadas = 0;
  private modelo!: ModeloVeiculo;
  private corpo: RAPIER.RigidBody | null = null;
  private buf: Snap[] = [];
  private pos = new THREE.Vector3();
  private rot = new THREE.Quaternion();
  private temPose = false;
  private placa: THREE.Sprite;

  constructor(private fis: Fisica, public info: JogadorInfo) {
    this.placa = criarPlaca(info.nome);
    this.grupo.add(this.placa);
    this.grupo.visible = false; // só aparece depois do primeiro pacote
    this.montar();
  }

  private montar() {
    const { R, mundo } = this.fis;
    if (this.corpo) mundo.removeRigidBody(this.corpo);
    if (this.modelo) this.grupo.remove(this.modelo.raiz);
    const cfg = CONFIGS[this.info.veic];
    const [hw, hh, hl] = cfg.caixa;
    this.modelo = criarModelo(this.info.veic, this.info.cor, this.info.chapeu);
    this.modelo.raiz.position.y = -(hh + cfg.raioRoda);
    this.grupo.add(this.modelo.raiz);
    this.placa.position.y = hh + 2.4;
    this.carga.position.set(0, -(hh + cfg.raioRoda), 0);
    this.grupo.add(this.carga);
    this.corpo = mundo.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    mundo.createCollider(R.ColliderDesc.cuboid(hw, hh, hl).setFriction(0.2).setRestitution(0.3), this.corpo);
  }

  atualizarInfo(info: JogadorInfo) {
    const mudou = info.veic !== this.info.veic || info.cor !== this.info.cor || info.chapeu !== this.info.chapeu;
    const nomeMudou = info.nome !== this.info.nome;
    this.info = info;
    if (mudou) this.montar();
    if (nomeMudou) {
      this.grupo.remove(this.placa);
      this.placa = criarPlaca(info.nome);
      this.grupo.add(this.placa);
      this.placa.position.y = CONFIGS[info.veic].caixa[1] + 2.4;
    }
  }

  /** Chega um estado do servidor: [px,py,pz, qx,qy,qz,qw, vx,vy,vz, capotadas]. */
  receber(d: number[]) {
    this.buf.push({
      t: performance.now(),
      p: new THREE.Vector3(d[0], d[1], d[2]),
      q: new THREE.Quaternion(d[3], d[4], d[5], d[6]),
    });
    if (this.buf.length > 24) this.buf.shift();
    this.velocidade = Math.hypot(d[7], d[9]);
    this.capotadas = d[10];
  }

  private calcularPose() {
    const alvo = performance.now() - ATRASO_MS;
    const b = this.buf;
    if (b.length === 0) return;
    if (!this.temPose) {
      this.pos.copy(b[b.length - 1].p);
      this.rot.copy(b[b.length - 1].q);
      this.temPose = true;
      this.grupo.visible = true;
    }
    if (alvo <= b[0].t) {
      this.pos.copy(b[0].p);
      this.rot.copy(b[0].q);
    } else if (alvo >= b[b.length - 1].t) {
      this.pos.copy(b[b.length - 1].p);
      this.rot.copy(b[b.length - 1].q);
    } else {
      let i = 0;
      while (i < b.length - 2 && b[i + 1].t < alvo) i++;
      const f = (alvo - b[i].t) / (b[i + 1].t - b[i].t);
      this.pos.lerpVectors(b[i].p, b[i + 1].p, f);
      this.rot.slerpQuaternions(b[i].q, b[i + 1].q, f);
    }
  }

  /** A cada passo de física: move o corpo cinemático até a pose interpolada. */
  passoFisico() {
    if (!this.temPose || !this.corpo) return;
    this.calcularPose();
    this.corpo.setNextKinematicTranslation(this.pos);
    this.corpo.setNextKinematicRotation(this.rot);
  }

  atualizarVisual(dt: number) {
    if (!this.temPose) return;
    this.grupo.position.copy(this.pos);
    this.grupo.quaternion.copy(this.rot);
    const giro = (this.velocidade * dt) / this.modelo.raioRoda;
    for (const r of this.modelo.rodas) r.rotation.x += giro;
  }

  destruir() {
    if (this.corpo) this.fis.mundo.removeRigidBody(this.corpo);
    this.corpo = null;
    this.motor.parar();
    this.grupo.parent?.remove(this.grupo);
  }
}

/** Placa com o apelido, sempre virada para a câmera. */
function criarPlaca(nome: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 34px "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(20,20,50,.85)';
  g.strokeText(nome, 128, 34);
  g.fillStyle = '#fff';
  g.fillText(nome, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 10;
  return s;
}
