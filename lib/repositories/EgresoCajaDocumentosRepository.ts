import type { PrismaClient } from "@prisma/client";

import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";

type LecturaPrismaClient = Pick<PrismaClient, "walletMovimiento" | "ajusteCajaAnulacion" | "walletComprobante">;

/**
 * FICHA 458-B (design §3.6, R71/R72) — el estado de anulacion DERIVADO de los EGRESOS de la caja
 * sin documento propio (sueldo, gasto de Ordenex, gasto fijo cobrado; origen `gasto`), leido EN LOTE.
 *
 * «Anulado» lo decide el CONTRA-ASIENTO, que es lo que de verdad movio el dinero: existe un
 * `ingreso_ajuste` con origen `gasto` y `origen_id` = el egreso. Da igual en que pagina, periodo o
 * filtro caiga (R71). La constancia (`ajuste_caja_anulacion`, D13) solo dice si hay MOTIVO: un
 * reverso de antes de esta ficha —la via «Reversar» sin motivo— sale `anulado` con
 * `sinConstancia` (la pantalla dice «motivo no registrado», R72). Sin backfill (R89).
 *
 * TRES consultas por pagina, ninguna si la lista viene vacia. SOLO queries.
 */
export class EgresoCajaDocumentosRepository {
  constructor(private readonly prisma: LecturaPrismaClient) {}

  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]> {
    if (ids.length === 0) return [];
    const lista = [...ids];
    const reversos = await this.prisma.walletMovimiento.findMany({
      where: { categoria: "ingreso_ajuste", origenTipo: "gasto", origenId: { in: lista } },
      select: { origenId: true },
    });
    const constancias = await this.prisma.ajusteCajaAnulacion.findMany({
      where: { movimientoId: { in: lista } },
      select: { movimientoId: true },
    });
    const comprobantes = await this.prisma.walletComprobante.findMany({
      where: { cajaMovimientoId: { in: lista } },
      select: { cajaMovimientoId: true },
    });
    const reversados = new Set(reversos.map((r) => r.origenId));
    const conConstancia = new Set(constancias.map((c) => c.movimientoId));
    const conComprobante = new Set(comprobantes.map((c) => c.cajaMovimientoId));
    return lista.map((id) => {
      const anulado = reversados.has(id);
      return {
        id,
        anulado,
        tieneComprobante: conComprobante.has(id),
        ...(anulado && !conConstancia.has(id) ? { sinConstancia: true } : {}),
      };
    });
  }
}

/**
 * FICHA 458-B (design §3.6, D8, R71) — el estado de anulacion de las INDEMNIZACIONES por incidente
 * (`egreso_indemnizacion` con origen `orden_incidente`). Su contra-asiento apunta al INCIDENTE (D8),
 * asi que «anulado» se lee por la constancia, que esta via escribe siempre en la misma transaccion
 * que el contra-asiento (no hay reversos previos: la indemnizacion no tenia ninguna via). Una
 * indemnizacion no lleva comprobante (design §3.6).
 */
export class IndemnizacionDocumentosRepository {
  constructor(private readonly prisma: Pick<PrismaClient, "ajusteCajaAnulacion">) {}

  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]> {
    if (ids.length === 0) return [];
    const constancias = await this.prisma.ajusteCajaAnulacion.findMany({
      where: { movimientoId: { in: [...ids] } },
      select: { movimientoId: true },
    });
    const anulados = new Set(constancias.map((c) => c.movimientoId));
    return ids.map((id) => ({ id, anulado: anulados.has(id), tieneComprobante: false }));
  }
}

/**
 * FICHA 458-C (revision B3, R71) — el estado de los PAGOS DE ORDENEX A UNA TIENDA (172) cuyo egreso
 * (`egreso_pago_tienda`, origen `pago_tienda`) esta en la pagina. id = el `liquidacion_pago`.
 * «Anulado» = existe su `liquidacion_anulacion` (el documento de la 172, UNIQUE por pago); el
 * comprobante, el de la 458-B (`wallet_comprobante.liquidacion_pago_id`). DOS consultas, ninguna si
 * la lista viene vacia. SOLO queries.
 */
export class PagoTiendaCajaDocumentosRepository {
  constructor(private readonly prisma: Pick<PrismaClient, "liquidacionAnulacion" | "walletComprobante">) {}

  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]> {
    if (ids.length === 0) return [];
    const lista = [...ids];
    const anulaciones = await this.prisma.liquidacionAnulacion.findMany({
      where: { pagoId: { in: lista } },
      select: { pagoId: true },
    });
    const comprobantes = await this.prisma.walletComprobante.findMany({
      where: { liquidacionPagoId: { in: lista } },
      select: { liquidacionPagoId: true },
    });
    const anulados = new Set(anulaciones.map((a) => a.pagoId));
    const conComprobante = new Set(comprobantes.map((c) => c.liquidacionPagoId));
    return lista.map((id) => ({ id, anulado: anulados.has(id), tieneComprobante: conComprobante.has(id) }));
  }
}

/**
 * FICHA 458-C (revision B3, R71) — el estado de los PREMIOS DEL RANKING (293) cuyo egreso de caja
 * (`egreso_pago_mensajero`, origen `ranking_snapshot_fila`) esta en la pagina. id = la fila del podio.
 * «Anulado» = existe su reverso de caja (`ingreso_ajuste` con la MISMA clave de origen), que
 * `PremioRankingDevengoService.anularPremio` escribe en la misma transaccion que la compensacion del
 * libro del mensajero. Un premio no lleva comprobante. UNA consulta, ninguna si la lista viene vacia.
 */
export class PremioCajaDocumentosRepository {
  constructor(private readonly prisma: Pick<PrismaClient, "walletMovimiento">) {}

  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]> {
    if (ids.length === 0) return [];
    const lista = [...ids];
    const reversos = await this.prisma.walletMovimiento.findMany({
      where: { categoria: "ingreso_ajuste", origenTipo: "ranking_snapshot_fila", origenId: { in: lista } },
      select: { origenId: true },
    });
    const anulados = new Set(reversos.map((r) => r.origenId));
    return lista.map((id) => ({ id, anulado: anulados.has(id), tieneComprobante: false }));
  }
}
