// Feature 126 (T9.6, design §D12 — T0-Q5 = A del 2026-08-02) — EL ORACULO DE IDENTIDAD.
//
// EL AGUJERO, verificado (deuda (c) del review de la 122 del 2026-08-01): `recortarFiltro`
// (`lib/analytics/consulta.ts`) solo interseca LA DIMENSION DEL ALCANCE. Un `adminTienda`
// esta recortado por `tienda_id`, asi que su `mensajero_id: [uuid]` pasa TAL CUAL al `where`.
// La seudonimizacion le oculta el nombre en la SALIDA, pero el CONTEO le confirma si ese
// mensajero trabajo para el: con una lista de uuids obtenida por otra via reconstruye la
// relacion mensajero↔tienda que D5 de la 122 quiso ocultar.
//
// POR QUE VIVE AQUI Y NO EN `consulta.ts` (T0-Q5 = A): `lib/analytics/consulta.ts` es de la
// feature 122 y ya esta MERGEADA; parchearla exigiria su propio PR y su propio dueno. La
// correccion se hace en el borde de la 126.
//
// POR QUE ES UN MODULO PROPIO Y NO ESTA INLINE EN LA SERVER ACTION (R36): la **134** (export
// CSV) tiene que consumir EXACTAMENTE este predicado. Si se copiara alli, el oraculo se
// reabriria por la puerta del CSV, que es el escenario que Q5 = A acepto pagar («el arreglo
// es POR CONSUMIDOR»). Ademas `lib/actions/analitica-operativa.ts` lleva `'use server'`, que
// obliga a que todo export sea una funcion async: un predicado sincrono no cabe alli.
//
// Modulo PURO (guardia R1 de la 135): solo `import type`, sin efectos, sin Prisma, sin
// Next.js. Se puede importar desde un test sin base de datos.

import type { AnaliticaFiltroInput } from "@/lib/analytics/filters";
import type { PoliticaIdentidad } from "@/lib/analytics/identidad";

/**
 * `true` si el filtro SONDEA la identidad de un mensajero bajo una politica que no permite
 * conocerla. El borde responde entonces `forbidden` (`filtro_fuera_de_alcance`) y AUDITA por
 * el mismo camino de R5.
 *
 * Lo que se deniega es el FILTRO, no la VISTA: bajo politica seudonima el actor conserva
 * intacta la desagregacion por mensajero que D5 de la 122 le concedio — la ve etiquetada
 * `Mensajero 1..N`. Esa es la diferencia entre las dos mutaciones de R24: aceptar el filtro
 * (a) reabre el oraculo; retirar la desagregacion (b) castiga de mas.
 *
 * Con `politica === "real"` no hay oraculo que cerrar: quien puede ver el id del mensajero en
 * la salida no gana nada filtrando por el. Devolver `true` ahi romperia a `maestro`, `admin`,
 * `adminSatelite` y al propio `mensajero` (cuyo filtro por si mismo lo escribe la 122).
 */
export function sondeaIdentidadDeMensajero(
  filtro: AnaliticaFiltroInput,
  politica: PoliticaIdentidad,
): boolean {
  if (politica !== "seudonima") return false;
  // `mensajero_id` es una lista NO VACIA por el schema de la 135 (`idList.nonempty()`), asi
  // que su mera presencia ya es el sondeo. No se mira la longitud: un solo uuid basta para
  // confirmar por el conteo, y es justamente el caso mas barato para el atacante.
  return filtro.mensajero_id !== undefined;
}
