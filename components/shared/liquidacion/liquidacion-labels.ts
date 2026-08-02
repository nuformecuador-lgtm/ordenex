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
import type { MetodoLiquidacion } from "@/lib/types/liquidacion";

/**
 * Antepone el símbolo de colón a un monto STRING (tal cual, sin parseo). `null` → «—».
 * Money-safe: nunca `Number`/`parseFloat`. Se declara aquí y no se importa de una pantalla
 * concreta porque este módulo lo usan dos features (`/wallet/tiendas` y `/cierres-admin`), y
 * `components/shared/` no puede depender de `app/`.
 */
export function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
}

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
