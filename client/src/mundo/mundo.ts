// Cena base: céu em degradê, ciclo dia/noite, temas de mapa (cidade, litoral, inverno), chão e árvores.
import * as THREE from 'three';
import { CENTROS, LIMITE, gerarCidade } from '../../../shared/cidade';
import type { Mapa } from '../../../shared/protocolo';

export const LIMITE_MAPA = LIMITE; // metade do lado do terreno jogável
export const CICLO_DIA_S = 420; // duração de um dia inteiro (s)

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
  /** Anima o céu, a luz do dia/noite, a neve e as nuvens. */
  atualizar(dt: number): void;
  /** Hora do dia, de 0 (manhã) a 1 (volta ao começo). Igual para todos (vem do relógio do servidor). */
  definirHora(h: number): void;
  /** Troca o visual do mapa (cores do chão, árvores, mar, neve). */
  aplicarTema(t: Mapa): void;
  tema: Mapa;
  /** 0..1 — o clima (chuva) escurece e fecha a névoa. Quem manda é o módulo de caos. */
  chuva: number;
  /** 0 = dia, 1 = noite (só leitura). */
  noite: number;
  /** Quem quiser reagir à noite (janelas acesas, faróis) registra aqui. */
  aoNoite: ((n: number) => void)[];
  /** Quem quiser reagir à troca de tema (tintas dos prédios) registra aqui. */
  aoTema: ((t: Mapa) => void)[];
}

interface Tema {
  topo: string; meio: string; base: string; nevoa: string;
  chao1: string; chao2: string; terra: string; copa: string; tronco: string;
}
const TEMAS: Record<Mapa, Tema> = {
  cidade: { topo: '#3fa0f5', meio: '#9ddcff', base: '#fff1d0', nevoa: '#cfeeff', chao1: '#7ecb62', chao2: '#74c259', terra: '#7fae6a', copa: '#3f9b57', tronco: '#8a5a3c' },
  litoral: { topo: '#2f9ff0', meio: '#8fe0ff', base: '#ffeccf', nevoa: '#e6f6ff', chao1: '#efdca4', chao2: '#e8d195', terra: '#d8c58a', copa: '#4fb06a', tronco: '#9b6a3a' },
  inverno: { topo: '#7fa6d9', meio: '#c7d9ee', base: '#f0f4fa', nevoa: '#dfe8f3', chao1: '#f4f8ff', chao2: '#e6eefb', terra: '#cfd8e8', copa: '#cfe8e0', tronco: '#6b5646' },
};
const NOITE = { topo: '#050914', meio: '#101a3a', base: '#2a2450', nevoa: '#0b1228', sol: '#9bb4ff', hemiCeu: '#3a4a8a', hemiChao: '#1b2236' };

// Gerador determinístico: todo mundo vê o mesmo cenário (importante no multiplayer)
export function aleatorio(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);
/** Quanto é noite numa hora do dia h (0..1): dia até 0,55; entardecer; noite; amanhecer. */
function fatorNoite(h: number) {
  if (h < 0.55) return 0;
  if (h < 0.68) return smooth((h - 0.55) / 0.13);
  if (h < 0.88) return 1;
  return smooth(1 - (h - 0.88) / 0.12);
}

export function criarMundo(qualidadeAlta: boolean): Mundo {
  const cena = new THREE.Scene();
  const ceu = criarCeu();
  cena.background = ceu.tex;
  const nevoa = new THREE.Fog(new THREE.Color(TEMAS.cidade.nevoa), 90, 300);
  cena.fog = nevoa;

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

  const chao = criarChao(TEMAS.cidade);
  cena.add(chao);
  const mar = criarMar();
  mar.visible = false;
  cena.add(mar);

  // Nuvens, sol, lua, estrelas e neve
  const nuvens = criarNuvens();
  cena.add(nuvens);
  const sprSol = criarAstro('rgba(255,255,235,1)', 'rgba(255,240,170,1)', 'rgba(255,224,130,.55)', 'rgba(255,224,130,0)');
  const sprLua = criarAstro('rgba(240,244,255,1)', 'rgba(215,225,255,1)', 'rgba(170,190,255,.35)', 'rgba(170,190,255,0)');
  sprLua.scale.set(70, 70, 1);
  cena.add(sprSol, sprLua);
  const estrelas = criarEstrelas();
  cena.add(estrelas);
  const neve = criarNeve();
  neve.obj.visible = false;
  cena.add(neve.obj);

  // Árvores: 16 por parque (com colisão) + de rua + floresta fora da cidade (só visual)
  const rnd = aleatorio(7);
  const parques = gerarCidade().parques;
  const colisao: Arvore[] = [];
  for (const p of parques) {
    for (let i = 0; i < 16; i++) {
      colisao.push({ x: p.x + (rnd() - 0.5) * 34, z: p.z + (rnd() - 0.5) * 34, s: 0.8 + rnd() * 0.9 });
    }
  }
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
  const arv = criarArvores(todas, rnd);
  cena.add(arv.grupo);

  // ---------- Estado do ambiente ----------
  let hora = 0.1;
  let tema: Mapa = 'cidade';
  let alvoPos = new THREE.Vector3();
  let ultimoCeu = -1;
  let temaDoCeu: Mapa | null = null;
  let ultimaChuvaCeu = 0;
  let tCeu = 0;
  let ultimaNoiteAvisada = -1;
  const sunDir = new THREE.Vector3(0.6, 0.8, 0.4).normalize();
  const moonDir = new THREE.Vector3(-0.5, 0.8, -0.3).normalize();
  const dirLuz = new THREE.Vector3();
  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();

  const mundo: Mundo = {
    cena, sol, hemi,
    arvores: colisao,
    tema,
    chuva: 0,
    noite: 0,
    aoNoite: [],
    aoTema: [],
    definirHora(h) {
      hora = ((h % 1) + 1) % 1;
    },
    aplicarTema(t) {
      if (t === tema) return;
      tema = mundo.tema = t;
      const T = TEMAS[t];
      chao.material.map?.dispose();
      chao.material.map = texturaChao(T.chao1, T.chao2);
      chao.material.needsUpdate = true;
      arv.copa.material.color.set(T.copa);
      arv.tronco.material.color.set(T.tronco);
      mar.visible = t === 'litoral';
      neve.obj.visible = t === 'inverno';
      for (const f of mundo.aoTema) f(t);
      temaDoCeu = null; // força redesenhar o céu
    },
    seguir(alvo) {
      alvoPos = alvo;
      sol.target.position.copy(alvo);
      sol.position.copy(alvo).addScaledVector(dirLuz, 60);
      nuvens.position.set(alvo.x, 0, alvo.z);
      estrelas.position.set(alvo.x, 0, alvo.z);
      sprSol.position.copy(alvo).addScaledVector(sunDir, 330);
      sprLua.position.copy(alvo).addScaledVector(moonDir, 330);
    },
    atualizar(dt) {
      nuvens.rotation.y += dt * 0.006;
      const n = fatorNoite(hora);
      mundo.noite = n;
      const T = TEMAS[tema];
      const chuva = mundo.chuva;

      // Direção do sol (de manhã sobe, à tarde desce) e da lua
      const a = Math.PI * Math.min(1, hora / 0.62);
      sunDir.set(Math.cos(a) * 0.9, Math.sin(a) * 0.95 + 0.12, 0.4).normalize();
      dirLuz.copy(sunDir).lerp(moonDir, n).normalize();

      // Luzes
      sol.intensity = (2.0 * (1 - n) + 0.35 * n) * (1 - 0.5 * chuva);
      sol.color.set('#fff3d6').lerp(tmp.set(NOITE.sol), n);
      hemi.intensity = 1.15 * (1 - n) + 0.55 * n - 0.3 * chuva;
      hemi.color.set('#dff4ff').lerp(tmp.set(NOITE.hemiCeu), n);
      hemi.groundColor.set(T.terra).lerp(tmp.set(NOITE.hemiChao), n);

      // Névoa
      nevoa.color.set(T.nevoa).lerp(tmp.set(NOITE.nevoa), n).lerp(tmp2.set('#8f9fb4'), chuva * (1 - n * 0.6));
      nevoa.far = 300 - 140 * chuva - 70 * n;

      // Astros
      (sprSol.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - n * 1.4) * (1 - 0.5 * chuva);
      (sprLua.material as THREE.SpriteMaterial).opacity = Math.min(1, n * 1.3) * (1 - 0.6 * chuva);
      (estrelas.material as THREE.PointsMaterial).opacity = Math.max(0, n * 1.2 - 0.2) * (1 - chuva);
      (nuvens.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.45 * (1 - n) + 0.05 * n;

      // Céu em degradê: redesenha só quando algo mudou (a textura é pequena, mas não precisa de todo quadro)
      tCeu += dt;
      if (tCeu > 0.25 && (Math.abs(n - ultimoCeu) > 0.01 || temaDoCeu !== tema || Math.abs(chuva - ultimaChuvaCeu) > 0.02)) {
        tCeu = 0;
        ultimoCeu = n;
        temaDoCeu = tema;
        ultimaChuvaCeu = chuva;
        ceu.desenhar(T, NOITE, n, chuva);
      }
      if (Math.abs(n - ultimaNoiteAvisada) > 0.01) {
        ultimaNoiteAvisada = n;
        for (const f of mundo.aoNoite) f(n);
      }
      if (neve.obj.visible) neve.atualizar(dt, alvoPos);
    },
  };
  return mundo;
}

// -----------------------------------------------------------------------------
// Céu, chão, mar, nuvens, astros, estrelas, neve e árvores
// -----------------------------------------------------------------------------
function criarCeu() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const a = new THREE.Color();
  const b = new THREE.Color();
  const cor = (dia: string, noite: string, n: number, chuva: number, entardecer?: string) => {
    a.set(dia).lerp(b.set(noite), n);
    if (entardecer) a.lerp(b.set(entardecer), Math.sin(Math.PI * n) * 0.65);
    a.lerp(b.set('#7d8798'), chuva * 0.6 * (1 - n * 0.5));
    return '#' + a.getHexString();
  };
  return {
    tex,
    desenhar(T: Tema, N: typeof NOITE, n: number, chuva: number) {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, cor(T.topo, N.topo, n, chuva));
      grad.addColorStop(0.55, cor(T.meio, N.meio, n, chuva, '#ff8a5a'));
      grad.addColorStop(1, cor(T.base, N.base, n, chuva, '#ff9a5a'));
      g.fillStyle = grad;
      g.fillRect(0, 0, 2, 256);
      tex.needsUpdate = true;
    },
  };
}

function texturaChao(c1: string, c2: string): THREE.CanvasTexture {
  // Xadrez de dois tons: dá noção de velocidade
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = c1;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = c2;
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function criarChao(T: Tema): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial> {
  const lado = LIMITE * 2 + 500;
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(lado, lado), new THREE.MeshLambertMaterial({ map: texturaChao(T.chao1, T.chao2) }));
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  return chao;
}

/** Mar do tema "litoral": 4 faixas azuis fora da cidade. */
function criarMar(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#2aa7d8', transparent: true, opacity: 0.92 });
  const margem = LIMITE + 40; // começa depois da parede invisível e da faixa de areia
  const grande = 900;
  const faixas: [number, number, number, number][] = [
    [0, margem + grande / 2, grande * 2, grande],
    [0, -margem - grande / 2, grande * 2, grande],
    [margem + grande / 2, 0, grande, margem * 2],
    [-margem - grande / 2, 0, grande, margem * 2],
  ];
  for (const [x, z, w, d] of faixas) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.06, z);
    g.add(m);
  }
  return g;
}

function criarNuvens(): THREE.InstancedMesh {
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

function criarAstro(c0: string, c1: string, c2: string, c3: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, c0);
  grad.addColorStop(0.18, c1);
  grad.addColorStop(0.22, c2);
  grad.addColorStop(1, c3);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
  s.scale.set(120, 120, 1);
  return s;
}

function criarEstrelas(): THREE.Points {
  const rnd = aleatorio(5);
  const n = 260;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const e = 0.15 + rnd() * 1.2; // só no céu (acima do horizonte)
    pos[i * 3] = Math.cos(a) * Math.cos(e) * 340;
    pos[i * 3 + 1] = Math.sin(e) * 340;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 340;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}

/** Neve caindo ao redor do jogador (tema "inverno"). */
function criarNeve() {
  const n = 500;
  const caixa = 40;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * caixa * 2;
    pos[i * 3 + 1] = Math.random() * 30;
    pos[i * 3 + 2] = (Math.random() - 0.5) * caixa * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const obj = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 0.28, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
  obj.frustumCulled = false;
  const base = new Float32Array(pos);
  let t = 0;
  return {
    obj,
    atualizar(dt: number, centro: THREE.Vector3) {
      t += dt;
      const a = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        const y = (((base[i * 3 + 1] - t * (1.8 + (i % 5) * 0.3)) % 30) + 30) % 30;
        a.setXYZ(
          i,
          centro.x + base[i * 3] + Math.sin(t * 0.6 + i) * 1.2,
          y,
          centro.z + base[i * 3 + 2] + Math.cos(t * 0.5 + i * 0.7) * 1.2,
        );
      }
      a.needsUpdate = true;
    },
  };
}

function criarArvores(lista: Arvore[], rnd: () => number) {
  const grupo = new THREE.Group();
  const qtd = lista.length;
  const tronco = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6),
    new THREE.MeshLambertMaterial({ color: TEMAS.cidade.tronco }),
    qtd,
  );
  const copa = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.5, 3.2, 7),
    new THREE.MeshLambertMaterial({ color: TEMAS.cidade.copa, flatShading: true }),
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
  return { grupo, tronco, copa } as {
    grupo: THREE.Group;
    tronco: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
    copa: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  };
}
