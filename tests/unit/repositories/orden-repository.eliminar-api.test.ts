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

// =================================================================================================
// FICHA 362 — `softDeleteViaApi` PASO DE `updateMany` A `UPDATE … RETURNING`, Y ESE CAMBIO ES EL
// QUE ESTE BLOQUE VIGILA AHORA.
// =================================================================================================
// POR QUE CAMBIO. `updateMany` devuelve un `count` y NO los ids. El registro de acciones tiene que
// escribir la fila de la orden ALCANZADA, no la PEDIDA (362/R12): con `count` no se puede
// distinguir «se borro» de «se pidio borrar», y son cosas distintas en cuanto una condicion del
// `where` no se cumple.
//
// QUE **NO** CAMBIO, Y ES LO QUE ESTOS CASOS SIGUEN AFIRMANDO: **las CUATRO condiciones de la
// ficha 320 siguen dentro de la MISMA sentencia** —el id, la tienda dueña, `deleted_at IS NULL` y
// el estado permitido—. Ninguna se movio a un `if` previo. Se afirman sobre el TEXTO del SQL y
// sobre sus PARAMETROS, que es donde viven ahora.
//
// Y LO QUE ESTE ARCHIVO SIGUE SIN PROBAR: que Postgres HAGA lo que ese SQL dice. Eso vive en
// `tests/integration/db/eliminar-orden-api-frontera-tienda.test.ts`, contra la base real, y esa
// suite tiene que seguir verde sin tocarla.

/** Una llamada a `$queryRaw`, con su SQL reconstruido y sus parametros. */
interface LlamadaSql {
  sql: string;
  params: unknown[];
}

/**
 * Prisma de mentira para el camino nuevo: intercepta `$transaction` (paso a traves), `$queryRaw`
 * (tagged template) y CUALQUIER `modelo.metodo`, para que la lista de escrituras siga siendo
 * exhaustiva por construccion.
 */
function prismaEspiaRaw(filas: unknown[]): {
  prisma: PrismaClient;
  llamadas: Llamada[];
  sqls: LlamadaSql[];
} {
  const llamadas: Llamada[] = [];
  const sqls: LlamadaSql[] = [];
  const raiz: Record<string, unknown> = {};
  const proxy = new Proxy(raiz, {
    get(_objetivo, clave: string) {
      if (clave === "$transaction") {
        return (fn: (tx: unknown) => unknown) => {
          llamadas.push({ metodo: "$transaction", args: [] });
          return Promise.resolve(fn(proxy));
        };
      }
      if (clave === "$queryRaw") {
        return (plantilla: TemplateStringsArray | { strings: string[] }, ...valores: unknown[]) => {
          // Prisma admite las dos formas; aqui solo se usa la de tagged template.
          const trozos = Array.isArray(plantilla)
            ? (plantilla as unknown as string[])
            : (plantilla as { strings: string[] }).strings;
          sqls.push({ sql: trozos.join(" ? "), params: valores });
          llamadas.push({ metodo: "$queryRaw", args: valores });
          return Promise.resolve(filas);
        };
      }
      return new Proxy(
        {},
        {
          get(_objetivoModelo, metodo: string) {
            return (...args: unknown[]) => {
              llamadas.push({ metodo: `${clave}.${metodo}`, args });
              if (clave === "usuario" && metodo === "findUnique") {
                return Promise.resolve({
                  nombre: "Cuenta",
                  primerApellido: "Integradora",
                  rol: { value: "apiKey" },
                });
              }
              return Promise.resolve({ count: 0 });
            };
          },
        },
      );
    },
  });
  return { prisma: proxy as unknown as PrismaClient, llamadas, sqls };
}

const FILA_BORRADA = { id: ORDEN_ID, numGuia: 100234, numRemision: "REM-0001" };

describe("OrdenRepository.softDeleteViaApi (ficha 320/T2, reexpresado por la 362)", () => {
  it("R3/R4: las CUATRO condiciones siguen en la MISMA sentencia, ahora con RETURNING", async () => {
    const { prisma, sqls } = prismaEspiaRaw([FILA_BORRADA]);
    const repo = new OrdenRepository(prisma);

    const n = await repo.softDeleteViaApi({
      ordenId: ORDEN_ID,
      ownerId: OWNER,
      estadosPermitidos: ESTADOS_ELIMINABLES,
      actorUsuarioId: "cuenta-de-la-key",
    });

    expect(n).toBe(1);
    expect(sqls).toHaveLength(1);
    const { sql, params } = sqls[0];
    // ⭑ LA FRONTERA MULTI-TENANT, EN EL `WHERE` DE LA SENTENCIA QUE MUTA.
    expect(sql).toContain('UPDATE "orden"');
    expect(sql).toContain('o."id" =');
    expect(sql).toContain('o."tienda_id" =');
    expect(sql).toContain('o."deleted_at" IS NULL');
    expect(sql).toContain('os."value" IN');
    // ⭑ Y EL `RETURNING`, que es lo que permite registrar lo ALCANZADO y no lo PEDIDO (362/R12).
    expect(sql).toContain("RETURNING");
    expect(sql).toContain('o."num_guia"');
    // Los parametros llevan el id, el dueño y la lista de estados; nada se interpola como texto.
    // `Prisma.join(...)` anida sus valores en un fragmento `Sql`, asi que se aplana antes de mirar.
    const planos = params.flatMap((p) =>
      p !== null && typeof p === "object" && "values" in (p as object)
        ? ((p as { values: unknown[] }).values ?? [])
        : [p],
    );
    expect(planos).toContain(ORDEN_ID);
    expect(planos).toContain(OWNER);
    for (const estado of ESTADOS_ELIMINABLES) expect(planos).toContain(estado);
    // `SET` toca UNA sola columna: ni estatus, ni mensajero, ni montos. Se recorta la CLAUSULA
    // `SET` en vez de barrer el SQL entero, porque `estatus_id` SI aparece —en el join con
    // `order_status`, que es lo que trae el `value` del estado permitido al `where`—.
    const clausulaSet = sql.slice(sql.indexOf("SET "), sql.indexOf("FROM "));
    expect(clausulaSet).toContain('"deleted_at"');
    expect(clausulaSet).not.toContain("estatus_id");
    expect(clausulaSet).not.toContain("mensajero_asignado_id");
    expect(clausulaSet).not.toContain("monto");
  });

  it("362/R9: el borrado y su fila de registro van en la MISMA transaccion, y en ese orden", async () => {
    const { prisma, llamadas } = prismaEspiaRaw([FILA_BORRADA]);
    const repo = new OrdenRepository(prisma);

    await repo.softDeleteViaApi({
      ordenId: ORDEN_ID,
      ownerId: OWNER,
      estadosPermitidos: ESTADOS_ELIMINABLES,
      actorUsuarioId: "cuenta-de-la-key",
    });

    // La lista es EXHAUSTIVA (ver la autocomprobacion del bloque 0). Sigue sin escribirse en
    // `gestion_orden` ni en `orden_historial_estado`: borrar no es transicionar.
    expect(llamadas.map((l) => l.metodo)).toEqual([
      "$transaction",
      "$queryRaw",
      "usuario.findUnique",
      "historialAccion.createMany",
    ]);
  });

  it("362/R3: el actor congelado de este canal lleva rol `apiKey`", async () => {
    const { prisma, llamadas } = prismaEspiaRaw([FILA_BORRADA]);
    const repo = new OrdenRepository(prisma);

    await repo.softDeleteViaApi({
      ordenId: ORDEN_ID,
      ownerId: OWNER,
      estadosPermitidos: ESTADOS_ELIMINABLES,
      actorUsuarioId: "cuenta-de-la-key",
    });

    const registro = llamadas.find((l) => l.metodo === "historialAccion.createMany");
    const data = (registro?.args[0] as { data: Record<string, unknown>[] }).data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      accion: "orden_eliminada",
      entidadTipo: "orden",
      entidadId: ORDEN_ID,
      entidadEtiqueta: "100234",
      actorRol: "apiKey",
      actorUsuarioId: "cuenta-de-la-key",
    });
    // R5: ni el destinatario, ni el telefono, ni la direccion cruzan a la fila.
    expect(JSON.stringify(data[0])).not.toMatch(/destinatario|telefono|direccion/i);
  });

  it("carrera: el `RETURNING` vacio devuelve 0 y NO deja fila de registro (362/R11)", async () => {
    const { prisma, llamadas } = prismaEspiaRaw([]);
    const repo = new OrdenRepository(prisma);

    const n = await repo.softDeleteViaApi({
      ordenId: ORDEN_ID,
      ownerId: OWNER,
      estadosPermitidos: ESTADOS_ELIMINABLES,
      actorUsuarioId: "cuenta-de-la-key",
    });

    expect(n).toBe(0);
    // `appendAccion` con lote vacio es no-op: se registra lo ALCANZADO, y no se alcanzo nada.
    expect(llamadas.map((l) => l.metodo)).not.toContain("historialAccion.createMany");
  });

  it("falla CERRADO: con la lista de estados VACIA no se ejecuta ni la sentencia", async () => {
    const { prisma, llamadas, sqls } = prismaEspiaRaw([]);
    const repo = new OrdenRepository(prisma);

    // Antes el `IN ()` de Prisma no casaba con nada; ahora se corta ANTES, porque
    // `Prisma.join([])` no es una lista SQL valida. El desenlace observable es el MISMO —cero
    // borrados— y ademas se ahorra el viaje a la base.
    expect(
      await repo.softDeleteViaApi({
        ordenId: ORDEN_ID,
        ownerId: OWNER,
        estadosPermitidos: [],
        actorUsuarioId: "cuenta-de-la-key",
      }),
    ).toBe(0);
    expect(sqls).toHaveLength(0);
    expect(llamadas).toEqual([]);
  });
});
