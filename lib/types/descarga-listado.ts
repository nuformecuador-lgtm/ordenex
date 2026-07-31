// Feature 170 (T0.1, design §3) — resultado del modo «dataset completo» de un listado.
//
// La feature 151 escribio este union A MANO para ordenes (`ListarOrdenesCompletoResult`,
// `lib/types/orden.ts`). La 170 cablea la descarga en 25 tablas, siete de ellas con su
// propio `listarCompleto` de servidor: si cada una reinventa el union, cada una lo
// reinventa con matices (una devuelve `limit` en vez de `limite`, otra mete las filas
// junto al error) y el adaptador de cliente deja de poder ser uno solo.
//
// Modulo de TIPOS: no importa React, Prisma, `lib/services` ni `lib/actions`. La unica
// dependencia es `ActionError`, que es el union de errores de borde comun del repo y vive
// en `lib/types/orden` (mismo import de tipo que ya hacen `lib/utils/action-error-message`,
// `lib/actions/_shared/to-action-error` y `lib/types/notificacion`). Es un `import type`:
// se borra al compilar y no arrastra nada al bundle.

import type { ActionError } from "@/lib/types/orden";

/**
 * Resultado del listado SIN recorte por pagina, tal como lo devuelve el BORDE (Server
 * Action) al cliente. Tres formas, y solo tres:
 *
 *  - `ok`: el dataset completo (`items`) y su `total`. R9: una fila por elemento del
 *    dataset, no por elemento de la pagina visible.
 *  - `limite_excedido`: el dataset supera el tope. Lleva SOLO conteos (`total`, `limite`),
 *    NUNCA filas ni PII (R27), y NUNCA un dataset truncado (R28).
 *  - `ActionError`: el resto de fallos de borde (sin sesion, prohibido, entrada invalida).
 *    Tampoco viaja con filas (R16/R17/R18).
 *
 * El tope lo evalua y lo aplica el SERVICIO (R29); este tipo solo transporta lo que aquel
 * decidio. Quien redacta el mensaje para el usuario es el adaptador de cliente
 * (`components/shared/descarga-resultado`), no cada pantalla.
 */
export type ListarCompletoResult<T> =
  | { status: "ok"; items: T[]; total: number }
  | { status: "limite_excedido"; total: number; limite: number }
  | ActionError;

/**
 * Feature 170 (T B.1 / T C.1) — el mismo resultado visto desde el SERVICIO, que no conoce
 * el borde: no hay `unauthenticated` (eso lo decide la Server Action antes de llamarlo) ni
 * `validation_error` (eso lo decide zod), pero SI hay `forbidden`, que es un resultado de
 * DOMINIO —el rol del actor no puede ver ese listado (R17)— y por tanto lo devuelve quien
 * conoce el dominio.
 *
 * Existe por el mismo motivo que su hermano de borde: seis servicios nuevos escriben este
 * union en la Tanda B y la C, y seis copias divergen. Las tres formas son EXCLUYENTES: ni
 * `limite_excedido` ni `forbidden` llevan nunca `items` (R17/R27).
 */
export type ListarCompletoServiceResult<T> =
  | { status: "ok"; items: T[]; total: number }
  | { status: "limite_excedido"; total: number; limite: number }
  | { status: "forbidden" };
