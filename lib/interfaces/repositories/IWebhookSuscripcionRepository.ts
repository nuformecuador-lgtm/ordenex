// Feature 99 (design §5) — contrato del repositorio de suscripciones de webhook. Solo
// queries Prisma (docs/architecture.md §Repository): sin logica de negocio (la validacion de
// URL, la generacion/cifrado del secreto y la autorizacion viven en `WebhookSuscripcionService`).

/** Datos del upsert por owner (R6). `secret` es el CIPHERTEXT (design §1.3), nunca en claro. */
export interface WebhookSuscripcionUpsertData {
  ownerUsuarioId: string;
  url: string;
  secret: string;
}

/** Suscripcion ACTIVA para la ENTREGA (uso server-side). Incluye el ciphertext a descifrar. */
export interface WebhookSuscripcionActiva {
  url: string;
  /** CIPHERTEXT del secreto de firma; el handler lo descifra en memoria para firmar (R32). */
  secret: string;
}

/** Vista de CONSULTA para display (R7): NUNCA incluye el secreto (ni cifrado). */
export interface WebhookSuscripcionVista {
  url: string;
  activa: boolean;
  /**
   * FICHA 403 (R18) — si AHORA MISMO sus reintentos estan espaciados por fallos sostenidos.
   *
   * DERIVADO, no una columna: lo calcula `estaPausada()` en el momento de la consulta, con la
   * misma funcion y la misma config que usa el drenador para decidir el espaciado, de modo que
   * "lo que hace la cola" y "lo que ve el dueño" no puedan divergir. Al evaluarse al consultar,
   * tampoco queda congelado: si pasa el tiempo sin que nadie mire, el proximo vistazo ya lo dice.
   *
   * ⚠️ ES INDEPENDIENTE DE `activa`. Una suscripcion pausada sigue ACTIVA, sigue recibiendo jobs y
   * se recupera sola al primer 2xx (R5). Pausada ≠ dada de baja.
   */
  pausada: boolean;
  /**
   * FICHA 403 (R18) — ISO-8601 del instante desde el que no hay ninguna entrega aceptada (o del
   * alta/ultima edicion de la URL si nunca la hubo).
   *
   * Se tipa `| null` aunque en la practica NUNCA lo sea: que la columna tenga default y sea NOT
   * NULL es un detalle de implementacion del modelo de datos, y las capas de arriba no lo
   * necesitan saber para pintar el aviso.
   */
  sinExitoDesde: string | null;
}

/**
 * FICHA 403 (design §2.2) — el estado del circuito DESPUES de contabilizar un fallo. Es lo minimo
 * que el service necesita para evaluar `estaPausada()`; ni la URL ni el secreto viajan aqui (R13).
 */
export interface WebhookSuscripcionEstadoCircuito {
  fallosConsecutivos: number;
  sinExitoDesde: Date;
}

export interface IWebhookSuscripcionRepository {
  /**
   * R6: crea o actualiza la suscripcion del owner (upsert por `owner_usuario_id`). Reactiva.
   *
   * FICHA 403 (R7): ademas REINICIA el circuito (contador a 0, ancla a `ahora`) en CADA llamada,
   * no solo cuando el destino estaba roto — es la palanca manual de "reintentar ya", y reiniciar
   * un contador que ya estaba en cero es un no-op inofensivo.
   */
  upsertByOwner(data: WebhookSuscripcionUpsertData): Promise<void>;
  /**
   * R33 (gate P4): actualiza SOLO la URL de una suscripción existente (y la reactiva),
   * CONSERVANDO el secreto. No-op si el owner no tiene fila. Editar la URL no rota el secreto.
   *
   * FICHA 403 (R7/R19): REINICIA tambien el circuito, de modo que guardar la URL desde la pantalla
   * ya existente saca de la pausa de inmediato, sin esperar a que llegue sola una entrega buena y
   * sin ningun boton nuevo.
   */
  actualizarUrlByOwner(ownerUsuarioId: string, url: string): Promise<void>;
  /**
   * R34 (gate P4): actualiza SOLO el ciphertext del secreto de una suscripción existente
   * (rotación), CONSERVANDO url/activa. No-op si el owner no tiene fila.
   */
  actualizarSecretoByOwner(ownerUsuarioId: string, secret: string): Promise<void>;
  /**
   * R10/R17/R21/R24: suscripcion ACTIVA del owner, con el ciphertext del secreto para
   * firmar. `null` si no existe o esta inactiva. Uso server-side (entrega), no display.
   */
  findActivaByOwner(ownerUsuarioId: string): Promise<WebhookSuscripcionActiva | null>;
  /** R7: vista de consulta SIN secreto (para la pantalla F100 / obtener). `null` si no hay. */
  findByOwner(ownerUsuarioId: string): Promise<WebhookSuscripcionVista | null>;
  /** R8: da de baja (activa=false) la suscripcion del owner. No-op si no existe. */
  desactivarByOwner(ownerUsuarioId: string): Promise<void>;
  /**
   * FICHA 403 (R2) — una entrega ACEPTADA (2xx): reinicia el contador de fallos a cero y mueve el
   * ancla de la racha a `ahora`. Con eso la suscripcion SALE DE LA PAUSA de inmediato y sin
   * ninguna intervencion manual, porque `estaPausada()` se evalua sobre estos dos datos.
   *
   * NO toca `activa` (R5). No-op si el owner no tiene fila.
   */
  registrarEntregaOk(ownerUsuarioId: string, ahora: Date): Promise<void>;
  /**
   * FICHA 403 (R3) — un fallo de ENTREGA (no-2xx, timeout o red): incrementa en uno el contador y
   * devuelve el estado del circuito YA INCREMENTADO, para que el service decida el espaciado sin
   * una segunda consulta ni aritmetica de "el conteo menos uno".
   *
   * `null` si el owner no tiene fila (nada que contar).
   *
   * ⚠️ QUIEN LO LLAMA DECIDE QUE CUENTA: un `WebhookSecretKeyError` (clave de cifrado ausente) o un
   * payload invalido NUNCA llegan a intentar la peticion HTTP, asi que NO pasan por aqui (R3,
   * ultima frase). Penalizarian con reintentos espaciados a un destino sano por un problema
   * nuestro. NO toca `activa` (R5).
   */
  incrementarFalloYLeer(
    ownerUsuarioId: string,
    ahora: Date,
  ): Promise<WebhookSuscripcionEstadoCircuito | null>;
  /**
   * D3 (guard del controller) + feature 302: el owner EFECTIVO al que debe colgarse la
   * suscripcion, o `null` si la cuenta no participa del canal integrador (-> `owner_invalido`).
   *
   * Devuelve un id y no un booleano porque desde la 302 el owner de las ordenes de una key puede
   * ser OTRA cuenta (`api_key.tienda_destino_id`), y el despachador busca la suscripcion por
   * `orden.tienda_id`: colgarla del id equivocado no da error, solo deja de entregar eventos.
   */
  resolverOwnerWebhook(ownerUsuarioId: string): Promise<string | null>;
}
