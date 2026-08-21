import type { PrismaClient } from "@prisma/client";

// Feature 42 (design §2.1, F1.4-Q1) — contrato del resolver de la TARIFA VIGENTE.
// Feature 69 (design §6, R20): la tarifa se resuelve por la TIENDA de la orden
// (`orden.tienda_id` -> `tarifas.tienda_id`), NO por su zona: el PR #64 remodelo `tarifas`
// a "por tienda" y dropeo `tarifas.zona_id`. La zona NO se pierde: sigue eligiendo la
// COLUMNA de la tarifa (`valor_flete_gam` vs `valor_flete`) via `esCentral`, dentro del util
// puro `lib/utils/ingreso-ordenex.ts` (R21, sin cambio de formula).
//
// Solo query Prisma (sin logica de negocio). Money-safe: montos y porcentajes se devuelven
// ya serializados a STRING escala 2 (el util los reconvierte a Prisma.Decimal para operar).

// Cliente (o cliente de transaccion) que necesita el resolver batch: feature 69/design §3.1,
// la resolucion del snapshot corre DENTRO de la `$transaction` de `crearCierre`.
export type TarifaTxClient = Pick<PrismaClient, "tarifa">;

// Tarifa vigente de una tienda (feature 18/54/PR #64, tabla `tarifas`). MONTOS:
// valorFlete[Gam], valorFleteDevuelto[Gam]. PORCENTAJES (0..100): comisionCod, ivaFlete,
// ivaComisionCod. Los 7 campos NO cambian respecto de la 42 (feature 69/T1).
export interface TarifaVigente {
  valorFlete: string; // MONTO -> STRING 2 dec
  valorFleteGam: string; // MONTO (variante central/GAM)
  valorFleteDevuelto: string; // MONTO
  valorFleteDevueltoGam: string; // MONTO (variante central/GAM)
  comisionCod: string; // PORCENTAJE 0..100
  ivaFlete: string; // PORCENTAJE 0..100
  ivaComisionCod: string; // PORCENTAJE 0..100
}

// Feature 69 (design §2.1) — la tarifa resuelta MAS su `id`, para que `cierre_detail` congele
// TAMBIEN `tarifa_id` (auditoria: QUE FILA se uso; es la contrapartida que hace la deuda (g)
// auditable por primera vez). `TarifaVigente` (los 7 campos que consume la formula) NO cambia:
// esto la EXTIENDE solo en el camino del snapshot.
export interface TarifaVigenteResuelta extends TarifaVigente {
  tarifaId: string;
  // Monto FIJO de fulfillment (2026-08-19). Viaja por el MISMO camino que `tarifaId` y por el
  // mismo motivo: `cierre_detail` lo congela para mostrarlo, pero NO es una entrada de la
  // formula, asi que NO entra en `TarifaVigente`. Meterlo alli lo pondria al alcance de
  // `derivarIngresoOrden`, y esa funcion decide dinero que se liquida.
  fulfillment: string; // MONTO -> STRING 2 dec
}

export interface ITarifaVigentePorTiendaRepository {
  /**
   * Resuelve la tarifa vigente (NO borrada, `deletedAt IS NULL`) de una tienda (R20).
   * - `null` si la tienda no tiene ninguna tarifa capturada/vigente (gap de datos, R9).
   * - Si la tienda tiene varias tarifas no borradas, se elige la MAS RECIENTE
   *   (`orderBy createdAt desc`, first): resolucion determinista (R22).
   * - `tarifas.status` NO entra en el WHERE: decision (g) de la feature 69 (override del
   *   humano, 2026-07-15). Ver el `TODO:` de `TarifaVigentePorTiendaRepository`.
   */
  resolveTarifaPorTienda(tiendaId: string): Promise<TarifaVigente | null>;

  /**
   * Feature 255 (design.md §4, decision D6) — resolver de la TARIFA COTIZABLE de una tienda.
   * `where: { tiendaId, deletedAt: null, status: "activo" }`, `orderBy createdAt desc`, first.
   *
   * Es un metodo NUEVO, no un parametro de `resolveTarifaPorTienda`: alli `status` NO entra en
   * el WHERE (deuda (g) de la feature 69, con salida en la feature 70) y dos tests lo afirman.
   *
   * Por que aqui SI se filtra `status`: en el camino de liquidacion un `null` degrada a
   * conceptos 0.00 (un cobro equivocado se convertiria en un cobro CERO, callado). En la
   * cotizacion NO: `null` dispara un `409` explicito (R13), asi que filtrar no puede producir
   * un precio falso, solo una negativa nombrada.
   *
   * SALIDA NOMBRADA (deuda declarada): cuando la feature 70 cierre y el resolver compartido
   * filtre `status`, este metodo se COLAPSA en `resolveTarifaPorTienda` y desaparece.
   */
  resolveTarifaCotizablePorTienda(tiendaId: string): Promise<TarifaVigente | null>;

  /**
   * Feature 69 (design §3.1) — version BATCH y tx-aware del resolver: misma regla de
   * seleccion (R20/R22) para N tiendas en UNA sola query (sin N+1). El `tx` permite
   * resolver dentro de la `$transaction` de `crearCierre` (el snapshot se congela ahi).
   * Cada tienda de `tiendaIds` aparece en el Map; `null` si no tiene tarifa (gap R9).
   * Devuelve `TarifaVigenteResuelta` (7 campos + `tarifaId`): el snapshot congela tambien
   * QUE FILA se eligio (design §2.1).
   */
  resolveTarifasPorTiendas(
    tx: TarifaTxClient,
    tiendaIds: string[],
  ): Promise<Map<string, TarifaVigenteResuelta | null>>;
}
