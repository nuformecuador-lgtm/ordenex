import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";

import {
  sqlExisteGestionPendiente,
  whereGestionPendiente,
  whereOrdenConGestionPendiente,
  whereOrdenSinGestionPendiente,
} from "@/lib/repositories/gestion-pendiente";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.3, design §3) — EL PREDICADO DE «GESTION PENDIENTE», CONTRA POSTGRES.
 *
 * Un caso por condicion y por estado de cierre, y las TRES formas del predicado (Prisma nivel
 * gestion, Prisma nivel orden y el fragmento SQL) contra la MISMA fila: tienen que decir lo mismo.
 * Los tests de servicio con dobles no ven el `WHERE` (memoria «probar el WHERE donde vive»).
 *
 * Los casos se siembran como FIXTURE (gestion + evento + cierre) dentro de una transaccion que
 * SIEMPRE se revierte: lo que se mide es el predicado, no quien escribe.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Caso = {
  nombre: string;
  estatus?: "en_reparto" | "entregado";
  conEvento: boolean;
  anulada?: boolean;
  cierre: null | "solicitado" | "vencido" | "rechazado" | "aprobado";
  esperado: boolean;
};

const CASOS: Caso[] = [
  { nombre: "de calle, sin cierre", conEvento: true, cierre: null, esperado: true },
  { nombre: "de calle, cierre solicitado", conEvento: true, cierre: "solicitado", esperado: true },
  { nombre: "de calle, cierre vencido", conEvento: true, cierre: "vencido", esperado: true },
  { nombre: "de calle, cierre rechazado", conEvento: true, cierre: "rechazado", esperado: true },
  { nombre: "de calle, cierre APROBADO", conEvento: true, cierre: "aprobado", esperado: false },
  { nombre: "de calle, ANULADA", conEvento: true, anulada: true, cierre: null, esperado: false },
  { nombre: "LEGADA / sintetica (sin evento), sin cierre", conEvento: false, cierre: null, esperado: false },
  { nombre: "LEGADA / sintetica (sin evento), cierre solicitado", conEvento: false, cierre: "solicitado", esperado: false },
];

describeSiHayBase("454/T1.3 — gestion pendiente de confirmar (Postgres real)", () => {
  let mundo: Mundo;
  let medidos: Array<{
    caso: Caso;
    prismaGestion: boolean;
    prismaOrden: boolean;
    prismaOrdenNegada: boolean;
    sql: boolean;
  }>;

  async function sembrar(e: Escenario, c: Caso) {
    const o = await e.sembrarOrden({ estatus: c.estatus ?? "en_reparto" });
    const cierre =
      c.cierre === null
        ? null
        : await e.tx.cierreDia.create({
            data: {
              mensajeroId: e.mensajeroId,
              estado: c.cierre,
              destinoTipo: "bodega_satelite",
              destinoZonaId: e.zonaSateliteId,
              solicitadoAt: new Date(),
            },
            select: { id: true },
          });
    const g = await e.tx.gestionOrden.create({
      data: {
        ordenId: o.ordenId,
        mensajeroId: e.mensajeroId,
        resultado: "entregado",
        cierreId: cierre?.id ?? null,
        anuladaAt: c.anulada ? new Date() : null,
      },
      select: { id: true },
    });
    if (c.conEvento) {
      await e.tx.ordenEvento.create({
        data: {
          ordenId: o.ordenId,
          tipo: "gestion_registrada",
          gestionOrdenId: g.id,
          familiaAplicacion: "gestion",
          resultado: "entregado",
          mensajeroId: e.mensajeroId,
          actorUsuarioId: e.mensajeroId,
          actorRol: "mensajero",
        },
      });
    }
    return { ordenId: o.ordenId, gestionId: g.id };
  }

  async function medir(e: Escenario, ids: { ordenId: string; gestionId: string }) {
    const prismaGestion =
      (await e.tx.gestionOrden.count({ where: { id: ids.gestionId, ...whereGestionPendiente() } })) === 1;
    const prismaOrden =
      (await e.tx.orden.count({ where: { id: ids.ordenId, ...whereOrdenConGestionPendiente() } })) === 1;
    const prismaOrdenNegada =
      (await e.tx.orden.count({ where: { id: ids.ordenId, ...whereOrdenSinGestionPendiente() } })) === 0;
    const filas = await e.tx.$queryRaw<{ si: boolean }[]>(
      Prisma.sql`SELECT ${sqlExisteGestionPendiente()} AS si FROM "orden" "o" WHERE "o"."id" = ${ids.ordenId}`,
    );
    return { prismaGestion, prismaOrden, prismaOrdenNegada, sql: filas[0]?.si === true };
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    medidos = await conEscenario(mundo, async (e) => {
      const r: typeof medidos = [];
      for (const caso of CASOS) r.push({ caso, ...(await medir(e, await sembrar(e, caso))) });
      return r;
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("precondicion: se midieron todos los casos", () => {
    expect(medidos).toHaveLength(CASOS.length);
  });

  for (const caso of CASOS) {
    it(`${caso.nombre} → pendiente = ${caso.esperado} (las tres formas coinciden)`, () => {
      const m = medidos.find((x) => x.caso.nombre === caso.nombre);
      expect(m).toBeDefined();
      expect(m?.prismaGestion).toBe(caso.esperado);
      expect(m?.prismaOrden).toBe(caso.esperado);
      expect(m?.prismaOrdenNegada).toBe(caso.esperado);
      expect(m?.sql).toBe(caso.esperado);
    });
  }

  it("a nivel ORDEN exige `en_reparto`: la misma gestion pendiente sobre una orden `entregada` no la hace «con gestion pendiente»", async () => {
    const r = await conEscenario(mundo, async (e) => {
      const ids = await sembrar(e, { nombre: "x", estatus: "entregado", conEvento: true, cierre: null, esperado: false });
      return medir(e, ids);
    });
    // La GESTION sigue pendiente (su cierre no esta aprobado)...
    expect(r.prismaGestion).toBe(true);
    // ...pero la ORDEN no esta «con gestion pendiente» (no esta en reparto).
    expect(r.prismaOrden).toBe(false);
  }, 60_000);
});
