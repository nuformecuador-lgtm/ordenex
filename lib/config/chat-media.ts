// Feature 311 (design §5.4) — configuracion del proxy de media del chat. Va aparte de
// `lib/config/whatsapp.ts` porque no son credenciales: son POLITICAS de servido (que se puede
// incrustar, cuanto se espera, como se cachea) y `docs/architecture.md` prohibe hardcodearlas en
// el route handler.

/**
 * Lista BLANCA de MIME que se pueden servir `inline` desde nuestro origen (R25).
 *
 * `image/svg+xml` NO esta, y su ausencia es la decision, no un olvido: un SVG es scriptable, y
 * servirlo inline desde nuestro dominio seria XSS almacenado con el remitente de WhatsApp como
 * atacante y el mensajero autenticado como victima. `application/pdf` tampoco: abre un visor con
 * su propia superficie de ataque. Las familias `audio/*` y `video/*` completas las resuelve
 * `esMimeIncrustable`, porque Meta usa muchos contenedores (`audio/ogg`, `video/mp4`, ...).
 */
export const MIMES_INCRUSTABLES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Tipo con el que se sirve todo lo que NO es incrustable. Junto con `nosniff`, fuerza descarga. */
export const MIME_GENERICO = "application/octet-stream";

/** Nombre de archivo cuando Meta no mando `filename` o el saneado lo dejo vacio. */
export const NOMBRE_ADJUNTO_POR_DEFECTO = "adjunto";

/** Tope del `filename` en la cabecera. Un nombre kilometrico no aporta y complica el parseo. */
export const MAX_LARGO_FILENAME = 100;

/**
 * Timeout de cada salto contra la Graph API (metadatos y binario). Mas generoso que el del envio
 * (10 s) porque aqui viaja un binario que puede llegar a decenas de MB por la red del repartidor.
 */
export const TIMEOUT_MEDIA_MS = 30_000;

/**
 * `Cache-Control` de la respuesta del proxy. SIEMPRE `private`: el binario es PII del cliente y
 * no puede quedarse en una CDN compartida. `no-store` porque el enlace caduca a los 30 dias en
 * Meta y una copia en disco del navegador sobreviviria a la orden.
 */
export const CACHE_CONTROL_MEDIA = "private, no-store";
