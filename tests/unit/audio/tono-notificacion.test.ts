// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  prepararAudio,
  reiniciarAudioParaTests,
  reproducirTono,
} from "@/lib/audio/tono-notificacion";

// Feature 161 — R1-R9. jsdom NO implementa la Web Audio API: el contexto se stubbea y se
// registran las notas programadas, que es lo unico observable del tono.

interface NotaProgramada {
  frecuencia: number;
  tipo: string;
  inicio: number;
  fin: number;
  rampas: number;
}

let notas: NotaProgramada[] = [];
let contextosCreados = 0;
let resumeMock: Mock<() => Promise<void>>;
let estadoInicial: AudioContextState;

/** Contexto de audio falso: registra cada nota programada y las llamadas a `resume`. */
function instalarAudioContextFalso() {
  contextosCreados = 0;
  resumeMock = vi.fn<() => Promise<void>>(() => Promise.resolve());

  class GainFalso {
    rampas = 0;
    gain = {
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {
        this.rampas += 1;
      },
    };
    connect = () => {};
  }

  class OsciladorFalso {
    type = "";
    frequency = { value: 0 };
    private inicio = 0;
    private ganancia: GainFalso | null = null;

    connect = (destino: unknown) => {
      if (destino instanceof GainFalso) this.ganancia = destino;
    };
    start = (t: number) => {
      this.inicio = t;
    };
    stop = (t: number) => {
      notas.push({
        frecuencia: this.frequency.value,
        tipo: this.type,
        inicio: this.inicio,
        fin: t,
        rampas: this.ganancia?.rampas ?? 0,
      });
    };
  }

  class AudioContextFalso {
    state: AudioContextState = estadoInicial;
    currentTime = 10;
    destination = {};
    resume = () => {
      this.state = "running";
      return resumeMock();
    };
    createOscillator = () => new OsciladorFalso();
    createGain = () => new GainFalso();

    constructor() {
      contextosCreados += 1;
    }
  }

  vi.stubGlobal("AudioContext", AudioContextFalso);
}

beforeEach(() => {
  notas = [];
  estadoInicial = "running";
  reiniciarAudioParaTests();
  instalarAudioContextFalso();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reiniciarAudioParaTests();
});

describe("reproducirTono", () => {
  it("R2: emite dos notas, la segunda mas aguda, y no pasa de 300 ms en total", () => {
    reproducirTono();

    expect(notas).toHaveLength(2);
    expect(notas[1].frecuencia).toBeGreaterThan(notas[0].frecuencia);
    expect(notas.every((n) => n.tipo === "sine")).toBe(true);

    const duracionTotal = Math.max(...notas.map((n) => n.fin)) - Math.min(...notas.map((n) => n.inicio));
    expect(duracionTotal).toBeLessThanOrEqual(0.3);
  });

  it("R2: la segunda nota arranca cuando termina la primera, no encima", () => {
    reproducirTono();

    const [primera, segunda] = notas;
    expect(segunda.inicio).toBeCloseTo(primera.fin, 5);
  });

  it("R3: cada nota programa una rampa de atenuacion hasta el silencio", () => {
    reproducirTono();

    expect(notas.every((n) => n.rampas === 1)).toBe(true);
  });

  it("R4: sin Web Audio API no emite y no lanza", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    reiniciarAudioParaTests();

    expect(() => reproducirTono()).not.toThrow();
    expect(notas).toHaveLength(0);
  });

  it("R4: si el navegador rechaza crear el contexto, no lanza", () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("no se puede crear otro contexto");
        }
      },
    );
    reiniciarAudioParaTests();

    expect(() => reproducirTono()).not.toThrow();
    expect(notas).toHaveLength(0);
  });

  it("R5: dos reproducciones reutilizan el mismo contexto", () => {
    reproducirTono();
    reproducirTono();

    expect(contextosCreados).toBe(1);
    expect(notas).toHaveLength(4);
  });

  it("R6: con el contexto suspendido lo reanuda y emite despues", async () => {
    estadoInicial = "suspended";
    reiniciarAudioParaTests();

    reproducirTono();

    expect(resumeMock).toHaveBeenCalledTimes(1);
    // Las notas se programan en el `then` del reanudado, no de forma sincrona.
    expect(notas).toHaveLength(0);
    await vi.waitFor(() => expect(notas).toHaveLength(2));
  });

  it("R6: si el reanudado falla, no emite y no propaga el rechazo", async () => {
    estadoInicial = "suspended";
    reiniciarAudioParaTests();
    resumeMock.mockImplementation(() => Promise.reject(new Error("bloqueado")));

    expect(() => reproducirTono()).not.toThrow();
    await Promise.resolve();
    expect(notas).toHaveLength(0);
  });

  it("R9: sin ventana de navegador no crea contexto ni lanza", () => {
    vi.stubGlobal("window", undefined);
    reiniciarAudioParaTests();

    expect(() => reproducirTono()).not.toThrow();
    expect(contextosCreados).toBe(0);
  });
});

describe("prepararAudio", () => {
  it("R7: registra el desbloqueo una sola vez aunque se llame varias veces", () => {
    const espia = vi.spyOn(window, "addEventListener");

    prepararAudio();
    prepararAudio();
    prepararAudio();

    const eventos = espia.mock.calls.map((c) => c[0]);
    expect(eventos.filter((e) => e === "pointerdown")).toHaveLength(1);
    expect(eventos.filter((e) => e === "keydown")).toHaveLength(1);
  });

  it("R7: el primer gesto del usuario reanuda un contexto suspendido", async () => {
    estadoInicial = "suspended";
    reiniciarAudioParaTests();

    prepararAudio();
    expect(contextosCreados).toBe(0); // nada de audio antes del gesto

    window.dispatchEvent(new Event("pointerdown"));

    expect(contextosCreados).toBe(1);
    await vi.waitFor(() => expect(resumeMock).toHaveBeenCalled());
  });
});

describe("contrato del modulo", () => {
  const FUENTE = readFileSync(
    path.join(process.cwd(), "lib/audio/tono-notificacion.ts"),
    "utf8",
  );

  it("R1: no usa ningun archivo de audio ni `new Audio`", () => {
    expect(FUENTE).not.toMatch(/new\s+Audio\b/);
    expect(FUENTE).not.toMatch(/\.(mp3|ogg|wav|m4a)\b/);
    expect(FUENTE).not.toMatch(/\bfetch\(/);
  });

  it("R8: no depende de React ni del ciclo de render", () => {
    expect(FUENTE).not.toMatch(/from\s+"react"/);
    expect(FUENTE).not.toMatch(/\buse[A-Z]/);
  });
});
