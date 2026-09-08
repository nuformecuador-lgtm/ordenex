import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import type { UpdateZonaResult } from "@/lib/interfaces/repositories/IZonaRepository";

// tx mock que reciben las operaciones dentro de $transaction.
function buildTx() {
  return {
    zona: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      // FICHA 376: la lectura de la central PREVIA, antes del `updateMany` que la apaga. Por
      // defecto no hay ninguna: los casos que la necesitan la fijan.
      findFirst: vi.fn().mockResolvedValue(null),
      delete: vi.fn(),
    },
    // FICHA 366: `findMany` por defecto NO devuelve nada, asi que ningun distrito resuelve una
    // zona y el flujo de reconciliacion no se dispara en los casos que no lo miden.
    zonaDistrito: { createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    // FICHA 377: `count` es el conteo de las RETENIDAS (R8). Por defecto 0, para que los casos que
    // no lo miden no tengan que fijarlo.
    orden: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    tarifaZonaMensajero: { createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    // FICHA 362: el borrado registra su accion DENTRO de esta misma transaccion.
    historialAccion: { createMany: vi.fn() },
    usuario: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ nombre: "Maestra", primerApellido: "Uno", rol: { value: "maestro" } }),
    },
  };
}

function buildPrisma(tx: ReturnType<typeof buildTx>, overrides: Record<string, unknown> = {}) {
  return {
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    zona: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    tarifaZonaMensajero: { findMany: vi.fn() },
    distrito: { count: vi.fn() },
    vehiculo: { count: vi.fn() },
    ...overrides,
  };
}

function repoOf(prisma: unknown) {
  return new ZonaRepository(prisma as unknown as PrismaClient);
}

/**
 * FICHA 376: el desenlace de `update` viaja NOMBRADO. Este helper estrecha a la rama `ok` y FALLA
 * RUIDOSAMENTE si no lo es — un `as` silencioso convertiria un `sin_zona_central` inesperado en un
 * `undefined` y las aserciones de abajo pasarian por vacuidad.
 */
function soloOk(res: UpdateZonaResult): Extract<UpdateZonaResult, { estado: "ok" }> {
  if (res.estado !== "ok") throw new Error(`se esperaba \`ok\` y llego \`${res.estado}\``);
  return res;
}

describe("ZonaRepository.create", () => {
  it("crea zona + N:M + tarifas en transaccion y devuelve el DTO", async () => {
    const tx = buildTx();
    tx.zona.create.mockResolvedValue({ id: "z1", nombre: "GAM", cobroVehiculo: false, esCentral: false });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    const dto = await repoOf(prisma).create({
      nombre: "GAM",
      cobroVehiculo: false,
      esCentral: false,
      distritoIds: ["d1", "d2"],
      tarifas: [],
    }, null);

    expect(tx.zona.create).toHaveBeenCalledWith({
      data: { nombre: "GAM", cobroVehiculo: false, esCentral: false },
    });
    expect(tx.zonaDistrito.createMany).toHaveBeenCalledWith({
      data: [
        { zonaId: "z1", distritoId: "d1" },
        { zonaId: "z1", distritoId: "d2" },
      ],
    });
    expect(dto.distritosCount).toBe(2);
    expect(dto.tarifas).toEqual([]);
  });

  it("persiste tarifas con Decimal y vehiculoId", async () => {
    const tx = buildTx();
    tx.zona.create.mockResolvedValue({ id: "z1", nombre: "GAM", cobroVehiculo: true, esCentral: false });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([
      {
        id: "t1",
        cobroEntregado: new Prisma.Decimal("10.00"),
        cobroRechazado: new Prisma.Decimal("5.00"),
        vehiculoId: "v1",
      },
    ]);
    const prisma = buildPrisma(tx);

    const dto = await repoOf(prisma).create({
      nombre: "GAM",
      cobroVehiculo: true,
      esCentral: false,
      distritoIds: ["d1"],
      tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" }],
    }, null);

    const arg = tx.tarifaZonaMensajero.createMany.mock.calls[0][0];
    expect(arg.data[0].cobroEntregado).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data[0].vehiculoId).toBe("v1");
    expect(dto.tarifas).toEqual([
      { id: "t1", cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" },
    ]);
  });
});

describe("ZonaRepository — invariante 'una central' (feature 55/R5/R6)", () => {
  it("create con esCentral=true desmarca cualquier central previa ANTES de crear", async () => {
    const tx = buildTx();
    tx.zona.create.mockResolvedValue({ id: "z2", nombre: "NUEVA", cobroVehiculo: false, esCentral: true });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    const dto = await repoOf(prisma).create({
      nombre: "NUEVA",
      cobroVehiculo: false,
      esCentral: true,
      distritoIds: ["d1"],
      tarifas: [],
    }, null);

    // sin id propio aun: desmarca TODAS las centrales previas
    expect(tx.zona.updateMany).toHaveBeenCalledWith({
      where: { esCentral: true },
      data: { esCentral: false },
    });
    // el desmarcado ocurre antes de crear la zona (orden de invocacion)
    expect(tx.zona.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.zona.create.mock.invocationCallOrder[0],
    );
    expect(dto.esCentral).toBe(true);
  });

  it("create con esCentral=false NO desmarca ninguna central", async () => {
    const tx = buildTx();
    tx.zona.create.mockResolvedValue({ id: "z2", nombre: "X", cobroVehiculo: false, esCentral: false });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    await repoOf(prisma).create({
      nombre: "X",
      cobroVehiculo: false,
      esCentral: false,
      distritoIds: ["d1"],
      tarifas: [],
    }, null);

    expect(tx.zona.updateMany).not.toHaveBeenCalled();
  });

  it("update con esCentral=true desmarca cualquier OTRA central (NOT id propio) antes de actualizar", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1", esCentral: false });
    tx.zona.update.mockResolvedValue({ id: "z1", nombre: "GAM", cobroVehiculo: false, esCentral: true });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update(
      "z1",
      { nombre: "GAM", cobroVehiculo: false, esCentral: true, distritoIds: ["d1"], tarifas: [] },
      null,
    );

    expect(tx.zona.updateMany).toHaveBeenCalledWith({
      where: { esCentral: true, NOT: { id: "z1" } },
      data: { esCentral: false },
    });
    expect(tx.zona.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.zona.update.mock.invocationCallOrder[0],
    );
    expect(soloOk(res).zona.esCentral).toBe(true);
  });

  it("update con esCentral=false NO desmarca ninguna central", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1", esCentral: false });
    tx.zona.update.mockResolvedValue({ id: "z1", nombre: "GAM", cobroVehiculo: false, esCentral: false });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    await repoOf(prisma).update(
      "z1",
      { nombre: "GAM", cobroVehiculo: false, esCentral: false, distritoIds: ["d1"], tarifas: [] },
      null,
    );

    expect(tx.zona.updateMany).not.toHaveBeenCalled();
  });

  it("create: P2002 sobre es_central se traduce a ConflictError (no un error generico/500)", async () => {
    const tx = buildTx();
    tx.zona.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "x",
        meta: { target: ["es_central"] },
      }),
    );
    const prisma = buildPrisma(tx);

    await expect(
      repoOf(prisma).create({
        nombre: "NUEVA",
        cobroVehiculo: false,
        esCentral: true,
        distritoIds: ["d1"],
        tarifas: [],
      }, null),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("update: P2002 sobre es_central se traduce a ConflictError", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1", esCentral: false });
    tx.zona.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "x",
        meta: { target: ["zona_es_central_unico"] },
      }),
    );
    const prisma = buildPrisma(tx);

    await expect(
      repoOf(prisma).update(
        "z1",
        { nombre: "GAM", cobroVehiculo: false, esCentral: true, distritoIds: ["d1"], tarifas: [] },
        null,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // --- Fix P2002 driver adapter (PrismaPg): meta.target === undefined; el nombre
  // del indice (zona_es_central_unico) vive en driverAdapterError.cause.originalMessage.
  function p2002Adapter(constraint: string) {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.8.0",
      meta: {
        modelName: "Zona",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage: `llave duplicada viola restriccion de unicidad «${constraint}»`,
            kind: "UniqueConstraintViolation",
          },
        },
      },
    });
  }

  it("adapter: create con P2002 de es_central (sin meta.target) -> ConflictError", async () => {
    const tx = buildTx();
    tx.zona.create.mockRejectedValue(p2002Adapter("zona_es_central_unico"));
    const prisma = buildPrisma(tx);

    await expect(
      repoOf(prisma).create({
        nombre: "NUEVA",
        cobroVehiculo: false,
        esCentral: true,
        distritoIds: ["d1"],
        tarifas: [],
      }, null),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("adapter: update con P2002 de es_central (sin meta.target) -> ConflictError", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1", esCentral: false });
    tx.zona.update.mockRejectedValue(p2002Adapter("zona_es_central_unico"));
    const prisma = buildPrisma(tx);

    await expect(
      repoOf(prisma).update(
        "z1",
        { nombre: "GAM", cobroVehiculo: false, esCentral: true, distritoIds: ["d1"], tarifas: [] },
        null,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("adapter: P2002 de OTRA constraint (nombre) NO se traduce a ConflictError: re-lanza tal cual", async () => {
    const tx = buildTx();
    const original = p2002Adapter("zona_nombre_key");
    tx.zona.create.mockRejectedValue(original);
    const prisma = buildPrisma(tx);

    await expect(
      repoOf(prisma).create({
        nombre: "DUP",
        cobroVehiculo: false,
        esCentral: false,
        distritoIds: ["d1"],
        tarifas: [],
      }, null),
    ).rejects.toBe(original);
  });

  it("P2002 sobre OTRA constraint (nombre) NO se traduce a ConflictError de central: re-lanza tal cual", async () => {
    const tx = buildTx();
    const original = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "x",
      meta: { target: ["nombre"] },
    });
    tx.zona.create.mockRejectedValue(original);
    const prisma = buildPrisma(tx);

    await expect(
      repoOf(prisma).create({
        nombre: "DUP",
        cobroVehiculo: false,
        esCentral: false,
        distritoIds: ["d1"],
        tarifas: [],
      }, null),
    ).rejects.toBe(original);
  });
});

describe("ZonaRepository.hardDelete", () => {
  it("borra tarifas + N:M + zona y devuelve ok", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1", esCentral: false });
    const prisma = buildPrisma(tx);
    const res = await repoOf(prisma).hardDelete("z1", "actor-1");
    expect(res).toBe("ok");
    expect(tx.tarifaZonaMensajero.deleteMany).toHaveBeenCalledWith({ where: { zonaId: "z1" } });
    expect(tx.zona.delete).toHaveBeenCalledWith({ where: { id: "z1" } });
  });

  it("zona inexistente -> not_found", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue(null);
    const prisma = buildPrisma(tx);
    expect(await repoOf(prisma).hardDelete("zX", "actor-1")).toBe("not_found");
    expect(tx.zona.delete).not.toHaveBeenCalled();
  });

  // ⚠️ ESTOS CASOS FABRICAN EL ERROR, Y ESA ES SU LIMITACION. Hasta el 2026-09-04 aqui solo
  // estaba el `P2003` de abajo, y por eso la suite estuvo verde mientras el codigo NO devolvia
  // `referenced` NUNCA en produccion: bajo `@prisma/adapter-pg` la violacion de FK llega como
  // `DriverAdapterError` con `cause.code === "23001"`, no como `PrismaClientKnownRequestError`.
  // LA EVIDENCIA REAL, provocando la violacion contra Postgres (una orden apuntando a la zona),
  // vive en `tests/integration/db/tarifa-zona-borrado-fk-real.test.ts`.
  it("FK RESTRICT en la forma REAL del adapter (DriverAdapterError, 23001) -> referenced", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1", esCentral: false });
    tx.zona.delete.mockRejectedValue(
      Object.assign(
        new Error(
          'update or delete on table "zona" violates RESTRICT setting of foreign key ' +
            'constraint "orden_zona_id_fkey" on table "orden"',
        ),
        { name: "DriverAdapterError", cause: { code: "23001" } },
      ),
    );
    const prisma = buildPrisma(tx);
    expect(await repoOf(prisma).hardDelete("z1", "actor-1")).toBe("referenced");
  });

  it("FK RESTRICT en la forma nativa (P2003) -> referenced, por si el adapter la traduce", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1", esCentral: false });
    tx.zona.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "x" }),
    );
    const prisma = buildPrisma(tx);
    expect(await repoOf(prisma).hardDelete("z1", "actor-1")).toBe("referenced");
  });

  it("un SQLSTATE del adapter que NO es de FK se propaga (no se disfraza de `referenced`)", async () => {
    // `40001` es un fallo de serializacion: reintentable, y desde luego no «esta en uso».
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1", esCentral: false });
    tx.zona.delete.mockRejectedValue(
      Object.assign(new Error("could not serialize access"), {
        name: "DriverAdapterError",
        cause: { code: "40001" },
      }),
    );
    const prisma = buildPrisma(tx);
    await expect(repoOf(prisma).hardDelete("z1", "actor-1")).rejects.toThrow(
      "could not serialize access",
    );
  });
});

describe("ZonaRepository.list", () => {
  it("mapea distritosCount y NO incluye tarifas sin include", async () => {
    const tx = buildTx();
    const prisma = buildPrisma(tx, {
      zona: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "z1", nombre: "GAM", cobroVehiculo: false, esCentral: true, _count: { distritos: 3 } },
          ]),
        count: vi.fn().mockResolvedValue(1),
      },
    });
    const { items, total } = await repoOf(prisma).list({ skip: 0, take: 25, includeTarifas: false });
    expect(total).toBe(1);
    expect(items[0].distritosCount).toBe(3);
    expect(items[0].esCentral).toBe(true);
    expect(items[0].tarifas).toBeUndefined();
  });

  it("con includeTarifas agrupa tarifas por zona", async () => {
    const tx = buildTx();
    const prisma = buildPrisma(tx, {
      zona: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "z1", nombre: "GAM", cobroVehiculo: true, esCentral: false, _count: { distritos: 1 } },
          ]),
        count: vi.fn().mockResolvedValue(1),
      },
      tarifaZonaMensajero: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "t1",
            zonaId: "z1",
            cobroEntregado: new Prisma.Decimal("10"),
            cobroRechazado: new Prisma.Decimal("5"),
            vehiculoId: "v1",
          },
        ]),
      },
    });
    const { items } = await repoOf(prisma).list({ skip: 0, take: 25, includeTarifas: true });
    expect(items[0].tarifas).toEqual([
      { id: "t1", cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" },
    ]);
  });
});

describe("ZonaRepository.findCentralZonaId (feature 54)", () => {
  it("devuelve el id de la zona con esCentral=true", async () => {
    const tx = buildTx();
    const findFirst = vi.fn().mockResolvedValue({ id: "z-central" });
    const prisma = buildPrisma(tx, {
      zona: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), findFirst },
    });
    const res = await repoOf(prisma).findCentralZonaId();
    expect(res).toBe("z-central");
    expect(findFirst).toHaveBeenCalledWith({ where: { esCentral: true }, select: { id: true } });
  });

  it("devuelve null cuando ninguna zona es central", async () => {
    const tx = buildTx();
    const prisma = buildPrisma(tx, {
      zona: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    });
    expect(await repoOf(prisma).findCentralZonaId()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 366 (T4) — LA RECONCILIACION DE LA ZONA DE LAS ORDENES, con dobles.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LO QUE ESTE BLOQUE **NO** PRUEBA, Y ESTA DICHO A PROPOSITO: el `where` de elegibilidad. Estos
// dobles no ven el SQL —una mutacion que borre `cierreDetalles: { none: {} }` los deja a todos en
// verde—, y este repo ya midio CUATRO veces que un `where` mutado sobrevive por arriba. Ese corte
// se prueba donde vive: `tests/integration/db/zona-reconciliacion-ordenes.test.ts`, contra
// Postgres real. Lo que SI se mide aqui es la ORQUESTACION: como se agrupa, que se actualiza, que
// se cuenta y con que `lote_id` se firma.

/** El estado de la N:M que ve el flujo: `previos` (antes del reemplazo) y `finales` (despues). */
function txConNM(
  previos: string[],
  finales: { distritoId: string; zonaId: string }[],
): ReturnType<typeof buildTx> {
  const tx = buildTx();
  tx.zonaDistrito.findMany
    .mockResolvedValueOnce(previos.map((distritoId) => ({ distritoId })))
    .mockResolvedValueOnce(finales);
  tx.zona.findUnique.mockResolvedValue({ id: "zA", esCentral: false });
  tx.zona.update.mockResolvedValue({
    id: "zA",
    nombre: "A",
    cobroVehiculo: false,
    esCentral: false,
  });
  tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
  return tx;
}

const DATOS_ZONA_A = {
  nombre: "A",
  cobroVehiculo: false,
  esCentral: false,
  distritoIds: ["d1"],
  tarifas: [],
};

describe("366/T4 — ZonaRepository.update reconcilia la zona de las ordenes", () => {
  it("⭑ R2/R4/R9: actualiza SOLO `zonaId` de las ordenes del distrito que resuelve otra zona", async () => {
    const tx = txConNM(["d1"], [{ distritoId: "d1", zonaId: "zA" }]);
    tx.orden.findMany.mockResolvedValue([
      { id: "o1", numGuia: 100, numRemision: "R-1" },
      { id: "o2", numGuia: null, numRemision: "R-2" },
    ]);
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update("zA", DATOS_ZONA_A, "u-maestro");

    expect(tx.orden.updateMany).toHaveBeenCalledTimes(1);
    // R9: el `data` del UPDATE lleva UNA sola clave, y es `zonaId`. Escrito como igualdad literal
    // —no como `toMatchObject`— porque lo que esta ficha promete es una AUSENCIA: que no toca
    // ningun otro campo de la orden.
    expect(tx.orden.updateMany.mock.calls[0][0].data).toEqual({ zonaId: "zA" });
    expect(tx.orden.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ["o1", "o2"] } });
    expect(soloOk(res).ordenesReconciliadas).toBe(2);
  });

  it("⭑ R12: `ordenesReconciliadas` cuenta las filas ALCANZADAS, no los distritos ni los grupos", async () => {
    const tx = txConNM(
      ["d1", "d2"],
      [
        { distritoId: "d1", zonaId: "zA" },
        { distritoId: "d2", zonaId: "zB" },
      ],
    );
    // grupo zA: 1 orden; grupo zB: 3 ordenes.
    tx.orden.findMany
      .mockResolvedValueOnce([{ id: "o1", numGuia: 1, numRemision: "R-1" }])
      .mockResolvedValueOnce([
        { id: "o2", numGuia: 2, numRemision: "R-2" },
        { id: "o3", numGuia: 3, numRemision: "R-3" },
        { id: "o4", numGuia: 4, numRemision: "R-4" },
      ]);
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update(
      "zA",
      { ...DATOS_ZONA_A, distritoIds: ["d1", "d2"] },
      "u-maestro",
    );

    expect(soloOk(res).ordenesReconciliadas).toBe(4);
  });

  it("⭑ R10/R11: una fila de historial por orden, TODAS con el MISMO `lote_id` aunque haya 2 grupos", async () => {
    const tx = txConNM(
      ["d1", "d2"],
      [
        { distritoId: "d1", zonaId: "zA" },
        { distritoId: "d2", zonaId: "zB" },
      ],
    );
    tx.orden.findMany
      .mockResolvedValueOnce([{ id: "o1", numGuia: 900, numRemision: "R-1" }])
      .mockResolvedValueOnce([{ id: "o2", numGuia: null, numRemision: "R-2" }]);
    const prisma = buildPrisma(tx);

    await repoOf(prisma).update("zA", { ...DATOS_ZONA_A, distritoIds: ["d1", "d2"] }, "u-maestro");

    const filas = tx.historialAccion.createMany.mock.calls.flatMap(
      (c) => (c[0] as { data: Record<string, unknown>[] }).data,
    );
    expect(filas).toHaveLength(2);
    expect(new Set(filas.map((f) => f.loteId)).size).toBe(1);
    expect(filas[0]).toMatchObject({
      accion: "orden_zona_reconciliada",
      entidadTipo: "orden",
      entidadId: "o1",
      // La GUIA (o la remision si no hay guia): nunca un dato del destinatario (R10).
      entidadEtiqueta: expect.stringContaining("900"),
      // El actor CONGELADO, no resuelto al leer (362/design §2.4).
      actorUsuarioId: "u-maestro",
      actorNombre: "Maestra Uno",
      actorRol: "maestro",
    });
    // R10: la fila registra el HECHO, no los valores. Ahi irian la zona vieja y la nueva.
    expect(filas[0].valorAnterior).toBeNull();
    expect(filas[0].valorNuevo).toBeNull();
    expect(filas[0].monto).toBeNull();
    expect(filas[1].entidadEtiqueta).toContain("R-2");
  });

  it("R3: un distrito que resuelve 0 o >1 zonas no mueve ninguna orden ni deja historial", async () => {
    // d1 -> DOS zonas (ambiguo); d2 -> ninguna fila (0 zonas).
    const tx = txConNM(
      ["d1", "d2"],
      [
        { distritoId: "d1", zonaId: "zA" },
        { distritoId: "d1", zonaId: "zB" },
      ],
    );
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update(
      "zA",
      { ...DATOS_ZONA_A, distritoIds: ["d1", "d2"] },
      "u-maestro",
    );

    expect(tx.orden.findMany).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
    expect(soloOk(res).ordenesReconciliadas).toBe(0);
  });

  it("⭑ R5: la segunda lectura de la N:M cubre la UNION de los distritos de antes y los de despues", async () => {
    // `dViejo` se QUITA en este guardado y `dNuevo` entra. Los DOS tienen que re-evaluarse: si el
    // flujo mirara solo la lista final, las ordenes de `dViejo` se quedarian apuntando a esta zona
    // para siempre.
    const tx = txConNM(["dViejo", "dQueSigue"], []);
    const prisma = buildPrisma(tx);

    await repoOf(prisma).update(
      "zA",
      { ...DATOS_ZONA_A, distritoIds: ["dQueSigue", "dNuevo"] },
      null,
    );

    const segunda = tx.zonaDistrito.findMany.mock.calls[1][0] as {
      where: { distritoId: { in: string[] } };
    };
    expect(new Set(segunda.where.distritoId.in)).toEqual(
      new Set(["dViejo", "dQueSigue", "dNuevo"]),
    );
    // Y sin repetidos: `dQueSigue` esta en las dos listas y entra UNA vez.
    expect(segunda.where.distritoId.in).toHaveLength(3);
  });

  it("R7/R14: sin ordenes elegibles no se escribe historial y el conteo es 0", async () => {
    const tx = txConNM(["d1"], [{ distritoId: "d1", zonaId: "zA" }]);
    tx.orden.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update("zA", DATOS_ZONA_A, "u-maestro");

    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
    expect(soloOk(res).ordenesReconciliadas).toBe(0);
  });

  it("⭑ R13: `create()` NO invoca ninguna pieza de este flujo", async () => {
    const tx = buildTx();
    tx.zona.create.mockResolvedValue({
      id: "zNueva",
      nombre: "NUEVA",
      cobroVehiculo: false,
      esCentral: false,
    });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    await repoOf(prisma).create({ ...DATOS_ZONA_A, nombre: "NUEVA" }, null);

    expect(tx.zonaDistrito.findMany).not.toHaveBeenCalled();
    expect(tx.orden.findMany).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("la zona que no existe devuelve el desenlace `not_found` y no reconcilia nada", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue(null);
    const prisma = buildPrisma(tx);

    expect(await repoOf(prisma).update("zX", DATOS_ZONA_A, "u-maestro")).toEqual({
      estado: "not_found",
    });
    expect(tx.zonaDistrito.findMany).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 377 (T4) — LA ORQUESTACION DEL CORTE POR ESTADO Y DEL CONTEO DE RETENIDAS, con dobles.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LO QUE ESTE BLOQUE **NO** PRUEBA, Y ES LA MITAD QUE IMPORTA: que el corte por estado FILTRE
// de verdad. Estos dobles devuelven lo que se les dice devolver, asi que un `where` que no
// excluyera nada los dejaria a todos en verde. Eso vive contra Postgres real, en
// `tests/integration/db/zona-reconciliacion-ordenes.test.ts` (T5), donde la mutacion se nota.
// Lo que SI se mide aqui: que las dos consultas SALGAN, que salgan con las clausulas
// COMPLEMENTARIAS sobre el MISMO `where` base, y que los dos numeros lleguen al retorno separados.

describe("377/T4 — el corte por estado y el conteo de retenidas", () => {
  /** El `where` base de elegibilidad (366), tal cual, sin nada de estado. */
  const BASE_D1_ZA = {
    distritoId: { in: ["d1"] },
    zonaId: { not: "zA" },
    deletedAt: null,
    cierreDetalles: { none: {} },
    gestiones: { none: { anuladaAt: null, resultado: { in: ["entregada", "rechazada", "incidente"] } } },
  };

  it("⭑ R2/R9: las dos consultas comparten el `where` base y solo difieren en el estado", async () => {
    // Escrito como igualdad LITERAL de los dos `where` completos —y no comparando una consulta
    // contra la otra— a proposito: comparar las dos entre si estaria siempre en verde, porque las
    // produce el mismo codigo. Aqui, quitar cualquiera de los cuatro cortes de la 366, o invertir
    // el `notIn`, se cae.
    const tx = txConNM(["d1"], [{ distritoId: "d1", zonaId: "zA" }]);
    tx.orden.findMany.mockResolvedValue([{ id: "o1", numGuia: 1, numRemision: "R-1" }]);
    tx.orden.count.mockResolvedValue(0);
    const prisma = buildPrisma(tx);

    await repoOf(prisma).update("zA", DATOS_ZONA_A, "u-maestro");

    expect(tx.orden.count.mock.calls[0][0].where).toEqual({
      ...BASE_D1_ZA,
      estatus: { value: { in: ["en_bodega_satelite"] } },
    });
    expect(tx.orden.findMany.mock.calls[0][0].where).toEqual({
      ...BASE_D1_ZA,
      estatus: { value: { notIn: ["en_bodega_satelite"] } },
    });
  });

  it("⭑ R8: el conteo se hace TAMBIEN cuando no hay ninguna orden que mover", async () => {
    // El caso que un `if (elegibles.length === 0) continue;` puesto antes del `count` se comeria:
    // un guardado que SOLO retiene tiene que informar sus retenidas igual.
    const tx = txConNM(["d1"], [{ distritoId: "d1", zonaId: "zA" }]);
    tx.orden.findMany.mockResolvedValue([]);
    tx.orden.count.mockResolvedValue(4);
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update("zA", DATOS_ZONA_A, "u-maestro");

    expect(tx.orden.count).toHaveBeenCalledTimes(1);
    expect(soloOk(res).ordenesReconciliadas).toBe(0);
    expect(soloOk(res).ordenesRetenidasEnBodegaSatelite).toBe(4);
    // R6: y sin mover nada no se escribe ni una fila de historial por las retenidas.
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("⭑ R7: los dos numeros viajan por separado y el retenido ACUMULA por grupo", async () => {
    // Dos zonas resueltas en el mismo guardado: 1 + 3 movidas y 2 + 5 retenidas. Numeros distintos
    // entre si para que sumar el par equivocado, o quedarse con el ultimo grupo, se caiga.
    const tx = txConNM(
      ["d1", "d2"],
      [
        { distritoId: "d1", zonaId: "zA" },
        { distritoId: "d2", zonaId: "zB" },
      ],
    );
    tx.orden.findMany
      .mockResolvedValueOnce([{ id: "o1", numGuia: 1, numRemision: "R-1" }])
      .mockResolvedValueOnce([
        { id: "o2", numGuia: 2, numRemision: "R-2" },
        { id: "o3", numGuia: 3, numRemision: "R-3" },
        { id: "o4", numGuia: 4, numRemision: "R-4" },
      ]);
    tx.orden.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update(
      "zA",
      { ...DATOS_ZONA_A, distritoIds: ["d1", "d2"] },
      "u-maestro",
    );

    expect(soloOk(res).ordenesReconciliadas).toBe(4);
    expect(soloOk(res).ordenesRetenidasEnBodegaSatelite).toBe(7);
  });

  it("⭑ R13: `create()` no cuenta retenidas (ni abre el flujo)", async () => {
    const tx = buildTx();
    tx.zona.create.mockResolvedValue({
      id: "zNueva",
      nombre: "NUEVA",
      cobroVehiculo: false,
      esCentral: false,
    });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    const dtoCreado = await repoOf(prisma).create({ ...DATOS_ZONA_A, nombre: "NUEVA" }, null);

    expect(tx.orden.count).not.toHaveBeenCalled();
    // Y el DTO de crear sigue sin ninguno de los dos conteos: `CrearZonaResult` no los lleva.
    expect(dtoCreado).not.toHaveProperty("ordenesRetenidasEnBodegaSatelite");
    expect(dtoCreado).not.toHaveProperty("ordenesReconciliadas");
  });

  it("R3: sin ninguna zona resuelta no se cuenta nada y las retenidas son 0", async () => {
    // `d1` en DOS zonas (ambiguo) -> `zonaUnicaDeDistrito` colapsa a null -> ni `count` ni
    // `findMany`. Sin esto, un `count` colocado fuera del bucle contaria ordenes de distritos que
    // este guardado no puede reubicar.
    const tx = txConNM(
      ["d1"],
      [
        { distritoId: "d1", zonaId: "zA" },
        { distritoId: "d1", zonaId: "zB" },
      ],
    );
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update("zA", DATOS_ZONA_A, "u-maestro");

    expect(tx.orden.count).not.toHaveBeenCalled();
    expect(soloOk(res).ordenesRetenidasEnBodegaSatelite).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 376 / T6-T8 — LA GUARDA Y EL RASTRO DE LA MARCA DE ZONA CENTRAL, EN FORMA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LO QUE ESTE BLOQUE **NO** PRUEBA, Y ESTA DICHO A PROPOSITO:
//   · que `esCentral: undefined` NO ESCRIBA la columna (R1). Con un doble, `data.esCentral` llega
//     como `undefined` y el doble no escribe nada de nada: la propiedad es de Prisma, no de este
//     codigo, y un test con dobles la daria por buena aunque no existiera. Se mide contra Postgres
//     real en `tests/integration/db/zona-central-guarda-y-rastro.test.ts`.
//   · la ATOMICIDAD del `appendAccion` con la mutacion (R17). Con un doble, `tx` y `this.prisma`
//     son el mismo objeto. Lo mide la guardia estatica
//     `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` y el caso de
//     savepoint del archivo de integracion.
// Lo que SI se mide aqui es la FORMA: cuantas entradas, con que valores, con que lote y en que
// orden respecto de las escrituras.

/** Las filas que `appendAccion` mando a `historialAccion.createMany` en la llamada `n`. */
function filasDeHistorial(tx: ReturnType<typeof buildTx>, n = 0): Record<string, unknown>[] {
  const args = tx.historialAccion.createMany.mock.calls[n]?.[0] as
    | { data: Record<string, unknown>[] }
    | undefined;
  if (args === undefined) throw new Error(`no hubo una llamada ${n} a historialAccion.createMany`);
  return args.data;
}

const DATOS_BASE = { nombre: "B", cobroVehiculo: false, distritoIds: ["d1"], tarifas: [] };

describe("376/T6 — la guarda de `update` (R5) y el desenlace nombrado", () => {
  it("⭑ R5: `esCentral: false` sobre la zona QUE ES la central -> `sin_zona_central`, sin escribir NADA", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "zA", esCentral: true });
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update("zA", { ...DATOS_BASE, esCentral: false }, "u-maestro");

    expect(res).toEqual({ estado: "sin_zona_central" });
    // R5: el rechazo sale ANTES de la primera escritura. Ninguna de las cuatro ocurre.
    expect(tx.zona.update).not.toHaveBeenCalled();
    expect(tx.zona.updateMany).not.toHaveBeenCalled();
    expect(tx.zonaDistrito.deleteMany).not.toHaveBeenCalled();
    expect(tx.tarifaZonaMensajero.deleteMany).not.toHaveBeenCalled();
    // R19: y no deja ninguna fila de historial.
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("⭑ R8: `esCentral: false` sobre una zona que NO es la central se acepta", async () => {
    // La guarda es «no quedarse sin», no «la marca no se apaga nunca». Sin este caso, quitar el
    // `&& exists.esCentral` de la condicion pasaria desapercibido.
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "zB", esCentral: false });
    tx.zona.update.mockResolvedValue({
      id: "zB",
      nombre: "B",
      cobroVehiculo: false,
      esCentral: false,
    });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update("zB", { ...DATOS_BASE, esCentral: false }, "u-maestro");

    expect(soloOk(res).zona.esCentral).toBe(false);
    expect(tx.zona.update).toHaveBeenCalled();
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled(); // R18: no cambio nada
  });

  it("⭑ R1/R3: el campo AUSENTE no dispara la guarda ni el rastro, ni siquiera en la central", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "zA", esCentral: true });
    tx.zona.update.mockResolvedValue({
      id: "zA",
      nombre: "B",
      cobroVehiculo: false,
      esCentral: true,
    });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    const res = await repoOf(prisma).update("zA", DATOS_BASE, "u-maestro");

    expect(res.estado).toBe("ok");
    // El `data` del update lleva `esCentral: undefined`: es lo que Prisma lee como «no provisto».
    // Que eso NO escriba la columna es cosa de Prisma y se mide contra Postgres (ver cabecera).
    expect(tx.zona.update.mock.calls[0][0].data).toEqual({
      nombre: "B",
      cobroVehiculo: false,
      esCentral: undefined,
    });
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled(); // R18
  });

  it("R18: reenviar `esCentral: true` en la zona que YA es la central no deja fila", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "zA", esCentral: true });
    tx.zona.update.mockResolvedValue({
      id: "zA",
      nombre: "B",
      cobroVehiculo: false,
      esCentral: true,
    });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    const prisma = buildPrisma(tx);

    await repoOf(prisma).update("zA", { ...DATOS_BASE, esCentral: true }, "u-maestro");

    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
    // Y tampoco se molesta en preguntar por la central previa: no la hay que apagar.
    expect(tx.zona.findFirst).not.toHaveBeenCalled();
  });
});

describe("376/T6 — el rastro de `update` (R12/R13/R15)", () => {
  /** A es la central; B la gana. Deja el doble listo para el traslado. */
  function txDeTraslado(): ReturnType<typeof buildTx> {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "zB", esCentral: false });
    tx.zona.findFirst.mockResolvedValue({ id: "zA", nombre: "GAM" });
    tx.zona.update.mockResolvedValue({
      id: "zB",
      nombre: "B",
      cobroVehiculo: false,
      esCentral: true,
    });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    return tx;
  }

  it("⭑ R12: un traslado escribe DOS entradas — la que PIERDE la marca y la que la gana", async () => {
    const tx = txDeTraslado();
    await repoOf(buildPrisma(tx)).update("zB", { ...DATOS_BASE, esCentral: true }, "u-maestro");

    const filas = filasDeHistorial(tx);
    expect(filas).toHaveLength(2);
    // La PRIMERA es la zona que nadie nombro en el payload: es la fila que hoy no existe.
    expect(filas[0]).toMatchObject({
      accion: "zona_central_cambiada",
      entidadTipo: "zona",
      entidadId: "zA",
      entidadEtiqueta: "GAM",
      valorAnterior: "true",
      valorNuevo: "false",
    });
    expect(filas[1]).toMatchObject({
      accion: "zona_central_cambiada",
      entidadTipo: "zona",
      entidadId: "zB",
      entidadEtiqueta: "B",
      valorAnterior: "false",
      valorNuevo: "true",
    });
  });

  it("⭑ R13: la fila congela al actor y NO lleva monto", async () => {
    const tx = txDeTraslado();
    await repoOf(buildPrisma(tx)).update("zB", { ...DATOS_BASE, esCentral: true }, "u-maestro");

    for (const fila of filasDeHistorial(tx)) {
      expect(fila.actorUsuarioId).toBe("u-maestro");
      expect(fila.actorNombre).toBe("Maestra Uno");
      expect(fila.actorRol).toBe("maestro");
      expect(fila.monto).toBeNull();
    }
  });

  it("⭑ R15: las dos filas comparten `lote_id`", async () => {
    const tx = txDeTraslado();
    await repoOf(buildPrisma(tx)).update("zB", { ...DATOS_BASE, esCentral: true }, "u-maestro");

    const lotes = new Set(filasDeHistorial(tx).map((f) => f.loteId));
    expect(lotes.size, "un traslado es UN acto de dos efectos, no dos actos sueltos").toBe(1);
    expect([...lotes][0]).toBeTypeOf("string");
  });

  it("⭑ R12: la central previa se lee ANTES del `updateMany` que la apaga", async () => {
    // Si se leyera despues, `findFirst` no encontraria nada y la zona que PIERDE la marca se
    // quedaria sin fila: justo el agujero que la ficha viene a tapar.
    const tx = txDeTraslado();
    await repoOf(buildPrisma(tx)).update("zB", { ...DATOS_BASE, esCentral: true }, "u-maestro");

    expect(tx.zona.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.zona.updateMany.mock.invocationCallOrder[0],
    );
    // Y el registro va DESPUES de las escrituras.
    expect(tx.historialAccion.createMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.zona.update.mock.invocationCallOrder[0],
    );
  });

  it("R8: si no habia ninguna central, se escribe UNA sola fila (la que la gana)", async () => {
    const tx = txDeTraslado();
    tx.zona.findFirst.mockResolvedValue(null); // base sin central
    await repoOf(buildPrisma(tx)).update("zB", { ...DATOS_BASE, esCentral: true }, "u-maestro");

    const filas = filasDeHistorial(tx);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entidadId: "zB", valorAnterior: "false", valorNuevo: "true" });
  });

  it("⭑ design §7.1: el lote del cambio de marca es DISTINTO del de la reconciliacion de la 366", async () => {
    // Dos hechos de naturaleza distinta en el MISMO guardado. Compartir lote haria que filtrar por
    // lote devolviera una mezcla que nadie pidio.
    const tx = txDeTraslado();
    tx.zonaDistrito.findMany
      .mockReset()
      .mockResolvedValueOnce([{ distritoId: "d1" }])
      .mockResolvedValueOnce([{ distritoId: "d1", zonaId: "zB" }]);
    tx.orden.findMany.mockResolvedValue([{ id: "o1", numGuia: 7, numRemision: "R-7" }]);

    await repoOf(buildPrisma(tx)).update("zB", { ...DATOS_BASE, esCentral: true }, "u-maestro");

    expect(tx.historialAccion.createMany).toHaveBeenCalledTimes(2);
    const loteReconciliacion = filasDeHistorial(tx, 0)[0].loteId;
    const loteMarca = filasDeHistorial(tx, 1)[0].loteId;
    expect(filasDeHistorial(tx, 0)[0].accion).toBe("orden_zona_reconciliada");
    expect(filasDeHistorial(tx, 1)[0].accion).toBe("zona_central_cambiada");
    expect(loteMarca).not.toBe(loteReconciliacion);
  });
});

describe("376/T7 — el rastro de `create`", () => {
  function txDeCreacion(): ReturnType<typeof buildTx> {
    const tx = buildTx();
    tx.zona.findFirst.mockResolvedValue({ id: "zA", nombre: "GAM" });
    tx.zona.create.mockResolvedValue({
      id: "zNueva",
      nombre: "NUEVA",
      cobroVehiculo: false,
      esCentral: true,
    });
    tx.tarifaZonaMensajero.findMany.mockResolvedValue([]);
    return tx;
  }

  it("⭑ R12: crear CON la marca habiendo otra central escribe DOS filas con el mismo lote", async () => {
    const tx = txDeCreacion();
    await repoOf(buildPrisma(tx)).create(
      { ...DATOS_BASE, nombre: "NUEVA", esCentral: true },
      "u-maestro",
    );

    const filas = filasDeHistorial(tx);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ entidadId: "zA", valorAnterior: "true", valorNuevo: "false" });
    expect(filas[1]).toMatchObject({
      entidadId: "zNueva",
      valorAnterior: "false",
      valorNuevo: "true",
    });
    expect(new Set(filas.map((f) => f.loteId)).size).toBe(1);
    // Y la central previa se leyo ANTES de apagarla.
    expect(tx.zona.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.zona.updateMany.mock.invocationCallOrder[0],
    );
  });

  it("R18: crear SIN la marca no escribe ninguna fila ni pregunta por la central previa", async () => {
    const tx = txDeCreacion();
    tx.zona.create.mockResolvedValue({
      id: "zNueva",
      nombre: "NUEVA",
      cobroVehiculo: false,
      esCentral: false,
    });

    await repoOf(buildPrisma(tx)).create(
      { ...DATOS_BASE, nombre: "NUEVA", esCentral: false },
      "u-maestro",
    );

    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
    expect(tx.zona.findFirst).not.toHaveBeenCalled();
    expect(tx.zona.updateMany).not.toHaveBeenCalled();
  });
});

describe("376/T8 — `hardDelete` rechaza la zona central con motivo propio (R10/R11)", () => {
  it("⭑ R10: la zona central NO se borra, y el rechazo sale antes del primer `deleteMany`", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "zA", nombre: "GAM", esCentral: true });
    const prisma = buildPrisma(tx);

    expect(await repoOf(prisma).hardDelete("zA", "u-maestro")).toBe("es_central");

    expect(tx.tarifaZonaMensajero.deleteMany).not.toHaveBeenCalled();
    expect(tx.zonaDistrito.deleteMany).not.toHaveBeenCalled();
    expect(tx.zona.delete).not.toHaveBeenCalled();
    // R19: un borrado rechazado no deja fila de `zona_borrada`.
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("R11: una zona NO central se sigue borrando y registrando igual que antes", async () => {
    // El control positivo. Sin el, un `return "es_central"` incondicional pasaria el caso de arriba.
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "zB", nombre: "Sur", esCentral: false });
    const prisma = buildPrisma(tx);

    expect(await repoOf(prisma).hardDelete("zB", "u-maestro")).toBe("ok");
    expect(tx.zona.delete).toHaveBeenCalledWith({ where: { id: "zB" } });
    expect(filasDeHistorial(tx)[0]).toMatchObject({
      accion: "zona_borrada",
      entidadId: "zB",
      entidadEtiqueta: "Sur",
    });
  });
});

describe("376/Q4 — `contarOrdenesVivasPorZona`", () => {
  it("devuelve una entrada por zona PEDIDA, con cero para las que no traen filas", async () => {
    const groupBy = vi.fn().mockResolvedValue([{ zonaId: "zA", _count: { _all: 850 } }]);
    const prisma = buildPrisma(buildTx(), { orden: { groupBy } });

    const r = await repoOf(prisma).contarOrdenesVivasPorZona(["zA", "zB"]);

    expect(r).toEqual([
      { zonaId: "zA", ordenesVivas: 850 },
      { zonaId: "zB", ordenesVivas: 0 },
    ]);
  });

  it("⭑ el corte excluye borradas y ya congeladas en un cierre, y va en el `where`", async () => {
    // El `where` se afirma aqui por FORMA; que Postgres lo aplique se mide en integracion.
    const groupBy = vi.fn().mockResolvedValue([]);
    const prisma = buildPrisma(buildTx(), { orden: { groupBy } });

    await repoOf(prisma).contarOrdenesVivasPorZona(["zA", "zA", "zB"]);

    expect(groupBy.mock.calls[0][0].where).toEqual({
      zonaId: { in: ["zA", "zB"] }, // deduplicado
      deletedAt: null,
      cierreDetalles: { none: {} },
    });
  });

  it("lista vacia: ni consulta", async () => {
    const groupBy = vi.fn();
    const prisma = buildPrisma(buildTx(), { orden: { groupBy } });
    expect(await repoOf(prisma).contarOrdenesVivasPorZona([])).toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
