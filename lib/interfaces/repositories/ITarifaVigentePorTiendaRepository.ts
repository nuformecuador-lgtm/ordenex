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
