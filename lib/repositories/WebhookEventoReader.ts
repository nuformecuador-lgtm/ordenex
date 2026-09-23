import type { PrismaClient } from "@prisma/client";

import type {
  DatosEntregaEvento,
  IWebhookEventoReader,
} from "@/lib/interfaces/repositories/IWebhookEventoReader";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";

// FICHA 454 (design §12.1, T1.5) — lectura del hecho de orden para su webhook. UNA consulta: el
// evento con su orden, su gestion y su mensajero como relaciones anidadas. Solo queries.

type WebhookEventoReaderPrismaClient = Pick<PrismaClient, "ordenEvento">;

export class WebhookEventoReader implements IWebhookEventoReader {
  constructor(private readonly prisma: WebhookEventoReaderPrismaClient) {}

  async findDatosEntrega(ordenEventoId: string): Promise<DatosEntregaEvento | null> {
    const e = await this.prisma.ordenEvento.findUnique({
      where: { id: ordenEventoId },
      select: {
        id: true,
        tipo: true,
        createdAt: true,
        actorRol: true,
        resultado: true,
        resultadoAnterior: true,
        gestionOrdenId: true,
        // Las dos causas TIPIFICADAS. El texto libre de la gestion NO se proyecta (256/R22).
        gestion: { select: { causaDevolucion: true, causaIncidente: true } },
        mensajero: { select: { id: true, ...NOMBRE_USUARIO_SELECT } },
        orden: { select: { tiendaId: true, numGuia: true, numRemision: true, deletedAt: true } },
      },
    });
    if (e === null) return null;

    const causa =
      e.resultado === "devuelta"
        ? (e.gestion?.causaDevolucion ?? null)
        : e.resultado === "incidente"
          ? (e.gestion?.causaIncidente ?? null)
          : null;

    return {
      ordenEventoId: e.id,
      tipo: e.tipo,
      createdAt: e.createdAt,
      actorRol: e.actorRol,
      resultado: e.resultado,
      resultadoAnterior: e.resultadoAnterior,
      gestionId: e.gestionOrdenId,
      causa,
      mensajero: e.mensajero ? { id: e.mensajero.id, nombre: nombreCompletoUsuario(e.mensajero) } : null,
      orden: e.orden,
    };
  }
}
