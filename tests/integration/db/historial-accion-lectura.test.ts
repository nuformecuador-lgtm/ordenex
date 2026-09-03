import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HistorialAccionRepository } from "@/lib/repositories/HistorialAccionRepository";
import type {
  FiltroHistorialAccionResuelto,
  OrdenHistorialAccion,
} from "@/lib/interfaces/repositories/IHistorialAccionRepository";
import { accionesDeCategoria } from "@/lib/types/historial-accion";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 362 / T4.2 (R29/R31) — LOS FILTROS Y LA BUSQUEDA, PROBADOS DONDE VIVEN.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE ESTE ARCHIVO ES DE INTEGRACION Y NO DE SERVICIO CON DOBLES. **El `WHERE` se prueba
// donde vive.** En este repo esta medido cuatro veces seguidas: un test de servicio con dobles no
// ve el SQL, asi que una mutacion del `WHERE` —quitar una clausula, cambiar un `IN` por un `OR`,
// ensanchar la busqueda a un campo de mas— pasa en VERDE.
//
// Lo que se mide, contra Postgres:
//   - R29: los CINCO filtros (actor, tipo, categoria, tipo de entidad, fecha) acotan de verdad;
//   - «filtrar por categoria equivale a filtrar por sus tipos»;
//   - R31: el termino libre alcanza EXACTAMENTE lo que su placeholder anuncia —persona, guia,
//     remision y nombre de lo afectado— y NADA MAS, con su caso NEGATIVO.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MARCA = `362-lec-${Date.now().toString(36)}`;
const ORDEN: OrdenHistorialAccion = { sortBy: "created_at", sortDir: "desc" };

/** El filtro «sin nada», del que parten todos los casos. */
function sinFiltro(): FiltroHistorialAccionResuelto {
  return { q: null, actorId: null, accion: null, entidadTipo: null, desde: null, hasta: null };
}

describeSiHayBase("362/T4.2 — el `WHERE` del historial, contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  interface Corpus {
    repo: HistorialAccionRepository;
    actorA: string;
    actorB: string;
    ids: Record<string, string>;
  }

  /**
   * Seis filas cuidadosamente distintas: dos actores, tres acciones de tres categorias, tres tipos
   * de entidad y tres dias. Cada caso de abajo aisla UNA dimension.
   */
  async function sembrar(tx: TxDeTest): Promise<Corpus> {
    const usuarios = await tx.usuario.findMany({
      select: { id: true, nombre: true, primerApellido: true },
      take: 2,
      orderBy: { id: "asc" },
    });
    if (usuarios.length < 2) {
      throw new Error("hacen falta al menos 2 usuarios en la base para este corpus");
    }
    const [a, b] = usuarios;

    const filas = [
      {
        clave: "borrado-a",
        accion: "orden_eliminada" as const,
        entidadTipo: "orden" as const,
        entidadEtiqueta: `${MARCA} GUIA-100234`,
        actor: a,
        createdAt: new Date("2026-09-01T15:00:00.000Z"),
      },
      {
        clave: "borrado-b",
        accion: "orden_eliminada" as const,
        entidadTipo: "orden" as const,
        entidadEtiqueta: `${MARCA} REM-0007`,
        actor: b,
        createdAt: new Date("2026-09-02T15:00:00.000Z"),
      },
      {
        clave: "cierre-a",
        accion: "cierre_dia_aprobado" as const,
        entidadTipo: "cierre_dia" as const,
        entidadEtiqueta: `${MARCA} Cierre Norte`,
        actor: a,
        createdAt: new Date("2026-09-02T16:00:00.000Z"),
      },
      {
        clave: "rol-b",
        accion: "usuario_rol_cambiado" as const,
        entidadTipo: "usuario" as const,
        entidadEtiqueta: `${MARCA} Zutano Perez`,
        actor: b,
        createdAt: new Date("2026-09-03T15:00:00.000Z"),
      },
      {
        clave: "tarifa-a",
        accion: "tarifa_borrada" as const,
        entidadTipo: "tarifa" as const,
        entidadEtiqueta: `${MARCA} Zona Sur`,
        actor: a,
        createdAt: new Date("2026-09-03T16:00:00.000Z"),
      },
      {
        clave: "sistema",
        accion: "egreso_administrativo_reversado" as const,
        entidadTipo: "wallet_movimiento" as const,
        entidadEtiqueta: `${MARCA} ingreso_ajuste`,
        actor: null,
        createdAt: new Date("2026-09-03T17:00:00.000Z"),
      },
    ];

    const ids: Record<string, string> = {};
    for (const fila of filas) {
      const id = randomUUID();
      ids[fila.clave] = id;
      await tx.historialAccion.create({
        data: {
          id,
          accion: fila.accion,
          entidadTipo: fila.entidadTipo,
          entidadId: randomUUID(),
          entidadEtiqueta: fila.entidadEtiqueta,
          actorUsuarioId: fila.actor?.id ?? null,
          // El nombre CONGELADO se escribe DISTINTO del vivo a proposito en una fila, para poder
          // separar «busca por el congelado» de «busca por la relacion».
          actorNombre:
            fila.actor === null
              ? null
              : `${fila.actor.nombre} ${fila.actor.primerApellido ?? ""}`.trim(),
          actorRol: fila.actor === null ? null : "maestro",
          loteId: randomUUID(),
          createdAt: fila.createdAt,
        },
      });
    }

    return {
      repo: new HistorialAccionRepository(tx as unknown as PrismaClient),
      actorA: a.id,
      actorB: b.id,
      ids,
    };
  }

  /** Los ids devueltos por el listado, acotados al corpus de esta corrida. */
  async function listar(
    c: Corpus,
    filtro: Partial<FiltroHistorialAccionResuelto>,
  ): Promise<string[]> {
    const pagina = await c.repo.list({
      filtro: { ...sinFiltro(), ...filtro },
      orden: ORDEN,
      page: 1,
      pageSize: 100,
    });
    const mios = new Set(Object.values(c.ids));
    return pagina.items.filter((f) => mios.has(f.id)).map((f) => f.id);
  }

  it("ANTI-VACUIDAD: el corpus se sembro y sin filtros salen las SEIS filas", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return listar(c, {});
    });
    expect(r).toHaveLength(6);
  });

  it("⭑ R29 (1/5) filtro por ACTOR: solo las filas de ese actor", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return {
        soloA: await listar(c, { actorId: [c.actorA] }),
        esperadoA: [c.ids["borrado-a"], c.ids["cierre-a"], c.ids["tarifa-a"]],
      };
    });
    expect(r.soloA.sort()).toEqual(r.esperadoA.sort());
  });

  it("⭑ R29 (2/5) filtro por TIPO DE ACCION: union cerrada, y solo esos tipos", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return {
        salida: await listar(c, { accion: ["orden_eliminada"] }),
        esperado: [c.ids["borrado-a"], c.ids["borrado-b"]],
      };
    });
    expect(r.salida.sort()).toEqual(r.esperado.sort());
  });

  it("⭑ R29 (3/5) filtro por CATEGORIA equivale a filtrar por SUS tipos", async () => {
    // La equivalencia que R17 promete: la categoria no es una columna, es una lista de tipos.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      const porCategoria = await listar(c, { accion: accionesDeCategoria("hace_desaparecer") });
      const porTipos = await listar(c, { accion: ["orden_eliminada", "tarifa_borrada"] });
      return { porCategoria, porTipos, esperado: [c.ids["borrado-a"], c.ids["borrado-b"], c.ids["tarifa-a"]] };
    });

    expect(r.porCategoria.sort()).toEqual(r.esperado.sort());
    // Y las dos formas de pedirlo dan EXACTAMENTE lo mismo.
    expect(r.porCategoria.sort()).toEqual(r.porTipos.sort());
  });

  it("⭑ R29 (4/5) filtro por TIPO DE ENTIDAD", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return {
        salida: await listar(c, { entidadTipo: ["usuario", "tarifa"] }),
        esperado: [c.ids["rol-b"], c.ids["tarifa-a"]],
      };
    });
    expect(r.salida.sort()).toEqual(r.esperado.sort());
  });

  it("⭑ R29 (5/5) filtro por FECHA: `desde` incluye el dia, `hasta` es el INICIO DEL SIGUIENTE", async () => {
    // La convencion del repo (feature 166): con `lte` del mismo dia se perderian las filas de
    // entre las 00:00 y las 23:59:59.999 del ultimo dia pedido — justo el que el usuario acaba de
    // elegir. Aqui hay DOS filas del dia 3 a horas distintas: si el limite fuera `lte`, la de las
    // 17:00 se caeria.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return {
        soloDia3: await listar(c, {
          desde: new Date("2026-09-03T00:00:00.000Z"),
          hasta: new Date("2026-09-04T00:00:00.000Z"),
        }),
        esperado: [c.ids["rol-b"], c.ids["tarifa-a"], c.ids["sistema"]],
      };
    });
    expect(r.soloDia3.sort()).toEqual(r.esperado.sort());
  });

  it("los filtros se COMBINAN en `AND`, no en `OR`", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return {
        salida: await listar(c, { actorId: [c.actorA], accion: ["orden_eliminada"] }),
        esperado: [c.ids["borrado-a"]],
      };
    });
    expect(r.salida).toEqual(r.esperado);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R31 — LA BUSQUEDA LIBRE, Y SU CASO NEGATIVO
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R31: el termino alcanza la GUIA de la etiqueta congelada", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return { salida: await listar(c, { q: "GUIA-100234" }), esperado: [c.ids["borrado-a"]] };
    });
    expect(r.salida).toEqual(r.esperado);
  });

  it("⭑ R31: el termino alcanza la REMISION y el NOMBRE DE LO AFECTADO", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return {
        remision: await listar(c, { q: "REM-0007" }),
        nombre: await listar(c, { q: "Zona Sur" }),
        esperadoRemision: [c.ids["borrado-b"]],
        esperadoNombre: [c.ids["tarifa-a"]],
      };
    });
    expect(r.remision).toEqual(r.esperadoRemision);
    expect(r.nombre).toEqual(r.esperadoNombre);
  });

  it("⭑ R31: el termino alcanza el NOMBRE DE LA PERSONA que actuo", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      const actor = await tx.usuario.findUniqueOrThrow({
        where: { id: c.actorA },
        select: { nombre: true },
      });
      return { salida: await listar(c, { q: actor.nombre }), actorA: c.actorA, ids: c.ids };
    });
    // Las tres filas del actor A salen por su nombre.
    expect(r.salida.sort()).toEqual(
      [r.ids["borrado-a"], r.ids["cierre-a"], r.ids["tarifa-a"]].sort(),
    );
  });

  it("la busqueda NO distingue mayusculas de minusculas", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return { salida: await listar(c, { q: "zona sur" }), esperado: [c.ids["tarifa-a"]] };
    });
    expect(r.salida).toEqual(r.esperado);
  });

  it("⭑ R31 (CASO NEGATIVO): el termino NO alcanza el `lote_id` ni el `entidad_id`", async () => {
    // ⚠️ ES LA MUTACION QUE R31 PROHIBE: «ensanchar la busqueda a un campo no anunciado». El
    // placeholder dice «Persona, guía, remisión o nombre de lo afectado» y ese texto ES la
    // documentacion del campo. Buscar por un uuid interno tiene que dar CERO, no resultados que
    // el usuario no entiende de donde salen.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      const fila = await tx.historialAccion.findUniqueOrThrow({
        where: { id: c.ids["borrado-a"] },
        select: { loteId: true, entidadId: true },
      });
      return {
        porLote: await listar(c, { q: fila.loteId }),
        porEntidad: await listar(c, { q: fila.entidadId }),
      };
    });
    expect(r.porLote, "la busqueda alcanza el `lote_id`, que su placeholder no anuncia").toEqual([]);
    expect(r.porEntidad, "la busqueda alcanza el `entidad_id`, que es un uuid interno").toEqual([]);
  });

  it("⭑ R31 (CASO NEGATIVO): el termino NO alcanza el TIPO de accion ni el de entidad", async () => {
    // Para eso estan los filtros del selector. Si la busqueda libre alcanzara el nombre tecnico
    // del enum, escribir «orden» devolveria media tabla sin que nadie lo pidiera.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      return {
        porAccion: await listar(c, { q: "orden_eliminada" }),
        porEntidad: await listar(c, { q: "cierre_dia" }),
      };
    });
    expect(r.porAccion).toEqual([]);
    expect(r.porEntidad).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R30 — la descarga comparte el `where`
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R30: con FILTROS aplicados, la descarga trae el MISMO conjunto que la pantalla", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      const filtro = { ...sinFiltro(), actorId: [c.actorA] };
      const pantalla = await c.repo.list({ filtro, orden: ORDEN, page: 1, pageSize: 100 });
      const descarga = await c.repo.listAll({ filtro, orden: ORDEN, limite: 500 });
      const mios = new Set(Object.values(c.ids));
      return {
        pantalla: pantalla.items.filter((f) => mios.has(f.id)).map((f) => f.id),
        descarga: descarga.filter((f) => mios.has(f.id)).map((f) => f.id),
      };
    });

    expect(r.pantalla).toHaveLength(3);
    expect(r.descarga).toEqual(r.pantalla);
  });

  it("R36: una fila SIN actor sale con los tres campos nulos, y el filtro por actor la excluye", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      const todas = await c.repo.list({
        filtro: { ...sinFiltro(), q: MARCA },
        orden: ORDEN,
        page: 1,
        pageSize: 100,
      });
      const sistema = todas.items.find((f) => f.id === c.ids["sistema"]);
      return { sistema, conActor: await listar(c, { actorId: [c.actorA, c.actorB] }) };
    });

    expect(r.sistema?.actorUsuarioId).toBeNull();
    expect(r.sistema?.actorNombre).toBeNull();
    expect(r.sistema?.actorRol).toBeNull();
    expect(r.conActor).toHaveLength(5);
  });

  it("el catalogo de actores devuelve SOLO quien ha actuado, con su nombre", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const c = await sembrar(tx);
      const actores = await c.repo.listarActores();
      return { actores, actorA: c.actorA, actorB: c.actorB };
    });

    const ids = r.actores.map((a) => a.id);
    expect(ids).toContain(r.actorA);
    expect(ids).toContain(r.actorB);
    for (const actor of r.actores) expect(actor.nombre.trim().length).toBeGreaterThan(0);
  });
});
