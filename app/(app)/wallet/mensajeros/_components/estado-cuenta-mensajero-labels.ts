/**
 * FICHA 458-D (T D.3, design §5; R17, R29, R70) — textos del ESTADO DE CUENTA de un mensajero
 * (`/wallet/mensajeros/[mensajeroId]`) y del enlace que lleva a él desde el listado. Módulo PURO.
 */

export const ESTADO_CUENTA_MENSAJERO_PAGINA = {
  titulo: (mensajero: string) => `Estado de cuenta de ${mensajero}`,
  descripcion:
    "Cada movimiento de la cuenta del mensajero con su saldo corrido: lo que Ordenex le debe por sus cierres, lo que ya le pagó y sus premios",
  volver: "Volver a las cuentas por pagar",
  /** R70 — la anulación desde aquí es la MISMA que la de `/cierres-admin`. */
  anularNota:
    "Para anular un pago, abrí su fila con «Ver»: es la misma anulación que la de Cierres; el pago vuelve a quedar por pagar.",
} as const;

/** R17 — el enlace de la fila del listado. El nombre accesible empieza por el texto visible. */
export const ENLACE_ESTADO_CUENTA_MENSAJERO = {
  columna: "Estado de cuenta",
  visible: "Ver estado de cuenta",
  nombre: (mensajero: string) => `Ver estado de cuenta de ${mensajero}`,
} as const;
