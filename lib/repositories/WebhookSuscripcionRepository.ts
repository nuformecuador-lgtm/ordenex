import type { PrismaClient } from "@prisma/client";
import type {
  IWebhookSuscripcionRepository,
  WebhookSuscripcionActiva,
  WebhookSuscripcionUpsertData,
  WebhookSuscripcionVista,
} from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";

// Feature 99 (design §5) — repositorio de suscripciones de webhook (patron
// `ApiKeyRepository`, `Pick<PrismaClient>`). Solo queries: sin logica de negocio.

type WebhookSuscripcionPrismaClient = Pick<PrismaClient, "webhookSuscripcion" | "usuario">;

/** [D3] rol de la cuenta dedicada de API key; se resuelve por lookup, nunca por id. */
const ROL_API_KEY = "apiKey";

export class WebhookSuscripcionRepository implements IWebhookSuscripcionRepository {
  constructor(private readonly prisma: WebhookSuscripcionPrismaClient) {}

  /** R6: upsert por `ownerUsuarioId`. Un re-registro actualiza url/secret y REACTIVA. */
  async upsertByOwner(data: WebhookSuscripcionUpsertData): Promise<void> {
    await this.prisma.webhookSuscripcion.upsert({
      where: { ownerUsuarioId: data.ownerUsuarioId },
      create: {
        ownerUsuarioId: data.ownerUsuarioId,
        url: data.url,
        secret: data.secret, // ciphertext (design §1.3)
        activa: true,
      },
      update: {
        url: data.url,
        secret: data.secret,
        activa: true, // re-registrar reactiva una suscripcion dada de baja
      },
    });
  }

  /**
   * R33 (gate P4): actualiza SOLO la url del owner y REACTIVA, conservando el secreto.
   * `updateMany` no lanza si no hay fila (no-op). No toca `secret`: editar no rota.
   */
  async actualizarUrlByOwner(ownerUsuarioId: string, url: string): Promise<void> {
    await this.prisma.webhookSuscripcion.updateMany({
      where: { ownerUsuarioId },
      data: { url, activa: true },
    });
  }

  /**
   * R34 (gate P4): actualiza SOLO el ciphertext del secreto del owner (rotación),
   * conservando url/activa. `updateMany` no lanza si no hay fila (no-op).
   */
  async actualizarSecretoByOwner(ownerUsuarioId: string, secret: string): Promise<void> {
    await this.prisma.webhookSuscripcion.updateMany({
      where: { ownerUsuarioId },
      data: { secret },
    });
  }

  /** R10/R17/R21/R24: suscripcion ACTIVA con el ciphertext del secreto. `null` si inactiva. */
  async findActivaByOwner(ownerUsuarioId: string): Promise<WebhookSuscripcionActiva | null> {
    const row = await this.prisma.webhookSuscripcion.findUnique({
      where: { ownerUsuarioId },
      select: { url: true, secret: true, activa: true },
    });
    if (!row || !row.activa) return null;
    return { url: row.url, secret: row.secret };
  }

  /** R7: vista de consulta SIN secreto (`secret` no figura en el select ni en el DTO). */
  async findByOwner(ownerUsuarioId: string): Promise<WebhookSuscripcionVista | null> {
    const row = await this.prisma.webhookSuscripcion.findUnique({
      where: { ownerUsuarioId },
      select: { url: true, activa: true },
    });
    return row ? { url: row.url, activa: row.activa } : null;
  }

  /** R8: baja logica. `updateMany` no lanza si no existe fila (no-op). */
  async desactivarByOwner(ownerUsuarioId: string): Promise<void> {
    await this.prisma.webhookSuscripcion.updateMany({
      where: { ownerUsuarioId },
      data: { activa: false },
    });
  }

  /** D3: `true` si el owner es un usuario de rol `apiKey` (guard del controller). */
  async ownerEsApiKey(ownerUsuarioId: string): Promise<boolean> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: ownerUsuarioId },
      select: { rol: { select: { value: true } } },
    });
    return row?.rol.value === ROL_API_KEY;
  }
}
