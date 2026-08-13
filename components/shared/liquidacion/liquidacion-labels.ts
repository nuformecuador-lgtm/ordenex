/**
 * Feature 172 (Tanda D, design §10) — TEXTOS y etiquetas de la liquidación, separados de los
 * componentes (`docs/conventions`: el texto de UI fuera del componente, listo para i18n).
 *
 * Módulo PURO: sin React, sin DOM y sin `@prisma/client` en runtime (`MetodoLiquidacion` y
 * `PagoRegistradoDTO` entran como `import type`, que se borra al compilar). Lo comparten el
 * diálogo, la tabla de comprobantes y el módulo de columnas de descarga, para que la
 * pantalla y el archivo no puedan acabar diciendo cosas distintas.
 *
 * Lenguaje: claro y sin siglas de jerga. «Fecha del pago» es la fecha REAL en que se entregó
 * el dinero; «Registrado el», el instante en que quedó anotado. Son dos cosas distintas y en
 * un libro de dinero se leen juntas.
 */
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";
import { money } from "@/lib/config/moneda";
import type { MetodoLiquidacion } from "@/lib/types/liquidacion";

/**
 * Feature 201 (tanda C) — `money` ya NO se declara aquí. El motivo por el que no se importaba
 * de una pantalla concreta sigue en pie (este módulo lo usan `/wallet/tiendas` y
 * `/cierres-admin`, y `components/shared/` no puede depender de `app/`), pero la respuesta
 * correcta no era una octava copia byte a byte: es `lib/config/moneda.ts`, que no es una
 * pantalla y del que sí puede depender cualquiera. Se RE-EXPORTA para que la tabla de
 * comprobantes, el diálogo y las columnas de descarga no cambien un import.
 *
 * Money-safe igual que antes (nunca `Number`/`parseFloat`) y `null` → «—».
 */
export { money };

/** Etiqueta legible de cada método de pago. Exhaustiva sobre el catálogo del enum (R8). */
export const METODO_LIQUIDACION_LABEL: Record<MetodoLiquidacion, string> = {
  efectivo: "Efectivo",
  SINPE: "SINPE",
  transferencia: "Transferencia",
};

/**
 * Opciones del selector de método, pobladas desde el SEED y no de una lista escrita a mano:
 * el día que el catálogo gane un valor aparece aquí solo, y el `Record` de arriba rompe el
 * build si nadie le pone etiqueta.
 */
export const METODO_LIQUIDACION_OPTIONS = METODO_PAGO_SEED.map((metodo) => ({
  value: metodo,
  label: METODO_LIQUIDACION_LABEL[metodo],
}));

/** Estado de un comprobante: vigente o anulado (R74). Deriva de si hay bloque de anulación. */
export const PAGO_ESTADO_LABEL = {
  vigente: "Vigente",
  anulado: "Anulado",
} as const;

/** Encabezados de la tabla de comprobantes. Los MISMOS que emite la descarga (R49). */
export const PAGOS_REGISTRADOS_COLUMNAS = {
  fechaPago: "Fecha del pago",
  monto: "Monto",
  metodo: "Método",
  referencia: "Referencia",
  nota: "Nota",
  registradoPor: "Registró",
  registradoEl: "Registrado el",
  estado: "Estado",
} as const;

/**
 * T F.5 — la columna del control de anular. Vive APARTE de las de arriba a propósito: solo
 * existe para quien puede anular (R4/R81) y **no** se descarga (un archivo no tiene botones),
 * así que las columnas de pantalla y las del archivo siguen siendo las mismas ocho.
 */
export const PAGOS_REGISTRADOS_COLUMNA_ACCIONES = "Acciones";

/** Columnas que SOLO existen en el archivo: el detalle de la anulación, desplegado (R74). */
export const PAGOS_REGISTRADOS_COLUMNAS_ANULACION = {
  anuladoPor: "Anulado por",
  anuladoEl: "Anulado el",
  motivoAnulacion: "Motivo de la anulación",
} as const;

/** Textos de la tabla de comprobantes. */
export const PAGOS_REGISTRADOS_TEXTO = {
  vacio: "Todavía no hay pagos registrados.",
  error: "No se pudieron cargar los pagos registrados.",
  /** Nombre accesible de la tabla y título del archivo: identifica al beneficiario. */
  tabla: (beneficiario: string) => `Pagos registrados de ${beneficiario}`,
  /** Resumen de la anulación que acompaña al comprobante anulado (R74). */
  anuladoPor: (nombre: string, cuando: string) => `Anulado por ${nombre} el ${cuando}`,
  motivo: (motivo: string) => `Motivo: ${motivo}`,
  /**
   * T F.5 — nombre accesible del control de anular de UNA fila. Lleva el monto y el día
   * porque puede haber varios pagos en la tabla y varias tablas en la pantalla: cinco botones
   * llamados «Anular» no le dirían a un lector de pantalla cuál es cuál. No lleva ningún
   * identificador interno (R56).
   */
  anularPago: (monto: string, fechaPago: string) =>
    `Anular el pago de ${monto} del ${fechaPago}`,
} as const;

/**
 * T F.5 (design §6, §10.1) — textos del diálogo de ANULACIÓN. Molde: el sub-modal de rechazo
 * de cierre (feature 38/R11), que también exige un motivo escrito antes de confirmar.
 *
 * Lenguaje: **anular no borra**. El pago sigue a la vista con su motivo y el dinero vuelve al
 * saldo por un movimiento nuevo. Nada de vocabulario contable interno en pantalla.
 */
export const ANULAR_PAGO_TEXTO = {
  /** Etiqueta del control de la fila. */
  abrir: "Anular",
  titulo: (beneficiario: string) => `Anular el pago a ${beneficiario}`,
  descripcion:
    "El pago no se borra: queda a la vista, marcado y con el motivo, y el dinero vuelve al saldo con un movimiento nuevo. Si hace falta, después se puede registrar el pago correcto.",
  /** Recuerda QUÉ pago se está anulando: con varios en la tabla, es la última comprobación. */
  resumen: (monto: string, fechaPago: string, metodo: string) =>
    `Pago de ${monto} del ${fechaPago}, en ${metodo}.`,
  confirmar: "Anular pago",
  cancelar: "Cancelar",
  motivo: "Motivo de la anulación",
  motivoAyuda: "Obligatorio. Se guarda junto al pago y lo verá quien revise el comprobante.",
} as const;

/** Mensaje de error del único campo del formulario de anulación (R72). */
export const ANULAR_PAGO_ERROR = {
  motivo: "El motivo de la anulación es obligatorio.",
} as const;

/**
 * Mensajes de la RESPUESTA del servidor, uno por estado de `AnularPagoResult`. Fuera del
 * componente para que el `switch` que los usa sea exhaustivo: un estado nuevo en el contrato
 * rompe el build en vez de caer en un `default` mudo.
 */
export const ANULAR_PAGO_RESPUESTA = {
  ok: "Pago anulado.",
  yaAnulado: "Este pago ya estaba anulado: se conservó la anulación original.",
  noEncontrado: "No se encontró el pago. Vuelve a abrir la pantalla e inténtalo de nuevo.",
  forbidden: "No tienes permiso para anular pagos.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  validacion: "La petición no es válida. Vuelve a abrir la pantalla e inténtalo de nuevo.",
  fallo: "No se pudo anular el pago. Vuelve a intentarlo.",
} as const;

/**
 * Feature 206 — textos de la anulación AGRUPADA, que solo aparecen cuando el pago pertenece a un
 * reparto. Se elige el ALCANCE, y el que viene marcado es «solo este pago»: la acción agrupada
 * mueve N imputaciones y tiene que pedirse a propósito, no caer por defecto.
 */
export const ANULAR_REPARTO_TEXTO = {
  alcance: "Qué se anula",
  soloEstePago: "Solo este pago",
  todoElReparto: "Todas las imputaciones de este reparto",
  ayuda:
    "Este pago se repartió entre varios cierres. Anular el reparto completo deshace todas sus imputaciones con este mismo motivo, en un solo acto.",
  confirmar: "Anular el reparto",
} as const;

/**
 * Mensajes de la respuesta del servidor a la anulación agrupada. `anuladas` y `yaEstaban` se
 * dicen las DOS cuando el reparto estaba a medias: quien anula tiene que saber que se encontró
 * trabajo ya hecho, no solo que «se anuló».
 */
export const ANULAR_REPARTO_RESPUESTA = {
  ok: (anuladas: number, yaEstaban: number) =>
    yaEstaban > 0
      ? `Se anularon ${anuladas} imputaciones; ${yaEstaban} ya estaban anuladas.`
      : `Se anularon ${anuladas} imputaciones del reparto.`,
  sinVigentes: (yaEstaban: number) =>
    `Este reparto ya estaba anulado por completo (${yaEstaban} imputaciones): no se movió nada.`,
  noEncontrado: "No se encontró el reparto. Vuelve a abrir la pantalla e inténtalo de nuevo.",
  fallo: "No se pudo anular el reparto. Vuelve a intentarlo.",
} as const;

/** Textos del diálogo de registro de pago. */
export const REGISTRAR_PAGO_TEXTO = {
  abrir: "Registrar pago",
  titulo: (beneficiario: string) => `Registrar pago a ${beneficiario}`,
  descripcion:
    "El pago queda anotado como documento y no se puede editar: si algo sale mal, se anula y se registra de nuevo.",
  confirmar: "Registrar pago",
  cancelar: "Cancelar",
  disponible: "Disponible",
  disponibleAyuda: "Puedes registrar un pago parcial: escribe un monto menor.",
  monto: "Monto",
  metodo: "Método",
  referencia: "Referencia",
  referenciaAyudaObligatoria: "Número de SINPE o de la transferencia.",
  referenciaAyudaOpcional: "Opcional en efectivo: número de recibo, si lo hay.",
  nota: "Nota",
  notaAyuda: "Opcional. Queda guardada junto al comprobante.",
  fechaPago: "Fecha del pago",
  fechaPagoAyuda: "El día en que se entregó el dinero. No puede ser posterior a hoy.",
} as const;

/** Mensajes de error del formulario, uno por campo, con el criterio del servidor. */
export const REGISTRAR_PAGO_ERROR = {
  monto: "El monto debe ser un número mayor que 0, con hasta 2 decimales.",
  montoTope: (max: string) => `El monto no puede superar ${max}.`,
  referenciaObligatoria: "La referencia es obligatoria en SINPE y transferencia.",
  referenciaLarga: (max: number) => `La referencia no puede superar ${max} caracteres.`,
  notaLarga: (max: number) => `La nota no puede superar ${max} caracteres.`,
  fechaPago: "La fecha del pago no puede ser posterior a hoy.",
} as const;

/**
 * Mensajes de la RESPUESTA del servidor, uno por estado de `RegistrarPagoResult`. Se
 * declaran aquí —y no en el componente— para que el diálogo no tenga que traducir códigos.
 *
 * `excede` y `ya_registrado` reciben datos del servidor y se pintan TAL CUAL: el monto
 * disponible es un STRING que nadie recalcula en el navegador (R14).
 */
export const REGISTRAR_PAGO_RESPUESTA = {
  ok: "Pago registrado.",
  yaRegistrado:
    "Este pago ya estaba registrado: se conservó el comprobante original y no se cobró dos veces.",
  excede: (disponible: string) =>
    `El monto supera lo que se puede pagar. Disponible: ${money(disponible)}.`,
  sinSaldo: "Esta tienda no tiene saldo a favor, así que no hay nada que pagar.",
  cierreNoAprobado: "El cierre no está aprobado, así que todavía no se puede pagar.",
  noEncontrado: "No se encontró a quién pagar. Vuelve a abrir la pantalla e inténtalo de nuevo.",
  forbidden: "No tienes permiso para registrar pagos.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  fallo: "No se pudo registrar el pago. Vuelve a intentarlo; no se registró nada.",
} as const;
