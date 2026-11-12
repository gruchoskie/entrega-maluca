// Entrada unificada: teclado + mouse (PC) e joystick virtual + botões (celular).

export interface EstadoControles {
  acelerar: number; // -1 (ré) .. 1 (frente)
  direcao: number; // -1 (esquerda) .. 1 (direita)
  pular: boolean; // segurando pular / freio de mão
  pegar: boolean; // pulso: apertou neste quadro
  buzina: boolean; // pulso: apertou neste quadro
  trocar: boolean; // pulso: trocar veículo (provisório até o lobby)
  camDX: number; // arrasto da câmera neste quadro (px)
  camDY: number;
}

/** Detecta se o aparelho é de toque (celular/tablet). */
export function ehCelular(): boolean {
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    ('ontouchstart' in window && navigator.maxTouchPoints > 0)
  );
}

export class Controles {
  readonly celular = ehCelular();

  private teclas = new Set<string>();
  private joyX = 0;
  private joyY = 0;
  private pularToque = false;
  private pulsoPegar = false;
  private pulsoBuzina = false;
  private pulsoTrocar = false;
  private camDX = 0;
  private camDY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.ligarTeclado();
    this.ligarCamera(canvas);
    if (this.celular) this.ligarToque();
  }

  /** Lê o estado do quadro e zera pulsos/deltas. */
  ler(): EstadoControles {
    const t = this.teclas;
    let acelerar = 0;
    let direcao = 0;
    if (t.has('KeyW') || t.has('ArrowUp')) acelerar += 1;
    if (t.has('KeyS') || t.has('ArrowDown')) acelerar -= 1;
    if (t.has('KeyD') || t.has('ArrowRight')) direcao += 1;
    if (t.has('KeyA') || t.has('ArrowLeft')) direcao -= 1;

    // Joystick soma com o teclado (útil em tablet com teclado)
    acelerar = limitar(acelerar - this.joyY, -1, 1);
    direcao = limitar(direcao + this.joyX, -1, 1);

    const estado: EstadoControles = {
      acelerar,
      direcao,
      pular: t.has('Space') || this.pularToque,
      pegar: this.pulsoPegar,
      buzina: this.pulsoBuzina,
      trocar: this.pulsoTrocar,
      camDX: this.camDX,
      camDY: this.camDY,
    };
    this.pulsoPegar = this.pulsoBuzina = this.pulsoTrocar = false;
    this.camDX = this.camDY = 0;
    return estado;
  }

  // ---------- Teclado ----------
  private ligarTeclado() {
    window.addEventListener('keydown', (e) => {
      if (digitando(e)) return; // não rouba teclas de campos de texto
      if (e.repeat) return;
      this.teclas.add(e.code);
      if (e.code === 'KeyE') this.pulsoPegar = true;
      if (e.code === 'KeyC') this.pulsoBuzina = true;
      if (e.code === 'KeyV') this.pulsoTrocar = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.teclas.delete(e.code));
    window.addEventListener('blur', () => this.teclas.clear());
  }

  // ---------- Câmera: arrastar no canvas (mouse ou dedo) ----------
  private ligarCamera(canvas: HTMLCanvasElement) {
    let ponteiro: number | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (ponteiro !== null) return;
      ponteiro = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== ponteiro) return;
      this.camDX += e.movementX;
      this.camDY += e.movementY;
    });
    const soltar = (e: PointerEvent) => {
      if (e.pointerId === ponteiro) ponteiro = null;
    };
    canvas.addEventListener('pointerup', soltar);
    canvas.addEventListener('pointercancel', soltar);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- Toque: joystick + botões ----------
  private ligarToque() {
    const raiz = document.getElementById('toque')!;
    raiz.hidden = false;

    const zona = document.getElementById('joy-zona')!;
    const base = document.getElementById('joy-base')!;
    const pino = document.getElementById('joy-pino')!;
    const RAIO = 50;
    let dedo: number | null = null;

    const mover = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > RAIO) {
        dx = (dx / d) * RAIO;
        dy = (dy / d) * RAIO;
      }
      pino.style.transform = `translate(${dx}px, ${dy}px)`;
      // Zona morta pequena para não tremer
      this.joyX = zonaMorta(dx / RAIO, 0.15);
      this.joyY = zonaMorta(dy / RAIO, 0.15);
    };
    const soltar = (e: PointerEvent) => {
      if (e.pointerId !== dedo) return;
      dedo = null;
      this.joyX = this.joyY = 0;
      pino.style.transform = '';
    };
    zona.addEventListener('pointerdown', (e) => {
      if (dedo !== null) return;
      dedo = e.pointerId;
      zona.setPointerCapture(e.pointerId);
      mover(e);
    });
    zona.addEventListener('pointermove', (e) => {
      if (e.pointerId === dedo) mover(e);
    });
    zona.addEventListener('pointerup', soltar);
    zona.addEventListener('pointercancel', soltar);

    // Botões
    const botao = (id: string, aoApertar: () => void, aoSoltar?: () => void) => {
      const el = document.getElementById(id)!;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.classList.add('ativo');
        aoApertar();
      });
      const fim = () => {
        el.classList.remove('ativo');
        aoSoltar?.();
      };
      el.addEventListener('pointerup', fim);
      el.addEventListener('pointercancel', fim);
      el.addEventListener('pointerleave', fim);
    };
    botao('btn-pular', () => (this.pularToque = true), () => (this.pularToque = false));
    botao('btn-pegar', () => (this.pulsoPegar = true));
    botao('btn-buzina', () => (this.pulsoBuzina = true));
  }
}

export function digitando(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

function limitar(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function zonaMorta(v: number, z: number) {
  return Math.abs(v) < z ? 0 : (v - Math.sign(v) * z) / (1 - z);
}
