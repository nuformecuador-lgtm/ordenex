/**
 * ⭑ FICHA 436 (design §4.3) — configuración del asistente.
 *
 * Clon estructural de `lib/config/geocode.ts`: ausente o `""` -> `null`/default, y esta función
 * NUNCA LANZA. Es deliberado: la ruta del asistente cuelga del layout del portal, y una excepción
 * al CARGAR la configuración convertiría «falta una variable» en «la pantalla no se pinta».
 * La ausencia de credencial la decide quien llama (R20), no este archivo.
 */

/** Lee un entero POSITIVO de `process.env`; ausente/vacío/inválido -> `fallback`. */
function leerEnteroPositivo(nombre: string, fallback: number): number {
  const crudo = process.env[nombre];
  if (crudo === undefined || crudo === "") return fallback;
  const valor = Number.parseInt(crudo, 10);
  return Number.isFinite(valor) && valor > 0 ? valor : fallback;
}

/**
 * El modelo. **Sonnet 5** (D7), sin pensamiento extendido.
 *
 * Va como constante exportada y no sólo como default dentro del objeto porque el test de la
 * petición lo afirma contra ESTE nombre: si alguien cambia de modelo, cambia aquí y el test
 * que mide la petición sigue siendo cierto sin tocarlo.
 */
export const ASISTENTE_MODELO_DEFAULT = "claude-sonnet-5";

/**
 * ⭑ EL TOPE: **30 consultas por persona y día** (Q2, decidido el 2026-09-17).
 *
 * Sale del propio cálculo de coste del diseño, que se hizo sobre «diez veces al día cada uno»:
 * el triple es un tope, no un freno. Configurable por entorno para poder subirlo sin desplegar.
 */
export const ASISTENTE_MAX_CONSULTAS_DIA_DEFAULT = 30;

export interface AsistenteConfig {
  /** La credencial del proveedor. `null` si no está configurada: NO se lanza aquí (R20). */
  ANTHROPIC_API_KEY: string | null;
  /** El modelo al que se pregunta (D7). */
  ASISTENTE_MODELO: string;
  /** Consultas por persona y día calendario de Costa Rica (R14-R16). */
  ASISTENTE_MAX_CONSULTAS_DIA: number;
  /**
   * Timeout de la llamada HTTP en ms. Más alto que el de geocode (10 s) a propósito: una
   * respuesta larga llega POR TROZOS y el reloj corre mientras el modelo escribe.
   */
  ASISTENTE_TIMEOUT_MS: number;
}

export function loadAsistenteConfig(): AsistenteConfig {
  const clave = process.env.ANTHROPIC_API_KEY;
  const modelo = process.env.ASISTENTE_MODELO;
  return {
    ANTHROPIC_API_KEY: clave !== undefined && clave !== "" ? clave : null,
    ASISTENTE_MODELO: modelo !== undefined && modelo !== "" ? modelo : ASISTENTE_MODELO_DEFAULT,
    ASISTENTE_MAX_CONSULTAS_DIA: leerEnteroPositivo(
      "ASISTENTE_MAX_CONSULTAS_DIA",
      ASISTENTE_MAX_CONSULTAS_DIA_DEFAULT,
    ),
    ASISTENTE_TIMEOUT_MS: leerEnteroPositivo("ASISTENTE_TIMEOUT_MS", 60_000),
  };
}

/**
 * Tope de tamaño de UNA imagen adjunta: **5 MB** (Q6).
 *
 * No es un número nuevo: es el mismo que ya rige para la evidencia de gestión
 * (`GESTION_MAX_FILE_BYTES`, `lib/config/gestion.ts`). Inventar un segundo tope para lo mismo
 * es cómo se acaba con dos límites que nadie sabe cuál manda.
 */
export const ASISTENTE_IMAGEN_MAX_BYTES = 5 * 1024 * 1024;

/**
 * El mismo tope, contado en caracteres de base64, que es la forma en la que la imagen viaja.
 *
 * base64 infla 4 caracteres por cada 3 bytes; el `+ 4` cubre el relleno `=`. Se valida sobre la
 * CADENA porque es lo que el servidor recibe: medir bytes exigiría decodificar primero, es decir,
 * aceptar antes de comprobar.
 */
export const ASISTENTE_IMAGEN_MAX_BASE64 = Math.ceil(ASISTENTE_IMAGEN_MAX_BYTES / 3) * 4 + 4;

/**
 * **Una imagen por mensaje** (Q6). Quien manda tres capturas de la misma pantalla no está dando
 * más contexto: está gastando tres veces el mismo cupo.
 */
export const ASISTENTE_IMAGENES_MAX_POR_MENSAJE = 1;

/**
 * ⭑ **CUATRO IMÁGENES POR PETICIÓN**, contando el hilo entero (revisión de la ficha, `m3`).
 *
 * ⚠️ POR QUÉ NO BASTABA «una por mensaje». La conversación vive en el cliente (D10) y **viaja
 * entera en cada pregunta**, imágenes incluidas: con 40 turnos admitidos, una imagen por mensaje
 * son hasta 40 imágenes en UNA petición, y van en `messages`, fuera del prefijo cacheado, o sea
 * que se pagan enteras cada vez. El tope diario cuenta preguntas; sin esto, **el coste de UNA
 * pregunta no lo acotaba nada nuestro**: lo acotaba el límite de cuerpo de Vercel, que es
 * plataforma y no código —y en local ni existe—.
 *
 * ⚠️ POR QUÉ CUATRO, y no un número redondo mayor. El panel comprime a 3 MB antes de enviar
 * (`AsistentePanel.tsx`) y el cuerpo de un Route Handler en Vercel es ~4,5 MB: por encima de dos o
 * tres capturas grandes la plataforma ya corta. Cuatro deja sitio de sobra para la conversación
 * real —una duda de pantalla con sus capturas— y pone un techo de código donde sólo había uno de
 * infraestructura. Quien necesite más, empieza una conversación nueva, y el rechazo se lo dice.
 */
export const ASISTENTE_IMAGENES_MAX_POR_PETICION = 4;

/** Lo que ve quien manda más imágenes de las que caben. Dice el número y qué hacer, no «error». */
export function mensajeDemasiadasImagenes(max: number): string {
  return `Son demasiadas imágenes para una sola consulta (caben ${max}, contando las de toda la conversación). Empezá una conversación nueva y mandá sólo la captura que importa.`;
}

/** Los formatos admitidos. LISTA BLANCA, nunca un comodín: y el audio no está ni puede estar (D12). */
export const ASISTENTE_IMAGEN_MEDIOS = ["image/png", "image/jpeg", "image/webp"] as const;

/** Tope de turnos de la conversación que se aceptan en una petición. */
export const ASISTENTE_MENSAJES_MAX = 40;

/** Tope de caracteres de un turno. Una pregunta de ayuda no es un tratado. */
export const ASISTENTE_TEXTO_MAX = 4000;

/**
 * Lo que ve quien agota el tope (R15, Q2). Dice EL NÚMERO y CUÁNDO VUELVE, y no dice «error»:
 * un tope que se explica no es un fallo; uno que no se explica se lee como que la aplicación
 * está rota.
 */
export function mensajeTopeAlcanzado(tope: number): string {
  return `Llegaste a las ${tope} preguntas de hoy. Mañana volvés a tener.`;
}
