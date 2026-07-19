// Feature 91 (design §5) — repositorio de los datos de geocodificacion de una orden.
// SOLO queries Prisma (docs/architecture.md §Repository): ninguna decision de negocio.
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  IOrdenGeocodeRepository,
  OrdenGeocodeRow,
  OrdenGeocodeUpdate,
} from "@/lib/interfaces/repositories/IOrdenGeocodeRepository";

// Cliente Prisma MINIMO consumido (patron `ApiKeyRepository`/`JobRepository`).
type OrdenGeocodePrismaClient = Pick<PrismaClient, "orden">;

export class OrdenGeocodeRepository implements IOrdenGeocodeRepository {
  constructor(private readonly prisma: OrdenGeocodePrismaClient) {}

  async findParaGeocodificar(ordenId: string): Promise<OrdenGeocodeRow | null> {
    const row = await this.prisma.orden.findFirst({
      // R30: una orden borrada se comporta como inexistente.
      where: { id: ordenId, deletedAt: null },
      select: {
        id: true,
        direccion: true,
        distrito: { select: { nombre: true } },
        canton: { select: { nombre: true } },
        provincia: { select: { nombre: true } },
      },
    });
    if (row === null) return null;
    return {
      id: row.id,
      direccion: row.direccion,
      distritoNombre: row.distrito?.nombre ?? null,
      cantonNombre: row.canton.nombre,
      provinciaNombre: row.provincia.nombre,
    };
  }

  async guardarResultado(ordenId: string, data: OrdenGeocodeUpdate): Promise<void> {
    // `updateMany` (no `update`) para NO lanzar si la orden desaparecio entre la lectura
    // y la escritura: 0 filas afectadas es un desenlace valido, no un error.
    await this.prisma.orden.updateMany({
      where: { id: ordenId, deletedAt: null },
      data: {
        latitud: data.latitud !== null ? new Prisma.Decimal(data.latitud) : null,
        longitud: data.longitud !== null ? new Prisma.Decimal(data.longitud) : null,
        geocodePrecision: data.precision,
        geocodeStatus: data.status,
        geocodedAt: data.geocodedAt,
      },
    });
  }
}
