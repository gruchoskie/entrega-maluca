// Cliente WebSocket: envia mensagens ao servidor e distribui as recebidas por tipo.
import type { MsgCliente, MsgServidor } from '../../../shared/protocolo';

type Ouvinte<T extends MsgServidor['t']> = (m: Extract<MsgServidor, { t: T }>) => void;

/** Endereço do servidor: VITE_SERVIDOR (produção) ou a mesma máquina na porta 2567 (dev). */
export function urlServidor(): string {
  const env = import.meta.env.VITE_SERVIDOR as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:2567`;
}

export class Rede {
  private ws: WebSocket | null = null;
  private ouvintes = new Map<string, ((m: never) => void)[]>();
  conectado = false;

  em<T extends MsgServidor['t']>(tipo: T, fn: Ouvinte<T>) {
    const l = this.ouvintes.get(tipo) ?? [];
    l.push(fn as (m: never) => void);
    this.ouvintes.set(tipo, l);
  }

  private conectando: Promise<void> | null = null;

  /** Conecta (ou reaproveita a conexão/tentativa em andamento). */
  conectar(): Promise<void> {
    if (this.conectado) return Promise.resolve();
    if (this.conectando) return this.conectando;
    const p = this.abrir();
    this.conectando = p;
    const limpar = () => (this.conectando = null);
    p.then(limpar, limpar);
    return p;
  }

  private abrir(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(urlServidor());
      this.ws = ws;
      const falhou = setTimeout(() => {
        ws.close();
        reject(new Error('tempo esgotado'));
      }, 6000);
      ws.onopen = () => {
        clearTimeout(falhou);
        this.conectado = true;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(falhou);
        reject(new Error('falha de conexão'));
      };
      ws.onclose = () => {
        const estava = this.conectado;
        this.conectado = false;
        if (estava) this.emitir({ t: 'erro', msg: 'Conexão perdida com o servidor.' }); // falha ao conectar já é tratada por quem chamou
      };
      ws.onmessage = (e) => {
        try {
          this.emitir(JSON.parse(e.data as string) as MsgServidor);
        } catch {
          /* mensagem inválida: ignora */
        }
      };
    });
  }

  private emitir(m: MsgServidor) {
    for (const fn of this.ouvintes.get(m.t) ?? []) fn(m as never);
  }

  enviar(m: MsgCliente) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
