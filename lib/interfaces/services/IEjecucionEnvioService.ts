import type { WhatsappEjecucionEstado, WhatsappEntregaEstado } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ProbarEnvioResultado } from "@/lib/types/envios-whatsapp";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

// Ficha 474 (design §4.3/§4.4, T7.2) — el MOTOR que ejecuta un envio.

/** Lo que devuelve una ejecucion (lo usa «Probar ahora» para responder en la misma llamada). */
export interface ResultadoEjecucion {
  estado: WhatsappEjecucionEstado;
  motivo: string | null;
  entregas: { usuarioId: string | null; estado: WhatsappEntregaEstado; motivo: string | null }[];
}

/** El unico destinatario de una prueba: quien pulsa (R39). */
export interface DestinatarioPrueba {
  usuarioId: string;
  nombre: string;
  telefono: string;
}

export interface IEjecucionEnvioService {
  /**
   * Ejecuta una ejecucion YA CREADA (programada, por evento o de prueba). Idempotente: un estado
   * terminal no hace nada; un reintento reutiliza el contenido fijado (R35) y no reenvia una
   * entrega ya reclamada (R37). Lanza solo ante fallos que la cola debe reintentar (red de Meta al
   * subir el PDF, credencial ausente: queda en `last_error`).
   */
  ejecutar(ejecucionId: string, opts?: { destinatarioPrueba?: DestinatarioPrueba }): Promise<ResultadoEjecucion>;
  /** R36: reintenta UNA entrega con fallo transitorio. Lanza para el backoff de la cola. */
  reintentar(entregaId: string, job: Pick<JobDTO, "intentos" | "maxIntentos">): Promise<void>;
  /** R39-R41/R52: «Probar ahora», solo hacia quien pulsa, en la misma respuesta. */
  probar(
    envioId: string,
    actor: Actor,
  ): Promise<ProbarEnvioResultado | { status: "forbidden" } | { status: "not_found" }>;
}
