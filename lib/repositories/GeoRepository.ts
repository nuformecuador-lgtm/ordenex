import type { PrismaClient } from "@prisma/client";
import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type {
  CantonLightDTO,
  DistritoCatalogoDTO,
  ProvinciaLightDTO,
} from "@/lib/types/zona";

type GeoPrismaClient = Pick<PrismaClient, "provincia" | "canton" | "distrito">;

// Feature 24/R14. Lectura del catalogo geografico global (provincia -> canton ->
// distrito). Solo queries Prisma; sin logica de negocio.
export class GeoRepository implements IGeoRepository {
  constructor(private readonly prisma: GeoPrismaClient) {}

  async listProvincias(): Promise<ProvinciaLightDTO[]> {
    return this.prisma.provincia.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  async listCantones(provinciaId: string): Promise<CantonLightDTO[]> {
    return this.prisma.canton.findMany({
      where: { provinciaId },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  async listDistritos(cantonId: string): Promise<DistritoCatalogoDTO[]> {
    // Feature 54 (reconciliacion PR #40): la relacion distrito<->zona pasa a N:M
    // (tabla puente ZonaDistrito). El DTO expone una unica zona asignada (la
    // primera), preservando el contrato zonaId/zonaNombre|null de la feature 24.
    const rows = await this.prisma.distrito.findMany({
      where: { cantonId },
      select: {
        id: true,
        nombre: true,
        zonas: {
          select: { zona: { select: { id: true, nombre: true } } },
          take: 1,
        },
      },
      orderBy: { nombre: "asc" },
    });
    return rows.map((row) => {
      const asignada = row.zonas[0]?.zona ?? null;
      return {
        id: row.id,
        nombre: row.nombre,
        zonaId: asignada?.id ?? null,
        zonaNombre: asignada?.nombre ?? null,
      };
    });
  }
}
