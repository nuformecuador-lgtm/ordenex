import type { PrismaClient } from "@prisma/client";
import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type { OpcionCatalogo, OpcionConPadre } from "@/lib/types/filtros-ordenes";

type GeoPrismaClient = Pick<PrismaClient, "provincia" | "canton" | "distrito">;

// Lectura del catalogo geografico global. Solo queries Prisma; sin logica de negocio.
//
// Tenia ademas `listProvincias`/`listCantones`/`listDistritos` (feature 24/R14), la
// navegacion por niveles; se borro el 2026-08-07 con `GeoService` y `lib/actions/geo.ts`.
// Esta clase NO muere con ellas: la mantiene viva `lib/actions/filtros-ordenes.ts` por las
// proyecciones planas de abajo.
export class GeoRepository implements IGeoRepository {
  constructor(private readonly prisma: GeoPrismaClient) {}

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
