import type { PrismaClient } from "@prisma/client";
import type {
  DatosEntregaOrden,
  IWebhookOrdenReader,
} from "@/lib/interfaces/repositories/IWebhookOrdenReader";

// Feature 99 (design §7) — lectura minima de la orden + catalogo de estado para la entrega.
// Solo queries. Separado de `OrdenRepository` para no arrastrar su superficie al handler.

type WebhookOrdenReaderPrismaClient = Pick<PrismaClient, "orden" | "orderStatus">;

export class WebhookOrdenReader implements IWebhookOrdenReader {
  constructor(private readonly prisma: WebhookOrdenReaderPrismaClient) {}

  async findDatosEntrega(
    ordenId: string,
    estatusDestinoId: string,
  ): Promise<DatosEntregaOrden | null> {
    const orden = await this.prisma.orden.findUnique({
      where: { id: ordenId },
      select: { tiendaId: true, numGuia: true, numRemision: true, deletedAt: true },
    });
    // R22: orden inexistente -> `null` -> el handler completa sin entregar.
    if (!orden) return null;

    // El `value` del estatus DESTINO del evento (el que viaja en el payload), no el estatus
    // actual de la orden: el cuerpo describe la transicion que disparo el webhook.
    const estatus = await this.prisma.orderStatus.findUnique({
      where: { id: estatusDestinoId },
      select: { value: true },
    });

    return {
      tiendaId: orden.tiendaId,
      numGuia: orden.numGuia,
      numRemision: orden.numRemision,
      deletedAt: orden.deletedAt,
      estado: estatus?.value ?? null,
    };
  }
}
