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
