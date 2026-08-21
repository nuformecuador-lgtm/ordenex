import { describe, it, expect, vi, beforeEach } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 34 — repo de la asignacion satelite. `asignarSateliteLote` es un UPDATE
// guardado por estado de origen + zona (patron `recibirEnSatelite`).
// Feature 49/#7: el raw pasa a `$queryRaw ... RETURNING "id"` DENTRO de un `$transaction`,
// y con los ids retornados hace el append del historial en la MISMA tx. El count que
// consume el service = `rows.length` (mismo contrato). Una orden que pierde la guarda
// no aparece en el RETURNING -> no deja rastro (R8).
//
// ⚠️ FEATURE 241 (2026-08-20) — ESTE ARCHIVO CUSTODIABA EL `NOT EXISTS` DE CIERRE, Y HOY CUSTODIA
// SU AUSENCIA. El caso de abajo afirmaba, literalmente, `expect(strings).toMatch(/NOT EXISTS/)` y
// `/'solicitado', 'vencido', 'rechazado'/`. Era la guardia anti-TOCTOU de la 41/R23, y era un
// aserto legitimo: mientras el service tuvo su pre-chequeo, esta comprobacion dentro del UPDATE lo
// respaldaba contra una carrera.
//
// SU CAIDA ES LA SENAL, NO UN ESTORBO. El 2026-08-18 se retiro el pre-chequeo del service y este
// `NOT EXISTS` se quedo con el criterio de antes. Desde entonces, en produccion, la pantalla del
// satelite dejaba elegir a un mensajero con cierre y el UPDATE devolvia 0 filas: `conflict` con
// `detalle: []`, que la UI redactaba como «Actualiza la lista y vuelve a intentarlo» — falso, y sin
// arreglo posible reintentando (investigacion 241 §4.2). Dos comprobaciones de la misma accion
// afirmando lo contrario, cada una verde en su capa.
//
// La regla firmada por el humano el 2026-08-20 dice que RECIBIR ASIGNACIONES NO SE BLOQUEA NUNCA,
// asi que el que sobraba era el `NOT EXISTS`. Se fue, y los asertos se INVIERTEN: ahora afirman
// que el UPDATE no menciona `cierre_dia`. Si alguien lo repone, este caso se pone rojo — que es
// exactamente el trabajo que hacia antes, con el signo cambiado.

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    ordenHistorialEstado: { createMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    ...overrides,
  };
  return { prisma, tx };
}

// Feature 49/#7: contexto de historial (actor = el adminSatelite que asigna).
const HIST_ASIGNACION = {
  actorUsuarioId: "adminsat-1",
  origenTipo: "asignacion_satelite",
} as const;

// Feature 246 (T3.3, R7): el dia de reparto YA RESUELTO por el servicio (convencion `@db.Date`:
// medianoche UTC de la fecha calendario CR). El repositorio no calcula fechas ni conoce el reloj.
const FECHA_REPARTO = new Date("2026-08-21T00:00:00.000Z");

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("OrdenRepository.asignarSateliteLote (feature 34/R7/R14 + feature 49/#7 + feature 241)", () => {
  it("ejecuta un UPDATE raw con guardia estado+zona y RETURNING; count = filas transicionadas", async () => {
    const { prisma, tx } = buildPrisma();
    // La DB solo transiciona las que siguen en el origen de la zona: 2 de 3.
    tx.$queryRaw.mockResolvedValue([{ id: "o1" }, { id: "o2" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1", "o2", "o3"],
      "m-1",
      "z-satelite",
      idEstado("por_recoger"),
      idEstado("en_bodega_satelite"),
      HIST_ASIGNACION,
      FECHA_REPARTO,
    );

    // R14/R23: count refleja solo lo transicionado (rows.length del RETURNING).
    expect(count).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Feature 99: el choke point (appendCambioEstado) ahora emite, tras el append, una sonda
    // de elegibilidad de webhook EN LA MISMA tx (transactional-outbox). El UPDATE de dominio
    // sigue siendo la PRIMERA consulta ($queryRaw call[0], inspeccionada abajo); la 2.a es la
    // sonda de suscripciones (no-op sin owners suscritos).
    expect(tx.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(1);
    // `$queryRaw` se invoca como tagged template: call[0] = fragmentos de texto (SQL),
    // call[1..] = valores interpolados. Se verifica el SQL y los parametros.
    const call = tx.$queryRaw.mock.calls[0] as unknown[];
    const strings = (call[0] as string[]).join(" ");
    const values = call.slice(1);
    expect(values).toContain("m-1");
    expect(values).toContain(idEstado("por_recoger"));
    expect(values).toContain(idEstado("en_bodega_satelite"));
    expect(values).toContain("z-satelite");
    // R8: la sentencia NO menciona num_guia.
    expect(strings).not.toMatch(/num_guia/);
    // ⚠️ FEATURE 241 — LOS TRES ASERTOS INVERTIDOS. Antes exigian `NOT EXISTS`, `cierre_dia` y
    // `'solicitado', 'vencido', 'rechazado'` DENTRO del UPDATE. La escritura de la asignacion NO
    // mira cierres: recibir trabajo no se bloquea, y esta comprobacion era la que hacia fallar la
    // pantalla del satelite con un mensaje falso. Que el SQL no nombre `cierre_dia` es hoy la
    // propiedad; si vuelve, este caso lo dice.
    expect(strings).not.toMatch(/cierre_dia/);
    expect(strings).not.toMatch(/NOT EXISTS/);
    expect(strings).not.toMatch(/solicitado|vencido|rechazado/);
    // Y lo que SI se conserva, que es lo que hace segura la escritura y no tiene nada que ver con
    // los cierres: estado de ORIGEN, zona y no-borrada, en el mismo UPDATE.
    expect(strings).toMatch(/"estatus_id" = /);
    expect(strings).toMatch(/"zona_id" = /);
    expect(strings).toMatch(/"deleted_at" IS NULL/);
    // Feature 49/#7: RETURNING "id" para atar el historial a las filas realmente transicionadas.
    expect(strings).toMatch(/RETURNING "id"/);
    // Feature 76/R23 (W3): el SET estampa asignado_at = NOW() junto a la asignacion.
    expect(strings).toMatch(/"asignado_at" = NOW\(\)/);
    // ── FEATURE 246 (T3.3, R7/R17) ────────────────────────────────────────────────────────────
    // El dia de reparto va en el MISMO `SET` que `asignado_at` (nunca en una segunda pasada) y
    // entra PARAMETRIZADO, como TEXTO `YYYY-MM-DD` con `::date` explicito.
    expect(strings).toMatch(/"fecha_reparto" = /);
    expect(strings).toMatch(/::date/);
    expect(values).toContain("2026-08-21");
    // R6/R17: el dia lo decide el SERVIDOR, no la base. Nada de `NOW()::date` (que seria «hoy»
    // segun el reloj de Postgres) y nada de aritmetica de zona horaria dentro del SQL — es la
    // segunda definicion del dia que design §3 prohibe.
    expect(strings).not.toMatch(/NOW\(\)::date/);
    expect(strings).not.toMatch(/CURRENT_DATE/);
    expect(strings).not.toMatch(/AT TIME ZONE/);
    expect(strings).not.toMatch(/America\/Costa_Rica/);
    expect(strings).not.toMatch(/interval/i);
    // Y el valor NO viaja interpolado en el texto del SQL: viaja como parametro.
    expect(strings).not.toMatch(/2026-08-21/);
    // Feature 101/R5 (gate F1.4-Q1): el SET apaga prioridad al reasignar desde bodega satelite.
    expect(strings).toMatch(/"prioridad" = false/);
  });

  // Feature 49/#7 (R15/R8): SOLO las ordenes que ganaron la guarda dejan rastro.
  it("R15/R8: registra historial (asignacion_satelite) solo de los ids retornados", async () => {
    const { prisma, tx } = buildPrisma();
    // De 2 pedidas, una perdio la guarda -> solo o1 en el RETURNING. Feature 241: el motivo ya no
    // puede ser un cierre (esa condicion se fue); queda perder por estado de origen, zona o borrado.
    tx.$queryRaw.mockResolvedValue([{ id: "o1" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1", "o2"],
      "m-1",
      "z-satelite",
      idEstado("por_recoger"),
      idEstado("en_bodega_satelite"),
      HIST_ASIGNACION,
      FECHA_REPARTO,
    );

    expect(count).toBe(1);
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    // Origen = el estatus de la guarda (os-bodega-satelite); solo o1, no o2.
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_bodega_satelite"),
        estatusDestinoId: idEstado("por_recoger"),
        actorUsuarioId: "adminsat-1",
        origenTipo: "asignacion_satelite",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("count 0 cuando ninguna orden matchea (o el mensajero quedo bloqueado); no deja rastro", async () => {
    const { prisma, tx } = buildPrisma();
    tx.$queryRaw.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarSateliteLote(
      ["o1"],
      "m-1",
      "z-satelite",
      idEstado("por_recoger"),
      idEstado("en_bodega_satelite"),
      HIST_ASIGNACION,
      FECHA_REPARTO,
    );

    expect(count).toBe(0);
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("devuelve 0 sin abrir transaccion cuando ordenIds esta vacio", async () => {
    const { prisma, tx } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(
      await repo.asignarSateliteLote(
        [],
        "m-1",
        "z-satelite",
        idEstado("por_recoger"),
        idEstado("en_bodega_satelite"),
        HIST_ASIGNACION,
        FECHA_REPARTO,
      ),
    ).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
