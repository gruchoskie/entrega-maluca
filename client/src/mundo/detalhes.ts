// Detalhes que dão vida à cidade: prédios com janelas, portas, toldos, telhados, faixas de pedestre e postes.
// Tudo instanciado ou fundido em poucas malhas (pouquíssimas chamadas de desenho).
import * as THREE from 'three';
import { CENTROS, ESTRADAS, LIMITE, type Predio } from '../../../shared/cidade';
import type { Fisica } from '../fisica/fisica';

const JANELA_L = 3.2; // largura de uma janela (m)
const ANDAR_H = 3.4; // altura de um andar (m)

/** Textura de uma "célula" de fachada: parede clara + janela azulada com reflexo. */
function texturaFachada(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  // moldura clara e vidro escuro (vai ser tingido pela cor do prédio)
  g.fillStyle = '#e9edf5';
  g.fillRect(11, 9, 42, 46);
  g.fillStyle = '#5f86b3';
  g.fillRect(14, 12, 36, 40);
  g.fillStyle = '#8fb8e2'; // reflexo do céu
  g.beginPath();
  g.moveTo(14, 12);
  g.lineTo(34, 12);
  g.lineTo(14, 32);
  g.closePath();
  g.fill();
  g.fillStyle = '#e9edf5'; // divisória
  g.fillRect(31, 12, 2, 40);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Todos os prédios fundidos em UMA malha, com UV repetindo as janelas conforme o tamanho real. */
export function criarPredios(cena: THREE.Scene, predios: Predio[]): THREE.MeshLambertMaterial {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const cor = new THREE.Color();

  const quad = (v: number[][], n: number[], uvs: number[][], c0: THREE.Color, c1: THREE.Color) => {
    const base = pos.length / 3;
    v.forEach((p, k) => {
      pos.push(...p);
      nor.push(...n);
      uv.push(...uvs[k]);
      const c = k < 2 ? c0 : c1; // vértices 0,1 = base; 2,3 = topo
      col.push(c.r, c.g, c.b);
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (const b of predios) {
    const w2 = b.w / 2;
    const d2 = b.d / 2;
    const base = cor.set(b.cor).clone().multiplyScalar(0.8);
    const topo = cor.set(b.cor).clone();
    const andares = Math.max(2, Math.round(b.h / ANDAR_H));
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const largura = nx !== 0 ? b.d : b.w;
      const colunas = Math.max(1, Math.round(largura / JANELA_L));
      // u = cima × normal (sentido anti-horário visto de fora)
      const ux = nz;
      const uz = -nx;
      const hu = largura / 2;
      const cx = b.x + nx * w2;
      const cz = b.z + nz * d2;
      quad(
        [
          [cx - ux * hu, 0, cz - uz * hu],
          [cx + ux * hu, 0, cz + uz * hu],
          [cx + ux * hu, b.h, cz + uz * hu],
          [cx - ux * hu, b.h, cz - uz * hu],
        ],
        [nx, 0, nz],
        [[0, 0], [colunas, 0], [colunas, andares], [0, andares]],
        base,
        topo,
      );
    }
    // Telhado: UV num canto liso da textura (sem janela)
    const tc = topo.clone().multiplyScalar(0.7);
    quad(
      [[b.x - w2, b.h, b.z - d2], [b.x - w2, b.h, b.z + d2], [b.x + w2, b.h, b.z + d2], [b.x + w2, b.h, b.z - d2]],
      [0, 1, 0],
      [[0.03, 0.03], [0.03, 0.03], [0.03, 0.03], [0.03, 0.03]],
      tc,
      tc,
    );
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  // À noite as janelas acendem (emissiveIntensity sobe com o fator de noite)
  const material = new THREE.MeshLambertMaterial({
    map: texturaFachada(),
    vertexColors: true,
    emissive: new THREE.Color('#ffd27a'),
    emissiveMap: texturaLuzes(),
    emissiveIntensity: 0,
  });
  const malha = new THREE.Mesh(g, material);
  malha.castShadow = malha.receiveShadow = true;
  cena.add(malha);

  // ---------- Portas, toldos, platibanda, ar-condicionado e antenas (instanciados) ----------
  const centroDe = (v: number) => CENTROS.reduce((a, c) => (Math.abs(c - v) < Math.abs(a - v) ? c : a), CENTROS[0]);
  const caixa = () => new THREE.BoxGeometry(1, 1, 1);
  const lamb = (c: string) => new THREE.MeshLambertMaterial({ color: c });
  const portas = new THREE.InstancedMesh(caixa(), lamb('#5b3a29'), predios.length);
  const toldos = new THREE.InstancedMesh(caixa(), lamb('#ffffff'), predios.length);
  const platibandas = new THREE.InstancedMesh(caixa(), lamb('#ffffff'), predios.length);
  const arCond = new THREE.InstancedMesh(caixa(), lamb('#c9ced6'), predios.length);
  const altos = predios.filter((p) => p.h > 20);
  const antenas = new THREE.InstancedMesh(caixa(), lamb('#4a4a55'), Math.max(1, altos.length));
  const toldoCores = ['#ff5a5f', '#ffd166', '#4a7bff', '#4cd964', '#b061ff'];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const pe = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
    mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(sx, sy, sz)));

  predios.forEach((b, i) => {
    const lado = Math.sign(b.x - centroDe(b.x)) || 1; // porta do lado de fora do quarteirão (eixo x)
    pe(portas, i, b.x + lado * (b.w / 2 + 0.05), 1.5, b.z, 0.25, 3, 2.2);
    pe(toldos, i, b.x + lado * (b.w / 2 + 0.7), 3.5, b.z, 1.6, 0.25, 4.2);
    toldos.setColorAt(i, c.set(toldoCores[i % toldoCores.length]));
    // platibanda: faixa mais escura em volta do topo
    pe(platibandas, i, b.x, b.h + 0.3, b.z, b.w + 0.7, 0.6, b.d + 0.7);
    platibandas.setColorAt(i, c.set(b.cor).multiplyScalar(0.62));
    pe(arCond, i, b.x - b.w * 0.2, b.h + 1.15, b.z + b.d * 0.15, 2.2, 1.1, 1.7);
  });
  altos.forEach((b, i) => pe(antenas, i, b.x + b.w * 0.25, b.h + 3.2, b.z - b.d * 0.25, 0.16, 5.2, 0.16));
  antenas.count = altos.length;
  for (const mesh of [portas, toldos, platibandas, arCond, antenas]) {
    mesh.castShadow = true;
    cena.add(mesh);
  }
  return material;
}

/** Mesma célula da fachada, mas só o vidro brilha (usada como mapa de emissão à noite). */
function texturaLuzes(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  g.fillRect(14, 12, 36, 40);
  g.fillStyle = '#000';
  g.fillRect(31, 12, 2, 40);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Faixas de pedestre ao redor de cada cruzamento. */
export function criarFaixasPedestre(cena: THREE.Scene) {
  const itens: THREE.Matrix4[] = [];
  const q0 = new THREE.Quaternion();
  const q90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const um = new THREE.Vector3(1, 1, 1);
  for (const cx of ESTRADAS) {
    for (const cz of ESTRADAS) {
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const px = cx + dx * 9.5;
        const pz = cz + dz * 9.5;
        if (Math.abs(px) > LIMITE - 2 || Math.abs(pz) > LIMITE - 2) continue;
        for (let off = -5; off <= 5; off += 2) {
          // listras ao longo do sentido da rua, espalhadas na largura
          const x = px + (dx === 0 ? off : 0);
          const z = pz + (dz === 0 ? off : 0);
          itens.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.085, z), dz !== 0 ? q0 : q90, um));
        }
      }
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.02, 3.2), new THREE.MeshBasicMaterial({ color: '#f4f4f0' }), itens.length);
  itens.forEach((t, i) => mesh.setMatrixAt(i, t));
  mesh.receiveShadow = true;
  cena.add(mesh);
}

/** Postes de luz nos cantos de cada quarteirão (com colisão fina). */
export function criarPostes(fis: Fisica, cena: THREE.Scene) {
  const { R, mundo } = fis;
  const lugares: { x: number; z: number }[] = [];
  for (const bx of CENTROS) for (const bz of CENTROS) for (const sx of [-1, 1]) for (const sz of [-1, 1]) lugares.push({ x: bx + sx * 20, z: bz + sz * 20 });
  const postes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.17, 6, 6), new THREE.MeshLambertMaterial({ color: '#4a4f5c' }), lugares.length);
  const cabecas = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.22, 0.55), new THREE.MeshBasicMaterial({ color: '#fff3b8' }), lugares.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  lugares.forEach((l, i) => {
    postes.setMatrixAt(i, m.makeTranslation(l.x, 3, l.z));
    // a lâmpada aponta para a rua (para fora do quarteirão)
    const paraRua = -Math.sign(l.x - Math.round(l.x / 56) * 56 || 1) * 0.6; // a rua mais próxima está em múltiplos de 56
    cabecas.setMatrixAt(i, m.compose(new THREE.Vector3(l.x + paraRua, 6.05, l.z), q.identity(), new THREE.Vector3(1, 1, 1)));
    mundo.createCollider(R.ColliderDesc.cylinder(3, 0.18).setTranslation(l.x, 3, l.z));
  });
  postes.castShadow = true;
  cena.add(postes, cabecas);
}
