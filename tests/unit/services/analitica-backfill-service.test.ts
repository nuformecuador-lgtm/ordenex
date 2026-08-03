import { describe, it, expect } from "vitest";
import { planificarBackfill } from "@/lib/analytics/backfill-rango";
import { FALLOS_CONSECUTIVOS_QUE_ABORTAN } from "@/lib/config/analitica-rollup";
import {
  AnaliticaRollupError,
  PrimerIntentoIncoherenteError,
  type IAnaliticaRollupService,
  type ResumenCorrida,
} from "@/lib/interfaces/services/IAnaliticaRollupService";
import type {
  EntradaPrevia,
  FallaFecha,
  LineaFecha,
  OpcionesBackfill,
} from "@/lib/interfaces/services/IAnaliticaBackfillService";
import { AnaliticaBackfillService } from "@/lib/services/AnaliticaBackfillService";

/**
 * Feature 125 / T2.4 — el ITERADOR de fechas, ejercido ENTERO sin base de datos, sin proceso
 * hijo y sin red. Cubre R3, R11, R13-R18, R21-R23, R25 y R31.
 *
 * El agregador es falso a proposito, y eso no debilita nada: lo que hay que medir aqui es el
 * RECORRIDO (una llamada por fecha, en orden, sin solaparse, con su clasificacion y su corte por
 * fallos). Que la agregacion sea correcta es de la 124 y lo miden sus tests contra Postgres; que
 * el backfill llame de verdad al agregador real lo mide
 * `tests/integration/db/analytics-daily-backfill.test.ts`.
 */

/** Reloj falso que avanza un milisegundo por consulta: la duracion es medible y determinista. */
function relojFalso(inicio = 1_000): { now: () => Date; instante: () => number } {
  let t = inicio;
  return { now: () => new Date((t += 1)), instante: () => t };
}

interface AgregadorFalso extends IAnaliticaRollupService {
  readonly llamadas: string[];
  readonly maxSimultaneas: number;
}

/**
 * Agregador falso instrumentado. `maxSimultaneas` es lo que hace falsable R15: si el servicio
 * lanzara las fechas en paralelo, dos llamadas se solaparian y el contador subiria a 2.
 */
function agregadorFalso(
  respuesta: (fecha: string, n: number) => Partial<ResumenCorrida> | Error,
): AgregadorFalso {
  const llamadas: string[] = [];
  let enVuelo = 0;
  let maxSimultaneas = 0;
  const doble = {
    llamadas,
    get maxSimultaneas() {
      return maxSimultaneas;
    },
    async agregarFecha(fecha: string): Promise<ResumenCorrida> {
      enVuelo++;
      maxSimultaneas = Math.max(maxSimultaneas, enVuelo);
      // Dos turnos de microtareas: si hubiera concurrencia, aqui se solaparian.
      await Promise.resolve();
      await Promise.resolve();
      llamadas.push(fecha);
      const r = respuesta(fecha, llamadas.length);
      enVuelo--;
      if (r instanceof Error) throw r;
      return { fecha, filasEscritas: 0, filasRetiradas: 0, ms: 7, ...r };
    },
  };
  return doble as AgregadorFalso;
}

interface SalidaFalsa {
  readonly lineas: LineaFecha[];
  readonly fallas: FallaFecha[];
  readonly avisos: string[];
}

function salidaFalsa(): SalidaFalsa & { linea(l: LineaFecha): void; falla(f: FallaFecha): void; aviso(m: string): void } {
  const lineas: LineaFecha[] = [];
  const fallas: FallaFecha[] = [];
  const avisos: string[] = [];
  return {
    lineas,
    fallas,
    avisos,
    linea: (l) => void lineas.push(l),
    falla: (f) => void fallas.push(f),
    aviso: (m) => void avisos.push(m),
  };
}

const AHORA = new Date("2026-08-02T15:00:00.000Z");

function planDe(desde: string, hasta: string) {
  const r = planificarBackfill({ desde, hasta, ahora: AHORA });
  if (!r.ok) throw new Error(r.motivo);
  return r.plan;
}

/** Monta el servicio con dobles y lo ejecuta; devuelve todo lo observable de la corrida. */
async function correr(
  opciones: Omit<OpcionesBackfill, "plan"> & { plan: OpcionesBackfill["plan"] },
  agregador: AgregadorFalso,
  pausas: number[] = [],
) {
  const salida = salidaFalsa();
  const reloj = relojFalso();
  const servicio = new AnaliticaBackfillService(agregador, {
    now: reloj.now,
    dormir: async (ms) => void pausas.push(ms),
    progreso: salida,
  });
  const resumen = await servicio.ejecutar(opciones);
  return { resumen, salida, pausas, agregador };
}

const OK = () => ({ filasEscritas: 3, filasRetiradas: 0, ms: 11 });

describe("R3 · la corrida completa se ejecuta con agregador, reloj y salida falsos, sin Prisma", () => {
  it("recorre un rango de cinco fechas sin tocar base, red ni consola", async () => {
    const { resumen, salida } = await correr(
      { plan: planDe("2026-07-20", "2026-07-24"), modo: "escritura" },
      agregadorFalso(OK),
    );
    expect(resumen.fechasDelRango).toBe(5);
    expect(resumen.procesadas).toBe(5);
    expect(salida.lineas).toHaveLength(5);
    expect(resumen.ms).toBeGreaterThan(0);
  });

  it("el modulo del servicio no importa Prisma ni la capa de base de datos", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fuente = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "lib", "services", "AnaliticaBackfillService.ts"),
      "utf8",
    );
    expect(fuente).not.toMatch(/from\s+["']@\/lib\/db/);
    expect(fuente).not.toMatch(/from\s+["']@prisma\/client["']/);
  });
});

describe("R11 · una llamada por fecha, en orden ascendente, y ninguna fuera del rango", () => {
  it("llama exactamente una vez por fecha del plan y en orden", async () => {
    const plan = planDe("2026-07-28", "2026-08-01");
    const { agregador } = await correr({ plan, modo: "escritura" }, agregadorFalso(OK));
    expect(agregador.llamadas).toEqual([...plan.fechas]);
    expect(new Set(agregador.llamadas).size).toBe(agregador.llamadas.length);
  });

  it("no llama con ninguna fecha fuera del rango, ni la anterior ni la siguiente", async () => {
    const { agregador } = await correr(
      { plan: planDe("2026-07-20", "2026-07-22"), modo: "escritura" },
      agregadorFalso(OK),
    );
    expect(agregador.llamadas).not.toContain("2026-07-19");
    expect(agregador.llamadas).not.toContain("2026-07-23");
  });
});

describe("R15 · las llamadas al agregador no se solapan y el servicio no retiene mas de una fecha de detalle", () => {
  it("nunca hay dos llamadas al agregador en vuelo a la vez", async () => {
    const { agregador } = await correr(
      { plan: planDe("2026-07-01", "2026-07-31"), modo: "escritura" },
      agregadorFalso(OK),
    );
    expect(agregador.llamadas).toHaveLength(31);
    expect(agregador.maxSimultaneas, "el servicio lanzo fechas en paralelo").toBe(1);
  });

  it("el resumen de una corrida de 40 fechas no contiene el detalle de ninguna", async () => {
    // Si el servicio acumulara `LineaFecha[]`, aqui habria 40 objetos con filas y ms dentro.
    const { resumen } = await correr(
      { plan: planDe("2026-06-01", "2026-07-10"), modo: "escritura" },
      agregadorFalso(OK),
    );
    expect(resumen.fechasDelRango).toBe(40);
    for (const [clave, valor] of Object.entries(resumen)) {
      if (!Array.isArray(valor)) continue;
      expect(valor, `${clave} acumula detalle por fecha`).toEqual([]);
    }
  });
});

describe("R13 · una fecha que lanza no detiene el rango: se marca fallida, se sigue y el codigo final es distinto de 0", () => {
  it("sigue con las fechas siguientes y las procesa", async () => {
    const plan = planDe("2026-07-20", "2026-07-24");
    const agregador = agregadorFalso((fecha) =>
      fecha === "2026-07-21" ? new AnaliticaRollupError(fecha, "gestiones", new Error("db caida")) : OK(),
    );
    const { resumen, salida } = await correr({ plan, modo: "escritura" }, agregador);

    expect(agregador.llamadas).toEqual([...plan.fechas]);
    expect(resumen.fallidas).toBe(1);
    expect(resumen.procesadas).toBe(4);
    expect(resumen.fechasFallidas).toEqual(["2026-07-21"]);
    expect(resumen.codigoSalida).not.toBe(0);
    expect(salida.lineas.find((l) => l.fecha === "2026-07-21")?.clasificacion).toBe("fallida");
  });

  it("NO reintenta la fecha fallida dentro de la misma pasada", async () => {
    const plan = planDe("2026-07-20", "2026-07-22");
    const agregador = agregadorFalso((fecha) =>
      fecha === "2026-07-21" ? new Error("fallo") : OK(),
    );
    await correr({ plan, modo: "escritura" }, agregador);
    expect(agregador.llamadas.filter((f) => f === "2026-07-21")).toHaveLength(1);
  });
});

describe("R14 · N fallos consecutivos abortan la pasada y el resumen dice cuantas fechas quedaron sin procesar", () => {
  it("corta a los N fallos seguidos y no llama al agregador ni una vez mas", async () => {
    const plan = planDe("2026-07-01", "2026-07-20");
    const agregador = agregadorFalso(() => new Error("entorno roto"));
    const { resumen, salida } = await correr({ plan, modo: "escritura" }, agregador);

    expect(FALLOS_CONSECUTIVOS_QUE_ABORTAN).toBe(3);
    expect(agregador.llamadas).toHaveLength(FALLOS_CONSECUTIVOS_QUE_ABORTAN);
    expect(resumen.abortadaPorFallosConsecutivos).toBe(true);
    expect(resumen.sinProcesar).toBe(20 - FALLOS_CONSECUTIVOS_QUE_ABORTAN);
    expect(resumen.codigoSalida).not.toBe(0);
    expect(salida.avisos.join(" ")).toContain(String(20 - FALLOS_CONSECUTIVOS_QUE_ABORTAN));
    expect(salida.avisos.join(" ")).toMatch(/sin procesar/i);
  });

  it("los fallos NO consecutivos no cortan: una fecha buena reinicia la cuenta", async () => {
    const plan = planDe("2026-07-01", "2026-07-10");
    // Falla 1 y 2, acierta la 3, falla 4 y 5, acierta la 6... nunca hay tres seguidos.
    const agregador = agregadorFalso((_f, n) => (n % 3 === 0 ? OK() : new Error("intermitente")));
    const { resumen } = await correr({ plan, modo: "escritura" }, agregador);
    expect(resumen.abortadaPorFallosConsecutivos).toBe(false);
    expect(resumen.sinProcesar).toBe(0);
    expect(resumen.fallidas).toBeGreaterThan(FALLOS_CONSECUTIVOS_QUE_ABORTAN);
  });
});

describe("R16 · con pausa 50 ms espera entre fechas con el reloj falso; con el default no espera", () => {
  it("espera la pausa pedida ENTRE fechas consecutivas, no despues de la ultima", async () => {
    const pausas: number[] = [];
    await correr({ plan: planDe("2026-07-20", "2026-07-23"), modo: "escritura", pausaMs: 50 }, agregadorFalso(OK), pausas);
    expect(pausas).toEqual([50, 50, 50]); // 4 fechas => 3 esperas
  });

  it("con el valor por defecto no espera ni una vez", async () => {
    const pausas: number[] = [];
    await correr({ plan: planDe("2026-07-20", "2026-07-23"), modo: "escritura" }, agregadorFalso(OK), pausas);
    expect(pausas).toEqual([]);
  });
});

describe("R17 · cada fecha emite una linea con fecha, filasEscritas, filasRetiradas, ms y clasificacion", () => {
  it("la linea trae los cinco campos y los valores son los del ResumenCorrida de la 124", async () => {
    const { salida } = await correr(
      { plan: planDe("2026-07-20", "2026-07-20"), modo: "escritura" },
      agregadorFalso(() => ({ filasEscritas: 18, filasRetiradas: 2, ms: 940 })),
    );
    expect(salida.lineas).toEqual([
      {
        fecha: "2026-07-20",
        filasEscritas: 18,
        filasRetiradas: 2,
        ms: 940,
        clasificacion: "procesada",
      },
    ]);
  });
});

describe("R18 · el resumen trae los siete campos y una fecha fallida fuerza codigo distinto de 0", () => {
  it("los siete campos de R18 estan y cuadran entre si", async () => {
    const plan = planDe("2026-07-11", "2026-07-15"); // 2 bajo horizonte, 3 por encima
    const { resumen } = await correr(
      { plan, modo: "escritura" },
      agregadorFalso(() => ({ filasEscritas: 4, filasRetiradas: 1, ms: 10 })),
    );
    expect(resumen.fechasDelRango).toBe(5);
    expect(resumen.procesadas).toBe(5);
    expect(resumen.fallidas).toBe(0);
    expect(resumen.noComparables).toBe(2);
    expect(resumen.filasEscritas).toBe(20);
    expect(resumen.filasRetiradas).toBe(5);
    expect(resumen.ms).toBeGreaterThan(0);
    // Las cuentas cierran: procesadas + fallidas + sinProcesar == fechas del rango.
    expect(resumen.procesadas + resumen.fallidas + resumen.sinProcesar).toBe(resumen.fechasDelRango);
    expect(resumen.codigoSalida).toBe(0);
  });

  it("una sola fecha fallida entre cuatro buenas fuerza el codigo distinto de 0", async () => {
    const { resumen } = await correr(
      { plan: planDe("2026-07-20", "2026-07-24"), modo: "escritura" },
      agregadorFalso((f) => (f === "2026-07-24" ? new Error("x") : OK())),
    );
    expect(resumen.codigoSalida).not.toBe(0);
    expect(resumen.fechasFallidas).toEqual(["2026-07-24"]);
  });
});

describe("R21 · una fecha no comparable se pasa igual al agregador y su ResumenCorrida se reporta sin modificar", () => {
  it("la fecha bajo horizonte se invoca igual que las demas", async () => {
    const plan = planDe("2026-07-11", "2026-07-14");
    const { agregador } = await correr({ plan, modo: "escritura" }, agregadorFalso(OK));
    expect(agregador.llamadas).toEqual(["2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"]);
  });

  it("no altera, simula ni rellena ninguna medida: la unica diferencia es la etiqueta", async () => {
    const { salida } = await correr(
      { plan: planDe("2026-07-12", "2026-07-12"), modo: "escritura" },
      agregadorFalso(() => ({ filasEscritas: 5, filasRetiradas: 1, ms: 33 })),
    );
    expect(salida.lineas[0]).toEqual({
      fecha: "2026-07-12",
      filasEscritas: 5,
      filasRetiradas: 1,
      ms: 33,
      clasificacion: "no_comparable",
    });
  });
});

describe("R22 · una fecha bajo horizonte con cero filas y una fecha comparable con cero filas producen salidas distinguibles", () => {
  it("los dos ceros se distinguen por la clasificacion y por el conteo del resumen", async () => {
    const { salida, resumen } = await correr(
      { plan: planDe("2026-07-12", "2026-07-13"), modo: "escritura" },
      agregadorFalso(() => ({ filasEscritas: 0, filasRetiradas: 0, ms: 5 })),
    );
    const bajo = salida.lineas.find((l) => l.fecha === "2026-07-12");
    const sobre = salida.lineas.find((l) => l.fecha === "2026-07-13");

    expect(bajo?.filasEscritas).toBe(0);
    expect(sobre?.filasEscritas).toBe(0);
    // Mismo cero, distinto significado: uno es «no se puede saber», el otro «no hubo nada».
    expect(bajo?.clasificacion).toBe("no_comparable");
    expect(sobre?.clasificacion).toBe("procesada");
    expect(resumen.noComparables).toBe(1);
  });
});

describe("R23 · --verificar compara el resumen de la segunda pasada contra el reporte previo, fecha a fecha", () => {
  function previo(entradas: Record<string, number>): ReadonlyMap<string, EntradaPrevia> {
    return new Map(
      Object.entries(entradas).map(([fecha, filasEscritas]) => [fecha, { fecha, filasEscritas }]),
    );
  }

  it("compara cada fecha contra SU entrada del reporte, no contra un total", async () => {
    const plan = planDe("2026-07-20", "2026-07-22");
    const { salida, resumen } = await correr(
      {
        plan,
        modo: "verificacion",
        previo: previo({ "2026-07-20": 3, "2026-07-21": 9, "2026-07-22": 3 }),
      },
      // La suma coincide (3+3+3 == 9? no): lo que importa es que el 21 no coincide fecha a fecha.
      agregadorFalso(() => ({ filasEscritas: 3, filasRetiradas: 0, ms: 8 })),
    );
    expect(salida.lineas.map((l) => l.clasificacion)).toEqual(["estable", "cambiada", "estable"]);
    expect(resumen.estables).toBe(2);
    expect(resumen.cambiadas).toBe(1);
  });

  it("la verificacion vuelve a invocar el agregador: recomputa, y por eso ESCRIBE", async () => {
    const plan = planDe("2026-07-20", "2026-07-21");
    const { agregador } = await correr(
      { plan, modo: "verificacion", previo: previo({ "2026-07-20": 3, "2026-07-21": 3 }) },
      agregadorFalso(OK),
    );
    expect(agregador.llamadas).toEqual(["2026-07-20", "2026-07-21"]);
  });
});

describe("R25 · clasifica estable, cambiada, no_comparable y fallida, y sale distinto de 0 solo con cambiada o fallida", () => {
  const previo = new Map<string, EntradaPrevia>([
    ["2026-07-13", { fecha: "2026-07-13", filasEscritas: 3 }],
    ["2026-07-14", { fecha: "2026-07-14", filasEscritas: 3 }],
    ["2026-07-15", { fecha: "2026-07-15", filasEscritas: 3 }],
    ["2026-07-16", { fecha: "2026-07-16", filasEscritas: 3 }],
  ]);

  it("produce las CUATRO categorias en una sola pasada", async () => {
    const plan = planDe("2026-07-12", "2026-07-16"); // 12 y 13: 13 esta en el horizonte
    const agregador = agregadorFalso((fecha) => {
      if (fecha === "2026-07-15") return { filasEscritas: 99, filasRetiradas: 0, ms: 8 }; // cambiada
      if (fecha === "2026-07-16") return new Error("revento"); // fallida
      return { filasEscritas: 3, filasRetiradas: 0, ms: 8 };
    });
    const { salida, resumen } = await correr({ plan, modo: "verificacion", previo }, agregador);

    const porFecha = new Map(salida.lineas.map((l) => [l.fecha, l.clasificacion]));
    expect(porFecha.get("2026-07-12")).toBe("no_comparable");
    expect(porFecha.get("2026-07-14")).toBe("estable");
    expect(porFecha.get("2026-07-15")).toBe("cambiada");
    expect(porFecha.get("2026-07-16")).toBe("fallida");
    expect(resumen.codigoSalida).not.toBe(0);
  });

  it("estable exige las DOS condiciones: nada retirado Y el mismo numero de filas", async () => {
    // Mismas filas escritas que el reporte, pero un cubo desaparecio: eso es un cambio.
    const { salida } = await correr(
      { plan: planDe("2026-07-14", "2026-07-14"), modo: "verificacion", previo },
      agregadorFalso(() => ({ filasEscritas: 3, filasRetiradas: 1, ms: 8 })),
    );
    expect(salida.lineas[0].clasificacion).toBe("cambiada");
  });

  it("una pasada con TODO estable o no comparable sale con codigo 0", async () => {
    const { resumen } = await correr(
      { plan: planDe("2026-07-12", "2026-07-15"), modo: "verificacion", previo },
      agregadorFalso(() => ({ filasEscritas: 3, filasRetiradas: 0, ms: 8 })),
    );
    expect(resumen.cambiadas).toBe(0);
    expect(resumen.fallidas).toBe(0);
    expect(resumen.codigoSalida).toBe(0);
  });

  it("una fecha que el reporte previo no cubre NO se llama estable: seria un falso verde", async () => {
    const { salida } = await correr(
      { plan: planDe("2026-07-20", "2026-07-20"), modo: "verificacion", previo },
      agregadorFalso(() => ({ filasEscritas: 0, filasRetiradas: 0, ms: 8 })),
    );
    expect(salida.lineas[0].clasificacion).toBe("cambiada");
  });
});

describe("R31 · el error registrado nombra la fecha", () => {
  it("la falla lleva fecha, modo, nombre del error y etapa, y el error crudo aparte", async () => {
    const { salida } = await correr(
      { plan: planDe("2026-07-20", "2026-07-20"), modo: "escritura" },
      agregadorFalso((f) => new AnaliticaRollupError(f, "escritura", new Error("causa"))),
    );
    expect(salida.fallas).toHaveLength(1);
    expect(salida.fallas[0].fecha).toBe("2026-07-20");
    expect(salida.fallas[0].modo).toBe("escritura");
    expect(salida.fallas[0].nombreError).toBe("AnaliticaRollupError");
    expect(salida.fallas[0].etapa).toBe("escritura");
    expect(salida.fallas[0].error).toBeInstanceOf(AnaliticaRollupError);
  });

  it("un error sin etapa (el que trae la clave del cubo) tambien se registra con su fecha", async () => {
    const { salida, resumen } = await correr(
      { plan: planDe("2026-07-20", "2026-07-20"), modo: "escritura" },
      agregadorFalso((f) => new PrimerIntentoIncoherenteError(f, "zona-1|tienda-2", 3, 1)),
    );
    expect(salida.fallas[0].fecha).toBe("2026-07-20");
    expect(salida.fallas[0].nombreError).toBe("PrimerIntentoIncoherenteError");
    expect(salida.fallas[0].etapa).toBeUndefined();
    expect(resumen.fechasFallidas).toEqual(["2026-07-20"]);
  });

  it("no continua en silencio: la fecha fallida esta en el resumen y en el codigo de salida", async () => {
    const { resumen } = await correr(
      { plan: planDe("2026-07-20", "2026-07-22"), modo: "escritura" },
      agregadorFalso((f) => (f === "2026-07-21" ? new Error("silencio no") : OK())),
    );
    expect(resumen.fechasFallidas).toContain("2026-07-21");
    expect(resumen.codigoSalida).toBe(2);
  });
});
