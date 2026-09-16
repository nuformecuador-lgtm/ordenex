// FICHA 430 (SF-001, punto 3) — LOS CONTACTOS DEL CHAT DEL MENSAJERO, y su reparto en grupos.
//
// Función PURA (sin JSX, sin DOM, sin negocio de dominio) sobre las listas que ya llegan por props
// al portal. Mismo molde que `mis-asignaciones-buscador.ts` y `recoger-grupos.ts`: se importa sin
// arrastrar jsdom y se prueba aparte en `tests/unit/components`.
//
// ⭑ QUÉ CAMBIA ESTA FICHA, Y ERA UNA LÍNEA. Hasta el 2026-09-15 los contactos del chat se componían
// con `[...porGestionar, ...conAyuda]`: SÓLO órdenes ya recogidas. Una orden asignada y todavía sin
// recoger no tenía fila donde abrirse, así que el mensajero no podía escribirle a su cliente hasta
// tener el paquete encima — justo cuando más falta hace coordinar. Y no era un permiso: la
// autorización del chat (`OrdenEnvioReader.findParaEnvio`) mira `id`, `deletedAt` y
// `mensajeroAsignadoId`, y nada más — ni fecha ni estatus. Era un efecto de cómo se componía la
// lista, y por eso el arreglo vive aquí y no en el servidor.
//
// ⛔ LO QUE NO CAMBIA, Y ES EL REQUISITO DEL HUMANO: escribirle al cliente NO es aceptar la orden.
// Chatear no toca el estatus, así que una orden por recoger sigue en `por_recoger` — no entra al
// corte del día (`CierreDiaRepository` sólo barre `en_reparto` y `ayuda_tienda`) y no se puede
// vencer. Y la puerta de TRABAJAR —recoger, escoger, gestionar— sigue donde estaba, en el servidor
// (`MisAsignacionesService`, ficha 261): esta ficha no la roza. Conversar y trabajar son dos
// puertas distintas, y sólo se abre la primera.
//
// AQUÍ NO SE LEE NINGÚN RELOJ, igual que en `recoger-grupos.ts` y en `lib/utils/dia-reparto-textos
// .ts`: este módulo no importa el objeto de fecha del navegador ni el de internacionalización. La
// partición por día sale de `esParaManana`, que deriva el SERVIDOR (246/R26) y caduca solo al
// llegar el día (246/R25). Un portátil con la hora corrida no puede mandar una orden al grupo
// equivocado.

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { separarPorDia } from "../recoger-grupos";

/**
 * Los contactos del chat, agrupados por LO QUE EL MENSAJERO TIENE EN LA MANO.
 *
 * Tres grupos y no dos: la ficha 277 ya separó en «Por recoger» lo recogible hoy de lo reservado
 * para después, y mezclarlo aquí volvería a juntar lo que el servidor acepta con lo que rechaza.
 */
export interface GruposDeContactos {
  /** Ya recogidas: `en_reparto` (por gestionar) + `ayuda_tienda`. El paquete va en la moto. */
  conElPaquete: MiAsignacionDTO[];
  /** Asignadas y sin recoger, recogibles hoy. */
  porRecogerHoy: MiAsignacionDTO[];
  /** Asignadas y sin recoger, reservadas para un día posterior. */
  paraOtroDia: MiAsignacionDTO[];
  /** Los tres grupos concatenados EN ESE ORDEN. Es la lista que recibe `ChatFlotante`. */
  todas: MiAsignacionDTO[];
}

/**
 * Compone los contactos del chat a partir de las TRES listas que el servidor ya separa.
 *
 * EL ORDEN ES EL DE LA URGENCIA, y no es cosmético: `ChatFlotante` entra por `todas[0]` cuando no
 * hay ninguna orden en detalle, así que lo primero tiene que ser lo que el mensajero está
 * trabajando ahora. Poniendo `conElPaquete` delante, el comportamiento de antes de esta ficha se
 * conserva exactamente para quien ya tiene paquetes encima.
 *
 * NO DEDUPLICA a propósito: las tres listas salen de un único `listarMisAsignaciones` y se
 * particionan por estatus en el servidor, así que una orden no puede estar en dos. Deduplicar aquí
 * escondería el día en que dejen de ser disjuntas, que es un fallo del servidor y no de la lista.
 *
 * ⛔ `porRecoger` NO TIENE VALOR POR DEFECTO, y es deliberado. La prop equivalente de
 * `RepartoModuleProps` se hizo REQUERIDA justamente para que el typecheck enumerara a los
 * productores —un `?` habría dejado pantallas sin contactos y sin un solo error—, y un `= []` aquí
 * reabría el mismo agujero un piso más abajo: medido el 2026-09-16, quitar el tercer argumento en
 * `ChatDelMensajero` dejaba el typecheck EN VERDE. Quien no tenga lista que pasar escribe `[]` a la
 * vista, que es una decisión; la omisión es un descuido, y se lee igual.
 */
export function agruparContactosChat(
  porGestionar: MiAsignacionDTO[],
  conAyuda: MiAsignacionDTO[],
  porRecoger: MiAsignacionDTO[],
): GruposDeContactos {
  const conElPaquete = [...porGestionar, ...conAyuda];
  // La MISMA regla de partición que usa la pantalla «Por recoger» (277/R2-R5), importada y no
  // copiada: dos reglas para «¿de qué día es esta orden?» divergen a la primera corrección.
  const { hoy: porRecogerHoy, otroDia: paraOtroDia } = separarPorDia(porRecoger);
  return {
    conElPaquete,
    porRecogerHoy,
    paraOtroDia,
    todas: [...conElPaquete, ...porRecogerHoy, ...paraOtroDia],
  };
}

/* -------------------------------------------------------------------------- */
/* Los textos de la lista de contactos                                         */
/* -------------------------------------------------------------------------- */
//
// Viven COLOCADOS con la pantalla y no en `lib/` («si se usa en UN SOLO lugar, vive junto a la
// página que lo usa», `docs/architecture.md`). La excepción son los nombres de los dos grupos del
// día, que salen de `lib/utils/dia-reparto-textos.ts` —el vocabulario visible del día de reparto—
// para que la lista del chat y las pestañas de «Por recoger» no puedan llamar distinto a lo mismo.
//
// EN TUTEO, como el resto de la interfaz («Elige una conversación», «No puedes gestionar esta
// orden»). El voseo es de `docs/ayuda/**`, que habla al mensajero en su registro.

/**
 * Encabezado del grupo de las ya recogidas. Es el rótulo que el mensajero ya conoce: el mismo que
 * llevan el chip de la fila y la card de la pantalla de Reparto.
 */
export const SECCION_CON_EL_PAQUETE = "En reparto";

/**
 * Contador de la cabecera de la lista.
 *
 * ANTES DECÍA «N en reparto» Y ESO SE VOLVIÓ FALSO con esta ficha: la lista ya no es sólo de
 * órdenes en reparto. Concuerda en singular por el mismo motivo que `contadorNuevasAsignadas`
 * (277/R29): con una sola orden, «1 asignadas» se lee como un descuido.
 */
export function contadorContactos(cuantas: number): string {
  return cuantas === 1 ? "1 asignada" : `${cuantas} asignadas`;
}

/** Vacío SIN búsqueda: el mensajero no tiene ninguna orden asignada, ni recogida ni por recoger. */
export const SIN_CONTACTOS = "No tienes órdenes asignadas.";

/** Vacío CON búsqueda. Literal conservado tal cual de antes de esta ficha. */
export const SIN_COINCIDENCIAS = "Ninguna conversación coincide con la búsqueda.";

/**
 * Rótulo de la acción que despliega el detalle completo dentro de la conversación (punto 2 de la
 * ficha). Dos literales y no uno con negación: el botón dice lo que va a HACER al pulsarlo.
 */
export const DETALLE_VER = "Ver detalle";
export const DETALLE_OCULTAR = "Ocultar detalle";
