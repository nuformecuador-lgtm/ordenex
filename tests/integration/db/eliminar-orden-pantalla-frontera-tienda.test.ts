import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { EliminarOrdenService } from "@/lib/services/EliminarOrdenService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ESTADOS_ELIMINABLES } from "@/lib/types/order-status-eliminables";
import { MSG_ORDEN_NO_EXISTE } from "@/lib/services/mensajes-eliminar-orden";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 358 — LA FRONTERA MULTI-TENANT DEL BORRADO **POR PANTALLA**, EJECUTADA CONTRA POSTGRES.
 *
 * QUE SOSTIENE ESTE ARCHIVO, y por que es la razon de ser de la ficha. Hasta el 2026-09-02 este
 * camino solo lo recorria el `maestro`, asi que `softDelete` no acotaba por tienda —su propia
 * cabecera lo decia: «sigue pudiendo borrar cualquier orden porque este service NO acota por
 * tienda»—. Al abrirle el borrado a la TIENDA, esa ausencia deja de ser inocua: sin el
 * `tienda_id` dentro del `where`, la tienda A puede borrar las ordenes de la tienda B. Es la
 * unica cosa de esta ficha que puede salir mal de verdad.
 *
 * POR QUE CONTRA POSTGRES Y NO SOLO CON DOBLES. Es la leccion mas repetida de este repo: un test
 * de servicio con un doble afirma que se LLAMO al repositorio, no que el repositorio seleccione
 * las filas correctas; medido cuatro veces, una mutacion de un `where` sobrevive en verde por
 * arriba. Aqui hay dos tiendas de verdad, ordenes de verdad y un UPDATE de verdad, y se afirma
 * EL CONTEO DE FILAS AFECTADAS, no solo el `status` devuelto.
 *
 * SE ATACA EL `where` POR LOS DOS LADOS, y hacen falta los dos:
 *   - por el SERVICE (que rechaza antes de escribir, con su motivo);
 *   - y SALTANDOSE el service, llamando a `repo.softDelete` con el id ajeno directamente. Este
 *     segundo es el que caza la mutacion que importa: si alguien quita `tiendaId` del `where`
 *     confiando en el `if` del service, el primero sigue verde y este se pone ROJO.
 *
 * CONTRAPRUEBAS APLICADAS (2026-09-02, y revertidas despues):
 *   - quitar `tiendaId` del `where` de `softDelete` -> ROJO aqui («la tienda A borro la de B»),
 *     con la suite de dobles ENTERA en verde.
 *   - quitar la comprobacion de pertenencia del bucle de `EliminarOrdenService` -> ROJO aqui
 *     (el lote ajeno sale «ok» en vez de «conflict»), pero SIN borrar nada: es la prueba de que
 *     la frontera vive en el `where` y no en el `if`.
 *   - devolver «todas» para `adminTienda` en `resolverAlcanceBorradoOrden` -> ROJO aqui.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde: un `return` silencioso dentro
 * del caso se leeria como `passed` sin haber comprobado nada. CON base pero SIN catalogo, falla
 * RUIDOSAMENTE en el `beforeAll`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` es UNICO por tienda entre las ordenes vivas. */
const SUFIJO = `358-${Date.now().toString(36)}`;

/** El maestro no necesita existir en la base: el service solo mira su `rol`. */
const MAESTRO: Actor = { usuarioId: "no-importa-quien", rol: "maestro" };

describeSiHayBase("ficha 358 — una tienda NO puede borrar por pantalla ordenes de otra", () => {
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
        "hacen falta al menos DOS usuarios en la base: uno es la tienda que borra y el otro la " +
          "tienda ajena que demuestra que el `where` filtra por tienda.",
      );
    }

    // `en_bodega_central` es el estado que la ficha 319 hizo eliminable (donde aterriza la orden
    // al generar la guia); `en_reparto` es el NO eliminable mas claro: el paquete va con el
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
    // Los casos se sostienen sobre que `en_bodega_central` SEA eliminable y `en_reparto` no: si
    // la lista cambiara, este archivo estaria midiendo otra cosa sin decirlo.
    expect(ESTADOS_ELIMINABLES).toContain("en_bodega_central");
    expect(ESTADOS_ELIMINABLES).not.toContain("en_reparto");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Siembra el mismo escenario en cada caso: una orden ELIMINABLE de la tienda A (`propia`) y
   * otra ELIMINABLE de la tienda B (`ajena`). Que las dos esten en el mismo estado es lo que
   * aisla la variable: si la ajena sobrevive, es por la tienda y no por el estado.
   */
  async function sembrarEscenario(
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
    clavePrefijo: string,
  ) {
    await serializarEscriturasReales(tx);
    const [tiendaA, tiendaB] = tiendas;
    const sembrar = async (clave: string, tiendaId: string, estatusId: string) =>
      (
        await tx.orden.create({
          data: {
            numRemision: `R-${SUFIJO}-${clavePrefijo}-${clave}`,
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

    return {
      tiendaA: tiendaA.id,
      tiendaB: tiendaB.id,
      propia: await sembrar("propia", tiendaA.id, estatus.eliminable),
      ajena: await sembrar("ajena", tiendaB.id, estatus.eliminable),
      repo: new OrdenRepository(tx as unknown as PrismaClient),
    };
  }

  async function estadoDe(
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
    ids: string[],
  ) {
    const filas = await tx.orden.findMany({
      where: { id: { in: ids } },
      select: { id: true, deletedAt: true },
    });
    return new Map(filas.map((f) => [f.id, f.deletedAt]));
  }

  it("⭑ R2: la tienda A pide borrar la orden de la B — cero filas afectadas y la fila sigue viva", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const esc = await sembrarEscenario(tx, "r2");
      const actorA: Actor = { usuarioId: esc.tiendaA, rol: "adminTienda" };
      const service = new EliminarOrdenService(esc.repo);

      // (a) POR EL SERVICE: rechaza, y con el motivo de «no existe» — el mismo que un id
      //     inventado, para no confirmarle a una tienda que la orden ajena existe.
      const porElService = await service.eliminar({ ordenIds: [esc.ajena] }, actorA);

      // (b) ⭑ SALTANDOSE EL SERVICE: el ataque directo al `where`. Esto es lo que se pone rojo
      //     si alguien quita `tiendaId` de la sentencia confiando en el `if` de arriba.
      const filasAfectadas = await esc.repo.softDelete({
        ids: [esc.ajena],
        ownerId: esc.tiendaA,
      });

      const despues = await estadoDe(tx, [esc.propia, esc.ajena]);
      return {
        porElService,
        filasAfectadas,
        ajena: esc.ajena,
        ajenaBorradaEn: despues.get(esc.ajena),
        propiaBorradaEn: despues.get(esc.propia),
      };
    });

    // ⭑ EL CONTEO REAL DE FILAS, no el status: CERO.
    expect(medido.filasAfectadas).toBe(0);
    // Y la fila de la otra tienda sigue viva en la base.
    expect(medido.ajenaBorradaEn).toBeNull();
    // El service ademas lo dice, y lo dice sin filtrar que la orden existe.
    expect(medido.porElService).toEqual({
      status: "conflict",
      detalle: [{ ordenId: medido.ajena, motivo: MSG_ORDEN_NO_EXISTE }],
    });
    // Nada colateral: la propia tampoco se toco (el lote rechazado no borro nada).
    expect(medido.propiaBorradaEn).toBeNull();
  });

  it("R1: la tienda A SI borra la suya — una fila, y solo la suya", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const esc = await sembrarEscenario(tx, "r1");
      const actorA: Actor = { usuarioId: esc.tiendaA, rol: "adminTienda" };
      const service = new EliminarOrdenService(esc.repo);

      const resultado = await service.eliminar({ ordenIds: [esc.propia] }, actorA);
      // Repetirlo: `deleted_at IS NULL` en el `where` lo hace idempotente.
      const otraVez = await service.eliminar({ ordenIds: [esc.propia] }, actorA);
      const despues = await estadoDe(tx, [esc.propia, esc.ajena]);
      return {
        resultado,
        otraVez,
        propiaBorradaEn: despues.get(esc.propia),
        ajenaBorradaEn: despues.get(esc.ajena),
      };
    });

    expect(medido.resultado).toEqual({ status: "ok", eliminadas: 1 });
    expect(medido.propiaBorradaEn).not.toBeNull();
    // La de la otra tienda, intacta: el borrado alcanzo exactamente una fila.
    expect(medido.ajenaBorradaEn).toBeNull();
    // El segundo intento la ve ya borrada y no vuelve a escribir.
    expect(medido.otraVez).toMatchObject({ status: "conflict" });
  });

  it("R7: lote MIXTO (una suya + una ajena) — todo-o-nada: no se borra NINGUNA", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const esc = await sembrarEscenario(tx, "r7");
      const actorA: Actor = { usuarioId: esc.tiendaA, rol: "adminTienda" };
      const service = new EliminarOrdenService(esc.repo);

      const resultado = await service.eliminar(
        { ordenIds: [esc.propia, esc.ajena] },
        actorA,
      );
      const despues = await estadoDe(tx, [esc.propia, esc.ajena]);
      return {
        resultado,
        ajena: esc.ajena,
        propiaBorradaEn: despues.get(esc.propia),
        ajenaBorradaEn: despues.get(esc.ajena),
      };
    });

    expect(medido.resultado).toEqual({
      status: "conflict",
      detalle: [{ ordenId: medido.ajena, motivo: MSG_ORDEN_NO_EXISTE }],
    });
    // Todo-o-nada: la propia, que SI era borrable, tampoco se borro.
    expect(medido.propiaBorradaEn).toBeNull();
    expect(medido.ajenaBorradaEn).toBeNull();
  });

  it("R3: el `maestro` sigue borrando CUALQUIERA — las dos tiendas en el mismo lote", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const esc = await sembrarEscenario(tx, "r3");
      const service = new EliminarOrdenService(esc.repo);

      const resultado = await service.eliminar(
        { ordenIds: [esc.propia, esc.ajena] },
        MAESTRO,
      );
      const despues = await estadoDe(tx, [esc.propia, esc.ajena]);
      return {
        resultado,
        propiaBorradaEn: despues.get(esc.propia),
        ajenaBorradaEn: despues.get(esc.ajena),
      };
    });

    // El recorte nuevo NO le rompe su camino: dos filas, de dos tiendas distintas.
    expect(medido.resultado).toEqual({ status: "ok", eliminadas: 2 });
    expect(medido.propiaBorradaEn).not.toBeNull();
    expect(medido.ajenaBorradaEn).not.toBeNull();
  });

  it("R2b: el estado sigue filtrando en la base para la tienda (no solo la tienda)", async () => {
    // La frontera nueva no puede haber tapado la vieja: una orden PROPIA en `en_reparto` sigue
    // sin poder borrarse, y el `where` de `softDelete` no la excluye —lo hace el predicado del
    // service—, asi que aqui se mide el camino completo.
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      const esc = await sembrarEscenario(tx, "r2b");
      const enReparto = (
        await tx.orden.create({
          data: {
            numRemision: `R-${SUFIJO}-r2b-reparto`,
            destinatario: "Dest",
            telefonoDest: "88880000",
            producto: "Prod",
            estatusId: estatus.noEliminable,
            tiendaId: esc.tiendaA,
            zonaId: fks.zonaId,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
          },
          select: { id: true },
        })
      ).id;
      const actorA: Actor = { usuarioId: esc.tiendaA, rol: "adminTienda" };
      const service = new EliminarOrdenService(esc.repo);

      const resultado = await service.eliminar({ ordenIds: [enReparto] }, actorA);
      const despues = await estadoDe(tx, [enReparto]);
      return { resultado, borradaEn: despues.get(enReparto) };
    });

    expect(medido.resultado).toMatchObject({ status: "conflict" });
    expect(medido.borradaEn).toBeNull();
  });
});
