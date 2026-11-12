// Interface em HTML: menu inicial, painel do lobby e botão de mudo. (HUD e resultados: Fase 4.)
import { NIVEL_MAX, PRECO_BUZINA, PRECO_CHAPEU, PRECO_UPGRADE } from '../../../shared/constantes';
import {
  BUZINAS, CHAPEUS, CORES, DIFICULDADES, DURACOES, EMOTES, FRASES, MAPAS, MODOS, VEICULOS,
  type Buzina, type Chapeu, type Dificuldade, type Mapa, type Modo, type Papel, type PerfilMsg, type SalaInfo,
  type SalaPublica, type TipoVeiculo, type Upgrades,
} from '../../../shared/protocolo';
import { INFO_PAPEL, NOME_MODO } from './hud';
import { CONQUISTAS, CORES_EXTRAS, resumo } from './progresso';

const ROTULO_MAPA: Record<Mapa, string> = { cidade: '🏙️ Cidade', litoral: '🏖️ Litoral', inverno: '❄️ Inverno' };
const ROTULO_DIF: Record<Dificuldade, string> = { facil: '😌 Fácil', normal: '🙂 Normal', caotico: '🔥 Caótico' };

/** Mesma distribuição de papéis do servidor (para mostrar a prévia no lobby). */
const DISTRIBUICAO: Papel[][][] = [
  [],
  [['motorista', 'navegador', 'entregador', 'gerente']],
  [['motorista', 'navegador'], ['entregador', 'gerente']],
  [['motorista'], ['navegador', 'gerente'], ['entregador']],
  [['motorista'], ['navegador'], ['entregador'], ['gerente']],
];
import { buzinar, definirMudo, estaMudo } from '../audio/audio';
import { Previa } from './previa';

const ROTULO_CHAPEU: Record<Chapeu, string> = {
  nenhum: '🚫 Sem chapéu', cartola: '🎩 Cartola', cowboy: '🤠 Cowboy', coroa: '👑 Coroa', festa: '🥳 Festa',
};
const ROTULO_BUZINA: Record<Buzina, string> = {
  padrao: '📯 Padrão', patinho: '🦆 Patinho', caminhao: '🚛 Caminhão', melodia: '🎶 Melodia',
};
const UPGRADES: { chave: keyof Upgrades; nome: string; desc: string }[] = [
  { chave: 'velocidade', nome: '⚡ Velocidade', desc: '+7% de velocidade e +8% de aceleração por nível' },
  { chave: 'estabilidade', nome: '🛡️ Estabilidade', desc: 'Mais aderência e se endireita mais rápido' },
  { chave: 'capacidade', nome: '📦 Capacidade', desc: 'Carrega +1 pacote por nível' },
];

export const NOME_VEICULO: Record<TipoVeiculo, string> = {
  scooter: '🛵 Scooter',
  moto: '🏍️ Moto',
  van: '🚐 Van',
  picape: '🛻 Picape',
  carrinho: '🛒 Carrinho',
};

const CHAVE = 'em-perfil';

/** Descrição e características (1 a 5) mostradas na escolha do veículo. */
const DADOS_VEICULO: Record<TipoVeiculo, { texto: string; vel: number; agil: number; estab: number }> = {
  scooter: { texto: 'Rápida e ágil, ótima para entregas urgentes. Mas capota com facilidade!', vel: 5, agil: 4, estab: 2 },
  van: { texto: 'Grandalhona e estável: aguenta batidas, mas faz curvas como um navio.', vel: 3, agil: 2, estab: 5 },
  carrinho: { texto: 'Pequeno, quicante e super ágil. Perfeito para quem gosta de bagunça!', vel: 2, agil: 5, estab: 2 },
  moto: { texto: 'A mais veloz da cidade! Corta o trânsito, mas é nervosa e tomba fácil.', vel: 5, agil: 4, estab: 1 },
  picape: { texto: 'Caçamba aberta e boa de pancada: equilibrada para quem quer segurança e velocidade.', vel: 4, agil: 3, estab: 4 },
};

const APELIDOS = ['Zé Pizza', 'Moto Maluca', 'Dona Pressa', 'Rei do Frete', 'Capota Mole', 'Sr. Buzina', 'Rodinha', 'Turbo Zé', 'Pé de Chumbo', 'Frete Veloz', 'Tia Entrega', 'Doido do Pacote'];
const sortearApelido = () => APELIDOS[Math.floor(Math.random() * APELIDOS.length)];

export function carregarPerfil(): PerfilMsg {
  const padrao: PerfilMsg = { nome: '', cor: CORES[0], veic: 'scooter', chapeu: 'nenhum', buzina: 'padrao' };
  try {
    return { ...padrao, ...JSON.parse(localStorage.getItem(CHAVE) ?? '{}') };
  } catch {
    return padrao;
  }
}

export function salvarPerfil(p: PerfilMsg) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(p));
  } catch {
    /* ignora */
  }
}

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function escapar(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export interface CallbacksMenu {
  aoCriar(p: PerfilMsg): void;
  aoEntrar(codigo: string, p: PerfilMsg): void;
}

export class Ui {
  private raiz = document.createElement('div');
  perfil = carregarPerfil();
  aoMudarPerfil: (p: Partial<PerfilMsg>) => void = () => {};
  aoIniciar: () => void = () => {};
  aoComprar: (item: string) => void = () => {};
  aoModo: (m: Modo) => void = () => {};
  aoConfig: (c: { duracao?: number; dificuldade?: Dificuldade; mapa?: Mapa; publica?: boolean }) => void = () => {};
  aoEmote: (k: string) => void = () => {};
  /** Liga/desliga o microfone (a voz é por proximidade). Devolve se o microfone ficou ligado. */
  aoMic: () => Promise<boolean> = async () => false;
  aoEntrarSala: (codigo: string) => void = () => {};
  private previa: Previa | null = null;
  private lojaPrevia: Previa | null = null;
  private lojaAberta = false;
  private ultimaSala: SalaInfo | null = null;

  constructor() {
    this.raiz.id = 'ui';
    document.body.appendChild(this.raiz);
    this.criarBarra();
  }

  /** Barra no canto superior direito: ajuda, qualidade (só PC) e som. */
  private criarBarra() {
    const barra = document.createElement('div');
    barra.id = 'barra';
    const botao = (id: string, texto: string, titulo: string, aoClicar: () => void) => {
      const b = document.createElement('button');
      b.id = id;
      b.title = titulo;
      b.textContent = texto;
      b.onclick = aoClicar;
      barra.appendChild(b);
      return b;
    };
    botao('btn-sair', '🏠', 'Sair da sala e voltar à tela inicial', () => this.sairDaSala());
    const mic = botao('btn-mic', '🎤', 'Voz por proximidade (liga o microfone)', async () => {
      mic.disabled = true;
      const ligado = await this.aoMic();
      mic.disabled = false;
      this.definirMic(ligado);
      if (!ligado && !navigator.mediaDevices?.getUserMedia) this.aviso('Este navegador não permite usar o microfone');
      else if (!ligado && mic.dataset.pediu === '1') this.aviso('Microfone desligado');
      mic.dataset.pediu = '1';
    });
    botao('btn-emote', '😀', 'Emotes e frases rápidas', () => this.abrirEmotes());
    botao('btn-trofeus', '🏆', 'Conquistas e recordes', () => this.mostrarConquistas());
    botao('btn-ajuda', '❓', 'Como jogar', () => this.mostrarTutorial());
    botao('btn-qualidade', 'Gráficos', 'Qualidade gráfica', () => this.aoQualidade());
    const som = botao('btn-mudo', '', 'Som', () => {
      definirMudo(!estaMudo());
      som.textContent = estaMudo() ? '🔇' : '🔊';
    });
    som.textContent = estaMudo() ? '🔇' : '🔊';
    document.body.appendChild(barra);
  }

  aoQualidade: () => void = () => {};
  celular = false;

  /** Mostra se o microfone está ligado (🎙️ verde) ou desligado (🎤). */
  definirMic(ligado: boolean) {
    const b = document.getElementById('btn-mic');
    if (!b) return;
    b.textContent = ligado ? '🎙️' : '🎤';
    b.classList.toggle('ligado', ligado);
    b.title = ligado ? 'Microfone ligado (toque para desligar)' : 'Voz por proximidade (liga o microfone)';
  }

  /** Painel de emotes e frases prontas. */
  private abrirEmotes() {
    const antigo = document.getElementById('painel-emote');
    if (antigo) return antigo.remove();
    const p = document.createElement('div');
    p.id = 'painel-emote';
    p.innerHTML = `<div class="emotes">${EMOTES.map((e) => `<button data-k="${e}">${e}</button>`).join('')}</div>
      <div class="frases">${FRASES.map((f) => `<button data-k="${f}">${f}</button>`).join('')}</div>`;
    p.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => {
      b.onclick = () => {
        this.aoEmote(b.dataset.k!);
        p.remove();
      };
    });
    document.body.appendChild(p);
  }

  /** Conquistas, nível e recordes (guardados neste navegador). */
  mostrarConquistas() {
    document.getElementById('tela-trofeus')?.remove();
    const r = resumo();
    const t = document.createElement('div');
    t.className = 'tela menu';
    t.id = 'tela-trofeus';
    t.style.zIndex = '12';
    t.innerHTML = `<div class="cartao troféus" style="width:min(460px,100%);max-height:90vh;overflow:auto">
      <h1>🏆 Conquistas</h1>
      <div class="nivel-grande">Nível ${r.nivel}<div class="xpbar"><i style="width:${r.fracao * 100}%"></i></div><small>${r.xp} XP · ${r.partidas} partida${r.partidas === 1 ? '' : 's'} · recorde R$ ${r.recordes.dinheiro.toLocaleString('pt-BR')} · ${r.recordes.entregas} entregas</small></div>
      <div class="lista-conq">${CONQUISTAS.map((c) => {
        const tem = r.conquistas.includes(c.id);
        return `<div class="conq${tem ? ' tem' : ''}"><span>${tem ? c.icone : '🔒'}</span><div><b>${c.nome}</b><small>${c.desc}</small></div></div>`;
      }).join('')}</div>
      <div class="rotulo">Cores desbloqueadas por nível</div>
      <div class="cores">${CORES_EXTRAS.map((c) => `<span class="cor ${r.nivel >= c.nivel ? '' : 'trancada'}" style="background:${c.cor}" title="Nível ${c.nivel}"></span>`).join('')}</div>
      <button class="primario" id="trof-fechar" style="margin-top:14px;width:100%">Fechar</button></div>`;
    this.raiz.appendChild(t);
    t.querySelector('#trof-fechar')!.addEventListener('click', () => t.remove());
  }

  /** Lista de salas públicas na tela inicial. */
  mostrarSalas(lista: SalaPublica[]) {
    const c = document.getElementById('m-salas');
    if (!c) return;
    c.innerHTML = lista.length
      ? `<div class="rotulo">Salas abertas</div>` +
        lista
          .map(
            (s) => `<button class="sala-aberta" data-cod="${s.codigo}"><b>${s.codigo}</b><span>${NOME_MODO[s.modo].icone} ${NOME_MODO[s.modo].nome} · ${ROTULO_MAPA[s.mapa]}</span><em>${s.jogadores}/4</em></button>`,
          )
          .join('')
      : '';
    c.querySelectorAll<HTMLButtonElement>('[data-cod]').forEach((b) => (b.onclick = () => this.aoEntrarSala(b.dataset.cod!)));
  }

  /** Resumo de nível na tela inicial. */
  private desenharNivel() {
    const n = document.getElementById('m-nivel');
    if (!n) return;
    const r = resumo();
    n.innerHTML = `Nv ${r.nivel}<div class="xpbar"><i style="width:${r.fracao * 100}%"></i></div>`;
  }

  /** Volta à tela inicial: recarrega sem o código da sala (a conexão fecha e o servidor tira você da sala). */
  sairDaSala() {
    // Confirmação própria (a janelinha nativa é bloqueada em alguns navegadores, como os de WhatsApp/Instagram)
    if (document.getElementById('tela-sair')) return;
    const t = document.createElement('div');
    t.className = 'tela menu';
    t.id = 'tela-sair';
    t.style.zIndex = '12';
    t.innerHTML = `<div class="cartao" style="max-width:340px;text-align:center">
      <h1 style="font-size:24px">Sair da sala?</h1>
      <p class="sub">Você volta para a tela inicial. Se estiver numa partida, ela continua para os outros.</p>
      <div class="acoes"><button class="primario" id="sair-sim">Sair</button>
      <button class="link" id="sair-nao">Continuar jogando</button></div></div>`;
    this.raiz.appendChild(t);
    t.querySelector('#sair-nao')!.addEventListener('click', () => t.remove());
    t.querySelector('#sair-sim')!.addEventListener('click', () => {
      // Recarrega sem o código da sala: a conexão fecha e o servidor tira você da sala
      window.location.assign(location.pathname);
    });
  }

  definirRotuloQualidade(txt: string) {
    const b = document.getElementById('btn-qualidade');
    if (b) b.textContent = '⚙️ ' + txt;
  }

  // ---------------------------------------------------------------------------
  // Tutorial rápido (aparece na primeira vez; o botão ❓ abre de novo)
  // ---------------------------------------------------------------------------
  mostrarTutorial() {
    document.getElementById('tela-tutorial')?.remove();
    const mover = this.celular ? 'Use o <b>joystick</b> à esquerda' : 'Use <b>W A S D</b> ou as <b>setas</b>';
    const pegar = this.celular ? 'o botão <b>📦</b>' : 'a tecla <b>E</b>';
    const passos = [
      { icone: '🛵', titulo: 'Dirija!', texto: `${mover} para dirigir. ${this.celular ? '<b>Pular</b> é o botão laranja.' : '<b>Espaço</b> pula (segure = freio de mão).'} Os veículos são desajeitados de propósito: capotar faz parte!` },
      { icone: '📦', titulo: 'Pegue a encomenda', texto: `Vá até o <b>pilar de luz com 📦</b> e aperte ${pegar}. Depois siga a <b>seta</b> sobre o seu veículo até o 🏁.` },
      { icone: '🥚', titulo: 'Cuidado com a carga', texto: '🎈 <b>Leve</b> cai em batidas · 🧱 <b>Pesado</b> deixa lento · 🥚 <b>Frágil</b> quebra · 💧 <b>Líquido</b> derrama nas curvas. Dá para <b>passar</b> para um amigo ou <b>arremessar</b> (mesma tecla de pegar).' },
      { icone: '💰', titulo: 'Em equipe!', texto: 'Cada entrega paga mais se chegar inteira e rápido. O dinheiro é de todos: gaste na <b>loja</b> do lobby. Atenção aos <b>eventos de caos</b>: chuva, trânsito, obras, buracos e vento!' },
    ];
    let i = 0;
    const t = document.createElement('div');
    t.className = 'tela';
    t.id = 'tela-tutorial';
    const desenhar = () => {
      const p = passos[i];
      const ultimo = i === passos.length - 1;
      t.innerHTML = `<div class="cartao tutorial"><div class="icone">${p.icone}</div><h1>${p.titulo}</h1>
        <p>${p.texto}</p><div class="pontos">${passos.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <button class="primario" id="tut-prox">${ultimo ? 'Entendi, vamos lá!' : 'Próximo'}</button>
        <button class="link" id="tut-pular">Pular tutorial</button></div>`;
      t.querySelector('#tut-prox')!.addEventListener('click', () => (ultimo ? fechar() : (i++, desenhar())));
      t.querySelector('#tut-pular')!.addEventListener('click', fechar);
    };
    const fechar = () => {
      t.remove();
      try {
        localStorage.setItem('em-tutorial', '1');
      } catch {
        /* ignora */
      }
    };
    desenhar();
    this.raiz.appendChild(t);
  }

  /** Mostra o tutorial só na primeira vez neste aparelho. */
  tutorialSeNovo() {
    try {
      if (localStorage.getItem('em-tutorial')) return;
    } catch {
      /* se não há armazenamento, mostra sempre */
    }
    this.mostrarTutorial();
  }

  // ---------------------------------------------------------------------------
  // Menu inicial
  // ---------------------------------------------------------------------------
  mostrarMenu(cb: CallbacksMenu) {
    const codigoUrl = new URLSearchParams(location.search).get('sala')?.toUpperCase().slice(0, 4) ?? '';
    const div = document.createElement('div');
    div.className = 'tela';
    div.id = 'tela-menu';
    div.classList.add('menu');
    div.innerHTML = `
     <div class="menu-grade">
      <section class="cartao menu-previa">
        <div id="m-previa" class="previa"></div>
        <div id="m-info" class="info-veic"></div>
      </section>
      <div class="cartao menu-form">
        <div class="logo"><span class="logo-ico">🚚</span><h1>Entrega<br>Maluca</h1><button class="nivel" id="m-nivel" title="Conquistas e nível"></button></div>
        <p class="sub">Até 4 amigos, uma cidade e muitas encomendas!</p>
        <label class="campo">Seu apelido
          <span class="nome-linha">
            <input id="m-nome" maxlength="14" placeholder="Como te chamam?" autocomplete="off" />
            <button type="button" id="m-sorteio" title="Sortear um apelido" aria-label="Sortear apelido">🎲</button>
          </span>
        </label>
        <div class="rotulo">Cor do veículo</div>
        <div class="cores" id="m-cores"></div>
        <div class="rotulo">Escolha seu veículo</div>
        <div class="veic-cards" id="m-veic"></div>
        <div class="acoes">
          ${
            codigoUrl
              ? `<div class="convite">Você foi convidado para a sala <b>${escapar(codigoUrl)}</b></div>
                 <button class="primario" id="m-entrar-url">Entrar na sala</button>
                 <button class="link" id="m-outra">Criar minha própria sala</button>`
              : `<button class="primario" id="m-criar">Criar sala</button>
                 <div class="ou">ou entre com um código</div>
                 <div class="linha">
                   <input id="m-cod" maxlength="4" placeholder="CÓDIGO" autocomplete="off" />
                   <button id="m-entrar">Entrar</button>
                 </div>`
          }
        </div>
        ${codigoUrl ? '' : '<div id="m-salas" class="salas"></div>'}
        <div class="erro" id="m-erro"></div>
      </div>
     </div>`;
    this.raiz.appendChild(div);
    this.desenharNivel();
    el('m-nivel').onclick = () => this.mostrarConquistas();

    const nome = el<HTMLInputElement>('m-nome');
    nome.value = this.perfil.nome || sortearApelido();
    el('m-sorteio').onclick = () => {
      nome.value = sortearApelido();
      nome.focus();
    };
    // Preview 3D (se o WebGL falhar, o menu continua funcionando sem ele)
    try {
      this.previa = new Previa(el('m-previa'));
    } catch {
      this.previa = null;
    }
    this.atualizarPrevia();
    const coletar = (): PerfilMsg => {
      this.perfil.nome = nome.value.trim() || 'Entregador' + Math.floor(Math.random() * 90 + 10);
      salvarPerfil(this.perfil);
      return { ...this.perfil };
    };
    this.desenharSeletores('m-cores', 'm-veic');
    this.aoEntrarSala = (codigo) => cb.aoEntrar(codigo, coletar()); // clique numa sala aberta da lista

    const idc = (id: string) => document.getElementById(id);
    idc('m-criar')?.addEventListener('click', () => cb.aoCriar(coletar()));
    idc('m-entrar')?.addEventListener('click', () => cb.aoEntrar(el<HTMLInputElement>('m-cod').value, coletar()));
    idc('m-entrar-url')?.addEventListener('click', () => cb.aoEntrar(codigoUrl, coletar()));
    idc('m-outra')?.addEventListener('click', () => {
      history.replaceState(null, '', location.pathname);
      cb.aoCriar(coletar());
    });
  }

  erroMenu(msg: string) {
    const e = document.getElementById('m-erro');
    if (e) e.textContent = msg;
  }

  esconderMenu() {
    this.previa?.destruir();
    this.previa = null;
    document.getElementById('tela-menu')?.remove();
  }

  /** Atualiza o preview 3D e o texto/barras do veículo escolhido (só existem no menu). */
  private atualizarPrevia() {
    const info = document.getElementById('m-info');
    if (!info) return;
    this.previa?.definir(this.perfil.veic, this.perfil.cor);
    const d = DADOS_VEICULO[this.perfil.veic];
    const barra = (nome: string, v: number) =>
      `<div class="stat"><span>${nome}</span><i><b style="width:${v * 20}%"></b></i></div>`;
    info.innerHTML = `<h2>${NOME_VEICULO[this.perfil.veic]}</h2><p>${d.texto}</p>
      ${barra('Velocidade', d.vel)}${barra('Agilidade', d.agil)}${barra('Estabilidade', d.estab)}`;
  }

  /** Cores + veículos (usado no menu e no lobby). */
  private desenharSeletores(idCores: string, idVeic: string) {
    const c = el(idCores);
    c.innerHTML = '';
    const nivel = resumo().nivel;
    const todas = [...CORES.map((cor) => ({ cor, nivel: 1 })), ...CORES_EXTRAS];
    for (const { cor, nivel: exige } of todas) {
      const b = document.createElement('button');
      const trancada = nivel < exige;
      b.className = 'cor' + (cor === this.perfil.cor ? ' sel' : '') + (trancada ? ' trancada' : '');
      b.style.background = cor;
      b.setAttribute('aria-label', 'Cor ' + cor);
      if (trancada) {
        b.title = `Libera no nível ${exige}`;
        b.textContent = '🔒';
        b.onclick = () => this.aviso(`Essa cor libera no nível ${exige}. Jogue partidas para subir de nível!`);
        c.appendChild(b);
        continue;
      }
      b.onclick = () => {
        this.perfil.cor = cor;
        salvarPerfil(this.perfil);
        this.aoMudarPerfil({ cor });
        this.desenharSeletores(idCores, idVeic);
        this.atualizarPrevia();
      };
      c.appendChild(b);
    }
    const v = el(idVeic);
    v.innerHTML = '';
    const cartoes = idVeic === 'm-veic'; // no menu: cartões grandes; no lobby: botões pequenos
    for (const tipo of VEICULOS) {
      const b = document.createElement('button');
      b.className = (cartoes ? 'veic-card' : 'veic') + (tipo === this.perfil.veic ? ' sel' : '');
      if (cartoes) {
        const [icone, nome] = NOME_VEICULO[tipo].split(' ');
        b.innerHTML = `<span class="emoji">${icone}</span><b>${nome}</b>`;
      } else b.textContent = NOME_VEICULO[tipo];
      b.onclick = () => {
        this.perfil.veic = tipo;
        salvarPerfil(this.perfil);
        this.aoMudarPerfil({ veic: tipo });
        this.desenharSeletores(idCores, idVeic);
        this.atualizarPrevia();
      };
      v.appendChild(b);
    }
  }

  // ---------------------------------------------------------------------------
  // Lobby: código da sala, jogadores, modo de jogo e visual (a cidade fica livre ao fundo)
  // ---------------------------------------------------------------------------
  atualizarLobby(sala: SalaInfo, meuId: string) {
    let p = document.getElementById('lobby');
    if (!p) {
      p = document.createElement('div');
      p.id = 'lobby';
      p.className = 'painel lobby-novo';
      this.raiz.appendChild(p);
    }
    this.ultimaSala = sala;
    const ehAnf = meuId === sala.anfitriao;
    const link = `${location.origin}${location.pathname}?sala=${sala.codigo}`;
    const cartoes = sala.jogadores
      .map(
        (j) => `<div class="jog${j.id === meuId ? ' eu' : ''}"><span class="avatar" style="background:${j.cor}">${NOME_VEICULO[j.veic].split(' ')[0]}</span>
          <div><b>${escapar(j.nome)}</b><small>${j.id === meuId ? 'Você' : 'Amigo'}${j.id === sala.anfitriao ? ' · 👑 anfitrião' : ''}</small></div></div>`,
      )
      .join('');
    const vagas = Array.from({ length: Math.max(0, 4 - sala.jogadores.length) }, () => '<div class="jog vazio"><span class="avatar">＋</span><div><small>Aguardando amigo…</small></div></div>').join('');
    const modos = MODOS.map(
      (m) => `<button class="modo${sala.modo === m ? ' sel' : ''}" data-modo="${m}" ${ehAnf ? '' : 'disabled'}><span>${NOME_MODO[m].icone}</span><b>${NOME_MODO[m].nome}</b></button>`,
    ).join('');
    const nomes = sala.jogadores.slice().sort((a, b) => a.slot - b.slot);
    const papeisTxt =
      sala.modo === 'van'
        ? `<div class="papeis-previa"><b>Papéis com ${nomes.length} jogador${nomes.length > 1 ? 'es' : ''}:</b>${nomes
            .map((j, i) => `<div>${escapar(j.nome)}: ${DISTRIBUICAO[nomes.length][i].map((r) => INFO_PAPEL[r].icone + ' ' + INFO_PAPEL[r].nome).join(' + ')}</div>`)
            .join('')}</div>`
        : '';
    p.innerHTML = `
      <div class="lobby-topo">
        <div><small>Código da sala</small><div class="cod-grande">${sala.codigo}</div></div>
        <button id="l-copiar" class="pequeno">🔗 Copiar convite</button>
      </div>
      <div class="jogadores">${cartoes}${vagas}</div>
      <div class="rotulo">Modo de jogo ${ehAnf ? '' : '<small>(escolhido pelo anfitrião)</small>'}</div>
      <div class="modos">${modos}</div>
      <p class="modo-texto">${NOME_MODO[sala.modo].texto}</p>${papeisTxt}
      <div class="rotulo">Partida</div>
      <div class="config-linha"><span title="Duração">⏱</span><div class="seg">${DURACOES.map((d) => `<button data-cfg="duracao" data-valor="${d}" class="${sala.duracao === d ? 'sel' : ''}" ${ehAnf ? '' : 'disabled'}>${d / 60} min</button>`).join('')}</div></div>
      <div class="config-linha"><span title="Dificuldade">🎚️</span><div class="seg">${DIFICULDADES.map((d) => `<button data-cfg="dificuldade" data-valor="${d}" class="${sala.dificuldade === d ? 'sel' : ''}" ${ehAnf ? '' : 'disabled'}>${ROTULO_DIF[d]}</button>`).join('')}</div></div>
      <div class="config-linha"><span title="Mapa">🗺️</span><div class="seg">${MAPAS.map((m) => `<button data-cfg="mapa" data-valor="${m}" class="${sala.mapa === m ? 'sel' : ''}" ${ehAnf ? '' : 'disabled'}>${ROTULO_MAPA[m]}</button>`).join('')}</div></div>
      <label class="publica"><input type="checkbox" id="l-publica" ${sala.publica ? 'checked' : ''} ${ehAnf ? '' : 'disabled'}> Sala pública (aparece na lista de salas abertas)</label>
      <div class="rotulo">Seu visual</div>
      <div class="cores" id="l-cores"></div>
      <div class="veics" id="l-veic"></div>
      <div class="lobby-acoes">
        <button id="l-loja" class="loja-btn">🛒 Loja · ${fmt(sala.dinheiro)}</button>
        ${ehAnf ? '<button class="primario iniciar" id="l-iniciar">▶ Iniciar partida</button>' : '<div class="dica-lobby">Aguardando o anfitrião iniciar…</div>'}
      </div>
      <div class="dica-lobby">Dirija à vontade enquanto os amigos chegam. Compartilhe o link!</div>
      <button class="link" id="l-sair">← Sair da sala</button>`;
    this.desenharSeletores('l-cores', 'l-veic');
    el('l-sair').onclick = () => this.sairDaSala();
    document.getElementById('l-iniciar')?.addEventListener('click', () => this.aoIniciar());
    p.querySelectorAll<HTMLButtonElement>('[data-modo]').forEach((b) => (b.onclick = () => this.aoModo(b.dataset.modo as Modo)));
    p.querySelectorAll<HTMLButtonElement>('[data-cfg]').forEach(
      (b) =>
        (b.onclick = () => {
          const campo = b.dataset.cfg as 'duracao' | 'dificuldade' | 'mapa';
          const valor = campo === 'duracao' ? Number(b.dataset.valor) : b.dataset.valor;
          this.aoConfig({ [campo]: valor });
        }),
    );
    el<HTMLInputElement>('l-publica').onchange = (e) => this.aoConfig({ publica: (e.target as HTMLInputElement).checked });
    el('l-loja').onclick = () => {
      this.lojaAberta = true;
      this.desenharLoja();
    };
    if (this.lojaAberta) this.desenharLoja(); // atualiza a loja se estiver aberta
    el('l-copiar').onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        el('l-copiar').textContent = '✅ Link copiado!';
      } catch {
        // Alternativa para navegadores que bloqueiam a área de transferência
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch {
          /* ignora */
        }
        ta.remove();
        if (ok) el('l-copiar').textContent = '✅ Link copiado!';
        else this.aviso('Copie o link da barra de endereços do navegador');
      }
    };
  }

  esconderLobby() {
    document.getElementById('lobby')?.remove();
    this.fecharLoja();
  }

  // ---------------------------------------------------------------------------
  // Loja da equipe: preview 3D do seu entregador + upgrades e cosméticos
  // ---------------------------------------------------------------------------
  private fecharLoja() {
    this.lojaAberta = false;
    this.lojaPrevia?.destruir();
    this.lojaPrevia = null;
    document.getElementById('tela-loja')?.remove();
  }

  private desenharLoja() {
    const sala = this.ultimaSala;
    if (!sala) return;
    let t = document.getElementById('tela-loja');
    if (!t) {
      t = document.createElement('div');
      t.id = 'tela-loja';
      t.className = 'tela menu';
      t.innerHTML = `<div class="loja-grade">
        <section class="cartao menu-previa"><div id="loja-previa" class="previa"></div>
          <div class="info-veic"><h2 id="loja-nome"></h2><p>Veja como seu visual fica antes de equipar!</p><div class="carteira-badge" id="loja-carteira"></div></div></section>
        <div class="cartao loja" id="loja-itens"></div></div>`;
      this.raiz.appendChild(t);
      try {
        this.lojaPrevia = new Previa(el('loja-previa'));
      } catch {
        this.lojaPrevia = null;
      }
    }
    this.lojaPrevia?.definir(this.perfil.veic, this.perfil.cor, this.perfil.chapeu);
    el('loja-nome').textContent = NOME_VEICULO[this.perfil.veic];
    el('loja-carteira').textContent = '💰 ' + fmt(sala.dinheiro) + ' na carteira da equipe';

    const pips = (n: number) => '●'.repeat(n) + '○'.repeat(NIVEL_MAX - n);
    const linhasUp = UPGRADES.map(({ chave, nome, desc }) => {
      const nivel = sala.upgrades[chave];
      const maximo = nivel >= NIVEL_MAX;
      const preco = PRECO_UPGRADE[nivel];
      return `<div class="item-loja"><div><b>${nome}</b> <span class="pips">${pips(nivel)}</span><small>${desc}</small></div>
        <button data-item="up:${chave}" ${maximo || sala.dinheiro < preco ? 'disabled' : ''}>${maximo ? 'MÁXIMO' : fmt(preco)}</button></div>`;
    }).join('');
    const botao = (tipo: 'chapeu' | 'buzina', id: string, rotulo: string, preco: number, tem: boolean, equipado: boolean) => {
      const [ico, ...resto] = rotulo.split(' ');
      const nome = resto.join(' ') || ico;
      const emoji = resto.length ? ico : '🚫';
      return tem
        ? `<button class="cosm${equipado ? ' sel' : ''}" data-equipar="${tipo}:${id}"><span class="emoji">${emoji}</span>${nome}<small>${equipado ? '✔ Equipado' : 'Equipar'}</small></button>`
        : `<button class="cosm bloq" data-item="${tipo}:${id}" ${sala.dinheiro < preco ? 'disabled' : ''}><span class="emoji">${emoji}</span>${nome}<small>🔒 ${fmt(preco)}</small></button>`;
    };
    const chapeus = CHAPEUS.map((c) =>
      botao('chapeu', c, ROTULO_CHAPEU[c], PRECO_CHAPEU[c], sala.cosmeticos.chapeus.includes(c), this.perfil.chapeu === c)).join('');
    const buzinas = BUZINAS.map((b) =>
      botao('buzina', b, ROTULO_BUZINA[b], PRECO_BUZINA[b], sala.cosmeticos.buzinas.includes(b), this.perfil.buzina === b)).join('');

    el('loja-itens').innerHTML = `<h1>🛒 Loja da equipe</h1>
      <div class="rotulo">Melhorias (valem para toda a equipe)</div>${linhasUp}
      <div class="rotulo">Chapéus</div><div class="grade">${chapeus}</div>
      <div class="rotulo">Buzinas <small>(toque para ouvir)</small></div><div class="grade">${buzinas}</div>
      <button class="primario" id="loja-fechar">Fechar</button>`;
    t.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((b) => (b.onclick = () => this.aoComprar(b.dataset.item!)));
    t.querySelectorAll<HTMLButtonElement>('[data-equipar]').forEach((b) => {
      b.onclick = () => {
        const [tipo, id] = b.dataset.equipar!.split(':');
        if (tipo === 'chapeu') {
          this.perfil.chapeu = id as Chapeu;
          this.aoMudarPerfil({ chapeu: id as Chapeu });
        } else {
          this.perfil.buzina = id as Buzina;
          buzinar(id as Buzina);
          this.aoMudarPerfil({ buzina: id as Buzina });
        }
        salvarPerfil(this.perfil);
        this.desenharLoja();
      };
    });
    el('loja-fechar').onclick = () => this.fecharLoja();
  }

  aviso(msg: string) {
    let a = document.getElementById('aviso');
    if (!a) {
      a = document.createElement('div');
      a.id = 'aviso';
      document.body.appendChild(a);
    }
    a.textContent = msg;
    a.classList.add('ver');
    clearTimeout((a as unknown as { _t: number })._t);
    (a as unknown as { _t: number })._t = window.setTimeout(() => a!.classList.remove('ver'), 3500);
  }
}

const fmt = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
