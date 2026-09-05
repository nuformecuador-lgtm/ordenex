import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";

// tx mock que reciben las operaciones dentro de $transaction.
function buildTx() {
  return {
    zona: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    // FICHA 366: `findMany` por defecto NO devuelve nada, asi que ningun distrito resuelve una
    // zona y el flujo de reconciliacion no se dispara en los casos que no lo miden.
    zonaDistrito: { createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    orden: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
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
    });

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
    });

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
    });

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
    });

    expect(tx.zona.updateMany).not.toHaveBeenCalled();
  });

  it("update con esCentral=true desmarca cualquier OTRA central (NOT id propio) antes de actualizar", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
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
    expect(res?.zona.esCentral).toBe(true);
  });

  it("update con esCentral=false NO desmarca ninguna central", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
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
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("update: P2002 sobre es_central se traduce a ConflictError", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
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
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("adapter: update con P2002 de es_central (sin meta.target) -> ConflictError", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
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
      }),
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
      }),
    ).rejects.toBe(original);
  });
});

describe("ZonaRepository.hardDelete", () => {
  it("borra tarifas + N:M + zona y devuelve ok", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
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
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
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
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
    tx.zona.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "x" }),
    );
    const prisma = buildPrisma(tx);
    expect(await repoOf(prisma).hardDelete("z1", "actor-1")).toBe("referenced");
  });

  it("un SQLSTATE del adapter que NO es de FK se propaga (no se disfraza de `referenced`)", async () => {
    // `40001` es un fallo de serializacion: reintentable, y desde luego no «esta en uso».
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue({ id: "z1" });
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
  tx.zona.findUnique.mockResolvedValue({ id: "zA" });
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
    expect(res?.ordenesReconciliadas).toBe(2);
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

    expect(res?.ordenesReconciliadas).toBe(4);
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
    expect(res?.ordenesReconciliadas).toBe(0);
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
    expect(res?.ordenesReconciliadas).toBe(0);
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

    await repoOf(prisma).create({ ...DATOS_ZONA_A, nombre: "NUEVA" });

    expect(tx.zonaDistrito.findMany).not.toHaveBeenCalled();
    expect(tx.orden.findMany).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.historialAccion.createMany).not.toHaveBeenCalled();
  });

  it("la zona que no existe sigue devolviendo `null` y no reconcilia nada", async () => {
    const tx = buildTx();
    tx.zona.findUnique.mockResolvedValue(null);
    const prisma = buildPrisma(tx);

    expect(await repoOf(prisma).update("zX", DATOS_ZONA_A, "u-maestro")).toBeNull();
    expect(tx.zonaDistrito.findMany).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
  });
});
