import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ESTADOS_ELIMINABLES } from "@/lib/types/order-status-eliminables";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 320 — LA FRONTERA MULTI-TENANT DEL BORRADO POR API KEY, EJECUTADA CONTRA POSTGRES.
 *
 * QUE SOSTIENE ESTE ARCHIVO. Lo unico que impide que una API key borre las ordenes de OTRA tienda
 * es el `tienda_id = ownerId` que viaja dentro del `where` de `softDeleteViaApi` (y de su lectura
 * hermana). No hay una segunda red: el service no compara duenos en memoria a proposito —hacerlo
 * abriria la ventana entre leer y comprobar que este diseno evita—.
 *
 * POR QUE CONTRA POSTGRES Y NO SOLO CON DOBLES. Un test de servicio con un doble afirma que se
 * llamo al repositorio, no que el repositorio SELECCIONE las filas correctas; y un test de
 * repositorio con un Prisma de mentira afirma la FORMA del `where`, no lo que la base hace con
 * el. Este repo ya midio cuatro veces que una mutacion de un `where` sobrevive en verde por
 * arriba. Aqui hay dos tiendas de verdad, tres ordenes de verdad y un UPDATE de verdad.
 *
 * CONTRAPRUEBAS APLICADAS (2026-08-28, y restauradas despues):
 *   - quitar `tiendaId` del `where` de `softDeleteViaApi` -> este archivo ROJO (la tienda A borra
 *     la orden de la B).
 *   - quitar el filtro de estado -> este archivo ROJO (se borra una `en_reparto`).
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde: un `return` silencioso dentro
 * del caso se leeria como `passed` sin haber comprobado nada. CON base pero SIN catalogo, falla
 * RUIDOSAMENTE en el `beforeAll`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` es UNICO por tienda entre las ordenes vivas. */
const SUFIJO = `320-${Date.now().toString(36)}`;

describeSiHayBase("ficha 320 — una API key NO puede borrar ordenes de otra tienda", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let tiendas: { id: string }[];
  let estatus: { eliminable: string; noEliminable: string };

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    fks = encontradas;

    tiendas = await prisma.usuario.findMany({ select: { id: true }, take: 2 });
    if (tiendas.length < 2) {
      throw new Error(
        "hacen falta al menos DOS usuarios en la base: uno es la tienda dueña de la key y el " +
          "otro la tienda ajena que demuestra que el `where` filtra por tienda.",
      );
    }

    // `en_bodega_central` es el estado que la ficha 319 hizo eliminable (el que deja la
    // generacion de guia); `en_reparto` es el NO eliminable mas claro: el paquete va con el
    // mensajero.
    const filas = await prisma.orderStatus.findMany({
      where: { value: { in: ["en_bodega_central", "en_reparto"] } },
      select: { id: true, value: true },
    });
    const porValue = new Map(filas.map((f) => [f.value, f.id]));
    const eliminable = porValue.get("en_bodega_central");
    const noEliminable = porValue.get("en_reparto");
    if (!eliminable || !noEliminable) {
      throw new Error("faltan estados del catalogo `order_status`: corre `pnpm run db:seed`.");
    }
    estatus = { eliminable, noEliminable };
    // El caso de arriba se sostiene sobre que `en_bodega_central` SEA eliminable y `en_reparto`
    // no: si la lista cambiara, el test estaria midiendo otra cosa sin decirlo.
    expect(ESTADOS_ELIMINABLES).toContain("en_bodega_central");
    expect(ESTADOS_ELIMINABLES).not.toContain("en_reparto");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R3/R4/R7: borra SOLO la propia y eliminable; la ajena y la `en_reparto` siguen vivas", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [tiendaPropia, tiendaAjena] = tiendas;

      const sembrar = async (clave: string, tiendaId: string, estatusId: string) =>
        (
          await tx.orden.create({
            data: {
              numRemision: `R-${SUFIJO}-${clave}`,
              destinatario: "Dest",
              telefonoDest: "88880000",
              producto: "Prod",
              estatusId,
              tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          })
        ).id;

      // LA PROPIA Y ELIMINABLE: la unica que debe desaparecer.
      const propia = await sembrar("propia", tiendaPropia.id, estatus.eliminable);
      // SEÑUELO 1 — MISMO estado eliminable, pero de OTRA tienda. Si el `where` perdiera
      // `tienda_id`, una key borraria las ordenes de sus competidores.
      const ajena = await sembrar("ajena", tiendaAjena.id, estatus.eliminable);
      // SEÑUELO 2 — propia, pero en un estado que la lista NO admite.
      const enReparto = await sembrar("reparto", tiendaPropia.id, estatus.noEliminable);

      const repo = new OrdenRepository(tx as unknown as PrismaClient);

      // Las tablas que el borrado NO debe tocar, contadas antes.
      const historialAntes = await tx.ordenHistorialEstado.count();
      const gestionesAntes = await tx.gestionOrden.count();

      const resultado = {
        // La lectura scoped: la ajena no se ve NI PARA LEER (por eso el borde responde 404 y no 403).
        leePropia: await repo.findParaEliminacionApi(propia, tiendaPropia.id),
        leeAjena: await repo.findParaEliminacionApi(ajena, tiendaPropia.id),
        // ⭑ EL INTENTO DE BORRAR LO AJENO, con el owner de la key que lo pide.
        borraAjena: await repo.softDeleteViaApi({
          ordenId: ajena,
          ownerId: tiendaPropia.id,
          estadosPermitidos: ESTADOS_ELIMINABLES,
          actorUsuarioId: null, // ficha 362: sin actor congelado; este caso mide el `where`
        }),
        borraEnReparto: await repo.softDeleteViaApi({
          ordenId: enReparto,
          ownerId: tiendaPropia.id,
          estadosPermitidos: ESTADOS_ELIMINABLES,
          actorUsuarioId: null, // ficha 362: sin actor congelado; este caso mide el `where`
        }),
        borraPropia: await repo.softDeleteViaApi({
          ordenId: propia,
          ownerId: tiendaPropia.id,
          estadosPermitidos: ESTADOS_ELIMINABLES,
          actorUsuarioId: null, // ficha 362: sin actor congelado; este caso mide el `where`
        }),
      };
      // Repetir el borrado de la propia: `deleted_at IS NULL` lo hace idempotente.
      const borraPropiaOtraVez = await repo.softDeleteViaApi({
        ordenId: propia,
        ownerId: tiendaPropia.id,
        estadosPermitidos: ESTADOS_ELIMINABLES,
        actorUsuarioId: null, // ficha 362: sin actor congelado, este caso mide el `where`
      });

      const filas = await tx.orden.findMany({
        where: { id: { in: [propia, ajena, enReparto] } },
        select: { id: true, deletedAt: true, estatusId: true },
      });
      const por = new Map(filas.map((f) => [f.id, f]));

      return {
        ...resultado,
        borraPropiaOtraVez,
        historialDelta: (await tx.ordenHistorialEstado.count()) - historialAntes,
        gestionesDelta: (await tx.gestionOrden.count()) - gestionesAntes,
        estado: {
          propia: por.get(propia),
          ajena: por.get(ajena),
          enReparto: por.get(enReparto),
        },
        estatusEsperado: estatus,
      };
    });

    // ⭑ LA FRONTERA: cero filas tocadas al pedir la ajena, y la fila sigue VIVA.
    expect(medido.borraAjena).toBe(0);
    expect(medido.estado.ajena?.deletedAt).toBeNull();
    // Y ni siquiera se puede LEER: el 404 del borde no es una traduccion piadosa, es que no hay dato.
    expect(medido.leeAjena).toBeNull();

    // El estado tambien filtra de verdad en la base.
    expect(medido.borraEnReparto).toBe(0);
    expect(medido.estado.enReparto?.deletedAt).toBeNull();

    // La propia SI se borra, y una sola vez.
    expect(medido.leePropia).not.toBeNull();
    expect(medido.borraPropia).toBe(1);
    expect(medido.estado.propia?.deletedAt).not.toBeNull();
    expect(medido.borraPropiaOtraVez).toBe(0);

    // R7: borrar NO transiciona (el estatus se conserva) y no escribe en ninguna otra tabla.
    expect(medido.estado.propia?.estatusId).toBe(medido.estatusEsperado.eliminable);
    expect(medido.historialDelta).toBe(0);
    expect(medido.gestionesDelta).toBe(0);
  });
});
