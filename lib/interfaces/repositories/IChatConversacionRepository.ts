// Feature 109 (design §3, R13/R16/R25) — contrato del repositorio del HILO de chat. Solo
// queries Prisma (docs/architecture.md): sin logica de negocio (la ventana de 24 h, el
// dedupe y la resolucion D4 viven en `ChatWhatsappService`). La interfaz NO expone
// `PrismaClient`.

/** DTO plano de un hilo de chat (nunca la entidad Prisma cruda). */
export interface ChatConversacionDTO {
  id: string;
  telefonoE164: string;
  ordenId: string;
  mensajeroId: string;
  /** Marca del ultimo mensaje ENTRANTE; `null` = sin entrantes (fuera de ventana). */
  ultimoEntranteAt: Date | null;
}

/** Entrantes sin leer de UN hilo, keyeados por la orden (que es lo que la UI lista). */
export interface NoLeidosPorOrden {
  ordenId: string;
  /** Entrantes con `ocurrido_at` posterior a `mensajero_leido_at` (todos si es NULL). */
  noLeidos: number;
}

/** Resolucion de la orden destino de un entrante (D4/R25). */
export interface ResolucionOrdenEntrante {
  ordenId: string;
  mensajeroId: string;
  telefonoE164: string;
}

/** Datos para el upsert del hilo (get-or-create por orden+numero, R13). */
export interface UpsertHiloInput {
  ordenId: string;
  mensajeroId: string;
  telefonoE164: string;
}

export interface IChatConversacionRepository {
  /**
   * R25/D4: resuelve la orden activa asignada MAS RECIENTE (`asignado_at` desc) cuyo
   * `telefono_dest` coincide con el numero entrante. `null` si el numero no mapea a ninguna
   * orden viva y asignada (el service registra no-PII y sigue, sin romper el 200).
   */
  resolverOrdenActivaPorNumero(telefonoE164: string): Promise<ResolucionOrdenEntrante | null>;

  /**
   * R13: get-or-create del hilo por (orden, numero). Devuelve el hilo (nuevo o existente)
   * con su `ultimoEntranteAt` actual. Idempotente ante el unico (orden_id, telefono_e164).
   */
  upsertParaOrden(input: UpsertHiloInput): Promise<ChatConversacionDTO>;

  /** R13: sella `ultimo_entrante_at` al llegar un entrante (fuente de la ventana 24 h). */
  marcarUltimoEntrante(conversacionId: string, ocurridoAt: Date): Promise<void>;

  /**
   * R16: devuelve el hilo de `ordenId` SOLO si esa orden esta asignada a `mensajeroId`;
   * `null` en cualquier otro caso (orden de otro mensajero, inexistente o sin hilo).
   */
  findByOrdenParaMensajero(
    ordenId: string,
    mensajeroId: string,
  ): Promise<ChatConversacionDTO | null>;

  /** Busca un hilo por id (reconciliacion del job de reintento). */
  findById(id: string): Promise<ChatConversacionDTO | null>;

  /**
   * Entrantes SIN LEER de cada hilo del mensajero, agrupados por orden. Solo devuelve las
   * ordenes con al menos uno: las que no aparecen tienen cero (asi la respuesta no crece con
   * el historial del mensajero). Es la fuente del distintivo numerico del chat.
   */
  contarNoLeidosPorMensajero(mensajeroId: string): Promise<NoLeidosPorOrden[]>;

  /**
   * Sella el hilo de `ordenId` como leido hasta su ULTIMO entrante. Idempotente y sin
   * condicion de carrera: no escribe `now()` sino la marca del entrante mas reciente, asi que
   * un mensaje que entre entre la lectura y esta escritura sigue contando como no leido.
   *
   * El scope por `mensajeroId` va en el WHERE: nadie sella el hilo de otro. Si la orden no es
   * suya, o el hilo no existe, o no hay entrantes, no escribe nada.
   */
  marcarLeidoHastaUltimoEntrante(ordenId: string, mensajeroId: string): Promise<void>;

  /**
   * Feature 308 (design §3, R16/R18) — el cliente cambio de numero: reescribe `telefono_e164`
   * de los hilos que hoy tienen `anterior` para que los mensajes posteriores caigan en el MISMO
   * hilo. Devuelve cuantas filas migraron (0 es un desenlace VALIDO, no un error).
   *
   * TOLERANTE AL CONFLICTO: si ya existe un hilo de esa MISMA orden con el numero nuevo, el
   * unico `(orden_id, telefono_e164)` impide migrar esa fila. NO se fusionan hilos (P5) y NO se
   * lanza: la fila se deja como esta, el evento se registra igual como evidencia y la ingesta
   * del lote continua con su 200 (R18).
   *
   * NO toca el telefono de la orden ni el del cliente (R17): este repositorio solo escribe en
   * `chat_conversacion`.
   */
  migrarTelefono(anterior: string, nuevo: string): Promise<number>;
}
