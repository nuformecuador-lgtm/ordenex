import type { PrismaClient } from "@prisma/client";
import type {
  IWebhookSuscripcionRepository,
  WebhookSuscripcionActiva,
  WebhookSuscripcionUpsertData,
  WebhookSuscripcionVista,
} from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import { resolverOwnerApiKey } from "@/lib/utils/api-key-owner";

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

  /**
   * D3 + feature 302: resuelve el owner EFECTIVO de la suscripcion de webhook a partir de la
   * cuenta que la pantalla senala, o `null` si esa cuenta no participa del canal integrador.
   *
   * POR QUE ESTO DEJO DE SER UN BOOLEANO (`ownerEsApiKey`). El despachador busca la suscripcion
   * por `orden.tienda_id` (`WebhookEstadoService`), y desde la 302 una key puede crear ordenes a
   * nombre de OTRA cuenta. Colgar la suscripcion del `usuario_id` de la key —que es lo que la
   * pantalla tiene en la mano— daria de alta una fila que no recibiria jamas un evento: no
   * fallaria nada, simplemente no llegarian los webhooks. Fallo mudo. Por eso el guard, ademas de
   * autorizar, DEVUELVE a nombre de quien hay que colgarla.
   *
   * Tres desenlaces:
   *   - cuenta de rol `apiKey`  -> su tienda destino si la tiene, y si no ella misma (identico al
   *     comportamiento anterior: sin tienda destino, el owner es la propia cuenta dedicada);
   *   - cuenta que ES la tienda destino de alguna key -> ella misma (por eso existe el indice
   *     `api_key_tienda_destino_id_idx`);
   *   - cualquier otra cuenta -> `null`, y el controller responde `owner_invalido` como antes.
   */
  async resolverOwnerWebhook(ownerUsuarioId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: ownerUsuarioId },
      select: {
        rol: { select: { value: true } },
        apiKey: { select: { tiendaDestinoId: true } },
        // `take: 1`: solo interesa SI existe alguna, no cuantas ni cuales.
        apiKeysComoTiendaDestino: { select: { id: true }, take: 1 },
      },
    });
    if (!row) return null;
    if (row.rol.value === ROL_API_KEY) {
      return resolverOwnerApiKey(ownerUsuarioId, row.apiKey?.tiendaDestinoId ?? null);
    }
    return row.apiKeysComoTiendaDestino.length > 0 ? ownerUsuarioId : null;
  }
}
