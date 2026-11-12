// Ponto de entrada: monta os módulos e roda o laço do jogo.
import * as THREE from 'three';
import { posicaoLargada } from '../../shared/constantes';
import { PONTOS_COLETA, PONTOS_ENTREGA } from '../../shared/cidade';
import type { Fase, JogoTick, PerfilMsg, SalaInfo } from '../../shared/protocolo';
import { Motor, buzinar, destravarAudio } from './audio/audio';
import { efeito, iniciarMusica } from './audio/efeitos';
import { Particulas } from './efeitos/particulas';
import { Fisica } from './fisica/fisica';
import { Marcadores, PacotesVisuais, Seta } from './jogo/pacotes';
import { Controles } from './interface/controles';
import { Hud, fmtDin } from './interface/hud';
import { Minimapa } from './interface/minimapa';
import {
  MonitorFps, QUALIDADES, piorQualidade, proximaQualidade, qualidadeInicial, salvarQualidade, type Qualidade,
} from './interface/qualidade';
import { Ui } from './interface/ui';
import { CameraSeguidora } from './mundo/camera';
import { Caos } from './mundo/caos';
import { criarCenario } from './mundo/cenario';
import { Transito } from './mundo/transito';
import { criarMundo } from './mundo/mundo';
import { Rede } from './rede/rede';
import { Veiculo } from './veiculo/veiculo';
import { VeiculoRemoto } from './veiculo/remoto';

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
  const minimapa = new Minimapa();
  minimapa.visivel(false);
  // Relógio do servidor (estimado): trânsito e eventos ficam iguais para todos
  let desvioRelogio = 0;
  const agoraServidor = () => Date.now() + desvioRelogio;
  const transito = new Transito(fisica, mundo.cena, () => agoraServidor() / 1000);
  const caos = new Caos(fisica, mundo, transito);

  // ---------- Estado da partida ----------
  let veiculo: Veiculo | null = null;
  let meuId = '';
  let sala: SalaInfo | null = null;
  let fase: Fase = 'lobby';
  let jogoAtual: JogoTick | null = null;
  let ultimaContagem = 0;
  let ultimoEventoSom = 0;
  const remotos = new Map<string, VeiculoRemoto>();
  const motorLocal = new Motor();
  let slot = 0;

  const elHud = document.getElementById('hud')!;
  const elVel = document.getElementById('vel')!;
  const elTipo = document.getElementById('veiculo-atual')!;
  const elDica = document.getElementById('dica')!;
  elDica.textContent = celular
    ? ''
    : 'WASD/setas: dirigir · Espaço: pular/freio de mão · E: pegar/passar/arremessar · C: buzina · R: reiniciar';

  // ---------- Rede ----------
  rede.em('bemvindo', (m) => {
    meuId = m.id;
    sala = m.sala;
    const eu = m.sala.jogadores.find((j) => j.id === m.id)!;
    slot = eu.slot;
    const l = posicaoLargada(slot);
    veiculo = new Veiculo(fisica, eu.veic, eu.cor, l.x, l.z, l.yaw, eu.chapeu);
    mundo.cena.add(veiculo.objeto);
    // Batidas e balanço: o servidor decide o estrago nos pacotes que estou carregando
    veiculo.aoImpacto = (g) => {
      if (minhasCargas().length) rede.enviar({ t: 'impacto', g });
      // Efeitos: tremor de câmera, som e faíscas proporcionais à batida
      const forca = Math.min(1, g / 14);
      camera.tremer(forca);
      efeito('batida', forca);
      if (g > 4 && veiculo) {
        const p = veiculo.objeto.position;
        particulas.faiscas(p.x, p.y + 0.4, p.z, g * 1.5);
      }
    };
    iniciarMusica();
    ui.tutorialSeNovo();
    veiculo.aoBalanco = (v) => {
      if (minhasCargas().some((p) => p.tipo === 'liquido')) rede.enviar({ t: 'balanco', v });
    };
    fase = m.sala.fase;
    hud.partidaVisivel(fase === 'jogo');
    minimapa.visivel(fase === 'jogo');
    ui.esconderMenu();
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
    if (r && veiculo) buzinar(r.info.buzina, volumeDistancia(r.grupo.position, veiculo.objeto.position, 70));
  });

  rede.em('tick', (m) => {
    m.ids.forEach((id, i) => {
      if (id !== meuId) remotos.get(id)?.receber(m.j[i]);
    });
    // Ajusta o relógio estimado do servidor (suavizado para não dar saltos)
    const medido = m.agora - Date.now();
    desvioRelogio = desvioRelogio === 0 ? medido : desvioRelogio + (medido - desvioRelogio) * 0.1;
    caos.aplicar(m.jogo?.evento ?? null, veiculo);
    if (m.jogo) {
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
      pacotesVis.definir(m.jogo.pacotes, m.jogo.pedidos);
      marcadores.definir(m.jogo.pedidos, m.jogo.pacotes);
      hud.atualizar(m.jogo, meuId, m.agora);
      aplicarModificadores();
    }
  });

  rede.em('fx', (m) => {
    const meu = m.id === meuId;
    if (m.k === 'entrega') {
      hud.popup(`+${fmtDin(m.v ?? 0)}`, '#ffe14d');
      particulas.confete(m.x, m.y, m.z);
      efeito('moeda');
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
    hud.mostrarResultado(m.r, meuId === sala?.anfitriao, () => rede.enviar({ t: 'voltar' }));
  });

  /** Pacotes que EU estou carregando (segundo o servidor). */
  function minhasCargas() {
    return jogoAtual?.pacotes.filter((p) => p.dono === meuId) ?? [];
  }

  /** Carga pesada deixa o veículo lento; upgrades da equipe deixam mais rápido/estável. */
  function aplicarModificadores() {
    if (!veiculo) return;
    const pesados = fase === 'jogo' ? minhasCargas().filter((p) => p.tipo === 'pesado').length : 0;
    const u = sala?.upgrades ?? { velocidade: 0, estabilidade: 0, capacidade: 0 };
    veiculo.multVel = Math.max(0.55, 1 - 0.22 * pesados) * (1 + 0.07 * u.velocidade);
    veiculo.multAcel = Math.max(0.5, 1 - 0.2 * pesados) * (1 + 0.08 * u.velocidade);
    veiculo.estabilidade = u.estabilidade;
  }

  /** Para onde a seta aponta: entrega do que carrego, senão a coleta/pacote mais próximo. */
  function alvoSeta() {
    if (!veiculo || !jogoAtual || fase !== 'jogo' || jogoAtual.contagem > 0) return null;
    const p = veiculo.objeto.position;
    let melhor: { x: number; z: number; cor: string } | null = null;
    let md = Infinity;
    const cor = (id: number) => jogoAtual!.pedidos.find((x) => x.id === id)?.cor ?? '#fff';
    const minhas = minhasCargas();
    const candidatos = minhas.length
      ? minhas.map((k) => ({ ...PONTOS_ENTREGA[jogoAtual!.pedidos.find((x) => x.id === k.id)?.entrega ?? 0], cor: cor(k.id) }))
      : jogoAtual.pacotes
          .filter((k) => k.estado !== 'carregado')
          .map((k) => {
            const ped = jogoAtual!.pedidos.find((x) => x.id === k.id);
            const ponto = k.estado === 'coleta' ? PONTOS_COLETA[ped?.coleta ?? 0] : { x: k.pos[0], z: k.pos[2] };
            return { x: ponto.x, z: ponto.z, cor: cor(k.id) };
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

  /** Muda de fase: lobby → jogo → resultado → lobby. */
  function aplicarFase(nova: Fase) {
    if (nova === fase) return;
    const antes = fase;
    fase = nova;
    hud.partidaVisivel(nova === 'jogo');
    minimapa.visivel(nova === 'jogo');
    if (nova === 'jogo') {
      hud.esconderResultado();
      voltarParaLargada();
      hud.mostrarBanner('Prepare-se!', 1500);
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
    const l = posicaoLargada(slot);
    veiculo.reposicionar(l.x, l.z, l.yaw);
  }

  function sincronizarSala(s: SalaInfo) {
    sala = s;
    const vistos = new Set<string>();
    for (const j of s.jogadores) {
      if (j.id === meuId) {
        // O servidor valida o perfil (ex.: chapéu que a equipe não comprou volta para "nenhum")
        Object.assign(ui.perfil, { veic: j.veic, cor: j.cor, chapeu: j.chapeu, buzina: j.buzina });
        veiculo?.trocarTipo(j.veic);
        veiculo?.definirAparencia(j.cor, j.chapeu);
        elTipo.textContent = '';
        continue;
      }
      vistos.add(j.id);
      const r = remotos.get(j.id);
      if (r) r.atualizarInfo(j);
      else {
        const novo = new VeiculoRemoto(fisica, j);
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
  ui.aoComprar = (item) => rede.enviar({ t: 'comprar', item });
  ui.aoMudarPerfil = (p) => {
    if (veiculo) {
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
    if (e.code === 'KeyR' && veiculo && (e.target as HTMLElement).tagName !== 'INPUT') {
      const l = posicaoLargada(slot);
      veiculo.reposicionar(l.x, l.z, l.yaw);
    }
  });

  // ---------- Laço principal ----------
  let anterior = performance.now();
  let velMostrada = -1;
  let pularAntes = false;
  let ctrl = controles.ler();
  let ultimoEnvio = 0;
  let ultimoMapa = 0;

  function quadro(agora: number) {
    const dt = Math.min(0.05, (agora - anterior) / 1000); // limita saltos (aba em segundo plano)
    anterior = agora;
    ctrl = controles.ler();
    if (monitorFps.quadro(agora)) {
      const pior = piorQualidade(qualidade);
      if (pior) aplicarQualidade(pior, true);
    }

    if (veiculo) {
      if (ctrl.buzina) {
        buzinar(ui.perfil.buzina);
        rede.enviar({ t: 'buzina' });
      }
      if (ctrl.pular && !pularAntes) {
        veiculo.pedirPulo();
        if (veiculo.noChao) efeito('pulo');
      }
      if (ctrl.pegar) rede.enviar({ t: 'acao' });
    }
    pularAntes = ctrl.pular;

    // Física em passo fixo; o visual é interpolado com `alfa`
    const alfa = fisica.avancar(
      dt,
      (passo) => {
        veiculo?.passo(passo, ctrl);
        for (const r of remotos.values()) r.passoFisico();
        transito.passoFisico();
      },
      () => veiculo?.depoisDoPasso(),
    );
    cenario.sincronizar();
    for (const r of remotos.values()) r.atualizarVisual(dt);
    pacotesVis.atualizar(dt, { meuId, veiculo, remotos });
    marcadores.atualizar(dt);
    mundo.atualizar(dt);
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
    if (fase === 'jogo' && agora - ultimoMapa > 100) {
      ultimoMapa = agora;
      minimapa.desenhar({
        eu: veiculo ? { x: veiculo.objeto.position.x, z: veiculo.objeto.position.z, rumo: veiculo.rumo } : null,
        amigos: [...remotos.values()].map((r) => ({ x: r.grupo.position.x, z: r.grupo.position.z, cor: r.info.cor })),
        carros: transito.posicoes(),
        jogo: jogoAtual,
        meuId,
      });
    }
    seta.atualizar(dt, veiculo?.objeto.position ?? new THREE.Vector3(), alvoSeta());

    if (veiculo) {
      veiculo.atualizarVisual(dt, alfa);
      camera.atualizar(dt, veiculo.objeto.position, veiculo.rumo, veiculo.velocidade, ctrl);
      mundo.seguir(veiculo.objeto.position);

      const kmh = Math.round(Math.abs(veiculo.velocidade) * 3.6);
      if (kmh !== velMostrada) {
        velMostrada = kmh;
        elVel.textContent = String(kmh);
      }

      // Posição para os outros jogadores (20 vezes por segundo)
      if (agora - ultimoEnvio > 50 && rede.conectado) {
        ultimoEnvio = agora;
        rede.enviar({ t: 'estado', ...veiculo.snapshot(), cap: veiculo.capotadas });
      }

      // Sons: meu motor + motores dos amigos (mais baixos com a distância)
      motorLocal.atualizar(Math.min(1, Math.abs(veiculo.velocidade) / veiculo.config.velMax), 1);
      for (const r of remotos.values()) {
        r.motor.atualizar(
          Math.min(1, r.velocidade / 20),
          volumeDistancia(r.grupo.position, veiculo.objeto.position, 60),
        );
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
    Object.assign(window, { fisica, remotos, rede, hud, caos, transito, sala: () => sala });
  }
}

/** Volume (0..1) que cai com o quadrado da distância. */
function volumeDistancia(a: THREE.Vector3, b: THREE.Vector3, alcance: number) {
  const f = Math.max(0, 1 - a.distanceTo(b) / alcance);
  return f * f;
}

void iniciar();
