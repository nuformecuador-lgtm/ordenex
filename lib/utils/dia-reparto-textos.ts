import type { DiaReparto } from "@/lib/types/dia-reparto";

// Feature 246 (T4/T5.2) — EL VOCABULARIO VISIBLE del día de reparto: las etiquetas del
// selector, la frase de confirmación y la marca que ve el mensajero.
//
// POR QUÉ UN ARCHIVO APARTE, y no los literales dentro de cada modal. El selector vive en DOS
// superficies (bodega central y bodega satélite, decisión D4) y la marca del portal vive en las
// tres cards del mensajero. Con los literales repartidos, un día una pantalla diría «Mañana» y
// otra «Día siguiente», y la regla del sistema pasaría a depender de desde dónde la lees — que es
// exactamente lo que D4 se firmó para evitar. Es el mismo criterio de `lib/constants/
// bloqueo-mensajero.ts`, y deja el texto listo para i18n.
//
// AQUÍ NO SE LEE NINGÚN RELOJ (R29). Este módulo no importa `Date` ni `Intl`: recibe fechas
// calendario `YYYY-MM-DD` que YA resolvió el servidor con el día de Costa Rica
// (`fechaCalendarioCR` / `mananaCalendarioCR`) y sólo las pone en palabras. Un portátil con la
// hora corrida no puede etiquetar mal una opción porque su hora nunca entra aquí.

/**
 * Meses en minúscula, para componer «20 de agosto».
 *
 * A MANO Y NO CON `Intl.DateTimeFormat`: `Intl` necesita un `Date`, y construir uno a partir de
 * `YYYY-MM-DD` lo interpreta en la zona del navegador — que es justo la puerta por la que R29
 * prohíbe que entre el reloj del cliente. Con una tabla, la conversión es una operación de texto
 * y el resultado es el mismo en cualquier máquina.
 */
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const FECHA_CALENDARIO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `"2026-08-20"` → `"20 de agosto"`. Cadena vacía (no hay fecha que mostrar) → cadena vacía.
 *
 * Lo que no es una fecha calendario se devuelve TAL CUAL en vez de recortarse a ciegas, mismo
 * criterio que `lib/utils/fecha-dia-iso.ts`: partir algo que no es una fecha produce basura con
 * pinta de dato.
 */
export function fechaLegible(fecha: string): string {
  const partes = FECHA_CALENDARIO.exec(fecha);
  if (!partes) return fecha;
  const mes = MESES[Number(partes[2]) - 1];
  if (!mes) return fecha;
  return `${Number(partes[3])} de ${mes}`;
}

/** Las fechas calendario de las dos opciones, resueltas EN EL SERVIDOR y bajadas por props. */
export interface FechasDiaReparto {
  /** Fecha calendario de Costa Rica de hoy (`YYYY-MM-DD`). `""` = no se pudo bajar. */
  hoy: string;
  /** Fecha calendario de Costa Rica de mañana (`YYYY-MM-DD`). `""` = no se pudo bajar. */
  manana: string;
}

/** El nombre de cada opción, sin fecha. Es lo que se lee cuando no hay fecha que acompañar. */
export const DIA_REPARTO_NOMBRE: Record<DiaReparto, string> = {
  hoy: "Hoy",
  manana: "Mañana",
};

/**
 * El mismo nombre en mitad de una frase. Se declara en vez de derivarse con
 * `toLocaleLowerCase`: un cambio de mayúsculas dependiente del locale es una decisión
 * silenciosa en un texto que alguien va a traducir, y aquí sólo hay dos palabras.
 */
const DIA_REPARTO_EN_FRASE: Record<DiaReparto, string> = {
  hoy: "hoy",
  manana: "mañana",
};

/** Título del selector y su ayuda. Separados del componente para que se traduzcan juntos. */
export const SELECTOR_DIA_TITULO = "Día de reparto";
export const SELECTOR_DIA_AYUDA =
  "Todo el lote queda para el día que elijas. Puedes cambiarlo antes de asignar.";

/**
 * Etiqueta de una opción del selector: «Hoy · 20 de agosto».
 *
 * LA FECHA VA A LA VISTA A PROPÓSITO, y no es adorno: lo que se guarda es una FECHA ABSOLUTA, no
 * un interruptor de «para mañana» (decisión D1/D2). Una fecha vence sola; un interruptor habría
 * que apagarlo. Enseñar la fecha es enseñar el modelo correcto — sin ella, «Mañana» se lee como
 * una preferencia permanente del mensajero y no como el día concreto al que va este lote.
 */
export function etiquetaDiaReparto(dia: DiaReparto, fechas: FechasDiaReparto): string {
  const nombre = DIA_REPARTO_NOMBRE[dia];
  const fecha = fechaLegible(dia === "hoy" ? fechas.hoy : fechas.manana);
  return fecha ? `${nombre} · ${fecha}` : nombre;
}

/**
 * R28 — la confirmación con palabras, tras asignar: «El lote quedó para el reparto de mañana,
 * 21 de agosto.»
 *
 * SIN SIGLAS Y SIN JERGA: no dice «reserva», ni «corte», ni una fecha suelta en `YYYY-MM-DD`. Es
 * la misma regla que el repo aplicó al retirar «SLA» del frontend. Sin fecha a mano la frase
 * sigue siendo cierta y completa; sólo pierde precisión.
 */
export function confirmacionDiaReparto(dia: DiaReparto, fechas: FechasDiaReparto): string {
  const nombre = DIA_REPARTO_EN_FRASE[dia];
  const fecha = fechaLegible(dia === "hoy" ? fechas.hoy : fechas.manana);
  return fecha
    ? `El lote quedó para el reparto de ${nombre}, ${fecha}.`
    : `El lote quedó para el reparto de ${nombre}.`;
}

/**
 * R22 — lo que el mensajero lee en la card de una orden reservada para el día siguiente.
 *
 * CON PALABRAS Y NO SÓLO CON COLOR: el repo tiene guardia de contraste y una lección escrita
 * sobre medir color en el navegador. Un chip de otro tono no dice QUÉ es la orden; este texto sí.
 */
export const ETIQUETA_PARA_MANANA = "Para mañana";
