import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient, type JobTipo } from "@prisma/client";

import { JobRepository } from "@/lib/repositories/JobRepository";
import type { ClaimOpts, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  crearPrismaDeTestConEspia,
  enTransaccionRevertida,
  type TxDeTest,
} from "./_postgres-real";

/**
 * ⭑⭑ FEATURE 402 (R1/R2/R3/R4/R6/R7/R9) — EL REPARTO POR TURNOS DE `claimBatch`, EJECUTADO
 * CONTRA POSTGRES DE VERDAD.
 *
 * POR QUE ESTE ARCHIVO EXISTE Y NO BASTAN LOS DOBLES. TODA la logica del reparto vive DENTRO
 * de UNA sentencia SQL: el `ROW_NUMBER() OVER (PARTITION BY tipo ORDER BY run_after)` y el
 * `ORDER BY turno, run_after LIMIT $limit`. Un test de servicio con dobles NO VE LA CONSULTA:
 * el doble de `claimBatch` devuelve lo que le digan, asi que pasaria en verde con el `ORDER BY`
 * roto. Medido cuatro veces en este repo con el `WHERE` de otras fichas. La regla se prueba
 * DONDE VIVE.
 *
 * EL INCIDENTE QUE ORIGINA LA FICHA (2026-09-09): 82 `webhook_estado` vencidos delante de 14
 * `whatsapp_bienvenida`, 6 `geocodificacion` y 2 `optimizacion_ruta`, con `limit = 10` y un
 * `ORDER BY run_after ASC` global: los tres tipos minoritarios NO se reclamaron nunca. El
 * primer caso de este archivo es esa misma foto, reducida y con `run_after` controlados.
 *
 * COMO SE AISLA DE LA BASE REAL, y por que se puede confiar en el resultado. Todo corre dentro
 * de una transaccion que SIEMPRE se revierte (ni una fila queda), y ademas el reloj del claim
 * se inyecta EN EL AÑO 2000: los jobs reales de la base de desarrollo tienen `run_after` de
 * 2026, o sea `run_after <= now` es FALSO para todos ellos y ninguno entra en el conjunto
 * candidato. El primer caso lo COMPRUEBA (no lo supone) listando los candidatos de la ventana
 * antes de reclamar.
 *
 * SIN BASE ALCANZABLE se SALTA ENTERO y con su nombre en el reporte (`describe.skip`); un gate
 * que no imprima estos casos como ejecutados NO ha medido esta ficha.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Reloj INYECTADO (feature 90: nunca `NOW()` de Postgres). Ver cabecera: aisla la ventana. */
const NOW = new Date("2000-01-01T00:00:00.000Z");
/** `now - 60 s`, el visibility timeout del claim. */
const CUTOFF = new Date("1999-12-31T23:59:00.000Z");
const OPTS: ClaimOpts = { now: NOW, visibilityCutoff: CUTOFF };

/** `locked_at` de un `processing` COLGADO: anterior al cutoff, luego rescatable (R13 de la 90). */
const COLGADO_DESDE = new Date("1999-12-30T00:00:00.000Z");

/** Base de los `run_after` sembrados; el offset en minutos define la antiguedad relativa. */
const BASE_RUN_AFTER = Date.parse("1999-06-01T00:00:00.000Z");
function momento(offsetMin: number): Date {
  return new Date(BASE_RUN_AFTER + offsetMin * 60_000);
}

/** Orden NATURAL: `solo-2` antes que `solo-10` (con `.sort()` pelado seria al reves). */
function ordenadas(claves: string[]): string[] {
  return [...claves].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

interface Semilla {
  /** Nombre legible del testigo; las aserciones hablan en claves, no en uuids. */
  clave: string;
  tipo: JobTipo;
  /** Minutos desde `BASE_RUN_AFTER`: menor = mas antiguo = turno mas bajo dentro de su tipo. */
  offsetMin: number;
  estado?: "pending" | "processing";
  /** Solo para `processing`: si es anterior a `CUTOFF`, la fila esta colgada y se rescata. */
  lockedAt?: Date;
  intentos?: number;
}

/** Inserta el corpus dentro de la tx del test. Devuelve `clave -> id` y su inverso. */
async function sembrar(tx: TxDeTest, semillas: Semilla[]) {
  const idPorClave = new Map<string, string>();
  const clavePorId = new Map<string, string>();
  for (const s of semillas) {
    const estado = s.estado ?? "pending";
    const lockedAt = s.lockedAt ?? null;
    const filas = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "jobs" (
        "id", "tipo", "payload", "estado", "intentos", "max_intentos",
        "run_after", "locked_at", "created_at", "updated_at"
      )
      VALUES (
        gen_random_uuid(), ${s.tipo}::"job_tipo", '{}'::jsonb, ${estado}::"job_estado",
        ${s.intentos ?? 0}, 8, ${momento(s.offsetMin)}, ${lockedAt}, ${NOW}, ${NOW}
      )
      RETURNING "id"`;
    idPorClave.set(s.clave, filas[0].id);
    clavePorId.set(filas[0].id, s.clave);
  }
  return { idPorClave, clavePorId };
}

/** Las claves de los jobs reclamados. `AJENO:` delataria una fila que no sembro el test. */
function claves(jobs: JobDTO[], clavePorId: Map<string, string>): string[] {
  return jobs.map((j) => clavePorId.get(j.id) ?? `AJENO:${j.id}`);
}

/** Conteo por tipo del lote reclamado: la composicion que R1/R3 predicen. */
function porTipo(jobs: JobDTO[]): Record<string, number> {
  return jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.tipo] = (acc[j.tipo] ?? 0) + 1;
    return acc;
  }, {});
}

/** N semillas del mismo tipo, con offsets consecutivos desde `desde`. */
function serie(prefijo: string, tipo: JobTipo, desde: number, n: number): Semilla[] {
  return Array.from({ length: n }, (_, i) => ({
    clave: `${prefijo}-${i + 1}`,
    tipo,
    offsetMin: desde + i,
  }));
}

describeSiHayBase("402 — `claimBatch` reparte el lote entre tipos (Postgres real)", () => {
  let prisma: PrismaClient;

  /** Siembra el corpus, ejecuta `fn` con el repositorio REAL sobre la tx, y revierte todo. */
  async function conCorpus<T>(
    semillas: Semilla[],
    fn: (ctx: {
      repo: JobRepository;
      tx: TxDeTest;
      idPorClave: Map<string, string>;
      clavePorId: Map<string, string>;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      const { idPorClave, clavePorId } = await sembrar(tx, semillas);
      const repo = new JobRepository(tx as unknown as PrismaClient);
      return fn({ repo, tx, idPorClave, clavePorId });
    });
  }

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("R1/R3 — el incidente del 2026-09-09, reducido y con `run_after` controlados", () => {
    // Un tipo saturado (8) por delante EN ANTIGUEDAD de los otros tres (3, 2 y 1). Con el
    // `ORDER BY run_after ASC` global de antes, el lote de 10 era 8 webhooks + 2 whatsapp y
    // los otros dos tipos no aparecian: eso es EXACTAMENTE lo que este caso deja rojo.
    const SEMILLAS: Semilla[] = [
      ...serie("webhook", "webhook_estado", 0, 8),
      ...serie("whatsapp", "whatsapp_bienvenida", 60, 3),
      ...serie("geo", "geocodificacion", 120, 2),
      ...serie("ruta", "optimizacion_ruta", 180, 1),
    ];

    it("la ventana del test contiene EXACTAMENTE el corpus sembrado (aislamiento medido)", async () => {
      const { candidatos, sembrados } = await conCorpus(SEMILLAS, async (ctx) => {
        const filas = await ctx.tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "jobs"
          WHERE (
            ("estado" = 'pending'    AND "run_after" <= ${NOW})
            OR
            ("estado" = 'processing' AND "locked_at" < ${CUTOFF})
          )`;
        return {
          candidatos: filas.map((f) => f.id).sort(),
          sembrados: [...ctx.idPorClave.values()].sort(),
        };
      });
      // Si esto falla, ningun otro caso de este archivo significa nada: estaria midiendo
      // tambien los jobs reales de la base de desarrollo.
      expect(candidatos).toEqual(sembrados);
      expect(sembrados).toHaveLength(14);
    });

    it("⭑ R1/R3: los CUATRO tipos entran en la PRIMERA corrida — 4/3/2/1, no 8+2+0+0", async () => {
      const { composicion, reclamadas, total } = await conCorpus(SEMILLAS, async (ctx) => {
        const jobs = await ctx.repo.claimBatch(10, OPTS);
        return {
          composicion: porTipo(jobs),
          reclamadas: ordenadas(claves(jobs, ctx.clavePorId)),
          total: jobs.length,
        };
      });

      // R1: turno 1 de los cuatro tipos (4 filas), turno 2 de los cuatro (8), turno 3 solo lo
      // alcanzan webhook y whatsapp (10). R3: el cupo que geo y ruta no pueden llenar lo ocupa
      // el tipo mayoritario (webhook llega al turno 4), sin dejar cupo sin usar.
      expect(composicion).toEqual({
        webhook_estado: 4,
        whatsapp_bienvenida: 3,
        geocodificacion: 2,
        optimizacion_ruta: 1,
      });
      // Igualdad EXACTA de testigos: lo que sobra importa tanto como lo que falta. Y dentro de
      // cada tipo son los mas antiguos (R4): webhook-1..4, no webhook-5..8.
      expect(reclamadas).toEqual([
        "geo-1",
        "geo-2",
        "ruta-1",
        "webhook-1",
        "webhook-2",
        "webhook-3",
        "webhook-4",
        "whatsapp-1",
        "whatsapp-2",
        "whatsapp-3",
      ]);
      expect(total).toBe(10); // R1: NUNCA mas de `limit`
    });

    it("R1: el claim CONSERVA sus efectos — processing, `locked_at = now` e `intentos + 1`", async () => {
      const filas = await conCorpus(SEMILLAS, async (ctx) => {
        const jobs = await ctx.repo.claimBatch(10, OPTS);
        const ids = jobs.map((j) => j.id);
        return ctx.tx.$queryRaw<{ estado: string; locked_at: Date; intentos: number }[]>`
          SELECT "estado", "locked_at", "intentos" FROM "jobs"
          WHERE "id" IN (${Prisma.join(ids)})`;
      });
      expect(filas).toHaveLength(10);
      for (const f of filas) {
        expect(f.estado).toBe("processing");
        expect(new Date(f.locked_at).toISOString()).toBe(NOW.toISOString());
        expect(Number(f.intentos)).toBe(1); // sembrados con 0
      }
    });
  });

  describe("R2 — un solo tipo activo se queda el lote ENTERO (no hay hambre inversa)", () => {
    it("14 candidatos de un unico tipo y `limit = 10` -> 10 filas, todas de ese tipo", async () => {
      const { composicion, reclamadas } = await conCorpus(
        serie("solo", "webhook_estado", 0, 14),
        async (ctx) => {
          const jobs = await ctx.repo.claimBatch(10, OPTS);
          return {
            composicion: porTipo(jobs),
            reclamadas: ordenadas(claves(jobs, ctx.clavePorId)),
          };
        },
      );
      expect(composicion).toEqual({ webhook_estado: 10 });
      // Y son los DIEZ MAS ANTIGUOS, no diez cualesquiera.
      expect(reclamadas).toEqual([
        "solo-1",
        "solo-2",
        "solo-3",
        "solo-4",
        "solo-5",
        "solo-6",
        "solo-7",
        "solo-8",
        "solo-9",
        "solo-10",
      ]);
    });
  });

  describe("R4 — dentro de un tipo, el mas antiguo primero (no regresion)", () => {
    // El minoritario es el MAS ANTIGUO de todos: asi el caso vale igual con el `ORDER BY`
    // global de antes y con el reparto por turnos, que es lo que exige T2 de tasks.md.
    const SEMILLAS: Semilla[] = [
      { clave: "min-1", tipo: "webhook_estado", offsetMin: 0 },
      ...[10, 20, 30, 40, 50].map((off, i) => ({
        clave: `may-${i + 1}`,
        tipo: "geocodificacion" as JobTipo,
        offsetMin: off,
      })),
    ];

    it("`limit = 4`: del tipo mayoritario entran sus TRES mas antiguos, no otros tres", async () => {
      const { reclamadas, mayoritarias } = await conCorpus(SEMILLAS, async (ctx) => {
        const cl = claves(await ctx.repo.claimBatch(4, OPTS), ctx.clavePorId);
        return {
          reclamadas: ordenadas(cl),
          mayoritarias: ordenadas(cl.filter((c) => c.startsWith("may-"))),
        };
      });
      expect(reclamadas).toEqual(["may-1", "may-2", "may-3", "min-1"]);
      // El desempate intra-tipo es `run_after` ASC: may-1/2/3 son los tres mas antiguos de su
      // tipo. Con el desempate roto (DESC) entrarian may-3/4/5 y esto se pone rojo.
      expect(mayoritarias).toEqual(["may-1", "may-2", "may-3"]);
    });
  });

  describe("R6 — un `processing` colgado compite por su TURNO, no por su origen", () => {
    // El rescatado es el MAS NUEVO por `run_after`: con el orden global de antes jamas
    // entraria en un lote de 2. Por turnos entra, porque es el unico candidato de su tipo.
    const SEMILLAS: Semilla[] = [
      ...serie("pend", "webhook_estado", 0, 3),
      {
        clave: "rescatado",
        tipo: "optimizacion_ruta",
        offsetMin: 300,
        estado: "processing",
        lockedAt: COLGADO_DESDE,
        intentos: 3,
      },
    ];

    it("`limit = 2`: el rescatado toma el turno 1 de su tipo junto al pendiente mas antiguo", async () => {
      const { reclamadas, rescatado } = await conCorpus(SEMILLAS, async (ctx) => {
        const jobs = await ctx.repo.claimBatch(2, OPTS);
        return {
          reclamadas: ordenadas(claves(jobs, ctx.clavePorId)),
          rescatado: jobs.find((j) => j.id === ctx.idPorClave.get("rescatado")),
        };
      });
      expect(reclamadas).toEqual(["pend-1", "rescatado"]);
      // Y el rescate sigue haciendo lo de siempre (R13/feature 90): re-sella y suma intento.
      expect(rescatado?.estado).toBe("processing");
      expect(rescatado?.lockedAt?.toISOString()).toBe(NOW.toISOString());
      expect(rescatado?.intentos).toBe(4); // sembrado con 3
    });

    it("un `processing` con `locked_at` RECIENTE sigue sin ser candidato", async () => {
      const reclamadas = await conCorpus(
        [
          ...serie("pend", "webhook_estado", 0, 1),
          {
            clave: "vivo",
            tipo: "optimizacion_ruta",
            offsetMin: 300,
            estado: "processing",
            lockedAt: new Date(NOW.getTime() - 1_000), // posterior al cutoff: NO colgado
          },
        ],
        async (ctx) => ordenadas(claves(await ctx.repo.claimBatch(5, OPTS), ctx.clavePorId)),
      );
      expect(reclamadas).toEqual(["pend-1"]);
    });
  });

  describe("R9 — el reparto es generico sobre `tipo`, sin enumerar tipos", () => {
    // `analitica_invalidacion_cache` se añadio al enum DESPUES de la feature 90 (ficha 128).
    // Entra en el reparto sin que `JobRepository` lo mencione en ninguna parte.
    it("un tipo posterior a la feature 90 recibe su turno igual que los demas", async () => {
      const { reclamadas, composicion } = await conCorpus(
        [
          ...serie("webhook", "webhook_estado", 0, 3),
          { clave: "nuevo", tipo: "analitica_invalidacion_cache", offsetMin: 300 },
        ],
        async (ctx) => {
          const jobs = await ctx.repo.claimBatch(3, OPTS);
          return {
            reclamadas: ordenadas(claves(jobs, ctx.clavePorId)),
            composicion: porTipo(jobs),
          };
        },
      );
      expect(reclamadas).toEqual(["nuevo", "webhook-1", "webhook-2"]);
      expect(composicion).toEqual({ webhook_estado: 2, analitica_invalidacion_cache: 1 });
    });
  });

  describe("R7 — el reparto se resuelve en UNA sola sentencia", () => {
    it("una llamada a `claimBatch` emite exactamente una consulta contra `jobs`", async () => {
      const { prisma: espia, eventos } = crearPrismaDeTestConEspia();
      let reclamados = 0;
      try {
        await enTransaccionRevertida(espia, async (tx) => {
          await sembrar(tx, [
            ...serie("webhook", "webhook_estado", 0, 2),
            ...serie("geo", "geocodificacion", 60, 2),
          ]);
          const repo = new JobRepository(tx as unknown as PrismaClient);
          eventos.length = 0; // solo interesa lo que emite el claim
          reclamados = (await repo.claimBatch(3, OPTS)).length;
        });
      } finally {
        await espia.$disconnect();
      }

      // El claim reclamo de verdad: sin esto, "una sola consulta" seria cierto por vacio.
      expect(reclamados).toBe(3);
      const sentencias = eventos
        .map((e) => e.query.trim())
        .filter((q) => !/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|DEALLOCATE|SET)\b/i.test(q));
      expect(sentencias).toHaveLength(1);
      // Y esa unica sentencia es la del reparto: ventana por tipo + bloqueo sin espera.
      expect(sentencias[0]).toMatch(/ROW_NUMBER\(\)\s+OVER\s*\(\s*PARTITION BY\s+"tipo"/i);
      expect(sentencias[0]).toMatch(/FOR UPDATE OF j SKIP LOCKED/i);
      // Y la CTE que bloquea REPITE el predicado de candidato, que es lo que impide entregar
      // dos veces una fila que otro worker ya reclamo y COMMITEO (recheck de EvalPlanQual).
      //
      // OJO CON LO QUE ESTA LINEA VALE Y LO QUE NO. Es una asercion de FORMA, y una asercion de
      // forma NO protege el invariante: mide el texto, no el comportamiento. Aqui esta medido
      // que una mutacion de una linea DENTRO de ese predicado (`locked_at < cutoff` por
      // `IS NOT NULL`) la pasa entera y restaura la doble entrega. Quien guarda el invariante
      // de verdad son los dos casos del "modo 2" de
      // `tests/integration/db/job-repository-claim-concurrente.int.test.ts`, que provocan la
      // carrera contra Postgres. Esto se queda solo como aviso temprano y barato.
      expect(sentencias[0]).toMatch(
        /JOIN priorizados[\s\S]*?WHERE[\s\S]*?j\."estado" = 'pending'[\s\S]*?FOR UPDATE OF j SKIP LOCKED/i,
      );
    });
  });
});
