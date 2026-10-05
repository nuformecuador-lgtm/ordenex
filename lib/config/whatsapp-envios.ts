// Ficha 474 (design §8) — configuracion de los envios automaticos por WhatsApp.
//
// Todo con default: ninguna variable NUEVA es obligatoria (D2). Se lee en cada llamada (no al
// importar) para que cambiar una variable no exija reiniciar y para que los tests puedan fijarla.
// Las credenciales de Meta NO viven aqui: son las de `loadWhatsappConfig` (lib/config/whatsapp.ts).

const BUCKET_DEFECTO = "whatsapp-envios";
const RETENCION_DIAS_DEFECTO = 30; // D3
const VENTANA_MINUTOS_DEFECTO = 60; // R24

function enteroPositivo(nombre: string, defecto: number): number {
  const raw = process.env[nombre]?.trim();
  if (raw === undefined || raw === "") return defecto;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : defecto;
}

/** Bucket PRIVADO de los PDFs de las ejecuciones (§5.3). */
export function bucketEnviosWhatsapp(): string {
  return process.env.WHATSAPP_ENVIOS_BUCKET?.trim() || BUCKET_DEFECTO;
}

/** Dias que se conserva el PDF de una ejecucion antes de purgarlo (R44, D3). */
export function retencionDiasPdf(): number {
  return enteroPositivo("WHATSAPP_ENVIOS_RETENCION_DIAS", RETENCION_DIAS_DEFECTO);
}

/** Minutos de tolerancia de una ejecucion programada que arranca tarde (R24). */
export function ventanaMinutos(): number {
  return enteroPositivo("WHATSAPP_ENVIOS_VENTANA_MINUTOS", VENTANA_MINUTOS_DEFECTO);
}

/**
 * Base del `enlace` del informe «Aviso de la app» (§2.3): `NEXT_PUBLIC_APP_URL` y, si falta,
 * `NEXT_PUBLIC_SITE_URL`, sin barra final. `null` si no hay ninguna: la ejecucion sale `error`
 * nombrando `enlace` (R32), visible en el historial, en vez de mandar un enlace roto.
 */
export function baseUrlEnlace(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
  if (raw === "") return null;
  return raw.replace(/\/+$/, "");
}

/** Segundos de vida del enlace firmado de descarga del PDF (R43). */
export const TTL_FIRMA_PDF_SEGUNDOS = 300;

/** Tope de destinatarios resueltos por envio (R16). */
export const MAX_DESTINATARIOS = 50;

/** Ventana anti doble clic de «Probar ahora» (R41). */
export const VENTANA_PRUEBA_MS = 30_000;

/** Reintentos de una entrega con fallo transitorio (R36). */
export const MAX_INTENTOS_REINTENTO = 5;

/** Ejecuciones con PDF caducado que purga cada corrida del mantenimiento (§5.3). */
export const LOTE_PURGA = 500;
