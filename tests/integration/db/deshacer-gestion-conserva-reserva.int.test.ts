import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import type { ITarifaVigenteRepository } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⭑⭑ FEATURE 261 (B12, R16-R20) — DESHACER UNA GESTION NO BORRA UNA RESERVA A FUTURO.
 *
 * ESTE ES EL TEST SIN EL CUAL EL DEFECTO VUELVE EN EL PRIMER REFACTOR, y por eso esta escrito
 * contra Postgres y no con dobles: la regla vive en un `CASE` DENTRO de la sentencia, y ningun
 * doble puede ejecutar un `CASE`. Afirmar el valor de `fecha_reparto` sobre un doble seria una
 * asercion contra su propia fuente — siempre verde, con el defecto suelto.
 *
 * EL DEFECTO, MEDIDO EN PRODUCCION EL 2026-08-21 (no supuesto): la guia 17496963 se gestiono
 * `entregada` a las 22:10 CR del 21 estando reservada para el 22. Al DESHACER esa gestion, a las
 * 22:18, `CierreDiaRepository.anularGestionYDevolverAGestion` devolvio la orden a `en_reparto` y
 * reescribio el dia de reparto a HOY: `fecha_reparto` paso de `2026-08-22` a `2026-08-21`. En
 * silencio. Y con eso la orden quedaba expuesta al corte de esa misma noche.
 *
 * LAS DOS MITADES, Y POR QUE HACEN FALTA LAS DOS. Un test que solo afirmara «se conserva»
 * pasaria tambien con un `SET` que NO TOCARA LA COLUMNA — que es otro defecto, y ademas rompe la
 * invariante 246/R10 («el dia se escribe SIEMPRE en la misma escritura que `asignado_at`»). Por
 * eso aqui estan los tres casos: reserva FUTURA -> se conserva; reserva PASADA -> pasa a hoy;
 * `NULL` -> pasa a hoy.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte. Sin base se SALTA ENTERO y con
 * su nombre en el reporte; con base y sin catalogo REVIENTA, no retorna.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `261-deshacer-${Date.now().toString(36)}`;
const GUIA_BASE = 920_000_000 + (Date.now() % 40_000_000);

/**
 * 22:30 CR del 21 = 04:30Z del 22. La hora del incidente real, y elegida a proposito: el dia UTC
 * y el dia de Costa Rica NO coinciden, asi que un dia derivado con el helper equivocado saldria
 * «22» y la mitad negativa del test se pondria roja.
 */
const NOW = new Date("2026-08-22T04:30:00.000Z");
const HOY = new Date("2026-08-21T00:00:00.000Z");
const MANANA = new Date("2026-08-22T00:00:00.000Z");
const AYER = new Date("2026-08-20T00:00:00.000Z");

/** El resolver de tarifa NO se toca en este camino: `anular...` no lo invoca. */
const tarifaRepoInerte = {
  resolveTarifaPorTienda: async () => null,
} as unknown as ITarifaVigenteRepository;

describeSiHayBase("261/B12 — deshacer y el dia de reparto, contra Postgres real", () => {
  let prisma: PrismaClient;

  /**
   * Siembra UNA orden `entregada` con su gestion vigente y ejecuta `fn`. Todo se revierte.
   * `fechaReparto` es lo unico que cambia entre casos.
   */
  let conOrden: <T>(
    fechaReparto: Date | null,
    fn: (ctx: {
      repo: CierreDiaRepository;
      tx: PrismaClient;
      ordenId: string;
      gestionId: string;
      mensajeroId: string;
      entregadaId: string;
      enRepartoId: string;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    const estados = await prisma.orderStatus.findMany({
      where: { value: { in: ["entregada", "en_reparto"] } },
      select: { id: true, value: true },
    });
    const entregadaId = estados.find((e) => e.value === "entregada")?.id;
    const enRepartoId = estados.find((e) => e.value === "en_reparto")?.id;
    if (!entregadaId || !enRepartoId) {
      throw new Error(
        "el catalogo `order_status` no tiene `entregada` y/o `en_reparto`: sin ellos no hay " +
          "deshacer que medir. Corre el seed del catalogo.",
      );
    }
    // `gestion_orden.mensajero_id` y `orden.mensajero_asignado_id` son FK -> `usuario`. Se reusa
    // el id de la tienda de una orden real: lo que se mide aqui es una SENTENCIA, no un rol.
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
            estatusId: entregadaId,
            tiendaId: fks.tiendaId,
            zonaId: fks.zonaId,
            provinciaId: fks.provinciaId,
            cantonId: fks.cantonId,
            mensajeroAsignadoId: mensajeroId,
            // Un instante VIEJO y distinguible: si el `SET` no reescribiera `asignado_at`, se
            // notaria (y con el, un `SET` que no tocara ninguna de las dos columnas).
            asignadoAt: new Date("2026-08-19T15:00:00.000Z"),
            fechaReparto,
          },
          select: { id: true },
        });
        const gestion = await tx.gestionOrden.create({
          data: {
            ordenId: orden.id,
            mensajeroId,
            resultado: "entregada",
            cierreId: null, // R2: dentro de la ventana de deshacer
          },
          select: { id: true },
        });
        const repo = new CierreDiaRepository(tx as unknown as PrismaClient, tarifaRepoInerte);
        return fn({
          repo,
          tx: tx as unknown as PrismaClient,
          ordenId: orden.id,
          gestionId: gestion.id,
          mensajeroId,
          entregadaId,
          enRepartoId,
        });
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Deshace la gestion sembrada y devuelve la fila de la orden tal como quedo en la base. */
  async function deshacerYLeer(fechaReparto: Date | null) {
    return conOrden(fechaReparto, async (ctx) => {
      const ok = await ctx.repo.anularGestionYDevolverAGestion({
        gestionId: ctx.gestionId,
        ordenId: ctx.ordenId,
        mensajeroId: ctx.mensajeroId,
        actorUsuarioId: ctx.mensajeroId,
        estatusEsperadoId: ctx.entregadaId,
        estatusEnRepartoId: ctx.enRepartoId,
        asignadoAt: NOW,
        diaEnCurso: HOY,
      });
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: {
          estatusId: true,
          mensajeroAsignadoId: true,
          asignadoAt: true,
          fechaReparto: true,
        },
      });
      const gestion = await ctx.tx.gestionOrden.findUniqueOrThrow({
        where: { id: ctx.gestionId },
        select: { anuladaAt: true },
      });
      const historial = await ctx.tx.ordenHistorialEstado.count({
        where: { ordenId: ctx.ordenId, origenTipo: "deshacer_gestion" },
      });
      return { ok, fila, gestion, historial, enRepartoId: ctx.enRepartoId };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Caso 1 — LA RESERVA FUTURA SE CONSERVA                                    */
  /* ------------------------------------------------------------------------ */

  it("⭑ R17: con `fecha_reparto = MAÑANA`, tras deshacer SIGUE siendo mañana", async () => {
    // EL CASO. Antes de la 261 esta asercion daba `2026-08-21` — el defecto medido en produccion.
    const { ok, fila } = await deshacerYLeer(MANANA);

    expect(ok).toBe(true);
    expect(fila.fechaReparto).toEqual(MANANA);
  });

  it("⭑ R16: y `asignado_at` SI se reescribio — el `SET` no es que no toque nada", async () => {
    // LA MITAD QUE IMPIDE EL FALSO VERDE. Sin esto, un `SET` que simplemente no tocara la
    // columna pasaria el caso de arriba — y romperia la invariante 246/R10.
    const { fila } = await deshacerYLeer(MANANA);

    expect(fila.asignadoAt).toEqual(NOW);
    expect(fila.asignadoAt).not.toEqual(new Date("2026-08-19T15:00:00.000Z"));
  });

  it("R18/R19: la orden vuelve a `en_reparto` con su mensajero, y la gestion queda anulada", async () => {
    const { fila, gestion, historial, enRepartoId } = await deshacerYLeer(MANANA);

    expect(fila.estatusId).toBe(enRepartoId);
    expect(fila.mensajeroAsignadoId).not.toBeNull();
    expect(gestion.anuladaAt).not.toBeNull();
    // Y el choke point del historial dejo su fila en la MISMA transaccion.
    expect(historial).toBe(1);
  });

  it("⭑ R20: la fila conservada NO cumple el predicado del corte de esa misma noche", async () => {
    // R20 dicho como consecuencia y no como sintoma. El corte cierra el dia en curso y barre
    // `(fecha_reparto IS NULL OR fecha_reparto <= diaCerrado)`. Con la reserva conservada, esta
    // orden NO entra en ese conjunto — que es exactamente lo que el defecto rompia.
    const alcanzadaPorElCorte = await conOrden(MANANA, async (ctx) => {
      await ctx.repo.anularGestionYDevolverAGestion({
        gestionId: ctx.gestionId,
        ordenId: ctx.ordenId,
        mensajeroId: ctx.mensajeroId,
        actorUsuarioId: ctx.mensajeroId,
        estatusEsperadoId: ctx.entregadaId,
        estatusEnRepartoId: ctx.enRepartoId,
        asignadoAt: NOW,
        diaEnCurso: HOY,
      });
      // El predicado REAL del corte, contra la base, con `diaCerrado = HOY`.
      const barridas = await ctx.tx.orden.findMany({
        where: {
          id: ctx.ordenId,
          OR: [{ fechaReparto: null }, { fechaReparto: { lte: HOY } }],
        },
        select: { id: true },
      });
      return barridas.length;
    });

    expect(alcanzadaPorElCorte).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* Casos 2 y 3 — LA MITAD NEGATIVA: sin reserva futura, el dia pasa a HOY    */
  /* ------------------------------------------------------------------------ */

  it("R18: con `fecha_reparto = AYER`, tras deshacer queda en HOY", async () => {
    // El motivo original de la 246 SIGUE VIGENTE: las dos columnas no pueden contar historias
    // distintas. Una orden «reasignada ahora» con una reserva de ayer describia un dia que ya no
    // existe, y el corte decidiria con un dato muerto.
    const { fila } = await deshacerYLeer(AYER);

    expect(fila.fechaReparto).toEqual(HOY);
  });

  it("R18: con `fecha_reparto = NULL`, tras deshacer queda en HOY (sin caso especial)", async () => {
    // `NULL > x` es `NULL`, que no es `TRUE`, asi que el `NULL` cae por el `ELSE` del `CASE` sin
    // ninguna rama propia. Es lo que ya hacia antes de esta ficha.
    const { fila } = await deshacerYLeer(null);

    expect(fila.fechaReparto).toEqual(HOY);
  });

  it("R18: con `fecha_reparto = HOY` se queda en HOY (el limite es `>`, no `>=`)", async () => {
    // La frontera. Una reserva PARA HOY no es una reserva futura: no hay nada que conservar y el
    // `ELSE` la reescribe con el mismo valor. Si el `CASE` usara `>=`, este caso seguiria verde
    // por casualidad — por eso lo que mata esa mutacion es el caso de AYER, y este solo fija la
    // frontera.
    const { fila } = await deshacerYLeer(HOY);

    expect(fila.fechaReparto).toEqual(HOY);
  });

  /* ------------------------------------------------------------------------ */
  /* Guardias que NO cambian                                                   */
  /* ------------------------------------------------------------------------ */

  it("R5: si la orden ya no esta en el estado esperado, NO se escribe nada (rollback)", async () => {
    // La guardia optimista del `WHERE` sigue viva tras pasar a SQL crudo: `movidas.length === 0`
    // lanza el sentinela y revierte la transaccion entera, incluida la anulacion del paso 1.
    const { ok, fechaReparto, anuladaAt } = await conOrden(MANANA, async (ctx) => {
      const ok = await ctx.repo.anularGestionYDevolverAGestion({
        gestionId: ctx.gestionId,
        ordenId: ctx.ordenId,
        mensajeroId: ctx.mensajeroId,
        actorUsuarioId: ctx.mensajeroId,
        // Estado esperado FALSO: simula que la bodega movio la orden entre la lectura y la
        // escritura.
        estatusEsperadoId: ctx.enRepartoId,
        estatusEnRepartoId: ctx.enRepartoId,
        asignadoAt: NOW,
        diaEnCurso: HOY,
      });
      const fila = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenId },
        select: { fechaReparto: true, estatusId: true },
      });
      const gestion = await ctx.tx.gestionOrden.findUniqueOrThrow({
        where: { id: ctx.gestionId },
        select: { anuladaAt: true },
      });
      return { ok, fechaReparto: fila.fechaReparto, anuladaAt: gestion.anuladaAt };
    });

    expect(ok).toBe(false);
    // Sin efectos parciales: ni el dia se movio ni la gestion quedo anulada.
    expect(fechaReparto).toEqual(MANANA);
    expect(anuladaAt).toBeNull();
  });
});
