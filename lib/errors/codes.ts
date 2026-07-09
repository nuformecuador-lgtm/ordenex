// Feature 10 — Manejador de errores global (backend)
// Codigos, mapas HTTP, mensajes fijos (es) y puente con los status de dominio.

// R2: AppErrorCode en UPPER_SNAKE. Son DISTINTOS de los literales de `status` de
// dominio ("validation_error", "unauthenticated", ...). El puente lo da CODE_BY_DOMAIN_STATUS.
export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

// R3: HTTP de referencia por codigo (no acopla la shape a HTTP).
export const HTTP_STATUS_BY_CODE = {
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
} as const satisfies Record<AppErrorCode, number>;

// R15: mensajes FIJOS en espanol, sin i18n ni claves de traduccion.
export const MSG = {
  VALIDATION_ERROR: "Los datos enviados no son validos.",
  UNAUTHORIZED: "No hay una sesion valida.",
  FORBIDDEN: "No tienes permiso para realizar esta accion.",
  NOT_FOUND: "El recurso solicitado no existe.",
  CONFLICT: "La operacion entra en conflicto con el estado actual.",
  INTERNAL: "Error interno del servidor.",
} as const satisfies Record<AppErrorCode, string>;

// R16: puente con los `status` de dominio ya usados por services/actions.
// Habilita a la feature 12 a migrar los switch/case sin ambiguedad.
export const CODE_BY_DOMAIN_STATUS = {
  validation_error: "VALIDATION_ERROR",
  unauthenticated: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
} as const satisfies Record<string, AppErrorCode>;
