// Constantes de configuracion del flujo de autenticacion (login RBA).
// Todas sobreescribibles por variable de entorno para no hardcodear umbrales
// de negocio (docs/architecture.md: "Sin hardcode de contexto").

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface AuthConfig {
  /** Fallos consecutivos que disparan el bloqueo temporal duro (R21). */
  MAX_FAILED_ATTEMPTS: number;
  /** Duracion en minutos de la ventana de conteo de fallos y del bloqueo (R21). */
  LOCKOUT_MINUTES: number;
  /** TTL de la sesion concedida, en horas (R23). */
  SESSION_TTL_HOURS: number;
  /** TTL del challenge OTP por email, en minutos (R17-R20). */
  OTP_TTL_MINUTES: number;
  /** Umbral de score a partir del cual el RiskEngine exige challenge (R17). */
  RISK_THRESHOLD: number;
  /** Longitud minima aceptada para cedula/telefono (R10a). */
  CEDULA_TELEFONO_MIN_LENGTH: number;
  /** Longitud maxima aceptada para cedula/telefono (R10a). */
  CEDULA_TELEFONO_MAX_LENGTH: number;
  /** Ventana en minutos para el limite de solicitudes de reset (F20/R19). */
  RESET_REQUEST_WINDOW_MINUTES: number;
  /** Maximo de solicitudes de reset por email dentro de la ventana (F20/R19). */
  RESET_MAX_REQUESTS: number;
  /** Ventana en minutos para el limite de intentos de verificacion (F20/R20). */
  RESET_VERIFY_WINDOW_MINUTES: number;
  /** Maximo de intentos de verificacion por email/IP dentro de la ventana (F20/R20). */
  RESET_MAX_VERIFY_ATTEMPTS: number;
}

export function loadAuthConfig(): AuthConfig {
  return {
    MAX_FAILED_ATTEMPTS: readPositiveInt("AUTH_MAX_FAILED_ATTEMPTS", 5),
    LOCKOUT_MINUTES: readPositiveInt("AUTH_LOCKOUT_MINUTES", 15),
    SESSION_TTL_HOURS: readPositiveInt("AUTH_SESSION_TTL_HOURS", 24),
    OTP_TTL_MINUTES: readPositiveInt("AUTH_OTP_TTL_MINUTES", 10),
    RISK_THRESHOLD: readPositiveInt("AUTH_RISK_THRESHOLD", 50),
    CEDULA_TELEFONO_MIN_LENGTH: readPositiveInt("AUTH_ID_MIN_LENGTH", 7),
    CEDULA_TELEFONO_MAX_LENGTH: readPositiveInt("AUTH_ID_MAX_LENGTH", 15),
    RESET_REQUEST_WINDOW_MINUTES: readPositiveInt("AUTH_RESET_REQUEST_WINDOW_MINUTES", 15),
    RESET_MAX_REQUESTS: readPositiveInt("AUTH_RESET_MAX_REQUESTS", 3),
    RESET_VERIFY_WINDOW_MINUTES: readPositiveInt("AUTH_RESET_VERIFY_WINDOW_MINUTES", 10),
    RESET_MAX_VERIFY_ATTEMPTS: readPositiveInt("AUTH_RESET_MAX_VERIFY_ATTEMPTS", 5),
  };
}

export const authConfig: AuthConfig = loadAuthConfig();
