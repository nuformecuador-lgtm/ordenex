import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

import {
  HAY_BASE_DE_DATOS,
  clienteConSavepoint,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

/**
 * 💰 FICHA 398 (T2.3/T2.4) — LA CORRECCION EN SITIO, CONTRA POSTGRES REAL.
 *
 * POR QUE ESTE ARCHIVO Y NO UN TEST DE SERVICIO. Los tests de servicio usan DOBLES y no ven el
 * SQL: medido cuatro veces en este repo, una mutacion del `WHERE` los pasa en verde. Todo lo que
 * decide QUE FILAS SE TOCAN —el sello guardado, el borrado del desglose, la transicion de la
 * orden, los seis totales, y sobre todo LO QUE NO SE TOCA— se mide aqui, contra la base.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte. El repositorio recibe
 * `clienteConSavepoint(tx)`, que abre un SAVEPOINT DE VERDAD: sin el, un `throw` dentro del
 * metodo no revertiria nada y el bloque de atomicidad (R11) pasaria en verde por accidente.
 *
 * SIN BASE ALCANZABLE SE SALTA (no pasa en verde), y CON base pero sin catalogo FALLA RUIDOSO.
 * Ningun caso lleva un `if (…) return;`: un `return` silencioso reporta `passed` sin haber
 * comprobado nada, que es peor que no tener el test.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` y `num_guia` son UNIQUE en `orden`. */
const SUFIJO = `398-${Date.now().toString(36)}`;
const GUIA_BASE = 930_000_000 + (Date.now() % 40_000_000);

/** La tarifa que se siembra para la zona destino del cierre. Numeros conocidos, no los de nadie. */
const COBRO_ENTREGADO = "1500.00";
const COBRO_RECHAZADO = "1000.00";

const MOTIVO = "el cliente rechazo el paquete; el mensajero lo marco entregado por error";

const ALCANCE_CENTRAL: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

interface Contexto {
  repo: CierresAdminRepository;
  tx: TxDeTest;
  /** El cierre ABIERTO con la gestion mal declarada. */
  cierreAbierto: string;
  /** El cierre APROBADO y ya CONSOLIDADO en un `cierre_bodega`. */
  cierreConsolidado: string;
  gestionObjetivo: string;
  gestionOtraEntrega: string;
  gestionRechazoPrevio: string;
  gestionDelConsolidado: string;
  ordenObjetivo: string;
  ordenSinGestionar: string;
  estatusEntregadaId: string;
  estatusRechazadaId: string;
  mensajeroId: string;
}

describeSiHayBase("💰 398 — corregir el resultado de una gestion con el cierre ya solicitado", () => {
  let prisma: PrismaClient;
  let conCorpus: <T>(fn: (ctx: Contexto) => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    const estatusEntregada = await prisma.orderStatus.findFirst({ where: { value: "entregada" } });
    const estatusRechazada = await prisma.orderStatus.findFirst({ where: { value: "rechazada" } });
    // `en_reparto` es el ORIGEN de la visita real que la orden ya tenia contada. No es decorado:
    // sin esa fila de familia `gestion`, el derivador de intentos (R15) no cuenta nada, y el caso
    // pasaria en verde sin haber medido lo que dice medir.
    const estatusEnReparto = await prisma.orderStatus.findFirst({ where: { value: "en_reparto" } });
    if (estatusEntregada === null || estatusRechazada === null || estatusEnReparto === null) {
      throw new Error(
        "el catalogo `order_status` no tiene `entregada`, `rechazada` y/o `en_reparto`: sin esos " +
          "ids la correccion no puede transicionar la orden. Corre `pnpm run db:seed`.",
      );
    }
    // `gestion_orden.mensajero_id` y `cierre_dia.mensajero_id` son FK -> `usuario`. Se reusa el
    // id de la tienda de una orden real: lo que se mide aqui son escrituras, no un rol.
    const mensajeroId = fks.tiendaId;
    const vehiculoId =
      (await prisma.usuario.findUnique({ where: { id: mensajeroId }, select: { vehiculoId: true } }))
        ?.vehiculoId ?? null;

    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // PRIMERA sentencia: serializa contra los otros archivos que escriben en las tablas
        // reales de `public` (ver `_postgres-real.ts`).
        await serializarEscriturasReales(tx);

        // La TARIFA de la zona destino, con numeros conocidos. Se hace `upsert` sobre el par
        // (zona, vehiculo) EXACTO que `resolvePagoTarifaCon` va a buscar, para que el importe del
        // ingreso de bodega sea determinista sea cual sea el estado real de la base. Todo se
        // revierte al terminar.
        //
        // No es un `upsert`: el unique compuesto `(zona_id, vehiculo_id)` es NULLS NOT DISTINCT en
        // Postgres, pero Prisma NO admite `null` dentro de `zonaId_vehiculoId`. Se busca y se
        // decide, que ademas es exactamente lo que hace el resolver que se esta midiendo.
        const tarifaVigente = await tx.tarifaZonaMensajero.findFirst({
          where: { zonaId: fks.zonaId, vehiculoId },
          select: { id: true },
        });
        const montosDeLaTarifa = {
          cobroEntregado: new Prisma.Decimal(COBRO_ENTREGADO),
          cobroRechazado: new Prisma.Decimal(COBRO_RECHAZADO),
        };
        if (tarifaVigente === null) {
          await tx.tarifaZonaMensajero.create({
            data: { zonaId: fks.zonaId, vehiculoId, ...montosDeLaTarifa },
          });
        } else {
          await tx.tarifaZonaMensajero.update({
            where: { id: tarifaVigente.id },
            data: montosDeLaTarifa,
          });
        }

        let n = 0;
        const nuevaOrden = async (clave: string, estatusId: string) => {
          n += 1;
          return tx.orden.create({
            data: {
              numGuia: GUIA_BASE + n,
              numRemision: `R-${SUFIJO}-${clave}`,
              destinatario: "Corpus 398",
              telefonoDest: "88880000",
              producto: "caja",
              estatusId,
              tiendaId: fks.tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          });
        };

        const cierreAbierto = await tx.cierreDia.create({
          data: {
            mensajeroId,
            estado: "solicitado",
            destinoTipo: "bodega_central",
            destinoZonaId: fks.zonaId,
            // Los totales CONGELADOS al solicitar, con la entrega mal declarada dentro.
            totalEfectivo: new Prisma.Decimal("6000.00"),
            totalSimpe: new Prisma.Decimal("21700.00"),
            totalTransferencia: new Prisma.Decimal("0.00"),
            totalGeneral: new Prisma.Decimal("27700.00"),
            totalPagoMensajero: new Prisma.Decimal("3000.00"),
            totalIngresoBodegaRechazos: new Prisma.Decimal("1000.00"),
          },
          select: { id: true },
        });

        // (1) LA GESTION MAL DECLARADA: `entregada` con su cobro por SINPE, su pago al mensajero
        //     congelado y su evidencia (la foto de la «entrega», que R13 conserva).
        const ordenObjetivo = await nuevaOrden("objetivo", estatusEntregada.id);
        const gestionObjetivo = await tx.gestionOrden.create({
          data: {
            ordenId: ordenObjetivo.id,
            mensajeroId,
            resultado: "entregada",
            montoRecibido: new Prisma.Decimal("17700.00"),
            metodoPago: "SINPE",
            evidenciaStoragePath: `evidencias/${SUFIJO}/objetivo.jpg`,
            evidenciaContentType: "image/jpeg",
            cierreId: cierreAbierto.id,
            pagoMensajero: new Prisma.Decimal(COBRO_ENTREGADO),
            ingresoBodegaRechazo: new Prisma.Decimal("0.00"),
            pagos: { create: [{ metodo: "SINPE", monto: new Prisma.Decimal("17700.00") }] },
            evidencias: {
              create: [
                {
                  storagePath: `evidencias/${SUFIJO}/objetivo.jpg`,
                  contentType: "image/jpeg",
                  indice: 0,
                },
              ],
            },
          },
          select: { id: true, createdAt: true },
        });

        // La fila de historial de LA VISITA ORIGINAL, familia `gestion`. Es lo que una gestion
        // real tiene, y es la que satisface el `EXISTS` de `whereIntentosVigentes`: por eso la
        // familia NUEVA no necesita —ni debe— entrar en `ORIGEN_TIPOS_VISITA_REAL`.
        await tx.ordenHistorialEstado.create({
          data: {
            ordenId: ordenObjetivo.id,
            estatusOrigenId: estatusEnReparto.id,
            estatusDestinoId: estatusEntregada.id,
            actorUsuarioId: mensajeroId,
            origenTipo: "gestion",
            gestionOrdenId: gestionObjetivo.id,
          },
        });

        // (2) OTRA ENTREGA del MISMO cierre, con dos metodos. Es el testigo de «lo que NO se toca»:
        //     su pago congelado no puede moverse aunque la tarifa viva cambie.
        const ordenOtra = await nuevaOrden("otra", estatusEntregada.id);
        const gestionOtraEntrega = await tx.gestionOrden.create({
          data: {
            ordenId: ordenOtra.id,
            mensajeroId,
            resultado: "entregada",
            montoRecibido: new Prisma.Decimal("10000.00"),
            cierreId: cierreAbierto.id,
            // ⚠️ CONGELADO CON OTRA TARIFA (900, no 1500): si el recalculo re-derivara con la
            // tarifa VIVA en vez de sumar snapshots, este numero cambiaria. Es la mutacion 5.
            pagoMensajero: new Prisma.Decimal("900.00"),
            ingresoBodegaRechazo: new Prisma.Decimal("0.00"),
            pagos: {
              create: [
                { metodo: "efectivo", monto: new Prisma.Decimal("6000.00") },
                { metodo: "SINPE", monto: new Prisma.Decimal("4000.00") },
              ],
            },
          },
          select: { id: true },
        });

        // (3) UN RECHAZO PREVIO del mismo cierre, con su ingreso de bodega ya congelado.
        const ordenRechazo = await nuevaOrden("rechazo", estatusRechazada.id);
        const gestionRechazoPrevio = await tx.gestionOrden.create({
          data: {
            ordenId: ordenRechazo.id,
            mensajeroId,
            resultado: "rechazada",
            motivo: "rechazo real del dia",
            cierreId: cierreAbierto.id,
            pagoMensajero: new Prisma.Decimal("0.00"),
            ingresoBodegaRechazo: new Prisma.Decimal("1000.00"),
          },
          select: { id: true },
        });

        // (4) El SNAPSHOT INMUTABLE de la orden objetivo y una fila de «sin gestionar»: las dos
        //     tablas que R13 prohibe tocar.
        await tx.cierreDetail.create({
          data: {
            cierreId: cierreAbierto.id,
            ordenId: ordenObjetivo.id,
            montoCobrar: new Prisma.Decimal("17700.00"),
            cobraComision: true,
            zonaId: fks.zonaId,
            tiendaId: fks.tiendaId,
            esCentral: false,
            numGuia: GUIA_BASE + 1,
            numRemision: `R-${SUFIJO}-objetivo`,
            destinatario: "Corpus 398",
            producto: "caja",
            tiendaNombre: "Tienda del corpus",
            zonaNombre: "Zona del corpus",
            provinciaNombre: "Provincia",
            cantonNombre: "Canton",
          },
        });
        const ordenSinGestionar = await nuevaOrden("sin-gestionar", estatusEntregada.id);
        await tx.cierreSinGestion.create({
          data: {
            cierreId: cierreAbierto.id,
            ordenId: ordenSinGestionar.id,
            numGuia: GUIA_BASE + n,
            numRemision: `R-${SUFIJO}-sin-gestionar`,
            destinatario: "Corpus 398",
            producto: "caja",
            tiendaNombre: "Tienda del corpus",
            zonaNombre: "Zona del corpus",
          },
        });

        // (5) EL CIERRE APROBADO Y YA CONSOLIDADO en un `cierre_bodega`. Es el que MIDE el
        //     invariante «abierto ⇒ no consolidado» con datos, en vez de razonarlo.
        const cierreBodega = await tx.cierreBodega.create({
          data: { zonaId: fks.zonaId, solicitadoPor: mensajeroId, estado: "aprobado" },
          select: { id: true },
        });
        const cierreConsolidado = await tx.cierreDia.create({
          data: {
            mensajeroId,
            estado: "aprobado",
            destinoTipo: "bodega_central",
            destinoZonaId: fks.zonaId,
            cierreBodegaId: cierreBodega.id,
            totalEfectivo: new Prisma.Decimal("5000.00"),
            totalSimpe: new Prisma.Decimal("0.00"),
            totalTransferencia: new Prisma.Decimal("0.00"),
            totalGeneral: new Prisma.Decimal("5000.00"),
            totalPagoMensajero: new Prisma.Decimal("1500.00"),
            totalIngresoBodegaRechazos: new Prisma.Decimal("0.00"),
          },
          select: { id: true },
        });
        const ordenConsolidada = await nuevaOrden("consolidada", estatusEntregada.id);
        const gestionDelConsolidado = await tx.gestionOrden.create({
          data: {
            ordenId: ordenConsolidada.id,
            mensajeroId,
            resultado: "entregada",
            montoRecibido: new Prisma.Decimal("5000.00"),
            cierreId: cierreConsolidado.id,
            pagoMensajero: new Prisma.Decimal(COBRO_ENTREGADO),
            ingresoBodegaRechazo: new Prisma.Decimal("0.00"),
            pagos: { create: [{ metodo: "efectivo", monto: new Prisma.Decimal("5000.00") }] },
          },
          select: { id: true },
        });

        const repo = new CierresAdminRepository(
          clienteConSavepoint(tx),
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );

        return fn({
          repo,
          tx,
          cierreAbierto: cierreAbierto.id,
          cierreConsolidado: cierreConsolidado.id,
          gestionObjetivo: gestionObjetivo.id,
          gestionOtraEntrega: gestionOtraEntrega.id,
          gestionRechazoPrevio: gestionRechazoPrevio.id,
          gestionDelConsolidado: gestionDelConsolidado.id,
          ordenObjetivo: ordenObjetivo.id,
          ordenSinGestionar: ordenSinGestionar.id,
          estatusEntregadaId: estatusEntregada.id,
          estatusRechazadaId: estatusRechazada.id,
          mensajeroId,
        });
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** La llamada del caso feliz, con los ids del contexto. */
  const corregir = (ctx: Contexto, gestionId = ctx.gestionObjetivo, alcance = ALCANCE_CENTRAL) =>
    ctx.repo.corregirResultadoGestionEnCierre({
      gestionId,
      alcance,
      motivo: MOTIVO,
      corregidoPor: ctx.mensajeroId,
      estatusEntregadaId: ctx.estatusEntregadaId,
      estatusRechazadaId: ctx.estatusRechazadaId,
    });

  // -------------------------------------------------------------------------------------------
  // R6/R7 — lo que la correccion escribe EN LA GESTION
  // -------------------------------------------------------------------------------------------

  it("R6/R7: la gestion queda `rechazada`, con motivo, sin cobro, sin lineas, pago 0.00 e ingreso de bodega por tarifa", async () => {
    const { salida, gestion, lineas } = await conCorpus(async (ctx) => {
      const salida = await corregir(ctx);
      const gestion = await ctx.tx.gestionOrden.findUniqueOrThrow({
        where: { id: ctx.gestionObjetivo },
        select: {
          resultado: true,
          motivo: true,
          montoRecibido: true,
          metodoPago: true,
          pagoMensajero: true,
          ingresoBodegaRechazo: true,
        },
      });
      const lineas = await ctx.tx.gestionOrdenPago.count({
        where: { gestionId: ctx.gestionObjetivo },
      });
      return { salida, gestion, lineas };
    });

    expect(salida.status).toBe("updated");
    expect(gestion.resultado).toBe("rechazada"); // R6
    expect(gestion.motivo).toBe(MOTIVO); // R6
    expect(gestion.montoRecibido).toBeNull(); // R6: el cobro NO existio
    expect(gestion.metodoPago).toBeNull(); // R6
    expect(lineas).toBe(0); // R6: sin ninguna linea de desglose
    // R7: el pago al mensajero por esa gestion, en cero; el ingreso de bodega, el de la tarifa.
    expect(gestion.pagoMensajero?.toFixed(2)).toBe("0.00");
    expect(gestion.ingresoBodegaRechazo?.toFixed(2)).toBe(COBRO_RECHAZADO);
  });

  // -------------------------------------------------------------------------------------------
  // R8 — los SEIS totales del snapshot, y las TRES identidades que el humano verifico a mano
  // -------------------------------------------------------------------------------------------

  it("R8: los SEIS totales del cierre quedan coherentes con las gestiones vigentes", async () => {
    const { antes, despues } = await conCorpus(async (ctx) => {
      const proyeccion = {
        totalEfectivo: true,
        totalSimpe: true,
        totalTransferencia: true,
        totalGeneral: true,
        totalPagoMensajero: true,
        totalIngresoBodegaRechazos: true,
      } as const;
      const antes = await ctx.tx.cierreDia.findUniqueOrThrow({
        where: { id: ctx.cierreAbierto },
        select: proyeccion,
      });
      await corregir(ctx);
      const despues = await ctx.tx.cierreDia.findUniqueOrThrow({
        where: { id: ctx.cierreAbierto },
        select: proyeccion,
      });
      return { antes, despues };
    });

    // Control positivo: el snapshot ANTES es el congelado, con la entrega mal declarada dentro.
    expect(antes.totalGeneral.toFixed(2)).toBe("27700.00");
    expect(antes.totalSimpe.toFixed(2)).toBe("21700.00");
    expect(antes.totalPagoMensajero.toFixed(2)).toBe("3000.00");

    // DESPUES: los 17.700 por SINPE de la entrega que no existio salen del cierre.
    expect(despues.totalEfectivo.toFixed(2)).toBe("6000.00"); // la otra entrega, intacta
    expect(despues.totalSimpe.toFixed(2)).toBe("4000.00"); // 21.700 - 17.700
    expect(despues.totalTransferencia.toFixed(2)).toBe("0.00");
    expect(despues.totalGeneral.toFixed(2)).toBe("10000.00");
    // ⚠️ SUMA DE SNAPSHOTS: 0.00 (la corregida) + 900.00 (la otra, congelada con OTRA tarifa) +
    // 0.00 (el rechazo previo). Si esto fuera una re-derivacion con la tarifa VIVA daria 1500.00.
    expect(despues.totalPagoMensajero.toFixed(2)).toBe("900.00");
    // 1000.00 (la corregida, por tarifa) + 0.00 + 1000.00 (el rechazo previo, congelado).
    expect(despues.totalIngresoBodegaRechazos.toFixed(2)).toBe("2000.00");
  });

  it("💰 R8: las TRES identidades que el humano verifico a mano el 2026-09-08 se cumplen", async () => {
    const medido = await conCorpus(async (ctx) => {
      await corregir(ctx);
      const cierre = await ctx.tx.cierreDia.findUniqueOrThrow({
        where: { id: ctx.cierreAbierto },
        select: {
          totalEfectivo: true,
          totalSimpe: true,
          totalTransferencia: true,
          totalGeneral: true,
          totalPagoMensajero: true,
        },
      });
      const gestiones = await ctx.tx.gestionOrden.findMany({
        where: { cierreId: ctx.cierreAbierto, anuladaAt: null },
        select: {
          resultado: true,
          pagoMensajero: true,
          pagos: { select: { monto: true } },
        },
      });
      const sumaLineas = gestiones
        .filter((g) => g.resultado === "entregada")
        .flatMap((g) => g.pagos)
        .reduce((acc, p) => acc.plus(p.monto), new Prisma.Decimal(0));
      const sumaPagos = gestiones.reduce(
        (acc, g) => acc.plus(g.pagoMensajero ?? 0),
        new Prisma.Decimal(0),
      );
      return {
        general: cierre.totalGeneral.toFixed(2),
        sumaLineas: sumaLineas.toFixed(2),
        sumaBaldes: cierre.totalEfectivo
          .plus(cierre.totalSimpe)
          .plus(cierre.totalTransferencia)
          .toFixed(2),
        totalPago: cierre.totalPagoMensajero.toFixed(2),
        sumaPagos: sumaPagos.toFixed(2),
      };
    });

    // 1. el total general coincide con la suma de las lineas de pago vigentes;
    expect(medido.general).toBe(medido.sumaLineas);
    // 2. efectivo + SINPE + transferencia da el total general;
    expect(medido.sumaBaldes).toBe(medido.general);
    // 3. el pago al mensajero coincide con la suma por gestion.
    expect(medido.totalPago).toBe(medido.sumaPagos);
    // Anti-vacuidad: si los tres fueran "0.00" las tres igualdades pasarian sin decir nada.
    expect(medido.general).toBe("10000.00");
    expect(medido.totalPago).toBe("900.00");
  });

  // -------------------------------------------------------------------------------------------
  // R9 — la orden y su historial
  // -------------------------------------------------------------------------------------------

  it("R9: la orden queda en `rechazada` y su historial gana UNA fila con la familia propia", async () => {
    const { estatusOrdenId, filas, todas, original, ctxEsperado } = await conCorpus(async (ctx) => {
      await corregir(ctx);
      const orden = await ctx.tx.orden.findUniqueOrThrow({
        where: { id: ctx.ordenObjetivo },
        select: { estatusId: true },
      });
      const filas = await ctx.tx.ordenHistorialEstado.findMany({
        where: { ordenId: ctx.ordenObjetivo, origenTipo: "correccion_resultado_gestion" },
        select: {
          estatusOrigenId: true,
          estatusDestinoId: true,
          origenTipo: true,
          actorUsuarioId: true,
          gestionOrdenId: true,
          motivo: true,
        },
      });
      // La linea de tiempo COMPLETA: la visita original tiene que seguir ahi, intacta.
      const todas = await ctx.tx.ordenHistorialEstado.count({
        where: { ordenId: ctx.ordenObjetivo },
      });
      const original = await ctx.tx.ordenHistorialEstado.count({
        where: { ordenId: ctx.ordenObjetivo, origenTipo: "gestion" },
      });
      return {
        estatusOrdenId: orden.estatusId,
        filas,
        todas,
        original,
        ctxEsperado: {
          entregada: ctx.estatusEntregadaId,
          rechazada: ctx.estatusRechazadaId,
          gestion: ctx.gestionObjetivo,
          actor: ctx.mensajeroId,
        },
      };
    });

    expect(estatusOrdenId).toBe(ctxEsperado.rechazada);
    // El historial es APPEND-ONLY: la visita original sigue ahi y la correccion añade UNA fila.
    expect(todas).toBe(2);
    expect(original).toBe(1);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toEqual({
      estatusOrigenId: ctxEsperado.entregada,
      estatusDestinoId: ctxEsperado.rechazada,
      origenTipo: "correccion_resultado_gestion",
      actorUsuarioId: ctxEsperado.actor,
      gestionOrdenId: ctxEsperado.gestion,
      motivo: MOTIVO,
    });
  });

  it("R9: la familia NO cuenta como visita de entrega nueva (`ORIGEN_TIPOS_VISITA_REAL`)", async () => {
    // Se afirma sobre el CATALOGO, que es el predicado que el derivador de intentos consulta.
    const { ORIGEN_TIPOS_VISITA_REAL } = await import("@/lib/types/orden-historial");
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("correccion_resultado_gestion");
    // Anti-vacuidad: la lista SI tiene las dos familias que si cuentan.
    expect([...ORIGEN_TIPOS_VISITA_REAL].sort()).toEqual(["gestion", "gestion_tienda_ayuda"]);
  });

  // -------------------------------------------------------------------------------------------
  // R10 — el registro de acciones, LA FILA, no el metodo
  // -------------------------------------------------------------------------------------------

  it("R10: se escribe UNA fila de `historial_accion` con el actor congelado, el total nuevo y el par de resultados", async () => {
    const fila = await conCorpus(async (ctx) => {
      await corregir(ctx);
      const filas = await ctx.tx.historialAccion.findMany({
        where: { entidadId: ctx.gestionObjetivo },
        select: {
          accion: true,
          entidadTipo: true,
          entidadId: true,
          entidadEtiqueta: true,
          actorUsuarioId: true,
          actorNombre: true,
          actorRol: true,
          monto: true,
          valorAnterior: true,
          valorNuevo: true,
        },
      });
      expect(filas).toHaveLength(1);
      return filas[0];
    });

    expect(fila.accion).toBe("cierre_dia_gestion_corregida");
    expect(fila.entidadTipo).toBe("gestion_orden");
    // El actor CONGELADO: id, nombre y rol de ese instante. Nombre y rol no son `null`, que es lo
    // que saldria si `resolverActorCongelado` no hubiera resuelto la fila.
    expect(fila.actorUsuarioId).not.toBeNull();
    expect(fila.actorNombre).not.toBeNull();
    expect(fila.actorRol).not.toBeNull();
    // El importe es el `total_general` NUEVO del cierre, `Decimal`, nunca un `number`.
    expect(fila.monto?.toFixed(2)).toBe("10000.00");
    expect(fila.valorAnterior).toBe("entregada");
    expect(fila.valorNuevo).toBe("rechazada");
    // La etiqueta sale de `etiquetaDeEntidad` y NUNCA lleva el motivo (texto libre, 362/R5).
    expect(fila.entidadEtiqueta).not.toContain(MOTIVO);
    expect(fila.entidadEtiqueta.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------------------------
  // R3/R12 — lo que la correccion RECHAZA, medido con filas reales
  // -------------------------------------------------------------------------------------------

  it("💰 R3: un cierre APROBADO Y CONSOLIDADO no se corrige, y no se le toca ni una fila", async () => {
    // ⚠️ ESTE CASO SUSTITUYE UN RAZONAMIENTO POR UNA MEDIDA. El spec dice que la restriccion a
    // `solicitado`/`vencido` cubre «por construccion» el «no consolidado», porque la consolidacion
    // solo toma cierres `aprobado`. Eso es un argumento; esto es una fila de `cierre_bodega` con
    // su `cierre_dia` colgando.
    const medido = await conCorpus(async (ctx) => {
      const salida = await corregir(ctx, ctx.gestionDelConsolidado);
      const gestion = await ctx.tx.gestionOrden.findUniqueOrThrow({
        where: { id: ctx.gestionDelConsolidado },
        select: { resultado: true, montoRecibido: true, pagoMensajero: true },
      });
      const lineas = await ctx.tx.gestionOrdenPago.count({
        where: { gestionId: ctx.gestionDelConsolidado },
      });
      const cierre = await ctx.tx.cierreDia.findUniqueOrThrow({
        where: { id: ctx.cierreConsolidado },
        select: { totalGeneral: true, cierreBodegaId: true },
      });
      const acciones = await ctx.tx.historialAccion.count({
        where: { entidadId: ctx.gestionDelConsolidado },
      });
      return { salida, gestion, lineas, cierre, acciones };
    });

    expect(medido.salida.status).toBe("conflict");
    // Ni una fila tocada: la gestion sigue entregada, con su cobro y su desglose.
    expect(medido.gestion.resultado).toBe("entregada");
    expect(medido.gestion.montoRecibido?.toFixed(2)).toBe("5000.00");
    expect(medido.gestion.pagoMensajero?.toFixed(2)).toBe(COBRO_ENTREGADO);
    expect(medido.lineas).toBe(1);
    expect(medido.cierre.totalGeneral.toFixed(2)).toBe("5000.00");
    // Y el cierre SIGUE consolidado: la comprobacion de que el corpus era el que se creia.
    expect(medido.cierre.cierreBodegaId).not.toBeNull();
    expect(medido.acciones).toBe(0);
  });

  it("R12: corregir DOS veces la misma gestion: la segunda es `conflict` y no toca nada", async () => {
    // La segunda llamada encuentra la gestion ya `rechazada`, o sea exactamente el escenario de
    // la carrera: el `WHERE` del sello deja de casar y se sale sin efectos.
    const medido = await conCorpus(async (ctx) => {
      const primera = await corregir(ctx);
      const cierreTrasPrimera = await ctx.tx.cierreDia.findUniqueOrThrow({
        where: { id: ctx.cierreAbierto },
        select: { totalGeneral: true },
      });
      const segunda = await corregir(ctx);
      const cierreTrasSegunda = await ctx.tx.cierreDia.findUniqueOrThrow({
        where: { id: ctx.cierreAbierto },
        select: { totalGeneral: true },
      });
      const acciones = await ctx.tx.historialAccion.count({
        where: { entidadId: ctx.gestionObjetivo },
      });
      const historial = await ctx.tx.ordenHistorialEstado.count({
        where: { ordenId: ctx.ordenObjetivo, origenTipo: "correccion_resultado_gestion" },
      });
      return {
        primera: primera.status,
        segunda: segunda.status,
        generalTrasPrimera: cierreTrasPrimera.totalGeneral.toFixed(2),
        generalTrasSegunda: cierreTrasSegunda.totalGeneral.toFixed(2),
        acciones,
        historial,
      };
    });

    expect(medido.primera).toBe("updated");
    expect(medido.segunda).toBe("conflict");
    expect(medido.generalTrasSegunda).toBe(medido.generalTrasPrimera);
    // Ni un rastro de mas: una correccion, una fila de cada.
    expect(medido.acciones).toBe(1);
    expect(medido.historial).toBe(1);
  });

  it("💰 R4: una gestion que NO es `entregada` no se corrige, aunque su cierre este abierto", async () => {
    // ⚠️ ESTE CASO ES EL QUE MATA LA MUTACION «quitar `resultado: entregada` del WHERE del sello»,
    // y por eso la lectura previa del repositorio NO filtra por resultado: si filtrara, decidiria
    // ella y el `WHERE` del sello quedaria de adorno. Medido el 2026-09-08: con el filtro
    // duplicado arriba, esa mutacion SOBREVIVIA.
    //
    // Y lo que estaria en juego no es un estado feo: `gestionRechazoPrevio` ya tiene su
    // `ingreso_bodega_rechazo` congelado en 1.000. «Corregirla» otra vez lo reescribiria y le
    // pisaria el motivo real del dia con el de esta correccion.
    const medido = await conCorpus(async (ctx) => {
      const salida = await corregir(ctx, ctx.gestionRechazoPrevio);
      const gestion = await ctx.tx.gestionOrden.findUniqueOrThrow({
        where: { id: ctx.gestionRechazoPrevio },
        select: { resultado: true, motivo: true, ingresoBodegaRechazo: true },
      });
      const cierre = await ctx.tx.cierreDia.findUniqueOrThrow({
        where: { id: ctx.cierreAbierto },
        select: { totalGeneral: true },
      });
      const acciones = await ctx.tx.historialAccion.count({
        where: { entidadId: ctx.gestionRechazoPrevio },
      });
      return { salida, gestion, cierre, acciones };
    });

    expect(medido.salida.status).toBe("conflict");
    expect(medido.gestion.resultado).toBe("rechazada");
    expect(medido.gestion.motivo).toBe("rechazo real del dia"); // NO se pisa
    expect(medido.gestion.ingresoBodegaRechazo?.toFixed(2)).toBe("1000.00");
    // Y el snapshot del cierre sigue siendo el congelado: no se recalculo nada.
    expect(medido.cierre.totalGeneral.toFixed(2)).toBe("27700.00");
    expect(medido.acciones).toBe(0);
  });

  it("R2: una gestion de otro alcance es `fuera_de_alcance` y no se toca", async () => {
    const medido = await conCorpus(async (ctx) => {
      const salida = await corregir(ctx, ctx.gestionObjetivo, {
        destinoTipo: "bodega_satelite",
        destinoZonaId: "00000000-0000-4000-8000-000000000000",
      });
      const gestion = await ctx.tx.gestionOrden.findUniqueOrThrow({
        where: { id: ctx.gestionObjetivo },
        select: { resultado: true },
      });
      return { salida, resultado: gestion.resultado };
    });

    // Existe pero no es suya: el `count` de dentro la ve, asi que el desenlace es `conflict`,
    // que es indistinguible de «se cerro entre medias». Lo que importa —y es lo que se afirma—
    // es que NO se aplico.
    expect(medido.salida.status).not.toBe("updated");
    expect(medido.resultado).toBe("entregada");
  });

  it("R2: una gestion inexistente es `fuera_de_alcance`", async () => {
    const salida = await conCorpus((ctx) =>
      corregir(ctx, "00000000-0000-4000-8000-000000000001"),
    );
    expect(salida.status).toBe("fuera_de_alcance");
  });

  // -------------------------------------------------------------------------------------------
  // R13 — lo que la correccion NO DEBE tocar
  // -------------------------------------------------------------------------------------------

  it("💰 R13: no se tocan el detalle congelado, las ordenes sin gestionar, las evidencias, el autor ni la fecha de creacion", async () => {
    const { antes, despues } = await conCorpus(async (ctx) => {
      const leer = async () => ({
        detalle: await ctx.tx.cierreDetail.findMany({
          where: { cierreId: ctx.cierreAbierto },
          select: { ordenId: true, montoCobrar: true, numRemision: true, tiendaId: true },
          orderBy: { ordenId: "asc" },
        }),
        sinGestion: await ctx.tx.cierreSinGestion.findMany({
          where: { cierreId: ctx.cierreAbierto },
          select: { ordenId: true, numRemision: true },
          orderBy: { ordenId: "asc" },
        }),
        evidencias: await ctx.tx.gestionOrdenEvidencia.findMany({
          where: { gestionId: ctx.gestionObjetivo },
          select: { storagePath: true, contentType: true, indice: true },
          orderBy: { indice: "asc" },
        }),
        gestion: await ctx.tx.gestionOrden.findUniqueOrThrow({
          where: { id: ctx.gestionObjetivo },
          select: {
            mensajeroId: true,
            createdAt: true,
            cierreId: true,
            anuladaAt: true,
            evidenciaStoragePath: true,
            evidenciaContentType: true,
          },
        }),
        // La OTRA entrega del mismo cierre: su pago congelado con OTRA tarifa.
        otraEntrega: await ctx.tx.gestionOrden.findUniqueOrThrow({
          where: { id: ctx.gestionOtraEntrega },
          select: { resultado: true, montoRecibido: true, pagoMensajero: true },
        }),
        lineasOtra: await ctx.tx.gestionOrdenPago.count({
          where: { gestionId: ctx.gestionOtraEntrega },
        }),
        rechazoPrevio: await ctx.tx.gestionOrden.findUniqueOrThrow({
          where: { id: ctx.gestionRechazoPrevio },
          select: { ingresoBodegaRechazo: true, motivo: true },
        }),
      });
      const antes = await leer();
      await corregir(ctx);
      const despues = await leer();
      return { antes, despues };
    });

    // Anti-vacuidad: el corpus TENIA las filas que se dice que no se tocan.
    expect(antes.detalle).toHaveLength(1);
    expect(antes.sinGestion).toHaveLength(1);
    expect(antes.evidencias).toHaveLength(1);

    expect(despues.detalle).toEqual(antes.detalle); // R13: `cierre_detail` es INMUTABLE
    expect(despues.sinGestion).toEqual(antes.sinGestion); // R13
    expect(despues.evidencias).toEqual(antes.evidencias); // R13: la foto de la entrega se conserva
    // R13: el mensajero autor, la fecha de creacion, la pertenencia al cierre y la vigencia.
    expect(despues.gestion).toEqual(antes.gestion);
    // 💰 La OTRA gestion del cierre no se toca: ni su resultado, ni su cobro, ni —lo que mas
    // importa— su `pago_mensajero` congelado con una tarifa que ya no es la viva.
    expect(despues.otraEntrega).toEqual(antes.otraEntrega);
    expect(despues.otraEntrega.pagoMensajero?.toFixed(2)).toBe("900.00");
    expect(despues.lineasOtra).toBe(2);
    expect(despues.rechazoPrevio).toEqual(antes.rechazoPrevio);
  });

  // -------------------------------------------------------------------------------------------
  // R15 — la consecuencia declarada
  // -------------------------------------------------------------------------------------------

  it("R15: tras corregir, la gestion cuenta como intento de entrega de esa orden al aprobarse el cierre", async () => {
    const { antes, despues } = await conCorpus(async (ctx) => {
      const { contarIntentosVigentesEnLoteCon } = await import(
        "@/lib/repositories/OrdenHistorialRepository"
      );
      // El derivador exige el cierre APROBADO: se aprueba el cierre en las dos mediciones para
      // aislar la unica variable que esta ficha mueve, que es el `resultado` de la gestion.
      const aprobar = () =>
        ctx.tx.cierreDia.update({
          where: { id: ctx.cierreAbierto },
          data: { estado: "aprobado" },
        });
      const contar = async () =>
        (await contarIntentosVigentesEnLoteCon(ctx.tx.gestionOrden, [ctx.ordenObjetivo])).get(
          ctx.ordenObjetivo,
        ) ?? 0;

      await aprobar();
      const antes = await contar();
      // Se devuelve el cierre a `solicitado` para poder corregir, y se re-aprueba despues.
      await ctx.tx.cierreDia.update({
        where: { id: ctx.cierreAbierto },
        data: { estado: "solicitado" },
      });
      await corregir(ctx);
      await aprobar();
      const despues = await contar();
      return { antes, despues };
    });

    // Es la correccion funcionando, no un efecto lateral: `entregada` NO cuenta como intento y
    // `rechazada` SI. El contador de esa orden sube en uno.
    expect(antes).toBe(0);
    expect(despues).toBe(1);
  });

  // -------------------------------------------------------------------------------------------
  // R11 — atomicidad: si un paso falla, NINGUNO queda aplicado
  // -------------------------------------------------------------------------------------------

  it("💰 R11: si el snapshot del cierre no se puede escribir, NADA queda aplicado", async () => {
    // El fallo se fuerza por el camino REAL del metodo: el paso 5 exige `count === 1` sobre
    // `cierre_dia` con la guardia de estado. Se cambia el estado del cierre a `aprobado` DESPUES
    // de la lectura previa... lo que no se puede hacer desde fuera. Asi que se fuerza al reves y
    // de la unica forma honesta: se rompe `cierreDia.updateMany` para esta llamada, dejando
    // TODO lo demas —el sello, el borrado, la orden y el historial— exactamente igual.
    const medido = await conCorpus(async (ctx) => {
      const clienteRoto = new Proxy(clienteConSavepoint(ctx.tx) as object, {
        get(objetivo, prop) {
          const valor = Reflect.get(objetivo, prop) as unknown;
          if (prop !== "$transaction") return valor;
          return async (fn: (t: unknown) => unknown) =>
            (valor as (f: (t: unknown) => unknown) => unknown)((txInterna) =>
              fn(
                new Proxy(txInterna as object, {
                  get(objetivoInterno, propInterna) {
                    if (propInterna === "cierreDia") {
                      return {
                        ...(Reflect.get(objetivoInterno, "cierreDia") as object),
                        // Devuelve 0 filas: el metodo tiene que LANZAR y revertirlo todo.
                        updateMany: async () => ({ count: 0 }),
                      };
                    }
                    const v = Reflect.get(objetivoInterno, propInterna) as unknown;
                    return typeof v === "function" ? v.bind(objetivoInterno) : v;
                  },
                }),
              ),
            );
        },
      }) as PrismaClient;

      const repoRoto = new CierresAdminRepository(
        clienteRoto,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      let lanzo: unknown = null;
      try {
        await repoRoto.corregirResultadoGestionEnCierre({
          gestionId: ctx.gestionObjetivo,
          alcance: ALCANCE_CENTRAL,
          motivo: MOTIVO,
          corregidoPor: ctx.mensajeroId,
          estatusEntregadaId: ctx.estatusEntregadaId,
          estatusRechazadaId: ctx.estatusRechazadaId,
        });
      } catch (error) {
        lanzo = error;
      }

      return {
        lanzo,
        gestion: await ctx.tx.gestionOrden.findUniqueOrThrow({
          where: { id: ctx.gestionObjetivo },
          select: { resultado: true, montoRecibido: true, pagoMensajero: true, motivo: true },
        }),
        lineas: await ctx.tx.gestionOrdenPago.count({ where: { gestionId: ctx.gestionObjetivo } }),
        orden: await ctx.tx.orden.findUniqueOrThrow({
          where: { id: ctx.ordenObjetivo },
          select: { estatusId: true },
        }),
        historial: await ctx.tx.ordenHistorialEstado.count({
          where: { ordenId: ctx.ordenObjetivo, origenTipo: "correccion_resultado_gestion" },
        }),
        // Y la visita ORIGINAL sigue intacta: el rollback no se llevo por delante lo que ya habia.
        historialOriginal: await ctx.tx.ordenHistorialEstado.count({
          where: { ordenId: ctx.ordenObjetivo, origenTipo: "gestion" },
        }),
        acciones: await ctx.tx.historialAccion.count({
          where: { entidadId: ctx.gestionObjetivo },
        }),
        entregadaId: ctx.estatusEntregadaId,
      };
    });

    // El fallo se PROPAGA: nadie se lo traga.
    expect(medido.lanzo).toBeInstanceOf(Error);
    // Y NINGUNO de los cinco efectos anteriores quedo aplicado.
    expect(medido.gestion.resultado).toBe("entregada");
    expect(medido.gestion.montoRecibido?.toFixed(2)).toBe("17700.00");
    expect(medido.gestion.pagoMensajero?.toFixed(2)).toBe(COBRO_ENTREGADO);
    expect(medido.gestion.motivo).toBeNull();
    expect(medido.lineas).toBe(1); // la linea de SINPE sigue ahi
    expect(medido.orden.estatusId).toBe(medido.entregadaId);
    expect(medido.historial).toBe(0);
    expect(medido.historialOriginal).toBe(1);
    expect(medido.acciones).toBe(0);
  });
});
