import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GeoRepository } from "@/lib/repositories/GeoRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 374 (R35) — **EL HISTORICO NO SE TOCA: LAS ORDENES DE UN NODO RETIRADO SIGUEN AHI Y SIGUEN
 * SIENDO FILTRABLES.** Contra Postgres.
 *
 * ⚠️ POR QUE ESTA MITAD SE AFIRMA EXPLICITAMENTE Y NO POR AUSENCIA. Es exactamente el argumento
 * de T4/T5 de `filtros-catalogo-sin-inactivos.test.ts` (ficha 351), y aqui pesa MAS: alli el
 * usuario podia llegar a sus ordenes por un enlace guardado con el id; en geografia NADIE TECLEA
 * UN UUID, asi que si el desplegable dejara de ofrecer el distrito retirado —y ademas el listado
 * lo escondiera— esas ordenes serian sencillamente inalcanzables.
 *
 * Un arreglo que escondiera ordenes historicas seria PEOR que el problema que vino a resolver. Por
 * eso esta mitad tiene su archivo, y no se deduce de que «nadie toco el listado».
 *
 * SIN `DATABASE_URL` se SALTA. CON base pero sin las FK que necesita, REVIENTA CON MENSAJE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `f374h${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const TAKE_TODO = 3000;

interface Sembrado {
  provincia: string;
  canton: string;
  distrito: string;
  orden: string;
}

describeSiHayBase("374/R35 — el historico de un nodo retirado (Postgres real)", () => {
  let prisma: PrismaClient;
  let estatusId: string;
  let tiendaId: string;
  let zonaId: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fila = await prisma.orden.findFirst({
      select: { estatusId: true, tiendaId: true, zonaId: true },
    });
    if (!fila) {
      throw new Error(
        "hay DATABASE_URL pero `orden` esta vacia: sin una fila de la que tomar las FK " +
          "(estatus, tienda, zona) no se puede sembrar la orden historica, que ES este test. " +
          "Este archivo NO debe pasar en verde asi.",
      );
    }
    estatusId = fila.estatusId;
    tiendaId = fila.tiendaId;
    zonaId = fila.zonaId;
  });

  async function conCorpus<T>(
    fn: (ctx: {
      s: Sembrado;
      ordenes: OrdenRepository;
      geo: GeoRepository;
      tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const provincia = (
        await tx.provincia.create({ data: { nombre: `Prov hist ${SUFIJO}` }, select: { id: true } })
      ).id;
      const canton = (
        await tx.canton.create({
          data: { nombre: `Canton hist ${SUFIJO}`, provinciaId: provincia },
          select: { id: true },
        })
      ).id;
      const distrito = (
        await tx.distrito.create({
          data: { nombre: `Distrito hist ${SUFIJO}`, cantonId: canton },
          select: { id: true },
        })
      ).id;

      // LA ORDEN HISTORICA: su terna geografica esta CONGELADA en la fila.
      const orden = (
        await tx.orden.create({
          data: {
            numRemision: `REM-${SUFIJO}`,
            estatusId,
            destinatario: `Destinatario ${SUFIJO}`,
            telefonoDest: "88881111",
            tiendaId,
            zonaId,
            provinciaId: provincia,
            cantonId: canton,
            distritoId: distrito,
            producto: `Producto ${SUFIJO}`,
          },
          select: { id: true },
        })
      ).id;

      // Y AHORA SE RETIRA TODA LA CADENA: distrito, canton y provincia.
      await tx.distrito.update({ where: { id: distrito }, data: { activo: false } });
      await tx.canton.update({ where: { id: canton }, data: { activo: false } });
      await tx.provincia.update({ where: { id: provincia }, data: { activo: false } });

      return fn({
        s: { provincia, canton, distrito, orden },
        ordenes: new OrdenRepository(tx as unknown as PrismaClient),
        geo: new GeoRepository(tx as unknown as PrismaClient),
        tx,
      });
    });
  }

  const pedir = (ordenes: OrdenRepository, where: Parameters<OrdenRepository["list"]>[0]["where"]) =>
    ordenes.list({ where, sortBy: "created_at", sortDir: "desc", skip: 0, take: TAKE_TODO });

  it("el corpus se sembro y la cadena entera quedo RETIRADA", async () => {
    await conCorpus(async ({ s, tx }) => {
      const [fila] = await tx.$queryRawUnsafe<Array<{ p: boolean; c: boolean; d: boolean }>>(
        `SELECT p."activo" AS p, c."activo" AS c, d."activo" AS d
           FROM "distrito" d
           JOIN "canton" c ON c."id" = d."canton_id"
           JOIN "provincia" p ON p."id" = c."provincia_id"
          WHERE d."id" = $1`,
        s.distrito,
      );
      expect(fila).toEqual({ p: false, c: false, d: false });
    });
  });

  it("⭑ la orden SIGUE en el listado aunque su distrito, su canton y su provincia esten retirados", async () => {
    const medido = await conCorpus(async ({ s, ordenes }) => {
      const listado = await pedir(ordenes, {});
      return { ids: listado.items.map((o) => o.id), s };
    });
    expect(medido.ids).toContain(medido.s.orden);
  });

  it("⭑ y SIGUE saliendo al filtrar por su `distritoId`", async () => {
    const medido = await conCorpus(async ({ s, ordenes }) => {
      const listado = await pedir(ordenes, { distritoId: [s.distrito] });
      return { ids: listado.items.map((o) => o.id), s };
    });
    // El desplegable puede dejar de ofrecerlo; el id sigue siendo un filtro legitimo.
    expect(medido.ids).toEqual([medido.s.orden]);
  });

  it("tambien al filtrar por su canton y por su provincia retirados", async () => {
    const medido = await conCorpus(async ({ s, ordenes }) => {
      const porCanton = await pedir(ordenes, { cantonId: [s.canton] });
      const porProvincia = await pedir(ordenes, { provinciaId: [s.provincia] });
      return {
        porCanton: porCanton.items.map((o) => o.id),
        porProvincia: porProvincia.items.map((o) => o.id),
        s,
      };
    });
    expect(medido.porCanton).toEqual([medido.s.orden]);
    expect(medido.porProvincia).toEqual([medido.s.orden]);
  });

  it("la orden conserva su terna congelada y su distrito legible en el DTO", async () => {
    const medido = await conCorpus(async ({ s, ordenes }) => {
      const listado = await pedir(ordenes, { distritoId: [s.distrito] });
      return { item: listado.items[0], s };
    });
    expect(medido.item).toBeDefined();
    expect(medido.item.distritoId).toBe(medido.s.distrito);
    // El nombre del distrito RETIRADO sigue resolviendose por la relacion: la fila no se queda
    // muda ni pinta un uuid. Si el join escondiera los retirados, esto seria `null`.
    expect(medido.item.relaciones?.distrito?.nombre).toBe(`Distrito hist ${SUFIJO}`);
    expect(medido.item.relaciones?.canton?.nombre).toBe(`Canton hist ${SUFIJO}`);
    expect(medido.item.relaciones?.provincia?.nombre).toBe(`Prov hist ${SUFIJO}`);
  });

  it("y el catalogo de filtros SIGUE ofreciendo ese distrito, marcado como no disponible", async () => {
    // La otra mitad de R35: si el desplegable lo escondiera, el filtro de arriba no tendria como
    // pedirse desde la pantalla. Por eso `list*Lite` proyecta en vez de recortar.
    const medido = await conCorpus(async ({ s, geo }) => {
      const filas = await geo.listDistritosLite();
      return { fila: filas.find((f) => f.id === s.distrito), s };
    });
    expect(medido.fila, "el distrito retirado desaparecio del catalogo de filtros").toBeDefined();
    expect(medido.fila?.disponible).toBe(false);
  });
});
