// Mundo físico (Rapier) com passo fixo de 60 Hz.
// Passo fixo = comportamento idêntico em qualquer aparelho (e base para o multiplayer).
import RAPIER from '@dimforge/rapier3d-compat';

export const GRAVIDADE = 22; // um pouco acima de 9,8: deixa tudo mais "pesado e divertido"
export const PASSO = 1 / 60;

export class Fisica {
  readonly R = RAPIER;
  readonly mundo: RAPIER.World;
  private acumulador = 0;

  /** Carrega o WASM do Rapier (assíncrono) e cria o mundo. */
  static async criar(): Promise<Fisica> {
    await RAPIER.init();
    return new Fisica();
  }

  private constructor() {
    this.mundo = new RAPIER.World({ x: 0, y: -GRAVIDADE, z: 0 });
    this.mundo.timestep = PASSO;
  }

  /**
   * Avança a simulação por `dt` segundos reais em passos fixos.
   * @returns fração (0..1) do próximo passo, usada para interpolar o visual.
   */
  avancar(dt: number, antes: (passo: number) => void, depois: () => void): number {
    this.acumulador = Math.min(this.acumulador + dt, 0.1); // evita "espiral da morte"
    while (this.acumulador >= PASSO) {
      antes(PASSO);
      this.mundo.step();
      depois();
      this.acumulador -= PASSO;
    }
    return this.acumulador / PASSO;
  }
}
