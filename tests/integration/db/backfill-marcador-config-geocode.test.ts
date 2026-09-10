import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  backfillMarcadorConfigGeocode,
  type BackfillMarcadorClient,
} from "@/scripts/backfill-marcador-config-geocode";
import {
  MARCADOR_FALLO_CONFIG_GEOCODE,
  esFalloConfigGeocode,
} from "@/lib/geo/fallo-config-geocode";
import { AsignabilidadCoordenadasService } from "@/lib/services/AsignabilidadCoordenadasService";
import { hashDireccion } from "@/lib/geo/direccion-query";
import { dedupeKeyGeocodificacion } from "@/lib/services/jobs/geocodificacion-encolado";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

/**
 * FICHA 400 (T19, R17/R18) — LA REPARACION DE UN SOLO USO, CONTRA POSTGRES DE VERDAD.
 *
 * POR QUE NO VALE UN DOBLE. Lo que hay que probar es el `WHERE` y el `UPDATE`: que la fila
 * candidata se marca, que las testigo no se rozan, y que correrlo dos veces no duplica el
 * prefijo. Un doble en memoria no ve el SQL (memoria del repo: «probar el WHERE donde
 * vive»), y este script es literalmente SQL.
 *
 * ⚠️ NADA DE `if (!filas) return;`. Este archivo siembra SUS PROPIAS filas y AFIRMA que las
 * encuentra: un test de integracion que hace `return` cuando no halla datos reporta
 * `passed` sin haber comprobado nada, y aqui ya paso una vez.
 *
 * AISLAMIENTO: todo corre dentro de una transaccion que SIEMPRE se revierte, y las filas
 * llevan un prefijo propio en su `dedupe_key`, asi que no chocan con la base local
 * compartida entre worktrees ni dejan rastro. Sin base alcanzable, el archivo se SALTA — y
 * en ese caso el resultado de esta task NO cuenta (mirar los `skipped`, no solo el exit).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Los dos textos legados, tal como los escribia el codigo ANTES de la ficha 400. */
const LEGADO_REQUEST_DENIED =
  "geocodificar direccion: el proveedor rechazo la peticion (REQUEST_DENIED)";
const LEGADO_SIN_CREDENCIAL = "geocodificacion: GOOGLE_MAPS_API_KEY no esta configurada";
/** Un fallo AJENO: mismo tipo, mismo estado, otra causa. No debe tocarse (R18). */
const AJENO_DE_RED = "geocodificar direccion: HTTP 503";

interface Semilla {
  marca: string;
  /** Las que el backfill DEBE marcar. */
  candidatas: string[];
  /** Las que NO debe tocar, con el motivo por el que quedan fuera. */
  testigos: { id: string; porQue: string }[];
  /** La orden cuyo job candidato usaremos para probar el gate al final. */
  ordenIdDeLaCandidata: string;
  direccionDeLaCandidata: string;
}

interface FilaJob {
  id: string;
  tipo: string;
  estado: string;
  intentos: number;
  max_intentos: number;
  run_after: Date;
  locked_at: Date | null;
  last_error: string | null;
  dedupe_key: string | null;
  payload: unknown;
  created_at: Date;
  updated_at: Date;
}

async function leerFilas(tx: Tx, ids: string[]): Promise<Map<string, FilaJob>> {
  const filas = await tx.$queryRawUnsafe<FilaJob[]>(
    `SELECT id, tipo::text AS tipo, estado::text AS estado, intentos, max_intentos, run_after,
            locked_at, last_error, dedupe_key, payload, created_at, updated_at
     FROM "jobs" WHERE id = ANY($1::text[])`,
    ids,
  );
  return new Map(filas.map((f) => [f.id, f]));
}

/**
 * Siembra 6 filas: 2 candidatas y 4 testigo. Devuelve sus ids.
 *
 * NO devuelve `null` nunca: `jobs` no tiene ninguna FK, asi que no depende de que la base
 * tenga usuarios, zonas ni ordenes. Si el insert fallara, el test revienta — que es lo que
 * debe pasar.
 */
async function sembrar(tx: Tx): Promise<Semilla> {
  const marca = `t400-${randomUUID()}`;
  const ordenIdDeLaCandidata = randomUUID();
  const direccionDeLaCandidata = "Av. de Prueba 400";

  async function insertar(over: {
    tipo: string;
    estado: string;
    lastError: string | null;
    dedupeKey: string;
  }): Promise<string> {
    const id = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "jobs"
         (id, tipo, payload, estado, intentos, max_intentos, run_after, locked_at,
          last_error, dedupe_key, created_at, updated_at)
       VALUES ($1, $2::job_tipo, '{"sembrado":true}'::jsonb, $3::job_estado, 3, 8,
               now(), NULL, $4, $5, now(), now())`,
      id,
      over.tipo,
      over.estado,
      over.lastError,
      over.dedupeKey,
    );
    return id;
  }

  // ── Candidatas: geocodificacion + failed + texto legado + SIN marcar ──────────────────
  const candidataRequestDenied = await insertar({
    tipo: "geocodificacion",
    estado: "failed",
    lastError: LEGADO_REQUEST_DENIED,
    // Clave REAL reconstruible: al final del archivo se la damos al gate de verdad.
    dedupeKey: dedupeKeyGeocodificacion(
      ordenIdDeLaCandidata,
      hashDireccion(direccionDeLaCandidata),
    ),
  });
  const candidataSinCredencial = await insertar({
    tipo: "geocodificacion",
    estado: "failed",
    lastError: LEGADO_SIN_CREDENCIAL,
    dedupeKey: `${marca}:sin-credencial`,
  });

  // ── Testigos: cada una queda fuera por UNA razon distinta ─────────────────────────────
  const testigoOtroTipo = await insertar({
    tipo: "liberar_reprogramadas",
    estado: "failed",
    lastError: LEGADO_REQUEST_DENIED,
    dedupeKey: `${marca}:otro-tipo`,
  });
  const testigoPending = await insertar({
    tipo: "geocodificacion",
    estado: "pending",
    lastError: LEGADO_REQUEST_DENIED,
    dedupeKey: `${marca}:pending`,
  });
  const testigoOtraCausa = await insertar({
    tipo: "geocodificacion",
    estado: "failed",
    lastError: AJENO_DE_RED,
    dedupeKey: `${marca}:otra-causa`,
  });
  const testigoYaMarcada = await insertar({
    tipo: "geocodificacion",
    estado: "failed",
    lastError: `${MARCADOR_FALLO_CONFIG_GEOCODE} ${LEGADO_REQUEST_DENIED}`,
    dedupeKey: `${marca}:ya-marcada`,
  });

  return {
    marca,
    candidatas: [candidataRequestDenied, candidataSinCredencial],
    testigos: [
      { id: testigoOtroTipo, porQue: "otro tipo de job" },
      { id: testigoPending, porQue: "estado pending (se cura solo)" },
      { id: testigoOtraCausa, porQue: "otra causa (fallo de red)" },
      { id: testigoYaMarcada, porQue: "ya lleva el marcador" },
    ],
    ordenIdDeLaCandidata,
    direccionDeLaCandidata,
  };
}

describeSiHayBase("400/T19 — backfill del marcador contra Postgres real", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R17: marca las candidatas, y correrlo DOS veces deja el marcador UNA sola vez", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      const cliente = tx as unknown as BackfillMarcadorClient;

      // No-vacuidad: las filas sembradas EXISTEN. Sin esto, todo lo de abajo podria estar
      // comprobando el vacio y reportar `passed`.
      const antes = await leerFilas(tx, semilla.candidatas);
      expect(antes.size).toBe(2);
      for (const fila of antes.values()) expect(esFalloConfigGeocode(fila.last_error)).toBe(false);

      // ── Pasada 1 ───────────────────────────────────────────────────────────────────
      const primera = await backfillMarcadorConfigGeocode(cliente, { aplicar: true });
      expect(primera.candidatas).toBeGreaterThanOrEqual(2);
      expect(primera.actualizadas).toBe(primera.candidatas);

      const trasPrimera = await leerFilas(tx, semilla.candidatas);
      for (const id of semilla.candidatas) {
        const fila = trasPrimera.get(id)!;
        expect(esFalloConfigGeocode(fila.last_error)).toBe(true);
        // El marcador ANADE, no sustituye: cada fila conserva SU diagnostico original
        // completo detras del prefijo.
        expect(fila.last_error).toBe(
          `${MARCADOR_FALLO_CONFIG_GEOCODE} ${antes.get(id)!.last_error}`,
        );
      }
      // Y los dos textos legados distintos se reconocen, no solo uno:
      expect(trasPrimera.get(semilla.candidatas[0]!)!.last_error).toBe(
        `${MARCADOR_FALLO_CONFIG_GEOCODE} ${LEGADO_REQUEST_DENIED}`,
      );
      expect(trasPrimera.get(semilla.candidatas[1]!)!.last_error).toBe(
        `${MARCADOR_FALLO_CONFIG_GEOCODE} ${LEGADO_SIN_CREDENCIAL}`,
      );

      // ── Pasada 2: IDEMPOTENCIA ─────────────────────────────────────────────────────
      const segunda = await backfillMarcadorConfigGeocode(cliente, { aplicar: true });
      const trasSegunda = await leerFilas(tx, semilla.candidatas);
      for (const fila of trasSegunda.values()) {
        const ocurrencias =
          (fila.last_error ?? "").split(MARCADOR_FALLO_CONFIG_GEOCODE).length - 1;
        expect(ocurrencias).toBe(1);
      }
      // Y las MISMAS filas: la segunda pasada no volvio a tocarlas.
      for (const id of semilla.candidatas) {
        expect(trasSegunda.get(id)!.last_error).toBe(trasPrimera.get(id)!.last_error);
      }
      // Las candidatas propias ya no lo son; el conteo bajo en al menos las 2 sembradas.
      expect(segunda.candidatas).toBe(primera.candidatas - 2);
    });
  });

  it("R18: no cambia estado, intentos, run_after, dedupe_key, payload ni updated_at", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      const todas = [...semilla.candidatas, ...semilla.testigos.map((t) => t.id)];

      const antes = await leerFilas(tx, todas);
      expect(antes.size).toBe(6); // no-vacuidad

      await backfillMarcadorConfigGeocode(tx as unknown as BackfillMarcadorClient, {
        aplicar: true,
      });

      const despues = await leerFilas(tx, todas);
      for (const id of todas) {
        const a = antes.get(id)!;
        const d = despues.get(id)!;
        // TODO menos `last_error` queda byte a byte igual. `updated_at` incluido: por eso el
        // script usa SQL crudo y no `prisma.job.update` (que lo bumpearia por `@updatedAt`).
        expect({ ...d, last_error: null }).toEqual({ ...a, last_error: null });
      }
    });
  });

  it("R18: NINGUNA fila testigo cambia su `last_error` — cada una queda fuera por su razon", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      const ids = semilla.testigos.map((t) => t.id);

      const antes = await leerFilas(tx, ids);
      expect(antes.size).toBe(4); // no-vacuidad

      await backfillMarcadorConfigGeocode(tx as unknown as BackfillMarcadorClient, {
        aplicar: true,
      });

      const despues = await leerFilas(tx, ids);
      for (const testigo of semilla.testigos) {
        expect(
          despues.get(testigo.id)!.last_error,
          `la testigo «${testigo.porQue}» no debia tocarse`,
        ).toBe(antes.get(testigo.id)!.last_error);
      }
    });
  });

  it("solo-lectura por defecto: SIN `--apply` no escribe ni una fila", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      const antes = await leerFilas(tx, semilla.candidatas);
      expect(antes.size).toBe(2);

      const informe = await backfillMarcadorConfigGeocode(
        tx as unknown as BackfillMarcadorClient,
        { aplicar: false },
      );

      expect(informe.actualizadas).toBeNull();
      expect(informe.candidatas).toBeGreaterThanOrEqual(2);
      const despues = await leerFilas(tx, semilla.candidatas);
      for (const id of semilla.candidatas) {
        expect(despues.get(id)!.last_error).toBe(antes.get(id)!.last_error);
        expect(esFalloConfigGeocode(despues.get(id)!.last_error)).toBe(false);
      }
    });
  });

  it("el desglose por estado ve tambien los `pending` (los que se curan solos)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrar(tx);

      const informe = await backfillMarcadorConfigGeocode(
        tx as unknown as BackfillMarcadorClient,
        { aplicar: false },
      );

      const porEstado = new Map(informe.porEstado.map((f) => [f.estado, f.total]));
      expect(porEstado.get("failed") ?? 0).toBeGreaterThanOrEqual(3);
      expect(porEstado.get("pending") ?? 0).toBeGreaterThanOrEqual(1);
    });
  });

  it("R17: tras el backfill, el GATE REAL ya deja pasar la orden de la fila reparada", async () => {
    // Este es el punto de la task: no basta con escribir un prefijo, tiene que producir el
    // desenlace que la ficha promete. Se lee la fila REAL de Postgres y se le entrega al
    // gate de produccion.
    await enTransaccionRevertida(prisma, async (tx) => {
      const semilla = await sembrar(tx);
      const id = semilla.candidatas[0]!;

      const gateAntes = await clasificarConFilaReal(tx, id, semilla);
      expect(gateAntes).toBe("geocodificacion_agotada"); // antes: bloqueada

      await backfillMarcadorConfigGeocode(tx as unknown as BackfillMarcadorClient, {
        aplicar: true,
      });

      const gateDespues = await clasificarConFilaReal(tx, id, semilla);
      expect(gateDespues).toBe("asignable_sin_ubicacion"); // despues: pasa
    });
  });

  /** Lee la fila real y la clasifica con el gate de produccion. */
  async function clasificarConFilaReal(
    tx: Tx,
    jobId: string,
    semilla: Semilla,
  ): Promise<string | undefined> {
    const fila = (await leerFilas(tx, [jobId])).get(jobId);
    expect(fila, "la fila sembrada tiene que existir").toBeDefined();

    const jobDto: JobDTO = {
      id: fila!.id,
      tipo: "geocodificacion",
      payload: {},
      estado: "failed",
      intentos: fila!.intentos,
      maxIntentos: fila!.max_intentos,
      runAfter: fila!.run_after,
      lockedAt: fila!.locked_at,
      lastError: fila!.last_error,
      dedupeKey: fila!.dedupe_key,
      createdAt: fila!.created_at,
      updatedAt: fila!.updated_at,
    };
    const cola = {
      findByDedupeKeys: async (keys: string[]) =>
        jobDto.dedupeKey !== null && keys.includes(jobDto.dedupeKey) ? [jobDto] : [],
      enqueue: async () => null,
    } as unknown as IJobRepository;

    const estados = await new AsignabilidadCoordenadasService(cola).evaluar([
      {
        id: semilla.ordenIdDeLaCandidata,
        direccion: semilla.direccionDeLaCandidata,
        latitud: null,
        longitud: null,
        geocodeStatus: null,
      },
    ]);
    return estados.get(semilla.ordenIdDeLaCandidata);
  }
});
