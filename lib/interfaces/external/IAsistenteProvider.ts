/**
 * ⭑ FICHA 436 — EL PUERTO DEL PROVEEDOR DEL ASISTENTE.
 *
 * Contrato NEUTRAL: sin `next/*`, sin Prisma, sin `process.env`, sin `fs`. Esa neutralidad no
 * es higiene: es lo que hace posible construir y verificar la pieza entera —acotamiento por
 * rol, citas, tope, streaming— SIN RED Y SIN GASTAR UN CÉNTIMO (D13). El doble de los tests
 * implementa esto en doce líneas; el adaptador de producción (`lib/clients/anthropic-asistente.ts`)
 * es el único archivo del árbol que sabe que detrás hay HTTP.
 *
 * Molde: `IRoutesClient` (feature 92). Mismo vocabulario de desenlace-unión: NADA LANZA salvo lo
 * que el llamador tiene que distinguir, y cada desenlace dice quién lo produce y quién lo decide.
 */

/**
 * Un documento de `docs/ayuda/**` tal y como viaja al proveedor. Es una vista EMPOBRECIDA de
 * `DocumentoAyuda` a propósito: el puerto no conoce `roles` ni `rutas` porque el acotamiento
 * YA OCURRIÓ antes de llegar aquí (R9). Si este tipo llevara `roles`, alguien podría acabar
 * decidiendo el acceso en el adaptador, que es el sitio donde nadie lo mira.
 */
export interface DocumentoContexto {
  /** `oficina/wallet-caja` — es la identidad del documento Y su URL (`/ayuda/<slug>`). */
  slug: string;
  titulo: string;
  /** Markdown SIN frontmatter (R2: el catálogo ya lo quitó al leer el archivo). */
  cuerpo: string;
}

/** Una imagen adjunta por el usuario. Sólo en mensajes del usuario (D12). */
export interface ImagenAdjunta {
  /** Tipo de medio de la lista blanca: `image/png`, `image/jpeg`, `image/webp`. */
  medio: string;
  /** El contenido en base64, SIN el prefijo `data:`. */
  datosBase64: string;
}

/** Un turno de la conversación. La conversación vive en el cliente (D10) y viaja entera. */
export interface MensajeAsistente {
  autor: "usuario" | "asistente";
  texto: string;
  imagenes?: readonly ImagenAdjunta[];
}

/** Lo que el servicio le entrega al proveedor. Todo lo de aquí ya está decidido y acotado. */
export interface ConsultaAsistente {
  /** El texto de sistema: los cuatro límites y el formato de cita (R5). */
  instrucciones: string;
  /**
   * Los documentos del contexto, YA ACOTADOS POR ROL (R9) y en ORDEN ESTABLE por slug.
   *
   * El orden no es estético: el prefijo de documentación es lo que se cachea (R6/D9), y un
   * orden inestable produce un prefijo distinto en cada consulta — la caché dejaría de acertar
   * y se pagaría el corpus entero cada vez, sin que nada se pusiera rojo.
   */
  documentos: readonly DocumentoContexto[];
  /** La conversación, del más viejo al más nuevo. El último es la pregunta de ahora. */
  mensajes: readonly MensajeAsistente[];
}

/** Un trozo de respuesta, a medida que llega (R19). */
export type TrozoProveedor =
  | { tipo: "texto"; texto: string }
  | {
      tipo: "fin";
      tokensEntrada: number;
      tokensSalida: number;
      /** Tokens leídos de la caché del prefijo. Es la medida de si D9 está sirviendo de algo. */
      tokensCacheLectura: number;
    };

/**
 * El desenlace de una consulta.
 *
 * ⚠️ `sin_credencial` ES UN DESENLACE, NO UNA EXCEPCIÓN (R20). Mismo criterio que
 * `lib/config/geocode.ts`: la ausencia de credencial no tumba nada y no es un 500 mudo — la
 * decide quien llama, que es el único que sabe qué contarle al usuario.
 *
 * Quién produce cada uno:
 *  - `ok`            — el adaptador, cuando el proveedor abrió el stream.
 *  - `sin_credencial`— el adaptador, ANTES de tocar la red (`fetchImpl` no se llama).
 *  - `transitorio`   — red, timeout, 429 o 5xx: reintentable.
 *  - `config_invalida`— 401/403/400: credencial, modelo o petición mal formada.
 *
 * `detalle` es SIEMPRE una cadena propia («asistente: HTTP 429»): jamás la credencial, jamás
 * la URL del proveedor, jamás el cuerpo crudo de su error (R21).
 */
export type RespuestaAsistente =
  | { status: "ok"; trozos: AsyncIterable<TrozoProveedor> }
  | { status: "sin_credencial" }
  | { status: "transitorio"; detalle: string }
  | { status: "config_invalida"; detalle: string };

/**
 * ⚠️ UN SOLO MÉTODO, Y NINGUNO QUE EJECUTE NADA (D3). No hay `herramientas()`, no hay
 * `ejecutar()`, no hay forma de que este contrato haga algo en la aplicación. El asistente
 * responde preguntas sobre cómo se usa Ordenex; no asigna, no gestiona, no cierra.
 */
export interface IAsistenteProvider {
  responder(consulta: ConsultaAsistente): Promise<RespuestaAsistente>;
}
