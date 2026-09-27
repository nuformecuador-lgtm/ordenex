import type { RolValue } from "@prisma/client";

import { ROL_LABELS } from "@/lib/auth/rol-label";

/**
 * ⭑ FICHA 436 — EL TEXTO DE SISTEMA. Módulo PURO: sin `fs`, sin red, sin Prisma, sin `next/*`.
 *
 * Aquí viven, escritos, los cuatro límites que definen qué ES este asistente (D1-D5). Están en
 * un archivo propio y se afirman POR SU LITERAL en `tests/unit/asistente/instrucciones.test.ts`
 * por la misma razón que los rótulos de la 431: un texto que nadie ancla se «mejora» hasta
 * desaparecer, y el día que desaparezca la orden de decir «no lo sé» nadie se va a enterar —el
 * asistente seguirá respondiendo, sólo que inventando.
 */

/**
 * El marcador con el que el modelo señala un documento. Se elige una forma que NO aparece en
 * Markdown normal (`[[doc:...]]`) para que no haya forma de confundir una cita con un enlace
 * escrito por el propio documento.
 *
 * ⚠️ Lo que el modelo escriba aquí NO se pinta tal cual: cada slug se valida contra el conjunto
 * ENTREGADO en esa consulta y el que no esté se descarta (R24, `lib/asistente/citas.ts`).
 */
export const MARCADOR_CITA_ABRE = "[[doc:";
export const MARCADOR_CITA_CIERRA = "]]";

/**
 * ⭑ LA ORDEN DE NO INVENTAR (R5). Es el literal que el test ancla.
 *
 * Y es TAMBIÉN la señal que se cuenta: el servicio mira si la respuesta empieza por «No lo sé»
 * para incrementar un contador —el número, nunca el texto (Q5)—. Por eso el arranque exacto
 * está dicho aquí y no queda a gusto del modelo: es el único bucle de realimentación de toda
 * la pieza, y sirve para saber qué documento falta escribir.
 */
export const ARRANQUE_NO_LO_SE = "No lo sé";

/**
 * Detecta la señal de «no lo sé» en el arranque de una respuesta.
 *
 * Tolera la tilde y las mayúsculas porque el modelo escribe prosa, no un protocolo; NO tolera
 * que la frase aparezca en medio («en el documento X no lo sé dice…»), porque entonces contaría
 * como laguna una respuesta que sí resolvió la duda.
 */
export function pareceNoLoSe(respuesta: string): boolean {
  return /^\s*(?:[*_#>\s]*)no lo s[eé]/i.test(respuesta);
}

/**
 * ⭑ R32 — QUIÉN ES CADA ROL, en una frase y en el idioma de quien lee.
 *
 * ⚠️ NO ES TEXTO INVENTADO: sale de la tabla «Cómo está organizada» de `docs/ayuda/README.md`
 * («`mensajero/` → los mensajeros», «`oficina/` → maestro y administradores», …), que es la misma
 * fuente que agrupa el índice de la 433. Aquí está escrita a mano porque este módulo es PURO —no
 * lee archivos— y porque un `Record` exhaustivo sobre `RolValue` obliga a decidir la frase el día
 * que el esquema gane un rol, en vez de dejar al modelo sin saber con quién habla.
 *
 * `apiKey` está por exhaustividad del `Record` y NO llega nunca hasta aquí: el servicio lo rechaza
 * antes de componer nada (R13), y ese rechazo tiene su propio test.
 */
export const QUIEN_PREGUNTA: Record<RolValue, string> = {
  maestro: "trabaja en la oficina de Ordenex y ve el portal interno entero",
  admin: "trabaja en la oficina de Ordenex",
  mensajero: "reparte y recoge paquetes en la calle, con el teléfono en la mano",
  adminTienda: "administra una tienda que le manda envíos a Ordenex",
  adminSatelite: "administra una bodega satélite",
  apiKey: "es una cuenta de máquina",
};

/**
 * ⭑ LAS INSTRUCCIONES. Función y no constante para que el formato de cita se derive de los
 * marcadores de arriba en vez de estar escrito dos veces (y desincronizarse una vez).
 *
 * ⭑⭑ R32 — **EL ROL VIAJA AQUÍ, Y SALE DE LA SESIÓN.** Hasta la revisión de la ficha, el modelo
 * recibía los documentos correctos y **ninguna pista de con quién hablaba**: tenía que adivinar la
 * persona a partir del contexto, y adivinaba con la misma seguridad con la que acierta. Medido: a
 * un `maestro` —que recibe los 33 documentos, de los cinco portales— le contestó «no tenés cómo
 * asignar… desde tu cuenta de tienda». El documento era el correcto; la instrucción, falsa. Es
 * exactamente el modo de fallo que D4 y todo el acotamiento venían a evitar.
 *
 * ⚠️ **NO CUESTA UN PUNTO DE CACHÉ.** Las instrucciones son el PRIMER bloque del `system` y el
 * `cache_control` va en el ÚLTIMO de documentación (`lib/clients/anthropic-asistente.ts`), así que
 * el prefijo cacheable sigue siendo uno por rol —cinco, los que el diseño presupuestó— en vez de
 * uno por conjunto de documentos. No hay compromiso que discutir.
 *
 * ⚠️ **Y NO VIAJA COMO CAMPO DEL PUERTO.** `ConsultaAsistente` sigue sin conocer `rol` a propósito
 * (ver su cabecera): si el puerto lo llevara, alguien podría acabar decidiendo el acceso en el
 * adaptador, que es el sitio donde nadie lo mira. El rol entra donde tiene efecto —el texto que el
 * modelo lee— y el acotamiento sigue ocurriendo antes, en el servicio.
 */
export function instruccionesDelSistema(rol: RolValue): string {
  return [
    "Sos el asistente de ayuda de Ordenex, una empresa de mensajería de Costa Rica.",
    "Respondés preguntas sobre CÓMO SE USA LA APLICACIÓN, y nada más.",
    "Hablás en español de Costa Rica, en segunda persona («tenés», «podés»), claro y corto.",
    "",
    `QUIÉN TE PREGUNTA. Esta persona entra a Ordenex como ${ROL_LABELS[rol]}: ${QUIEN_PREGUNTA[rol]}.`,
    "Eso lo dice su sesión, no ella: no se lo preguntes y no lo deduzcas de lo que te cuente.",
    "Explicale los pasos TAL Y COMO LOS VE ELLA, con las pantallas que tiene. Y NO le digas que",
    "algo «no lo puede hacer desde su cuenta» a menos que lo diga la documentación de abajo: si no",
    `lo sabés, decís «${ARRANQUE_NO_LO_SE}».`,
    "",
    "LÍMITES. Son cuatro y no tienen excepción:",
    "",
    "1. NO CONSULTÁS DATOS. No ves órdenes, ni cierres, ni dinero, ni usuarios, ni ninguna",
    "   información de la base. Si te preguntan por un dato concreto —«¿cuánto me deben?»,",
    "   «¿dónde está la guía 123?»— explicás en qué pantalla lo puede mirar la persona, y no",
    "   inventás la cifra.",
    "",
    "2. NO EJECUTÁS NADA. No asignás, no gestionás, no marcás, no cerrás, no creás ni borrás.",
    "   Explicás los pasos para que la persona lo haga.",
    "",
    `3. NO INVENTÁS. Tu ÚNICA fuente es la documentación que viene abajo. Si lo que te preguntan`,
    `   no está ahí, respondés empezando por «${ARRANQUE_NO_LO_SE}» y a continuación señalás`,
    "   dónde mirar: el documento más cercano, la pantalla donde suele estar, o a quién",
    "   preguntar dentro de la empresa. Nunca completes un hueco con lo que te parezca probable.",
    "",
    "4. CITÁS TUS DOCUMENTOS. Cada respuesta que salga de la documentación termina nombrando",
    `   los documentos en los que se apoya, con la forma ${MARCADOR_CITA_ABRE}slug${MARCADOR_CITA_CIERRA},`,
    `   por ejemplo ${MARCADOR_CITA_ABRE}mensajero/reparto${MARCADOR_CITA_CIERRA}. Usá el slug`,
    "   exacto tal y como aparece rotulado en cada documento. Si no usaste ninguno, no cites.",
    "",
    "LO QUE TENÉS DELANTE. Abajo va la documentación que ESTA persona puede leer, y sólo esa.",
    "Si te piden explicar algo de otro portal —la caja de la empresa a un mensajero, por",
    `ejemplo— y no está abajo, no lo sabés: respondés «${ARRANQUE_NO_LO_SE}» y sugerís preguntar`,
    "a la oficina. No es una evasiva: es que de verdad no lo tenés.",
  ].join("\n");
}
