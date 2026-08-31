import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";
import type { SelectOption } from "@/components/ui/select";
import type { CierreTiendaOpcionDTO } from "@/lib/types/wallet-tienda";

/**
 * FICHA 335 (design §4.3) — el catalogo de cierres del libro de ESTA tienda, tal como lo
 * necesita el selector del filtro. Modulo PURO: sin React, sin dinero, sin estado.
 *
 * ⛔ POR QUE NO VIVE EN `mi-wallet-labels.ts`: ese modulo lo REEXPORTA ENTERO
 * `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts`. Meter aqui las opciones del
 * selector se las regalaria a una pantalla que no las usa, y ampliaria un precedente
 * (`CATEGORIA_TIENDA_OPTIONS` ya viaja en esa lista) que conviene no ampliar.
 */

/**
 * Lo que la pagina le pasa al modulo, y el modulo al filtro. Es la lectura de cierres YA
 * resuelta en el servidor: nunca se pide desde el cliente.
 *
 * `disponible` existe porque la caida de esta lectura NO puede esconderle a la tienda su dinero
 * (R29): la pantalla se pinta igual y lo unico que se degrada es el selector, que queda
 * deshabilitado y lo dice.
 */
export interface CierresDeLaTienda {
  opciones: CierreTiendaOpcionDTO[];
  /** El conjunto real supera el tope: solo se ofrecen los mas recientes (R30). */
  hayMas: boolean;
  /** `false` cuando la lectura NO respondio `ok`. */
  disponible: boolean;
}

/**
 * La opcion de partida: no filtrar por cierre (R25). Su `value` es la cadena vacia, que es lo
 * que `buildInput` omite del input de la action — el mismo criterio que las otras tres claves
 * del filtro. Precedente en esta misma pantalla: `CATEGORIA_TIENDA_OPTIONS[0]`.
 */
export const CIERRE_TODOS_OPTION: SelectOption = { value: "", label: "Todos los cierres" };

/** `4 movimientos` / `1 movimiento`: el cardinal se escribe en palabras, no en jerga. */
function contarMovimientos(n: number): string {
  return n === 1 ? "1 movimiento" : `${n} movimientos`;
}

/**
 * El dia del cierre, en el MISMO formato que pinta la columna «Fecha» de la tabla.
 *
 * `fechaDiaISO` es la misma funcion que ya usa la descarga, y produce el mismo dia que
 * `DesgloseTiendaLedger` (que hace `slice(0, 10)`). ⚠️ Trampa horaria deliberada: los dos son
 * el dia UTC. Usar aqui un formateador de calendario local haria que la opcion dijera un dia y
 * las filas de al lado otro.
 */
function diaDe(cierre: CierreTiendaOpcionDTO): string {
  return fechaDiaISO(cierre.fecha);
}

/** `14:30` del ISO, SIN parsear a `Date`: el instante viaja como texto y no se reinterpreta. */
function horaDe(cierre: CierreTiendaOpcionDTO): string {
  return cierre.fecha.slice(11, 16);
}

/**
 * Convierte los cierres en opciones del selector, con «Todos los cierres» al frente.
 *
 * Regla de etiqueta (R23/R24):
 *  1. base = `Cierre del <dia> · <n> movimientos`. Ni una palabra del identificador interno:
 *     nadie conoce un uuid, y ensenarlo era justo el defecto que la ficha arregla.
 *  2. Si una etiqueta base sale REPETIDA, a TODAS sus instancias se les anade la hora. Solo
 *     donde hace falta, para no meter ruido en el caso comun (un cierre por dia).
 *
 * Limite declarado: la hora colapsa al minuto. Dos cierres del mismo minuto seguirian con la
 * misma etiqueta; sus `value` siguen siendo distintos, asi que el filtro funciona igual — lo
 * que se pierde es poder distinguirlos de un vistazo.
 */
export function opcionesDeCierre(
  cierres: readonly CierreTiendaOpcionDTO[],
): SelectOption[] {
  const base = cierres.map((c) => `Cierre del ${diaDe(c)} · ${contarMovimientos(c.movimientos)}`);

  const repetidas = new Set(
    base.filter((etiqueta, i) => base.indexOf(etiqueta) !== i),
  );

  return [
    CIERRE_TODOS_OPTION,
    ...cierres.map((cierre, i) => ({
      value: cierre.cierreId,
      label: repetidas.has(base[i])
        ? `Cierre del ${diaDe(cierre)} ${horaDe(cierre)} · ${contarMovimientos(cierre.movimientos)}`
        : base[i],
    })),
  ];
}
