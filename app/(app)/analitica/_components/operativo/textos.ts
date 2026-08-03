// Feature 131 (T1.4) — TEXTOS de UI del tablero operativo.
//
// Modulo PURO: sin React, sin DOM, sin imports de runtime salvo `lib/utils/fecha-cr`
// (calendario de Costa Rica) e `Intl`. Se prueba invocandolo.
//
// R7 — LA FECHA DEL HORIZONTE DEL HISTORIAL NO SE ESCRIBE AQUI. Ni como literal, ni
// como constante propia, ni "para el texto del aviso". El aviso de cobertura se DERIVA
// de `cobertura.fechasNoComparables`, que ya viene en el payload. El censo
// `tests/unit/analytics/operativa-cobertura.test.ts` ("el horizonte se importa de la 125
// y no se reescribe") recorre `app/`, `lib/`, `components/`, `hooks/`, `providers/` y
// `scripts/` y exige que esa fecha aparezca en UN solo archivo del arbol: escribirla aqui
// lo pone rojo, este donde este.
//
// R4/R2 — «prohibido», «sesion no valida» y «vacio» son TRES textos distintos a
// proposito: si se reusan, tres problemas distintos se leen como el mismo pixel.

import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import type { PuntoSerie } from "@/lib/types/analitica-operativa";

/* -------------------------------------------------------------------------- */
/* Hora de Costa Rica (R8)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Hora de pared de Costa Rica de un instante ISO. Se delega en `Intl` con
 * `timeZone`: cero aritmetica horaria propia (la parte de calendario la resuelve
 * `fechaCalendarioCR`, que es la unica pieza del repo que sabe del desfase).
 */
const HORA_CR = new Intl.DateTimeFormat("es-CR", {
  timeZone: "America/Costa_Rica",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function horaCostaRica(corteAt: string): string {
  const instante = new Date(corteAt);
  if (Number.isNaN(instante.getTime())) return "";
  return HORA_CR.format(instante);
}

/* -------------------------------------------------------------------------- */
/* R8 / D2 — el dia en curso, marcado POR TEXTO                                */
/* -------------------------------------------------------------------------- */

/**
 * R8/D2 — la categoria de un punto. El dia en curso viaja `parcial: true` con su
 * `corteAt` y se distingue **por texto**, no solo por color: un color no lo lee un
 * lector de pantalla, y en `SerieTextual` (el equivalente accesible de la grafica)
 * no hay color que leer.
 *
 * Es el punto de mutacion de R8: devolver aqui solo `punto.fecha` deja el dia en curso
 * indistinguible de un dia cerrado.
 */
export function categoriaDePunto(punto: PuntoSerie): string {
  if (punto.parcial !== true) return punto.fecha;
  const hora = punto.corteAt ? horaCostaRica(punto.corteAt) : "";
  return hora === ""
    ? `${punto.fecha} (dia en curso, parcial)`
    : `${punto.fecha} (dia en curso, parcial al corte de las ${hora} de Costa Rica)`;
}

/** R9 — un agregado que incluye el dia en curso NO se presenta como cerrado. */
export function textoTotalParcial(corteAt?: string): string {
  const hora = corteAt ? horaCostaRica(corteAt) : "";
  return hora === ""
    ? "Total parcial: incluye el dia en curso, que aun no ha cerrado."
    : `Total parcial: incluye el dia en curso, con datos hasta las ${hora} de Costa Rica.`;
}

/* -------------------------------------------------------------------------- */
/* R5 / R6 / D1 — la ventana ciega, en UN solo aviso                           */
/* -------------------------------------------------------------------------- */

/**
 * R5/D1 — recuento y extremos, derivados de la lista que llega en el payload. Las
 * fechas vienen en orden ascendente (el servicio las deriva de `fechasDelRango`), asi
 * que los extremos son `[0]` y `[n-1]`.
 *
 * Se declara CUANTAS son y CUALES son sus extremos porque un cero que en realidad es
 * «no hay dato» pintado como un cero normal es una mentira en pantalla: el rollup no
 * cubre esas fechas y las medidas salen a cero LEGITIMAMENTE.
 */
export function textoCobertura(fechasNoComparables: readonly string[]): string {
  const n = fechasNoComparables.length;
  const primera = fechasNoComparables[0] ?? "";
  const ultima = fechasNoComparables[n - 1] ?? "";
  const extremos = n === 1 ? `(${primera})` : `(de ${primera} a ${ultima})`;
  const cuantas = n === 1 ? "1 fecha del rango no es comparable" : `${n} fechas del rango no son comparables`;
  return (
    `${cuantas} ${extremos}: el historial de estados no las cubre, ` +
    "asi que sus medidas salen a cero porque no hay dato, no porque no hubiera actividad."
  );
}

/**
 * R6 — la limitacion PERMANENTE (`cobertura.penumbra`), declarada en el mismo aviso.
 * NO se estima, NO se rellena y NO se convierte en un numero: `PENUMBRA` es una cadena
 * cerrada justamente para que no haya nada que calcular.
 */
export const TEXTO_PENUMBRA =
  "Ademas, y de forma permanente: las ordenes que ya estaban vivas cuando empezo el " +
  "historial y nunca volvieron a cambiar de estado no entran en ningun dia. Esa " +
  "cantidad no se estima ni se rellena.";

export const TITULO_COBERTURA = "Cobertura incompleta del rango";

/* -------------------------------------------------------------------------- */
/* R2 / R3 / R4 / R24 — los cuatro estados que NO son «sin datos»              */
/* -------------------------------------------------------------------------- */

export const TEXTO_PROHIBIDO =
  "No tienes acceso a esta metrica. No se muestra ninguna cifra para este panel.";

export const TEXTO_SESION_NO_VALIDA =
  "Tu sesion no es valida o ha caducado. Vuelve a iniciar sesion para consultar este panel.";

/**
 * R24 — mensaje SANEADO. Fijo y sin interpolar nada del error ni del filtro: el
 * mensaje de una excepcion puede arrastrar ids de orden, guias o telefonos, y el filtro
 * crudo puede arrastrar ids de mensajero.
 */
export const TEXTO_ERROR_PANEL =
  "No se pudo consultar esta metrica. Vuelve a intentarlo con el boton de actualizar.";

/** R3 — nombre humano de cada campo del filtro, para colgar de el su error. */
const ETIQUETA_CAMPO: Readonly<Record<string, string>> = {
  rango: "Rango",
  desde: "Desde",
  hasta: "Hasta",
  zona_id: "Zona",
  tienda_id: "Tienda",
  mensajero_id: "Mensajero",
  _: "Filtro",
};

export function etiquetaDeCampo(clave: string): string {
  return ETIQUETA_CAMPO[clave] ?? clave;
}

/** R3 — «Zona: la lista no puede estar vacia». Nunca «sin datos». */
export function lineasDeValidacion(
  fieldErrors: Readonly<Record<string, readonly string[]>>,
): string[] {
  return Object.entries(fieldErrors).flatMap(([clave, mensajes]) =>
    mensajes.map((mensaje) => `${etiquetaDeCampo(clave)}: ${mensaje}`),
  );
}

export const TITULO_FILTRO_INVALIDO = "El filtro no es valido";

/* -------------------------------------------------------------------------- */
/* R15 / R16 / R17 / R27 — lo que se hizo con los numeros, dicho en voz alta    */
/* -------------------------------------------------------------------------- */

/** R15 — cuantas categorias se metieron en «otros». */
export function textoOtros(agrupadas: number): string {
  return (
    `Se agruparon ${agrupadas} categorias en «otros» para no repetir color entre segmentos. ` +
    "El bloque «otros» no es una categoria del negocio: es la suma de la cola."
  );
}

/** R16 — el grano usado, anunciado. */
export function textoGrano(grano: "dia" | "semana"): string {
  return grano === "semana"
    ? "El rango supera lo que cabe en un eje diario: los conteos se muestran sumados por semana."
    : "Los datos se muestran por dia.";
}

/**
 * R17/R27/D3 — el hueco DECLARADO, no rellenado.
 *
 * No lleva ninguna cifra a proposito: R27 prohibe mostrar un total de esta metrica
 * mientras no exista una fuente que lo calcule sumando ANTES de dividir. Promediar los
 * cocientes diarios seria la media de medias que `AnaliticaOperativaService` evita a
 * proposito, y recomponer la razon a mano duplicaria en la UI una formula de negocio.
 */
export const TEXTO_RANGO_EXCEDIDO =
  "El rango es demasiado largo para esta metrica. No se muestra ni la serie ni ninguna " +
  "cifra: promediar los valores diarios daria un promedio de promedios, que es un numero " +
  "falso. Reduce el rango para verla.";

export const TITULO_RANGO_EXCEDIDO = "Rango demasiado largo para esta metrica";

/** Aviso de recorte que consume el paquete de la 130 (`avisoRecorte`). */
export function avisoRecorte(mostradas: number, recibidas: number): string {
  return `Se muestran ${mostradas} de ${recibidas}; el resto no cabe en este panel.`;
}

/** R35 de la 126 — `sin_gestionar` es DEL DIA (universo B2), no acumulada. */
export const TEXTO_NOTA_SIN_GESTIONAR =
  "Cuenta las ordenes sin gestionar de cada dia, no un acumulado que arrastre dias anteriores.";

/* -------------------------------------------------------------------------- */
/* Vacio y control de actualizacion                                            */
/* -------------------------------------------------------------------------- */

/** El vacio habla de LA METRICA SIN DATOS EN EL RANGO (R25 de la 130). */
export const VACIO_PANEL = {
  titulo: "Sin datos en el rango",
  descripcion: "Esta metrica no registro ningun movimiento con el filtro seleccionado.",
} as const;

export const ETIQUETA_ACTUALIZAR = "Actualizar";

export const DESCRIPCION_ACTUALIZAR =
  "Vuelve a consultar todos los paneles con el filtro que ya esta puesto.";

/** Nombre accesible de la region que agrupa los paneles. */
export const ETIQUETA_REJILLA = "Paneles del tablero operativo";

/** Fecha de hoy en calendario de Costa Rica; util para textos de ayuda. */
export function hoyCostaRica(now: Date = new Date()): string {
  return fechaCalendarioCR(now);
}
