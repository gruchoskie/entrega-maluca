// Progresso do jogador (XP, nível, conquistas e recordes), guardado só neste navegador.
import type { Modo, Resultado } from '../../../shared/protocolo';

const CHAVE = 'em-progresso';

export interface Conquista {
  id: string;
  icone: string;
  nome: string;
  desc: string;
}

export const CONQUISTAS: Conquista[] = [
  { id: 'primeira', icone: '📦', nome: 'Primeira entrega', desc: 'Entregue seu primeiro pacote.' },
  { id: 'dez', icone: '🚚', nome: 'Entregador profissional', desc: 'Faça 10 entregas no total.' },
  { id: 'perfeita', icone: '💎', nome: 'Entrega perfeita', desc: 'Entregue um pacote com 100% de integridade.' },
  { id: 'chuva', icone: '🌧️', nome: 'Debaixo d\'água', desc: 'Entregue durante uma chuva.' },
  { id: 'velocista', icone: '⚡', nome: 'Velocista', desc: 'Passe de 100 km/h.' },
  { id: 'capotador', icone: '🙃', nome: 'De cabeça para baixo', desc: 'Capote 5 vezes numa partida.' },
  { id: 'rico', icone: '💰', nome: 'Faturando alto', desc: 'Ganhe R$ 1.000 numa partida.' },
  { id: 'equipe', icone: '🚐', nome: 'Mesmo carro', desc: 'Termine uma partida no modo "Mesmo carro".' },
  { id: 'vencedor', icone: '🏆', nome: 'O melhor entregador', desc: 'Vença uma partida individual.' },
  { id: 'pizza', icone: '🍕', nome: 'Ainda quentinha', desc: 'Entregue uma pizza com mais de 70% de integridade.' },
];

/** Cores bônus liberadas por nível. */
export const CORES_EXTRAS: { cor: string; nivel: number }[] = [
  { cor: '#1f2937', nivel: 3 },
  { cor: '#f8fafc', nivel: 5 },
  { cor: '#00d1a0', nivel: 7 },
  { cor: '#ff8a00', nivel: 10 },
];

interface Dados {
  xp: number;
  entregas: number;
  partidas: number;
  recordes: { dinheiro: number; entregas: number };
  conquistas: string[];
}

function ler(): Dados {
  const padrao: Dados = { xp: 0, entregas: 0, partidas: 0, recordes: { dinheiro: 0, entregas: 0 }, conquistas: [] };
  try {
    return { ...padrao, ...JSON.parse(localStorage.getItem(CHAVE) ?? '{}') };
  } catch {
    return padrao;
  }
}

function gravar(d: Dados) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(d));
  } catch {
    /* sem armazenamento: tudo bem */
  }
}

export const nivelDe = (xp: number) => Math.floor(Math.sqrt(xp / 60)) + 1;

export function resumo() {
  const d = ler();
  const nivel = nivelDe(d.xp);
  const base = 60 * (nivel - 1) ** 2;
  const prox = 60 * nivel ** 2;
  return { ...d, nivel, fracao: Math.min(1, (d.xp - base) / (prox - base)) };
}

/** Desbloqueia uma conquista (se ainda não tem). @returns a conquista, se acabou de ser desbloqueada. */
export function desbloquear(id: string): Conquista | null {
  const d = ler();
  if (d.conquistas.includes(id)) return null;
  d.conquistas.push(id);
  gravar(d);
  return CONQUISTAS.find((c) => c.id === id) ?? null;
}

/** Chamado a cada entrega minha. */
export function aoEntregar(integridade: number, tipo?: string, chuva = false): Conquista[] {
  const d = ler();
  d.entregas++;
  gravar(d);
  const novas: (Conquista | null)[] = [desbloquear('primeira')];
  if (d.entregas >= 10) novas.push(desbloquear('dez'));
  if (integridade >= 100) novas.push(desbloquear('perfeita'));
  if (chuva) novas.push(desbloquear('chuva'));
  if (tipo === 'pizza' && integridade > 70) novas.push(desbloquear('pizza'));
  return novas.filter((c): c is Conquista => !!c);
}

/** Fim de partida: soma XP, atualiza recordes e confere conquistas. */
export function aoTerminar(r: Resultado, meuId: string, modo: Modo) {
  const d = ler();
  const eu = r.jogadores.find((j) => j.id === meuId);
  let xpGanho = 0;
  const novas: (Conquista | null)[] = [];
  let recorde = false;
  if (eu) {
    xpGanho = eu.entregas * 20 + Math.round(eu.dinheiro / 10) + 15;
    const lista = [...r.jogadores].sort((a, b) => b.dinheiro - a.dinheiro);
    const venceu = modo === 'individual' && lista.length > 1 && lista[0].id === meuId;
    if (venceu) xpGanho += 60;
    d.xp += xpGanho;
    d.partidas++;
    if (eu.dinheiro > d.recordes.dinheiro) {
      d.recordes.dinheiro = eu.dinheiro;
      recorde = true;
    }
    d.recordes.entregas = Math.max(d.recordes.entregas, eu.entregas);
    gravar(d);
    if (eu.capotadas >= 5) novas.push(desbloquear('capotador'));
    if (eu.dinheiro >= 1000) novas.push(desbloquear('rico'));
    if (modo === 'van') novas.push(desbloquear('equipe'));
    if (venceu) novas.push(desbloquear('vencedor'));
  }
  return { xpGanho, recorde, novas: novas.filter((c): c is Conquista => !!c), ...resumo() };
}
