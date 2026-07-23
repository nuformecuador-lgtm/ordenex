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
