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
}
