// Configuracion de la integracion con WhatsApp Cloud API (Meta Graph API).
// Las credenciales viven SOLO en variables de entorno (docs/architecture.md:
// "Sin hardcode de contexto"); este modulo las lee y valida en un unico sitio.
//
// INVARIANTE DE SEGURIDAD (mismo criterio que google-token-shared.ts): si falta
// una pieza se cita el NOMBRE de la variable, jamas su valor. El token nunca
// aparece en un mensaje de error ni en un log.

/** Version de la Graph API. Sobreescribible; default estable a fecha de la feature. */
const DEFAULT_API_VERSION = "v21.0";

/** Categoria por defecto al crear un template en Meta (MARKETING | UTILITY | AUTHENTICATION). */
const DEFAULT_TEMPLATE_CATEGORY = "UTILITY";

/** Idioma por defecto del template al crearlo en Meta. */
const DEFAULT_TEMPLATE_LANG = "es";

/**
 * Maximo de reintentos del job `whatsapp_template_sync` cuando la propagacion sincrona a
 * Meta falla. FIJADO = 5 (decision humana). Override por-fila en el `enqueue`.
 */
export const MAX_INTENTOS_WHATSAPP_TEMPLATE = 5;

/**
 * Falta alguna pieza de la credencial de WhatsApp. Se lanza ANTES de cualquier
 * llamada de red. Cita QUE falta (nombre de la variable), nunca el valor.
 */
export class WhatsappNoConfiguradoError extends Error {
  constructor(pieza: string) {
    super(`whatsapp: credencial incompleta (falta ${pieza})`);
    this.name = "WhatsappNoConfiguradoError";
  }
}

export interface WhatsappConfig {
  /** Token de acceso (Bearer) de la app de WhatsApp Cloud. */
  token: string;
  /** ID del numero de telefono emisor (Phone Number ID de Meta). Envio de mensajes. */
  numeroId: string;
  /**
   * ID de la WhatsApp Business Account (WABA). Necesario para el CRUD de plantillas:
   * las plantillas cuelgan de la cuenta, no del numero.
   */
  wabaId: string;
  /** Version de la Graph API contra la que se llama. */
  apiVersion: string;
  /** Categoria con la que se crean los templates en Meta. */
  templateCategoria: string;
  /** Idioma con el que se crean los templates en Meta. */
  templateIdioma: string;
}

function readRequired(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new WhatsappNoConfiguradoError(name);
  }
  return raw.trim();
}

/**
 * Feature 109 (design §4, R12): configuracion del WEBHOOK de entrada de WhatsApp. Son
 * secretos DISTINTOS de los del envio: el token de verificacion del handshake GET y el App
 * Secret con el que Meta firma el POST (`X-Hub-Signature-256`). Se leen aparte porque el
 * webhook puede estar operativo sin credencial de envio y viceversa.
 */
export interface WhatsappWebhookConfig {
  /** Token del handshake GET (`hub.verify_token`); se compara, jamas se loguea. */
  verifyToken: string;
  /** App Secret con el que se calcula el HMAC-SHA256 del cuerpo crudo del POST. */
  appSecret: string;
}

/**
 * Lee y valida la config del webhook. Lanza WhatsappNoConfiguradoError citando el NOMBRE de
 * la variable ausente, nunca su valor (R12). Llamar en el borde del route handler.
 */
export function loadWhatsappWebhookConfig(): WhatsappWebhookConfig {
  return {
    verifyToken: readRequired("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
    appSecret: readRequired("WHATSAPP_APP_SECRET"),
  };
}

/**
 * Lee y valida la configuracion de WhatsApp. Lanza WhatsappNoConfiguradoError si
 * falta el token o el numeroId. Llamar en el borde, justo antes de construir el
 * cliente; asi un fallo de configuracion se detecta sin tocar la red.
 */
export function loadWhatsappConfig(): WhatsappConfig {
  return {
    token: readRequired("WHATSAPP_CLOUD_TOKEN"),
    numeroId: readRequired("WHATSAPP_NUMERO_ID"),
    wabaId: readRequired("WHATSAPP_WABA_ID"),
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_API_VERSION,
    templateCategoria: process.env.WHATSAPP_TEMPLATE_CATEGORY?.trim() || DEFAULT_TEMPLATE_CATEGORY,
    templateIdioma: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || DEFAULT_TEMPLATE_LANG,
  };
}
