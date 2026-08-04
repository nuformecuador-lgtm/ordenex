import { describe, it, expect } from "vitest";
import type { IAnaliticaRollupService, ResumenCorrida } from "@/lib/interfaces/services/IAnaliticaRollupService";
import type {
  EnqueueOpts,
  IJobRepository,
  JobDTO,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";
import { ejecutarBackfillCli, type EntornoCli } from "@/scripts/backfill-analitica";
import { DEDUPE_PREFIX_INVALIDACION } from "@/lib/services/jobs/analitica-invalidacion-encolado";

// Feature 128 / T6.4 — R12 y R13. EL BACKFILL COMO INVALIDADOR.
//
// La doctrina que lo obliga (heredada de la 124, no inventada aqui): la cache de un dia pasado
// es valida porque NADIE recomputa, no porque el dato sea reproducible. `zona_id`, `tienda_id`
// y `mensajero_id` se leen de la orden EN EL CORTE y cambian despues, y por D7 una orden con
// `deleted_at` desaparece de un dia en que existio y conto. En cuanto ESTE script recomputa un
// rango, la cifra cacheada queda vieja y **nada falla**: el numero se queda quieto.
//
// Y no puede invalidar en linea: `revalidateTag` LANZA fuera de un request de Next
// (`revalidate.js:104-107`) y esto es un proceso `tsx`. Por eso ENCOLA.

const AHORA = new Date("2026-08-02T15:00:00.000Z");
const URL = "postgresql://u:p@db.ejemplo.interno:6543/ordenex_prod";

interface Encolado {
  tipo: JobTipo;
  payload: Record<string, unknown>;
  opts?: EnqueueOpts;
}

function jobsEspia(alEncolar?: () => void): { repo: IJobRepository; encolados: Encolado[] } {
  const encolados: Encolado[] = [];
  const repo = {
    async enqueue(
      tipo: JobTipo,
      payload: Record<string, unknown>,
      opts?: EnqueueOpts,
    ): Promise<JobDTO | null> {
      alEncolar?.();
      encolados.push({ tipo, payload, opts });
      return null;
    },
  } as unknown as IJobRepository;
  return { repo, encolados };
}

function entornoDe(opciones: {
  argv: string[];
  jobs?: IJobRepository;
  falla?: (fecha: string) => boolean;
  archivos?: Record<string, string>;
}): { entorno: EntornoCli; salida: string[]; errores: string[] } {
  const salida: string[] = [];
  const errores: string[] = [];
  const rollup: IAnaliticaRollupService = {
    async agregarFecha(fecha: string): Promise<ResumenCorrida> {
      if (opciones.falla?.(fecha)) throw new Error(`fecha ${fecha} rota`);
      return { fecha, filasEscritas: 4, filasRetiradas: 0, ms: 12 };
    },
  };
  return {
    salida,
    errores,
    entorno: {
      argv: opciones.argv,
      env: { DATABASE_URL: URL },
      ahora: () => AHORA,
      salida: (l) => salida.push(l),
      errores: (l) => errores.push(l),
      leerArchivo: (ruta) => {
        const contenido = opciones.archivos?.[ruta];
        if (contenido === undefined) throw new Error(`no existe ${ruta}`);
        return contenido;
      },
      escribirArchivo: () => {},
      crearRollup: () => rollup,
      dormir: async () => {},
      ...(opciones.jobs ? { crearJobs: () => opciones.jobs! } : {}),
    },
  };
}

const RANGO = ["--desde", "2026-07-20", "--hasta", "2026-07-22"];
const CONFIRMA = ["--confirmar", "2026-07-20..2026-07-22"];

describe("R12 · una corrida con escritura encola exactamente un job de invalidacion", () => {
  it("un solo `enqueue`, del tipo `analitica_invalidacion_cache`", async () => {
    const { repo, encolados } = jobsEspia();
    const { entorno } = entornoDe({ argv: [...RANGO, ...CONFIRMA], jobs: repo });

    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).toBe(0);
    expect(encolados).toHaveLength(1);
    expect(encolados[0].tipo).toBe("analitica_invalidacion_cache");
    // El payload es solo para el diagnostico: la invalidacion es POR DOMINIO (D3).
    expect(encolados[0].payload).toEqual({ desde: "2026-07-20", hasta: "2026-07-22" });
    expect(encolados[0].opts?.dedupeKey).toMatch(
      new RegExp(`^${DEDUPE_PREFIX_INVALIDACION}:2026-07-20\\.\\.2026-07-22:\\d+$`),
    );
  });

  it("una corrida con fechas fallidas y alguna procesada tambien lo encola", async () => {
    // Las procesadas YA reescribieron el rollup: sus cifras cacheadas ya estan viejas. No
    // encolar «porque hubo fallos» dejaria el tablero sirviendo lo anterior sin senal.
    const { repo, encolados } = jobsEspia();
    const { entorno } = entornoDe({
      argv: [...RANGO, ...CONFIRMA],
      jobs: repo,
      falla: (fecha) => fecha === "2026-07-22",
    });

    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).not.toBe(0);
    expect(encolados).toHaveLength(1);
  });

  it("`--verificar` tambien escribe, asi que tambien encola", async () => {
    // El eco de la 125 lo dice con todas las letras (R26): `--verificar` recomputa cada fecha
    // con el agregador de la 124. El criterio no es el modo, es que se haya escrito.
    const { repo, encolados } = jobsEspia();
    const reporte = JSON.stringify({
      rango: { desde: "2026-07-20", hasta: "2026-07-22" },
      modo: "escritura",
      instante: AHORA.toISOString(),
      entradas: ["2026-07-20", "2026-07-21", "2026-07-22"].map((fecha) => ({
        fecha,
        filasEscritas: 4,
        filasRetiradas: 0,
        ms: 12,
        clasificacion: "procesada",
      })),
    });
    const { entorno } = entornoDe({
      argv: [...RANGO, ...CONFIRMA, "--verificar", "--contra", "reporte.json"],
      jobs: repo,
      archivos: { "reporte.json": reporte },
    });

    await ejecutarBackfillCli(entorno);

    expect(encolados).toHaveLength(1);
    expect(encolados[0].tipo).toBe("analitica_invalidacion_cache");
  });
});

describe("R13 · el plan sin --confirmar no encola nada", () => {
  it("cero llamadas a `enqueue`", async () => {
    const { repo, encolados } = jobsEspia();
    const { entorno, salida } = entornoDe({ argv: RANGO, jobs: repo });

    const codigo = await ejecutarBackfillCli(entorno);

    expect(codigo).toBe(0);
    expect(salida.some((l) => l.startsWith("PLAN:"))).toBe(true);
    expect(
      encolados,
      "el ensayo sin `--confirmar` NO invoca al agregador, asi que no hay nada que invalidar: " +
        "encolar aqui vaciaria la cache operativa por una corrida que no escribio.",
    ).toEqual([]);
  });

  it("una confirmacion que no coincide tampoco encola", async () => {
    const { repo, encolados } = jobsEspia();
    const { entorno } = entornoDe({
      argv: [...RANGO, "--confirmar", "2026-07-20..2026-07-21"],
      jobs: repo,
    });

    expect(await ejecutarBackfillCli(entorno)).toBe(1);
    expect(encolados).toEqual([]);
  });

  it("una corrida en la que TODAS las fechas fallan no encola: no se escribio nada", async () => {
    const { repo, encolados } = jobsEspia();
    const { entorno } = entornoDe({
      argv: [...RANGO, ...CONFIRMA],
      jobs: repo,
      falla: () => true,
    });

    await ejecutarBackfillCli(entorno);
    expect(encolados).toEqual([]);
  });
});

describe("el encolado no puede fallar en SILENCIO", () => {
  it("sin cola configurada, una corrida con escritura AVISA por la salida de error", async () => {
    const { entorno, errores } = entornoDe({ argv: [...RANGO, ...CONFIRMA] });

    expect(await ejecutarBackfillCli(entorno)).toBe(0);
    expect(errores.join("\n")).toMatch(/NO se ha encolado la invalidacion/);
  });

  it("si `enqueue` lanza, el backfill NO se cae pero lo dice", async () => {
    const repo = {
      async enqueue(): Promise<JobDTO | null> {
        throw new Error("la cola esta caida");
      },
    } as unknown as IJobRepository;
    const { entorno, errores } = entornoDe({ argv: [...RANGO, ...CONFIRMA], jobs: repo });

    // El recomputo YA se escribio: el codigo de salida tiene que seguir hablando del backfill.
    expect(await ejecutarBackfillCli(entorno)).toBe(0);
    expect(errores.join("\n")).toMatch(/no se pudo encolar la invalidacion/i);
  });
});
