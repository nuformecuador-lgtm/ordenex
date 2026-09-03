/**
 * FICHA 327 (design §3) → FICHA 366 (design §4) — EL COLAPSO DE LA N:M `zona_distrito`, EN UN
 * SOLO SITIO DEL ARBOL.
 *
 * La regla no la inventa ninguna de las dos fichas: ya estaba viva dentro del `.map()` de
 * `OrdenRepository.findDistritosByCantonIds`, y la carga masiva la aplica desde la feature 24.
 *
 *   EXACTAMENTE 1 zona -> esa zona
 *   0 zonas            -> `null` (el distrito no tiene zona asignada: error de fila)
 *   > 1 zonas          -> `null` (ambiguo; NO SE INVENTA UNA ZONA eligiendo la primera)
 *
 * POR QUE VIVE AQUI Y NO COMO METODO PRIVADO DE `OrdenRepository`. Desde la 327 hay DOS lecturas
 * de ese repositorio que la necesitan (`findDistritosByCantonIds` y `findDistritoParaCorreccion`);
 * desde la 366 la necesita ademas `ZonaRepository.update`, que re-deriva la zona de las ordenes
 * cuando se guarda la configuracion de una zona. Copiarla en el segundo repositorio serian dos
 * reglas que un dia divergen, y la que divergiera elegiria la tarifa equivocada —es decir,
 * facturaria mal— sin romper ningun test.
 *
 * Es una funcion PURA y generica: no conoce Prisma, ni la forma de la fila, ni la ficha que la
 * llame. Solo el colapso 1/0/>1.
 */
export function zonaUnicaDeDistrito<T>(zonas: readonly T[]): T | null {
  return zonas.length === 1 ? zonas[0] : null;
}
