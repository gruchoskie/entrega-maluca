// Cena base: céu em degradê, névoa, luzes, chão e árvores (parques + floresta ao redor da cidade).
import * as THREE from 'three';
import { CENTROS, LIMITE, gerarCidade } from '../../../shared/cidade';

export const LIMITE_MAPA = LIMITE; // metade do lado do terreno jogável

export interface Arvore {
  x: number;
  z: number;
  s: number;
}

export interface Mundo {
  cena: THREE.Scene;
  sol: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Árvores com tronco sólido (parques). A floresta de fundo é só visual. */
  arvores: Arvore[];
  /** Mantém a sombra do sol centrada no alvo (o veículo). */
  seguir(alvo: THREE.Vector3): void;
  /** Anima o céu (nuvens passando). */
  atualizar(dt: number): void;
}

// Gerador determinístico: todo mundo vê o mesmo cenário (importante no multiplayer)
export function aleatorio(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function criarMundo(qualidadeAlta: boolean): Mundo {
  const cena = new THREE.Scene();

  // Céu em degradê (textura de canvas, custo zero)
  cena.background = texturaCeu();
  cena.fog = new THREE.Fog(new THREE.Color('#cfeeff'), 90, 300);

  // Luz ambiente suave + sol
  const hemi = new THREE.HemisphereLight('#dff4ff', '#7fae6a', 1.15);
  cena.add(hemi);
  const sol = new THREE.DirectionalLight('#fff3d6', 2.0);
  sol.position.set(30, 50, 20);
  // Sombras configuradas sempre; a qualidade liga/desliga `castShadow` em tempo real
  sol.castShadow = qualidadeAlta;
  sol.shadow.mapSize.set(2048, 2048);
  const c = sol.shadow.camera;
  c.left = c.bottom = -45;
  c.right = c.top = 45;
  c.near = 1;
  c.far = 160;
  sol.shadow.radius = 4; // borda suave
  sol.shadow.bias = -0.0005;
  cena.add(sol, sol.target);

  cena.add(criarChao());

  // Nuvens de poucos polígonos (1 malha) girando devagar + um sol no céu
  const nuvens = criarNuvens();
  cena.add(nuvens);
  const sprSol = criarSol();
  cena.add(sprSol);
  const dirSol = sol.position.clone().normalize();

  // Árvores: 16 por parque (com colisão) + floresta fora da cidade (só visual)
  const rnd = aleatorio(7);
  const parques = gerarCidade().parques;
  const colisao: Arvore[] = [];
  for (const p of parques) {
    for (let i = 0; i < 16; i++) {
      colisao.push({ x: p.x + (rnd() - 0.5) * 34, z: p.z + (rnd() - 0.5) * 34, s: 0.8 + rnd() * 0.9 });
    }
  }
  // Árvores de rua no meio de cada lado dos quarteirões comuns (sem parques nem praças com rampas)
  const cidadeRampas = gerarCidade().rampas;
  for (const bx of CENTROS) {
    for (const bz of CENTROS) {
      if (parques.some((p) => p.x === bx && p.z === bz)) continue;
      if (cidadeRampas.some((r) => Math.hypot(r.x - bx, r.z - bz) < 24)) continue;
      for (const [dx, dz] of [[20.5, 0], [-20.5, 0], [0, 20.5], [0, -20.5]]) colisao.push({ x: bx + dx, z: bz + dz, s: 0.7 });
    }
  }
  const todas = [...colisao];
  for (let i = 0; i < 160; i++) {
    const lado = i % 4;
    const a = (rnd() - 0.5) * 2 * (LIMITE + 80);
    const d = LIMITE + 16 + rnd() * 70;
    const x = lado === 0 ? a : lado === 1 ? a : lado === 2 ? d : -d;
    const z = lado === 0 ? d : lado === 1 ? -d : a;
    todas.push({ x, z, s: 1 + rnd() * 1.2 });
  }
  cena.add(criarArvores(todas, rnd));

  const deslocamentoSol = sol.position.clone();
  return {
    cena,
    sol,
    hemi,
    arvores: colisao,
    seguir(alvo) {
      sol.target.position.copy(alvo);
      sol.position.copy(alvo).add(deslocamentoSol);
      nuvens.position.set(alvo.x, 0, alvo.z);
      sprSol.position.copy(alvo).addScaledVector(dirSol, 330);
    },
    atualizar(dt) {
      nuvens.rotation.y += dt * 0.006;
    },
  };
}

function criarNuvens(): THREE.Mesh {
  const rnd = aleatorio(99);
  const grupos = 16;
  const puffs = 5;
  const malha = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, fog: false, emissive: '#cfe4ff', emissiveIntensity: 0.45 }),
    grupos * puffs,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let k = 0;
  for (let g = 0; g < grupos; g++) {
    const a = rnd() * Math.PI * 2;
    const r = 110 + rnd() * 230;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cy = 85 + rnd() * 40;
    for (let i = 0; i < puffs; i++) {
      const tam = 7 + rnd() * 7;
      p.set(cx + (i - 2) * 8 + (rnd() - 0.5) * 4, cy + (rnd() - 0.3) * 3, cz + (rnd() - 0.5) * 8);
      s.set(tam * 1.2, tam * 0.55, tam);
      malha.setMatrixAt(k++, m.compose(p, q, s));
    }
  }
  malha.frustumCulled = false;
  return malha;
}

function criarSol(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.18, 'rgba(255,240,170,1)');
  grad.addColorStop(0.22, 'rgba(255,224,130,.55)');
  grad.addColorStop(1, 'rgba(255,224,130,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
  s.scale.set(120, 120, 1);
  return s;
}

function texturaCeu(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3fa0f5');
  grad.addColorStop(0.55, '#9ddcff');
  grad.addColorStop(1, '#fff1d0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function criarChao(): THREE.Mesh {
  // Xadrez de dois verdes: dá noção de velocidade
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7ecb62';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#74c259';
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;

  const lado = LIMITE * 2 + 500;
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(lado, lado), new THREE.MeshLambertMaterial({ map: tex }));
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  return chao;
}

function criarArvores(lista: Arvore[], rnd: () => number): THREE.Group {
  const grupo = new THREE.Group();
  const qtd = lista.length;
  const tronco = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6),
    new THREE.MeshLambertMaterial({ color: '#8a5a3c' }),
    qtd,
  );
  const copa = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.5, 3.2, 7),
    new THREE.MeshLambertMaterial({ color: '#3f9b57', flatShading: true }),
    qtd,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const e = new THREE.Vector3();
  lista.forEach((a, i) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * Math.PI);
    e.setScalar(a.s);
    tronco.setMatrixAt(i, m.compose(p.set(a.x, 0.8 * a.s, a.z), q, e));
    copa.setMatrixAt(i, m.compose(p.set(a.x, 3.0 * a.s, a.z), q, e));
  });
  tronco.castShadow = copa.castShadow = true;
  grupo.add(tronco, copa);
  return grupo;
}
