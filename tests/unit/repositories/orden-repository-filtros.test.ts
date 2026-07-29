import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { ListOrdenesWhere } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 144/B1 (R33-R35, R44) — traduccion del `where` del service al `where` Prisma.
//
// Prisma va mockeado: lo que se afirma es el OBJETO que llega a `findMany`/`count`. Dos
// invariantes duros: (i) `count` usa EXACTAMENTE el mismo `where` que la pagina (si no,
// la paginacion miente sobre el filtro aplicado); (ii) una clave presente jamas se
// convierte en "sin filtro".

function buildPrisma() {
  return {
    orden: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

async function whereDe(where: ListOrdenesWhere) {
  const prisma = buildPrisma();
  const repo = new OrdenRepository(prisma as unknown as PrismaClient);
  await repo.list({ where, sortBy: "created_at", sortDir: "desc", skip: 0, take: 20 });
  return {
    findMany: prisma.orden.findMany.mock.calls[0][0].where,
    count: prisma.orden.count.mock.calls[0][0].where,
  };
}

describe("filtros de catalogo -> IN (...) (R34)", () => {
  it("R34: cada lista se traduce a `{ in: [...] }` en SU columna", async () => {
    const { findMany } = await whereDe({
      zonaId: ["z1", "z2"],
      provinciaId: ["p1"],
      cantonId: ["c1", "c2"],
      distritoId: ["d1"],
    });
    expect(findMany).toEqual({
      deletedAt: null,
      zonaId: { in: ["z1", "z2"] },
      provinciaId: { in: ["p1"] },
      cantonId: { in: ["c1", "c2"] },
      distritoId: { in: ["d1"] },
    });
  });

  it("R33: las claves son hermanas del mismo objeto -> AND entre filtros distintos", async () => {
    const { findMany } = await whereDe({
      estatusId: ["os-a"],
      zonaId: ["z1"],
      createdAt: { gte: new Date("2026-07-01T06:00:00.000Z") },
    });
    expect(Object.keys(findMany).sort()).toEqual([
      "createdAt",
      "deletedAt",
      "estatusId",
      "zonaId",
    ]);
  });

  it("un ESCALAR (acotamiento por rol) se traduce a igualdad, no a `in`", async () => {
    const { findMany } = await whereDe({ tiendaId: "store1" });
    expect(findMany.tiendaId).toBe("store1");
  });

  it("una LISTA de tiendas (filtro) se traduce a `in`", async () => {
    const { findMany } = await whereDe({ tiendaId: ["t1", "t2"] });
    expect(findMany.tiendaId).toEqual({ in: ["t1", "t2"] });
  });

  it("`deletedAt: null` sigue SIEMPRE presente (las borradas nunca reaparecen)", async () => {
    const { findMany } = await whereDe({ zonaId: ["z1"] });
    expect(findMany.deletedAt).toBeNull();
  });
});

describe("falla cerrado: un filtro nunca degrada a 'sin filtro' (R35)", () => {
  it("R35: un id inexistente produce `IN ('id-inventado')` -> cero filas, no todas", async () => {
    const { findMany } = await whereDe({ zonaId: ["zona-inexistente"] });
    expect(findMany.zonaId).toEqual({ in: ["zona-inexistente"] });
  });

  it("R35: una lista VACIA de un filtro NUEVO produce `IN ()` (cero filas), no ausencia de clave", async () => {
    // Defensa en profundidad: el schema `.nonempty()` ya lo hace inalcanzable, pero si
    // llegase, el resultado debe ser vacio y NUNCA un listado mas amplio.
    const { findMany } = await whereDe({ zonaId: [] });
    expect(findMany.zonaId).toEqual({ in: [] });
    expect("zonaId" in findMany).toBe(true);
  });

  it("R35: lo mismo para tienda, provincia, canton y distrito", async () => {
    const { findMany } = await whereDe({
      tiendaId: [],
      provinciaId: [],
      cantonId: [],
      distritoId: [],
    });
    expect(findMany.tiendaId).toEqual({ in: [] });
    expect(findMany.provinciaId).toEqual({ in: [] });
    expect(findMany.cantonId).toEqual({ in: [] });
    expect(findMany.distritoId).toEqual({ in: [] });
  });

  it("sin regresion (R45): la lista vacia de ESTADOS conserva su semantica previa (sin filtro)", async () => {
    const { findMany } = await whereDe({ estatusId: [] });
    expect(findMany.estatusId).toBeUndefined();
  });
});

describe("orden con distrito NULL bajo el filtro de distrito (decision (f))", () => {
  it("`distritoId IN (...)` no puede seleccionar una fila con distrito NULL", async () => {
    // La semantica SQL de `IN` excluye NULL: no hay clausula `OR distrito_id IS NULL`,
    // y no se ofrece opcion "sin distrito". Se afirma sobre el `where` emitido.
    const { findMany } = await whereDe({ distritoId: ["d1", "d2"] });
    expect(findMany.distritoId).toEqual({ in: ["d1", "d2"] });
    // Ni `null` entre los valores del IN, ni una clausula alternativa que lo cuele.
    expect(JSON.stringify(findMany.distritoId)).not.toContain("null");
    expect(findMany.OR).toBeUndefined();
  });
});

describe("rango temporal (R41/R42)", () => {
  it("el rango llega YA calculado y se pasa tal cual a `createdAt`", async () => {
    const rango = {
      gte: new Date("2026-07-01T06:00:00.000Z"),
      lt: new Date("2026-07-16T06:00:00.000Z"),
    };
    const { findMany } = await whereDe({ createdAt: rango });
    expect(findMany.createdAt).toEqual(rango);
  });

  it("sin rango, la clave `createdAt` NO aparece en el where", async () => {
    const { findMany } = await whereDe({ zonaId: ["z1"] });
    expect(findMany.createdAt).toBeUndefined();
  });
});

describe("count y pagina comparten criterio (R44)", () => {
  it("R44: `count` recibe EXACTAMENTE el mismo objeto `where` que `findMany`", async () => {
    const { findMany, count } = await whereDe({
      zonaId: ["z1"],
      tiendaId: ["t1"],
      createdAt: { gte: new Date("2026-07-01T06:00:00.000Z") },
    });
    expect(count).toEqual(findMany);
    // Misma identidad de objeto: es imposible que diverjan por una edicion futura.
    expect(count).toBe(findMany);
  });

  it("R44: tambien sin filtros nuevos", async () => {
    const { findMany, count } = await whereDe({ estatusId: ["os-a"] });
    expect(count).toBe(findMany);
  });
});

describe("sin regresion del where previo (R45)", () => {
  it("R45: un `where` vacio produce exactamente `{ deletedAt: null }`", async () => {
    const { findMany } = await whereDe({});
    expect(findMany).toEqual({ deletedAt: null });
  });

  it("R45: el where de un adminTienda con estado es el de siempre", async () => {
    const { findMany } = await whereDe({ tiendaId: "store1", estatusId: ["os-a"] });
    expect(findMany).toEqual({
      deletedAt: null,
      tiendaId: "store1",
      estatusId: { in: ["os-a"] },
    });
  });

  it("R45: el acotamiento del mensajero sigue traduciendose igual", async () => {
    const { findMany } = await whereDe({ mensajeroAsignadoId: "msg1" });
    expect(findMany).toEqual({ deletedAt: null, mensajeroAsignadoId: "msg1" });
  });
});

describe("filtro REASIGNABLES -> predicado compuesto", () => {
  it("traduce el interruptor a las TRES condiciones, como claves hermanas (AND)", async () => {
    const { findMany } = await whereDe({ reasignables: true });
    expect(findMany).toEqual({
      deletedAt: null,
      prioridad: true,
      mensajeroAsignadoId: null,
      estatus: { value: { not: "reprogramada" } },
    });
  });

  it("el estado se compara por VALUE, no por id: `reprogramada` queda fuera", async () => {
    const { findMany } = await whereDe({ reasignables: true });
    // Una reprogramada sigue bloqueada hasta que el cron la libere: no es reasignable.
    expect(findMany.estatus).toEqual({ value: { not: "reprogramada" } });
  });

  it("convive con el resto de filtros sin pisarlos (AND)", async () => {
    const { findMany } = await whereDe({ reasignables: true, zonaId: ["z1"] });
    expect(findMany.zonaId).toEqual({ in: ["z1"] });
    expect(findMany.prioridad).toBe(true);
  });

  it("`count` usa EXACTAMENTE el mismo where que la pagina", async () => {
    const { findMany, count } = await whereDe({ reasignables: true });
    expect(count).toEqual(findMany);
  });

  it("sin la clave no aparece ninguna de las tres condiciones", async () => {
    const { findMany } = await whereDe({ zonaId: ["z1"] });
    expect(findMany).not.toHaveProperty("prioridad");
    expect(findMany).not.toHaveProperty("mensajeroAsignadoId");
    expect(findMany).not.toHaveProperty("estatus");
  });
});

