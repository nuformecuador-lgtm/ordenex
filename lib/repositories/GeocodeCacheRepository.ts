// Feature 91 (design §1.2) — repositorio de la cache de direcciones resueltas. SOLO
// queries Prisma: sin logica de negocio (la decision de cachear o no la toma el service,
// que solo llama a `upsert` con resultados satisfactorios).
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  GeocodeCacheEntry,
  IGeocodeCacheRepository,
} from "@/lib/interfaces/repositories/IGeocodeCacheRepository";

type GeocodeCachePrismaClient = Pick<PrismaClient, "geocodeCache">;

export class GeocodeCacheRepository implements IGeocodeCacheRepository {
  constructor(private readonly prisma: GeocodeCachePrismaClient) {}

  async findByHash(direccionHash: string): Promise<GeocodeCacheEntry | null> {
    // R28: sin filtro por antiguedad. La cache NO caduca (gate F1.4-Q7); la invalidacion
    // es implicita porque una direccion distinta produce una huella distinta.
    const row = await this.prisma.geocodeCache.findUnique({
      where: { direccionHash },
      select: { latitud: true, longitud: true, precision: true },
    });
    if (row === null) return null;
    return {
      latitud: row.latitud.toNumber(),
      longitud: row.longitud.toNumber(),
      precision: row.precision,
    };
  }

  async upsert(
    direccionHash: string,
    entry: GeocodeCacheEntry & { payloadCrudo: unknown },
  ): Promise<void> {
    const valores = {
      latitud: new Prisma.Decimal(entry.latitud),
      longitud: new Prisma.Decimal(entry.longitud),
      precision: entry.precision,
      payloadCrudo: (entry.payloadCrudo ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    };
    // R29: upsert por `direccion_hash` (indice UNICO), asi que re-ejecutar el mismo job no
    // duplica la entrada.
    await this.prisma.geocodeCache.upsert({
      where: { direccionHash },
      create: { direccionHash, ...valores },
      update: valores,
    });
  }
}
