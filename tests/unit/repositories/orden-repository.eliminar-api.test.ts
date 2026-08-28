import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ESTADOS_ELIMINABLES } from "@/lib/types/order-status-eliminables";

// FICHA 320 (T1/T2) — `findParaEliminacionApi` + `softDeleteViaApi`, las DOS sentencias del
// borrado por API key. Lo que se afirma aqui es EL `where` y NADA MAS: que las claves que
// componen la frontera multi-tenant viajan en la consulta, y que ninguna tabla ajena se toca.
//
// POR QUE UN ESPIA UNIVERSAL Y NO UN OBJETO CON DOS `vi.fn()`. Un doble escrito a mano solo
// registra los metodos que alguien se acordo de declarar: si manana el repositorio escribiera en
// `gestion_orden` o en `orden_historial_estado`, el doble reventaria con "no es una funcion" —o,
// peor, alguien anadiria el metodo al doble y el test seguiria verde—. El Proxy de abajo registra
// CUALQUIER `modelo.metodo` que se invoque, asi que la lista de llamadas es exhaustiva por
// construccion y el requisito "no escribe en ninguna otra tabla" se puede afirmar de verdad.
//
// El `where` se compara con `toEqual` (no `toMatchObject`): asi caza tanto QUITAR una clave
// —quitar `tiendaId` es la mutacion (i) de la verificacion— como ANADIR una silenciosamente.
//
// OJO CON LO QUE ESTE ARCHIVO NO PRUEBA: que Postgres HAGA lo que el `where` dice. Eso vive en
// `tests/integration/db/eliminar-orden-api-frontera-tienda.test.ts`, contra la base real.

interface Llamada {
  metodo: string;
  args: unknown[];
}

/** Prisma de mentira que apunta cada `modelo.metodo(...)` invocado. */
function prismaEspia(respuestas: { findFirst?: unknown; updateMany?: { count: number } }): {
  prisma: PrismaClient;
  llamadas: Llamada[];
} {
  const llamadas: Llamada[] = [];
  const prisma = new Proxy(
    {},
    {
      get(_objetivo, modelo: string) {
        return new Proxy(
          {},
          {
            get(_objetivoModelo, metodo: string) {
              return (...args: unknown[]) => {
                llamadas.push({ metodo: `${modelo}.${metodo}`, args });
                if (modelo === "orden" && metodo === "findFirst") {
                  return Promise.resolve(respuestas.findFirst ?? null);
                }
                if (modelo === "orden" && metodo === "updateMany") {
                  return Promise.resolve(respuestas.updateMany ?? { count: 0 });
                }
                return Promise.resolve(undefined);
              };
            },
          },
        );
      },
    },
  );
  return { prisma: prisma as unknown as PrismaClient, llamadas };
}

const OWNER = "tienda-propia";
const AJENA = "tienda-de-otro";
const ORDEN_ID = "ord-1";

const FILA_VIVA = {
  id: ORDEN_ID,
  numGuia: 100234,
  numRemision: "REM-0001",
  estatus: { value: "en_bodega_central" },
};

describe("0 · autocomprobacion del espia", () => {
  it("registra CUALQUIER modelo.metodo, tambien uno que el repositorio no usa", () => {
    // Sin esto, los `toEqual` de la lista de llamadas podrian estar pasando porque el espia no ve
    // nada, no porque no haya nada que ver.
    const { prisma, llamadas } = prismaEspia({});
    const crudo = prisma as unknown as {
      gestionOrden: { create: (a: unknown) => void };
      ordenHistorialEstado: { createMany: (a: unknown) => void };
    };
    crudo.gestionOrden.create({ data: {} });
    crudo.ordenHistorialEstado.createMany({ data: [] });
    expect(llamadas.map((l) => l.metodo)).toEqual([
      "gestionOrden.create",
      "ordenHistorialEstado.createMany",
    ]);
  });
});

describe("OrdenRepository.findParaEliminacionApi (ficha 320/T1)", () => {
  it("R3: el `where` lleva id + tiendaId + deletedAt JUNTOS, en la MISMA consulta", async () => {
    const { prisma, llamadas } = prismaEspia({ findFirst: FILA_VIVA });
    const repo = new OrdenRepository(prisma);

    await repo.findParaEliminacionApi(ORDEN_ID, OWNER);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].metodo).toBe("orden.findFirst");
    const arg = llamadas[0].args[0] as { where: unknown; select: unknown };
    // ⭑ LA FRONTERA MULTI-TENANT. Si `tiendaId` desaparece de aqui, este `toEqual` cae.
    expect(arg.where).toEqual({ id: ORDEN_ID, tiendaId: OWNER, deletedAt: null });
    // Proyeccion acotada: decision (estado) + identidad (guia/remision) + id. Nada de montos.
    expect(arg.select).toEqual({
      id: true,
      numGuia: true,
      numRemision: true,
      estatus: { select: { value: true } },
    });
  });

  it("R6: aplana el estado y devuelve la identidad, con `numGuia` null cuando aun no hay guia", async () => {
    const { prisma } = prismaEspia({
      findFirst: {
        id: ORDEN_ID,
        numGuia: null,
        numRemision: "REM-0002",
        estatus: { value: "en_preparacion" },
      },
    });
    const repo = new OrdenRepository(prisma);

    expect(await repo.findParaEliminacionApi(ORDEN_ID, OWNER)).toEqual({
      id: ORDEN_ID,
      numGuia: null,
      numRemision: "REM-0002",
      estatusValue: "en_preparacion",
    });
  });

  it("R8: sin fila (inexistente, borrada o AJENA) devuelve null, sin distinguir cual de los tres", async () => {
    const { prisma } = prismaEspia({ findFirst: null });
    const repo = new OrdenRepository(prisma);
    expect(await repo.findParaEliminacionApi(ORDEN_ID, AJENA)).toBeNull();
  });
});

describe("OrdenRepository.softDeleteViaApi (ficha 320/T2)", () => {
  it("R3/R4: las CUATRO condiciones van en el `where` del UPDATE, no en un `if` previo", async () => {
    const { prisma, llamadas } = prismaEspia({ updateMany: { count: 1 } });
    const repo = new OrdenRepository(prisma);

    const antes = Date.now();
    const n = await repo.softDeleteViaApi({
      ordenId: ORDEN_ID,
      ownerId: OWNER,
      estadosPermitidos: ESTADOS_ELIMINABLES,
    });
    const despues = Date.now();

    expect(n).toBe(1);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].metodo).toBe("orden.updateMany");
    const arg = llamadas[0].args[0] as { where: unknown; data: { deletedAt: Date } };
    // ⭑ IDENTIFICADOR + DUEÑO + VIVA + ESTADO PERMITIDO, todo en la misma sentencia.
    expect(arg.where).toEqual({
      id: ORDEN_ID,
      tiendaId: OWNER,
      deletedAt: null,
      estatus: { value: { in: [...ESTADOS_ELIMINABLES] } },
    });
    // `data` toca UNA sola columna: ni estatus, ni mensajero, ni montos.
    expect(Object.keys(arg.data)).toEqual(["deletedAt"]);
    expect(arg.data.deletedAt.getTime()).toBeGreaterThanOrEqual(antes);
    expect(arg.data.deletedAt.getTime()).toBeLessThanOrEqual(despues);
  });

  it("R7: el borrado NO escribe en ninguna otra tabla (ni historial, ni gestion, ni carga)", async () => {
    const { prisma, llamadas } = prismaEspia({ updateMany: { count: 1 } });
    const repo = new OrdenRepository(prisma);

    await repo.softDeleteViaApi({
      ordenId: ORDEN_ID,
      ownerId: OWNER,
      estadosPermitidos: ESTADOS_ELIMINABLES,
    });

    // La lista es EXHAUSTIVA (ver la autocomprobacion de arriba): una sola sentencia, sobre
    // `orden`. Borrar no es transicionar -> no hay `appendCambioEstado` como en `cancelarViaApi`.
    expect(llamadas.map((l) => l.metodo)).toEqual(["orden.updateMany"]);
  });

  it("carrera: `count = 0` (otra sesion la borro o cambio de estado) se devuelve tal cual", async () => {
    const { prisma } = prismaEspia({ updateMany: { count: 0 } });
    const repo = new OrdenRepository(prisma);
    expect(
      await repo.softDeleteViaApi({
        ordenId: ORDEN_ID,
        ownerId: OWNER,
        estadosPermitidos: ESTADOS_ELIMINABLES,
      }),
    ).toBe(0);
  });

  it("falla CERRADO: con la lista de estados VACIA el `IN` no casa con nada", async () => {
    const { prisma, llamadas } = prismaEspia({ updateMany: { count: 0 } });
    const repo = new OrdenRepository(prisma);

    await repo.softDeleteViaApi({ ordenId: ORDEN_ID, ownerId: OWNER, estadosPermitidos: [] });

    const arg = llamadas[0].args[0] as { where: { estatus: unknown } };
    expect(arg.where.estatus).toEqual({ value: { in: [] } });
  });
});
