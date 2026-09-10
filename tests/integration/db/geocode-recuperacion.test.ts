import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { GeocodeSaludRepository } from "@/lib/repositories/GeocodeSaludRepository";
import { marcarFalloConfigGeocode } from "@/lib/geo/fallo-config-geocode";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 401 (T7, design §5.1/§10) — LA RECUPERACIÓN, MEDIDA CONTRA POSTGRES.
//
// POR QUÉ ESTE ARCHIVO NO PUEDE SER UN TEST DE DOBLES, y está medido cuatro veces en este repo:
// con un repositorio falso, una mutación del `WHERE` pasa EN VERDE. Todo lo que decide si esta
// ficha funciona vive dentro de dos sentencias SQL —a quién alcanza el `WHERE`, en qué orden, con
// qué límite y con qué `run_after`—, y ninguna de esas cosas es una rama de código.
//
// Cubre R15, R16, R18, R19, R21, R22, R23 y R24. Reproduce el incidente del 2026-09-08 con sus
// números reales: 25 jobs `failed` con marcador, y **ninguna sentencia manual** sobre la base.
//
// Todo lo que escribe corre dentro de `enTransaccionRevertida`: si el test pasa, si falla o si el
// proceso muere a mitad, no queda ni una fila en la base compartida. Y NO asume base vacía —los
// worktrees comparten la base local—: siembra con un prefijo propio de `dedupe_key` y sólo mira
// sus propias filas.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** El instante de la «vuelta del proveedor», inyectado. Nunca `NOW()` de Postgres. */
const AHORA = new Date("2026-09-09T21:35:00.000Z");
const UN_MINUTO = 60_000;
const ESPACIADO_MS = 60_000;
const LOTE = 5;
const ENFRIAMIENTO_MS = 60 * UN_MINUTO;

interface FilaSembrada {
  id: string;
  etiqueta: string;
}

interface Semilla {
  tipo?: "geocodificacion" | "liberar_reprogramadas";
  estado?: "pending" | "processing" | "done" | "failed";
  /** Minutos de antigüedad de `updated_at` respecto de `AHORA`. */
  antiguedadMin: number;
  lastError: string | null;
  intentos?: number;
  lockedAt?: Date | null;
  etiqueta: string;
}

/** El `last_error` que la 400 escribe hoy. Se PRODUCE con su función; el literal no se copia. */
function conMarcador(detalle: string): string {
  return marcarFalloConfigGeocode(detalle);
}

/** La prosa LEGADA, anterior a la 400: mismo texto, SIN marcador. Nunca debe recuperarse (Q4). */
const PROSA_LEGADA = "geocodificacion: el proveedor rechazo la peticion (REQUEST_DENIED)";

async function sembrar(tx: TxDeTest, prefijo: string, semillas: Semilla[]): Promise<FilaSembrada[]> {
  const filas: FilaSembrada[] = [];
  let i = 0;
  for (const s of semillas) {
    const id = randomUUID();
    const updatedAt = new Date(AHORA.getTime() - s.antiguedadMin * UN_MINUTO);
    await tx.$executeRawUnsafe(
      `INSERT INTO "jobs"
         ("id","tipo","payload","estado","intentos","max_intentos","run_after","locked_at",
          "last_error","dedupe_key","created_at","updated_at")
       VALUES ($1, $2::"job_tipo", '{"ordenId":"orden-de-prueba"}'::jsonb, $3::"job_estado",
               $4, 8, $5, $6, $7, $8, $5, $5)`,
      id,
      s.tipo ?? "geocodificacion",
      s.estado ?? "failed",
      s.intentos ?? 8,
      updatedAt,
      s.lockedAt ?? null,
      s.lastError,
      `${prefijo}:${i}`,
    );
    // El `updated_at` va aparte: el INSERT de arriba lo pone igual que `created_at`, y lo que esta
    // ficha ancla es el instante del ÚLTIMO FALLO.
    await tx.$executeRawUnsafe(`UPDATE "jobs" SET "updated_at" = $2 WHERE "id" = $1`, id, updatedAt);
    filas.push({ id, etiqueta: s.etiqueta });
    i += 1;
  }
  return filas;
}

interface FilaLeida {
  id: string;
  tipo: string;
  estado: string;
  intentos: number;
  run_after: Date;
  locked_at: Date | null;
  last_error: string | null;
  dedupe_key: string | null;
  payload: unknown;
  updated_at: Date;
}

async function leer(tx: TxDeTest, ids: string[]): Promise<Map<string, FilaLeida>> {
  const filas = await tx.$queryRawUnsafe<FilaLeida[]>(
    `SELECT "id", "tipo"::text AS tipo, "estado"::text AS estado, "intentos"::int AS intentos,
            "run_after", "locked_at", "last_error", "dedupe_key", "payload", "updated_at"
       FROM "jobs" WHERE "id" = ANY($1::text[])`,
    ids,
  );
  return new Map(filas.map((f) => [f.id, f]));
}

function repoDe(tx: TxDeTest): GeocodeSaludRepository {
  return new GeocodeSaludRepository(tx as unknown as PrismaClient);
}

/** La llamada tal cual la hace `GeocodeSaludService.registrarExitoProveedor`. */
function opciones(ahora: Date = AHORA) {
  return {
    ahora,
    limite: LOTE,
    espaciadoMs: ESPACIADO_MS,
    tocadoAntesDe: new Date(ahora.getTime() - ENFRIAMIENTO_MS),
  };
}

describeSiHayBase("401/T7 — R18: el incidente del 2026-09-08, reproducido y recuperado SOLO", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ 25 jobs muertos con marcador + una respuesta satisfactoria → vuelven a la cola sin tocar la base a mano", async () => {
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      // Los 25 del incidente, con `updated_at` escalonado: el más viejo primero.
      const muertos = await sembrar(
        tx,
        prefijo,
        Array.from({ length: 25 }, (_, k) => ({
          antiguedadMin: 300 - k * 5, // de 300 a 180 minutos: todos fuera del enfriamiento
          lastError: conMarcador(`intento ${k}`),
          etiqueta: `muerto-${k}`,
        })),
      );

      const antes = await leer(tx, muertos.map((m) => m.id));
      // ⚠️ FALLA RUIDOSAMENTE SI NO ENCUENTRA SUS PROPIAS FILAS. Sin esto, un `INSERT` que no
      // hubiera entrado dejaría todas las aserciones de abajo pasando por vacío (memoria del
      // repo: «test de integración verde sin datos»).
      expect(antes.size).toBe(25);
      expect([...antes.values()].every((f) => f.estado === "failed")).toBe(true);

      const revividos = await repoDe(tx).revivirFallosConfig(opciones());
      const despues = await leer(tx, muertos.map((m) => m.id));

      return {
        revividos,
        pendientes: [...despues.values()].filter((f) => f.estado === "pending").length,
        // Los ids de los que cambiaron, en orden de `run_after`.
        recuperados: [...despues.values()]
          .filter((f) => f.estado === "pending")
          .sort((a, b) => a.run_after.getTime() - b.run_after.getTime())
          .map((f) => f.id),
        losCincoMasViejos: muertos.slice(0, 5).map((m) => m.id),
        filas: despues,
      };
    });

    expect(r.revividos).toBe(LOTE);
    expect(r.pendientes).toBe(LOTE);
    // R19: los MÁS ANTIGUOS primero. No «cinco cualesquiera».
    expect(r.recuperados).toEqual(r.losCincoMasViejos);
  });
});

describeSiHayBase("401/T7 — R15: el job vuelve en condiciones de ejecutarse, y sin mutar su identidad", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ `pending`, `intentos = 0`, `last_error` NULO, `locked_at` NULO", async () => {
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const [muerto] = await sembrar(tx, prefijo, [
        {
          antiguedadMin: 200,
          lastError: conMarcador("REQUEST_DENIED"),
          intentos: 8,
          lockedAt: new Date(AHORA.getTime() - 200 * UN_MINUTO),
          etiqueta: "muerto",
        },
      ]);
      const antes = (await leer(tx, [muerto.id])).get(muerto.id);
      expect(antes, "la fila sembrada no aparece en la base").toBeDefined();
      expect(antes!.intentos).toBe(8);
      expect(antes!.locked_at).not.toBeNull();

      const n = await repoDe(tx).revivirFallosConfig(opciones());
      const despues = (await leer(tx, [muerto.id])).get(muerto.id);
      return { n, antes: antes!, despues: despues! };
    });

    expect(r.n).toBe(1);
    expect(r.despues.estado).toBe("pending");
    expect(r.despues.intentos).toBe(0);
    expect(r.despues.last_error).toBeNull();
    expect(r.despues.locked_at).toBeNull();
  });

  it("⭑ `tipo`, `payload` y `dedupe_key` quedan IDÉNTICOS: la recuperación no cambia de identidad", async () => {
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const [muerto] = await sembrar(tx, prefijo, [
        { antiguedadMin: 200, lastError: conMarcador("REQUEST_DENIED"), etiqueta: "muerto" },
      ]);
      const antes = (await leer(tx, [muerto.id])).get(muerto.id)!;
      await repoDe(tx).revivirFallosConfig(opciones());
      const despues = (await leer(tx, [muerto.id])).get(muerto.id)!;
      return { antes, despues };
    });

    expect(r.despues.tipo).toBe(r.antes.tipo);
    expect(r.despues.dedupe_key).toBe(r.antes.dedupe_key);
    expect(r.despues.payload).toEqual(r.antes.payload);
    expect(r.antes.dedupe_key, "la semilla no tenía dedupe_key: el testigo no vale").not.toBeNull();
  });
});

describeSiHayBase("401/T7 — R16: SÓLO los que llevan el marcador. Nadie más, nunca", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ un `failed` SIN marcador y otro con la PROSA LEGADA no se tocan", async () => {
    // El de la prosa legada es el hueco declarado y aceptado de la pregunta abierta Q4: un job
    // anterior a la 400 no se recupera solo. Cerrarlo exige correr la operación idempotente de la
    // 400, no ampliar el predicado de esta ficha — que es exactamente lo que R1 prohíbe.
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const filas = await sembrar(tx, prefijo, [
        { antiguedadMin: 200, lastError: "geocodificacion: fallo de red", etiqueta: "sin-marcador" },
        { antiguedadMin: 210, lastError: PROSA_LEGADA, etiqueta: "prosa-legada" },
        { antiguedadMin: 220, lastError: null, etiqueta: "sin-error" },
        { antiguedadMin: 190, lastError: conMarcador("REQUEST_DENIED"), etiqueta: "elegible" },
      ]);
      const antes = await leer(tx, filas.map((f) => f.id));
      expect(antes.size, "faltan filas sembradas").toBe(4);

      const n = await repoDe(tx).revivirFallosConfig(opciones());
      const despues = await leer(tx, filas.map((f) => f.id));
      return {
        n,
        porEtiqueta: Object.fromEntries(
          filas.map((f) => [f.etiqueta, despues.get(f.id)!.estado]),
        ),
        antes: Object.fromEntries(filas.map((f) => [f.etiqueta, antes.get(f.id)!])),
        despues: Object.fromEntries(filas.map((f) => [f.etiqueta, despues.get(f.id)!])),
      };
    });

    // Sólo el elegible. Y el conteo lo dice antes que las etiquetas: si el `WHERE` del marcador
    // desapareciera, aquí saldría 4.
    expect(r.n).toBe(1);
    expect(r.porEtiqueta).toEqual({
      "sin-marcador": "failed",
      "prosa-legada": "failed",
      "sin-error": "failed",
      elegible: "pending",
    });
    // Y ni siquiera se les tocó el `updated_at`.
    for (const etiqueta of ["sin-marcador", "prosa-legada", "sin-error"]) {
      expect(r.despues[etiqueta].updated_at).toEqual(r.antes[etiqueta].updated_at);
      expect(r.despues[etiqueta].last_error).toBe(r.antes[etiqueta].last_error);
    }
  });
});

describeSiHayBase("401/T7 — R23: ninguna fila de otro tipo, ni ninguna que no esté muerta", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ filas testigo comparadas ANTES y DESPUÉS: ninguna cambia", async () => {
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const filas = await sembrar(tx, prefijo, [
        // Otro TIPO de job, muerto y con marcador: el `WHERE` no puede alcanzarlo.
        {
          tipo: "liberar_reprogramadas",
          antiguedadMin: 300,
          lastError: conMarcador("REQUEST_DENIED"),
          etiqueta: "otro-tipo",
        },
        // Geocodificación COMPLETADA con marcador: es la foto de un intento anterior ya superado.
        {
          estado: "done",
          antiguedadMin: 300,
          lastError: conMarcador("REQUEST_DENIED"),
          etiqueta: "done",
        },
        // Geocodificación VIVA con marcador: no está muerta, no se toca.
        {
          estado: "pending",
          antiguedadMin: 300,
          lastError: conMarcador("REQUEST_DENIED"),
          intentos: 3,
          etiqueta: "pending",
        },
        {
          estado: "processing",
          antiguedadMin: 300,
          lastError: conMarcador("REQUEST_DENIED"),
          intentos: 4,
          etiqueta: "processing",
        },
        // Y uno elegible, para que el test no pase por no haber hecho nada.
        { antiguedadMin: 300, lastError: conMarcador("REQUEST_DENIED"), etiqueta: "elegible" },
      ]);
      const antes = await leer(tx, filas.map((f) => f.id));
      expect(antes.size, "faltan filas sembradas").toBe(5);

      const n = await repoDe(tx).revivirFallosConfig(opciones());
      const despues = await leer(tx, filas.map((f) => f.id));
      return {
        n,
        antes: Object.fromEntries(filas.map((f) => [f.etiqueta, antes.get(f.id)!])),
        despues: Object.fromEntries(filas.map((f) => [f.etiqueta, despues.get(f.id)!])),
      };
    });

    expect(r.n).toBe(1); // el elegible, y sólo él
    for (const etiqueta of ["otro-tipo", "done", "pending", "processing"]) {
      expect(r.despues[etiqueta], `el testigo ${etiqueta} cambió`).toEqual(r.antes[etiqueta]);
    }
    expect(r.despues.elegible.estado).toBe("pending");
  });
});

describeSiHayBase("401/T7 — R21/R22: ni tormenta de reintentos, ni todos de golpe", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ R21: con 25 candidatos y máximo 5, se recuperan EXACTAMENTE 5", async () => {
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const muertos = await sembrar(
        tx,
        prefijo,
        Array.from({ length: 25 }, (_, k) => ({
          antiguedadMin: 300 - k * 2,
          lastError: conMarcador(`intento ${k}`),
          etiqueta: `muerto-${k}`,
        })),
      );
      expect((await leer(tx, muertos.map((m) => m.id))).size).toBe(25);

      const n = await repoDe(tx).revivirFallosConfig(opciones());
      const despues = await leer(tx, muertos.map((m) => m.id));
      return {
        n,
        pendientes: [...despues.values()].filter((f) => f.estado === "pending").length,
        siguenMuertos: [...despues.values()].filter((f) => f.estado === "failed").length,
      };
    });

    expect(r.n).toBe(5);
    expect(r.pendientes).toBe(5);
    expect(r.siguenMuertos).toBe(20); // los otros veinte esperan su turno
  });

  it("⭑ R22: los `run_after` de la tanda están separados ≥60 s y TODOS son posteriores a la recuperación", async () => {
    // ES LA INVARIANTE QUE IMPIDE REPETIR EL ATASCO DE LA FICHA 402: `claimBatch` ordena por
    // `run_after` y toma 10 por corrida; con los cinco al mismo instante ocuparían la corrida
    // siguiente casi entera. Con el escalonado, como mucho UNO de la tanda es reclamable en cada
    // corrida de 10 — y eso se mide sobre los `run_after` generados, no se espera.
    const prefijo = `test-401-${randomUUID()}`;
    const runAfters = await enTransaccionRevertida(prisma, async (tx) => {
      const muertos = await sembrar(
        tx,
        prefijo,
        Array.from({ length: 8 }, (_, k) => ({
          antiguedadMin: 300 - k * 2,
          lastError: conMarcador(`intento ${k}`),
          etiqueta: `muerto-${k}`,
        })),
      );
      expect((await leer(tx, muertos.map((m) => m.id))).size).toBe(8);
      await repoDe(tx).revivirFallosConfig(opciones());
      const despues = await leer(tx, muertos.map((m) => m.id));
      return [...despues.values()]
        .filter((f) => f.estado === "pending")
        .map((f) => f.run_after.getTime())
        .sort((a, b) => a - b);
    });

    expect(runAfters).toHaveLength(5);
    for (const t of runAfters) expect(t).toBeGreaterThan(AHORA.getTime());
    for (let i = 1; i < runAfters.length; i++) {
      expect(runAfters[i] - runAfters[i - 1]).toBeGreaterThanOrEqual(ESPACIADO_MS);
    }
    // Y el escalonado es exactamente el de design §6.2: 1, 2, 3, 4 y 5 minutos.
    expect(runAfters.map((t) => (t - AHORA.getTime()) / UN_MINUTO)).toEqual([1, 2, 3, 4, 5]);
  });

  it("⭑ un espaciado configurado distinto viaja al SQL de verdad", async () => {
    const prefijo = `test-401-${randomUUID()}`;
    const runAfters = await enTransaccionRevertida(prisma, async (tx) => {
      const muertos = await sembrar(tx, prefijo, [
        { antiguedadMin: 300, lastError: conMarcador("a"), etiqueta: "a" },
        { antiguedadMin: 290, lastError: conMarcador("b"), etiqueta: "b" },
      ]);
      expect((await leer(tx, muertos.map((m) => m.id))).size).toBe(2);
      await repoDe(tx).revivirFallosConfig({ ...opciones(), espaciadoMs: 90_000 });
      const despues = await leer(tx, muertos.map((m) => m.id));
      return [...despues.values()].map((f) => f.run_after.getTime()).sort((a, b) => a - b);
    });

    expect(runAfters.map((t) => (t - AHORA.getTime()) / 1000)).toEqual([90, 180]);
  });
});

describeSiHayBase("401/T7 — R24: el enfriamiento, la red contra un proveedor que parpadea", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ un job tocado hace un instante NO entra; uno anterior al enfriamiento SÍ", async () => {
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const filas = await sembrar(tx, prefijo, [
        // Dentro del enfriamiento (hace 10 min): NO.
        { antiguedadMin: 10, lastError: conMarcador("reciente"), etiqueta: "reciente" },
        // Justo dentro (hace 59 min): NO.
        { antiguedadMin: 59, lastError: conMarcador("casi"), etiqueta: "casi" },
        // Fuera (hace 61 min): SÍ.
        { antiguedadMin: 61, lastError: conMarcador("frio"), etiqueta: "frio" },
      ]);
      expect((await leer(tx, filas.map((f) => f.id))).size).toBe(3);

      const n = await repoDe(tx).revivirFallosConfig(opciones());
      const despues = await leer(tx, filas.map((f) => f.id));
      return {
        n,
        porEtiqueta: Object.fromEntries(filas.map((f) => [f.etiqueta, despues.get(f.id)!.estado])),
      };
    });

    expect(r.n).toBe(1);
    expect(r.porEtiqueta).toEqual({ reciente: "failed", casi: "failed", frio: "pending" });
  });

  it("⭑ dos llamadas seguidas NO reviven a los mismos: la segunda coge a los SIGUIENTES", async () => {
    // El techo duro que design §6.3 promete: ≤1 revivido por job y por hora, incluso con un
    // proveedor que parpadee. Un job ya revivido queda `pending` y su `updated_at` es `ahora`, así
    // que ni el `estado` ni el enfriamiento lo dejan volver a entrar.
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const muertos = await sembrar(
        tx,
        prefijo,
        Array.from({ length: 12 }, (_, k) => ({
          antiguedadMin: 300 - k * 2,
          lastError: conMarcador(`intento ${k}`),
          etiqueta: `muerto-${k}`,
        })),
      );
      expect((await leer(tx, muertos.map((m) => m.id))).size).toBe(12);
      const repo = repoDe(tx);

      const primera = await repo.revivirFallosConfig(opciones());
      const trasPrimera = await leer(tx, muertos.map((m) => m.id));
      const idsPrimera = [...trasPrimera.values()]
        .filter((f) => f.estado === "pending")
        .map((f) => f.id)
        .sort();

      const segunda = await repo.revivirFallosConfig(opciones());
      const trasSegunda = await leer(tx, muertos.map((m) => m.id));
      const idsTotal = [...trasSegunda.values()]
        .filter((f) => f.estado === "pending")
        .map((f) => f.id)
        .sort();

      return { primera, segunda, idsPrimera, idsTotal };
    });

    expect(r.primera).toBe(5);
    expect(r.segunda).toBe(5);
    // 10 distintos: ninguno se revivió dos veces.
    expect(r.idsTotal).toHaveLength(10);
    expect(new Set(r.idsTotal).size).toBe(10);
    for (const id of r.idsPrimera) expect(r.idsTotal).toContain(id);
  });
});

describeSiHayBase("401/T7 — R2/R3: el conteo de evidencia, medido sobre el mismo `WHERE`", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ cuenta jobs NO completados con marcador dentro de la ventana, y excluye el job en curso", async () => {
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const filas = await sembrar(tx, prefijo, [
        { estado: "failed", antiguedadMin: 10, lastError: conMarcador("a"), etiqueta: "failed-dentro" },
        { estado: "pending", antiguedadMin: 20, lastError: conMarcador("b"), etiqueta: "pending-dentro" },
        { estado: "processing", antiguedadMin: 30, lastError: conMarcador("c"), etiqueta: "processing-dentro" },
        // FUERA de la ventana de 60 min: no cuenta (R3).
        { estado: "failed", antiguedadMin: 90, lastError: conMarcador("d"), etiqueta: "fuera-ventana" },
        // COMPLETADO: la foto de un intento ya superado, no cuenta.
        { estado: "done", antiguedadMin: 10, lastError: conMarcador("e"), etiqueta: "done" },
        // Sin marcador: no es evidencia (R5).
        { estado: "failed", antiguedadMin: 10, lastError: PROSA_LEGADA, etiqueta: "prosa" },
        // Otro tipo de job: no es de esta ficha (R23).
        {
          tipo: "liberar_reprogramadas",
          estado: "failed",
          antiguedadMin: 10,
          lastError: conMarcador("f"),
          etiqueta: "otro-tipo",
        },
        // El JOB EN CURSO, que se excluye por id (el off-by-one de design §5.3).
        { estado: "processing", antiguedadMin: 1, lastError: conMarcador("g"), etiqueta: "en-curso" },
      ]);
      expect((await leer(tx, filas.map((f) => f.id))).size, "faltan filas sembradas").toBe(8);

      const enCurso = filas.find((f) => f.etiqueta === "en-curso")!;
      const desde = new Date(AHORA.getTime() - 60 * UN_MINUTO);
      const repo = repoDe(tx);
      return {
        // Con el job en curso excluido: los tres «dentro» y nada más.
        excluyendoElEnCurso: await repo.contarFallosConfigDesde(desde, enCurso.id),
        // Y sin excluirlo (usando un id que no existe): entra también él.
        sinExcluirNada: await repo.contarFallosConfigDesde(desde, randomUUID()),
      };
    });

    // ⚠️ No se compara con un número absoluto de la tabla entera: la base es COMPARTIDA y puede
    // traer filas de otras suites. Lo que se compara es la DIFERENCIA que producen las semillas.
    expect(r.sinExcluirNada - r.excluyendoElEnCurso).toBe(1);
    expect(r.excluyendoElEnCurso).toBeGreaterThanOrEqual(3);
  });

  it("⭑ CONTRAPRUEBA sobre la ventana: con `desde` justo después, las mismas filas dejan de contar", async () => {
    // Sin este control, el caso de arriba pasaría aunque el `updated_at >= desde` no existiera.
    const prefijo = `test-401-${randomUUID()}`;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const filas = await sembrar(tx, prefijo, [
        { estado: "failed", antiguedadMin: 30, lastError: conMarcador("a"), etiqueta: "a" },
        { estado: "failed", antiguedadMin: 40, lastError: conMarcador("b"), etiqueta: "b" },
      ]);
      expect((await leer(tx, filas.map((f) => f.id))).size).toBe(2);
      const repo = repoDe(tx);
      const ajeno = randomUUID();
      return {
        conVentanaAmplia: await repo.contarFallosConfigDesde(
          new Date(AHORA.getTime() - 60 * UN_MINUTO),
          ajeno,
        ),
        conVentanaEstrecha: await repo.contarFallosConfigDesde(
          new Date(AHORA.getTime() - 5 * UN_MINUTO),
          ajeno,
        ),
      };
    });

    expect(r.conVentanaAmplia - r.conVentanaEstrecha).toBeGreaterThanOrEqual(2);
  });
});
