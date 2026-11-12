// Layout determinístico da cidade: igual no cliente (visual/física) e no servidor (pontos, colisão de pacotes).
// Grade 6x6 de quarteirões; ruas de 14 m entre eles.

export const LIMITE = 175; // metade do mapa jogável
export const LARG_RUA = 14;
export const ESTRADAS = [-168, -112, -56, 0, 56, 112, 168]; // centro de cada rua (nos dois eixos)
export const CENTROS = [-140, -84, -28, 28, 84, 140]; // centro de cada quarteirão (nos dois eixos)
export const TAM_BLOCO = 42;

export interface Ponto {
  x: number;
  z: number;
  nome: string;
}

// Pontos "de referência" no meio de cada trecho de rua. Os pontos reais (abaixo, no fim do arquivo)
// são levados para a CALÇADA, em frente à porta de um prédio próximo.
const BASE_COLETA: Ponto[] = [
  { x: 56, z: -84, nome: 'Padaria Pão Doido' },
  { x: -56, z: -28, nome: 'Pizzaria Mamma Mia' },
  { x: 112, z: 28, nome: 'Floricultura Pétala' },
  { x: -112, z: 84, nome: 'Farmácia Saúde' },
  { x: 28, z: 112, nome: 'Loja de Brinquedos' },
  { x: -84, z: -112, nome: 'Sorveteria Gelada' },
  { x: 84, z: 0, nome: 'Mercadinho do Zé' },
  { x: -140, z: 0, nome: 'Livraria Capítulo Um' },
];

const BASE_ENTREGA: Ponto[] = [
  { x: 0, z: 84, nome: 'Casa da Dona Maria' },
  { x: -56, z: 140, nome: 'Escritório Central' },
  { x: 112, z: -84, nome: 'Hotel Bom Sono' },
  { x: 28, z: 56, nome: 'Escola Sabe Tudo' },
  { x: -28, z: -56, nome: 'Hospital Alegria' },
  { x: 140, z: 56, nome: 'Casa do Vovô' },
  { x: -112, z: -28, nome: 'Academia Forte' },
  { x: 84, z: -112, nome: 'Prefeitura' },
];

export const RAIO_PONTO = 4.5; // raio da zona de coleta/entrega (encoste o veículo no meio-fio!)

// ---------- Coordenadas para o navegador "cantar" no modo van ----------
// Ruas verticais (x constante) = letras A..G; ruas horizontais (z constante) = números 1..7.
const LETRAS = 'ABCDEFG';
export const nomeRuaX = (i: number) => LETRAS[i];
export const nomeRuaZ = (i: number) => String(i + 1);

/** Descreve um ponto na calçada de uma rua, ex.: "Rua E, entre 2 e 3". */
export function coordenada(x: number, z: number): string {
  const perto = (v: number) => {
    let i = 0;
    ESTRADAS.forEach((e, k) => {
      if (Math.abs(e - v) < Math.abs(ESTRADAS[i] - v)) i = k;
    });
    return { i, d: Math.abs(ESTRADAS[i] - v) };
  };
  const entre = (v: number) => {
    const i = Math.max(0, ESTRADAS.findIndex((e, k) => v > e && v < (ESTRADAS[k + 1] ?? Infinity)));
    return [i, Math.min(ESTRADAS.length - 1, i + 1)];
  };
  const px = perto(x);
  const pz = perto(z);
  if (px.d < 10 && pz.d >= 10) {
    const [a, b] = entre(z);
    return `Rua ${nomeRuaX(px.i)}, entre ${nomeRuaZ(a)} e ${nomeRuaZ(b)}`;
  }
  if (pz.d < 10 && px.d >= 10) {
    const [a, b] = entre(x);
    return `Rua ${nomeRuaZ(pz.i)}, entre ${nomeRuaX(a)} e ${nomeRuaX(b)}`;
  }
  return `Cruzamento ${nomeRuaX(px.i)}-${nomeRuaZ(pz.i)}`;
}

export interface Predio {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  cor: string;
}
export interface Rampa {
  w: number;
  h: number;
  l: number;
  x: number;
  z: number;
  yaw: number;
}
export interface Cidade {
  predios: Predio[];
  parques: { x: number; z: number }[];
  rampas: Rampa[];
}

// Gerador pseudo-aleatório com semente fixa (mulberry32)
function aleatorio(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARQUES = ['-28,-84', '28,28', '-140,140', '140,-140'];
const PRACAS = ['-84,28', '84,-28'];
const CORES_PREDIO = ['#ff8fa3', '#ffd166', '#8ecae6', '#b8f2e6', '#cdb4db', '#ffb4a2', '#a0e7a0', '#f9c784'];

let cache: Cidade | null = null;

export function gerarCidade(): Cidade {
  if (cache) return cache;
  const rnd = aleatorio(2024);
  const predios: Predio[] = [];
  const parques: { x: number; z: number }[] = [];
  const rampas: Rampa[] = [];

  for (const bx of CENTROS) {
    for (const bz of CENTROS) {
      const chave = `${bx},${bz}`;
      if (PARQUES.includes(chave)) {
        parques.push({ x: bx, z: bz });
        continue;
      }
      if (PRACAS.includes(chave)) {
        rampas.push(
          { w: 6, h: 2.4, l: 10, x: bx - 9, z: bz - 8, yaw: 0 },
          { w: 6, h: 3.4, l: 9, x: bx + 9, z: bz + 8, yaw: Math.PI },
          { w: 5, h: 2, l: 8, x: bx, z: bz, yaw: Math.PI / 2 },
        );
        continue;
      }
      // 4 lotes por quarteirão (alguns vazios), mais altos perto do centro da cidade
      for (const dx of [-10.5, 10.5]) {
        for (const dz of [-10.5, 10.5]) {
          if (rnd() < 0.12) continue;
          const w = 12 + rnd() * 5;
          const d = 12 + rnd() * 5;
          const dist = Math.hypot(bx, bz);
          const h = 8 + rnd() * 14 + Math.max(0, 18 - dist / 10);
          predios.push({
            x: bx + dx, z: bz + dz, w, d, h,
            cor: CORES_PREDIO[Math.floor(rnd() * CORES_PREDIO.length)],
          });
        }
      }
    }
  }
  cache = { predios, parques, rampas };
  return cache;
}

// ---------- Pontos reais: na calçada, em frente à porta de um prédio ----------
/** Quarteirão (centro) mais próximo de um valor. */
const centroDe = (v: number) => CENTROS.reduce((a, c) => (Math.abs(c - v) < Math.abs(a - v) ? c : a), CENTROS[0]);

/** Leva cada ponto de referência até a porta (lado da rua) do prédio mais próximo, sem repetir prédios. */
function naCalcada(base: Ponto[], usados: Set<Predio>): Ponto[] {
  const predios = gerarCidade().predios;
  return base.map((p) => {
    let melhor: { x: number; z: number; b: Predio } | null = null;
    let md = Infinity;
    for (const b of predios) {
      if (usados.has(b)) continue;
      const lado = Math.sign(b.x - centroDe(b.x)) || 1; // mesma regra das portas desenhadas
      const sx = b.x + lado * (b.w / 2 + 1.7); // 1,7 m na frente da porta = calçada
      const d = Math.hypot(sx - p.x, b.z - p.z);
      if (d < md) {
        md = d;
        melhor = { x: sx, z: b.z, b };
      }
    }
    if (!melhor) return p;
    usados.add(melhor.b);
    return { x: Math.round(melhor.x * 10) / 10, z: Math.round(melhor.z * 10) / 10, nome: p.nome };
  });
}

const _usados = new Set<Predio>();
export const PONTOS_COLETA: Ponto[] = naCalcada(BASE_COLETA, _usados);
export const PONTOS_ENTREGA: Ponto[] = naCalcada(BASE_ENTREGA, _usados);
