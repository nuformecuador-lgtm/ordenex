import type { NivelGeografico } from "@/lib/types/geografia-nodo";

// FICHA 374 (design §7.2 · R40/R41/R42) — EL ESTADO DE UN NODO GEOGRAFICO, EN PALABRAS.
//
// Modulo PURO, hermano de `app/(app)/wallet/_components/gasto-fijo-estado-label.ts` y por el mismo
// motivo: el texto lo leen la insignia de la fila Y el nombre accesible del boton de activar, asi
// que vive en un solo sitio. Con los literales repartidos, un dia la insignia diria «Inactivo por
// su canton» y el boton «su canton esta apagado», y quien las viera juntas no sabria si hablan de
// lo mismo.
//
// ⚠️ LA DISTINCION QUE SOSTIENE TODA ESTA PANTALLA: `activo` es el flag PROPIO de la fila; la
// disponibilidad EFECTIVA es la conjuncion con sus ascendientes. Un nodo puede estar «bien» y no
// estar disponible porque su canton se retiro — eso NO es una inconsistencia (R10).

/**
 * Los flags PROPIOS de la cadena del nodo, de la raiz hacia la hoja. El nivel del nodo se deduce
 * del ultimo eslabon presente: `{provincia}` describe una provincia, `{provincia, canton}` un
 * canton y los tres, un distrito.
 */
export interface FlagsDeLaCadena {
  provincia: boolean;
  canton?: boolean;
  distrito?: boolean;
}

/**
 * El estado con el que se pinta la fila. Son tres y no dos: «inactivo» e «inactivo por herencia»
 * exigen acciones distintas, y confundirlos ofreceria un boton que no cambia nada (R41).
 */
export type EstadoGeografico =
  | { tipo: "activo" }
  /** Su propio flag esta apagado. Alguien lo retiro a proposito y se puede devolver. */
  | { tipo: "inactivo_propio" }
  /** Su flag esta encendido; lo que esta retirado es un ascendiente. Activarlo no haria nada. */
  | { tipo: "inactivo_heredado"; ascendiente: Exclude<NivelGeografico, "distrito"> };

/**
 * Clasifica el nodo a partir de los flags de su cadena.
 *
 * PRECEDENCIA DEL ASCENDIENTE CULPABLE: provincia antes que canton, la MISMA precedencia fija y
 * declarada que usa el rechazo de la carga masiva (R33). Con la provincia y el canton retirados a
 * la vez, se nombra la provincia: es el nodo que hay que devolver primero, porque devolver el
 * canton no cambiaria nada.
 */
export function estadoGeografico(flags: FlagsDeLaCadena): EstadoGeografico {
  const esDistrito = flags.distrito !== undefined;
  const esCanton = !esDistrito && flags.canton !== undefined;

  const propio = esDistrito ? flags.distrito : esCanton ? flags.canton : flags.provincia;
  if (propio === false) return { tipo: "inactivo_propio" };

  if (!flags.provincia) return { tipo: "inactivo_heredado", ascendiente: "provincia" };
  if (esDistrito && flags.canton === false) {
    return { tipo: "inactivo_heredado", ascendiente: "canton" };
  }
  return { tipo: "activo" };
}

/** `true` si el nodo se puede usar: ni su flag ni el de ningun ascendiente esta apagado. */
export function esDisponible(estado: EstadoGeografico): boolean {
  return estado.tipo === "activo";
}

/**
 * Los TRES textos de la insignia. El activo no lleva ninguna: en un arbol de 494 distritos, una
 * insignia «Activo» en cada fila seria ruido que tapa las poquisimas que importan.
 */
export const ESTADO_GEOGRAFICO_TEXTO = {
  inactivoPropio: "Inactivo",
  inactivoPorProvincia: "Inactivo por su provincia",
  inactivoPorCanton: "Inactivo por su cantón",
} as const;

/** La insignia de la fila, o `null` cuando el nodo esta disponible y no hay nada que señalar. */
export function etiquetaEstadoGeografico(estado: EstadoGeografico): string | null {
  if (estado.tipo === "activo") return null;
  if (estado.tipo === "inactivo_propio") return ESTADO_GEOGRAFICO_TEXTO.inactivoPropio;
  return estado.ascendiente === "provincia"
    ? ESTADO_GEOGRAFICO_TEXTO.inactivoPorProvincia
    : ESTADO_GEOGRAFICO_TEXTO.inactivoPorCanton;
}

/**
 * Por que «Activar» esta apagado (R41).
 *
 * SOLO en el heredado: ahi el flag propio YA esta encendido, asi que pulsar no cambiaria nada
 * visible — seria un boton que miente. En el inactivo propio, en cambio, «Activar» funciona
 * aunque su padre siga retirado: el nodo queda con flag propio encendido y disponibilidad falsa,
 * que es un estado legitimo (R15) y el unico camino para dejarlo listo antes de devolver al padre.
 */
export const MOTIVO_ACTIVAR_APAGADO = {
  provincia: "Su provincia está retirada: primero hay que devolverla al catálogo.",
  canton: "Su cantón está retirado: primero hay que devolverlo al catálogo.",
} as const;

export function motivoActivarApagado(estado: EstadoGeografico): string | null {
  if (estado.tipo !== "inactivo_heredado") return null;
  return MOTIVO_ACTIVAR_APAGADO[estado.ascendiente];
}

/**
 * La marca «sin zona» del distrito (R42).
 *
 * ⚠️ SE LEE DE LA ZONA UTILIZABLE, no de «la primera zona». Desde la ficha 374 el arbol aplica el
 * colapso 1/0/>1: un distrito en DOS zonas llega con `zonaId: null`, porque la carga masiva
 * tambien lo rechaza por ambiguo. Antes se pintaba «(zona: X)» y esa etiqueta MENTIA.
 *
 * Hoy un distrito huerfano simplemente no muestra sufijo de zona y no hay forma de verlo de un
 * vistazo: es la informacion que habria hecho evidente el caso de Guacimo, cuyos cuatro distritos
 * estan todos sin zona.
 */
export const MARCA_SIN_ZONA = "Sin zona";

export const AYUDA_SIN_ZONA =
  "Este distrito no tiene una zona utilizable. Las zonas se administran en Tarifas.";
