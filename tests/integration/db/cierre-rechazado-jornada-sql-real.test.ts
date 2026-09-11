import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 412 (T5.1, R11) — **LA FECHA DEL AVISO SALE DE LAS GESTIONES, NO DEL NACIMIENTO DEL
 * CIERRE**, y eso se mide contra Postgres.
 *
 * POR QUE AQUI Y NO CON UN DOBLE. `findJornadaDeCierre` es UNA CONSULTA CON UN `where`
 * (`gestiones: { where: { anuladaAt: null } }`) MAS UNA CONVERSION DE ZONA HORARIA
 * (`fechaCalendarioCR`). Un doble no ejecuta ninguna de las dos: afirma que se emite el objeto
 * `where` que decimos, que es otra cosa distinta de que ese `where` seleccione las filas
 * correctas. Este repo ya midio cuatro veces que una mutacion de un `where` sobrevive en verde
 * por arriba («probar el WHERE donde vive»).
 *
 * Y el defecto que esto vigila es DE UN DIA, medido contra produccion por la 271 sobre el cierre
 * `79cb2c0f`: `created_at` en hora de Costa Rica = 2026-08-22; la jornada real —la fecha de sus 3
 * gestiones vinculadas— = 2026-08-21. El corte corre a las 00:0x de la madrugada SIGUIENTE a la
 * jornada que cierra, asi que TODO cierre creado por el corte nace fechado un dia por delante del
 * dia que el mensajero trabajo. Decirle «tu cierre del 22 fue rechazado» a quien trabajo el 21 es
 * el aviso confuso que esta ficha viene a no crear.
 *
 * ⚠️ MUTACION QUE ESTE ARCHIVO MATA (design §12.8): anclar la fecha en `cierre_dia.created_at`. El
 * primer caso siembra el cierre el dia D con gestiones del D-1 justamente para que esa mutacion
 * devuelva D y el aserto falle.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si el
 * proceso muere, no queda ni una fila en la base compartida.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde. CON base pero SIN datos, falla
 * RUIDOSAMENTE: un `return` silencioso se leeria como `passed` sin haber comprobado nada.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` es UNIQUE en `orden`. */
const SUFIJO = `412J-${Date.now().toString(36)}`;

/** Instantes CR (Costa Rica es UTC-6 FIJO, sin horario de verano). */
const CR_21_1656 = new Date("2026-08-21T22:56:00.000Z"); // 16:56 CR del 21
const CR_21_1710 = new Date("2026-08-21T23:10:00.000Z"); // 17:10 CR del 21
const CR_20_1400 = new Date("2026-08-20T20:00:00.000Z"); // 14:00 CR del 20
/** El instante en que el corte creo el cierre: 00:03 CR del 22. UN DIA POR DELANTE. */
const CR_22_0003 = new Date("2026-08-22T06:03:15.000Z");

describeSiHayBase("412/R11 · la jornada del cierre rechazado, contra Postgres real", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let mensajeroId: string;

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
    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 1 });
    if (usuarios.length < 1) throw new Error("hacen falta usuarios en la base.");
    mensajeroId = usuarios[0].id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

  async function sembrarCierre(tx: Tx, createdAt: Date) {
    return tx.cierreDia.create({
      data: {
        mensajeroId,
        estado: "rechazado",
        destinoTipo: "bodega_central",
        destinoZonaId: fks.zonaId,
        solicitadoAt: createdAt,
        createdAt,
      },
      select: { id: true },
    });
  }

  /** Vincula al cierre una gestion registrada en `cuando`, con su orden. `marca` va al remision. */
  async function sembrarGestion(
    tx: Tx,
    cierreId: string,
    cuando: Date,
    marca: string,
    anulada = false,
  ) {
    const orden = await tx.orden.create({
      data: {
        numRemision: `R-${SUFIJO}-${marca}`,
        destinatario: "Dest",
        telefonoDest: "88880000",
        producto: "Prod",
        estatusId: fks.estatusId,
        tiendaId: fks.tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
      },
      select: { id: true },
    });
    await tx.gestionOrden.create({
      data: {
        ordenId: orden.id,
        mensajeroId,
        resultado: "entregada",
        cierreId,
        createdAt: cuando,
        ...(anulada ? { anuladaAt: cuando } : {}),
      },
      select: { id: true },
    });
  }

  it("⭑ R11: cierre NACIDO el 22 con gestiones del 21 -> la jornada es el 21, no el 22", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cierre = await sembrarCierre(tx, CR_22_0003);
      await sembrarGestion(tx, cierre.id, CR_21_1656, "A");
      await sembrarGestion(tx, cierre.id, CR_21_1710, "B");

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      // AUTOCOMPROBACION: el escenario es el que se dice que es. Si la siembra no hubiera
      // enganchado ninguna gestion, el metodo caeria en la rama B (el fallback del corte) y
      // devolveria «22 menos un dia» = el 21 POR CASUALIDAD, con el aserto de abajo en verde y sin
      // haber probado la fuente A. Se cuenta antes de creerse nada.
      const vinculadas = await tx.gestionOrden.count({
        where: { cierreId: cierre.id, anuladaAt: null },
      });

      return { jornada: await repo.findJornadaDeCierre(cierre.id), vinculadas };
    });

    expect(medido.vinculadas).toBe(2);
    // ⭑ Con la mutacion «anclar en `created_at`» esto valdria "2026-08-22".
    expect(medido.jornada).toBe("2026-08-21");
  });

  it("⭑ R11: una gestion ANULADA no cuenta como jornada trabajada", async () => {
    // `anulada_at IS NULL` no es cosmetica: con la anulada dentro habria DOS dias distintos y el
    // derivador devolveria `null` (no hay UNA jornada). Que devuelva el 21 demuestra que el
    // `where` la excluyo de verdad.
    const jornada = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cierre = await sembrarCierre(tx, CR_22_0003);
      await sembrarGestion(tx, cierre.id, CR_21_1656, "C");
      await sembrarGestion(tx, cierre.id, CR_20_1400, "D", true); // ANULADA, de otro dia

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      return repo.findJornadaDeCierre(cierre.id);
    });

    expect(jornada).toBe("2026-08-21");
  });

  it("⭑ R12: gestiones de DOS dias distintos -> `null`, y el texto omitira la fecha", async () => {
    // No hay UNA jornada, y elegir una de las dos seria decidir por el mensajero cual de sus dos
    // dias le estamos nombrando. El aviso se queda en «Tu cierre del dia fue rechazado».
    const jornada = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cierre = await sembrarCierre(tx, CR_22_0003);
      await sembrarGestion(tx, cierre.id, CR_21_1656, "E");
      await sembrarGestion(tx, cierre.id, CR_20_1400, "F");

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      return repo.findJornadaDeCierre(cierre.id);
    });

    expect(jornada).toBeNull();
  });

  it("R11 (rama B): cierre SIN ninguna gestion -> el dia CR de su creacion MENOS UN DIA", async () => {
    // Un cierre sin gestiones vinculadas SOLO puede haberlo creado el corte (la via del mensajero
    // exige gestiones), y el corte cierra `startOfDayCR(now) - 1 dia`. Nacido a las 00:03 CR del
    // 22 -> cierra el 21.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cierre = await sembrarCierre(tx, CR_22_0003);

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const vinculadas = await tx.gestionOrden.count({ where: { cierreId: cierre.id } });
      return { jornada: await repo.findJornadaDeCierre(cierre.id), vinculadas };
    });

    expect(medido.vinculadas).toBe(0);
    expect(medido.jornada).toBe("2026-08-21");
  });

  it("cierre inexistente -> `null` (el aviso no se emite, no se inventa una fecha)", async () => {
    const repo = new OrdenRepository(prisma);

    expect(await repo.findJornadaDeCierre("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("⭑ CONTROL de la conversion de huso: una gestion de las 23:30 CR sigue siendo del MISMO dia", async () => {
    // 23:30 CR del 21 son las 05:30 UTC del 22. Con `toISOString().slice(0,10)` —el atajo que este
    // repo prohibe— la jornada saldria «2026-08-22», que es el off-by-one de la ficha 166.
    const jornada = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const cierre = await sembrarCierre(tx, CR_22_0003);
      await sembrarGestion(tx, cierre.id, new Date("2026-08-22T05:30:00.000Z"), "G");

      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      return repo.findJornadaDeCierre(cierre.id);
    });

    expect(jornada).toBe("2026-08-21");
  });
});
