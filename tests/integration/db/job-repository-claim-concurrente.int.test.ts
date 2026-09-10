import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient, JobTipo } from "@prisma/client";

import { JobRepository } from "@/lib/repositories/JobRepository";
import type { ClaimOpts, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";

/**
 * ⭑⭑ FEATURE 402 (R5) — NINGUNA FILA SE ENTREGA A DOS WORKERS. LOS DOS MODOS.
 *
 * QUE INVARIANTE SE MIDE. El de la feature 90 (R10/R11): dos workers nunca toman la misma fila,
 * y el segundo NO SE QUEDA ESPERANDO al primero. La 402 reescribio la sentencia del claim —el
 * bloqueo pasó a una CTE aparte, porque Postgres prohibe `FOR UPDATE` junto a funciones de
 * ventana—, asi que ese invariante hay que RE-MEDIRLO, y con varios tipos en juego.
 *
 * HAY DOS MODOS DE COMPETENCIA, Y SON DISTINTOS. Medir solo uno deja el otro sin red:
 *
 *  1. **El competidor tiene el lock ABIERTO.** El segundo claim debe SALTAR esas filas y seguir,
 *     sin esperar: es lo que da `SKIP LOCKED`. Sin el, Postgres lo deja esperando.
 *  2. **El competidor YA COMMITEO** (y este es el modo NORMAL en produccion: `drenar` llama a
 *     `claimBatch` en autocommit, asi que los locks duran UNA sentencia, milisegundos). La fila
 *     queda libre y con `estado = 'processing'` — o `pending` con un `run_after` futuro, si el
 *     competidor la re-agendo con backoff—. Aqui `SKIP LOCKED` no protege NADA: lo unico que
 *     impide entregarla otra vez es que la CTE que bloquea REPITA el predicado de candidato,
 *     porque Postgres reevalua (EvalPlanQual) las condiciones sobre la version NUEVA de la fila.
 *
 * EL MODO 2 NO ES TEORICO, Y ESTE ARCHIVO LO PROVOCA. Con el `WHERE` de `bloqueados` mutado
 * —`locked_at < cutoff` por `locked_at IS NOT NULL`, o `run_after <= now` por `IS NOT NULL`— la
 * doble entrega vuelve, y los 24 tests de la ficha, los 438 archivos relacionados y las 198
 * guardias seguian VERDES antes de que existieran los dos casos de abajo. Una asercion sobre el
 * TEXTO del SQL no vale aqui: hay que ejercer el comportamiento.
 *
 * COMO SE ABRE LA VENTANA snapshot -> bloqueo, de forma determinista y sin tocar la sentencia:
 * con un corpus GRANDE. La sentencia nueva ya no puede cortar el escaneo en `limit` filas (el
 * `ROW_NUMBER()` obliga a ver TODOS los candidatos, `design.md §2`), asi que su duracion crece
 * con el corpus: medido en esta maquina, 20k -> 30 ms, 60k -> 97 ms, 150k -> 252 ms. Con 150.000
 * candidatos hay un cuarto de segundo de ventana, de sobra para que el competidor commitee
 * dentro. **La exposicion crece con la saturacion**, que es justo el escenario que esta ficha
 * existe para atender.
 *
 * POR QUE ESTE ARCHIVO NO USA `enTransaccionRevertida` COMO SUS HERMANOS. Dos claims concurrentes
 * de verdad necesitan DOS CONEXIONES que vean las mismas filas; lo que una transaccion no ha
 * commiteado es invisible para la otra, y dos consultas sobre la MISMA transaccion se serializan
 * en su unica conexion (no habria concurrencia que medir).
 *
 * COMO SE AISLA ENTONCES. Los corpus se commitean en ESQUEMAS DESECHABLES que este archivo crea
 * y suelta, con una tabla `jobs` clonada de la real (`LIKE public.jobs INCLUDING ALL`: mismos
 * tipos enum, mismos indices, mismos defaults). El repositorio nombra la tabla SIN cualificar
 * (`FROM "jobs"`), asi que un `search_path` por transaccion la resuelve ahi. Ni una fila entra en
 * `public.jobs`. Y al arrancar se barren los esquemas de corridas ANTIGUAS (ver `barrerHuerfanos`).
 *
 * SIN BASE ALCANZABLE se SALTA ENTERO y con su nombre en el reporte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Reloj INYECTADO en el año 2000 (mismo motivo que en el archivo hermano del reparto). */
const NOW = new Date("2000-01-01T00:00:00.000Z");
const CUTOFF = new Date("1999-12-31T23:59:00.000Z");
const OPTS: ClaimOpts = { now: NOW, visibilityCutoff: CUTOFF };

/** El `run_after` con el que un competidor re-agenda tras un fallo (backoff): FUTURO. */
const REAGENDADO_A = new Date("2000-01-01T00:05:00.000Z");

const BASE_RUN_AFTER = Date.parse("1999-06-01T00:00:00.000Z");

/**
 * Nombre del esquema desechable: `t402_<epoch en base36>_<uuid>`. El sello de tiempo va DENTRO
 * del nombre a proposito — es lo que permite barrer huerfanos por edad sin tirar el esquema de
 * otra corrida viva (los archivos de test corren en paralelo, un worker por archivo).
 */
const PREFIJO = "t402_";
function nombreDeEsquema(sufijo: string): string {
  return `${PREFIJO}${Date.now().toString(36)}_${sufijo}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

const ESQUEMA_GRANDE = nombreDeEsquema("carrera");
const ESQUEMA_CHICO = nombreDeEsquema("solape");

/** Candidatos del corpus grande. Medido: con 150k la sentencia dura ~250 ms (ver cabecera). */
const CANDIDATOS_GRANDES = 150_000;
/** Cuantas filas pide cada claim del corpus grande. */
const LIMITE = 5;
/** De las `LIMITE` filas objetivo, cuantas se lleva el competidor antes de que A las bloquee. */
const ROBADAS = 3;

/** Corpus chico del solape con lock abierto: tres tipos, cantidades desiguales. */
const SEMILLAS: { clave: string; tipo: JobTipo; offsetMin: number }[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    clave: `webhook-${i + 1}`,
    tipo: "webhook_estado" as JobTipo,
    offsetMin: i,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    clave: `geo-${i + 1}`,
    tipo: "geocodificacion" as JobTipo,
    offsetMin: 10 + i,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    clave: `whatsapp-${i + 1}`,
    tipo: "whatsapp_bienvenida" as JobTipo,
    offsetMin: 20 + i,
  })),
];

/** Portador del valor: se lanza para forzar el ROLLBACK sin perder lo calculado. */
class Revertir extends Error {
  constructor(readonly valor: unknown) {
    super("rollback deliberado del test");
    this.name = "Revertir";
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeSiHayBase("402/R5 — dos `claimBatch` a la vez sobre tipos mixtos (Postgres real)", () => {
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  const idPorClave = new Map<string, string>();
  const clavePorId = new Map<string, string>();
  /** Las `LIMITE` filas que la sentencia REAL elige del corpus grande, en su orden. */
  let objetivos: string[] = [];
  /** `run_after` original de cada objetivo, para devolver el corpus a su sitio entre carreras. */
  const runAfterOriginal = new Map<string, Date>();
  /** Cuanto tarda la sentencia real sobre el corpus grande: calibra el retardo del competidor. */
  let msDelClaim = 0;

  /**
   * Suelta los esquemas de corridas ANTIGUAS (> 1 h). Por edad y no por prefijo a secas: dos
   * archivos de test corren en paralelo y un barrido ciego se llevaria el esquema de una corrida
   * VIVA a mitad de su medicion. Los nombres que no traen sello de tiempo (formato anterior) se
   * dejan estar: es mas barato un esquema huerfano que un test que se sabotea a si mismo.
   */
  async function barrerHuerfanos(): Promise<void> {
    const filas = await prismaA.$queryRawUnsafe<{ nspname: string }[]>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE '${PREFIJO}%'`,
    );
    const haceUnaHora = Date.now() - 3_600_000;
    for (const { nspname } of filas) {
      const sello = Number.parseInt(nspname.slice(PREFIJO.length).split("_")[0], 36);
      if (Number.isNaN(sello) || sello >= haceUnaHora) continue;
      await prismaA.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
    }
  }

  async function crearEsquema(nombre: string): Promise<void> {
    await prismaA.$executeRawUnsafe(`CREATE SCHEMA "${nombre}"`);
    // Clon estructural EXACTO de la tabla real: los enums, el default de `payload`, los indices
    // y las restricciones son los de produccion, no una aproximacion escrita a mano.
    await prismaA.$executeRawUnsafe(
      `CREATE TABLE "${nombre}"."jobs" (LIKE "public"."jobs" INCLUDING ALL)`,
    );
  }

  beforeAll(async () => {
    prismaA = crearPrismaDeTest();
    prismaB = crearPrismaDeTest();
    await barrerHuerfanos();

    // --- corpus chico (solape con el lock abierto) ---
    await crearEsquema(ESQUEMA_CHICO);
    for (const s of SEMILLAS) {
      const filas = await prismaA.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO "${ESQUEMA_CHICO}"."jobs" (
           "id", "tipo", "payload", "estado", "intentos", "max_intentos",
           "run_after", "locked_at", "created_at", "updated_at"
         )
         VALUES (gen_random_uuid(), $1::"public"."job_tipo", '{}'::jsonb, 'pending', 0, 8, $2, NULL, $3, $3)
         RETURNING "id"`,
        s.tipo,
        new Date(BASE_RUN_AFTER + s.offsetMin * 60_000),
        NOW,
      );
      idPorClave.set(s.clave, filas[0].id);
      clavePorId.set(filas[0].id, s.clave);
    }

    // --- corpus grande (carrera contra un claim ya commiteado) ---
    await crearEsquema(ESQUEMA_GRANDE);
    await prismaA.$executeRawUnsafe(
      `INSERT INTO "${ESQUEMA_GRANDE}"."jobs" (
         "id","tipo","payload","estado","intentos","max_intentos","run_after","created_at","updated_at"
       )
       SELECT gen_random_uuid(),
              (ARRAY['webhook_estado','geocodificacion','whatsapp_bienvenida']::"public"."job_tipo"[])[1 + (i % 3)],
              '{}'::jsonb, 'pending', 0, 8,
              TIMESTAMPTZ '1999-06-01 00:00:00+00' + (i * INTERVAL '1 second'),
              $1, $1
       FROM generate_series(1, ${CANDIDATOS_GRANDES}) AS i`,
      NOW,
    );

    // Ensayo: que filas elige la sentencia REAL y cuanto tarda. Se revierte, asi que el corpus
    // queda intacto. Los objetivos NO se calculan con un SQL escrito a mano: eso demostraria que
    // un orden inventado elige esas filas, no que las elija el que corre en produccion.
    const t0 = Date.now();
    const ensayo = await enTxDelEsquema(prismaA, ESQUEMA_GRANDE, async (tx) => {
      const repo = new JobRepository(tx as unknown as PrismaClient);
      return await repo.claimBatch(LIMITE, OPTS);
    });
    msDelClaim = Date.now() - t0;
    objetivos = ensayo.map((j) => j.id);
    // El `run_after` original de cada objetivo: hace falta para devolver el corpus a su sitio
    // despues de cada carrera (el competidor SI commitea, ver `restaurarObjetivos`).
    for (const j of ensayo) runAfterOriginal.set(j.id, j.runAfter);
    expect(objetivos).toHaveLength(LIMITE);
  });

  afterAll(async () => {
    await prismaA.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA_GRANDE}" CASCADE`);
    await prismaA.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA_CHICO}" CASCADE`);
    await prismaA.$disconnect();
    await prismaB.$disconnect();
  });

  /** Ejecuta `fn` en una tx apuntada al esquema, y la revierte SIEMPRE. */
  async function enTxDelEsquema<T>(
    cliente: PrismaClient,
    esquema: string,
    fn: (tx: TxDeTest) => Promise<T>,
  ): Promise<T> {
    try {
      await cliente.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}", public`);
          throw new Revertir(await fn(tx));
        },
        { timeout: 60_000, maxWait: 20_000 },
      );
    } catch (e: unknown) {
      if (e instanceof Revertir) return e.valor as T;
      throw e;
    }
    throw new Error("la transaccion termino sin revertirse: imposible");
  }

  function claves(jobs: JobDTO[]): string[] {
    return jobs
      .map((j) => clavePorId.get(j.id) ?? `AJENO:${j.id}`)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }

  // ==========================================================================================
  // MODO 1 — el competidor tiene el LOCK ABIERTO
  // ==========================================================================================

  /**
   * A reclama 2 y SE QUEDA con la transaccion abierta (sus filas bloqueadas) hasta que B, en otra
   * conexion, termine de pedir 6. B corre con `statement_timeout`: si se quedara ESPERANDO el lock
   * de A —lo que pasa en cuanto se cae el `SKIP LOCKED`— Postgres lo mata con 57014.
   */
  async function correrSolapeConLockAbierto(): Promise<{ jobsA: JobDTO[]; jobsB: JobDTO[] }> {
    let avisarQueAReclamo!: () => void;
    const aYaReclamo = new Promise<void>((r) => (avisarQueAReclamo = r));
    let soltarA!: () => void;
    const aPuedeSoltar = new Promise<void>((r) => (soltarA = r));

    let jobsA: JobDTO[] = [];
    const trabajoA = prismaA
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${ESQUEMA_CHICO}", public`);
          const repo = new JobRepository(tx as unknown as PrismaClient);
          jobsA = await repo.claimBatch(2, OPTS);
          avisarQueAReclamo();
          await aPuedeSoltar; // mantiene VIVOS los locks mientras B lo intenta
          throw new Revertir(null);
        },
        { timeout: 60_000, maxWait: 20_000 },
      )
      .catch((e: unknown) => {
        if (!(e instanceof Revertir)) throw e;
      });

    await aYaReclamo;

    let jobsB: JobDTO[] = [];
    let errorB: unknown;
    try {
      await prismaB.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${ESQUEMA_CHICO}", public`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 3000`);
          const repo = new JobRepository(tx as unknown as PrismaClient);
          jobsB = await repo.claimBatch(6, OPTS);
          throw new Revertir(null);
        },
        { timeout: 60_000, maxWait: 20_000 },
      );
    } catch (e: unknown) {
      if (!(e instanceof Revertir)) errorB = e;
    } finally {
      soltarA();
      await trabajoA;
    }

    expect(
      errorB,
      "el segundo claim no llego a devolver nada: si es un statement_timeout (57014), es que se " +
        "quedo ESPERANDO el lock del primero — o sea, el claim perdio el `SKIP LOCKED`",
    ).toBeUndefined();
    return { jobsA, jobsB };
  }

  describe("modo 1 — el competidor tiene el lock ABIERTO", () => {
    it("⭑ R5: el segundo claim NO espera al primero y NO repite ni una fila", async () => {
      const { jobsA, jobsB } = await correrSolapeConLockAbierto();

      // El primero se lleva su lote entero (turno 1 de los dos tipos mas antiguos).
      expect(claves(jobsA).sort()).toEqual(["geo-1", "webhook-1"].sort());
      // El segundo NO se queda vacio: salta las filas bloqueadas y sigue con las de mas abajo.
      // Un lote vacio dejaria la disyuncion cierta POR VACIO, que no demuestra nada.
      expect(jobsB.length).toBeGreaterThan(0);

      // R5, la afirmacion de la ficha: la union de lo reclamado por los dos es DISJUNTA.
      const idsA = new Set(jobsA.map((j) => j.id));
      const repetidos = jobsB.filter((j) => idsA.has(j.id));
      expect(repetidos, "una fila fue entregada a los DOS workers").toEqual([]);
      expect(new Set([...idsA, ...jobsB.map((j) => j.id)]).size).toBe(jobsA.length + jobsB.length);
    });

    it("bajo solape, el segundo lote viene INCOMPLETO — el precio de fijar los ids antes de bloquear", async () => {
      // NO es un requisito de la 402: es el efecto declarado en `design.md §2` de que
      // `priorizados` fije los `limit` ids ANTES de bloquear. B pide 6, sus 6 salen del mismo
      // orden por turnos que los de A, y los 2 que A tiene bloqueados se le van: se lleva 4.
      // Se fija aqui, en su propio caso y con su nombre, para que no se lea como si fuera R5.
      // En produccion no muerde: `drenar` llama al claim en AUTOCOMMIT, los locks duran una
      // sentencia (ms) y no el procesado del lote, y lo que quede se recoge 60 s despues.
      const { jobsB } = await correrSolapeConLockAbierto();
      expect(claves(jobsB)).toEqual(["geo-2", "webhook-2", "whatsapp-1", "whatsapp-2"]);
    });

    it("tras el solape, ninguna fila del corpus queda reclamada (las dos tx revirtieron)", async () => {
      // Corre su PROPIO solape: asi no depende de que los casos de arriba se hayan ejecutado
      // antes (vitest no garantiza el orden si algun dia se activa `sequence.shuffle`).
      await correrSolapeConLockAbierto();
      const filas = await prismaA.$queryRawUnsafe<{ estado: string; intentos: number }[]>(
        `SELECT "estado", "intentos" FROM "${ESQUEMA_CHICO}"."jobs"`,
      );
      expect(filas).toHaveLength(SEMILLAS.length);
      expect(filas.every((f) => f.estado === "pending" && Number(f.intentos) === 0)).toBe(true);
    });
  });

  // ==========================================================================================
  // MODO 2 — el competidor YA COMMITEO (el modo NORMAL en produccion)
  // ==========================================================================================

  /**
   * A arranca su `claimBatch` REAL sobre el corpus grande; mientras esa sentencia sigue viva, el
   * competidor toca las `ROBADAS` primeras filas objetivo y COMMITEA. A tiene que descartarlas al
   * bloquear (recheck de EvalPlanQual sobre la version nueva) y devolver SOLO las que quedan.
   *
   * `competidor` recibe los ids robados y hace su cambio en su propia transaccion, con
   * `statement_timeout`: si llegara tarde y A ya tuviera los locks, se quedaria esperando y
   * Postgres lo mataria — y eso se reporta como "la ventana no se abrio", no como un rojo mudo.
   */
  /**
   * Devuelve las filas objetivo a `pending` con su `run_after` de siempre. Hace falta porque en
   * el modo 2 el competidor COMMITEA de verdad (es la esencia de la carrera), asi que sin esto
   * la primera carrera dejaria el corpus tocado y la segunda mediria otra cosa.
   */
  async function restaurarObjetivos(): Promise<void> {
    for (const id of objetivos) {
      await prismaA.$executeRawUnsafe(
        `UPDATE "${ESQUEMA_GRANDE}"."jobs"
            SET "estado" = 'pending', "locked_at" = NULL, "intentos" = 0, "last_error" = NULL,
                "run_after" = $2, "updated_at" = $3
          WHERE "id" = $1`,
        id,
        runAfterOriginal.get(id),
        NOW,
      );
    }
  }

  async function correrCarreraContraCommit(
    competidor: (tx: TxDeTest, robadas: string[]) => Promise<void>,
  ): Promise<{ jobsA: JobDTO[]; robadas: string[]; ventana: string }> {
    await restaurarObjetivos(); // el corpus arranca siempre en el mismo estado
    const robadas = objetivos.slice(0, ROBADAS);
    const tInicioA = Date.now();
    let tFinA = 0;
    let jobsA: JobDTO[] = [];

    const trabajoA = prismaA
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${ESQUEMA_GRANDE}", public`);
          const repo = new JobRepository(tx as unknown as PrismaClient);
          jobsA = await repo.claimBatch(LIMITE, OPTS);
          tFinA = Date.now();
          throw new Revertir(null);
        },
        { timeout: 60_000, maxWait: 20_000 },
      )
      .catch((e: unknown) => {
        if (!(e instanceof Revertir)) throw e;
      });

    // El retardo se CALIBRA con lo que tardo el ensayo, no con un numero fijo: en una maquina
    // mas lenta la ventana se ensancha y el retardo la sigue.
    await esperar(Math.max(20, Math.round(msDelClaim * 0.3)));

    let errorB: unknown;
    try {
      await prismaB.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${ESQUEMA_GRANDE}", public`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 5000`);
          await competidor(tx, robadas);
        },
        { timeout: 60_000, maxWait: 20_000 },
      );
    } catch (e: unknown) {
      errorB = e;
    }
    const tCommitB = Date.now();
    await trabajoA;

    expect(
      errorB,
      "el competidor no pudo commitear dentro de la ventana (si es 57014, se quedo esperando " +
        "un lock que A ya tenia: la ventana se cerro antes de tiempo)",
    ).toBeUndefined();

    // Sin esta comprobacion, un corpus demasiado pequeño haria que A terminase ANTES del commit
    // del competidor: el test pasaria sin haber ejercido la carrera, que es el verde por vacio
    // que este archivo existe para no dar.
    const ventana = `A: ${tInicioA}->${tFinA} (${tFinA - tInicioA} ms), commit del competidor: +${tCommitB - tInicioA} ms`;
    expect(
      tCommitB < tFinA,
      `LA VENTANA NO SE ABRIO — ${ventana}. El competidor commiteo DESPUES de que A terminase, ` +
        `asi que la carrera no se ejercio. Sube CANDIDATOS_GRANDES (hoy ${CANDIDATOS_GRANDES}).`,
    ).toBe(true);
    return { jobsA, robadas, ventana };
  }

  describe("modo 2 — el competidor YA COMMITEO (EvalPlanQual, design §1)", () => {
    it("⭑ R5: una fila que otro worker ya reclamo Y COMMITEO no se entrega por segunda vez", async () => {
      const { jobsA, robadas, ventana } = await correrCarreraContraCommit(async (tx, ids) => {
        // Exactamente lo que el claim hace con las filas que se lleva (mismas cuatro columnas
        // que el `SET` de `claimBatch`), pero dirigido a los ids que A esta a punto de tomar.
        await tx.$executeRawUnsafe(
          `UPDATE "${ESQUEMA_GRANDE}"."jobs"
             SET "estado" = 'processing', "locked_at" = $1, "intentos" = "intentos" + 1,
                 "updated_at" = $1
           WHERE "id" = ANY($2::text[])`, // `jobs.id` es TEXT en la migracion de la 90, no uuid
          NOW,
          ids,
        );
      });

      const idsA = jobsA.map((j) => j.id);
      expect(
        idsA.filter((id) => robadas.includes(id)),
        `DOBLE ENTREGA: A reclamo filas que el competidor ya se habia llevado y commiteado. ${ventana}`,
      ).toEqual([]);
      // Y no se queda corto por otra razon: devuelve EXACTAMENTE las que el competidor no tocó.
      expect(idsA).toEqual(objetivos.slice(ROBADAS));
    });

    it("⭑ una fila re-agendada con backoff por otro worker no se reclama antes de tiempo", async () => {
      const { jobsA, robadas, ventana } = await correrCarreraContraCommit(async (tx, ids) => {
        // El competidor la proceso, le fallo y la re-agendo: `pending` otra vez, pero con el
        // `run_after` del backoff — o sea, EN EL FUTURO. Es lo que hace `JobRepository.fail`.
        const repo = new JobRepository(tx as unknown as PrismaClient);
        for (const id of ids) await repo.fail(id, "fallo simulado del competidor", REAGENDADO_A);
      });

      const idsA = jobsA.map((j) => j.id);
      expect(
        idsA.filter((id) => robadas.includes(id)),
        `BACKOFF IGNORADO: A reclamo filas que otro worker acababa de re-agendar para dentro de ` +
          `cinco minutos. Se ejecutarian antes de tiempo, en bucle. ${ventana}`,
      ).toEqual([]);
      expect(idsA).toEqual(objetivos.slice(ROBADAS));
    });
  });
});
