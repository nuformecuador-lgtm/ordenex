// Feature 198 — CONFIGURACION DE LA CACHE DE LOS CONTEOS PUBLICOS.
//
// Un unico sitio declara el TTL: esparcir el numero por el adaptador y por los tests es como
// se acaba teniendo dos verdades sobre cuanto vive un dato. Mismo criterio (y mismo motivo
// escrito) que `lib/config/tablero-dia-cache.ts` de la feature 192.

/**
 * TTL de la entrada, en segundos. 6 h por decision humana del 2026-08-10.
 *
 * Se eligio contra Redis a proposito: el repo NO tiene esa dependencia y el patron de cache
 * que ya usan el tablero del dia y analitica cubre este caso sin infraestructura nueva.
 *
 * Que compra este TTL: los tres conteos recorren tablas grandes SIN ventana temporal —son
 * historicos completos—, asi que la consulta es cara y su resultado se mueve despacio. Seis
 * horas de desfase en «cuantos cantones cubrimos» no cambia ninguna decision; recalcularlo en
 * cada visita de una accion PUBLICA, en cambio, la convierte en un amplificador de carga
 * gratuito contra la base.
 */
export const CONTEOS_PUBLICOS_CACHE_TTL_SEGUNDOS = 6 * 60 * 60;

/**
 * Clave UNICA y constante. No lleva rol, usuario, zona ni ningun otro discriminante, y eso
 * no es un descuido: el resultado es un agregado GLOBAL, igual para todo el mundo. Si algun
 * dia se le anadiera un filtro, esta clave tendria que dejar de ser constante — y ese es
 * justamente el cambio que la guardia de esta feature prohibe (ver requirements R7).
 */
export const CONTEOS_PUBLICOS_CACHE_KEY = "conteos-publicos:v1";
