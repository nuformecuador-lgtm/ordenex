import {
  resetCatalogoEstadosCache,
  resolverCatalogoEstadosReal,
} from "@/lib/repositories/registrar-cambio-estado";
import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";

// Feature 140 — CATALOGO DE ESTADOS para los dobles de test del choke point.
//
// La guardia de la 140 es de FALLO CERRADO: `appendCambioEstado` resuelve `id -> value` contra
// `order_status` y RECHAZA lo que no puede clasificar. Los dobles de `tx` de las suites de los
// call-sites (feature 49 y posteriores) no tienen catalogo, asi que se les da uno EXPLICITO
// con este helper en vez de apoyarse en ningun bypass (que ya no existe).
//
// Uso tipico en una suite de call-site:
//   beforeEach(async () => { await sembrarCatalogoEstados(); });
//   ... y usar `idEstado("en_reparto")` en vez de un id sintetico tipo "os-x", para que el par
//   `origen -> destino` que el repo registra sea uno REAL del mapa `TRANSICIONES`.
//
// `sembrarCatalogoEstados` calienta la cache POR PROCESO del resolvedor real usando su API
// publica (`resolverCatalogoEstadosReal` + `resetCatalogoEstadosCache`): no hay hook nuevo en
// produccion, y la guardia corre COMPLETA (resuelve ambos ids y valida el par contra el mapa).

/** Id determinista del estado `value` en el catalogo de test (`os-<value>`). */
export function idEstado(value: OrderStatusValue): string {
  return `os-${value}`;
}

/** Filas tal como las devuelve `SELECT id, value FROM order_status` con el seed aplicado. */
export function filasCatalogoEstados(): { id: string; value: string }[] {
  return ORDER_STATUS_SEED.map((value) => ({ id: idEstado(value), value }));
}

/** `tx` minimo cuya unica capacidad es responder la consulta del catalogo de la guardia. */
function txSoloCatalogo() {
  return {
    $queryRaw: async () => filasCatalogoEstados(),
  };
}

/**
 * Deja la cache por proceso del catalogo cargada con los 18 `value` del `ORDER_STATUS_SEED`.
 * A partir de aqui la guardia valida SIN tocar el `$queryRaw` del doble de la suite (la cache
 * responde), asi que no interfiere con los `mockResolvedValue` que cada suite ya usa para SUS
 * consultas crudas.
 */
export async function sembrarCatalogoEstados(): Promise<void> {
  resetCatalogoEstadosCache();
  await resolverCatalogoEstadosReal(txSoloCatalogo() as never);
}
