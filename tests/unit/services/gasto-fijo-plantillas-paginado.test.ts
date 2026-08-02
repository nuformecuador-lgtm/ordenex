import { describe, it, expect, vi } from "vitest";
import { GastoFijoPlantillaService } from "@/lib/services/GastoFijoPlantillaService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { listarPlantillasGastoFijoPaginadoSchema } from "@/lib/types/gasto-fijo-plantilla";

// Feature 170 — FASE 2, T I.1 (R40/R41/R44/R51/R54) — «Plantillas de gasto fijo» paginado.
//
// Es el listado mas pequeno de los siete (design §11.3: «un punado de filas, se pagina por
// uniformidad»), y aun asi tiene el mismo acotamiento duro: son las plantillas que generan
// EGRESOS de la caja, y las ve el acceso total o nadie.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function plantilla(id: string, dia: number, activa = true): GastoFijoPlantillaDTO {
  return {
    id,
    concepto: `Concepto ${id}`,
    monto: "1000.00",
    activa,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-06-01",
    createdAt: `2026-06-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: `2026-06-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
  };
}

/** Activas e INACTIVAS: R26 dice que el listado las trae todas, y paginar no puede cambiarlo. */
const ALMACEN: GastoFijoPlantillaDTO[] = [
  plantilla("p-1", 1),
  plantilla("p-2", 2, false),
  plantilla("p-3", 3),
  plantilla("p-4", 4, false),
  plantilla("p-5", 5),
];

function porCreadoDesc(a: GastoFijoPlantillaDTO, b: GastoFijoPlantillaDTO): number {
  return b.createdAt.localeCompare(a.createdAt);
}

function repoEnMemoria(filas: GastoFijoPlantillaDTO[] = ALMACEN) {
  const llamadas: string[] = [];

  const listar = vi.fn(async () => {
    llamadas.push("listar");
    return [...filas].sort(porCreadoDesc);
  });

  const listarPaginado = vi.fn(async (rango: RangoPagina) => {
    llamadas.push("listarPaginado");
    const conjunto = [...filas].sort(porCreadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const repo = {
    listar,
    listarPaginado,
    listarActivas: vi.fn(async () => filas.filter((p) => p.activa)),
    obtenerPorId: vi.fn(async () => null),
    crear: vi.fn(),
    actualizar: vi.fn(),
    setActiva: vi.fn(),
  } as unknown as IGastoFijoPlantillaRepository;

  return { repo, llamadas, listarPaginado };
}

function servicio(repo: IGastoFijoPlantillaRepository) {
  return new GastoFijoPlantillaService(repo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarPlantillasGastoFijoPaginadoSchema.parse(extra);
}

function ids(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((p) => p.id);
}

describe("GastoFijoPlantillaService.listarPlantillasPaginado", () => {
  it("devuelve la pagina pedida y el total del conjunto (R40, R41)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const p1 = await svc.listarPlantillasPaginado(input({ page: 1, pageSize: 2 }), MAESTRO);
    const p2 = await svc.listarPlantillasPaginado(input({ page: 2, pageSize: 2 }), MAESTRO);
    const p3 = await svc.listarPlantillasPaginado(input({ page: 3, pageSize: 2 }), MAESTRO);

    if (p1.status !== "ok" || p2.status !== "ok" || p3.status !== "ok") throw new Error("no ok");

    expect(ids(p1.items)).toEqual(["p-5", "p-4"]);
    expect(ids(p2.items)).toEqual(["p-3", "p-2"]);
    expect(ids(p3.items)).toEqual(["p-1"]);

    for (const p of [p1, p2, p3]) expect(p.total).toBe(5); // R41: el del CONJUNTO
    expect(p3.total).not.toBe(p3.items.length);
  });

  it("acota el tamano de pagina al maximo configurado y nunca lo excede (R40)", async () => {
    const r = await servicio(repoEnMemoria().repo).listarPlantillasPaginado(
      input({ pageSize: 100000 }),
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.pageSize).toBe(100); // gastoFijoConfig.MAX_PAGE_SIZE
  });

  it("el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const svc = servicio(repoEnMemoria().repo);
      const sinPaginar = await svc.listarPlantillas(actor);
      if (sinPaginar.status !== "ok") throw new Error("no ok");

      const recorrido: string[] = [];
      let total = -1;
      for (let page = 1; page <= 10; page += 1) {
        const p = await svc.listarPlantillasPaginado(input({ page, pageSize: 2 }), actor);
        if (p.status !== "ok") throw new Error("no ok");
        total = p.total;
        if (p.items.length === 0) break;
        recorrido.push(...ids(p.items));
      }

      expect(recorrido, `rol ${actor.rol}`).toEqual(ids(sinPaginar.plantillas));
      expect(total, `rol ${actor.rol}`).toBe(sinPaginar.plantillas.length);
      // R26: las INACTIVAS siguen estando. Paginar no puede convertir este listado en el del
      // cron (`listarActivas`), que es otro conjunto.
      expect(recorrido).toContain("p-2");
      expect(recorrido).toContain("p-4");
    }
  });

  it("CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol sin acceso total", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarPlantillasPaginado(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      expect(llamadas, `rol ${actor.rol}`).toEqual([]); // el guard va ANTES de la base
    }

    // El otro lado, sin el cual lo de arriba pasaria con un servicio mudo.
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await servicio(repoEnMemoria().repo).listarPlantillasPaginado(
        input({ pageSize: 50 }),
        actor,
      );
      if (r.status !== "ok") throw new Error("no ok");
      expect(ids(r.items), `rol ${actor.rol}`).toEqual(["p-5", "p-4", "p-3", "p-2", "p-1"]);
    }
  });

  it("conserva el criterio de ordenacion actual: createdAt descendente (R51)", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const r = await svc.listarPlantillasPaginado(input({ pageSize: 50 }), MAESTRO);
    const sinPaginar = await svc.listarPlantillas(MAESTRO);

    if (r.status !== "ok" || sinPaginar.status !== "ok") throw new Error("no ok");
    const fechas = r.items.map((p) => p.createdAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
    expect(ids(r.items)).toEqual(ids(sinPaginar.plantillas));
  });

  it("no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)", async () => {
    const sinPaginar = repoEnMemoria();
    await servicio(sinPaginar.repo).listarPlantillas(MAESTRO);
    expect(sinPaginar.llamadas).toEqual(["listar"]);

    const paginado = repoEnMemoria();
    await servicio(paginado.repo).listarPlantillasPaginado(input({ pageSize: 2 }), MAESTRO);
    expect(paginado.llamadas).toEqual(["listarPaginado"]);
    expect(paginado.llamadas.length).toBeLessThanOrEqual(sinPaginar.llamadas.length);

    await expect(paginado.listarPaginado.mock.results[0]!.value).resolves.toMatchObject({ total: 5 });

    const grande = repoEnMemoria();
    await servicio(grande.repo).listarPlantillasPaginado(input({ pageSize: 100 }), MAESTRO);
    expect(grande.llamadas).toEqual(["listarPaginado"]);
  });
});
