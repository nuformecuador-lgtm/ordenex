import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 271 (T5.3, R35/R37) — **M7**: APROBAR UN CIERRE LIBERA SOLO LAS ORDENES DE **ESE** CIERRE.
 *
 * EL FALLO QUE ESTE ARCHIVO CIERRA. La liberacion de `sin_gestionar` seleccionaba las ordenes por
 * `{ mensajeroAsignadoId, estatusId: sin_gestionar }` — POR MENSAJERO, NO POR CIERRE—. Con el
 * invariante 109/R30 vivo (un solo cierre abierto) daba lo mismo: todas las `sin_gestionar` del
 * mensajero eran de ese cierre. La ficha 271 DEROGA ese invariante (R9), y desde entonces aprobar
 * el 1.º VACIA TAMBIEN LA MANO DEL 2.º: sus ordenes vuelven a bodega, pierden mensajero y se marcan
 * prioritarias, mientras su cierre sigue abierto y ya no tiene nada que liberar.
 *
 * ⚠️ Y NADA SE PONE ROJO SOLO: el `updateMany` reporta filas movidas, todas sus guardas se cumplen
 * y el historial registra la transicion. Es un FALLO MUDO — por eso este test existe y por eso va
 * contra POSTGRES: lo que cambia es un `where`, y los tests de servicio usan dobles que no ven el
 * SQL.
 *
 * SIN BASE ALCANZABLE se SALTA, no pasa en verde.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `271m7-${Date.now().toString(36)}`;
const ALCANCE_TOTAL: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

/**
 * Dobles NO-OP de los cuatro libros de dinero. Este archivo mide UN `where` de `orden`, no la caja:
 * cada libro tiene sus propios tests de idempotencia (`wallet-idempotencia.test.ts`). Se declaran
 * como no-op y no se omiten, porque `resolverCierre` los invoca en la rama `aprobado`.
 */
function dineroNoOp() {
  return [
    { crearMovimientos: vi.fn(async () => 0) }, // walletMovimientoRepo (42)
    { construirMovimientosDeIngreso: vi.fn(async () => []) }, // walletFeedService (42)
    { crearMovimientos: vi.fn(async () => 0) }, // walletTiendaMovimientoRepo (43)
    { construirMovimientosPorTienda: vi.fn(async () => []) }, // walletTiendaFeedService (43)
    { crearMovimientos: vi.fn(async () => 0) }, // pagoMensajeroMovimientoRepo (44)
    { construirMovimientosDePago: vi.fn(async () => ({ libro: [], egresoCaja: [] })) }, // (44)
    { construirEgresoIndemnizacion: vi.fn(async () => []) }, // indemnizacion (158)
  ] as const;
}

describeSiHayBase("271/T5.3 · M7 — aprobar libera SOLO las ordenes de su cierre", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let estatus: Map<string, string>;
  let usuarios: { id: string }[];

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
    const catalogo = await prisma.orderStatus.findMany({
      where: { value: { in: ["sin_gestionar", "en_bodega_central", "en_bodega_satelite"] } },
      select: { id: true, value: true },
    });
    estatus = new Map(catalogo.map((c) => [c.value, c.id]));
    for (const v of ["sin_gestionar", "en_bodega_central", "en_bodega_satelite"]) {
      if (!estatus.has(v)) {
        throw new Error(
          `falta el estatus «${v}» en \`order_status\`. Corre \`pnpm run db:seed\`: sin el, este ` +
            "archivo no puede sembrar el corpus y NO debe pasar en verde.",
        );
      }
    }
    usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 2 });
    if (usuarios.length < 2) throw new Error("hacen falta al menos DOS usuarios en la base.");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Siembra DOS cierres abiertos del MISMO mensajero, cada uno con SUS propias ordenes barridas a
   * `sin_gestionar` y registradas en `cierre_sin_gestion`, y aprueba el PRIMERO.
   *
   * `sinGestionRegistrado` es el parametro del caso: `true` = cierre posterior a la 264 (sabe que
   * barrio); `false` = cierre ANTERIOR, cuya lista es irrecuperable.
   */
  async function aprobarElPrimero(sinGestionRegistrado: boolean) {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [mensajero, admin] = usuarios;
      const sinGestionar = estatus.get("sin_gestionar") as string;

      const nuevoCierre = () =>
        tx.cierreDia.create({
          data: {
            mensajeroId: mensajero.id,
            estado: "solicitado",
            destinoTipo: "bodega_central",
            destinoZonaId: fks.zonaId,
            sinGestionRegistrado,
          },
          select: { id: true },
        });

      const cierreA = await nuevoCierre();
      const cierreB = await nuevoCierre(); // el SEGUNDO cierre del MISMO mensajero

      const sembrarOrden = async (cierreId: string, clave: string) => {
        const numRemision = `R-${SUFIJO}-${clave}`;
        const orden = await tx.orden.create({
          data: {
            numRemision,
            destinatario: "Dest",
            telefonoDest: "88880000",
            producto: "Prod",
            estatusId: sinGestionar, // ya barrida por el corte
            mensajeroAsignadoId: mensajero.id,
            tiendaId: fks.tiendaId,
            zonaId: fks.zonaId,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
          },
          select: { id: true },
        });
        await tx.cierreSinGestion.create({
          data: {
            cierreId,
            ordenId: orden.id,
            numRemision,
            destinatario: "Dest",
            producto: "Prod",
            tiendaNombre: "Tienda",
            zonaNombre: "Zona",
          },
          select: { id: true },
        });
        return orden.id;
      };

      const deA = await sembrarOrden(cierreA.id, "a1");
      const deB = await sembrarOrden(cierreB.id, "b1");

      // `resolverCierre` abre su propia `$transaction`, y un cliente transaccional de Prisma no la
      // expone. El proxy la resuelve invocando el callback con LA MISMA tx: el SQL que se ejecuta
      // es el REAL, y todo sigue dentro de la transaccion que se revierte al final.
      const cliente = new Proxy(tx as object, {
        get(target, prop, receiver) {
          if (prop === "$transaction") {
            return async (fn: (t: unknown) => Promise<unknown>) => fn(target);
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as unknown as PrismaClient;

      const [wm, wf, wtm, wtf, pmm, wmf, wif] = dineroNoOp();
      const repo = new CierresAdminRepository(
        cliente,
        wm as never,
        wf as never,
        wtm as never,
        wtf as never,
        pmm as never,
        wmf as never,
        wif as never,
      );

      await repo.resolverCierre({
        cierreId: cierreA.id,
        alcance: ALCANCE_TOTAL,
        nuevoEstado: "aprobado",
        resueltoPor: admin.id,
        anclajeDevolucion: undefined,
        confirmacionFisica: [],
        indemnizaciones: [],
        liberacionSinGestionar: {
          sinGestionarEstatusId: sinGestionar,
          enBodegaEstatusId: estatus.get("en_bodega_central") as string,
          enBodegaSateliteEstatusId: estatus.get("en_bodega_satelite") as string,
          centralZonaId: fks.zonaId,
        },
      } as never);

      const filas = await tx.orden.findMany({
        where: { id: { in: [deA, deB] } },
        select: { id: true, estatusId: true, mensajeroAsignadoId: true, prioridad: true },
      });
      const por = new Map(filas.map((f) => [f.id, f]));
      return { a: por.get(deA), b: por.get(deB), sinGestionar };
    });
  }

  it("R35/R37: aprobar el 1.er cierre libera SU orden y NO toca la del 2.º", async () => {
    const { a, b, sinGestionar } = await aprobarElPrimero(true);

    // La del cierre APROBADO se libera: cambia de estatus, pierde mensajero y sale prioritaria.
    expect(a?.estatusId).not.toBe(sinGestionar);
    expect(a?.mensajeroAsignadoId).toBeNull();
    expect(a?.prioridad).toBe(true);

    // ⭑ LA MITAD QUE M7 ROMPIA: la del OTRO cierre sigue EXACTAMENTE donde estaba. Su cierre
    // sigue abierto y su paquete sigue en la mano del mensajero.
    expect(b?.estatusId).toBe(sinGestionar);
    expect(b?.mensajeroAsignadoId).not.toBeNull();
    expect(b?.prioridad).toBe(false);
  });

  it("T5.2/R35: con `sin_gestion_registrado = false` (cierre viejo) SI libera — no calla en silencio", async () => {
    // El caso que se olvida. `sin_gestion_registrado` marca con `false` los cierres ANTERIORES al
    // registro de la 264, cuya lista es IRRECUPERABLE. Con la bandera en `false` se CONSERVA el
    // comportamiento de siempre (por mensajero) en vez de liberar CERO ordenes en silencio: un
    // `[]` implicito ahi seria un fallo mudo NUEVO, y esta ficha existe para cerrar tres, no para
    // abrir el cuarto.
    const { a, b, sinGestionar } = await aprobarElPrimero(false);

    expect(a?.estatusId).not.toBe(sinGestionar);
    expect(a?.mensajeroAsignadoId).toBeNull();
    // Y la del otro cierre TAMBIEN se libera, que es el comportamiento anterior conservado a
    // sabiendas: sin la lista no hay forma de distinguirlas, y liberar de mas es recuperable
    // (bodega la reasigna) mientras que liberar cero deja la orden atrapada para siempre.
    expect(b?.estatusId).not.toBe(sinGestionar);
  });
});
