// Feature 41 (R22) — textos i18n-ready y compositor del mensaje accionable de bodega
// satelite BLOQUEADA. Regla estricta R17 (F1.4-Q4): el bloqueo puede provenir de dos
// causas simultaneas o por separado; el mensaje DIFERENCIA cada una:
//   (i)  `porMensajeros`     -> hay cierres de sus mensajeros sin resolver.
//   (ii) `porCierreBodega`   -> su propio cierre de bodega hacia la central sigue
//        pendiente de aprobacion.
// Se reutiliza tanto en el aviso proactivo (RecepcionSateliteModule) como en el toast
// reactivo cuando la Server Action devuelve `bodega_bloqueada` (AsignarSateliteModal).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 (T13, R2/R4) — LA CAUSA (ii) YA NO BLOQUEA, Y POR ESO SU LINEA SE VA DE AQUI.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Se retira `BODEGA_BLOQUEADA_POR_CIERRE_BODEGA` («Tu cierre de bodega hacia la central esta
// pendiente de aprobacion»). NO ES CIERTA EN NINGUNO DE SUS DOS EXTREMOS:
//
//   · «pendiente de APROBACION» — la aprobacion de nivel 2 dejo de existir como puerta: hoy es
//     una MARCA DE CONCILIACION que dice si el efectivo llego (D2). El vocabulario aprobado es
//     «pendiente de conciliar»;
//   · y sobre todo, estaba dentro del bloque de «no puedes asignar», cuando `existeBodega
//     SateliteBloqueada` devuelve ya `bloqueada: false` SIEMPRE (D4). Dejarla ahi seria
//     prometer un freno que no existe, y el aviso mas caro es el que nadie puede obedecer.
//
// EN SU LUGAR entra un aviso que CUENTA Y NO FRENA, en el molde exacto de
// `bodegaCierresAbiertosTitulo` + `BODEGA_CIERRES_ABIERTOS_DETALLE` (el patron que la feature
// 241 ya estableció para la causa (i)). El campo `porCierreBodega` VIAJA IGUAL —es informacion
// util— y ahora con su numero.
//
// ⚠️ LO QUE NO SE HACE AQUI, Y ES DELIBERADO: no hay UMBRAL. No existe un «y si llevan mas de N
// dias, ponlo en rojo». Es la decision Q6 escrita en codigo: un umbral que dispare algo es el
// bloqueo que esta ficha retira, volviendo por la puerta de atras. La presion es visibilidad.

export type BodegaBloqueoCausa = {
  porMensajeros: boolean;
  porCierreBodega: boolean;
};

/** Encabezado comun del aviso (por que no se puede asignar). */
export const BODEGA_BLOQUEADA_TITULO =
  "No puedes asignar órdenes: tu bodega tiene cierres pendientes de resolver.";

/** Causa (i): cierres de los mensajeros de la zona sin resolver. */
export const BODEGA_BLOQUEADA_POR_MENSAJEROS =
  "Resuelve los cierres pendientes de tus mensajeros.";

// ⭑ FICHA 431 (T13): AQUI vivia `BODEGA_BLOQUEADA_POR_CIERRE_BODEGA`, la causa (ii). Se retiro
// —ver la cabecera— y su sustituto, que avisa sin frenar, esta al final de este archivo.

/**
 * Compone las lineas accionables segun la(s) causa(s) activa(s). Devuelve un arreglo
 * (no un string) para que la UI las liste; vacio si no hay causa (defensivo).
 *
 * ⭑ FICHA 431: solo mira `porMensajeros`. La consolidacion pendiente de conciliar ya no es una
 * causa de bloqueo, asi que no tiene linea dentro de un mensaje que empieza por «no puedes
 * asignar»: se cuenta aparte, en su propio aviso.
 */
export function bodegaBloqueadaLineas(causa: BodegaBloqueoCausa): string[] {
  const lineas: string[] = [];
  if (causa.porMensajeros) lineas.push(BODEGA_BLOQUEADA_POR_MENSAJEROS);
  return lineas;
}

/** Mensaje de una linea (titulo + causas) para el toast reactivo. */
export function bodegaBloqueadaMensaje(causa: BodegaBloqueoCausa): string {
  const lineas = bodegaBloqueadaLineas(causa);
  return lineas.length > 0
    ? `${BODEGA_BLOQUEADA_TITULO} ${lineas.join(" ")}`
    : BODEGA_BLOQUEADA_TITULO;
}

// --- Aviso INFORMATIVO (no bloqueante): pedido admin_satelite ---
// Cuando algunos (pero no todos) los mensajeros de la bodega tienen un cierre abierto,
// la asignacion NO se bloquea; solo se avisa cuantos cierres hay abiertos y que se
// puede seguir asignando a los mensajeros sin cierre.

/** Titulo del aviso informativo, con el conteo de cierres abiertos. */
export function bodegaCierresAbiertosTitulo(cierresAbiertos: number): string {
  const plural = cierresAbiertos === 1 ? "" : "s";
  return `Tienes ${cierresAbiertos} cierre${plural} abierto${plural} de tus mensajeros.`;
}

/** Detalle accionable del aviso informativo. */
export const BODEGA_CIERRES_ABIERTOS_DETALLE =
  "Puedes seguir asignando órdenes a los mensajeros que no tienen un cierre activo.";

// --- ⭑ FICHA 431 (T13, R2): el aviso que sustituye al freno ---------------------------------
//
// Cuenta CUANTAS consolidaciones ha mandado esta bodega que la central todavia no ha marcado
// como recibidas, y dice explicitamente que se puede seguir trabajando. Las dos mitades hacen
// falta: el numero solo, sin la segunda frase, se lee como una amenaza —«tenes 3 pendientes»
// junto a un boton de asignar invita a pensar que el boton va a fallar— y es justo la lectura
// que la ficha viene a quitar.

/**
 * Titulo del aviso, con el CONTEO (R2). El numero viaja desde el repositorio
 * (`BodegaBloqueoResult.consolidacionesSinConciliar`): hasta esta ficha no hacia falta porque el
 * indice unico parcial garantizaba que era 1, y ese indice se borro.
 *
 * Se escriben las DOS formas del plural, sin quitar la «s» por regla morfologica.
 */
export function consolidacionesSinConciliarTitulo(consolidaciones: number): string {
  return consolidaciones === 1
    ? "Tenés 1 consolidación que la central todavía no marcó como recibida."
    : `Tenés ${consolidaciones} consolidaciones que la central todavía no marcó como recibidas.`;
}

/**
 * El detalle, y es la mitad que importa: DICE QUE NO FRENA.
 *
 * Antes, esta misma situacion apagaba el boton de asignar. Quien ya conocia esa pantalla espera
 * que siga apagado, asi que no basta con dejarlo encendido: hay que decirlo.
 */
export const CONSOLIDACIONES_SIN_CONCILIAR_DETALLE =
  "Podés seguir asignando órdenes con normalidad.";

/**
 * Nombre accesible del aviso. Esta pantalla monta VARIOS `role="status"` —el de los cierres
 * abiertos de los mensajeros, entre otros— y sin nombre propio ninguno se distingue de los
 * demas para quien navega con lector de pantalla. Es tambien lo que permite que un test afirme
 * SOBRE ESTE aviso y no sobre el primero que aparezca.
 */
export const CONSOLIDACIONES_SIN_CONCILIAR_ARIA = "Consolidaciones pendientes de conciliar";
