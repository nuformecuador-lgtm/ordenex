// Feature 308 (design §5.4, R25) — decisiones de CABECERA del proxy de media, como helpers
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
 *
 * El resultado PUEDE llevar caracteres no ASCII (`informe-año.pdf`, `报告.pdf`, `foto 🎉.jpg`):
 * el nombre real es dato del cliente y aqui se conserva. Lo que NO se puede hacer es meterlo
 * crudo en la cabecera —una cabecera HTTP solo admite ByteString y eso da un 500—; de eso se
 * encarga `contentDisposition`, emitiendo la forma de RFC 5987/6266.
 */
export function sanearNombreArchivo(nombre: string | null): string {
  if (nombre === null) return NOMBRE_ADJUNTO_POR_DEFECTO;
  const limpio = nombre
    .replace(/[\r\n"\\/]/g, "") // CR/LF, comillas, barras: inyeccion de cabecera y rutas
    .replace(/[\u0000-\u001f\u007f]/g, "") // controles no imprimibles
    .replace(/\.{2,}/g, ".") // `..` deja de ser un salto de directorio
    .trim()
    .slice(0, MAX_LARGO_FILENAME)
    // El `slice` cuenta UNIDADES UTF-16, asi que puede PARTIR un emoji por la mitad y dejar un
    // surrogate suelto. No es cosmetico: `encodeURIComponent` LANZA `URIError` ante un surrogate
    // desemparejado, y eso serian 500 en el proxy por culpa de un nombre de archivo.
    .replace(SURROGATE_SUELTO, "")
    .trim();
  return limpio === "" || limpio === "." ? NOMBRE_ADJUNTO_POR_DEFECTO : limpio;
}

/** Mitad de un par surrogate sin su pareja (alta sin baja, o baja sin alta). */
const SURROGATE_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Todo lo que NO es ASCII imprimible, y por tanto no cabe en el `filename` clasico. */
const NO_ASCII_IMPRIMIBLE = /[^\x20-\x7e]+/g;

/**
 * Fallback ASCII del nombre, para el `filename=` clasico de `Content-Disposition`.
 *
 * POR QUE EXISTE: una cabecera HTTP es una ByteString. Interpolar `报告.pdf` o `foto 🎉.jpg` tal
 * cual revienta con «Cannot convert argument to a ByteString ...» y el proxy responde 500 en vez
 * de entregar el archivo. El nombre REAL no se pierde: viaja en `filename*` (RFC 5987), que lee
 * cualquier navegador actual; esto es solo la red de seguridad para un cliente antiguo.
 *
 * Se parte del nombre YA saneado, de modo que comillas, barras, CR/LF y `..` siguen fuera.
 */
export function nombreAsciiSeguro(nombre: string | null): string {
  const ascii = sanearNombreArchivo(nombre)
    .replace(NO_ASCII_IMPRIMIBLE, "_")
    .replace(/_{2,}/g, "_")
    .trim();
  // Un nombre integramente CJK degenera en `_` o `_.pdf`: eso no le dice nada a nadie, mejor el
  // generico. El nombre real sigue viajando en `filename*`.
  return ascii === "" || ascii === "." || ascii === "_" ? NOMBRE_ADJUNTO_POR_DEFECTO : ascii;
}

/**
 * Percent-encoding del nombre para `filename*=UTF-8''...` (`attr-char` de RFC 5987).
 *
 * `encodeURIComponent` deja pasar `*`, `'`, `(` y `)`, que NO son `attr-char`: se codifican a
 * mano. Todo lo que sale de aqui es ASCII sin espacios, comillas ni CR/LF, asi que este valor no
 * puede reintroducir un salto de cabecera pase lo que pase.
 */
function percentEncodeRfc5987(nombre: string): string {
  return encodeURIComponent(nombre).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `Content-Disposition` completo. `inline` SOLO cuando el tipo es incrustable y el cliente no
 * pidio descarga; en cualquier otro caso `attachment` con el nombre ya saneado (R25).
 *
 * FORMA DE LA CABECERA (RFC 6266 §4.1 sobre RFC 5987):
 *
 *   attachment; filename="<fallback ASCII>"; filename*=UTF-8''<nombre real percent-encoded>
 *
 * El `filename*` SOLO se añade cuando el nombre no es ASCII puro, para que el caso corriente
 * siga siendo la cabecera corta de siempre. Y se añade —en vez de reducir a ASCII a secas—
 * porque reducir le entrega `_.pdf` a quien mando un `informe.pdf` escrito en chino: el nombre
 * real es dato del cliente y con `filename*` lo conserva cualquier navegador actual (R25/R29).
 */
export function contentDisposition(
  mime: string | null,
  nombre: string | null,
  descargaForzada: boolean,
): string {
  if (!descargaForzada && esMimeIncrustable(mime)) return "inline";
  const real = sanearNombreArchivo(nombre);
  const ascii = nombreAsciiSeguro(nombre);
  const base = `attachment; filename="${ascii}"`;
  // ASCII puro: `filename*` seria una copia literal del anterior y solo alarga la cabecera.
  if (real === ascii) return base;
  return `${base}; filename*=UTF-8''${percentEncodeRfc5987(real)}`;
}
