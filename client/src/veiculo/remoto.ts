// Outro jogador: recebe posições pela rede e mostra com interpolação suave.
// Como veículo, também tem um corpo cinemático no Rapier (os veículos se empurram).
// No modo "mesmo carro" o entregador aparece a pé (forma "pedestre", sem corpo físico).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { JogadorInfo } from '../../../shared/protocolo';
import { Motor } from '../audio/audio';
import type { Fisica } from '../fisica/fisica';
import { CONFIGS, animarPedestre, criarModelo, criarPedestre, type ModeloVeiculo } from './modelos';
import { CENTRO_PEDESTRE } from './pedestre';

const ATRASO_MS = 130; // mostra o passado: dá tempo de chegarem 2 pacotes (jitter)

interface Snap {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

export type Forma = 'veiculo' | 'pedestre';

export class VeiculoRemoto {
  readonly grupo = new THREE.Group();
  readonly motor = new Motor();
  readonly carga = new THREE.Group(); // pacotes encaixados (coordenadas do modelo/pés)
  velocidade = 0;
  capotadas = 0;
  aPe = false; // flag vinda do servidor (modo van)
  mostrar = true; // o chamador esconde quem está "dentro da van"
  forma: Forma = 'veiculo';
  private modelo: ModeloVeiculo | null = null;
  private pedestre: THREE.Group | null = null;
  private corpo: RAPIER.RigidBody | null = null;
  private buf: Snap[] = [];
  private pos = new THREE.Vector3();
  private rot = new THREE.Quaternion();
  private temPose = false;
  private fasePe = 0;
  private placa: THREE.Sprite;

  constructor(private fis: Fisica, public info: JogadorInfo, forma: Forma = 'veiculo') {
    this.forma = forma;
    this.placa = criarPlaca(info.nome);
    this.grupo.add(this.placa, this.carga);
    this.grupo.visible = false; // só aparece depois do primeiro pacote
    this.montar();
  }

  private montar() {
    const { R, mundo } = this.fis;
    if (this.corpo) mundo.removeRigidBody(this.corpo);
    this.corpo = null;
    if (this.modelo) this.grupo.remove(this.modelo.raiz);
    if (this.pedestre) this.grupo.remove(this.pedestre);
    this.modelo = null;
    this.pedestre = null;

    if (this.forma === 'pedestre') {
      this.pedestre = criarPedestre(this.info.cor, this.info.chapeu);
      this.pedestre.position.y = -CENTRO_PEDESTRE;
      this.grupo.add(this.pedestre);
      this.carga.position.set(0, -CENTRO_PEDESTRE, 0);
      this.placa.position.y = 1.5;
      return;
    }
    const cfg = CONFIGS[this.info.veic];
    const [hw, hh, hl] = cfg.caixa;
    this.modelo = criarModelo(this.info.veic, this.info.cor, this.info.chapeu);
    this.modelo.raiz.position.y = -(hh + cfg.raioRoda);
    this.grupo.add(this.modelo.raiz);
    this.placa.position.y = hh + 2.4;
    this.carga.position.set(0, -(hh + cfg.raioRoda), 0);
    this.corpo = mundo.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    mundo.createCollider(R.ColliderDesc.cuboid(hw, hh, hl).setFriction(0.2).setRestitution(0.3), this.corpo);
  }

  /** Muda a aparência/forma (recria só o que mudou). */
  atualizarInfo(info: JogadorInfo, forma: Forma = this.forma) {
    const mudou =
      info.veic !== this.info.veic || info.cor !== this.info.cor || info.chapeu !== this.info.chapeu || forma !== this.forma;
    const nomeMudou = info.nome !== this.info.nome;
    this.info = info;
    this.forma = forma;
    if (mudou) this.montar();
    if (nomeMudou) {
      this.grupo.remove(this.placa);
      const y = this.placa.position.y;
      this.placa = criarPlaca(info.nome);
      this.placa.position.y = y;
      this.grupo.add(this.placa);
    }
  }

  /** Chega um estado do servidor: [px,py,pz, qx,qy,qz,qw, vx,vy,vz, capotadas, aPe]. */
  receber(d: number[]) {
    this.buf.push({
      t: performance.now(),
      p: new THREE.Vector3(d[0], d[1], d[2]),
      q: new THREE.Quaternion(d[3], d[4], d[5], d[6]),
    });
    if (this.buf.length > 24) this.buf.shift();
    this.velocidade = Math.hypot(d[7], d[9]);
    this.capotadas = d[10];
    this.aPe = d[11] === 1;
  }

  private calcularPose() {
    const alvo = performance.now() - ATRASO_MS;
    const b = this.buf;
    if (b.length === 0) return;
    if (!this.temPose) {
      this.pos.copy(b[b.length - 1].p);
      this.rot.copy(b[b.length - 1].q);
      this.temPose = true;
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

  /** A cada passo de física: calcula a pose interpolada e move o corpo cinemático (veículos). */
  passoFisico() {
    this.calcularPose();
    if (!this.temPose || !this.corpo) return;
    // Escondido (dentro da van): guarda o corpo longe para não bloquear ninguém
    if (!this.mostrar) this.corpo.setNextKinematicTranslation({ x: 0, y: -50, z: 0 });
    else {
      this.corpo.setNextKinematicTranslation(this.pos);
      this.corpo.setNextKinematicRotation(this.rot);
    }
  }

  atualizarVisual(dt: number) {
    this.grupo.visible = this.temPose && this.mostrar;
    if (!this.temPose) return;
    this.grupo.position.copy(this.pos);
    this.grupo.quaternion.copy(this.rot);
    if (this.modelo) {
      const giro = (this.velocidade * dt) / this.modelo.raioRoda;
      for (const r of this.modelo.rodas) r.rotation.x += giro;
    }
    if (this.pedestre) {
      const rel = Math.min(1, this.velocidade / 6.2);
      this.fasePe += dt * (3 + rel * 9);
      animarPedestre(this.pedestre, this.fasePe, rel, this.pos.y < 1.2);
    }
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
