// HUD da partida: dinheiro, cronômetro, pedidos, ofertas, ranking, carga, avisos e tela de resultados.
import { PONTOS_COLETA, PONTOS_ENTREGA, coordenada } from '../../../shared/cidade';
import type { EventoCaos, JogoTick, Modo, Papel, PacoteInfo, Resultado, TipoCaos } from '../../../shared/protocolo';
import { DICA_PACOTE, ICONE_PACOTE, NOME_PACOTE } from '../jogo/pacotes';

export const fmtDin = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
const fmtTempo = (s: number) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const TEXTO_EVENTO: Record<TipoCaos, string> = {
  chuva: '🌧️ Chuva! A pista está escorregadia',
  transito: '🚦 Trânsito intenso!',
  obras: '🚧 Obras na pista!',
  buraco: '🕳️ Buraco gigante na rua!',
  vento: '💨 Vento forte!',
};

export const INFO_PAPEL: Record<Papel, { icone: string; nome: string; dica: string }> = {
  motorista: { icone: '🚗', nome: 'Motorista', dica: 'Só dirija! Seu navegador diz onde virar.' },
  navegador: { icone: '🗺️', nome: 'Navegador', dica: 'Leia o mapa e diga por onde ir.' },
  entregador: { icone: '🏃', nome: 'Entregador', dica: 'F desce/sobe da van · E pega e entrega a pé.' },
  gerente: { icone: '📋', nome: 'Gerente', dica: 'Aceite os pedidos (1, 2, 3 ou clique).' },
};

export const NOME_MODO: Record<Modo, { icone: string; nome: string; texto: string }> = {
  equipe: { icone: '🤝', nome: 'Equipe', texto: 'Todos veem os mesmos pedidos e cooperam. Cada um dirige o seu veículo.' },
  individual: { icone: '🏁', nome: 'Individual', texto: 'Cada um com os seus pedidos. Vence quem entregar mais!' },
  van: { icone: '🚐', nome: 'Mesmo carro', texto: 'Uma van, cada um com um papel: motorista, navegador, entregador e gerente.' },
};

export interface CtxHud {
  meuId: string;
  modo: Modo;
  agora: number; // hora estimada do servidor (ms)
  lista: boolean; // mostra a lista de pedidos
  coord: boolean; // mostra as coordenadas das ruas (modo van)
  ofertas: boolean; // o gerente vê as ofertas com botão "Aceitar"
}

export class Hud {
  private raiz: HTMLElement;
  private placar = document.createElement('div');
  private ranking = document.createElement('div');
  private papeis = document.createElement('div');
  private pedidos = document.createElement('div');
  private carga = document.createElement('div');
  private evento = document.createElement('div');
  private banner = document.createElement('div');
  private resultado: HTMLElement | null = null;
  private ultimoEvento = 0;
  private visivel = false;
  aoAceitar: (id: number) => void = () => {};

  constructor() {
    this.raiz = document.getElementById('hud')!;
    this.placar.id = 'placar';
    this.ranking.id = 'ranking';
    this.papeis.id = 'papeis';
    this.pedidos.id = 'pedidos';
    this.carga.id = 'carga';
    this.evento.id = 'evento';
    this.banner.id = 'banner';
    this.raiz.append(this.placar, this.ranking, this.papeis, this.pedidos, this.carga, this.evento, this.banner);
    // Clique nos botões "Aceitar" (o HTML é refeito várias vezes por segundo: usa delegação)
    this.pedidos.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-aceitar]');
      if (b) this.aoAceitar(Number(b.dataset.aceitar));
    });
    this.partidaVisivel(false);
  }

  partidaVisivel(v: boolean) {
    this.visivel = v;
    for (const e of [this.placar, this.ranking, this.papeis, this.pedidos, this.carga, this.evento]) e.style.display = v ? '' : 'none';
    if (!v) this.banner.textContent = '';
  }

  /** Mostra o(s) papel(éis) do jogador no modo van. */
  definirPapeis(papeis: Papel[]) {
    this.papeis.innerHTML = papeis
      .map((p) => `<div class="papel"><b>${INFO_PAPEL[p].icone} ${INFO_PAPEL[p].nome}</b><small>${INFO_PAPEL[p].dica}</small></div>`)
      .join('');
  }

  /** Atualiza tudo que vem do servidor (já filtrado para o que este jogador pode ver). */
  atualizar(jogo: JogoTick, ctx: CtxHud) {
    if (!this.visivel) return;
    this.placar.innerHTML = `<span>⏱ ${fmtTempo(jogo.restante)}</span><span>💰 ${fmtDin(jogo.dinheiroPartida)}</span>`;
    this.placar.classList.toggle('urgente', jogo.contagem === 0 && jogo.restante <= 30);

    // Ranking ao vivo (modo individual)
    this.ranking.innerHTML =
      ctx.modo === 'individual'
        ? jogo.ranking
            .map(
              (r, i) => `<div class="rk${r.id === ctx.meuId ? ' eu' : ''}"><i>${i + 1}º</i><span class="bolinha" style="background:${r.cor}"></span>${esc(r.nome)}<b>${fmtDin(r.dinheiro)}</b></div>`,
            )
            .join('')
        : '';

    if (jogo.contagem > 0) this.mostrarBanner(String(jogo.contagem), 1100, 'grande');

    // Pedidos (e ofertas, para o gerente)
    if (!ctx.lista) this.pedidos.innerHTML = '';
    else {
      const ofertas = ctx.ofertas ? jogo.pedidos.filter((p) => p.estado === 'oferta') : [];
      const ativos = jogo.pedidos.filter((p) => p.estado === 'ativo');
      const coordTxt = (x: number, z: number) => (ctx.coord ? `<small class="coord">📍 ${coordenada(x, z)}</small>` : '');
      let html = '';
      if (ctx.ofertas) {
        html += `<div class="sec">📥 Ofertas${ofertas.length ? ' — aceite com 1, 2, 3 ou clique' : ''}</div>`;
        html += ofertas.length ? '' : '<div class="vazio">Aguardando novos pedidos…</div>';
        html += ofertas
          .map((p, i) => {
            const c = PONTOS_COLETA[p.coleta];
            const e = PONTOS_ENTREGA[p.entrega];
            const frac = Math.min(1, Math.max(0, (p.ofertaFim - ctx.agora) / 28000));
            return `<div class="ped oferta" style="border-color:${p.cor}">
              <b style="background:${p.cor}">${i + 1}</b>
              <div class="info"><span>${ICONE_PACOTE[p.tipo]} ${NOME_PACOTE[p.tipo]} · ${fmtDin(p.base)}</span>
              <small>${esc(c.nome)} → ${esc(e.nome)}</small>${coordTxt(c.x, c.z)}${coordTxt(e.x, e.z)}
              <div class="barra"><i style="width:${frac * 100}%;background:#ffb020"></i></div></div>
              <button data-aceitar="${p.id}">Aceitar</button></div>`;
          })
          .join('');
        html += '<div class="sec">✅ Em andamento</div>';
      }
      html += ativos
        .map((p) => {
          const pk = jogo.pacotes.find((x) => x.id === p.id);
          const restante = Math.max(0, p.prazoFim - ctx.agora);
          const frac = Math.min(1, restante / p.prazoTotal);
          const minha = pk?.dono === ctx.meuId;
          const c = PONTOS_COLETA[p.coleta];
          const e = PONTOS_ENTREGA[p.entrega];
          const rotulo =
            pk?.estado === 'carregado'
              ? (minha ? '🏁 Entregue: ' : '🤝 Com ' + (pk.dono === ctx.meuId ? 'você' : 'um amigo') + ' → ') + esc(e.nome)
              : pk?.estado === 'livre'
                ? '⚠️ Pacote no chão! Pegue (E)'
                : '📍 Retire: ' + esc(c.nome);
          const alvo = pk?.estado === 'carregado' ? e : c;
          const cor = frac > 0.5 ? '#4cd964' : frac > 0.2 ? '#ffb020' : '#ff5a5f';
          return `<div class="ped${minha ? ' minha' : ''}" style="border-color:${p.cor}">
            <b style="background:${p.cor}">${p.letra}</b>
            <div class="info"><span>${ICONE_PACOTE[p.tipo]} ${NOME_PACOTE[p.tipo]} · ${fmtDin(p.base)}</span><small>${rotulo}</small>${coordTxt(alvo.x, alvo.z)}
            <div class="barra"><i style="width:${frac * 100}%;background:${cor}"></i></div></div>
            <em>${fmtTempo(restante / 1000)}</em></div>`;
        })
        .join('');
      this.pedidos.innerHTML = html;
    }

    // Minha carga (com integridade): no modo van, é a do entregador
    const minhas = jogo.pacotes.filter((p) => p.dono === ctx.meuId);
    this.carga.innerHTML = minhas.map((p) => this.htmlCarga(p, jogo)).join('');

    this.mostrarEvento(jogo.evento);
  }

  private htmlCarga(p: PacoteInfo, jogo: JogoTick) {
    const ped = jogo.pedidos.find((x) => x.id === p.id);
    const cor = p.integ > 60 ? '#4cd964' : p.integ > 30 ? '#ffb020' : '#ff5a5f';
    return `<div class="item" style="border-color:${ped?.cor ?? '#fff'}">${ICONE_PACOTE[p.tipo]} ${NOME_PACOTE[p.tipo]}
      <small>${DICA_PACOTE[p.tipo]}</small>
      <div class="barra"><i style="width:${p.integ}%;background:${cor}"></i></div></div>`;
  }

  private mostrarEvento(e: EventoCaos | null) {
    if (e) {
      this.evento.textContent = TEXTO_EVENTO[e.tipo];
      this.evento.classList.add('ativo');
      if (e.id !== this.ultimoEvento) {
        this.ultimoEvento = e.id;
        this.mostrarBanner(TEXTO_EVENTO[e.tipo], 2800);
      }
    } else {
      this.evento.classList.remove('ativo');
      this.evento.textContent = '';
    }
  }

  mostrarBanner(texto: string, ms = 2000, classe = '') {
    this.banner.textContent = texto;
    this.banner.className = 'ver ' + classe;
    clearTimeout((this.banner as unknown as { _t: number })._t);
    (this.banner as unknown as { _t: number })._t = window.setTimeout(() => (this.banner.className = ''), ms);
  }

  /** Texto flutuante ("+R$ 120", "Pacote caiu!"). */
  popup(texto: string, cor = '#fff') {
    const d = document.createElement('div');
    d.className = 'popup';
    d.textContent = texto;
    d.style.color = cor;
    d.style.left = 40 + Math.random() * 20 + '%';
    this.raiz.appendChild(d);
    setTimeout(() => d.remove(), 1800);
  }

  // ---------------------------------------------------------------------------
  // Resultados: pódio, destaques e tabela
  // ---------------------------------------------------------------------------
  mostrarResultado(r: Resultado, ehAnfitriao: boolean, aoVoltar: () => void) {
    this.esconderResultado();
    const lista = [...r.jogadores].sort((a, b) => b.dinheiro - a.dinheiro);
    const medalha = ['🥇', '🥈', '🥉'];
    const titulo =
      r.modo === 'individual'
        ? `🏆 ${esc(lista[0]?.nome ?? '')} venceu!`
        : r.modo === 'van'
          ? '🚐 Missão cumprida, equipe!'
          : '🏁 Fim da entrega!';
    // Pódio: 2º, 1º, 3º (o primeiro fica no meio e mais alto)
    const ordem = [1, 0, 2].filter((i) => lista[i]);
    const podio = ordem
      .map((i) => {
        const j = lista[i];
        return `<div class="degrau d${i + 1}"><div class="avatar" style="background:${j.cor}">${medalha[i]}</div>
          <b>${esc(j.nome)}</b><small>${fmtDin(j.dinheiro)}</small><div class="bloco">${i + 1}º</div></div>`;
      })
      .join('');
    const d = document.createElement('div');
    d.className = 'tela menu';
    d.id = 'tela-resultado';
    d.innerHTML = `<div class="cartao resultado">
      <h1>${titulo}</h1>
      <div class="total">${fmtDin(r.dinheiroTotal)}</div>
      <div class="sub">${r.entregas} entrega${r.entregas === 1 ? '' : 's'} · ${r.perdidos} perdida${r.perdidos === 1 ? '' : 's'} · modo ${NOME_MODO[r.modo].nome}</div>
      ${lista.length > 1 ? `<div class="podio">${podio}</div>` : ''}
      <div class="destaques">
        <div class="destaque">🏆<span>Entregador do dia</span><b>${esc(r.entregador)}</b></div>
        <div class="destaque engracado">🤪<span>${esc(r.estatistica)}</span></div>
      </div>
      <table><tr><th></th><th>Jogador</th><th>Entregas</th><th>Ganhou</th><th>Capotou</th></tr>
      ${lista
        .map(
          (j) => `<tr><td><span class="bolinha" style="background:${j.cor}"></span></td><td>${esc(j.nome)}</td>
          <td>${j.entregas}</td><td>${fmtDin(j.dinheiro)}</td><td>${j.capotadas}</td></tr>`,
        )
        .join('')}</table>
      ${ehAnfitriao ? '<button class="primario" id="r-voltar">Voltar ao lobby</button>' : '<div class="sub">Aguardando o anfitrião voltar ao lobby…</div>'}
    </div>`;
    document.getElementById('ui')!.appendChild(d);
    d.querySelector('#r-voltar')?.addEventListener('click', aoVoltar);
    this.resultado = d;
  }

  esconderResultado() {
    this.resultado?.remove();
    this.resultado = null;
  }
}
