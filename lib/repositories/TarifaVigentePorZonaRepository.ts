import { type PrismaClient } from "@prisma/client";
import type {
  ITarifaVigentePorZonaRepository,
  TarifaVigentePorZona,
} from "@/lib/interfaces/repositories/ITarifaVigentePorZonaRepository";

type TarifaPrismaClient = Pick<PrismaClient, "tarifa">;

/**
 * Feature 42 — resolver de la TARIFA VIGENTE por zona (feature 18/54, tabla `tarifas`).
 * SOLO query Prisma. Excluye soft-delete (`deletedAt IS NULL`). SUPUESTO documentado
 * (F1.4-Q1): la 18 es un CRUD multi-fila sin flag de "vigente unica"; si hay varias
 * tarifas no borradas en la zona, se elige la MAS RECIENTE (`orderBy createdAt desc`,
 * first) como resolucion determinista. `null` si la zona no tiene ninguna (gap R9).
 * Money-safe: montos/porcentajes -> STRING escala 2 (el util los reconvierte a Decimal).
 */
export class TarifaVigentePorZonaRepository implements ITarifaVigentePorZonaRepository {
  constructor(private readonly prisma: TarifaPrismaClient) {}

  async resolveTarifaPorZona(zonaId: string): Promise<TarifaVigentePorZona | null> {
    const t = await this.prisma.tarifa.findFirst({
      where: { zonaId, deletedAt: null }, // excluye soft-delete (R9: solo tarifa vigente)
      orderBy: { createdAt: "desc" }, // SUPUESTO: la mas reciente = la vigente
      select: {
        valorFlete: true,
        valorFleteGam: true,
        valorFleteDevuelto: true,
        valorFleteDevueltoGam: true,
        comisionCod: true,
        ivaFlete: true,
        ivaComisionCod: true,
      },
    });
    if (t === null) return null; // gap de datos (R9)
    return {
      valorFlete: t.valorFlete.toFixed(2),
      valorFleteGam: t.valorFleteGam.toFixed(2),
      valorFleteDevuelto: t.valorFleteDevuelto.toFixed(2),
      valorFleteDevueltoGam: t.valorFleteDevueltoGam.toFixed(2),
      comisionCod: t.comisionCod.toFixed(2),
      ivaFlete: t.ivaFlete.toFixed(2),
      ivaComisionCod: t.ivaComisionCod.toFixed(2),
    };
  }
}
