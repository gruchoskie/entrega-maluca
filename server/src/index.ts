// Servidor WebSocket do Entrega Maluca. Salas identificadas por código de 4 letras.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { TAXA_REDE } from '../../shared/constantes';
import type { MsgCliente } from '../../shared/protocolo';
import { Sala, type Jogador } from './sala';

const PORTA = Number(process.env.PORT ?? 2567);
const LETRAS = 'BCDFGHJKLMNPQRSTVWXZ'; // sem vogais: evita formar palavras feias

const salas = new Map<string, Sala>();

function novoCodigo(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += LETRAS[Math.floor(Math.random() * LETRAS.length)];
    if (!salas.has(c)) return c;
  }
}

// HTTP simples só para health-check (Render/Railway); o jogo vai por WebSocket
const http = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Entrega Maluca OK - ${salas.size} sala(s)`);
});
const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

interface Conexao extends WebSocket {
  vivo?: boolean;
}

wss.on('connection', (ws: Conexao) => {
  const id = randomBytes(4).toString('hex');
  let sala: Sala | null = null;
  let jogador: Jogador | null = null;
  ws.vivo = true;
  ws.on('pong', () => (ws.vivo = true));

  const erro = (msg: string) => ws.send(JSON.stringify({ t: 'erro', msg }));

  ws.on('message', (bruto) => {
    let m: MsgCliente;
    try {
      m = JSON.parse(bruto.toString());
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    // Ainda fora de sala: só aceita criar/entrar
    if (!sala || !jogador) {
      if (m.t === 'criar') {
        const codigo = novoCodigo();
        sala = new Sala(codigo);
        salas.set(codigo, sala);
        jogador = sala.adicionar(id, ws, m);
      } else if (m.t === 'entrar') {
        const alvo = salas.get(String(m.codigo ?? '').toUpperCase().trim());
        if (!alvo) return erro('Sala não encontrada. Confira o código.');
        if (alvo.cheia) return erro('Sala cheia (máximo de 4 jogadores).');
        sala = alvo;
        jogador = sala.adicionar(id, ws, m);
      }
      return;
    }
    sala.receber(jogador, m);
  });

  ws.on('close', () => {
    if (!sala) return;
    if (sala.remover(id)) salas.delete(sala.codigo);
  });
  ws.on('error', () => ws.close());
});

// Laço de rede e limpeza de conexões mortas
setInterval(() => {
  for (const s of salas.values()) s.tick();
}, 1000 / TAXA_REDE);

setInterval(() => {
  for (const ws of wss.clients as Set<Conexao>) {
    if (!ws.vivo) {
      ws.terminate();
      continue;
    }
    ws.vivo = false;
    ws.ping();
  }
}, 30000);

http.listen(PORTA, () => console.log(`Entrega Maluca: servidor na porta ${PORTA}`));
