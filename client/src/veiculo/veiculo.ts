// Veículo do jogador como corpo rígido do Rapier com física ARCADE:
//  - suspensão por 4 raios (molas): dá o balanço "gelatina", sobe rampas e quica;
//  - motor, aderência lateral e giro aplicados direto na velocidade (previsível e divertido);
//  - "assistente de endireitar": ajuda a voltar para as rodas depois de uma batida;
//  - capotou de vez? Depois de ~1,2 s o veículo é desvirado com um pulinho.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Chapeu } from '../../../shared/protocolo';
import { GRAVIDADE, type Fisica } from '../fisica/fisica';
import type { EstadoControles } from '../interface/controles';
import { CONFIGS, criarModelo, type ConfigVeiculo, type ModeloVeiculo, type TipoVeiculo } from './modelos';

const CURSO_MOLA = 0.35; // m de compressão da mola com o veículo parado
const PONTOS: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]]; // cantos (x, z)
const ESPERA_DESVIRAR = 1.2; // s virado até desvirar sozinho

// Temporários reutilizados (evita lixo para o coletor de memória)
const Q = new THREE.Quaternion();
const UP = new THREE.Vector3();
const FRENTE = new THREE.Vector3();
const LADO = new THREE.Vector3();
const P = new THREE.Vector3();
const W = new THREE.Vector3();
const E = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export class Veiculo {
  readonly objeto = new THREE.Group(); // centro do corpo rígido (interpolado)
  private visual = new THREE.Group(); // inclinações "gelatina" só visuais
  private modelo!: ModeloVeiculo;
  private cfg!: ConfigVeiculo;
  private corpo!: RAPIER.RigidBody;
  private raio: RAPIER.Ray;

  tipo: TipoVeiculo;
  velocidade = 0; // m/s ao longo da frente (negativa = ré)
  rumo = 0; // rad em torno de Y
  noChao = false;
  derrapagem = 0; // velocidade lateral (m/s): alimenta poeira e som
  capotadas = 0; // estatística: "quem mais capotou"
  aderenciaMult = 1; // chuva etc. reduzem isso
  multVel = 1; // carga pesada reduz; upgrade de velocidade aumenta
  multAcel = 1;
  estabilidade = 0; // nível do upgrade (0..3)
  vento = new THREE.Vector3(); // força do vento (m/s²) vinda dos eventos de caos
  /** Batida forte (g = variação brusca de velocidade em m/s). */
  aoImpacto: ((g: number) => void) | null = null;
  /** Curvas/freadas bruscas (para o pacote líquido derramar). */
  aoBalanco: ((v: number) => void) | null = null;
  readonly carga = new THREE.Group(); // onde os pacotes são encaixados (coordenadas do modelo)
  private lvPrev = new THREE.Vector3();
  private cmd = new THREE.Vector3(); // variação de velocidade que EU comandei no passo
  private temLvPrev = false;
  private impCool = 0;
  private balAcc = 0;
  private balT = 0;

  // Interpolação entre passos de física
  private posAnt = new THREE.Vector3();
  private posAtu = new THREE.Vector3();
  private rotAnt = new THREE.Quaternion();
  private rotAtu = new THREE.Quaternion();

  // Estado do passo
  private bufferPulo = 0;
  private virado = 0;
  private contouCapotada = false;
  private tinhaChao = false;
  private velYAnt = 0;
  private velFrenteAnt = 0;
  private acelPasso = 0;

  // Molas visuais (ângulo + velocidade angular)
  private rolagem = 0;
  private velRolagem = 0;
  private arfagem = 0;
  private velArfagem = 0;
  private achatamento = 0;
  private acelLong = 0;
  private ultimaDirecao = 0;

  constructor(
    private fis: Fisica,
    tipo: TipoVeiculo,
    private cor: string,
    x = 0,
    z = 0,
    yaw = 0,
    private chapeu: Chapeu = 'nenhum',
  ) {
    this.tipo = tipo;
    this.raio = new fis.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.objeto.add(this.visual);
    this.montar(tipo, x, 0, z, yaw);
  }

  /** Muda cor/chapéu mantendo posição (recria só o modelo e o corpo). */
  definirAparencia(cor: string, chapeu: Chapeu) {
    if (cor === this.cor && chapeu === this.chapeu) return;
    this.cor = cor;
    this.chapeu = chapeu;
    const p = this.corpo.translation();
    this.montar(this.tipo, p.x, 0.3, p.z, this.rumo);
  }

  /** Remove o veículo do mundo (corpo físico e malhas). */
  destruir() {
    this.fis.mundo.removeRigidBody(this.corpo);
    this.objeto.parent?.remove(this.objeto);
  }

  /** Pose física atual (para enviar pela rede). */
  snapshot() {
    const t = this.corpo.translation();
    const r = this.corpo.rotation();
    const v = this.corpo.linvel();
    return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w], v: [v.x, v.y, v.z] };
  }

  get config() {
    return this.cfg;
  }

  get massa() {
    return this.corpo.mass();
  }

  /** (Re)cria modelo 3D e corpo rígido. */
  private montar(tipo: TipoVeiculo, x: number, yExtra: number, z: number, yaw: number) {
    const { R, mundo } = this.fis;
    if (this.corpo) mundo.removeRigidBody(this.corpo);
    if (this.modelo) this.visual.remove(this.modelo.raiz);

    this.tipo = tipo;
    const cfg = (this.cfg = CONFIGS[tipo]);
    this.modelo = criarModelo(tipo, this.cor, this.chapeu);
    const [hw, hh, hl] = cfg.caixa;
    // Origem do modelo = chão; o corpo fica a (altura da caixa + raio da roda) acima do chão
    this.modelo.raiz.position.y = -(hh + cfg.raioRoda);
    this.visual.add(this.modelo.raiz);

    const q = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, hh + cfg.raioRoda + yExtra, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.05)
      .setAngularDamping(1.2)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.corpo = mundo.createRigidBody(desc);
    mundo.createCollider(
      R.ColliderDesc.cuboid(hw, hh, hl).setMass(cfg.massa).setFriction(0.2).setRestitution(0.3),
      this.corpo,
    );
    this.temLvPrev = false;
    this.carga.position.set(0, -(hh + cfg.raioRoda), 0);
    this.visual.add(this.carga);
    this.posAtu.set(x, hh + cfg.raioRoda + yExtra, z);
    this.rotAtu.copy(q);
    this.posAnt.copy(this.posAtu);
    this.rotAnt.copy(q);
    this.rumo = yaw;
  }

  trocarTipo(tipo: TipoVeiculo) {
    if (tipo === this.tipo) return;
    const p = this.corpo.translation();
    this.montar(tipo, p.x, 1, p.z, this.rumo);
  }

  /** Buraco gigante: o veículo dá um tranco para cima, perde velocidade e sai girando. */
  solavanco() {
    const b = this.corpo;
    const lv = b.linvel();
    b.applyImpulse({ x: 0, y: b.mass() * 6.5, z: 0 }, true);
    b.setLinvel({ x: lv.x * 0.55, y: lv.y, z: lv.z * 0.55 }, true);
    b.setAngvel({ x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 5 }, true);
  }

  /** Pedido de pulo (guardado por 0,15 s: perdoa apertar um pouco antes de tocar o chão). */
  pedirPulo() {
    this.bufferPulo = 0.15;
  }

  /** Volta o veículo para um ponto, em pé. */
  reposicionar(x: number, z: number, yaw = 0) {
    this.montar(this.tipo, x, 0.5, z, yaw);
  }

  // ---------------------------------------------------------------------------
  // Passo de física (60 Hz)
  // ---------------------------------------------------------------------------
  passo(dt: number, c: EstadoControles) {
    const b = this.corpo;
    const cfg = this.cfg;
    const r = b.rotation();
    Q.set(r.x, r.y, r.z, r.w);
    UP.set(0, 1, 0).applyQuaternion(Q);
    FRENTE.set(0, 0, 1).applyQuaternion(Q);
    LADO.set(1, 0, 0).applyQuaternion(Q);
    const t = b.translation();
    const lv = b.linvel();
    const av = b.angvel();
    const m = b.mass();
    const [hw, hh, hl] = cfg.caixa;
    this.ultimaDirecao = c.direcao;
    const velMax = cfg.velMax * this.multVel;
    const aceleracao = cfg.aceleracao * this.multAcel;

    // ---------- Detecta batidas: velocidade real − (anterior + o que eu mesmo comandei + gravidade) ----------
    this.impCool -= dt;
    if (this.temLvPrev) {
      const g = Math.hypot(
        lv.x - (this.lvPrev.x + this.cmd.x),
        lv.y - (this.lvPrev.y + this.cmd.y - GRAVIDADE * dt),
        lv.z - (this.lvPrev.z + this.cmd.z),
      );
      if (g > 2.8 && this.impCool <= 0) {
        this.impCool = 0.15;
        this.aoImpacto?.(g);
      }
    }
    this.lvPrev.set(lv.x, lv.y, lv.z);
    this.cmd.set(0, 0, 0);
    this.temLvPrev = true;
    if (this.vento.lengthSq() > 0) b.applyImpulse({ x: this.vento.x * m * dt, y: 0, z: this.vento.z * m * dt }, true);

    // ---------- Suspensão: 4 molas com amortecimento ----------
    const comprimento = cfg.raioRoda + CURSO_MOLA; // alcance máximo do raio
    const rigidez = (m * GRAVIDADE) / 4 / CURSO_MOLA;
    const amort = 2 * (cfg.zeta + 0.06 * this.estabilidade) * Math.sqrt((rigidez * m) / 4);
    let nChao = 0;
    this.raio.dir.x = -UP.x;
    this.raio.dir.y = -UP.y;
    this.raio.dir.z = -UP.z;
    for (const [sx, sz] of PONTOS) {
      P.set(sx * hw * 0.85, -hh, sz * hl * 0.8).applyQuaternion(Q);
      const ox = t.x + P.x;
      const oy = t.y + P.y;
      const oz = t.z + P.z;
      this.raio.origin.x = ox;
      this.raio.origin.y = oy;
      this.raio.origin.z = oz;
      const acerto = this.fis.mundo.castRay(this.raio, comprimento, true, undefined, undefined, undefined, b);
      if (!acerto) continue;
      nChao++;
      // Velocidade do ponto = v + ω × r
      const vpx = lv.x + (av.y * P.z - av.z * P.y);
      const vpy = lv.y + (av.z * P.x - av.x * P.z);
      const vpz = lv.z + (av.x * P.y - av.y * P.x);
      const vSobe = vpx * UP.x + vpy * UP.y + vpz * UP.z;
      const forca = Math.max(0, rigidez * (comprimento - acerto.timeOfImpact) - amort * vSobe);
      this.cmd.addScaledVector(UP, (forca * dt) / m);
      b.applyImpulseAtPoint(
        { x: UP.x * forca * dt, y: UP.y * forca * dt, z: UP.z * forca * dt },
        { x: ox, y: oy, z: oz },
        true,
      );
    }
    const fr = nChao / 4; // fração de rodas no chão
    this.noChao = nChao >= 2;

    // ---------- Motor / freio ----------
    const vf = lv.x * FRENTE.x + lv.y * FRENTE.y + lv.z * FRENTE.z;
    const vl = lv.x * LADO.x + lv.y * LADO.y + lv.z * LADO.z;
    const freioDeMao = c.pular;
    let alvo = c.acelerar >= 0 ? c.acelerar * velMax : c.acelerar * velMax * 0.4;
    let taxa = aceleracao;
    if (c.acelerar === 0) taxa *= 0.35; // rolando livre
    else if (alvo * vf < 0) taxa *= 2.2; // inverteu o sentido: freia forte
    if (freioDeMao) {
      alvo = 0;
      taxa = aceleracao * 0.9;
    }
    const dv = THREE.MathUtils.clamp(alvo - vf, -taxa * dt, taxa * dt);
    this.cmd.addScaledVector(FRENTE, dv * fr);
    const impMotor = m * dv * fr;
    b.applyImpulse({ x: FRENTE.x * impMotor, y: FRENTE.y * impMotor, z: FRENTE.z * impMotor }, true);

    // ---------- Aderência lateral (menor com freio de mão ou chuva = derrapa) ----------
    const aderencia = (freioDeMao ? 0.12 : 1) * cfg.aderencia * this.aderenciaMult * (1 + 0.07 * this.estabilidade);
    const fator = 1 - Math.exp(-14 * aderencia * dt);
    this.cmd.addScaledVector(LADO, -vl * fator * fr);
    const impLado = -m * vl * fator * fr;
    b.applyImpulse({ x: LADO.x * impLado, y: LADO.y * impLado, z: LADO.z * impLado }, true);

    this.derrapagem = fr > 0.4 ? Math.abs(vl) : 0;
    if (freioDeMao && fr > 0.4 && Math.abs(vf) > 5) this.derrapagem = Math.max(this.derrapagem, 6);

    // ---------- Pulo ----------
    this.bufferPulo -= dt;
    if (this.bufferPulo > 0 && fr >= 0.5) {
      b.applyImpulse({ x: 0, y: m * cfg.pulo, z: 0 }, true);
      this.cmd.y += cfg.pulo;
      this.bufferPulo = 0;
    }

    // ---------- Giro (velocidade angular em torno do "cima" do veículo) ----------
    W.set(av.x, av.y, av.z);
    const sinal = vf >= 0 ? 1 : -1;
    const fatorBaixa = Math.min(1, Math.abs(vf) / 4); // parado quase não gira
    const velRel = Math.min(1, Math.abs(vf) / velMax);
    const alvoGiro = -c.direcao * cfg.giro * (1 - 0.5 * velRel) * fatorBaixa * sinal * (freioDeMao ? 1.5 : 1);
    const controle = fr > 0 ? fr : 0.15; // no ar quase não controla
    const dGiro = (alvoGiro - W.dot(UP)) * (1 - Math.exp(-10 * dt)) * controle;
    W.addScaledVector(UP, dGiro);

    // ---------- Assistente de endireitar ----------
    // E = cima_do_veículo × cima_do_mundo: eixo que o devolve para a posição normal
    E.crossVectors(UP, Y);
    const k = (UP.y < 0.2 ? 30 : fr > 0.5 ? 14 : 7) * (1 + 0.25 * this.estabilidade);
    W.addScaledVector(E, k * dt);
    const amortRot = 1 - Math.exp(-(fr > 0 ? 3 : 0.4) * dt);
    W.x -= W.x * amortRot;
    W.z -= W.z * amortRot;
    b.setAngvel({ x: W.x, y: W.y, z: W.z }, true);

    // ---------- Capotou? ----------
    if (UP.y < 0.25) {
      this.virado += dt;
      if (!this.contouCapotada && UP.y < 0) {
        this.capotadas++;
        this.contouCapotada = true;
      }
      if (this.virado > ESPERA_DESVIRAR) this.desvirar();
    } else {
      this.virado = 0;
      if (UP.y > 0.7) this.contouCapotada = false;
    }
    if (t.y < -15) this.reposicionar(0, 0); // caiu do mundo: volta ao início

    // Balanço (curva forte / freada brusca) acumulado em janelas de 0,25 s
    const aLat = Math.abs(av.x * UP.x + av.y * UP.y + av.z * UP.z) * Math.abs(vf);
    this.balAcc += (Math.max(0, aLat - 5) + Math.max(0, Math.abs(this.acelPasso) - 9) * 0.6) * dt;
    this.balT += dt;
    if (this.balT >= 0.25) {
      if (this.balAcc > 0) this.aoBalanco?.(this.balAcc / this.balT);
      this.balAcc = this.balT = 0;
    }

    this.acelPasso = (vf - this.velFrenteAnt) / dt;
    this.velocidade = vf;
    this.velFrenteAnt = vf;
  }

  /** Desvira: mantém a direção, endireita e dá um pulinho. */
  private desvirar() {
    const b = this.corpo;
    const lv = b.linvel();
    const t = b.translation();
    const q = new THREE.Quaternion().setFromAxisAngle(Y, this.rumo);
    b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.setTranslation({ x: t.x, y: t.y + 0.8, z: t.z }, true);
    b.setLinvel({ x: lv.x * 0.3, y: 5, z: lv.z * 0.3 }, true);
    this.temLvPrev = false;
    this.virado = 0;
  }

  /** Chamado depois de cada passo: guarda a pose para interpolar. */
  depoisDoPasso() {
    const b = this.corpo;
    const t = b.translation();
    const r = b.rotation();
    this.posAnt.copy(this.posAtu);
    this.rotAnt.copy(this.rotAtu);
    this.posAtu.set(t.x, t.y, t.z);
    this.rotAtu.set(r.x, r.y, r.z, r.w);

    FRENTE.set(0, 0, 1).applyQuaternion(this.rotAtu);
    if (UP.set(0, 1, 0).applyQuaternion(this.rotAtu).y > 0.3) this.rumo = Math.atan2(FRENTE.x, FRENTE.z);

    // Aterrissagem: amassa o veículo conforme a velocidade da queda
    const vy = b.linvel().y;
    if (this.noChao && !this.tinhaChao && this.velYAnt < -4) {
      this.achatamento = Math.min(0.3, -this.velYAnt * 0.025);
      this.velArfagem += 2;
    }
    this.tinhaChao = this.noChao;
    this.velYAnt = vy;
  }

  /** Visual a cada quadro: interpola a pose e aplica a "gelatina". */
  atualizarVisual(dt: number, alfa: number) {
    this.objeto.position.lerpVectors(this.posAnt, this.posAtu, alfa);
    this.objeto.quaternion.slerpQuaternions(this.rotAnt, this.rotAtu, alfa);

    const cfg = this.cfg;
    // Aceleração longitudinal suavizada → cabeceio (empina ao acelerar, mergulha ao frear)
    this.acelLong += (this.acelPasso - this.acelLong) * (1 - Math.exp(-8 * dt));
    const proporcao = this.velocidade / cfg.velMax;
    const alvoRol = this.ultimaDirecao * Math.abs(proporcao) * cfg.inclinacao;
    const alvoArf = THREE.MathUtils.clamp(-this.acelLong * 0.008, -0.2, 0.2);
    const k = cfg.molejo;
    const amort = 2 * Math.sqrt(k) * 0.32; // < 1 = balança
    this.velRolagem += ((alvoRol - this.rolagem) * k - this.velRolagem * amort) * dt;
    this.rolagem += this.velRolagem * dt;
    this.velArfagem += ((alvoArf - this.arfagem) * k - this.velArfagem * amort) * dt;
    this.arfagem += this.velArfagem * dt;
    this.achatamento += (0 - this.achatamento) * (1 - Math.exp(-6 * dt));

    this.visual.rotation.set(this.arfagem, 0, this.rolagem);
    this.visual.scale.set(1 + this.achatamento * 0.5, 1 - this.achatamento, 1 + this.achatamento * 0.5);
    const giro = (this.velocidade * dt) / this.modelo.raioRoda;
    for (const rd of this.modelo.rodas) rd.rotation.x += giro;
  }
}
