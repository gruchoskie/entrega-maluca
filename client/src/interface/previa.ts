// Preview 3D do veículo girando (tela inicial). Usa um renderizador próprio, descartado ao fechar o menu.
import * as THREE from 'three';
import type { Chapeu, TipoVeiculo } from '../../../shared/protocolo';
import { criarModelo } from '../veiculo/modelos';

export class Previa {
  private renderizador: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private mesa = new THREE.Group(); // gira devagar
  private modelo: THREE.Group | null = null;
  private raf = 0;
  private ultimo = performance.now();
  private vivo = true;
  private ro: ResizeObserver;

  constructor(private alvo: HTMLElement) {
    this.renderizador = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderizador.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderizador.shadowMap.enabled = true;
    this.renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
    alvo.appendChild(this.renderizador.domElement);

    this.cena.add(new THREE.HemisphereLight('#ffffff', '#b9a6ff', 1.5));
    const sol = new THREE.DirectionalLight('#fff3d6', 2.4);
    sol.position.set(4, 7, 5);
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    sol.shadow.camera.left = sol.shadow.camera.bottom = -4;
    sol.shadow.camera.right = sol.shadow.camera.top = 4;
    this.cena.add(sol);

    // Plataforma redonda com anel colorido
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.7, 2.9, 0.22, 40),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    );
    base.position.y = -0.11;
    base.receiveShadow = true;
    const anel = new THREE.Mesh(
      new THREE.TorusGeometry(2.78, 0.07, 8, 48),
      new THREE.MeshBasicMaterial({ color: '#ff8a3d' }),
    );
    anel.rotation.x = Math.PI / 2;
    this.cena.add(base, anel, this.mesa);

    this.camera.position.set(0, 2.9, 8.2);
    this.camera.lookAt(0, 0.9, 0);

    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(alvo);
    this.redimensionar();
    this.raf = requestAnimationFrame(() => this.quadro());
  }

  private redimensionar() {
    const w = Math.max(80, this.alvo.clientWidth);
    const h = Math.max(80, this.alvo.clientHeight);
    this.renderizador.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  definir(tipo: TipoVeiculo, cor: string, chapeu: Chapeu = 'nenhum') {
    if (this.modelo) this.mesa.remove(this.modelo);
    const m = criarModelo(tipo, cor, chapeu).raiz;
    m.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    // Escala para o veículo caber bem na plataforma (a van é maior que a scooter)
    const escala = tipo === 'van' ? 0.85 : tipo === 'scooter' ? 1.2 : 1.15;
    m.scale.setScalar(escala);
    this.modelo = m;
    this.mesa.add(m);
  }

  private quadro() {
    if (!this.vivo) return;
    const agora = performance.now();
    const dt = Math.min(0.05, (agora - this.ultimo) / 1000);
    this.ultimo = agora;
    this.mesa.rotation.y += dt * 0.7;
    this.renderizador.render(this.cena, this.camera);
    this.raf = requestAnimationFrame(() => this.quadro());
  }

  destruir() {
    this.vivo = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderizador.dispose();
    this.renderizador.forceContextLoss();
    this.renderizador.domElement.remove();
  }
}
