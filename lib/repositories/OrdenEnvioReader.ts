// Integracion WhatsApp — lector MINIMO de la orden para el envio de una plantilla. Devuelve
// los datos SOLO si la orden esta vigente Y asignada al mensajero que la solicita (authz:
// `mensajeroAsignadoId`, mismo criterio que `GestionOrdenRepository.findMisAsignaciones`,
// R13). Sin logica de negocio: solo la query scopeada.
import type { PrismaClient } from "@prisma/client";
import type { OrdenEnvioData } from "@/lib/types/whatsapp-envio";

type OrdenPrismaClient = Pick<PrismaClient, "orden">;

export interface IOrdenEnvioReader {
  /** Datos de envio de la orden si esta vigente y asignada a `mensajeroId`; `null` si no. */
  findParaEnvio(ordenId: string, mensajeroId: string): Promise<OrdenEnvioData | null>;
}

export class OrdenEnvioReader implements IOrdenEnvioReader {
  constructor(private readonly prisma: OrdenPrismaClient) {}

  async findParaEnvio(ordenId: string, mensajeroId: string): Promise<OrdenEnvioData | null> {
    const row = await this.prisma.orden.findFirst({
      where: {
        id: ordenId,
        deletedAt: null,
        mensajeroAsignadoId: mensajeroId, // R13: nunca ordenes de otro mensajero
      },
      select: {
        destinatario: true,
        telefonoDest: true,
        numGuia: true,
        numRemision: true,
        producto: true,
        direccion: true,
        montoCobrar: true,
      },
    });
    if (row === null) return null;
    return {
      destinatario: row.destinatario,
      telefonoDest: row.telefonoDest,
      numGuia: row.numGuia,
      numRemision: row.numRemision,
      producto: row.producto,
      direccion: row.direccion,
      // Decimal de Prisma -> number para el resolver de variables.
      montoCobrar: row.montoCobrar === null ? null : Number(row.montoCobrar),
    };
  }
}
