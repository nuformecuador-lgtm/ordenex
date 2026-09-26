// Ficha 458-A (TA.4, design §3.5, R10/R11, R1/R2) — el selector de CIERRE de las superficies de
// acceso total (`/wallet/tiendas` y `/wallet/mensajeros`). Modulo PURO: rotulos y textos.
//
// Sustituye al campo de texto donde se pedia «ID del cierre» / «Pegá el identificador»: nadie conoce
// ese identificador, y la unica forma de conseguirlo era copiar la direccion de un enlace. Ahora se
// elige de una lista de los cierres CON movimientos en la cuenta que se mira (R11), rotulados por su
// dia de Costa Rica y el mensajero (R10), y se busca por un dia o por el nombre del mensajero.

import type {
  SelectorBuscableOpcion,
  SelectorBuscableTextos,
} from "@/components/shared/SelectorBuscable";
import type { CierreDeCuentaOpcionDTO } from "@/lib/types/wallet-filtros";

/** `4 movimientos` / `1 movimiento`: el cardinal en palabras. */
function contarMovimientos(n: number): string {
  return n === 1 ? "1 movimiento" : `${n} movimientos`;
}

/**
 * Las opciones del selector. Rotulo: `Cierre del <dia> · <mensajero> · <n> movimientos`; si dos
 * rotulos coinciden, a TODOS los repetidos se les añade la hora (mismo criterio que el selector de
 * `/mi-wallet`, ficha 335). El `value` es el cierre y NUNCA se pinta (R1).
 */
export function opcionesDeCierreDeCuenta(
  cierres: readonly CierreDeCuentaOpcionDTO[],
): SelectorBuscableOpcion[] {
  const base = cierres.map(
    (c) => `Cierre del ${c.dia} · ${c.mensajero} · ${contarMovimientos(c.movimientos)}`,
  );
  const repetidas = new Set(base.filter((rotulo, i) => base.indexOf(rotulo) !== i));
  return cierres.map((c, i) => ({
    value: c.cierreId,
    label: repetidas.has(base[i])
      ? `Cierre del ${c.dia} ${c.hora} · ${c.mensajero} · ${contarMovimientos(c.movimientos)}`
      : base[i],
  }));
}

/** Los textos del selector de cierre, iguales en las dos superficies. */
export const CIERRE_SELECTOR_TEXTOS: SelectorBuscableTextos = {
  todos: "Todos los cierres",
  buscar: "Buscar un cierre",
  buscarMarcador: "Un día (2026-09-12) o el nombre del mensajero",
  cargando: "Cargando cierres…",
  error: "No pudimos cargar los cierres. Probá de nuevo.",
  vacio: "No hay cierres con movimientos que coincidan.",
  hayMas: "Mostramos los cierres más recientes. Buscá por día o por mensajero para ver otros.",
};
