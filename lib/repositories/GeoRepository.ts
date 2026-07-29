import type { PrismaClient } from "@prisma/client";
import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type {
  CantonLightDTO,
  DistritoCatalogoDTO,
  ProvinciaLightDTO,
} from "@/lib/types/zona";
import type { OpcionCatalogo, OpcionConPadre } from "@/lib/types/filtros-ordenes";

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

  // --- Feature 144/B2 (R48/R49/R54): proyecciones planas del catalogo completo ---

  async listProvinciasLite(): Promise<OpcionCatalogo[]> {
    return this.prisma.provincia.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" }, // R49: orden determinista
    });
  }

  async listCantonesLite(): Promise<OpcionConPadre[]> {
    const rows = await this.prisma.canton.findMany({
      select: { id: true, nombre: true, provinciaId: true },
      orderBy: { nombre: "asc" },
    });
    // `padreId` en vez de `provinciaId`: el consumidor generico no sabe de geografia,
    // solo de "padre" (R48).
    return rows.map((r) => ({ id: r.id, nombre: r.nombre, padreId: r.provinciaId }));
  }

  async listDistritosLite(): Promise<OpcionConPadre[]> {
    // Sin `zonas`: la zona de la ORDEN esta congelada en `orden.zona_id` y no se
    // deriva del distrito (decision (b) del spec). Traerla aqui seria peso muerto en
    // el payload de las 491 filas.
    const rows = await this.prisma.distrito.findMany({
      select: { id: true, nombre: true, cantonId: true },
      orderBy: { nombre: "asc" },
    });
    return rows.map((r) => ({ id: r.id, nombre: r.nombre, padreId: r.cantonId }));
  }
}
