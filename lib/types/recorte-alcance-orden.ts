// FICHA 349 (2026-09-01) — EL RECORTE POR ALCANCE DE **UNA FILA DEL LISTADO DE ORDENES**.
//
// ─── QUE ES, Y POR QUE YA NO VIVE EN `lib/types/tablero-dia.ts` ────────────────────────────
//
// Lo declaro la feature 260 (T0.3, R13/R43) para el detalle del tablero del dia, que fue el
// primer sitio donde una fila de `/ordenes` tenia que llegar a un actor de alcance `zona` —el
// `adminSatelite`—. Desde la ficha 349 hay un SEGUNDO consumidor: el listado «Órdenes de la
// bodega» del propio satelite, que pasa a proyectarse con `toListItemDTO`, la MISMA funcion que
// `/ordenes`, en vez de con una segunda lista de campos escrita a mano.
//
// Con dos consumidores, el modulo tenia dos problemas y los dos se arreglan mudandolo aqui:
//
//   1. **El nombre mentia.** El recorte no es «del tablero del dia»: es de una fila de listado
//      de ordenes, sea cual sea la pantalla que la pida.
//   2. **La arista de imports.** `lib/types/tablero-dia.ts` importa `MotivoDenegacion` de
//      `lib/analytics/alcance`, y ese camino llega a `lib/auth/acceso-total`. Es de TIPO y no
//      arrastra runtime, pero el guardia que audita el bundle del panel de cliente
//      (`tests/unit/guards/pagos-captura.guardia.test.ts`) recorre imports SIN distinguir
//      `import type` — y ese hecho ya costo una mudanza identica, la de `FiltroAlcanceTablero`
//      a `lib/types/alcance-tablero.ts`, cuya cabecera cuenta la historia entera. Que la capa de
//      datos del listado tenga que pedir el recorte no puede reabrir aquel camino.
//
// ⚠️ ESTE MODULO SOLO IMPORTA TIPOS DE `lib/types/orden.ts`. Nada mas. Si necesita un valor de
// otro sitio, lo que hace falta es otro modulo — no un import aqui.
//
// `lib/types/tablero-dia.ts` REEXPORTA lo de aqui, asi que para sus consumidores no cambia nada
// y sigue habiendo UNA sola declaracion (R43).

import type { OrdenListItemDTO, OrdenTiendaRef } from "@/lib/types/orden";

/**
 * El alcance con el que se resolvio una lectura de filas de orden. Lista blanca, no el rol.
 *
 * `global` = maestro/admin (`/ordenes`, `/monitoreo` sin recorte). `zona` = el `adminSatelite`,
 * que ve SOLO su zona y no todo lo que se ve de una orden dentro de ella.
 */
export type AlcanceOrden = "global" | "zona";

/**
 * FEATURE 260 (T0.3, R13/R43) — LO QUE **NO SALE** DEL ALCANCE GLOBAL. Una sola declaracion.
 *
 * POR QUE EXISTE, y no es cosmetica: `/ordenes` no admite al satelite de zona
 * (`app/(app)/ordenes/page.tsx` le hace `notFound()`), asi que estas cifras y estos datos de
 * contacto son cosas que ese alcance NUNCA ha podido ver. `/monitoreo` si lo admite, y no
 * puede ser la puerta de atras. El monto a cobrar SI se conserva en los dos alcances (R17):
 * ya lo ve en su propia pantalla de recepcion.
 *
 * FICHA 349 — y el listado «Órdenes de la bodega» del satelite TAMPOCO puede serlo, que es
 * justo lo que se decidio al unificar su proyeccion con la de `/ordenes`: la fila que arma
 * `toListItemDTO` trae los tres importes y el contacto de la tienda, y sale de la capa de datos
 * ya recortada por esta misma funcion. Si algun dia se decide que el satelite SI debe ver flete,
 * comision y fulfillment, se cambia AQUI —una vez, para las dos pantallas— y no ampliando una
 * lista suelta en el repositorio.
 *
 * El recorte es COLUMNA **y** DATO. Las dos mitades, o el cero miente: sin la mitad servidor
 * el dato viaja al navegador aunque no se pinte y se lee con un `View source`; sin la mitad
 * pantalla, `PriceLabel` convierte el hueco en `₡0`, que se lee como «esta orden no paga
 * flete» — una afirmacion falsa, peor que enseñar la cifra (R15).
 *
 * El `satisfies` ata cada nombre a su tipo: un rename en `lib/types/orden.ts` deja de
 * COMPILAR aqui, en vez de filtrar el campo en silencio.
 */
export const CAMPOS_SOLO_ALCANCE_GLOBAL = {
  orden: ["fleteConIva", "comisionConIva"],
  tienda: ["email", "telefono", "tarifa"],
} as const satisfies {
  orden: readonly (keyof OrdenListItemDTO)[];
  tienda: readonly (keyof OrdenTiendaRef)[];
};

/**
 * R13/R46 — PURA. Con `global` devuelve la orden intacta (R46: no se recorta nada por debajo
 * del techo de R18); con `zona`, sin los campos de `CAMPOS_SOLO_ALCANCE_GLOBAL`.
 *
 * Como se retira cada uno: los cuatro opcionales (`fleteConIva`, `comisionConIva`,
 * `tienda.email`, `tienda.telefono`) SE BORRAN —la clave deja de existir, asi que no viaja ni
 * como `undefined` en el JSON—; `tienda.tarifa` se pone a `null`, que es un valor legitimo del
 * tipo y el que ya tiene una tienda sin tarifa activa. Ninguna columna montada en `zona` los
 * lee, asi que ese `null` no puede leerse como una afirmacion falsa.
 *
 * FICHA 349 — es GENERICA en la fila (`T extends OrdenListItemDTO`) y no fija a
 * `OrdenDetalleDia`. El detalle del tablero le pasa su fila (que es `OrdenListItemDTO` mas dos
 * campos del dia) y la bodega satelite le pasa la suya (que es `OrdenListItemDTO` mas los
 * nombres de geografia): el generico conserva el tipo de CADA una, en vez de obligar a la
 * segunda a declarar un recorte propio.
 */
export function recortarPorAlcance<T extends OrdenListItemDTO>(
  orden: T,
  alcance: AlcanceOrden,
): T {
  if (alcance === "global") return orden;

  const recortada = sinClaves(orden, CAMPOS_SOLO_ALCANCE_GLOBAL.orden);
  const relaciones = orden.relaciones;
  if (relaciones === undefined) return recortada;

  return {
    ...recortada,
    relaciones: {
      ...relaciones,
      tienda: relaciones.tienda === null ? null : recortarTienda(relaciones.tienda),
    },
  };
}

/**
 * Los tres campos de tienda de la lista, retirados DERIVANDOLOS de ella y no reescribiendo sus
 * nombres aqui: una segunda lista es lo que R43 prohibe.
 */
function recortarTienda(tienda: OrdenTiendaRef): OrdenTiendaRef {
  const recortada = sinClaves(tienda, CAMPOS_SOLO_ALCANCE_GLOBAL.tienda);
  // `tarifa` es OBLIGATORIA en el tipo, asi que no puede desaparecer: se repone a `null`, el
  // mismo valor que ya tiene una tienda sin tarifa activa. `email` y `telefono` si desaparecen.
  return { ...recortada, tarifa: null };
}

/**
 * Copia sin las claves dadas. `K extends keyof T` acepta solo nombres que EXISTEN en el tipo,
 * asi que un rename en `lib/types/orden.ts` rompe la llamada en vez de filtrar en silencio; y
 * `Partial<T>` en la copia es lo que hace representable el `delete`.
 *
 * El `as T` de la salida es deliberado y esta acotado: quien retira una clave OBLIGATORIA
 * (`tarifa`) la repone inmediatamente, y quien retira opcionales no rompe nada. Sin el, cada
 * llamador tendria que volver a enumerar los campos — la segunda lista que R43 prohibe.
 */
function sinClaves<T extends object, K extends keyof T>(objeto: T, claves: readonly K[]): T {
  const copia: Partial<T> = { ...objeto };
  for (const clave of claves) delete copia[clave];
  return copia as T;
}
