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
 * FEATURE 262 (B2, R18) — el MISMO selector, en modo CORRECCIÓN. Título y ayuda propios porque la
 * frase de arriba dice «antes de asignar» y aquí ya está asignado: repetirla sería falsa.
 *
 * La ayuda nombra lo que la pantalla hace distinto (no hay opción marcada de salida) porque ésa es
 * la decisión de §7.2: al asignar viene «Hoy» preseleccionado (246/R27), y aquí NO — la mitad de
 * las correcciones son «hoy → mañana» y la otra mitad «mañana → hoy», así que una preselección
 * convertiría un despiste en una corrección equivocada.
 */
export const SELECTOR_DIA_TITULO_CORRECCION = "Nuevo día de reparto";
export const SELECTOR_DIA_AYUDA_CORRECCION =
  "Elige el día al que pasa todo el lote. No hay ninguna opción marcada de salida.";

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

/**
 * FEATURE 277 (B1, R25/R26) — LOS NOMBRES DE LAS DOS PESTAÑAS de «Por recoger». Firmados por el
 * humano el 2026-08-24.
 *
 * VIVEN AQUÍ, y no en la pantalla, por lo mismo que `ETIQUETA_PARA_MANANA`: éste es el vocabulario
 * visible del día de reparto, y existe para que un día una pantalla no diga «Mañana» y otra «Día
 * siguiente». Los textos de vacío y del puntero, en cambio, son de ESA pantalla y viven colocados
 * con ella (`app/(app)/mis-asignaciones/_components/recoger-grupos.ts`).
 *
 * POR QUÉ EL SEGUNDO NO DICE «mañana», que sería más corto: `fecha_reparto` es un `DATE` libre y un
 * `UPDATE` a mano puede dejarlo en **+2**. No es hipotético — ocurrió en producción el 2026-08-21
 * con la guía 17496963—, así que un grupo llamado «Para mañana» mentiría en cuanto contuviera una
 * orden de pasado mañana, y un grupo mixto no tiene otro nombre honesto. Es el mismo razonamiento
 * con el que `avisoReservaParaOtroDia` lleva la fecha y no la palabra.
 *
 * Y NINGUNO DICE «reserva», la misma regla con la que este repo retiró «SLA» del frontend: por eso
 * «Reservadas para otro día» quedó descartada aun siendo más precisa.
 *
 * SON PARALELOS («Para … / Para …») y dicen qué se puede HACER, no sólo cuándo: el mensajero abre
 * esa pantalla con una pregunta —«¿qué recojo ahora?»— y las dos etiquetas la responden por
 * oposición. El conteo lo compone la pantalla («Para recoger hoy (1)»).
 */
export const PESTANA_PARA_RECOGER_HOY = "Para recoger hoy";
export const PESTANA_PARA_OTRO_DIA = "Para otro día";

/**
 * FEATURE 261 (B2, R11/R13/R15/R32) — LA FRASE ÚNICA del bloqueo por reserva. La leen la card
 * del mensajero, el rechazo del escáner, el botón deshabilitado de «Reparto» y el modal de la
 * tienda; y el SERVIDOR devuelve esta misma frase en el `motivo` de sus `conflict`.
 *
 * POR QUÉ LLEVA LA FECHA Y NO LA PALABRA «mañana», que sería más corta: el alcance del producto
 * tope a «mañana» (246/D2), pero `fecha_reparto` es un `DATE` libre y **un `UPDATE` a mano puede
 * dejar +2**. No es hipotético: en esta misma ficha hubo uno, autorizado, en producción el
 * 2026-08-21. Si el texto dijera «mañana», la app mentiría justo en el caso en que un humano
 * tocó la fila. Con la fecha, la frase es cierta siempre.
 *
 * SIN SIGLAS Y SIN NOMBRES DE COLUMNA, la misma regla con la que el repo retiró «SLA» del
 * frontend: no dice «reserva», ni «corte», ni `fecha_reparto`, ni una fecha en `YYYY-MM-DD`.
 *
 * Y SIN RELOJ (R14): reutiliza `fechaLegible`, que es puro y no construye ningún `Date`. Este
 * módulo sigue sin importar `Date` ni `Intl`.
 *
 * @param fechaISO fecha calendario `YYYY-MM-DD` YA resuelta por el servidor, o `null`/`undefined`
 *   si no hay ninguna que mostrar (la frase sigue siendo cierta, sólo pierde precisión).
 */
export function avisoReservaParaOtroDia(fechaISO: string | null | undefined): string {
  const fecha = fechaISO ? fechaLegible(fechaISO) : "";
  return fecha
    ? `Esta orden es para el reparto del ${fecha}. Ese día podrás recogerla y gestionarla.`
    : "Esta orden es para un día de reparto posterior. Podrás recogerla y gestionarla ese día.";
}

/**
 * R15 — el motivo que devuelve EL SERVIDOR cuando rechaza por reserva, en los rechazos que no
 * llevan la fecha consigo (escoger y gestionar del mensajero, y el detalle de recoger, que viaja
 * además con `codigo: "reservada_para_otro_dia"` para que la UI pinte la variante CON fecha).
 *
 * Es la MISMA función, invocada sin fecha: una sola fuente, no un segundo literal que pueda
 * divergir del anterior a la primera corrección de estilo.
 */
export const RESERVA_MOTIVO_SERVIDOR = avisoReservaParaOtroDia(null);

/**
 * FEATURE 262 (B2, R16/R18) — el día para el que UNA orden está marcada HOY, tal y como se lee en
 * la lista del lote antes de confirmar la corrección: «hoy está para el 22 de agosto».
 *
 * POR QUÉ ES R16 Y NO ADORNO: es lo único que impide corregir a ciegas un lote mixto. Quien
 * selecciona veinte órdenes y no ve el día de cada una no sabe cuáles está moviendo ni desde dónde.
 *
 * SIN SIGLAS Y SIN NOMBRES DE COLUMNA, y sin `YYYY-MM-DD` a la vista: la misma regla con la que
 * este repo retiró «SLA» del frontend. No dice «reserva», ni «corte», ni `fecha_reparto`.
 *
 * Y SIN RELOJ (R17): reutiliza `fechaLegible`, que es puro. Este módulo sigue sin importar `Date`
 * ni `Intl` — la fecha llega YA resuelta por el servidor (`fechaRepartoISO` del DTO del listado).
 *
 * @param fechaISO fecha calendario `YYYY-MM-DD` ya resuelta por el servidor, o `null`/`undefined`
 *   si la orden no tiene día (caso que la corrección RECHAZA, R5, y que la pantalla debe poder
 *   nombrar igualmente en vez de dejar el hueco en blanco).
 */
export function avisoDiaActualDeLaOrden(fechaISO: string | null | undefined): string {
  const fecha = fechaISO ? fechaLegible(fechaISO) : "";
  return fecha ? `hoy está para el ${fecha}` : "hoy no tiene día de reparto";
}

/**
 * FEATURE 262 (F7, R18/R38) — LA PRIMERA LINEA de una entrada de corrección en «Ver historial».
 *
 * ES TEXTO Y NO COLOR, y ésa es la decisión (design §14.4): este repo tiene guardia de contraste
 * y una lección escrita sobre medir color en el navegador. Un punto de otro tono no dice QUÉ es
 * la entrada; la palabra sí. Y hace la entrada distinguible para quien no ve el color.
 */
export const ETIQUETA_CORRECCION_DIA = "Día de reparto";

/**
 * FEATURE 262 (F7, R18/R38) — las DOS fechas de una corrección, en palabras: «Del 21 de agosto al
 * 22 de agosto».
 *
 * SIN SIGLAS, SIN NOMBRES DE COLUMNA Y SIN `YYYY-MM-DD` A LA VISTA (R38), la misma regla con la
 * que este repo retiró «SLA» del frontend. Y SIN RELOJ (R41): se compone con `fechaLegible`, que
 * es puro — este módulo sigue sin importar `Date` ni `Intl`. Las dos fechas llegan YA resueltas
 * por el servidor (`fechaAnteriorISO` / `fechaNuevaISO` del DTO, serializadas en el repositorio).
 *
 * Sin fecha que mostrar la frase pierde precisión pero no deja de ser cierta, mismo criterio que
 * `confirmacionDiaReparto` y `avisoReservaParaOtroDia`.
 */
export function textoCorreccionDiaReparto(
  anteriorISO: string | null | undefined,
  nuevaISO: string | null | undefined,
): string {
  const anterior = anteriorISO ? fechaLegible(anteriorISO) : "";
  const nueva = nuevaISO ? fechaLegible(nuevaISO) : "";
  if (anterior && nueva) return `Del ${anterior} al ${nueva}`;
  if (nueva) return `Pasó al ${nueva}`;
  if (anterior) return `Salió del ${anterior}`;
  return "Se corrigió el día de reparto";
}
