// Constantes do jogo usadas por cliente e servidor.

export const MAX_JOGADORES = 4;
export const TAXA_REDE = 15; // ticks por segundo do servidor

/** Posição de largada (lobby/início): fileira no cruzamento central. */
export function posicaoLargada(slot: number): { x: number; z: number; yaw: number } {
  return { x: (slot - 1.5) * 3.2, z: -10, yaw: 0 }; // na rua central (x = 0), olhando para o cruzamento
}

// ---------- Loja (preços em R$, pagos com o dinheiro da equipe) ----------
export const NIVEL_MAX = 3;
export const PRECO_UPGRADE = [150, 300, 500]; // nível 0→1, 1→2, 2→3
export const PRECO_CHAPEU: Record<string, number> = { nenhum: 0, cartola: 120, cowboy: 150, coroa: 400, festa: 100 };
export const PRECO_BUZINA: Record<string, number> = { padrao: 0, patinho: 80, caminhao: 150, melodia: 220 };
