import { Prisma } from "@prisma/client";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 — LA FORMULA DEL SALDO SIN CONCILIAR, ESCRITA UNA SOLA VEZ.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// MODULO PURO (sin React, sin repositorio, sin servicio). Existe porque la formula tiene ahora
// DOS lectores en el servidor y ninguno puede importar al otro sin acoplar dos repositorios:
//
//   1. `SaldosSatelitesRepository` — el saldo de una bodega y el `faltaPorRecibir` de cada
//      consolidacion en `/wallet/satelites`;
//   2. `CierreBodegaRepository.toBodegaResumenRow` — el `faltaPorRecibir` que la MISMA
//      consolidacion ensena en las superficies de `/cierres-admin`, que son las que ve la
//      bodega satelite (R26) y la central en su cola.
//
// ⚠️ POR QUE UNA SOLA DEFINICION, Y NO DOS QUE «HACEN LO MISMO»: la pantalla de la satelite y
// la de la central hablan de la MISMA consolidacion. Con dos restas, el dia que una cambie la
// bodega leeria «te faltan ₡15.000» y la central «ya llego completa», sin que nada se pusiera
// rojo. Es exactamente el defecto que la ficha 359 encontro repetido en 13 pantallas.

/**
 * R17/R18 — lo que falta por llegar de este EFECTIVO.
 *
 * ⚠️ SOBRE `total_efectivo` Y NUNCA SOBRE `total_general`: decision del humano sobre Q2
 * (2026-09-16), medida contra produccion. El SINPE —26,3 % del consolidado— entra directo a una
 * cuenta y NO viaja en el bulto; con el general, la pantalla ensenaria ₡1,1 M de deuda que nadie
 * va a entregar en mano jamas.
 *
 * Los tres casos salen de UNA expresion, sin un `if` que los separe:
 *  · `recibido === null` (sin marcar) -> aporta el efectivo integro;
 *  · recibido IGUAL al efectivo       -> aporta `0.00`;
 *  · recibido MENOR                   -> aporta la diferencia (R18: los ₡485.000 de ₡500.000);
 *  · recibido MAYOR                   -> aporta un NEGATIVO, que se devuelve tal cual sin
 *    recortar a cero (llego de mas) — mismo criterio con el que la ficha 393 decidio ensenar
 *    «Para la central» en negativo en vez de maquillarlo.
 *
 * Money-safe: `Prisma.Decimal` de punta a punta. Quien lo emite hace el `.toFixed(2)`.
 */
export function saldoDe(
  efectivo: Prisma.Decimal,
  recibido: Prisma.Decimal | null,
): Prisma.Decimal {
  return efectivo.minus(recibido ?? new Prisma.Decimal(0));
}
