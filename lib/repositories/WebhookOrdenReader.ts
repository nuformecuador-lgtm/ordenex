import type { GestionResultado, PrismaClient } from "@prisma/client";
import type {
  DatosEntregaOrden,
  IWebhookOrdenReader,
} from "@/lib/interfaces/repositories/IWebhookOrdenReader";

// Feature 99 (design §7) — lectura minima de la orden + catalogo de estado para la entrega.
// Solo queries. Separado de `OrdenRepository` para no arrastrar su superficie al handler.

// Feature 256 (R8): `gestion_orden.resultado` de una DEVOLUCION. Mismo molde que
// `RESULTADO_DEVUELTA` de `OrdenRepository.ts:318` y `DevolucionSlaRepository.ts:14`; la
// vigencia se filtra aparte, por `anuladaAt: null` (criterio de la feature 67).
const RESULTADO_DEVUELTA: GestionResultado = "devuelta";

// Feature 256 (R12): la relacion anidada NO exige el delegate `gestionOrden`, asi que este
// `Pick` NO cambia y el reader sigue haciendo exactamente 2 llamadas a Prisma.
type WebhookOrdenReaderPrismaClient = Pick<PrismaClient, "orden" | "orderStatus">;

export class WebhookOrdenReader implements IWebhookOrdenReader {
  constructor(private readonly prisma: WebhookOrdenReaderPrismaClient) {}

  async findDatosEntrega(
    ordenId: string,
    estatusDestinoId: string,
  ): Promise<DatosEntregaOrden | null> {
    const orden = await this.prisma.orden.findUnique({
      where: { id: ordenId },
      select: {
        tiendaId: true,
        numGuia: true,
        numRemision: true,
        deletedAt: true,
        // Feature 256 (R8/R9/R10/R11/R12): la causa de la devolucion VIGENTE se resuelve DENTRO
        // de esta misma lectura, como relacion anidada colgada de la orden pedida — no hay
        // consulta nueva ni consulta libre a `gestion_orden`. Molde de
        // `DevolucionSlaRepository.ts:71-77`: `take: 1` + `orderBy` sobre el `@@index([ordenId])`.
        gestiones: {
          where: { resultado: RESULTADO_DEVUELTA, anuladaAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { causaDevolucion: true },
        },
      },
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
      // R4/R5: los dos caminos del `null` (sin gestion vigente / gestion sin causa registrada)
      // colapsan a proposito en el mismo valor; el contrato publico no los distingue.
      causaDevolucion: orden.gestiones[0]?.causaDevolucion ?? null,
    };
  }
}
