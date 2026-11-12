// Interface em HTML: menu inicial, painel do lobby e botão de mudo. (HUD e resultados: Fase 4.)
import { NIVEL_MAX, PRECO_BUZINA, PRECO_CHAPEU, PRECO_UPGRADE } from '../../../shared/constantes';
import {
  BUZINAS, CHAPEUS, CORES, VEICULOS,
  type Buzina, type Chapeu, type PerfilMsg, type SalaInfo, type TipoVeiculo, type Upgrades,
} from '../../../shared/protocolo';
import { buzinar, definirMudo, estaMudo } from '../audio/audio';

const ROTULO_CHAPEU: Record<Chapeu, string> = {
  nenhum: 'Sem chapéu', cartola: '🎩 Cartola', cowboy: '🤠 Cowboy', coroa: '👑 Coroa', festa: '🥳 Festa',
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
  van: '🚐 Van',
  carrinho: '🛒 Carrinho',
};

const CHAVE = 'em-perfil';

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
    div.innerHTML = `
      <div class="cartao">
        <h1>🚚 Entrega Maluca</h1>
        <p class="sub">Até 4 amigos, uma cidade e muitas encomendas!</p>
        <label class="campo">Apelido
          <input id="m-nome" maxlength="14" placeholder="Seu apelido" autocomplete="off" />
        </label>
        <div class="rotulo">Cor</div>
        <div class="cores" id="m-cores"></div>
        <div class="rotulo">Veículo</div>
        <div class="veics" id="m-veic"></div>
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
        <div class="erro" id="m-erro"></div>
      </div>`;
    this.raiz.appendChild(div);

    const nome = el<HTMLInputElement>('m-nome');
    nome.value = this.perfil.nome;
    const coletar = (): PerfilMsg => {
      this.perfil.nome = nome.value.trim() || 'Entregador' + Math.floor(Math.random() * 90 + 10);
      salvarPerfil(this.perfil);
      return { ...this.perfil };
    };
    this.desenharSeletores('m-cores', 'm-veic');

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
    document.getElementById('tela-menu')?.remove();
  }

  /** Cores + veículos (usado no menu e no lobby). */
  private desenharSeletores(idCores: string, idVeic: string) {
    const c = el(idCores);
    c.innerHTML = '';
    for (const cor of CORES) {
      const b = document.createElement('button');
      b.className = 'cor' + (cor === this.perfil.cor ? ' sel' : '');
      b.style.background = cor;
      b.setAttribute('aria-label', 'Cor ' + cor);
      b.onclick = () => {
        this.perfil.cor = cor;
        salvarPerfil(this.perfil);
        this.aoMudarPerfil({ cor });
        this.desenharSeletores(idCores, idVeic);
      };
      c.appendChild(b);
    }
    const v = el(idVeic);
    v.innerHTML = '';
    for (const tipo of VEICULOS) {
      const b = document.createElement('button');
      b.className = 'veic' + (tipo === this.perfil.veic ? ' sel' : '');
      b.textContent = NOME_VEICULO[tipo];
      b.onclick = () => {
        this.perfil.veic = tipo;
        salvarPerfil(this.perfil);
        this.aoMudarPerfil({ veic: tipo });
        this.desenharSeletores(idCores, idVeic);
      };
      v.appendChild(b);
    }
  }

  // ---------------------------------------------------------------------------
  // Painel do lobby (a cidade fica livre ao fundo: dá para dirigir esperando)
  // ---------------------------------------------------------------------------
  atualizarLobby(sala: SalaInfo, meuId: string) {
    let p = document.getElementById('lobby');
    if (!p) {
      p = document.createElement('div');
      p.id = 'lobby';
      p.className = 'painel';
      this.raiz.appendChild(p);
    }
    this.ultimaSala = sala;
    const link = `${location.origin}${location.pathname}?sala=${sala.codigo}`;
    p.innerHTML = `
      <div class="cod">Sala <b>${sala.codigo}</b></div>
      <button id="l-copiar" class="pequeno">🔗 Copiar convite</button>
      <button id="l-loja" class="pequeno loja-btn">🛒 Loja · ${fmt(sala.dinheiro)}</button>
      <ul id="l-lista">
        ${sala.jogadores
          .map(
            (j) => `<li><span class="bolinha" style="background:${j.cor}"></span>
              ${escapar(j.nome)}${j.id === meuId ? ' (você)' : ''}${j.id === sala.anfitriao ? ' 👑' : ''}
              <small>${NOME_VEICULO[j.veic]}</small></li>`,
          )
          .join('')}
      </ul>
      <div class="rotulo">Seu visual</div>
      <div class="cores" id="l-cores"></div>
      <div class="veics" id="l-veic"></div>
      <div class="dica-lobby">Dirija à vontade enquanto os amigos chegam. Compartilhe o link!</div>
      ${
        meuId === sala.anfitriao
          ? '<button class="primario iniciar" id="l-iniciar">▶ Iniciar partida</button>'
          : '<div class="dica-lobby">Aguardando o anfitrião iniciar…</div>'
      }`;
    this.desenharSeletores('l-cores', 'l-veic');
    document.getElementById('l-iniciar')?.addEventListener('click', () => this.aoIniciar());
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
        prompt('Copie o link de convite:', link);
      }
    };
  }

  esconderLobby() {
    document.getElementById('lobby')?.remove();
    this.fecharLoja();
  }

  // ---------------------------------------------------------------------------
  // Loja da equipe: upgrades (valem para todos) e cosméticos
  // ---------------------------------------------------------------------------
  private fecharLoja() {
    this.lojaAberta = false;
    document.getElementById('tela-loja')?.remove();
  }

  private desenharLoja() {
    const sala = this.ultimaSala;
    if (!sala) return;
    let t = document.getElementById('tela-loja');
    if (!t) {
      t = document.createElement('div');
      t.id = 'tela-loja';
      t.className = 'tela';
      this.raiz.appendChild(t);
    }
    const pips = (n: number) => '●'.repeat(n) + '○'.repeat(NIVEL_MAX - n);
    const linhasUp = UPGRADES.map(({ chave, nome, desc }) => {
      const nivel = sala.upgrades[chave];
      const maximo = nivel >= NIVEL_MAX;
      const preco = PRECO_UPGRADE[nivel];
      return `<div class="item-loja"><div><b>${nome}</b> <span class="pips">${pips(nivel)}</span><small>${desc}</small></div>
        <button data-item="up:${chave}" ${maximo || sala.dinheiro < preco ? 'disabled' : ''}>${maximo ? 'MÁXIMO' : fmt(preco)}</button></div>`;
    }).join('');
    const botao = (tipo: 'chapeu' | 'buzina', id: string, rotulo: string, preco: number, tem: boolean, equipado: boolean) =>
      tem
        ? `<button class="cosm${equipado ? ' sel' : ''}" data-equipar="${tipo}:${id}">${rotulo}<small>${equipado ? 'Equipado' : 'Equipar'}</small></button>`
        : `<button class="cosm" data-item="${tipo}:${id}" ${sala.dinheiro < preco ? 'disabled' : ''}>${rotulo}<small>${fmt(preco)}</small></button>`;
    const chapeus = CHAPEUS.map((c) =>
      botao('chapeu', c, ROTULO_CHAPEU[c], PRECO_CHAPEU[c], sala.cosmeticos.chapeus.includes(c), this.perfil.chapeu === c)).join('');
    const buzinas = BUZINAS.map((b) =>
      botao('buzina', b, ROTULO_BUZINA[b], PRECO_BUZINA[b], sala.cosmeticos.buzinas.includes(b), this.perfil.buzina === b)).join('');

    t.innerHTML = `<div class="cartao loja">
      <h1>🛒 Loja da equipe</h1>
      <div class="carteira">💰 ${fmt(sala.dinheiro)}</div>
      <div class="rotulo">Melhorias do veículo (valem para toda a equipe)</div>${linhasUp}
      <div class="rotulo">Chapéus</div><div class="grade">${chapeus}</div>
      <div class="rotulo">Buzinas (toque para ouvir)</div><div class="grade">${buzinas}</div>
      <button class="primario" id="loja-fechar">Fechar</button></div>`;
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
