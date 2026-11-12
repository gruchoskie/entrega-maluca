// Ponto de entrada: monta os módulos e roda o laço do jogo.
// Três modos: equipe (pedidos compartilhados), individual (pedidos de cada um) e van (todos no mesmo carro, com papéis).
import * as THREE from 'three';
import { posicaoLargada } from '../../shared/constantes';
import { PONTOS_COLETA, PONTOS_ENTREGA, coordenada } from '../../shared/cidade';
import { EMOTES, type Fase, type JogoTick, type Modo, type Papel, type PerfilMsg, type SalaInfo } from '../../shared/protocolo';
import { Motor, buzinar, destravarAudio } from './audio/audio';
import { efeito, iniciarMusica } from './audio/efeitos';
import { Bolhas } from './efeitos/bolhas';
import { Particulas } from './efeitos/particulas';
import { Fisica } from './fisica/fisica';
import { Marcadores, PacotesVisuais, Seta } from './jogo/pacotes';
import { Controles, type EstadoControles } from './interface/controles';
import { Hud, INFO_PAPEL, fmtDin, type CtxHud } from './interface/hud';
import { Minimapa } from './interface/minimapa';
import { aoEntregar, aoTerminar, desbloquear } from './interface/progresso';
import {
  MonitorFps, QUALIDADES, piorQualidade, proximaQualidade, qualidadeInicial, salvarQualidade, type Qualidade,
} from './interface/qualidade';
import { Ui } from './interface/ui';
import { CameraSeguidora } from './mundo/camera';
import { Caos } from './mundo/caos';
import { criarCenario } from './mundo/cenario';
import { Transito } from './mundo/transito';
import { CICLO_DIA_S, criarMundo } from './mundo/mundo';
import { rotaPelasRuas } from './mundo/rotas';
import { Rede } from './rede/rede';
import { Voz } from './rede/voz';
import { OFFSET_CARGA } from './veiculo/modelos';
import { Pedestre } from './veiculo/pedestre';
import { Veiculo } from './veiculo/veiculo';
import { VeiculoRemoto } from './veiculo/remoto';

/** Controles "soltos": a van do entregador-motorista fica parada (freio de mão) enquanto ele anda a pé. */
const PARADO: EstadoControles = {
  acelerar: 0, direcao: 0, pular: true, pegar: false, buzina: false, trocar: false, van: false, camDX: 0, camDY: 0,
};

async function iniciar() {
  const canvas = document.getElementById('jogo') as HTMLCanvasElement;
  const controles = new Controles(canvas);
  const celular = controles.celular;

  // Qualidade ajustável: celular roda sem sombras e com resolução menor
  const renderizador = new THREE.WebGLRenderer({ canvas, antialias: !celular, powerPreference: 'high-performance' });
  renderizador.shadowMap.enabled = true; // ligar/desligar sombras é feito pelo nível de qualidade
  renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
  let qualidade: Qualidade = qualidadeInicial(celular);
  const monitorFps = new MonitorFps();

  const fisica = await Fisica.criar();
  const mundo = criarMundo(QUALIDADES[qualidade].sombras);
  const cenario = criarCenario(fisica, mundo);
  const camera = new CameraSeguidora(window.innerWidth / window.innerHeight);
  const ui = new Ui();
  const hud = new Hud();
  const rede = new Rede();
  const particulas = new Particulas(mundo.cena);
  const pacotesVis = new PacotesVisuais(mundo.cena);
  const marcadores = new Marcadores(mundo.cena);
  const seta = new Seta(mundo.cena);
  const bolhas = new Bolhas();
  const minimapa = new Minimapa();
  minimapa.visivel(false);
  let mostrarRota = false; // rota sugerida no minimapa (clique no mapa liga/desliga)
  minimapa.aoClicar = () => {
    mostrarRota = !mostrarRota;
    ui.aviso(mostrarRota ? '🧭 Rota sugerida ligada' : 'Rota sugerida desligada');
  };
  // Relógio do servidor (estimado): trânsito e eventos ficam iguais para todos
  let desvioRelogio = 0;
  const agoraServidor = () => Date.now() + desvioRelogio;
  const transito = new Transito(fisica, mundo.cena, () => agoraServidor() / 1000);
  const caos = new Caos(fisica, mundo, transito);

  // Faróis do meu veículo (acendem à noite)
  const farol = new THREE.SpotLight('#fff2c8', 0, 55, 0.55, 0.6, 1.2);
  farol.target.position.set(0, 0.3, 14);
  farol.position.set(0, 0.6, 1.3);
  mundo.aoNoite.push((n) => (farol.intensity = n * 90));

  // ---------- Estado da partida ----------
  let veiculo: Veiculo | null = null; // meu veículo (no modo van, só o motorista tem)
  let pedestre: Pedestre | null = null; // meu entregador a pé (modo van)
  let meuId = '';
  let entrou = false;
  let sala: SalaInfo | null = null;
  let fase: Fase = 'lobby';
  let modo: Modo = 'equipe';
  let papeis: Papel[] = []; // meus papéis (só no modo van, durante a partida)
  const papeisDe = new Map<string, Papel[]>();
  let jogoAtual: JogoTick | null = null;
  let meuAPe = false;
  let ultimaContagem = 0;
  let ultimoEventoSom = 0;
  let tamMapa = 140;
  const remotos = new Map<string, VeiculoRemoto>();
  const motorLocal = new Motor();
  let slot = 0;

  const elHud = document.getElementById('hud')!;
  const elVel = document.getElementById('vel')!;
  const elTipo = document.getElementById('veiculo-atual')!;
  const elDica = document.getElementById('dica')!;
  const elBtnVan = document.getElementById('btn-van')!;
  elDica.textContent = celular
    ? ''
    : 'WASD/setas: dirigir · Espaço: pular/freio de mão · E: pegar/passar/arremessar · C: buzina · R: reiniciar';

  const emVan = () => modo === 'van' && fase === 'jogo';
  const tenho = (p: Papel) => !emVan() || papeis.includes(p);

  // ---------- Entidades locais ----------
  function criarVeiculoLocal() {
    const eu = sala?.jogadores.find((j) => j.id === meuId);
    if (!eu) return;
    const l = posicaoLargada(slot);
    veiculo = new Veiculo(fisica, eu.veic, eu.cor, l.x, l.z, l.yaw, eu.chapeu);
    mundo.cena.add(veiculo.objeto);
    veiculo.objeto.add(farol, farol.target);
    // Batidas e balanço: o servidor decide o estrago nos pacotes (do veículo, ou da van)
    veiculo.aoImpacto = (g) => {
      if (emVan() || minhasCargas().length) rede.enviar({ t: 'impacto', g });
      const forca = Math.min(1, g / 14);
      camera.tremer(forca);
      efeito('batida', forca);
      if (g > 4 && veiculo) {
        const p = veiculo.objeto.position;
        particulas.faiscas(p.x, p.y + 0.4, p.z, g * 1.5);
      }
    };
    veiculo.aoBalanco = (v) => {
      const tem = emVan() ? jogoAtual?.pacotes.some((p) => p.tipo === 'liquido') : minhasCargas().some((p) => p.tipo === 'liquido');
      if (tem) rede.enviar({ t: 'balanco', v });
    };
  }

  function destruirVeiculoLocal() {
    veiculo?.destruir();
    veiculo = null;
  }

  function destruirPedestre() {
    pedestre?.destruir();
    pedestre = null;
  }

  /** Posição, rumo e velocidade da van (minha, se eu for o motorista; senão a do motorista remoto). */
  function posVan(): { pos: THREE.Vector3; rumo: number; vel: number } | null {
    if (veiculo) return { pos: veiculo.objeto.position, rumo: veiculo.rumo, vel: Math.abs(veiculo.velocidade) };
    const mot = sala?.jogadores.find((j) => (papeisDe.get(j.id) ?? []).includes('motorista'));
    const r = mot ? remotos.get(mot.id) : undefined;
    if (!r) return null;
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(r.grupo.quaternion);
    return { pos: r.grupo.position, rumo: Math.atan2(f.x, f.z), vel: r.velocidade };
  }

  /** O que a câmera segue: o entregador a pé, o meu veículo ou (passageiro) a van. */
  function alvoCamera(): { pos: THREE.Vector3; rumo: number; vel: number } | null {
    if (pedestre) return { pos: pedestre.objeto.position, rumo: pedestre.rumo, vel: pedestre.velocidade };
    if (veiculo) return { pos: veiculo.objeto.position, rumo: veiculo.rumo, vel: veiculo.velocidade };
    if (emVan()) return posVan();
    return null;
  }

  /** Entregador desce: aparece ao lado da van. */
  function criarPedestreAoLado() {
    const v = posVan();
    if (!v || pedestre) return;
    const ox = Math.cos(v.rumo) * 2.8;
    const oz = -Math.sin(v.rumo) * 2.8;
    pedestre = new Pedestre(fisica, ui.perfil.cor, ui.perfil.chapeu, v.pos.x + ox, v.pos.z + oz, v.rumo);
    mundo.cena.add(pedestre.objeto);
    efeito('pulo');
  }

  /** Cria/remove meu veículo conforme o modo e a fase. */
  function ajustarEntidadesLocais(vanJogo: boolean) {
    if (vanJogo) {
      if (papeis.includes('motorista')) {
        if (!veiculo) criarVeiculoLocal();
        veiculo?.trocarTipo('van');
      } else if (veiculo) destruirVeiculoLocal();
    } else {
      if (!veiculo && entrou) criarVeiculoLocal();
      if (pedestre) destruirPedestre();
    }
  }

  // ---------- Rede ----------
  rede.em('bemvindo', (m) => {
    meuId = m.id;
    entrou = true;
    const eu = m.sala.jogadores.find((j) => j.id === m.id)!;
    slot = eu.slot;
    fase = m.sala.fase;
    iniciarMusica();
    ui.tutorialSeNovo();
    ui.esconderMenu();
    document.body.classList.add('em-sala'); // mostra o botão 🏠 de sair
    elHud.hidden = false;
    history.replaceState(null, '', `${location.pathname}?sala=${m.sala.codigo}`);
    sincronizarSala(m.sala);
  });

  rede.em('sala', (m) => sincronizarSala(m.sala));

  rede.em('erro', (m) => {
    if (document.getElementById('tela-menu')) ui.erroMenu(m.msg);
    else ui.aviso(m.msg);
  });

  rede.em('buzina', (m) => {
    if (m.id === meuId) return;
    const r = remotos.get(m.id);
    const alvo = alvoCamera();
    if (r && alvo) buzinar(r.info.buzina, volumeDistancia(r.grupo.position, alvo.pos, 70));
  });

  // Emotes e frases rápidas: balão sobre o jogador (ou sobre a van, se ele está dentro dela)
  rede.em('emote', (m) => {
    const pai = objetoDe(m.id);
    if (pai) bolhas.mostrar(pai, m.k);
  });
  rede.em('voz', (m) => void voz.receber(m.de, m.dados));
  rede.em('salas', (m) => ui.mostrarSalas(m.lista));

  rede.em('tick', (m) => {
    m.ids.forEach((id, i) => {
      if (id === meuId) meuAPe = m.j[i][11] === 1;
      else remotos.get(id)?.receber(m.j[i]);
    });
    atualizarVisibilidadeRemotos();
    // Ajusta o relógio estimado do servidor (suavizado para não dar saltos)
    const medido = m.agora - Date.now();
    desvioRelogio = desvioRelogio === 0 ? medido : desvioRelogio + (medido - desvioRelogio) * 0.1;
    caos.aplicar(m.jogo?.evento ?? null, veiculo);
    if (!m.jogo) return;

    // Sons de contagem regressiva e de novo evento de caos
    if (m.jogo.contagem !== ultimaContagem) {
      if (m.jogo.contagem > 0) efeito('contagem');
      else if (ultimaContagem > 0) {
        efeito('vai');
        hud.mostrarBanner('VAI!', 1000, 'grande');
      }
      ultimaContagem = m.jogo.contagem;
    }
    if (m.jogo.evento && m.jogo.evento.id !== ultimoEventoSom) {
      ultimoEventoSom = m.jogo.evento.id;
      efeito('evento');
    }
    jogoAtual = m.jogo;

    // Modo van: o servidor diz se o entregador está a pé; a gente cria/remove o personagem
    if (emVan() && papeis.includes('entregador')) {
      if (meuAPe && !pedestre) criarPedestreAoLado();
      else if (!meuAPe && pedestre) destruirPedestre();
    }

    const jv = jogoVisivel(m.jogo);
    pacotesVis.definir(jv.pacotes, jv.pedidos);
    const marcar = emVan() ? tenho('gerente') || tenho('entregador') : true;
    marcadores.definir(marcar ? jv.pedidos : [], marcar ? jv.pacotes : []);
    hud.atualizar(jv, ctxHud(m.agora));
    aplicarModificadores();
  });

  rede.em('fx', (m) => {
    const meu = m.id === meuId;
    if (m.k === 'entrega') {
      hud.popup(`+${fmtDin(m.v ?? 0)}`, '#ffe14d');
      particulas.confete(m.x, m.y, m.z);
      efeito('moeda');
      if (meu) for (const c of aoEntregar(m.w ?? 0, m.tp, caos.atual?.tipo === 'chuva')) anunciarConquista(c.icone, c.nome);
    } else if (m.k === 'explodiu') {
      hud.popup('💥 BOOM! O gás explodiu!', '#ffb36b');
      particulas.faiscas(m.x, m.y, m.z, 30);
      camera.tremer(0.6);
      efeito('batida', 1);
    } else if (m.k === 'esfriou') {
      hud.popup('🧊 A pizza esfriou!', '#bfe6ff');
      efeito('perdido');
    } else if (m.k === 'fugiu') {
      hud.popup('🐶 O pet fugiu! Pegue de volta (E)', '#ffe0a8');
      efeito('pegar', 0.6);
    } else if (m.k === 'quebrou') {
      hud.popup('💥 Pacote quebrou!', '#ff8a8a');
      particulas.faiscas(m.x, m.y, m.z, 16);
      efeito('quebrou');
    } else if (m.k === 'derramou') {
      hud.popup('💧 Tudo derramou!', '#8ac8ff');
      efeito('quebrou', 0.6);
    } else if (m.k === 'caiu') {
      hud.popup('🎈 Pacote caiu!', '#fff');
      efeito('pegar', 0.5);
    } else if (m.k === 'perdido') {
      hud.popup('⏰ Pedido perdido', '#ff8a8a');
      efeito('perdido');
    } else if (m.k === 'pegou' && meu) {
      hud.popup('📦 Pegou!', '#b8ffb8');
      efeito('pegar');
    }
  });

  rede.em('resultado', (m) => {
    // XP, recorde e conquistas desta partida (guardados neste navegador)
    const p = aoTerminar(m.r, meuId, m.r.modo);
    for (const c of p.novas) anunciarConquista(c.icone, c.nome);
    const extra = `<div class="destaque xp">⭐ <span>+${p.xpGanho} XP · Nível ${p.nivel}${p.recorde ? ' · 🎉 NOVO RECORDE de dinheiro!' : ''}</span></div>`;
    hud.mostrarResultado(
      m.r,
      meuId === sala?.anfitriao,
      () => rede.enviar({ t: 'voltar' }),
      () => {
        // "Jogar de novo": volta ao lobby e já inicia com as mesmas configurações
        rede.enviar({ t: 'voltar' });
        rede.enviar({ t: 'iniciar' });
      },
      extra,
    );
  });

  function anunciarConquista(icone: string, nome: string) {
    hud.popup(`${icone} ${nome}`, '#ffe14d');
    ui.aviso(`🏆 Conquista: ${nome}`);
    efeito('moeda');
  }

  // ---------- Voz por proximidade e balões ----------
  /** Posição de um jogador no mundo (quem está dentro da van fica na posição da van). */
  function posDeJogador(id: string): THREE.Vector3 | null {
    if (id === meuId) return alvoCamera()?.pos ?? null;
    const r = remotos.get(id);
    if (!r) return null;
    if (emVan() && !r.aPe && !(papeisDe.get(id) ?? []).includes('motorista')) return posVan()?.pos ?? null;
    return r.grupo.position;
  }
  const voz = new Voz(
    (para, dados) => rede.enviar({ t: 'voz', para, dados }),
    posDeJogador,
    () => alvoCamera()?.pos ?? null,
  );
  ui.aoMic = async () => {
    if (voz.micLigado) {
      voz.desligarMic();
      return false;
    }
    const ok = await voz.ligarMic();
    if (ok) ui.aviso('🎙️ Microfone ligado: só quem está perto ouve você');
    else ui.aviso('Não consegui acessar o microfone (permissão negada?)');
    return ok;
  };
  ui.aoEmote = (k) => rede.enviar({ t: 'emote', k });

  /** Objeto 3D onde o balão de fala deve aparecer. */
  function objetoDe(id: string): THREE.Object3D | null {
    const aPeDono = id === meuId ? !!pedestre : !!remotos.get(id)?.aPe;
    if (emVan() && !aPeDono) {
      const mot = sala?.jogadores.find((j) => (papeisDe.get(j.id) ?? []).includes('motorista'));
      return veiculo?.objeto ?? (mot ? (remotos.get(mot.id)?.grupo ?? null) : null);
    }
    if (id === meuId) return pedestre?.objeto ?? veiculo?.objeto ?? null;
    return remotos.get(id)?.grupo ?? null;
  }

  // ---------- O que cada jogador pode ver ----------
  /** Pedidos visíveis para mim: individual = só os meus; van = ativos (e as ofertas, se eu for o gerente). */
  function jogoVisivel(j: JogoTick): JogoTick {
    let pedidos = j.pedidos;
    if (modo === 'individual') pedidos = j.pedidos.filter((p) => p.dono === meuId);
    else if (modo === 'van') pedidos = j.pedidos.filter((p) => p.estado === 'ativo' || (p.estado === 'oferta' && tenho('gerente')));
    const ids = new Set(pedidos.map((p) => p.id));
    // Pacotes esperando coleta só aparecem se o pedido é visível para mim
    const pacotes = j.pacotes.filter((pk) => pk.estado !== 'coleta' || ids.has(pk.id));
    return { ...j, pedidos, pacotes };
  }

  function ctxHud(agora: number): CtxHud {
    return {
      meuId,
      modo,
      agora,
      lista: !emVan() || papeis.some((p) => p !== 'motorista'),
      coord: emVan(),
      ofertas: emVan() && papeis.includes('gerente'),
    };
  }

  /** Pacotes que EU estou carregando (segundo o servidor). */
  function minhasCargas() {
    return jogoAtual?.pacotes.filter((p) => p.dono === meuId) ?? [];
  }

  /** Quem está "dentro da van" não aparece; o entregador só aparece quando está a pé. */
  function atualizarVisibilidadeRemotos() {
    const vanJogo = emVan();
    for (const [id, r] of remotos) {
      const ehMot = (papeisDe.get(id) ?? []).includes('motorista');
      r.mostrar = !vanJogo || ehMot || r.aPe;
    }
  }

  /** Onde cada pacote carregado fica encaixado: no veículo, na van ou nas costas do entregador a pé. */
  function alvoCarga(dono: string) {
    const aPeDono = dono === meuId ? !!pedestre : !!remotos.get(dono)?.aPe;
    if (emVan()) {
      if (aPeDono) {
        const carga = dono === meuId ? pedestre?.carga : remotos.get(dono)?.carga;
        return carga ? { carga, offset: [0, 1.25, -0.45] as [number, number, number] } : null;
      }
      const mot = sala?.jogadores.find((j) => (papeisDe.get(j.id) ?? []).includes('motorista'));
      const carga = veiculo ? veiculo.carga : mot ? remotos.get(mot.id)?.carga : undefined;
      return carga ? { carga, offset: OFFSET_CARGA.van } : null;
    }
    if (dono === meuId) return veiculo ? { carga: veiculo.carga, offset: OFFSET_CARGA[veiculo.tipo] } : null;
    const r = remotos.get(dono);
    return r ? { carga: r.carga, offset: OFFSET_CARGA[r.info.veic] } : null;
  }

  /** Carga pesada deixa o veículo lento; upgrades da equipe deixam mais rápido/estável. */
  function aplicarModificadores() {
    if (!veiculo) return;
    const pesados =
      fase !== 'jogo'
        ? 0
        : emVan()
          ? (jogoAtual?.pacotes.filter((p) => p.tipo === 'pesado' && p.estado === 'carregado').length ?? 0)
          : minhasCargas().filter((p) => p.tipo === 'pesado').length;
    const u = sala?.upgrades ?? { velocidade: 0, estabilidade: 0, capacidade: 0 };
    veiculo.multVel = Math.max(0.55, 1 - 0.22 * pesados) * (1 + 0.07 * u.velocidade);
    veiculo.multAcel = Math.max(0.5, 1 - 0.2 * pesados) * (1 + 0.08 * u.velocidade);
    veiculo.estabilidade = u.estabilidade;
  }

  /** Para onde a seta aponta: entrega do que carrego, senão a coleta/pacote mais próximo. */
  function calcularAlvo(porPapel: boolean) {
    const a = alvoCamera();
    if (!a || !jogoAtual || fase !== 'jogo' || jogoAtual.contagem > 0) return null;
    if (porPapel && emVan() && !tenho('entregador')) return null; // só o entregador usa a seta
    const jv = jogoVisivel(jogoAtual);
    const p = a.pos;
    let melhor: { x: number; z: number; cor: string; nome: string; entrega: boolean } | null = null;
    let md = Infinity;
    const ped = (id: number) => jv.pedidos.find((x) => x.id === id);
    // No modo van o que importa é o que a VAN carrega (quem pegou é o entregador)
    const minhas = emVan() ? jv.pacotes.filter((k) => k.estado === 'carregado') : minhasCargas();
    const candidatos = minhas.length
      ? minhas.map((k) => {
          const pt = PONTOS_ENTREGA[ped(k.id)?.entrega ?? 0];
          return { x: pt.x, z: pt.z, cor: ped(k.id)?.cor ?? '#fff', nome: pt.nome, entrega: true };
        })
      : jv.pacotes
          .filter((k) => k.estado !== 'carregado')
          .map((k) => {
            const pe = ped(k.id);
            const pt = k.estado === 'coleta' ? PONTOS_COLETA[pe?.coleta ?? 0] : { x: k.pos[0], z: k.pos[2], nome: 'pacote no chão' };
            return { x: pt.x, z: pt.z, cor: pe?.cor ?? '#fff', nome: pt.nome, entrega: false };
          });
    for (const c of candidatos) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < md) {
        md = d;
        melhor = c;
      }
    }
    return melhor;
  }
  const alvoSeta = () => calcularAlvo(true);

  /** Dica falada para o navegador: direção relativa ao rumo da van e distância até o destino. */
  function dicaNavegador(): string {
    const a = alvoCamera();
    const alvo = calcularAlvo(false);
    if (!a || !alvo) return '';
    const dx = alvo.x - a.pos.x;
    const dz = alvo.z - a.pos.z;
    let rel = Math.atan2(dx, dz) - a.rumo;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const dir =
      Math.abs(rel) < 0.5 ? '⬆️ Siga em frente' : Math.abs(rel) > 2.6 ? '🔄 Faça o retorno' : rel < 0 ? '➡️ Vire à direita' : '⬅️ Vire à esquerda';
    return `🧭 <b>${dir}</b> · ${Math.round(Math.hypot(dx, dz))} m até ${alvo.entrega ? '🏁' : '📦'} ${alvo.nome}<small>${coordenada(alvo.x, alvo.z)}</small>`;
  }

  /** Mostra/oculta o minimapa (e o botão de descer da van) conforme o modo e o papel. */
  function atualizarInterfacePapel() {
    const mapaVisivel = fase === 'jogo' && (!emVan() || tenho('navegador'));
    minimapa.visivel(mapaVisivel);
    const tam = emVan() ? 230 : 140;
    if (tam !== tamMapa) {
      tamMapa = tam;
      minimapa.definirTamanho(tam);
    }
    hud.definirPapeis(emVan() ? papeis : []);
    elBtnVan.hidden = !(emVan() && tenho('entregador'));
  }

  /** Muda de fase: lobby → jogo → resultado → lobby. */
  function aplicarFase(nova: Fase) {
    if (nova === fase) return;
    const antes = fase;
    fase = nova;
    hud.partidaVisivel(nova === 'jogo');
    if (nova === 'jogo') mostrarRota = emVan() && tenho('navegador'); // o navegador já começa com a rota ligada
    if (nova === 'jogo') {
      hud.esconderResultado();
      voltarParaLargada();
      hud.mostrarBanner(emVan() ? 'Mesmo carro! Cada um com seu papel' : 'Prepare-se!', 2200);
      meuAPe = false;
    } else if (nova === 'lobby' && antes === 'resultado') {
      hud.esconderResultado();
      jogoAtual = null;
      pacotesVis.limpar();
      marcadores.limpar();
      voltarParaLargada();
    }
    aplicarModificadores();
  }

  function voltarParaLargada() {
    if (!veiculo) return;
    const l = posicaoLargada(emVan() ? 1 : slot);
    veiculo.reposicionar(l.x, l.z, l.yaw);
  }

  function sincronizarSala(s: SalaInfo) {
    sala = s;
    modo = s.modo;
    papeisDe.clear();
    for (const j of s.jogadores) papeisDe.set(j.id, j.papeis);
    papeis = papeisDe.get(meuId) ?? [];
    mundo.aplicarTema(s.mapa ?? 'cidade'); // todos veem o mesmo visual de mapa
    voz.definirPares(meuId, s.jogadores.map((j) => j.id));
    const vanJogo = s.modo === 'van' && s.fase === 'jogo';
    ajustarEntidadesLocais(vanJogo);

    const vistos = new Set<string>();
    for (const j of s.jogadores) {
      if (j.id === meuId) {
        // O servidor valida o perfil (ex.: chapéu que a equipe não comprou volta para "nenhum")
        Object.assign(ui.perfil, { veic: j.veic, cor: j.cor, chapeu: j.chapeu, buzina: j.buzina });
        veiculo?.trocarTipo(vanJogo ? 'van' : j.veic);
        veiculo?.definirAparencia(j.cor, j.chapeu);
        elTipo.textContent = '';
        continue;
      }
      vistos.add(j.id);
      const ehMot = vanJogo && j.papeis.includes('motorista');
      const info = ehMot ? { ...j, veic: 'van' as const } : j; // a van do jogo é sempre uma van
      const forma = vanJogo && !ehMot ? 'pedestre' : 'veiculo';
      const r = remotos.get(j.id);
      if (r) r.atualizarInfo(info, forma);
      else {
        const novo = new VeiculoRemoto(fisica, info, forma);
        remotos.set(j.id, novo);
        mundo.cena.add(novo.grupo);
      }
    }
    for (const [id, r] of remotos) {
      if (!vistos.has(id)) {
        r.destruir();
        remotos.delete(id);
        ui.aviso('Um jogador saiu da sala');
      }
    }
    aplicarFase(s.fase);
    atualizarVisibilidadeRemotos();
    atualizarInterfacePapel();
    if (s.fase === 'lobby') ui.atualizarLobby(s, meuId);
    else ui.esconderLobby();
    aplicarModificadores();
  }

  // Menu: conecta e cria/entra na sala
  async function conectarE(acao: () => void) {
    try {
      if (!rede.conectado) await rede.conectar();
      acao();
    } catch {
      ui.erroMenu('Não consegui conectar ao servidor. Ele está ligado?');
    }
  }
  const perfilParaMsg = (p: PerfilMsg): PerfilMsg => ({ ...p });
  ui.mostrarMenu({
    aoCriar: (p) => void conectarE(() => rede.enviar({ t: 'criar', ...perfilParaMsg(p) })),
    aoEntrar: (codigo, p) =>
      void conectarE(() => rede.enviar({ t: 'entrar', codigo: codigo.toUpperCase(), ...perfilParaMsg(p) })),
  });
  ui.aoIniciar = () => rede.enviar({ t: 'iniciar' });
  ui.aoConfig = (c) => rede.enviar({ t: 'config', ...c });
  // Lista de salas públicas na tela inicial: conecta em silêncio e atualiza a cada poucos segundos
  void rede.conectar().then(() => rede.enviar({ t: 'listar' })).catch(() => {});
  const listaTimer = window.setInterval(() => {
    if (!document.getElementById('tela-menu')) return clearInterval(listaTimer);
    if (rede.conectado) rede.enviar({ t: 'listar' });
  }, 4000);
  ui.aoModo = (m) => rede.enviar({ t: 'modo', modo: m });
  ui.aoComprar = (item) => rede.enviar({ t: 'comprar', item });
  hud.aoAceitar = (id) => rede.enviar({ t: 'aceitar', id });
  ui.aoMudarPerfil = (p) => {
    if (veiculo && !emVan()) {
      veiculo.trocarTipo(ui.perfil.veic);
      veiculo.definirAparencia(ui.perfil.cor, ui.perfil.chapeu);
    }
    rede.enviar({ t: 'perfil', ...p });
  };

  function redimensionar() {
    renderizador.setSize(window.innerWidth, window.innerHeight, false);
    camera.redimensionar(window.innerWidth / window.innerHeight);
    particulas.redimensionar(canvas.height, 66);
  }
  window.addEventListener('resize', redimensionar);

  /** Aplica um nível de qualidade (manual pelo botão ⚙️, ou automático quando o FPS cai). */
  function aplicarQualidade(q: Qualidade, automatico = false) {
    qualidade = q;
    const c = QUALIDADES[q];
    if (!automatico) salvarQualidade(q);
    renderizador.setPixelRatio(Math.min(window.devicePixelRatio, c.pixelRatio));
    mundo.sol.castShadow = c.sombras;
    if (mundo.sol.shadow.mapSize.x !== c.tamanhoSombra) {
      mundo.sol.shadow.mapSize.set(c.tamanhoSombra, c.tamanhoSombra);
      mundo.sol.shadow.map?.dispose();
      mundo.sol.shadow.map = null;
    }
    particulas.densidade = c.particulas;
    ui.definirRotuloQualidade(c.nome);
    redimensionar();
    monitorFps.reiniciar();
    if (automatico) ui.aviso('Gráficos reduzidos para manter o jogo fluido');
  }
  ui.celular = celular;
  ui.aoQualidade = () => aplicarQualidade(proximaQualidade(qualidade));
  aplicarQualidade(qualidade);

  window.addEventListener('pointerdown', destravarAudio, { once: true });
  window.addEventListener('keydown', destravarAudio, { once: true });
  window.addEventListener('keydown', (e) => {
    const alvo = e.target as HTMLElement;
    if (alvo.tagName === 'INPUT') return;
    if (e.code === 'KeyR' && veiculo && !pedestre) voltarParaLargada();
    // Emotes rápidos: teclas 7, 8, 9 e 0
    const emoteIdx = ({ Digit7: 0, Digit8: 1, Digit9: 2, Digit0: 3 } as Record<string, number>)[e.code];
    if (emoteIdx !== undefined && entrou) rede.enviar({ t: 'emote', k: EMOTES[emoteIdx] });
    // Gerente (modo van): teclas 1, 2 e 3 aceitam as ofertas da lista
    const n = ({ Digit1: 0, Digit2: 1, Digit3: 2 } as Record<string, number>)[e.code];
    if (n !== undefined && emVan() && tenho('gerente') && jogoAtual) {
      const oferta = jogoAtual.pedidos.filter((p) => p.estado === 'oferta')[n];
      if (oferta) rede.enviar({ t: 'aceitar', id: oferta.id });
    }
  });

  /** F / botão 🚐: o entregador desce ou sobe da van. */
  function alternarVan() {
    if (!emVan() || !tenho('entregador')) return;
    const v = posVan();
    if (pedestre) {
      if (v && pedestre.objeto.position.distanceTo(v.pos) > 7) return ui.aviso('Chegue mais perto da van para subir');
      rede.enviar({ t: 'van', acao: 'entrar' });
    } else {
      if (v && v.vel > 4) return ui.aviso('Peça para o motorista parar a van para você descer');
      rede.enviar({ t: 'van', acao: 'sair' });
    }
  }

  // ---------- Laço principal ----------
  let anterior = performance.now();
  let velMostrada = -1;
  let pularAntes = false;
  let ctrl = controles.ler();
  let ultimoEnvio = 0;
  let ultimoMapa = 0;
  let ultimaDica = 0;
  let velocistaOk = false;

  function quadro(agora: number) {
    const dt = Math.min(0.05, (agora - anterior) / 1000); // limita saltos (aba em segundo plano)
    anterior = agora;
    ctrl = controles.ler();
    if (monitorFps.quadro(agora)) {
      const pior = piorQualidade(qualidade);
      if (pior) aplicarQualidade(pior, true);
    }

    if (ctrl.van) alternarVan();
    if (veiculo && !pedestre && ctrl.buzina) {
      buzinar(ui.perfil.buzina);
      rede.enviar({ t: 'buzina' });
    }
    if (ctrl.pular && !pularAntes) {
      if (pedestre) pedestre.pedirPulo();
      else if (veiculo) {
        veiculo.pedirPulo();
        if (veiculo.noChao) efeito('pulo');
      }
    }
    pularAntes = ctrl.pular;
    if (ctrl.pegar && (pedestre || (veiculo && !emVan()))) rede.enviar({ t: 'acao' });

    // Física em passo fixo; o visual é interpolado com `alfa`
    const alfa = fisica.avancar(
      dt,
      (passo) => {
        veiculo?.passo(passo, pedestre ? PARADO : ctrl);
        pedestre?.passo(passo, ctrl);
        for (const r of remotos.values()) r.passoFisico();
        transito.passoFisico();
      },
      () => {
        veiculo?.depoisDoPasso();
        pedestre?.depoisDoPasso();
      },
    );
    cenario.sincronizar();
    for (const r of remotos.values()) r.atualizarVisual(dt);
    const alvo = alvoCamera();
    pacotesVis.atualizar(dt, { alvoCarga });
    marcadores.atualizar(dt);
    mundo.definirHora(agoraServidor() / 1000 / CICLO_DIA_S); // dia e noite iguais para todos
    mundo.atualizar(dt);
    bolhas.atualizar(agora);
    voz.atualizar(agora);
    transito.atualizarVisual();
    caos.atualizar(dt, veiculo, camera.camera.position);
    // Poeira de derrapagem nas rodas traseiras
    if (veiculo && veiculo.derrapagem > 4 && Math.abs(veiculo.velocidade) > 4) {
      const p = veiculo.objeto.position;
      const sx = Math.sin(veiculo.rumo);
      const cz = Math.cos(veiculo.rumo);
      for (const lado of [-0.45, 0.45]) particulas.fumaca(p.x - sx * 1.0 + cz * lado, 0, p.z - cz * 1.0 - sx * lado);
    }
    particulas.atualizar(dt);

    if (fase === 'jogo' && agora - ultimoMapa > 100 && alvo && (!emVan() || tenho('navegador'))) {
      ultimoMapa = agora;
      minimapa.desenhar({
        eu: { x: alvo.pos.x, z: alvo.pos.z, rumo: alvo.rumo },
        amigos: [...remotos.values()].filter((r) => r.mostrar && r.grupo.visible).map((r) => ({ x: r.grupo.position.x, z: r.grupo.position.z, cor: r.info.cor })),
        carros: transito.posicoes(),
        jogo: jogoAtual ? jogoVisivel(jogoAtual) : null,
        meuId,
        rota: mostrarRota && calcularAlvo(false) ? rotaPelasRuas({ x: alvo.pos.x, z: alvo.pos.z }, calcularAlvo(false)!) : null,
      });
    }
    // Dica falada do navegador + quem está falando no chat de voz (atualizadas poucas vezes por segundo)
    if (agora - ultimaDica > 250) {
      ultimaDica = agora;
      hud.definirDica(emVan() && tenho('navegador') ? dicaNavegador() : '');
      const nomes: string[] = [];
      for (const id of voz.falando) nomes.push(id === meuId ? 'Você' : (sala?.jogadores.find((j) => j.id === id)?.nome ?? '?'));
      hud.definirFalando(nomes);
      if (alvo && Math.abs(alvo.vel) * 3.6 >= 100 && !velocistaOk) {
        velocistaOk = true;
        const c = desbloquear('velocista');
        if (c) anunciarConquista(c.icone, c.nome);
      }
    }
    seta.atualizar(dt, alvo?.pos ?? new THREE.Vector3(), alvoSeta());

    veiculo?.atualizarVisual(dt, alfa);
    pedestre?.atualizarVisual(dt, alfa);

    if (alvo) {
      camera.atualizar(dt, alvo.pos, alvo.rumo, alvo.vel, ctrl);
      mundo.seguir(alvo.pos);

      const kmh = Math.round(Math.abs(alvo.vel) * 3.6);
      if (kmh !== velMostrada) {
        velMostrada = kmh;
        elVel.textContent = String(kmh);
      }

      // Posição para os outros jogadores (20 vezes por segundo): a pé ou de veículo
      if (agora - ultimoEnvio > 50 && rede.conectado) {
        ultimoEnvio = agora;
        if (pedestre) rede.enviar({ t: 'estado', ...pedestre.snapshot(), cap: 0 });
        else if (veiculo) rede.enviar({ t: 'estado', ...veiculo.snapshot(), cap: veiculo.capotadas });
      }

      // Sons: meu motor + motores dos amigos (mais baixos com a distância)
      if (veiculo) motorLocal.atualizar(Math.min(1, Math.abs(veiculo.velocidade) / veiculo.config.velMax), 1);
      else motorLocal.atualizar(0, 0);
      for (const r of remotos.values()) {
        const ativo = r.mostrar && r.forma === 'veiculo';
        r.motor.atualizar(Math.min(1, r.velocidade / 20), ativo ? volumeDistancia(r.grupo.position, alvo.pos, 60) : 0);
      }
    } else {
      // Menu: câmera girando em volta da cidade
      const a = agora / 9000;
      camera.camera.position.set(Math.cos(a) * 45, 16, Math.sin(a) * 45);
      camera.camera.lookAt(0, 2, 0);
    }

    renderizador.render(mundo.cena, camera.camera);
    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);

  // Exposto só em desenvolvimento, para depurar pelo console
  if (import.meta.env.DEV) {
    Object.defineProperty(window, 'veiculo', { get: () => veiculo });
    Object.defineProperty(window, 'pedestre', { get: () => pedestre });
    Object.assign(window, { fisica, remotos, rede, hud, caos, transito, sala: () => sala, INFO_PAPEL, PONTOS_COLETA, PONTOS_ENTREGA, mundo });
  }
}

/** Volume (0..1) que cai com o quadrado da distância. */
function volumeDistancia(a: THREE.Vector3, b: THREE.Vector3, alcance: number) {
  const f = Math.max(0, 1 - a.distanceTo(b) / alcance);
  return f * f;
}

void iniciar();

// PWA: permite instalar o jogo como app (só na versão publicada)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
