import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { CreateOrdenData } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import { ESTADOS_CREACION } from "@/lib/types/order-status-transiciones";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type FksDeOrden,
} from "./_postgres-real";

/**
 * FEATURE 294 — UNA REMISION DE ORDEN BORRADA DEJA DE BLOQUEAR LA CARGA. CONTRA POSTGRES.
 *
 * POR QUE ESTE ARCHIVO EXISTE Y POR QUE CONTRA BASE REAL. El defecto que arregla la ficha vivia
 * EN UN INDICE, y un indice no se puede probar con dobles: `orden_tienda_id_num_remision_key`
 * era `UNIQUE (tienda_id, num_remision)` SIN predicado, asi que una orden borrada seguia
 * ocupando su numero; `findExistingRemisiones` validaba el duplicado mirando solo lo vivo, la
 * fila pasaba la validacion, y `createMany({ skipDuplicates })` la descartaba SIN error. Medido
 * en produccion el 2026-08-27: Nuform confirmo la carga de 3 ordenes, no aparecio NINGUNA y no
 * se creo ni la fila de `carga`. Un test de repositorio con Prisma mockeado habria pasado en
 * verde en todo momento, antes y despues — el mock no tiene indices.
 *
 * QUE SE MIDE:
 *   1. EL INDICE, a pelo: (tienda, remision) de una orden BORRADA se puede volver a usar, y
 *      (tienda, remision) de una orden VIVA sigue siendo imposible.
 *   2. LA CARGA ENTERA, por el repositorio real contra la base real: la remision de una orden
 *      borrada vuelve a entrar —con su fila de `carga`— por las DOS rutas de lote.
 *   3. LO MUDO: una fila que NO entra sale nombrada en `omitidas`, que es lo que el servicio
 *      convierte en `duplicada`.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: pase, falle o muera el proceso,
 * no queda ni una fila en la base compartida. Y se toma el lock de aviso de `_postgres-real`
 * como primera sentencia, porque este archivo escribe en `usuario`/`orden`/`carga` reales.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), que se VE en la salida. CON base pero sin
 * catalogo, FALLA RUIDOSAMENTE: un `return` silencioso se leeria como `passed` sin haber
 * comprobado nada, que es peor que no tener el test.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: aunque todo se revierte, dos corridas simultaneas no deben chocar. */
const SUFIJO = `294-${Date.now().toString(36)}`;

/** Cola de jobs que no escribe nada: el encolado outbox no es lo que mide este archivo. */
const jobsNoOp = {
  enqueue: async () => null,
  claimBatch: async () => [],
  findByDedupeKeys: async () => [],
  complete: async () => {},
  fail: async () => {},
} as unknown as IJobRepository;

describeSiHayBase("294 — el unico PARCIAL de num_remision, contra Postgres real", () => {
  let prisma: PrismaClient;
  let fks: FksDeOrden;
  /** Estado INICIAL legal (ESTADOS_CREACION): `appendCambioEstado` valida `null -> destino`. */
  let estatusInicialId: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "caso. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    fks = encontradas;
    // El `estatusId` que devuelve `fksDeOrden` es el de una orden CUALQUIERA (puede ser
    // `entregada`), y la insercion en lote registra historial `null -> estado`: con un estado
    // que no es de creacion, la guardia de transiciones aborta. Se resuelve el value correcto.
    const inicial = await prisma.orderStatus.findFirst({
      where: { value: ESTADOS_CREACION[0] },
      select: { id: true },
    });
    if (inicial === null) {
      throw new Error(
        `falta el estatus «${ESTADOS_CREACION[0]}» en el catalogo \`order_status\`. Corre ` +
          "`pnpm run db:seed`: sin el, este archivo NO debe pasar en verde.",
      );
    }
    estatusInicialId = inicial.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Una transaccion revertida con el lock tomado y una TIENDA propia recien creada.
   *
   * La tienda es NUEVA en cada caso a proposito: la unicidad que se mide es POR TIENDA, y
   * reutilizar una tienda con historial dejaria el resultado a merced de las remisiones que ya
   * tenga. Con una tienda virgen, cada afirmacion es sobre filas que este test creo.
   */
  async function conTienda<T>(
    fn: (ctx: {
      tx: Prisma.TransactionClient;
      tiendaId: string;
      /** El repositorio REAL, atado a esta misma transaccion (ver `clienteEnTx`). */
      repo: OrdenRepository;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      // Las FKs del usuario (rol, tipo de identificacion) se toman de la TIENDA que ya existe
      // en la base: interesa que sean reales, no cuales son.
      const plantilla = await tx.usuario.findUniqueOrThrow({
        where: { id: fks.tiendaId },
        select: { rolId: true, tipoIdentificacionId: true },
      });
      const marca = `${SUFIJO}-${Math.random().toString(36).slice(2, 8)}`;
      const tienda = await tx.usuario.create({
        data: {
          nombre: `Tienda 294 ${marca}`,
          email: `tienda-${marca}@ordenex.test`,
          telefono: "22220000",
          passwordHash: "x",
          cedula: `294${marca}`,
          tipoIdentificacionId: plantilla.tipoIdentificacionId,
          rolId: plantilla.rolId,
        },
        select: { id: true },
      });
      // El repositorio real, pero con su `$transaction` redirigido a ESTA transaccion. Sin el
      // puente, `createManyOrdenes` abriria una transaccion NUEVA fuera del rollback y dejaria
      // filas en la base compartida. Todo lo demas (delegates, raw) va tal cual al `tx`.
      const clienteEnTx = new Proxy(tx as object, {
        get(target, prop, receiver) {
          if (prop === "$transaction") {
            return async (arg: unknown) =>
              typeof arg === "function"
                ? (arg as (c: unknown) => Promise<unknown>)(target)
                : Promise.all(arg as Promise<unknown>[]);
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as unknown as PrismaClient;
      const repo = new OrdenRepository(clienteEnTx, jobsNoOp);
      return fn({ tx, tiendaId: tienda.id, repo });
    });
  }

  /** INSERT directo de una orden con las FKs reales. `borrada` la marca en el acto. */
  async function sembrarOrden(
    tx: Prisma.TransactionClient,
    tiendaId: string,
    numRemision: string,
    borrada = false,
  ): Promise<string> {
    const fila = await tx.orden.create({
      data: {
        numRemision,
        estatusId: estatusInicialId,
        destinatario: "Destinatario 294",
        telefonoDest: "88880000",
        tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
        producto: "Caja",
        deletedAt: borrada ? new Date() : null,
      },
      select: { id: true },
    });
    return fila.id;
  }

  /** Los datos de una fila de carga masiva para esa tienda. */
  function filaDeCarga(tiendaId: string, numRemision: string): CreateOrdenData {
    return {
      numRemision,
      estatusId: estatusInicialId,
      destinatario: "Destinatario 294",
      telefonoDest: "88880000",
      tiendaId,
      zonaId: fks.zonaId,
      provinciaId: fks.provinciaId,
      cantonId: fks.cantonId,
      distritoId: null,
      producto: "Caja",
      peso: null,
      notas: null,
      // Sin direccion: no hay nada que geocodificar y la cola no entra en juego.
      direccion: null,
      montoCobrar: null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 1 · El indice, a pelo                                              */
  /* ------------------------------------------------------------------ */

  it("EL CASO DE PRODUCCION: borrada la orden, su (tienda, remision) se puede volver a usar", async () => {
    await conTienda(async ({ tx, tiendaId }) => {
      const remision = `REM-${SUFIJO}-VUELVE`;
      const borradaId = await sembrarOrden(tx, tiendaId, remision, true);

      // Con el indice NO parcial esto explota con 23505/P2002 y el test se pone rojo — que es
      // exactamente el estado en el que estuvo produccion hasta el 2026-08-27.
      const nuevaId = await sembrarOrden(tx, tiendaId, remision, false);

      expect(nuevaId).not.toBe(borradaId);
      const todas = await tx.orden.findMany({
        where: { tiendaId, numRemision: remision },
        select: { id: true, deletedAt: true },
      });
      expect(todas).toHaveLength(2);
      expect(todas.filter((o) => o.deletedAt === null)).toHaveLength(1);
    });
  });

  it("EL ARREGLO NO ABRE LA OTRA PUERTA: dos ordenes VIVAS con la misma remision siguen siendo imposibles", async () => {
    await conTienda(async ({ tx, tiendaId }) => {
      const remision = `REM-${SUFIJO}-VIVA`;
      await sembrarOrden(tx, tiendaId, remision, false);

      // Postgres, no una comprobacion nuestra: el indice parcial cubre las filas vivas.
      await expect(sembrarOrden(tx, tiendaId, remision, false)).rejects.toMatchObject({
        code: "P2002",
      });
    });
  });

  it("varias BORRADAS pueden compartir el numero: el predicado las saca a todas de la cuenta", async () => {
    await conTienda(async ({ tx, tiendaId }) => {
      const remision = `REM-${SUFIJO}-N-BORRADAS`;
      await sembrarOrden(tx, tiendaId, remision, true);
      await sembrarOrden(tx, tiendaId, remision, true);
      await sembrarOrden(tx, tiendaId, remision, false);
      const todas = await tx.orden.count({ where: { tiendaId, numRemision: remision } });
      expect(todas).toBe(3);
    });
  });

  /* ------------------------------------------------------------------ */
  /* 2 · La carga entera, por el repositorio real                        */
  /* ------------------------------------------------------------------ */

  it("createManyOrdenes: la remision de una orden borrada ENTRA, y con su fila de `carga`", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const remision = `REM-${SUFIJO}-LOTE`;
      await sembrarOrden(tx, tiendaId, remision, true);

      const res = await repo.createManyOrdenes(
        [filaDeCarga(tiendaId, remision)],
        500,
        { actorUsuarioId: tiendaId, origenTipo: "carga_masiva" },
        { cargaId: null, usuarioCargaId: tiendaId, totalFiles: 1, name: null },
      );

      expect(res.inserted).toBe(1);
      expect(res.omitidas).toEqual([]);
      // El sintoma medido en produccion era que NO se creaba ni la fila de `carga`: el batch
      // salia por el early-return de `hayFilasPorInsertar` porque el snapshot `before` incluia
      // la BORRADA. Este `expect` es el que lo ancla.
      expect(res.cargaId).not.toBeNull();
      const viva = await tx.orden.findFirst({
        where: { tiendaId, numRemision: remision, deletedAt: null },
        select: { cargaId: true },
      });
      expect(viva?.cargaId).toBe(res.cargaId);
    });
  });

  it("createManyOrdenesConGuia: mismo caso, misma respuesta (las dos rutas usan skipDuplicates)", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const remision = `REM-${SUFIJO}-LOTE-GUIA`;
      await sembrarOrden(tx, tiendaId, remision, true);

      const res = await repo.createManyOrdenesConGuia(
        [filaDeCarga(tiendaId, remision)],
        500,
        { actorUsuarioId: tiendaId, origenTipo: "carga_api" },
        { cargaId: null, usuarioCargaId: tiendaId, totalFiles: 1, name: null },
      );

      expect(res.creadas.map((c) => c.numRemision)).toEqual([remision]);
      expect(res.omitidas).toEqual([]);
      expect(res.cargaId).not.toBeNull();
      expect(res.creadas[0].numGuia).not.toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /* 3 · Lo mudo: la fila que no entra, se nombra                        */
  /* ------------------------------------------------------------------ */

  it("createManyOrdenes: una remision VIVA repetida no se duplica Y sale en `omitidas`", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const remision = `REM-${SUFIJO}-OMITIDA`;
      await sembrarOrden(tx, tiendaId, remision, false);

      const res = await repo.createManyOrdenes(
        [filaDeCarga(tiendaId, remision)],
        500,
        { actorUsuarioId: tiendaId, origenTipo: "carga_masiva" },
        { cargaId: null, usuarioCargaId: tiendaId, totalFiles: 1, name: null },
      );

      expect(res.inserted).toBe(0);
      // ESTE es el caso que era invisible: sin `omitidas`, el servicio no tenia forma de
      // enterarse y el resumen seguia diciendo «creada».
      expect(res.omitidas).toEqual([remision]);
      expect(await tx.orden.count({ where: { tiendaId, numRemision: remision } })).toBe(1);
    });
  });

  it("createManyOrdenesConGuia: idem, y la fila saltada NO consume num_guia", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const remision = `REM-${SUFIJO}-OMITIDA-GUIA`;
      await sembrarOrden(tx, tiendaId, remision, false);

      const res = await repo.createManyOrdenesConGuia(
        [filaDeCarga(tiendaId, remision)],
        500,
        { actorUsuarioId: tiendaId, origenTipo: "carga_api" },
        { cargaId: null, usuarioCargaId: tiendaId, totalFiles: 1, name: null },
      );

      expect(res.creadas).toEqual([]);
      expect(res.omitidas).toEqual([remision]);
      const filas = await tx.orden.findMany({
        where: { tiendaId, numRemision: remision },
        select: { numGuia: true },
      });
      expect(filas).toHaveLength(1);
      expect(filas[0].numGuia).toBeNull();
    });
  });

  it("un lote MIXTO reporta cada fila donde le toca: la nueva entra, la repetida se nombra", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const yaViva = `REM-${SUFIJO}-MIX-VIVA`;
      const nueva = `REM-${SUFIJO}-MIX-NUEVA`;
      const deBorrada = `REM-${SUFIJO}-MIX-BORRADA`;
      await sembrarOrden(tx, tiendaId, yaViva, false);
      await sembrarOrden(tx, tiendaId, deBorrada, true);

      const res = await repo.createManyOrdenes(
        [
          filaDeCarga(tiendaId, yaViva),
          filaDeCarga(tiendaId, nueva),
          filaDeCarga(tiendaId, deBorrada),
        ],
        500,
        { actorUsuarioId: tiendaId, origenTipo: "carga_masiva" },
        { cargaId: null, usuarioCargaId: tiendaId, totalFiles: 3, name: null },
      );

      expect(res.inserted).toBe(2);
      expect(res.omitidas).toEqual([yaViva]);
      const vivas = await tx.orden.findMany({
        where: { tiendaId, deletedAt: null },
        select: { numRemision: true },
        orderBy: { numRemision: "asc" },
      });
      expect(vivas.map((o) => o.numRemision).sort()).toEqual([deBorrada, yaViva, nueva].sort());
    });
  });

  /* ------------------------------------------------------------------ */
  /* 4 · El snapshot before/after no resucita a la borrada               */
  /* ------------------------------------------------------------------ */

  it("la orden BORRADA no se cuenta como nueva: ni historial ni `carga_id` nuevos sobre ella", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const remision = `REM-${SUFIJO}-NO-RESUCITA`;
      const borradaId = await sembrarOrden(tx, tiendaId, remision, true);

      await repo.createManyOrdenes(
        [filaDeCarga(tiendaId, remision)],
        500,
        { actorUsuarioId: tiendaId, origenTipo: "carga_masiva" },
        { cargaId: null, usuarioCargaId: tiendaId, totalFiles: 1, name: null },
      );

      // Acotar `before` a lo vivo sin acotar tambien `after` haria que la BORRADA apareciera en
      // `after` sin estar en `beforeIds` y se contara como NUEVA: historial y geocodificacion
      // sobre una orden eliminada. Esto lo cierra.
      const historialDeLaBorrada = await tx.ordenHistorialEstado.count({
        where: { ordenId: borradaId },
      });
      expect(historialDeLaBorrada).toBe(0);
      const borrada = await tx.orden.findUniqueOrThrow({
        where: { id: borradaId },
        select: { cargaId: true, deletedAt: true },
      });
      expect(borrada.cargaId).toBeNull();
      expect(borrada.deletedAt).not.toBeNull();
    });
  });
});
