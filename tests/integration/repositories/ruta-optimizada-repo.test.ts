import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { RutaOptimizadaRepository } from "@/lib/repositories/RutaOptimizadaRepository";

// Feature 92 (R23/R26/R27) — repositorio de la ruta optimizada con Prisma mockeado
// (patron del resto de tests/integration/repositories: la suite NO levanta Postgres). El
// `$transaction` fake respeta la semantica que importa: si el callback LANZA, nada de lo
// hecho dentro cuenta.
//
// Las invariantes de UNICIDAD `(ruta_id, orden_id)` y `(ruta_id, secuencia)` las garantiza
// la DB; aqui se verifica que el repo no puede EMITIR una secuencia que las viole (misma
// orden dos veces, o dos posiciones iguales) y que el reemplazo BORRA antes de insertar
// —sin ese DELETE previo, reordenar chocaria contra el indice `(ruta_id, secuencia)`.

const MENSAJERO = "m-1";
const T0 = new Date("2026-07-20T12:00:00.000Z");

function buildPrisma(over: { rutaExistente?: unknown } = {}) {
  const upsert = vi.fn<(args: unknown) => Promise<{ id: string }>>(async () => ({ id: "ruta-1" }));
  const findUnique = vi.fn(async () => over.rutaExistente ?? null);
  const deleteMany = vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 3 }));
  const createMany = vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 0 }));
  const orden: string[] = [];

  const tx = {
    rutaOptimizada: {
      upsert: vi.fn(async (args: unknown) => {
        orden.push("upsert-cabecera");
        return upsert(args);
      }),
    },
    rutaOptimizadaParada: {
      deleteMany: vi.fn(async (args: unknown) => {
        orden.push("delete-paradas");
        return deleteMany(args);
      }),
      createMany: vi.fn(async (args: unknown) => {
        orden.push("create-paradas");
        return createMany(args);
      }),
    },
  };

  const prisma = {
    rutaOptimizada: { findUnique, upsert },
    rutaOptimizadaParada: { deleteMany, createMany },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)),
  };
  return { prisma, tx, findUnique, upsert, orden };
}

function repoDe(prisma: unknown) {
  return new RutaOptimizadaRepository(prisma as unknown as PrismaClient);
}

describe("R26 — findByMensajero proyecta la cabecera y el mapa de posiciones", () => {
  it("devuelve secuenciaPorOrden como Map y los Decimal como number", async () => {
    const { prisma } = buildPrisma({
      rutaExistente: {
        id: "ruta-1",
        mensajeroId: MENSAJERO,
        estado: "vigente",
        calculadaAt: T0,
        origenLat: new Prisma.Decimal("9.9281000"),
        origenLng: new Prisma.Decimal("-84.0907000"),
        origenAt: T0,
        origenFuente: "gps",
        huellaSet: "h",
        ultimoError: null,
        paradas: [
          { ordenId: "o1", secuencia: 1 },
          { ordenId: "o2", secuencia: 2 },
        ],
      },
    });

    const ruta = await repoDe(prisma).findByMensajero(MENSAJERO);

    expect(ruta?.origenLat).toBe(9.9281);
    expect(ruta?.origenLng).toBe(-84.0907);
    expect(ruta?.origenFuente).toBe("gps");
    expect(ruta?.secuenciaPorOrden.get("o1")).toBe(1);
    expect(ruta?.secuenciaPorOrden.get("o2")).toBe(2);
    expect(ruta?.secuenciaPorOrden.get("desconocida")).toBeUndefined();
  });

  it("sin ruta -> null (no una ruta vacia sintetica)", async () => {
    const { prisma } = buildPrisma();
    expect(await repoDe(prisma).findByMensajero(MENSAJERO)).toBeNull();
  });
});

describe("R23 — upsertOrigen persiste la ubicacion con su fuente e instante", () => {
  it("crea la cabecera si no existia, sin tocar calculada_at ni las paradas", async () => {
    const { prisma, upsert, tx } = buildPrisma();

    await repoDe(prisma).upsertOrigen(MENSAJERO, {
      lat: 9.9281,
      lng: -84.0907,
      capturadaAt: T0,
      fuente: "gps",
    });

    const args = upsert.mock.calls[0][0] as unknown as {
      where: { mensajeroId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where.mensajeroId).toBe(MENSAJERO);
    expect(args.create.origenFuente).toBe("gps");
    expect(args.create.origenAt).toBe(T0);
    expect(String(args.create.origenLat)).toBe("9.9281");
    // Capturar una posicion NO invalida el orden ya calculado.
    expect(args.update).not.toHaveProperty("calculadaAt");
    expect(args.update).not.toHaveProperty("estado");
    expect(tx.rutaOptimizadaParada.deleteMany).not.toHaveBeenCalled();
  });
});

describe("R26 — reemplazarSecuencia es ATOMICO y no puede violar los indices unicos", () => {
  it("abre UNA transaccion y hace upsert cabecera -> DELETE paradas -> createMany", async () => {
    const { prisma, tx, orden } = buildPrisma();

    await repoDe(prisma).reemplazarSecuencia(MENSAJERO, ["o3", "o1", "o2"], {
      calculadaAt: T0,
      origen: { lat: 9.93, lng: -84.09, fuente: "gps" },
      huellaSet: "huella-1",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // El DELETE va ANTES del insert: sin el, reordenar chocaria contra el indice unico
    // `(ruta_id, secuencia)` en cuanto una posicion ya existiera.
    expect(orden).toEqual(["upsert-cabecera", "delete-paradas", "create-paradas"]);
    expect(tx.rutaOptimizadaParada.deleteMany.mock.calls[0][0]).toEqual({
      where: { rutaId: "ruta-1" },
    });
  });

  it("las posiciones son 1-based, consecutivas, sin huecos ni repeticiones", async () => {
    const { prisma, tx } = buildPrisma();

    await repoDe(prisma).reemplazarSecuencia(MENSAJERO, ["o3", "o1", "o2"], {
      calculadaAt: T0,
      origen: { lat: 9.93, lng: -84.09, fuente: "centroide" },
      huellaSet: "h",
    });

    const { data } = tx.rutaOptimizadaParada.createMany.mock.calls[0][0] as unknown as {
      data: { rutaId: string; ordenId: string; secuencia: number }[];
    };
    expect(data).toEqual([
      { rutaId: "ruta-1", ordenId: "o3", secuencia: 1 },
      { rutaId: "ruta-1", ordenId: "o1", secuencia: 2 },
      { rutaId: "ruta-1", ordenId: "o2", secuencia: 3 },
    ]);
    // Invariantes que los dos indices unicos de la DB tambien impondrian.
    expect(new Set(data.map((d) => d.secuencia)).size).toBe(data.length);
    expect(new Set(data.map((d) => d.ordenId)).size).toBe(data.length);
  });

  it("una optimizacion exitosa deja la ruta `vigente` y LIMPIA el ultimoError anterior", async () => {
    // Si no se limpiara, un fallo viejo seguiria alimentando el aviso de la UI para siempre.
    const { prisma, tx } = buildPrisma();

    await repoDe(prisma).reemplazarSecuencia(MENSAJERO, ["o1"], {
      calculadaAt: T0,
      origen: { lat: 9.93, lng: -84.09, fuente: "gps" },
      huellaSet: "h",
    });

    const args = tx.rutaOptimizada.upsert.mock.calls[0][0] as unknown as {
      update: Record<string, unknown>;
    };
    expect(args.update.estado).toBe("vigente");
    expect(args.update.ultimoError).toBeNull();
    expect(args.update.huellaSet).toBe("h");
  });

  it("secuencia VACIA -> borra las paradas y NO llama a createMany", async () => {
    const { prisma, tx } = buildPrisma();

    await repoDe(prisma).reemplazarSecuencia(MENSAJERO, [], {
      calculadaAt: T0,
      origen: null,
      huellaSet: "h",
    });

    expect(tx.rutaOptimizadaParada.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.rutaOptimizadaParada.createMany).not.toHaveBeenCalled();
    const args = tx.rutaOptimizada.upsert.mock.calls[0][0] as unknown as {
      update: Record<string, unknown>;
    };
    expect(args.update.origenLat).toBeNull();
    expect(args.update.origenFuente).toBeNull();
  });

  it("si la transaccion revienta, la escritura no queda a medias (propaga el error)", async () => {
    const { prisma, tx } = buildPrisma();
    tx.rutaOptimizadaParada.createMany.mockRejectedValue(new Error("boom"));

    await expect(
      repoDe(prisma).reemplazarSecuencia(MENSAJERO, ["o1"], {
        calculadaAt: T0,
        origen: { lat: 9.93, lng: -84.09, fuente: "gps" },
        huellaSet: "h",
      }),
    ).rejects.toThrow("boom");
  });
});

describe("R27 — marcarDesactualizada NUNCA toca las paradas", () => {
  it("actualiza SOLO la cabecera: el ultimo orden valido se conserva intacto", async () => {
    const { prisma, upsert } = buildPrisma();

    await repoDe(prisma).marcarDesactualizada(MENSAJERO, "optimizar ruta: HTTP 503");

    expect(prisma.rutaOptimizadaParada.deleteMany).not.toHaveBeenCalled();
    expect(prisma.rutaOptimizadaParada.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const args = upsert.mock.calls[0][0] as unknown as { update: Record<string, unknown> };
    expect(args.update).toEqual({
      estado: "desactualizada",
      ultimoError: "optimizar ruta: HTTP 503",
    });
  });

  it("crea la cabecera si no existia (un fallo en la 1.a optimizacion tambien se registra)", async () => {
    const { prisma, upsert } = buildPrisma();
    await repoDe(prisma).marcarDesactualizada(MENSAJERO, "d");
    const args = upsert.mock.calls[0][0] as unknown as { create: Record<string, unknown> };
    expect(args.create).toEqual({
      mensajeroId: MENSAJERO,
      estado: "desactualizada",
      ultimoError: "d",
    });
  });
});
