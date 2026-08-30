import { fechaCalendarioCR, inicioDelDiaCREnUtc } from "@/lib/utils/fecha-cr";

/**
 * Ficha 334 (R22/R23, design §8.2) — traduce la FECHA que el usuario eligio (`YYYY-MM-DD`) al
 * INSTANTE que se guarda en `wallet_movimiento.fecha_movimiento`.
 *
 * ── Los dos casos, y por que ──────────────────────────────────────────────────────────────
 *
 * - **Fecha = hoy CR (o sin fecha):** `undefined`. La clave NO viaja al repositorio y manda el
 *   `DEFAULT CURRENT_TIMESTAMP` de la columna, asi que el caso normal es byte a byte el de hoy:
 *   el movimiento sigue llevando la hora real y sigue encabezando el libro. Fijar `06:00Z`
 *   tambien para hoy lo hundiria por debajo de todos los automaticos del dia y el usuario NO lo
 *   veria donde espera verlo — un fallo mudo, que es la familia que este repo tiene medida.
 *
 * - **Fecha anterior:** `${fecha}T06:00:00.000Z`, el instante en que ese dia EMPIEZA en Costa
 *   Rica. Es la misma frontera que usan el rollup diario (`FinanzasDiarioRepository`, que
 *   agrupa por `(fecha_movimiento − 6h)::date`) y los cubos de la analitica financiera para
 *   decidir a que dia pertenece una fila, asi que el movimiento cuenta en el dia elegido y en
 *   ningun otro (R25).
 *
 * ── La convencion `00:00Z` esta descartada CON RAZON MEDIDA ───────────────────────────────
 *
 * La ficha 172 eligio medianoche UTC para los ledgers de tienda y mensajero, y para AQUELLOS
 * consumidores es correcto. Aqui no: `(00:00Z − 6h)::date` cae en el dia ANTERIOR, o sea que el
 * gasto de ayer se contaria como de anteayer en el rollup y en los cubos. Un numero mal puesto
 * en un informe es peor que una fila que no entra por un filtro. No se reintroduzca.
 *
 * ── Por que aqui y no como metodo privado de cada servicio ────────────────────────────────
 *
 * La usan los DOS servicios que escriben dinero a mano (`WalletService` y `WalletEgresoService`)
 * y es la definicion del instante de un movimiento: escrita dos veces, puede divergir en una
 * sola de ellas y la mitad del libro quedaria fechada con otra convencion sin que nada falle.
 * Sigue siendo logica de servicio —pura, sin HTTP ni Prisma—, solo que con un unico ejemplar.
 */
export function instanteDelMovimientoManual(
  fecha?: string,
  now: Date = new Date(),
): Date | undefined {
  if (fecha === undefined || fecha === fechaCalendarioCR(now)) return undefined; // R23
  return inicioDelDiaCREnUtc(fecha); // R22
}
