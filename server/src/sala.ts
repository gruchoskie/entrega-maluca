// Uma sala de jogo: jogadores, perfis, repasse de posições e (nas próximas fases) a partida.
import type WebSocket from 'ws';
import { MAX_JOGADORES, NIVEL_MAX, PRECO_BUZINA, PRECO_CHAPEU, PRECO_UPGRADE } from '../../shared/constantes';
import { Jogo } from './jogo';
import {
  BUZINAS,
  CHAPEUS,
  MODOS,
  VEICULOS,
  type Buzina,
  type Chapeu,
  type Fase,
  type JogadorInfo,
  type MsgCliente,
  type Modo,
  type MsgServidor,
  type Papel,
  type PerfilMsg,
  type SalaInfo,
} from '../../shared/protocolo';

export interface Jogador extends JogadorInfo {
  ws: WebSocket;
  p: number[];
  q: number[];
  v: number[];
  cap: number; // capotadas
  temEstado: boolean;
  aPe: boolean; // modo van: o entregador desceu da van
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: unknown, def = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : def);

/** Limpa e valida o perfil vindo do cliente (nunca confie no cliente). */
export function validarPerfil(m: Partial<PerfilMsg>, atual?: JogadorInfo, donos?: SalaInfo['cosmeticos']) {
  const nome = typeof m.nome === 'string' ? m.nome.replace(/[<>]/g, '').trim().slice(0, 14) : undefined;
  const cor = typeof m.cor === 'string' && /^#[0-9a-f]{6}$/i.test(m.cor) ? m.cor : undefined;
  const veic = VEICULOS.includes(m.veic as never) ? m.veic : undefined;
  let chapeu = CHAPEUS.includes(m.chapeu as never) ? m.chapeu : undefined;
  let buzina = BUZINAS.includes(m.buzina as never) ? m.buzina : undefined;
  // Só pode usar cosméticos que a equipe já comprou
  if (donos) {
    if (chapeu && !donos.chapeus.includes(chapeu)) chapeu = undefined;
    if (buzina && !donos.buzinas.includes(buzina)) buzina = undefined;
  }
  return {
    nome: nome || atual?.nome || 'Entregador',
    cor: cor ?? atual?.cor ?? '#ff5a5f',
    veic: veic ?? atual?.veic ?? 'scooter',
    chapeu: chapeu ?? atual?.chapeu ?? 'nenhum',
    buzina: buzina ?? atual?.buzina ?? 'padrao',
  };
}

export class Sala {
  readonly jogadores = new Map<string, Jogador>();
  anfitriao = '';
  fase: Fase = 'lobby';
  dinheiro = Number(process.env.DINHEIRO_INICIAL ?? 0) || 0; // só para testes: DINHEIRO_INICIAL=2000
  upgrades = { velocidade: 0, estabilidade: 0, capacidade: 0 };
  cosmeticos: SalaInfo['cosmeticos'] = { chapeus: ['nenhum'], buzinas: ['padrao'] };
  jogo: Jogo | null = null;
  modo: Modo = 'equipe';
  private ultimoTick = Date.now();

  constructor(readonly codigo: string) {}

  get cheia() {
    return this.jogadores.size >= MAX_JOGADORES;
  }

  info(): SalaInfo {
    return {
      codigo: this.codigo,
      anfitriao: this.anfitriao,
      fase: this.fase,
      modo: this.modo,
      jogadores: [...this.jogadores.values()].map(({ id, nome, cor, veic, chapeu, buzina, slot, papeis }) => ({
        id, nome, cor, veic, chapeu, buzina, slot, papeis,
      })),
      dinheiro: this.dinheiro,
      upgrades: this.upgrades,
      cosmeticos: this.cosmeticos,
    };
  }

  enviar(j: Jogador, msg: MsgServidor) {
    if (j.ws.readyState === 1) j.ws.send(JSON.stringify(msg));
  }

  enviarTodos(msg: MsgServidor, exceto?: string) {
    const texto = JSON.stringify(msg);
    for (const j of this.jogadores.values()) {
      if (j.id !== exceto && j.ws.readyState === 1) j.ws.send(texto);
    }
  }

  enviarSala() {
    this.enviarTodos({ t: 'sala', sala: this.info() });
  }

  adicionar(id: string, ws: WebSocket, perfil: PerfilMsg): Jogador {
    const usados = new Set([...this.jogadores.values()].map((j) => j.slot));
    let slot = 0;
    while (usados.has(slot)) slot++;
    const p = validarPerfil(perfil, undefined, this.cosmeticos);
    const j: Jogador = {
      id, ws, slot, ...p, p: [0, 1, 0], q: [0, 0, 0, 1], v: [0, 0, 0], cap: 0, temEstado: false,
      aPe: false,
      // Quem entra no meio de uma partida em modo van vira navegador (ajuda a achar o caminho)
      papeis: this.fase === 'jogo' && this.modo === 'van' ? ['navegador'] : [],
    };
    this.jogadores.set(id, j);
    if (!this.anfitriao) this.anfitriao = id;
    this.enviar(j, { t: 'bemvindo', id, sala: this.info() });
    this.enviarSala();
    return j;
  }

  /** @returns true se a sala ficou vazia. */
  remover(id: string): boolean {
    this.jogo?.aoSair(id);
    this.jogadores.delete(id);
    if (this.anfitriao === id) this.anfitriao = [...this.jogadores.keys()][0] ?? '';
    this.enviarSala();
    return this.jogadores.size === 0;
  }

  receber(j: Jogador, m: MsgCliente) {
    switch (m.t) {
      case 'estado': {
        if (!Array.isArray(m.p) || !Array.isArray(m.q) || !Array.isArray(m.v)) return;
        j.p = m.p.slice(0, 3).map((n) => num(n));
        j.q = m.q.slice(0, 4).map((n) => num(n));
        j.v = m.v.slice(0, 3).map((n) => num(n));
        j.cap = Math.max(j.cap, Math.floor(num(m.cap)));
        j.temEstado = true;
        break;
      }
      case 'perfil': {
        Object.assign(j, validarPerfil(m, j, this.cosmeticos));
        this.enviarSala();
        break;
      }
      case 'buzina':
        this.enviarTodos({ t: 'buzina', id: j.id });
        break;
      case 'modo':
        if (j.id === this.anfitriao && this.fase === 'lobby' && MODOS.includes(m.modo)) {
          this.modo = m.modo;
          this.enviarSala();
        }
        break;
      case 'iniciar':
        if (j.id === this.anfitriao && this.fase === 'lobby') {
          this.atribuirPapeis();
          this.fase = 'jogo';
          this.jogo = new Jogo(this, this.modo);
          this.enviarSala();
        }
        break;
      case 'aceitar':
        if (this.fase === 'jogo') this.jogo?.aceitar(j, Number(m.id));
        break;
      case 'van':
        if (this.fase === 'jogo') this.jogo?.van_(j, m.acao === 'entrar' ? 'entrar' : 'sair');
        break;
      case 'voltar':
        if (j.id === this.anfitriao && this.fase === 'resultado') {
          this.fase = 'lobby';
          this.jogo = null;
          this.enviarSala();
        }
        break;
      case 'comprar':
        this.comprar(j, String(m.item ?? ''));
        break;
      case 'acao':
        if (this.fase === 'jogo') this.jogo?.acao(j);
        break;
      case 'impacto':
        if (this.fase === 'jogo') this.jogo?.impacto(j, m.g);
        break;
      case 'balanco':
        if (this.fase === 'jogo') this.jogo?.balanco(j, m.v);
        break;
      default:
        break;
    }
  }

  /**
   * Modo van: reparte os papéis pelo número de jogadores.
   * 1: tudo com você · 2: dirige+navega / desce+aceita · 3: dirige / navega+aceita / desce · 4: um papel cada.
   */
  private atribuirPapeis() {
    const lista = [...this.jogadores.values()].sort((a, b) => a.slot - b.slot);
    const tabela: Papel[][][] = [
      [],
      [['motorista', 'navegador', 'entregador', 'gerente']],
      [['motorista', 'navegador'], ['entregador', 'gerente']],
      [['motorista'], ['navegador', 'gerente'], ['entregador']],
      [['motorista'], ['navegador'], ['entregador'], ['gerente']],
    ];
    lista.forEach((j, i) => {
      j.papeis = this.modo === 'van' ? tabela[lista.length][i] : [];
      j.aPe = false;
    });
  }

  /** Compra na loja da equipe: "up:velocidade", "chapeu:coroa", "buzina:patinho". */
  private comprar(j: Jogador, item: string) {
    if (this.fase === 'jogo') return;
    const [tipo, nome] = item.split(':');
    let preco = -1;
    let aplicar: (() => void) | null = null;

    if (tipo === 'up' && nome in this.upgrades) {
      const chave = nome as keyof typeof this.upgrades;
      const nivel = this.upgrades[chave];
      if (nivel >= NIVEL_MAX) return;
      preco = PRECO_UPGRADE[nivel];
      aplicar = () => this.upgrades[chave]++;
    } else if (tipo === 'chapeu' && nome in PRECO_CHAPEU && !this.cosmeticos.chapeus.includes(nome as Chapeu)) {
      preco = PRECO_CHAPEU[nome];
      aplicar = () => this.cosmeticos.chapeus.push(nome as Chapeu);
    } else if (tipo === 'buzina' && nome in PRECO_BUZINA && !this.cosmeticos.buzinas.includes(nome as Buzina)) {
      preco = PRECO_BUZINA[nome];
      aplicar = () => this.cosmeticos.buzinas.push(nome as Buzina);
    }
    if (!aplicar || preco < 0) return;
    if (this.dinheiro < preco) return this.enviar(j, { t: 'erro', msg: 'Dinheiro insuficiente na equipe.' });
    this.dinheiro -= preco;
    aplicar();
    this.enviarSala();
  }

  /** Chamado ~15 vezes por segundo. */
  tick() {
    if (this.jogadores.size === 0) return;
    const agora = Date.now();
    const dt = Math.min(0.2, (agora - this.ultimoTick) / 1000);
    this.ultimoTick = agora;
    if (this.fase === 'jogo') this.jogo?.atualizar(dt);
    const ids: string[] = [];
    const j: number[][] = [];
    for (const p of this.jogadores.values()) {
      if (!p.temEstado) continue;
      ids.push(p.id);
      j.push([...p.p, ...p.q, ...p.v, p.cap, p.aPe ? 1 : 0].map(r2));
    }
    this.enviarTodos({ t: 'tick', agora, ids, j, jogo: this.fase === 'jogo' ? this.jogo?.tickInfo() : undefined });
  }
}
