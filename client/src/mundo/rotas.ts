// Rota sugerida pelas ruas (grade): vai do ponto atual ao destino seguindo as ruas, sem atravessar quarteirões.
import { ESTRADAS } from '../../../shared/cidade';

export interface Ponto2 {
  x: number;
  z: number;
}

const maisPerto = (v: number) => {
  let i = 0;
  ESTRADAS.forEach((e, k) => {
    if (Math.abs(e - v) < Math.abs(ESTRADAS[i] - v)) i = k;
  });
  return i;
};

/** Primeiro anda pela rua mais próxima até a coluna do destino, depois sobe/desce até o destino. */
export function rotaPelasRuas(de: Ponto2, para: Ponto2): Ponto2[] {
  const a = { x: ESTRADAS[maisPerto(de.x)], z: ESTRADAS[maisPerto(de.z)] }; // cruzamento mais próximo de mim
  const b = { x: ESTRADAS[maisPerto(para.x)], z: ESTRADAS[maisPerto(para.z)] }; // cruzamento mais próximo do destino
  const canto = { x: b.x, z: a.z };
  const pts: Ponto2[] = [de, a];
  if (canto.x !== a.x || canto.z !== a.z) pts.push(canto);
  if (b.x !== canto.x || b.z !== canto.z) pts.push(b);
  pts.push(para);
  return pts;
}
