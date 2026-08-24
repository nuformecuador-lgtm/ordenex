// Configuracion del canal de correo saliente (SMTP via nodemailer).
//
// Las credenciales viven SOLO en variables de entorno (docs/architecture.md:
// "Sin hardcode de contexto"); este modulo las lee y valida en un unico sitio,
// igual que lib/config/whatsapp.ts hace con la Graph API.
//
// INVARIANTE DE SEGURIDAD: si falta una pieza se cita el NOMBRE de la variable,
// jamas su valor. La contrasena SMTP no aparece nunca en un error ni en un log.

/** Puerto SMTP por defecto: submission con STARTTLS, el mas portable. */
const DEFAULT_SMTP_PORT = 587;

/** Nombre visible del remitente cuando no se configura uno. */
const DEFAULT_FROM_NAME = "Ordenex";

/** Timeout (ms) de cada fase de la conexion SMTP. Evita colgar una Server Action. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Falta alguna pieza de la configuracion SMTP. Se lanza ANTES de abrir la
 * conexion. Cita QUE falta (nombre de la variable), nunca el valor.
 */
export class EmailNoConfiguradoError extends Error {
  constructor(pieza: string) {
    super(`email: configuracion SMTP incompleta (falta ${pieza})`);
    this.name = "EmailNoConfiguradoError";
  }
}

export interface EmailConfig {
  /** Host del servidor SMTP. */
  host: string;
  /** Puerto SMTP. 465 implica TLS implicito; 587/25 usan STARTTLS. */
  port: number;
  /** TLS implicito desde el saludo. Derivado del puerto salvo override explicito. */
  secure: boolean;
  /** Usuario SMTP. Opcional: hay relays internos que autentican por IP. */
  user: string | null;
  /** Contrasena SMTP. Solo se pasa a nodemailer; nunca se loguea ni se serializa. */
  password: string | null;
  /** Direccion remitente (From). Debe pertenecer al dominio autorizado del relay. */
  from: string;
  /** Nombre visible del remitente. */
  fromName: string;
  /** Timeout por fase (conexion, saludo, socket) en milisegundos. */
  timeoutMs: number;
  /**
   * Validacion del certificado del servidor. `false` SOLO para un relay local de
   * pruebas (Mailpit/MailHog); en produccion jamas se desactiva.
   */
  rejectUnauthorized: boolean;
}

function leerTexto(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  return raw.trim();
}

function leerRequerido(name: string): string {
  const valor = leerTexto(name);
  if (valor === null) throw new EmailNoConfiguradoError(name);
  return valor;
}

function leerBooleano(name: string, fallback: boolean): boolean {
  const raw = leerTexto(name);
  if (raw === null) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function leerEnteroPositivo(name: string, fallback: number): number {
  const raw = leerTexto(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Hay SMTP utilizable. Es la condicion que decide, en el borde, si se instancia
 * el emisor real o el de consola: sin host o sin remitente no hay envio posible,
 * y el flujo debe degradar en vez de reventar en dev y en los tests.
 */
export function emailSmtpConfigurado(): boolean {
  return leerTexto("SMTP_HOST") !== null && leerTexto("SMTP_FROM") !== null;
}

/**
 * Lee y valida la configuracion SMTP. Lanza EmailNoConfiguradoError citando el
 * NOMBRE de la variable ausente. Llamar en el borde, antes de abrir la conexion:
 * asi un fallo de configuracion se detecta sin tocar la red.
 */
export function loadEmailConfig(): EmailConfig {
  const port = leerEnteroPositivo("SMTP_PORT", DEFAULT_SMTP_PORT);
  return {
    host: leerRequerido("SMTP_HOST"),
    port,
    secure: leerBooleano("SMTP_SECURE", port === 465),
    user: leerTexto("SMTP_USER"),
    password: leerTexto("SMTP_PASSWORD"),
    from: leerRequerido("SMTP_FROM"),
    fromName: leerTexto("SMTP_FROM_NAME") ?? DEFAULT_FROM_NAME,
    timeoutMs: leerEnteroPositivo("SMTP_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    rejectUnauthorized: leerBooleano("SMTP_TLS_REJECT_UNAUTHORIZED", true),
  };
}

/**
 * Volcado del codigo OTP en claro por consola. SOLO para desarrollo local sin
 * SMTP: sin esto el flujo de recuperacion no se puede completar en una maquina
 * sin relay. Mismo patron que WHATSAPP_DEBUG_LOG. Vacio en produccion.
 */
export function otpDebugLogHabilitado(): boolean {
  return leerBooleano("AUTH_OTP_DEBUG_LOG", false);
}
