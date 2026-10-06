// Ficha 474 (design §5.4, T7.4, R38) — aplica a las ENTREGAS de los envios automaticos los estados
// que Meta informa por el webhook (`sent`/`delivered`/`read`/`failed`).
//
// Corre DESPUES de la ingesta del chat en `app/api/webhooks/whatsapp/route.ts` y un fallo suyo NO
// cambia el 200 ni la ingesta: se registra (sin PII) y se sigue. El «no retroceder» lo garantiza el
// `UPDATE` condicional del repositorio, probado contra Postgres.
import type { WebhookStatus } from "@/lib/types/whatsapp-webhook";
import type {
  EstadoWebhookEntrega,
  IWhatsappEjecucionRepository,
} from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import { acotarMotivo, motivoMeta } from "@/lib/whatsapp-envios/motivo-meta";

const MAPA: Partial<Record<WebhookStatus["estado"], EstadoWebhookEntrega>> = {
  sent: "enviada",
  delivered: "recibida",
  read: "leida",
  failed: "fallida",
};

export interface IEntregaEstadoService {
  /** Devuelve cuantas entregas cambiaron. Nunca lanza. */
  aplicar(statuses: readonly WebhookStatus[]): Promise<number>;
}

export class EntregaEstadoService implements IEntregaEstadoService {
  constructor(
    private readonly repo: Pick<IWhatsappEjecucionRepository, "aplicarEstadoWebhook">,
    private readonly logger: { warn(m: string): void } = { warn: (m) => console.warn(m) },
  ) {}

  async aplicar(statuses: readonly WebhookStatus[]): Promise<number> {
    let cambiadas = 0;
    for (const s of statuses) {
      const estado = MAPA[s.estado];
      if (estado === undefined) continue;
      // R45: el motivo es el texto FIJO del codigo, nunca el detalle de Meta.
      const motivo = estado === "fallida" ? acotarMotivo(motivoMeta(s.error?.codigo ?? null)) : null;
      try {
        cambiadas += await this.repo.aplicarEstadoWebhook(s.waMessageId, estado, motivo);
      } catch (error) {
        this.logger.warn(
          `[envios-whatsapp] estado de entrega no aplicado (${estado}): ${error instanceof Error ? error.name : "error"}`,
        );
      }
    }
    return cambiadas;
  }
}
