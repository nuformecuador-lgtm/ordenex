import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";

// Feature 36 — repositorio con Prisma mockeado (sin DB). Cubre el filtrado por
// mensajero (R9/R13), la guardia origen+propiedad de recogerLote (R15) y la
// transaccion INSERT+UPDATE+limpiar puntero de crearGestionYTransicionar
// (R23/R26/R28/R30).

function fakeAsignacionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    numGuia: 5,
    numRemision: "R-1",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle 1",
    producto: "caja",
    montoCobrar: new Prisma.Decimal(100),
    notas: null,
    mensajeroAsignadoId: "m1",
    estatus: { value: "en_espera_aceptacion" },
    tienda: { nombre: "Tienda X" },
    zona: { nombre: "Centro" },
    provincia: { nombre: "Pichincha" },
    canton: { nombre: "Quito" },
    distrito: { nombre: "Centro Historico" },
    ...overrides,
  };
}

describe("GestionOrdenRepository.findMisAsignaciones (R9/R13)", () => {
  it("R13: filtra por mensajero_asignado_id + no borradas + estados, en el WHERE", async () => {
    const findMany = vi.fn(async () => [fakeAsignacionRow()]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["en_espera_aceptacion", "en_reparto"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = (findMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.where.estatus).toEqual({ value: { in: ["en_espera_aceptacion", "en_reparto"] } });
    // Proyeccion: nombres legibles + montoCobrar como number.
    expect(rows[0].tiendaNombre).toBe("Tienda X");
    expect(rows[0].montoCobrar).toBe(100);
    expect(rows[0].estatusValue).toBe("en_espera_aceptacion");
  });

  it("R9: estados vacios -> no consulta y devuelve []", async () => {
    const findMany = vi.fn();
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);
    expect(await repo.findMisAsignaciones("m1", [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("GestionOrdenRepository.recogerLote (R15)", () => {
  it("guardia propiedad + origen en el WHERE; devuelve filas afectadas", async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const repo = new GestionOrdenRepository({ orden: { updateMany } } as never);

    const n = await repo.recogerLote(["o1", "o2"], "m1", "os-espera", "os-reparto");

    expect(n).toBe(2);
    const arg = (updateMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where.mensajeroAsignadoId).toBe("m1"); // propiedad
    expect(arg.where.estatusId).toBe("os-espera"); // origen
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.data.estatusId).toBe("os-reparto"); // destino en_reparto
  });

  it("lista vacia -> no consulta y devuelve 0", async () => {
    const updateMany = vi.fn();
    const repo = new GestionOrdenRepository({ orden: { updateMany } } as never);
    expect(await repo.recogerLote([], "m1", "a", "b")).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("GestionOrdenRepository.setOrdenEnGestion (R19-R21)", () => {
  it("fija el puntero cuando estaba libre (count>0 -> true)", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn();
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(true);
    const arg = (updateMany.mock.calls[0] as unknown[])[0] as { where: { OR: unknown } };
    expect(arg.where.OR).toEqual([{ ordenEnGestionId: null }, { ordenEnGestionId: "o1" }]);
  });

  it("R21: con OTRA orden activa (count 0 y puntero distinto) -> false", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => ({ ordenEnGestionId: "o-otra" }));
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(false);
  });

  it("idempotente: count 0 pero ya apuntaba a la misma orden -> true", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => ({ ordenEnGestionId: "o1" }));
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(true);
  });
});

describe("GestionOrdenRepository.crearGestionYTransicionar (R23/R26/R28/R30)", () => {
  function buildTxRepo() {
    const gestionCreate = vi.fn(async () => ({ id: "g1" }));
    const ordenUpdate = vi.fn(async () => ({}));
    const usuarioUpdate = vi.fn(async () => ({}));
    const tx = {
      gestionOrden: { create: gestionCreate },
      orden: { update: ordenUpdate },
      usuario: { update: usuarioUpdate },
    };
    const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<string>) => cb(tx));
    const repo = new GestionOrdenRepository({ $transaction } as never);
    return { repo, gestionCreate, ordenUpdate, usuarioUpdate };
  }

  it("INSERT gestion + UPDATE estatus + limpiar puntero, todo bajo la misma tx", async () => {
    const { repo, gestionCreate, ordenUpdate, usuarioUpdate } = buildTxRepo();

    const id = await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "entregada",
        montoRecibido: 100,
        metodoPago: "efectivo",
        evidenciaStoragePath: "o1/entregada-1.jpg",
        evidenciaContentType: "image/jpeg",
      },
      nuevoEstatusId: "os-entregada",
    });

    expect(id).toBe("g1");
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.resultado).toBe("entregada");
    expect(gArg.data.evidenciaStoragePath).toBe("o1/entregada-1.jpg");
    expect((gArg.data.montoRecibido as Prisma.Decimal).toString()).toBe("100");
    expect((ordenUpdate.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: "o1" },
      data: { estatusId: "os-entregada" },
    });
    // R19: libera el puntero de bloqueo dentro de la transaccion.
    expect((usuarioUpdate.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: "m1" },
      data: { ordenEnGestionId: null },
    });
  });

  it("R26: reprogramada persiste fecha (DATE) y motivo, sin evidencia", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionYTransicionar({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
      nuevoEstatusId: "os-reprogramada",
    });
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.fechaReprogramacion).toBeInstanceOf(Date);
    expect(gArg.data.evidenciaStoragePath).toBeNull();
    expect(gArg.data.montoRecibido).toBeNull();
  });
});
