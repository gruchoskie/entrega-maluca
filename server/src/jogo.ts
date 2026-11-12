// Lógica autoritativa da partida: tempo, pedidos, pacotes, dinheiro e eventos de caos.
// O cliente só prevê o movimento do próprio corpo; todo o resto é decidido aqui.
//
// Modos:
//  - equipe:     todos veem os mesmos pedidos e cooperam.
//  - individual: cada jogador tem os seus pedidos; vence quem ganhar mais.
//  - van:        todos no mesmo carro, cada um com um papel (motorista, navegador, entregador, gerente).
import {
  CENTROS, ESTRADAS, LIMITE, PONTOS_COLETA, PONTOS_ENTREGA, RAIO_PONTO, gerarCidade,
} from '../../shared/cidade';
import type {
  EventoCaos, JogoTick, Modo, MsgServidor, PacoteInfo, PedidoInfo, RankItem, Resultado, TipoCaos, TipoPacote,
} from '../../shared/protocolo';
import type { Jogador, Sala } from './sala';

const DURACAO = 360; // s de partida
const CONTAGEM = 4; // s de contagem regressiva
const GRAV = 22;
const MAX_ATIVOS_VAN = 3; // pedidos aceitos ao mesmo tempo no modo van
const OFERTA_MS = 28000; // quanto tempo uma oferta fica esperando o gerente
const BASE: Record<TipoPacote, number> = { leve: 40, pesado: 90, fragil: 75, liquido: 65 };
const SORTEIO: TipoPacote[] = ['leve', 'leve', 'leve', 'leve', 'pesado', 'pesado', 'fragil', 'fragil', 'liquido', 'liquido'];
const CORES_PEDIDO = ['#ff5a5f', '#4a7bff', '#4cd964', '#ffb020', '#b061ff', '#2ec4d6'];
const EVENTOS: TipoCaos[] = ['chuva', 'transito', 'obras', 'buraco', 'vento'];

interface Pacote {
  id: number;
  tipo: TipoPacote;
  pedido: PedidoInfo;
  estado: 'coleta' | 'carregado' | 'livre';
  dono: string | null;
  ultimo: string | null; // quem mexeu por último (recebe o crédito da entrega)
  pos: [number, number, number];
  vel: [number, number, number];
  integ: number;
}

interface Stats {
  entregas: number;
  dinheiro: number;
  quebrados: number;
  capIni: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const dist2d = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export class Jogo {
  private pedidos: PedidoInfo[] = [];
  private pacotes = new Map<number, Pacote>();
  private inicio = Date.now() + CONTAGEM * 1000;
  private fim = this.inicio + DURACAO * 1000;
  private proxPedido = new Map<string, number>(); // por jogador (individual) ou "*" (equipe/van)
  private proxId = 1;
  private proxEvento = this.inicio + 30000;
  private idEvento = 1;
  private evento: EventoCaos | null = null;
  private dinheiro = 0;
  private entregas = 0;
  private perdidos = 0;
  private acabou = false;
  private stats = new Map<string, Stats>();
  /** Pose da van (modo van): vem do cliente do motorista enquanto ele não está a pé. */
  private van = { p: [0, 1, -10], q: [0, 0, 0, 1], v: [0, 0, 0] };

  constructor(private sala: Sala, readonly modo: Modo) {
    for (const j of sala.jogadores.values()) this.stat(j);
  }

  private stat(j: Jogador): Stats {
    let s = this.stats.get(j.id);
    if (!s) this.stats.set(j.id, (s = { entregas: 0, dinheiro: 0, quebrados: 0, capIni: j.cap }));
    return s;
  }

  private fx(m: Extract<MsgServidor, { t: 'fx' }>) {
    this.sala.enviarTodos(m);
  }

  private motorista(): Jogador | undefined {
    return [...this.sala.jogadores.values()].find((j) => j.papeis.includes('motorista'));
  }

  /** Posição que vale para o jogador: no modo van, quem está dentro da van usa a posição da van. */
  private posDe(j: Jogador): number[] {
    return this.modo === 'van' && !j.aPe ? this.van.p : j.p;
  }

  // ---------------------------------------------------------------------------
  // Laço (chamado ~15x/s pela sala)
  // ---------------------------------------------------------------------------
  atualizar(dt: number) {
    if (this.acabou) return;
    const agora = Date.now();
    if (agora < this.inicio) return;
    if (agora >= this.fim) return this.terminar();

    // A van segue o motorista (enquanto ele não desce a pé, caso seja também o entregador)
    if (this.modo === 'van') {
      const m = this.motorista();
      if (m && !m.aPe && m.temEstado) this.van = { p: m.p, q: m.q, v: m.v };
    }

    // Pedidos vencidos viram "perdidos"; ofertas não aceitas somem
    for (const p of [...this.pedidos]) {
      if (p.estado === 'oferta' && agora >= p.ofertaFim) this.pedidos = this.pedidos.filter((x) => x.id !== p.id);
      else if (p.estado === 'ativo' && agora >= p.prazoFim) this.perder(p.id, 'perdido');
    }
    this.gerarPedidos(agora);

    for (const pk of [...this.pacotes.values()]) {
      if (pk.estado === 'carregado') {
        const d = pk.dono ? this.sala.jogadores.get(pk.dono) : undefined;
        if (!d) {
          this.soltar(pk, [0, 0, 0]);
          continue;
        }
        const p = this.posDe(d);
        pk.pos = [p[0], p[1] + 1.8, p[2]];
        const alvo = PONTOS_ENTREGA[pk.pedido.entrega];
        // No modo van, só o entregador a pé entrega
        const podeEntregar = this.modo !== 'van' || d.aPe;
        if (podeEntregar && dist2d(p[0], p[2], alvo.x, alvo.z) < RAIO_PONTO + 1) this.entregar(pk);
      } else if (pk.estado === 'livre') {
        this.simular(pk, dt);
        const alvo = PONTOS_ENTREGA[pk.pedido.entrega];
        if (pk.pos[1] < 1.6 && dist2d(pk.pos[0], pk.pos[2], alvo.x, alvo.z) < RAIO_PONTO) this.entregar(pk);
      }
    }

    // Eventos de caos: um por vez, com pausa entre eles
    if (!this.evento && agora >= this.proxEvento) this.iniciarEvento(agora);
    else if (this.evento && agora >= this.evento.fim) {
      this.evento = null;
      this.proxEvento = agora + rnd(18000, 32000);
    }
  }

  private gerarPedidos(agora: number) {
    if (this.modo === 'individual') {
      for (const j of this.sala.jogadores.values()) {
        const meus = this.pedidos.filter((p) => p.dono === j.id).length;
        if (meus < 2 && agora >= (this.proxPedido.get(j.id) ?? 0)) {
          this.novoPedido(agora, j.id, 'ativo');
          this.proxPedido.set(j.id, agora + rnd(9000, 14000));
        }
      }
    } else if (this.modo === 'van') {
      // Ofertas para o gerente decidir
      const ofertas = this.pedidos.filter((p) => p.estado === 'oferta').length;
      if (ofertas < 3 && agora >= (this.proxPedido.get('*') ?? 0)) {
        this.novoPedido(agora, null, 'oferta');
        this.proxPedido.set('*', agora + rnd(7000, 11000));
      }
    } else if (this.pedidos.length < 2 + this.sala.jogadores.size && agora >= (this.proxPedido.get('*') ?? 0)) {
      this.novoPedido(agora, null, 'ativo');
      this.proxPedido.set('*', agora + rnd(9000, 15000));
    }
  }

  tickInfo(): JogoTick {
    const agora = Date.now();
    const pacotes: PacoteInfo[] = [...this.pacotes.values()].map((p) => ({
      id: p.id,
      tipo: p.tipo,
      estado: p.estado,
      dono: p.dono,
      pos: [Math.round(p.pos[0] * 10) / 10, Math.round(p.pos[1] * 10) / 10, Math.round(p.pos[2] * 10) / 10],
      integ: Math.round(p.integ),
    }));
    return {
      contagem: Math.max(0, Math.ceil((this.inicio - agora) / 1000)),
      restante: Math.max(0, Math.round(((this.fim - Math.max(agora, this.inicio)) / 1000) * 10) / 10),
      pedidos: this.pedidos,
      pacotes,
      evento: this.evento,
      dinheiroPartida: this.dinheiro,
      modo: this.modo,
      ranking: this.ranking(),
    };
  }

  private ranking(): RankItem[] {
    return [...this.sala.jogadores.values()]
      .map((j) => {
        const s = this.stat(j);
        return { id: j.id, nome: j.nome, cor: j.cor, dinheiro: s.dinheiro, entregas: s.entregas };
      })
      .sort((a, b) => b.dinheiro - a.dinheiro);
  }

  // ---------------------------------------------------------------------------
  // Pedidos e pacotes
  // ---------------------------------------------------------------------------
  private novoPedido(agora: number, dono: string | null, estado: 'oferta' | 'ativo') {
    // Evita repetir uma coleta que já está em uso
    const usados = new Set(this.pedidos.map((p) => p.coleta));
    const livres = PONTOS_COLETA.map((_, i) => i).filter((i) => !usados.has(i));
    if (livres.length === 0) return;
    const coleta = livres[Math.floor(Math.random() * livres.length)];
    const entrega = Math.floor(Math.random() * PONTOS_ENTREGA.length);
    const c = PONTOS_COLETA[coleta];
    const e = PONTOS_ENTREGA[entrega];
    const d = dist2d(c.x, c.z, e.x, e.z);
    const tipo = SORTEIO[Math.floor(Math.random() * SORTEIO.length)];
    const id = this.proxId++;
    // No modo van a equipe anda a pé e troca de papéis: prazo mais folgado
    const prazoTotal = (28 + d / 5) * (this.modo === 'van' ? 1.5 : 1) * 1000;
    const pedido: PedidoInfo = {
      id, tipo, coleta, entrega,
      prazoFim: agora + prazoTotal,
      prazoTotal,
      base: Math.round(BASE[tipo] + d * 0.5),
      letra: String.fromCharCode(65 + ((id - 1) % 26)),
      cor: CORES_PEDIDO[(id - 1) % CORES_PEDIDO.length],
      dono,
      estado,
      ofertaFim: estado === 'oferta' ? agora + OFERTA_MS : 0,
    };
    this.pedidos.push(pedido);
    if (estado === 'ativo') this.criarPacote(pedido);
  }

  private criarPacote(pedido: PedidoInfo) {
    const c = PONTOS_COLETA[pedido.coleta];
    this.pacotes.set(pedido.id, {
      id: pedido.id, tipo: pedido.tipo, pedido, estado: 'coleta', dono: null, ultimo: null,
      pos: [c.x, 0.9, c.z], vel: [0, 0, 0], integ: 100,
    });
  }

  /** Modo van: o gerente aceita uma oferta e ela vira pedido ativo. */
  aceitar(j: Jogador, id: number) {
    if (this.modo !== 'van' || this.acabou || !j.papeis.includes('gerente')) return;
    const p = this.pedidos.find((x) => x.id === id && x.estado === 'oferta');
    if (!p) return;
    if (this.pedidos.filter((x) => x.estado === 'ativo').length >= MAX_ATIVOS_VAN) return;
    p.estado = 'ativo';
    p.ofertaFim = 0;
    p.prazoFim = Date.now() + p.prazoTotal;
    this.criarPacote(p);
  }

  /** Modo van: o entregador desce ou sobe da van. */
  van_(j: Jogador, acao: 'sair' | 'entrar') {
    if (this.modo !== 'van' || this.acabou || !j.papeis.includes('entregador')) return;
    if (acao === 'sair') {
      if (j.aPe) return;
      const vel = Math.hypot(this.van.v[0], this.van.v[2]);
      if (vel > 4) return; // só desce com a van quase parada
      j.aPe = true;
    } else if (j.aPe && dist2d(j.p[0], j.p[2], this.van.p[0], this.van.p[2]) < 7) {
      j.aPe = false;
    }
  }

  private remover(pk: Pacote) {
    this.pacotes.delete(pk.id);
    this.pedidos = this.pedidos.filter((p) => p.id !== pk.id);
  }

  private perder(id: number, k: 'perdido' | 'quebrou' | 'derramou') {
    const pk = this.pacotes.get(id);
    this.pedidos = this.pedidos.filter((p) => p.id !== id);
    if (!pk) return;
    this.pacotes.delete(id);
    this.perdidos++;
    this.fx({ t: 'fx', k, x: pk.pos[0], y: pk.pos[1], z: pk.pos[2], id: pk.dono ?? undefined });
  }

  private entregar(pk: Pacote) {
    const agora = Date.now();
    const frac = Math.max(0, (pk.pedido.prazoFim - agora) / pk.pedido.prazoTotal);
    // Danificado paga menos; sobrar tempo gera bônus
    const pagamento = Math.round(pk.pedido.base * (0.35 + 0.65 * (pk.integ / 100)) + pk.pedido.base * 0.5 * frac);
    this.dinheiro += pagamento;
    this.sala.dinheiro += pagamento;
    this.entregas++;
    const credito = pk.ultimo ? this.sala.jogadores.get(pk.ultimo) : undefined;
    if (credito) {
      const s = this.stat(credito);
      s.entregas++;
      s.dinheiro += pagamento;
    }
    const alvo = PONTOS_ENTREGA[pk.pedido.entrega];
    this.fx({ t: 'fx', k: 'entrega', x: alvo.x, y: 1, z: alvo.z, v: pagamento, id: pk.ultimo ?? undefined });
    this.remover(pk);
  }

  private soltar(pk: Pacote, vel: [number, number, number]) {
    pk.estado = 'livre';
    pk.dono = null;
    pk.vel = vel;
  }

  /** Física simples dos pacotes soltos/arremessados: gravidade, quique, atrito, prédios. */
  private simular(pk: Pacote, dt: number) {
    const predios = gerarCidade().predios;
    const h = dt / 2;
    for (let i = 0; i < 2; i++) {
      pk.vel[1] -= GRAV * h;
      pk.pos[0] += pk.vel[0] * h;
      pk.pos[1] += pk.vel[1] * h;
      pk.pos[2] += pk.vel[2] * h;
      if (pk.pos[1] < 0.45) {
        pk.pos[1] = 0.45;
        const vy = -pk.vel[1];
        if (vy > 3) {
          this.danoQueda(pk, vy);
          pk.vel[1] = vy * 0.3;
        } else pk.vel[1] = 0;
        pk.vel[0] *= 0.7;
        pk.vel[2] *= 0.7;
      }
      if (pk.pos[1] < 0.5) {
        pk.vel[0] *= 0.93;
        pk.vel[2] *= 0.93;
      }
      for (const b of predios) {
        const px = b.w / 2 + 0.4 - Math.abs(pk.pos[0] - b.x);
        const pz = b.d / 2 + 0.4 - Math.abs(pk.pos[2] - b.z);
        if (px > 0 && pz > 0 && pk.pos[1] < b.h) {
          if (px < pz) {
            pk.pos[0] += Math.sign(pk.pos[0] - b.x) * px;
            pk.vel[0] *= -0.3;
          } else {
            pk.pos[2] += Math.sign(pk.pos[2] - b.z) * pz;
            pk.vel[2] *= -0.3;
          }
        }
      }
      pk.pos[0] = Math.max(-LIMITE, Math.min(LIMITE, pk.pos[0]));
      pk.pos[2] = Math.max(-LIMITE, Math.min(LIMITE, pk.pos[2]));
      if (this.pacotes.get(pk.id) !== pk) return; // quebrou na queda
    }
  }

  private danoQueda(pk: Pacote, vy: number) {
    if (pk.tipo === 'fragil' && vy > 8) pk.integ -= (vy - 6) * 6;
    else if (pk.tipo === 'liquido' && vy > 6) pk.integ -= (vy - 4) * 4;
    this.verificarDestruido(pk);
  }

  private verificarDestruido(pk: Pacote) {
    if (pk.integ > 0) return;
    const ult = pk.ultimo ? this.sala.jogadores.get(pk.ultimo) : undefined;
    if (ult) this.stat(ult).quebrados++;
    this.perder(pk.id, pk.tipo === 'liquido' ? 'derramou' : 'quebrou');
  }

  // ---------------------------------------------------------------------------
  // Ações dos jogadores
  // ---------------------------------------------------------------------------
  private cargaDe(id: string) {
    return [...this.pacotes.values()].filter((p) => p.dono === id);
  }

  /** Pacotes que sofrem com o veículo de `j`: no modo van, os de quem está dentro da van. */
  private cargaNoVeiculo(j: Jogador) {
    if (this.modo !== 'van') return this.cargaDe(j.id);
    return [...this.pacotes.values()].filter((p) => {
      const d = p.dono ? this.sala.jogadores.get(p.dono) : undefined;
      return !!d && !d.aPe;
    });
  }

  /** Tecla E: pega um pacote próximo; se já está carregando, passa para um amigo ou arremessa. */
  acao(j: Jogador) {
    if (this.acabou || Date.now() < this.inicio) return;
    if (this.modo === 'van' && (!j.papeis.includes('entregador') || !j.aPe)) return;
    const cap = 1 + this.sala.upgrades.capacidade;
    const minhas = this.cargaDe(j.id);
    const p0 = this.posDe(j);

    if (minhas.length < cap) {
      let melhor: Pacote | null = null;
      let md = Infinity;
      for (const pk of this.pacotes.values()) {
        if (pk.estado === 'carregado') continue;
        if (this.modo === 'individual' && pk.pedido.dono !== j.id) continue; // cada um com os seus
        const alcance = pk.estado === 'coleta' ? RAIO_PONTO + 1.5 : 5.5;
        const d = dist2d(p0[0], p0[2], pk.pos[0], pk.pos[2]);
        if (d < alcance && d < md) {
          md = d;
          melhor = pk;
        }
      }
      if (melhor) {
        melhor.estado = 'carregado';
        melhor.dono = j.id;
        melhor.ultimo = j.id;
        this.fx({ t: 'fx', k: 'pegou', x: melhor.pos[0], y: melhor.pos[1], z: melhor.pos[2], id: j.id });
        return;
      }
    }
    if (minhas.length === 0) return;

    // Passar para um amigo próximo (só no modo equipe)
    if (this.modo === 'equipe') {
      for (const o of this.sala.jogadores.values()) {
        if (o.id === j.id || !o.temEstado) continue;
        if (dist2d(j.p[0], j.p[2], o.p[0], o.p[2]) < 8 && this.cargaDe(o.id).length < cap) {
          const pk = minhas[0];
          pk.dono = o.id;
          pk.ultimo = o.id;
          this.fx({ t: 'fx', k: 'pegou', x: o.p[0], y: o.p[1] + 1.5, z: o.p[2], id: o.id });
          return;
        }
      }
    }

    // Arremessa para a frente, somando a velocidade
    const [qx, qy, qz, qw] = j.q;
    let fx = 2 * (qx * qz + qw * qy);
    let fz = 1 - 2 * (qx * qx + qy * qy);
    const n = Math.hypot(fx, fz) || 1;
    fx /= n;
    fz /= n;
    const pk = minhas[minhas.length - 1];
    pk.pos = [p0[0] + fx * 2.4, p0[1] + 1.6, p0[2] + fz * 2.4];
    this.soltar(pk, [j.v[0] + fx * 13, 6.5, j.v[2] + fz * 13]);
    pk.ultimo = j.id;
  }

  /** Impacto forte do veículo (g = variação brusca de velocidade em m/s). */
  impacto(j: Jogador, g: number) {
    if (!Number.isFinite(g) || this.acabou) return;
    g = Math.min(g, 25);
    const p = this.posDe(j);
    for (const pk of this.cargaNoVeiculo(j)) {
      if (pk.tipo === 'leve' && g >= 5.5) {
        // Pacote leve "cai fácil": sai voando
        pk.pos = [p[0], p[1] + 1.8, p[2]];
        this.soltar(pk, [rnd(-3, 3), 5, rnd(-3, 3)]);
        this.fx({ t: 'fx', k: 'caiu', x: pk.pos[0], y: pk.pos[1], z: pk.pos[2], id: j.id });
      } else if (pk.tipo === 'fragil' && g > 3) {
        pk.integ -= (g - 3) * 7;
        this.verificarDestruido(pk);
      } else if (pk.tipo === 'liquido' && g > 3) {
        pk.integ -= g * 1.5;
        this.verificarDestruido(pk);
      }
    }
  }

  /** Balanço do carro (curvas/freadas bruscas): líquido derrama aos poucos. */
  balanco(j: Jogador, v: number) {
    if (!Number.isFinite(v) || v <= 0 || this.acabou) return;
    for (const pk of this.cargaNoVeiculo(j)) {
      if (pk.tipo !== 'liquido') continue;
      pk.integ -= Math.min(v, 20) * 0.5;
      this.verificarDestruido(pk);
    }
  }

  aoSair(id: string) {
    for (const pk of this.cargaDe(id)) {
      const d = this.sala.jogadores.get(id);
      if (d) {
        const p = this.posDe(d);
        pk.pos = [p[0], p[1] + 1.5, p[2]];
      }
      this.soltar(pk, [0, 3, 0]);
    }
  }

  // ---------------------------------------------------------------------------
  // Eventos de caos
  // ---------------------------------------------------------------------------
  private iniciarEvento(agora: number) {
    const tipo = EVENTOS[Math.floor(Math.random() * EVENTOS.length)];
    const dur = rnd(25, 40) * 1000;
    const ev: EventoCaos = { id: this.idEvento++, tipo, fim: agora + dur, x: 0, z: 0, ang: 0 };
    const interior = ESTRADAS.slice(1, -1);
    const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    if (tipo === 'obras') {
      // Barricadas atravessando metade de uma rua, no meio de um trecho
      const vertical = Math.random() < 0.5;
      if (vertical) { ev.x = pick(interior); ev.z = pick(CENTROS); ev.ang = 0; }
      else { ev.x = pick(CENTROS); ev.z = pick(interior); ev.ang = Math.PI / 2; }
    } else if (tipo === 'buraco') {
      do {
        ev.x = pick(interior);
        ev.z = pick(interior);
      } while (Math.abs(ev.x) < 20 && Math.abs(ev.z) < 20);
    } else if (tipo === 'vento') {
      ev.ang = Math.random() * Math.PI * 2;
    }
    this.evento = ev;
  }

  // ---------------------------------------------------------------------------
  // Fim de partida
  // ---------------------------------------------------------------------------
  private terminar() {
    this.acabou = true;
    const lista = [...this.sala.jogadores.values()].map((j) => {
      const s = this.stat(j);
      return {
        id: j.id, nome: j.nome, cor: j.cor,
        entregas: s.entregas, dinheiro: s.dinheiro, quebrados: s.quebrados,
        capotadas: Math.max(0, j.cap - s.capIni),
      };
    });
    const topo = [...lista].sort((a, b) => b.dinheiro - a.dinheiro)[0];
    const capotador = [...lista].sort((a, b) => b.capotadas - a.capotadas)[0];
    let estatistica = 'Ninguém capotou! Será que alguém estava dirigindo mesmo?';
    if (capotador && capotador.capotadas > 0) {
      const n = capotador.capotadas;
      estatistica =
        n >= 4
          ? `${capotador.nome} capotou ${n} vezes e passou mais tempo de cabeça para baixo do que em pé!`
          : `${capotador.nome} capotou ${n} ${n === 1 ? 'vez' : 'vezes'}. O seguro agradece!`;
    }
    if (this.perdidos > 0) estatistica += ` ${this.perdidos} encomenda${this.perdidos > 1 ? 's' : ''} não chegou${this.perdidos > 1 ? 'ram' : ''} ao destino.`;
    const r: Resultado = {
      modo: this.modo,
      dinheiroTotal: this.dinheiro,
      entregas: this.entregas,
      perdidos: this.perdidos,
      jogadores: lista,
      entregador: topo && topo.entregas > 0 ? topo.nome : 'Ninguém (zero entregas!)',
      estatistica,
    };
    this.sala.fase = 'resultado';
    this.sala.enviarSala();
    this.sala.enviarTodos({ t: 'resultado', r });
  }
}
