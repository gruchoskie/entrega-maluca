// HUD da partida: dinheiro, cronômetro, pedidos, carga, avisos e tela de resultados.
import { PONTOS_COLETA, PONTOS_ENTREGA } from '../../../shared/cidade';
import type { EventoCaos, JogoTick, PacoteInfo, Resultado, TipoCaos } from '../../../shared/protocolo';
import { DICA_PACOTE, ICONE_PACOTE, NOME_PACOTE } from '../jogo/pacotes';

export const fmtDin = (n: number) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
const fmtTempo = (s: number) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const TEXTO_EVENTO: Record<TipoCaos, string> = {
  chuva: '🌧️ Chuva! A pista está escorregadia',
  transito: '🚦 Trânsito intenso!',
  obras: '🚧 Obras na pista!',
  buraco: '🕳️ Buraco gigante na rua!',
  vento: '💨 Vento forte!',
};

export class Hud {
  private raiz: HTMLElement;
  private placar = document.createElement('div');
  private pedidos = document.createElement('div');
  private carga = document.createElement('div');
  private evento = document.createElement('div');
  private banner = document.createElement('div');
  private resultado: HTMLElement | null = null;
  private ultimoEvento = 0;

  constructor() {
    this.raiz = document.getElementById('hud')!;
    this.placar.id = 'placar';
    this.pedidos.id = 'pedidos';
    this.carga.id = 'carga';
    this.evento.id = 'evento';
    this.banner.id = 'banner';
    this.raiz.append(this.placar, this.pedidos, this.carga, this.evento, this.banner);
    this.partidaVisivel(false);
  }

  partidaVisivel(v: boolean) {
    for (const e of [this.placar, this.pedidos, this.carga, this.evento]) e.style.display = v ? '' : 'none';
    if (!v) this.banner.textContent = '';
  }

  /** Atualiza tudo que vem do servidor. `agoraServidor` é a hora estimada do servidor (ms). */
  atualizar(jogo: JogoTick, meuId: string, agoraServidor: number) {
    this.placar.innerHTML = `<span>⏱ ${fmtTempo(jogo.restante)}</span><span>💰 ${fmtDin(jogo.dinheiroPartida)}</span>`;
    this.placar.classList.toggle('urgente', jogo.contagem === 0 && jogo.restante <= 30);

    // Contagem regressiva / "VAI!"
    if (jogo.contagem > 0) this.mostrarBanner(String(jogo.contagem), 1100, 'grande');

    // Pedidos
    this.pedidos.innerHTML = jogo.pedidos
      .map((p) => {
        const pk = jogo.pacotes.find((x) => x.id === p.id);
        const restante = Math.max(0, p.prazoFim - agoraServidor);
        const frac = Math.min(1, restante / p.prazoTotal);
        const minha = pk?.dono === meuId;
        const rotulo = pk?.estado === 'carregado'
          ? minha ? '🏁 Entregue: ' + PONTOS_ENTREGA[p.entrega].nome : '🤝 Com um amigo → ' + PONTOS_ENTREGA[p.entrega].nome
          : pk?.estado === 'livre'
            ? '⚠️ Pacote no chão! Pegue (E)'
            : '📍 Retire: ' + PONTOS_COLETA[p.coleta].nome;
        const cor = frac > 0.5 ? '#4cd964' : frac > 0.2 ? '#ffb020' : '#ff5a5f';
        return `<div class="ped${minha ? ' minha' : ''}" style="border-color:${p.cor}">
          <b style="background:${p.cor}">${p.letra}</b>
          <div class="info"><span>${ICONE_PACOTE[p.tipo]} ${NOME_PACOTE[p.tipo]} · ${fmtDin(p.base)}</span><small>${rotulo}</small>
          <div class="barra"><i style="width:${frac * 100}%;background:${cor}"></i></div></div>
          <em>${fmtTempo(restante / 1000)}</em></div>`;
      })
      .join('');

    // Minha carga (com integridade)
    const minhas = jogo.pacotes.filter((p) => p.dono === meuId);
    this.carga.innerHTML = minhas.map((p) => this.htmlCarga(p, jogo)).join('');

    // Evento de caos
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
  // Resultados
  // ---------------------------------------------------------------------------
  mostrarResultado(r: Resultado, ehAnfitriao: boolean, aoVoltar: () => void) {
    this.esconderResultado();
    const d = document.createElement('div');
    d.className = 'tela';
    d.id = 'tela-resultado';
    d.innerHTML = `<div class="cartao resultado">
      <h1>🏁 Fim da entrega!</h1>
      <div class="total">${fmtDin(r.dinheiroTotal)}</div>
      <div class="sub">${r.entregas} entrega${r.entregas === 1 ? '' : 's'} · ${r.perdidos} perdida${r.perdidos === 1 ? '' : 's'}</div>
      <div class="destaque">🏆 Entregador do dia: <b>${r.entregador}</b></div>
      <div class="destaque engracado">🤪 ${r.estatistica}</div>
      <table><tr><th></th><th>Jogador</th><th>Entregas</th><th>Ganhou</th><th>Capotou</th></tr>
      ${r.jogadores
        .sort((a, b) => b.dinheiro - a.dinheiro)
        .map(
          (j) => `<tr><td><span class="bolinha" style="background:${j.cor}"></span></td><td>${j.nome}</td>
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
