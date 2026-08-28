// Feature 299 (design §5.4, R25) — decisiones de CABECERA del proxy de media, como helpers
// PUROS. Viven fuera del route handler para poder probarlas sin sesion, sin Prisma y sin red:
// son reglas de seguridad, y una regla de seguridad que solo se puede probar levantando media
// aplicacion acaba sin probarse.
import { MIMES_INCRUSTABLES, MIME_GENERICO, NOMBRE_ADJUNTO_POR_DEFECTO, MAX_LARGO_FILENAME } from "@/lib/config/chat-media";

/**
 * ¿Es seguro servir este contenido INLINE desde nuestro origen?
 *
 * La lista es BLANCA y corta a proposito. `image/svg+xml` queda FUERA aunque sea una imagen: un
 * SVG es scriptable, y servirlo `inline` desde nuestro dominio convierte a cualquier cliente de
 * WhatsApp en un atacante de XSS almacenado con el mensajero autenticado como victima. Un PDF
 * tampoco: lo abre un visor con su propia superficie. Todo lo que no este aqui se DESCARGA.
 */
export function esMimeIncrustable(mime: string | null): boolean {
  const base = mimeBase(mime);
  if (base === null) return false;
  if (MIMES_INCRUSTABLES.has(base)) return true;
  // Familias completas: cualquier audio o video es un contenedor de medios, no un documento.
  return base.startsWith("audio/") || base.startsWith("video/");
}

/**
 * El tipo/subtipo sin parametros y en minusculas. El MIME de Meta puede venir con parametros
 * (`audio/ogg; codecs=opus`) y compararlo entero contra la lista blanca la dejaria inservible.
 */
function mimeBase(mime: string | null): string | null {
  if (mime === null) return null;
  const base = mime.split(";")[0].trim().toLowerCase();
  return base === "" ? null : base;
}

/**
 * `Content-Type` que se emite. Si el MIME no es incrustable —o Meta no mando ninguno— se fuerza
 * `application/octet-stream`: junto con `nosniff` es lo que impide que el navegador ADIVINE el
 * tipo y acabe ejecutando algo que llego por WhatsApp (R25).
 */
export function contentTypeSeguro(mime: string | null): string {
  const base = mimeBase(mime);
  return base !== null && esMimeIncrustable(base) ? base : MIME_GENERICO;
}

/**
 * Sanea el `filename` que viene de Meta antes de meterlo en `Content-Disposition`.
 *
 * Quita comillas, barras invertidas, CR/LF y separadores de ruta: un `\r\n` dentro del nombre es
 * INYECCION DE CABECERA (parte la respuesta en dos), y un `../` convierte el nombre en una ruta.
 * Recorta a un largo razonable y cae a un nombre generico si no queda nada.
 */
export function sanearNombreArchivo(nombre: string | null): string {
  if (nombre === null) return NOMBRE_ADJUNTO_POR_DEFECTO;
  const limpio = nombre
    .replace(/[\r\n"\\/]/g, "") // CR/LF, comillas, barras: inyeccion de cabecera y rutas
    .replace(/[\u0000-\u001f\u007f]/g, "") // controles no imprimibles
    .replace(/\.{2,}/g, ".") // `..` deja de ser un salto de directorio
    .trim()
    .slice(0, MAX_LARGO_FILENAME)
    .trim();
  return limpio === "" || limpio === "." ? NOMBRE_ADJUNTO_POR_DEFECTO : limpio;
}

/**
 * `Content-Disposition` completo. `inline` SOLO cuando el tipo es incrustable y el cliente no
 * pidio descarga; en cualquier otro caso `attachment` con el nombre ya saneado (R25).
 */
export function contentDisposition(
  mime: string | null,
  nombre: string | null,
  descargaForzada: boolean,
): string {
  if (!descargaForzada && esMimeIncrustable(mime)) return "inline";
  return `attachment; filename="${sanearNombreArchivo(nombre)}"`;
}
