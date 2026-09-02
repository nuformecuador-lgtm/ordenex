/**
 * Pedido humano (2026-08-26) — QUE ESTADOS DE USUARIO NO PUEDEN RECIBIR TRABAJO, en un solo sitio.
 *
 * El incidente: un mensajero dado de baja (`inactivo`) seguia apareciendo elegible en los tres
 * selectores de asignacion y el servidor lo ACEPTABA. Palabras del humano: «un usuario con estado
 * inactivo se le puede asignar ordenes, si esta inactivo/bloqueado no se le puede asignar
 * paquetes». La regla que se firma aqui es la segunda mitad de esa frase.
 *
 * `pendiente` NO entra: el humano nombro `inactivo` y `bloqueado`, y un usuario recien creado sin
 * verificar es un caso distinto que nadie ha decidido todavia. No se rellena con supuestos
 * (CLAUDE.md, regla 6); queda como pregunta abierta.
 *
 * Modulo PURO (sin Prisma en runtime, sin React): lo comparten el repositorio, los tres services
 * de asignacion y los tres modales, para que el selector deshabilite EXACTAMENTE a quien el
 * servidor va a rechazar — la leccion del incidente del 18/08 (ver `mensajero-options.ts`).
 *
 * ── FICHA 351 (2026-08-29): LA MISMA LISTA MANDA EN LOS CATALOGOS DE FILTRO ───────────────────
 * Palabras del humano: «muestra tiendas o mensajeros que tenemos desactivos y eso es informacion
 * que no debe mostrarse». Un catalogo de filtro es una lista de OPCIONES para acotar una busqueda,
 * y ofrecer una cuenta dada de baja no acota nada. Desde esta ficha, los catalogos de filtro con
 * usuarios excluyen a los de `ESTADOS_USUARIO_NO_ASIGNABLES` — la MISMA constante, no una segunda
 * lista que pueda desviarse. Quien la use: `UserRepository.listCuentasTienda`,
 * `UserRepository.listMensajerosParaFiltro` y `CierresAdminRepository.findCatalogoFiltros`.
 *
 * ⚠️ FILTRAR EL CATALOGO NO ES FILTRAR LOS DATOS, y esa frontera es LO IMPORTANTE de la 351. Una
 * orden vieja de una tienda hoy inactiva sigue existiendo y su fila sigue mostrando esa tienda:
 * ninguna de las consultas de LISTADO (`OrdenRepository.list`, los cierres, los ledger) mira el
 * estado del usuario, y no debe empezar a mirarlo. Donde una misma consulta alimentaba las dos
 * cosas se separo en dos campos (ver `CatalogoFiltrosCierresDTO`).
 *
 * `pendiente` SIGUE FUERA de la lista, y en los catalogos de filtro eso significa que SE OFRECE.
 * Es deliberado y es la unica lectura coherente con lo que el sistema ya permite: un `pendiente`
 * no esta en `ESTADOS_USUARIO_NO_ASIGNABLES`, asi que HOY se le pueden asignar ordenes y puede ser
 * el mensajero de ordenes vivas. Esconderlo del filtro dejaria sin buscar ordenes que existen —el
 * daño que esta ficha prohibe— para ahorrar una linea en un desplegable. Ademas el humano nombro
 * «desactivos»: `pendiente` es una cuenta recien creada sin verificar, no una dada de baja.
 */

import type { EstadoUsuario } from "@prisma/client";

/** Estados que NO admiten recibir trabajo nuevo (asignacion de paquetes). */
export const ESTADOS_USUARIO_NO_ASIGNABLES: readonly EstadoUsuario[] = ["inactivo", "bloqueado"];

/**
 * El motivo en la opcion del desplegable, entre parentesis: en LENGUAJE CLARO y sin nombrar el
 * estado exacto, igual que `MOTIVO_BLOQUEADO_POR_CIERRE`. Quien asigna no necesita saber si es
 * «inactivo» o «bloqueado»: necesita saber que no puede elegirlo y donde se arregla.
 */
export const MOTIVO_USUARIO_NO_ASIGNABLE = "no está activo";
