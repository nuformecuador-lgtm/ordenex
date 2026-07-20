// Feature 92 (design §5.2, R23/R26/R27) — repositorio de la ruta optimizada. SOLO queries
// Prisma (docs/architecture.md §Repository): ninguna decision de negocio vive aqui.
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  IRutaOptimizadaRepository,
  OrigenFuente,
  OrigenUbicacion,
  ReemplazarSecuenciaMeta,
  RutaOptimizadaDTO,
} from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";

// Cliente Prisma MINIMO consumido (patron `GestionOrdenRepository`): las dos tablas de la
// feature mas `$transaction` para el reemplazo atomico de la secuencia.
type RutaPrismaClient = Pick<
  PrismaClient,
  "rutaOptimizada" | "rutaOptimizadaParada" | "$transaction"
>;

/** Convierte un `Decimal` de Prisma a `number`, tolerando el null de la columna. */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value !== null ? value.toNumber() : null;
}

export class RutaOptimizadaRepository implements IRutaOptimizadaRepository {
  constructor(private readonly prisma: RutaPrismaClient) {}

  async findByMensajero(mensajeroId: string): Promise<RutaOptimizadaDTO | null> {
    const row = await this.prisma.rutaOptimizada.findUnique({
      where: { mensajeroId },
      include: { paradas: { select: { ordenId: true, secuencia: true } } },
    });
    if (row === null) return null;
    return {
      id: row.id,
      mensajeroId: row.mensajeroId,
      estado: row.estado,
      calculadaAt: row.calculadaAt,
      origenLat: toNumber(row.origenLat),
      origenLng: toNumber(row.origenLng),
      origenAt: row.origenAt,
      // La columna es TEXT (no enum) y el vocabulario es nuestro: se estrecha al tipo del
      // dominio sin validar, igual que `geocode_status` en la 91.
      origenFuente: row.origenFuente as OrigenFuente | null,
      huellaSet: row.huellaSet,
      ultimoError: row.ultimoError,
      secuenciaPorOrden: new Map(row.paradas.map((p) => [p.ordenId, p.secuencia])),
    };
  }

  /**
   * R23: upsert de la CABECERA con el origen. NO toca `calculada_at`, `huella_set` ni las
   * paradas: capturar una posicion nueva no invalida el orden ya calculado, solo cambia el
   * punto desde el que se calculara el siguiente.
   */
  async upsertOrigen(mensajeroId: string, ubicacion: OrigenUbicacion): Promise<void> {
    const datos = {
      origenLat: new Prisma.Decimal(ubicacion.lat),
      origenLng: new Prisma.Decimal(ubicacion.lng),
      origenAt: ubicacion.capturadaAt,
      origenFuente: ubicacion.fuente,
    };
    await this.prisma.rutaOptimizada.upsert({
      where: { mensajeroId },
      // Fila nueva: `calculada_at` queda NULL (nunca se calculo) y el estado toma su
      // default `vigente`, que es correcto — no hay ningun orden previo que contradecir.
      create: { mensajeroId, ...datos },
      update: datos,
    });
  }

  /**
   * R26: reemplazo ATOMICO. Los tres pasos —crear/actualizar cabecera, borrar paradas
   * viejas, insertar las nuevas— van en UNA transaccion: nunca existe un instante visible
   * con la secuencia a medias. Si algo falla, la ruta anterior sigue entera.
   */
  async reemplazarSecuencia(
    mensajeroId: string,
    secuencia: string[],
    meta: ReemplazarSecuenciaMeta,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cabecera = {
        estado: "vigente" as const,
        calculadaAt: meta.calculadaAt,
        origenLat: meta.origen !== null ? new Prisma.Decimal(meta.origen.lat) : null,
        origenLng: meta.origen !== null ? new Prisma.Decimal(meta.origen.lng) : null,
        origenFuente: meta.origen?.fuente ?? null,
        huellaSet: meta.huellaSet,
        // R27 a la inversa: una optimizacion exitosa LIMPIA el error anterior; si no, un
        // fallo viejo seguiria alimentando el aviso de la UI para siempre.
        ultimoError: null,
      };
      const ruta = await tx.rutaOptimizada.upsert({
        where: { mensajeroId },
        create: { mensajeroId, ...cabecera },
        update: cabecera,
        select: { id: true },
      });
      // DELETE + createMany en vez de un diff posicion a posicion: la secuencia es
      // pequena y se recalcula entera, y el borrado previo es lo que evita chocar con el
      // indice unico `(ruta_id, secuencia)` al reordenar.
      await tx.rutaOptimizadaParada.deleteMany({ where: { rutaId: ruta.id } });
      if (secuencia.length > 0) {
        await tx.rutaOptimizadaParada.createMany({
          data: secuencia.map((ordenId, idx) => ({
            rutaId: ruta.id,
            ordenId,
            secuencia: idx + 1, // 1-based: la primera parada es la posicion 1
          })),
        });
      }
    });
  }

  /**
   * R27: SOLO la cabecera. Las paradas NO se tocan — el ultimo orden optimizado valido se
   * conserva intacto y el sistema jamas cae en silencio a `createdAt desc`.
   */
  async marcarDesactualizada(mensajeroId: string, ultimoError: string): Promise<void> {
    await this.prisma.rutaOptimizada.upsert({
      where: { mensajeroId },
      create: { mensajeroId, estado: "desactualizada", ultimoError },
      update: { estado: "desactualizada", ultimoError },
    });
  }
}
