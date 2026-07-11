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
    const rows = await this.prisma.distrito.findMany({
      where: { cantonId },
      select: {
        id: true,
        nombre: true,
        zonaId: true,
        zona: { select: { nombre: true } }, // R14: marca de zona por distrito
      },
      orderBy: { nombre: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      zonaId: row.zonaId,
      zonaNombre: row.zona?.nombre ?? null,
    }));
  }
}
