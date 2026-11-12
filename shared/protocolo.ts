// Tipos e mensagens compartilhados entre cliente e servidor.
// Sem dependências de DOM/Node: pode ser importado pelos dois lados.

export type TipoVeiculo = 'scooter' | 'van' | 'carrinho';
export type TipoPacote = 'leve' | 'pesado' | 'fragil' | 'liquido';
export type Fase = 'lobby' | 'jogo' | 'resultado';
export type Chapeu = 'nenhum' | 'cartola' | 'cowboy' | 'coroa' | 'festa';
export type Buzina = 'padrao' | 'patinho' | 'caminhao' | 'melodia';

export const VEICULOS: TipoVeiculo[] = ['scooter', 'van', 'carrinho'];
export const CHAPEUS: Chapeu[] = ['nenhum', 'cartola', 'cowboy', 'coroa', 'festa'];
export const BUZINAS: Buzina[] = ['padrao', 'patinho', 'caminhao', 'melodia'];
export const CORES = ['#ff5a5f', '#ffb020', '#ffe14d', '#4cd964', '#2ec4d6', '#4a7bff', '#b061ff', '#ff7ac8'];

export interface JogadorInfo {
  id: string;
  nome: string;
  cor: string;
  veic: TipoVeiculo;
  chapeu: Chapeu;
  buzina: Buzina;
  slot: number; // 0..3: posição de largada
}

export interface Upgrades {
  velocidade: number; // níveis 0..3
  estabilidade: number;
  capacidade: number;
}

export interface Cosmeticos {
  chapeus: Chapeu[];
  buzinas: Buzina[];
}

/** Retrato da sala (enviado a cada mudança de lobby/jogadores). */
export interface SalaInfo {
  codigo: string;
  anfitriao: string;
  fase: Fase;
  jogadores: JogadorInfo[];
  dinheiro: number; // carteira da equipe
  upgrades: Upgrades;
  cosmeticos: Cosmeticos;
}

// ---------- Fase 4: pedidos e pacotes ----------
export interface PedidoInfo {
  id: number;
  tipo: TipoPacote;
  coleta: number; // índice do ponto de coleta
  entrega: number; // índice do ponto de entrega
  prazoFim: number; // Date.now() do servidor
  prazoTotal: number; // ms
  base: number; // pagamento base
  letra: string; // A, B, C...
  cor: string;
}

export interface PacoteInfo {
  id: number; // = id do pedido
  tipo: TipoPacote;
  estado: 'coleta' | 'carregado' | 'livre';
  dono: string | null;
  pos: [number, number, number];
  integ: number; // 0..100
}

// ---------- Fase 5: eventos de caos ----------
export type TipoCaos = 'chuva' | 'transito' | 'obras' | 'buraco' | 'vento';
export interface EventoCaos {
  id: number;
  tipo: TipoCaos;
  fim: number; // Date.now() do servidor
  x: number;
  z: number;
  ang: number;
}

export interface ResultadoJogador {
  id: string;
  nome: string;
  cor: string;
  entregas: number;
  dinheiro: number;
  capotadas: number;
  quebrados: number;
}

export interface Resultado {
  dinheiroTotal: number;
  entregas: number;
  perdidos: number;
  jogadores: ResultadoJogador[];
  entregador: string; // nome do "entregador do dia"
  estatistica: string; // frase engraçada
}

// ---------- Mensagens cliente → servidor ----------
export interface PerfilMsg {
  nome: string;
  cor: string;
  veic: TipoVeiculo;
  chapeu: Chapeu;
  buzina: Buzina;
}

export type MsgCliente =
  | ({ t: 'criar' } & PerfilMsg)
  | ({ t: 'entrar'; codigo: string } & PerfilMsg)
  | ({ t: 'perfil' } & Partial<PerfilMsg>)
  | { t: 'estado'; p: number[]; q: number[]; v: number[]; cap: number }
  | { t: 'buzina' }
  | { t: 'iniciar' }
  | { t: 'acao' } // tecla E: pegar / passar / arremessar
  | { t: 'impacto'; g: number }
  | { t: 'balanco'; v: number }
  | { t: 'comprar'; item: string }
  | { t: 'voltar' };

// ---------- Mensagens servidor → cliente ----------
export type MsgServidor =
  | { t: 'bemvindo'; id: string; sala: SalaInfo }
  | { t: 'sala'; sala: SalaInfo }
  | { t: 'erro'; msg: string }
  | { t: 'buzina'; id: string }
  | {
      t: 'tick';
      agora: number; // Date.now() do servidor
      j: number[][]; // por jogador: [idx, px,py,pz, qx,qy,qz,qw, vx,vy,vz, capotadas]
      ids: string[]; // ids na mesma ordem de `j`
      jogo?: JogoTick;
    }
  | { t: 'fx'; k: 'entrega' | 'quebrou' | 'derramou' | 'caiu' | 'pegou' | 'perdido'; x: number; y: number; z: number; v?: number; id?: string }
  | { t: 'resultado'; r: Resultado };

export interface JogoTick {
  contagem: number; // segundos até a largada (0 = já começou)
  restante: number; // segundos
  pedidos: PedidoInfo[];
  pacotes: PacoteInfo[];
  evento: EventoCaos | null;
  dinheiroPartida: number;
}
