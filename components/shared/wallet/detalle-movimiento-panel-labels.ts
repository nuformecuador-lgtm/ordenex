import type { RegistroDTO } from "@/lib/types/estado-cuenta";
import type { MotivoSinComprobanteLateral } from "@/lib/types/wallet-comprobante-lateral";
import type { MotivoNoAnulable } from "@/lib/types/wallet-anulacion";

// FICHA 458-C (T C.3/C.4, design §3.7/§4.2/§5.1; R58, R63–R67, R71, R72, R79, R80, R100) — los textos
// del panel «Ver» y de «Anular…». Fuera del JSX (docs/conventions). Ningún texto lleva un
// identificador interno (H6): el movimiento se nombra por su concepto, su fecha y su importe.

export const PANEL_TEXTO = {
  ver: "Ver",
  /** Nombre accesible del «Ver» de una fila: la fila dentro (N botones iguales no identifican nada). */
  verNombre: (concepto: string, fecha: string, monto: string) => `Ver ${concepto} del ${fecha} por ${monto}`,
  titulo: "Detalle del movimiento",
  entra: "Entra",
  sale: "Sale",
  aQuien: "A quién",
  porQue: "Por qué",
  como: "Cómo",
  comprobante: "Comprobante",
  registro: "Registró",
  estado: "Estado",
  origen: "De dónde sale",
  sinDato: "—",
  vigente: "Vigente",
  anulado: "Anulado",
  /** R72 — anulado antes de la 458 sin constancia. */
  motivoNoRegistrado: "Anulado · motivo no registrado",
  anuladoDetalle: (fecha: string | null, por: string | null, motivo: string | null) =>
    ["Anulado", fecha === null ? null : `el ${fecha}`, por === null ? null : `por ${por}`]
      .filter((x): x is string => x !== null)
      .join(" ") + (motivo === null ? "" : ` · ${motivo}`),
  esOrdenex: "Ordenex",
  aTercero: (beneficiario: string) => `a ${beneficiario}`,
  cargando: "Cargando…",
  errorAutoria: "No se pudo leer quién lo registró.",
  anular: "Anular…",
  cerrar: "Cerrar",
} as const;

/** R57 — «Automático» y la acción que lo produjo. `Record` total sobre las acciones del servidor. */
export const ACCION_AUTOMATICA_LABEL: Record<NonNullable<RegistroDTO["automatico"]>["accion"], string> = {
  aprobacion_cierre: "Aprobación del cierre",
  plantilla_gasto_fijo: "Plantilla de gasto fijo",
  cobro_por_rechazo: "Cobro por rechazo aprobado",
  incidente: "Incidente resuelto",
  premio_del_ranking: "Premio del ranking",
  sistema: "Registro del sistema",
};

export function textoRegistro(registro: RegistroDTO): string {
  if (registro.nombre !== null) return registro.nombre;
  if (registro.automatico === null) return PANEL_TEXTO.sinDato;
  const { accion, por } = registro.automatico;
  return `Automático · ${ACCION_AUTOMATICA_LABEL[accion]}${por === null ? "" : ` por ${por}`}`;
}

/** R58 — «Cómo quedó»: la caja y la cuenta TRAS el movimiento, del servidor. */
export const COMO_QUEDO_TEXTO = {
  titulo: "Cómo quedó",
  cargando: "Calculando cómo quedó…",
  error: "No se pudo leer cómo quedó la caja tras este movimiento.",
  sinCaja: "Este movimiento no tiene línea en la caja: la caja no cambió con él.",
  cuentaTienda: "Saldo de la tienda",
  cuentaMensajero: "Lo que Ordenex le debe al mensajero",
} as const;

/** R79/R80 — el comprobante: verlo por su rótulo legible, o adjuntarlo una sola vez. */
export const COMPROBANTE_PANEL_TEXTO = {
  /** R80 — el rótulo legible, nunca la ruta del archivo. */
  rotulo: (concepto: string, fecha: string) => `Comprobante de «${concepto}» del ${fecha}`,
  ver: "Ver comprobante",
  sin: "Sin comprobante.",
  adjuntar: "Adjuntar comprobante",
  adjuntarConfirmar: "Adjuntar",
  adjuntarCancelar: "Cancelar",
  adjuntado: "Comprobante adjuntado.",
  yaTiene: "Este movimiento ya tiene un comprobante: no se reemplaza ni se suma otro.",
  noEncontrado: "No se encontró el movimiento.",
  noGuardado: "No se pudo guardar el comprobante. Probá de nuevo.",
  forbidden: "No tenés permiso para adjuntar comprobantes.",
  unauthenticated: "Tu sesión expiró. Iniciá sesión de nuevo.",
  sinArchivo: "Elegí el archivo del comprobante.",
  fallo: "No se pudo adjuntar ahora. Probá de nuevo.",
  verSin: "Este registro no tiene comprobante.",
  verNoEncontrado: "No se encontró el comprobante.",
  verForbidden: "No tenés permiso para ver este comprobante.",
  verFallo: "No se pudo abrir el comprobante ahora. Probá de nuevo.",
} as const;

/** R79 (m6 de la 458-B) — por qué el servidor no admite adjuntar, en palabras. `Record` total. */
export const NO_ADMITE_COMPROBANTE_LABEL: Record<MotivoSinComprobanteLateral, string> = {
  no_admite: "Este movimiento no lleva comprobante.",
  en_su_documento: "El comprobante de este movimiento se adjunta al registrarlo, en su propio documento.",
  anulado: "Este movimiento está anulado: ya no se le adjunta un comprobante.",
};

/** R63–R67 — «Anular…» uniforme. */
export const ANULAR_MOVIMIENTO_TEXTO = {
  titulo: (nombre: string) => `Anular ${nombre}`,
  /** R64: la anulación no borra nada; escribe el movimiento contrario, fechado hoy. */
  descripcion: (monto: string) =>
    `Se registrará hoy un movimiento contrario por ${monto}. El registro original, su comprobante y su historial quedan intactos: no se borra nada.`,
  motivo: "Motivo de la anulación",
  motivoAyuda: "Obligatorio. Queda guardado junto a la anulación.",
  motivoVacio: "Escribí el motivo de la anulación.",
  confirmar: "Anular",
  cancelar: "Cancelar",
  ok: "Anulado. Se registró el movimiento contrario.",
  /** R66 — el segundo intento no registra nada más. */
  yaAnulado: "Ya estaba anulado; no se registró nada más.",
  noEncontrado: "No se encontró ese registro.",
  forbidden: "No tenés permiso para anular este registro.",
  unauthenticated: "Tu sesión expiró. Iniciá sesión de nuevo.",
  validacion: "No se pudo anular: revisá el motivo.",
  fallo: "No se pudo anular ahora. Probá de nuevo.",
  noAnulable: (motivo: MotivoNoAnulable) => `Este movimiento no se puede anular: ${MOTIVO_NO_ANULABLE_TEXTO[motivo]}.`,
} as const;

/** R65 — por qué un movimiento no se anula, en palabras. `Record` total sobre los motivos del servidor. */
export const MOTIVO_NO_ANULABLE_TEXTO: Record<MotivoNoAnulable, string> = {
  contra_asiento: "es la anulación de otro movimiento",
  nace_de_un_cierre: "lo produjo la aprobación de un cierre",
  reclasificado: "se reclasificó como pago de un gasto de la tienda",
  no_aprobado: "el cobro por rechazo no está aprobado",
  sin_linea_de_caja: "no tiene su línea en la caja",
  no_es_anulable: "es un registro automático que no se anula desde aquí",
};

/**
 * R100 — el cobro por rechazo es un CARGO a la tienda (como el cobro de Ordenex de la 461): la ganancia
 * sube y el saldo de la tienda baja, sin dinero nuevo en la caja. R73: anulado, se dice en palabras.
 */
export const COBRO_RECHAZO_TEXTO = {
  vigente:
    "Es un cobro a la tienda por el flete de un rechazo: la ganancia de Ordenex sube y el saldo de la tienda baja, sin dinero nuevo en la caja.",
  anulado:
    "Este cobro por rechazo se anuló: la ganancia de Ordenex bajó y el saldo de la tienda volvió a subir. El cobro sigue aprobado en su cola y no se vuelve a ofrecer.",
} as const;
