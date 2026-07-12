import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

// Solo el delegate de tarifa_zona_mensajero (Pick para dobles de test sin DB/red).
type TarifaZonaMensajeroPrismaClient = Pick<PrismaClient, "tarifaZonaMensajero">;

// Money-safe: Decimal -> string escala 2 (nunca number/parseFloat).
function toPagoTarifa(row: {
  cobroEntregado: Prisma.Decimal;
  cobroRechazado: Prisma.Decimal;
}): PagoTarifa {
  return {
    cobroEntregado: row.cobroEntregado.toFixed(2),
    cobroRechazado: row.cobroRechazado.toFixed(2),
  };
}

/**
 * Feature 39 — resolver de la tarifa de pago al mensajero. SOLO queries Prisma. Resuelve
 * (zona, vehiculo) con fallback a la tarifa por defecto de la zona (vehiculo_id IS NULL),
 * determinista por el indice unico (zona_id, vehiculo_id) NULLS NOT DISTINCT.
 */
export class TarifaZonaMensajeroRepository implements ITarifaZonaMensajeroRepository {
  constructor(private readonly prisma: TarifaZonaMensajeroPrismaClient) {}

  async resolvePagoTarifa(
    zonaId: string,
    vehiculoId: string | null,
  ): Promise<PagoTarifa | null> {
    // R1: con vehiculo, intenta la tarifa exacta (zona, vehiculo) via el unique compuesto.
    if (vehiculoId !== null) {
      const exacta = await this.prisma.tarifaZonaMensajero.findUnique({
        where: { zonaId_vehiculoId: { zonaId, vehiculoId } },
        select: { cobroEntregado: true, cobroRechazado: true },
      });
      if (exacta !== null) return toPagoTarifa(exacta); // R1
      // R2: sin tarifa especifica -> cae a la tarifa por defecto de la zona.
    }

    // R2/R3: tarifa por defecto de la zona (vehiculo_id IS NULL). El unique NULLS NOT
    // DISTINCT garantiza a lo sumo una; findFirst es determinista.
    const porDefecto = await this.prisma.tarifaZonaMensajero.findFirst({
      where: { zonaId, vehiculoId: null },
      select: { cobroEntregado: true, cobroRechazado: true },
    });
    return porDefecto !== null ? toPagoTarifa(porDefecto) : null; // R8: null si la zona no tiene tarifa
  }
}
