import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { crearAnaliticaRollupDiarioHandler } from "@/lib/services/jobs/analitica-rollup-diario-handler";
import { CachedAnaliticaOperativaRollupRepository } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import type { IAnaliticaRollupService } from "@/lib/interfaces/services/IAnaliticaRollupService";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  CuboRollup,
  IAnaliticaOperativaRollupRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import { cacheFalsa, cacheQueFallaAlInvalidar } from "./_cache-falsa";
import { consultaDe, cubo, MAESTRO } from "./_fake-operativa";

// Feature 128 / T5.2 — R10, R11 y el enganche real del job diario.
//
// ⚠ LA FORMA DE ESTE TEST ES EL REQUISITO. Un test que espia `revalidateTag` solo prueba que
// alguien escribio la llamada. Aqui la asercion es sobre el DATO SERVIDO, en cinco pasos
// (`design.md §11`):
//
//   1. consultar            -> V1
//   2. cambiar el origen    -> el repositorio interno pasa a devolver V2
//   3. consultar            -> V1     ← si esto falla, la cache no cachea y el resto es vacuo
//   4. correr el HANDLER DE PRODUCCION REAL, con el mismo puerto de cache inyectado
//   5. consultar            -> V2     ← si esto devuelve V1, la invalidacion NO llego
//
// El paso 3 no es relleno: es la unica forma de saber que el paso 5 esta midiendo algo.

const SIN_GRANO: readonly DimensionAnalitica[] = [];
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const JOB = { id: "job-1", tipo: "analitica_rollup_diario" } as unknown as JobDTO;

/** Repositorio interno cuyas filas se pueden cambiar en mitad del test (el «origen»). */
function rollupMutable(inicial: number) {
  let entregas = inicial;
  let llamadas = 0;
  const repo: IAnaliticaOperativaRollupRepository = {
    async agregarCubos(): Promise<readonly CuboRollup[]> {
      llamadas += 1;
      return [cubo({ fecha: "2026-08-01", entregas })];
    },
    async etiquetasDeEstatus() {
      return new Map();
    },
  };
  return { repo, fijar: (n: number) => (entregas = n), llamadas: () => llamadas };
}

/** Servicio de rollup falso: el handler solo necesita que `agregarFecha` resuelva. */
function servicioRollup(alAgregar?: () => void): IAnaliticaRollupService {
  return {
    async agregarFecha(fecha: string) {
      alAgregar?.();
      return { fecha, filasEscritas: 12, filasRetiradas: 3, ms: 42 };
    },
  };
}

const LOGGER_MUDO = { info: () => {} };

describe("R10 · tras la corrida del job diario, la consulta cacheada devuelve las filas nuevas", () => {
  it("los cinco pasos, con el handler de produccion en el paso 4", async () => {
    const cache = cacheFalsa();
    const origen = rollupMutable(10);
    const repo = new CachedAnaliticaOperativaRollupRepository(origen.repo, cache);
    const consulta = consultaDe("entregas", MAESTRO, {
      rango: "personalizado",
      desde: "2026-08-01",
      hasta: "2026-08-01",
    });

    // (1)
    expect((await repo.agregarCubos(consulta, SIN_GRANO))[0].entregas).toBe(10);
    // (2) el job reescribe el rollup: las filas de la base pasan a valer otra cosa
    origen.fijar(99);
    // (3) sin invalidar, se sigue sirviendo lo viejo. ESTO prueba que la cache cachea.
    expect((await repo.agregarCubos(consulta, SIN_GRANO))[0].entregas).toBe(10);
    expect(origen.llamadas()).toBe(1);

    // (4) el handler REAL, con el mismo puerto de cache inyectado
    const handler = crearAnaliticaRollupDiarioHandler(
      servicioRollup(),
      () => new Date("2026-08-02T06:30:00.000Z"),
      LOGGER_MUDO,
      cache,
    );
    await handler(JOB);

    // (5)
    expect(
      (await repo.agregarCubos(consulta, SIN_GRANO))[0].entregas,
      "la invalidacion NO llego: el job diario reescribio el rollup y la consulta sigue " +
        "sirviendo la cifra anterior. Nada falla y el numero se queda quieto: es el modo de " +
        "fallo mas caro de esta feature.",
    ).toBe(99);
    expect(origen.llamadas()).toBe(2);
  });

  it("la invalidacion va DESPUES de agregar: si el agregado falla, no se invalida nada", async () => {
    const cache = cacheFalsa();
    const servicio: IAnaliticaRollupService = {
      async agregarFecha(): Promise<never> {
        throw new Error("el agregado exploto");
      },
    };
    const handler = crearAnaliticaRollupDiarioHandler(
      servicio,
      () => new Date("2026-08-02T06:30:00.000Z"),
      LOGGER_MUDO,
      cache,
    );

    await expect(handler(JOB)).rejects.toThrow("el agregado exploto");
    // Invalidar tras un agregado fallido tiraria una cache que seguia siendo correcta.
    expect(cache.invalidaciones).toHaveLength(0);
  });

  it("y el origen registrado es el del job diario (R23)", async () => {
    const cache = cacheFalsa();
    const handler = crearAnaliticaRollupDiarioHandler(
      servicioRollup(),
      () => new Date("2026-08-02T06:30:00.000Z"),
      LOGGER_MUDO,
      cache,
    );
    await handler(JOB);
    expect(cache.invalidaciones).toHaveLength(1);
    expect(cache.invalidaciones[0].origen).toBe("job_rollup_diario");
  });
});

describe("R11 · un invalidador que lanza hace fallar la corrida del job", () => {
  it("el error se propaga para que `JobQueueService` lo cuente como fallo y aplique backoff", async () => {
    let agregados = 0;
    const handler = crearAnaliticaRollupDiarioHandler(
      servicioRollup(() => {
        agregados += 1;
      }),
      () => new Date("2026-08-02T06:30:00.000Z"),
      LOGGER_MUDO,
      cacheQueFallaAlInvalidar("revalidateTag exploto"),
    );

    // Si alguien envolviera la invalidacion en un `try/catch` que la ignorase, el handler
    // resolveria y este test se pondria rojo. Esa es exactamente la mutacion que caza: una
    // invalidacion que falla en silencio congela la cifra para siempre y SIN SENAL.
    await expect(handler(JOB)).rejects.toThrow("revalidateTag exploto");
    expect(agregados).toBe(1);
  });
});

describe("R10 · el composition root de produccion pasa el invalidador de verdad", () => {
  // El default del parametro es `cacheNula()` —un no-op— para que los tests de la 124 sigan
  // corriendo sin runtime de Next. Ese default no lo cubre el tipo: si el cron se olvidara de
  // pasar el puerto real, la invalidacion no ocurriria y NADA fallaria. Lo cubre esto.
  const fuente = fs.readFileSync(
    path.join(REPO_ROOT, "app", "api", "cron", "procesar-jobs", "route.ts"),
    "utf8",
  );

  it("`buildHandlers` construye el handler del rollup con `crearAnaliticaCacheDeNext()`", () => {
    expect(fuente).toMatch(
      /crearAnaliticaRollupDiarioHandler\([\s\S]*?crearAnaliticaCacheDeNext\(\)[\s\S]*?\)/,
    );
  });
});
