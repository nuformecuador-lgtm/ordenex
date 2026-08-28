// Feature 316 (design §2) — politica de SUBIDA de adjuntos del chat: que puede ENVIAR el
// mensajero, con que tipo de mensaje viaja y hasta cuantos bytes.
//
// POR QUE ESTE ARCHIVO NO ES `lib/config/chat-media.ts` (y no se fusionan):
// aquel es politica de SERVIDO —"que puedo pintar `inline` desde mi origen sin XSS"— y su
// `MIMES_INCRUSTABLES` es deliberadamente MAS ESTRECHA que lo que se puede enviar: no incluye
// PDF, ni video, ni audio, A PROPOSITO. Mezclarlas invita a un error de un solo sentido pero
// fatal en cualquiera de las dos direcciones: usar `MIMES_INCRUSTABLES` como lista blanca de
// subida dejaria fuera todo lo que esta feature existe para enviar, y usar la lista blanca de
// subida como politica de servido volveria incrustables un PDF y los documentos de Office.
// Dos politicas distintas, dos archivos, y este comentario para que nadie las una "por
// deduplicar" (design §8, alternativa 3).
//
// Las funciones de este archivo son PURAS: las ejecuta el navegador antes de gastar la red del
// mensajero y otra vez el servidor como defensa (R11). Una sola definicion de la politica.

/** Tipo de mensaje que se deriva del MIME del adjunto (R8). */
export type TipoAdjuntoEnvio = "imagen" | "video" | "audio" | "documento";

/**
 * MIME aceptados por Meta para CADA tipo de mensaje saliente (R8).
 *
 * `image/webp` e `image/heic` NO estan aqui, y su ausencia es la decision, no un olvido: Meta no
 * acepta ninguno de los dos como imagen (webp solo vale para stickers). Una imagen fuera de esta
 * lista NO se rechaza por ello: se normaliza a JPEG en el NAVEGADOR antes de llegar a validarse
 * (R29-R32 / design §2.1). Anadirlos aqui haria que se subiera a Meta un formato que Meta
 * rechaza.
 */
export const MIMES_ENVIO: Readonly<Record<TipoAdjuntoEnvio, ReadonlySet<string>>> = {
  imagen: new Set(["image/jpeg", "image/png"]),
  video: new Set(["video/mp4", "video/3gp"]),
  audio: new Set(["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"]),
  documento: new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
};

/**
 * Tope PROPIO de los documentos (D6/P3), 25 MB: MAS restrictivo que los 100 MB que admite Meta,
 * porque quien sube es un repartidor por red movil y 100 MB tardan minutos y agotan el timeout
 * antes de llegar. UNA constante, para que subirlo o bajarlo sea una linea: `LIMITE_BYTES`
 * la REFERENCIA, no repite el numero.
 */
export const LIMITE_DOCUMENTO_BYTES = 25 * 1024 * 1024;

/** Limite por tipo, en bytes (R10). Imagen/video/audio son los de Meta; documento es propio. */
export const LIMITE_BYTES: Readonly<Record<TipoAdjuntoEnvio, number>> = {
  imagen: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  documento: LIMITE_DOCUMENTO_BYTES,
};

/**
 * Formatos de audio que Meta acepta, EN ORDEN DE PREFERENCIA para grabar (R14). El grabador
 * MIDE el dispositivo con `MediaRecorder.isTypeSupported` y usa el primero disponible; si no hay
 * ninguno, la nota de voz NO se ofrece (R15/D5).
 *
 * `audio/webm;codecs=opus` —lo que graba Chrome en Android por defecto— NO esta y no puede
 * estar: Meta lo rechaza como `type: audio`. El test de esta lista es la regresion que lo impide.
 * Los parametros (`;codecs=opus`) los tolera `clasificarAdjunto`, que compara por el MIME base.
 */
export const FORMATOS_NOTA_VOZ: readonly string[] = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
];

/** Lado largo y calidad de la normalizacion de imagen del navegador (R29/R30, design §2.1). */
export const MAX_LADO_LARGO_ENVIO = 1600;
export const CALIDAD_JPEG_ENVIO = 0.85;

/** Maximo de caracteres de un pie de adjunto, el que admite Meta (R12). */
export const MAX_CAPTION = 1024;

/**
 * Timeout de la SUBIDA del binario a la Graph API. Mucho mas generoso que el del envio de un
 * mensaje (10 s) por la misma razon que `TIMEOUT_MEDIA_MS` de la descarga: aqui viaja un binario
 * de hasta 25 MB por el enlace de SUBIDA de una red movil, que es el mas lento de los dos
 * sentidos. Dicho sin adornos: un documento pegado al limite puede agotarlo igualmente; ese caso
 * termina en `fallo_subida` con el adjunto todavia seleccionado para reintentar a mano (R19).
 */
export const TIMEOUT_SUBIDA_MS = 60_000;

/**
 * MIME base, sin parametros ni mayusculas: `audio/ogg;codecs=opus` -> `audio/ogg`.
 *
 * No es cosmetica: `MediaRecorder` entrega su `mimeType` CON el parametro de codec, y ese es el
 * `type` del `File` que se sube (design §6.2). Sin esta normalizacion una nota de voz en ogg
 * —formato que Meta SI acepta— se rechazaria por "tipo no permitido".
 */
function mimeBase(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

/**
 * MIME -> tipo de mensaje; `null` = no se puede enviar (R9). Funcion PURA.
 *
 * Es la UNICA fuente del tipo del mensaje: ni la UI ni la Server Action lo deducen de la
 * extension del archivo, porque la extension la controla quien nombra el archivo y el tipo
 * decide el endpoint de Meta y la columna `tipo` que se persiste.
 */
export function clasificarAdjunto(mime: string): TipoAdjuntoEnvio | null {
  const base = mimeBase(mime);
  for (const tipo of Object.keys(MIMES_ENVIO) as TipoAdjuntoEnvio[]) {
    if (MIMES_ENVIO[tipo].has(base)) return tipo;
  }
  return null;
}

/** Desenlace de la validacion de un adjunto. Tipado, no excepciones (design §2). */
export type ValidacionAdjunto =
  | { ok: true; tipo: TipoAdjuntoEnvio }
  | { ok: false; motivo: "tipo_no_permitido" }
  | { ok: false; motivo: "demasiado_grande"; limiteBytes: number };

/**
 * Valida tipo y tamano de un adjunto (R9/R10). Funcion PURA, compartida por navegador y servidor
 * (R11): la del navegador es cortesia de red, la del servidor es la defensa. El tamano que se le
 * pasa en el servidor sale del binario recibido (`File.size`), nunca de un campo declarado.
 */
export function validarAdjunto(mime: string, bytes: number): ValidacionAdjunto {
  const tipo = clasificarAdjunto(mime);
  if (tipo === null) return { ok: false, motivo: "tipo_no_permitido" };

  const limiteBytes = LIMITE_BYTES[tipo];
  if (bytes > limiteBytes) return { ok: false, motivo: "demasiado_grande", limiteBytes };

  return { ok: true, tipo };
}
