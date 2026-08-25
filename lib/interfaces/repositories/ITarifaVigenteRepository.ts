import type { PrismaClient } from "@prisma/client";
import type { ParTarifa } from "@/lib/utils/cascada-tarifa";

// Feature 42 (design §2.1, F1.4-Q1) — contrato del resolver de la TARIFA VIGENTE.
//
// Feature 274 (design §3.1, R1-R8, R17) — QUE CAMBIO Y POR QUE. Hasta la 273 este contrato
// afirmaba que la tarifa se resolvia por la TIENDA de la orden y **no** por su zona (feature
// 69/R20: el PR #64 remodelo `tarifas` a "por tienda" y dropeo `tarifas.zona_id`). Eso ya NO
// es cierto: la 273 devolvio `zona_id` a la tabla —con las dos dimensiones nullables y un
// UNIQUE (zona_id, tienda_id) NULLS NOT DISTINCT— y la 274 hace que la resolucion sea una
// CASCADA sobre el par (tienda, zona):
//
//   nivel 1  tienda_id = T AND zona_id = Z   (lo mas especifico)
//   nivel 2  tienda_id = T AND zona_id IS NULL
//   nivel 3  tienda_id IS NULL AND zona_id = Z
//
// y si ninguno tiene fila, `null` (R2). La fila global (tienda_id IS NULL AND zona_id IS NULL)
// **NO es un cuarto nivel**: no se considera nunca, y el service la prohibe al crear/actualizar
// (R14/R15). Un par que llega sin zona solo puede alcanzar el nivel 2 (R6).
//
// La zona sigue eligiendo ademas la COLUMNA de la tarifa (`valor_flete_gam` vs `valor_flete`)
// via `esCentral`, dentro del util puro `lib/utils/ingreso-ordenex.ts`: eso no cambia (R24).
//
// UN SOLO RESOLVER (R37). Antes habia dos —`resolveTarifaPorTienda` para liquidar y
// `resolveTarifaCotizablePorTienda` para cotizar— y lo unico que los separaba era el filtro
// `status: "activo"`. La migracion `drop_tarifa_status` de esta feature solto esa columna
// (deuda (g) de la feature 69, cerrada), asi que ya no queda nada que separarlos: se colapsan
// en `resolveTarifa`. Dos resolvers eran dos reglas que podian divergir, y de hecho divergian.
//
// La regla vive en `lib/utils/cascada-tarifa.ts` (modulo puro), no aqui: es lo que hace que
// listado y liquidacion **no puedan** resolver filas distintas (R8/R21).
//
// Solo query Prisma (sin logica de negocio). Money-safe: montos y porcentajes se devuelven
// ya serializados a STRING escala 2 (el util los reconvierte a Prisma.Decimal para operar).

// Cliente (o cliente de transaccion) que necesita el resolver batch: feature 69/design §3.1,
// la resolucion del snapshot corre DENTRO de la `$transaction` de `crearCierre`.
export type TarifaTxClient = Pick<PrismaClient, "tarifa">;

// Tarifa vigente resuelta para un par (tienda, zona). MONTOS: valorFlete[Gam],
// valorFleteDevuelto[Gam]. PORCENTAJES (0..100): comisionCod, ivaFlete, ivaComisionCod.
// Los 7 campos NO cambian respecto de la 42/69: la aritmetica de `ingreso-ordenex.ts` no se
// toca en la 274 (R24). Lo que cambio es QUE FILA se elige, no que se lee de ella.
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
// TAMBIEN `tarifa_id` (auditoria: QUE FILA se uso). `TarifaVigente` (los 7 campos que consume
// la formula) NO cambia: esto la EXTIENDE solo en el camino del snapshot.
export interface TarifaVigenteResuelta extends TarifaVigente {
  tarifaId: string;
  // Monto FIJO de fulfillment (2026-08-19). Viaja por el MISMO camino que `tarifaId` y por el
  // mismo motivo: `cierre_detail` lo congela para mostrarlo, pero NO es una entrada de la
  // formula, asi que NO entra en `TarifaVigente`. Meterlo alli lo pondria al alcance de
  // `derivarIngresoOrden`, y esa funcion decide dinero que se liquida.
  fulfillment: string; // MONTO -> STRING 2 dec
}

export interface ITarifaVigenteRepository {
  /**
   * Cascada (R1-R6) para UN par (tienda, zona). `null` = sin tarifa (R2): ningun nivel tiene
   * fila. `zonaId` null -> solo se intenta el nivel 2 (R6).
   *
   * Sustituye a `resolveTarifaPorTienda` Y a `resolveTarifaCotizablePorTienda`: hay un solo
   * resolver porque ya no hay `status` que los separe (R37).
   *
   * Se implementa sobre el mismo camino que `resolveTarifas` (design §5, alternativa A
   * descartada): una sola implementacion de la regla, para que el singular y el lote no
   * puedan divergir.
   */
  resolveTarifa(tiendaId: string, zonaId: string | null): Promise<TarifaVigente | null>;

  /**
   * Cascada para N pares en UNA sola query (R7, sin N+1). El Map se indexa por `clavePar` y
   * trae una entrada por CADA par pedido, con `null` cuando no resuelve.
   *
   * `tx` OPCIONAL y SEGUNDO. Cambio de firma respecto de la 69, donde el batch era
   * `resolveTarifasPorTiendas(tx, tiendaIds)` con `tx` primero y OBLIGATORIO: el cierre de dia
   * pasa el cliente de su `$transaction` (el snapshot se congela dentro), pero la carga via
   * API, la cotizacion y el listado no tienen transaccion y tenian que inventarse una. Al
   * invertirlo, el llamador sin tx simplemente no pasa nada.
   */
  resolveTarifas(
    pares: readonly ParTarifa[],
    tx?: TarifaTxClient,
  ): Promise<Map<string, TarifaVigenteResuelta | null>>;
}
