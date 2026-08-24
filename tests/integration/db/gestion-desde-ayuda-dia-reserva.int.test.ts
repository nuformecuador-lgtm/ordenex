import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { OrdenParaHilo } from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { GestionDesdeAyudaInput } from "@/lib/interfaces/services/IGestionDesdeAyudaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { GestionDesdeAyudaService } from "@/lib/services/GestionDesdeAyudaService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 261 (B18, R30) — LA PUERTA B DE LA TIENDA: el `where` del `updateMany`, contra Postgres.
 *
 * ⚠️ POR QUE HACE FALTA ESTE ARCHIVO teniendo ya el de servicio. Con dobles, quitarle el `OR` del
 * dia al `where` NO ROMPE NADA: el doble acepta cualquier objeto. Este es un `updateMany` de
 * Prisma y no SQL crudo, pero sigue siendo LA DECISION EN LA ESCRITURA — la que gana la carrera
 * si la reserva cambia entre la comprobacion del servicio (R29) y la escritura.
 *
 * COMO SE PRUEBA LA CARRERA SIN CARRERA: el servicio recibe un doble de `findOrdenParaHilo` que
 * MIENTE —dice que la orden no tiene reserva— mientras la fila REAL de la base si la tiene. Eso
 * es exactamente el estado que produce la carrera, y deja al `where` como unica defensa. La otra
 * mitad del caso es la COMPENSACION: las fotos ya subidas se retiran.
 *
 * Sin base se SALTA ENTERO; con base y sin catalogo REVIENTA, no retorna. Todo dentro de una
 * transaccion que siempre se revierte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `261-ayuda-${Date.now().toString(36)}`;
const GUIA_BASE = 930_000_000 + (Date.now() % 40_000_000);

const HOY = new Date("2026-08-21T00:00:00.000Z");
const MANANA = new Date("2026-08-22T00:00:00.000Z");
/** 22:30 CR del 21 = 04:30Z del 22. */
const NOW = new Date("2026-08-22T04:30:00.000Z");

const RECHAZO: GestionDesdeAyudaInput = {
  ordenId: "", // se rellena por caso
  resultado: "rechazada",
  motivo: "el cliente no la quiere",
  evidencias: [
    { contentType: "image/jpeg", bytes: new Uint8Array([0]) },
    { contentType: "image/png", bytes: new Uint8Array([1]) },
  ],
};

function colaFake() {
  return {
    enqueue: vi.fn(async () => null),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
}

describeSiHayBase("261/B18 — el `where` del `updateMany` de la tienda, contra Postgres", () => {
  let prisma: PrismaClient;

  let conOrden: <T>(
    fechaReparto: Date | null,
    fn: (ctx: {
      tx: PrismaClient;
      ordenId: string;
      tiendaId: string;
      mensajeroId: string;
      ayudaId: string;
      rechazadaId: string;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` antes de esta suite.",
      );
    }
    const estados = await prisma.orderStatus.findMany({
      where: { value: { in: ["ayuda_tienda", "rechazada"] } },
      select: { id: true, value: true },
    });
    const ayudaId = estados.find((e) => e.value === "ayuda_tienda")?.id;
    const rechazadaId = estados.find((e) => e.value === "rechazada")?.id;
    if (!ayudaId || !rechazadaId) {
      throw new Error(
        "el catalogo `order_status` no tiene `ayuda_tienda` y/o `rechazada`: sin ellos no hay " +
          "transicion que medir. Corre el seed del catalogo.",
      );
    }
    const mensajeroId = fks.tiendaId;
    let n = 0;

    conOrden = (fechaReparto, fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        n += 1;
        const orden = await tx.orden.create({
          data: {
            numGuia: GUIA_BASE + n,
            numRemision: `R-${SUFIJO}-${n}`,
            destinatario: "Corpus 261",
            telefonoDest: "88880000",
            producto: "caja",
            estatusId: ayudaId,
            tiendaId: fks.tiendaId,
            zonaId: fks.zonaId,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
            mensajeroAsignadoId: mensajeroId,
            asignadoAt: new Date("2026-08-19T15:00:00.000Z"),
            fechaReparto,
          },
          select: { id: true },
        });
        return fn({
          tx: tx as unknown as PrismaClient,
          ordenId: orden.id,
          tiendaId: fks.tiendaId,
          mensajeroId,
          ayudaId,
          rechazadaId,
        });
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Monta el servicio REAL sobre el repositorio REAL (dentro de la tx en curso).
   *
   * `fechaRepartoQueVeElServicio` es lo que devuelve el doble de `findOrdenParaHilo`, y puede
   * MENTIR respecto a la fila sembrada. Esa mentira ES el punto del archivo: pasarle `null`
   * mientras la fila real esta reservada reproduce el estado que deja la carrera —la reserva
   * cambio entre la comprobacion (R29) y la escritura— y deja al `where` como UNICA defensa.
   */
  function montarServicio(
    ctx: {
      tx: PrismaClient;
      tiendaId: string;
      mensajeroId: string;
      ayudaId: string;
      rechazadaId: string;
    },
    fechaRepartoQueVeElServicio: Date | null,
  ) {
    const storage: IFileStorage = {
      upload: vi.fn(async (input: { path: string }) => input.path),
      remove: vi.fn(async () => {}),
    };
    const orden: OrdenParaHilo = {
      tiendaId: ctx.tiendaId,
      mensajeroAsignadoId: ctx.mensajeroId,
      estatusValue: "ayuda_tienda",
      deletedAt: null,
      fechaReparto: fechaRepartoQueVeElServicio,
    };
    const service = new GestionDesdeAyudaService({
      notaRepo: { findOrdenParaHilo: vi.fn(async () => orden) },
      ordenRepo: {
        findEstatusIdByValue: vi.fn(async (v: string) =>
          v === "ayuda_tienda" ? ctx.ayudaId : ctx.rechazadaId,
        ),
      },
      gestionRepo: new GestionOrdenRepository(ctx.tx, colaFake() as never),
      storage,
    // FEATURE 273 (T5): la dependencia del tope es OBLIGATORIA. Con el doble a 0 intentos, la
    // puerta del paso 5-ter no se cierra y estos casos siguen midiendo lo que median.
      historial: fakeIntentosEnLote(),
    });
    const actor: Actor = { usuarioId: ctx.tiendaId, rol: "adminTienda" };
    return { service, storage, actor };
  }

  it("⭑ R30: con la puerta A saltada, el `updateMany` NO transiciona la orden reservada", async () => {
    const r = await conOrden(MANANA, async (ctx) => {
      // La fila REAL esta reservada para mañana; el doble del hilo dice `null`. El unico que
      // puede parar esto es el `where` de la escritura.
      const { service, storage, actor } = montarServicio(ctx, null);

      const resultado = await service.gestionar({ ...RECHAZO, ordenId: ctx.ordenId }, actor, NOW);

      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { estatusId: true },
      });
      return {
        resultado,
        estatusDespues: fila.estatusId,
        ayudaId: ctx.ayudaId,
        gestiones: await ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } }),
        historial: await ctx.tx.ordenHistorialEstado.count({ where: { ordenId: ctx.ordenId } }),
        subidas: (storage.upload as ReturnType<typeof vi.fn>).mock.calls.length,
        retiradas: (storage.remove as ReturnType<typeof vi.fn>).mock.calls,
      };
    });

    // La escritura la rechazo la BASE, no el servicio: `count === 0` -> `null` -> `conflict`.
    expect(r.resultado.status).toBe("conflict");
    // Y la orden sigue EXACTAMENTE donde estaba: ni transicion, ni gestion, ni historial.
    expect(r.estatusDespues).toBe(r.ayudaId);
    expect(r.gestiones).toBe(0);
    expect(r.historial).toBe(0);
    // ⭑ La compensacion: las dos fotos que se subieron por el camino se RETIRAN.
    expect(r.subidas).toBe(2);
    expect(r.retiradas).toHaveLength(1);
    expect(r.retiradas[0][0]).toHaveLength(2);
  });

  it("la mitad positiva: sin reserva, la MISMA llamada SI transiciona y crea la gestion", async () => {
    // Sin esto, el caso de arriba pasaria tambien con un servicio que no hiciera nada nunca.
    const r = await conOrden(null, async (ctx) => {
      const { service, storage, actor } = montarServicio(ctx, null);

      const resultado = await service.gestionar({ ...RECHAZO, ordenId: ctx.ordenId }, actor, NOW);

      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { estatusId: true },
      });
      return {
        resultado,
        estatusDespues: fila.estatusId,
        rechazadaId: ctx.rechazadaId,
        gestiones: await ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } }),
        retiradas: (storage.remove as ReturnType<typeof vi.fn>).mock.calls.length,
      };
    });

    expect(r.resultado.status).toBe("ok");
    expect(r.estatusDespues).toBe(r.rechazadaId);
    expect(r.gestiones).toBe(1);
    expect(r.retiradas).toBe(0); // nada que compensar
  });

  it("R30: reservada para HOY -> el `where` la deja pasar (`lte`, no `lt`)", async () => {
    // Mutacion gemela de M-e por esta puerta: con `lt`, la tienda no podria resolver una orden
    // reservada PARA HOY, que es justo el dia en el que se puede.
    const r = await conOrden(HOY, async (ctx) => {
      const { service, actor } = montarServicio(ctx, HOY);
      const resultado = await service.gestionar({ ...RECHAZO, ordenId: ctx.ordenId }, actor, NOW);
      return {
        resultado,
        gestiones: await ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } }),
      };
    });

    expect(r.resultado.status).toBe("ok");
    expect(r.gestiones).toBe(1);
  });

  it("una reserva PASADA tampoco bloquea la escritura", async () => {
    const r = await conOrden(new Date("2026-08-20T00:00:00.000Z"), async (ctx) => {
      const { service, actor } = montarServicio(ctx, null);
      const resultado = await service.gestionar({ ...RECHAZO, ordenId: ctx.ordenId }, actor, NOW);
      return {
        resultado,
        gestiones: await ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } }),
      };
    });

    expect(r.resultado.status).toBe("ok");
    expect(r.gestiones).toBe(1);
  });

  it("la guardia VIEJA sigue viva: si la orden ya salio de ayuda, tampoco se escribe", async () => {
    // No-regresion: la condicion del dia se SUMA a la de estatus, no la sustituye. Si alguien
    // reescribiera el `where` en vez de añadirle una condicion, esto lo caza.
    const r = await conOrden(null, async (ctx) => {
      // El mensajero gano la carrera y recupero la orden.
      await ctx.tx.orden.update({
        where: { id: ctx.ordenId },
        data: { estatusId: ctx.rechazadaId },
      });
      const { service, actor } = montarServicio(ctx, null);
      const resultado = await service.gestionar({ ...RECHAZO, ordenId: ctx.ordenId }, actor, NOW);
      return {
        resultado,
        gestiones: await ctx.tx.gestionOrden.count({ where: { ordenId: ctx.ordenId } }),
      };
    });

    expect(r.resultado.status).toBe("conflict");
    expect(r.gestiones).toBe(0);
  });
});
