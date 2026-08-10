import { Prisma, type PrismaClient } from "@prisma/client";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import type {
  CrearSnapshotInput,
  CrearSnapshotResult,
  IRankingSnapshotRepository,
  SnapshotDiaRow,
} from "@/lib/interfaces/repositories/IRankingSnapshotRepository";

// Feature 196 (design §4.2) — repositorio del SNAPSHOT del ranking. SOLO queries Prisma
// (docs/architecture.md §Repository): ni una decision de negocio vive aqui —el universo, el
// orden, el podio y el premio los resuelve `RankingSnapshotService`—, ni un `Date.now()`: la
// fecha llega ya calculada.
//
// Cliente acotado a lo que consume (patron `RutaOptimizadaRepository`): las dos tablas del
// snapshot mas `$transaction` para la escritura atomica.
type RankingSnapshotPrismaClient = Pick<
  PrismaClient,
  "rankingSnapshotDia" | "rankingSnapshotFila" | "$transaction"
>;

/**
 * `true` solo para la colision del UNIQUE de `ranking_snapshot_dia.fecha` (R12), que es el
 * camino esperado de la reejecucion.
 *
 * El filtro por el NOMBRE de la constraint no es cosmetico: los otros tres UNIQUE de la
 * feature —`(snapshot_id, mensajero_id)`, `(snapshot_id, puesto)` y el parcial de
 * `posicion`— tambien emiten P2002, y esos SI son defectos (un mensajero repetido, dos
 * puestos iguales). Tragarselos como «ya estaba congelada» convertiria un bug en un
 * `omitido` silencioso. Si el error no permite disambiguar, se propaga.
 */
function esColisionDeFecha(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto !== null && texto.includes("fecha");
}

export class RankingSnapshotRepository implements IRankingSnapshotRepository {
  constructor(private readonly prisma: RankingSnapshotPrismaClient) {}

  /**
   * R14 — cabecera + filas en UNA sola `$transaction`: si el `createMany` falla, la cabecera
   * que se acaba de insertar se revierte con el, y la fecha queda como estaba (sin snapshot).
   * Escribir la cabecera fuera de la transaccion dejaria justo el snapshot parcial que R14
   * prohibe: una fecha «congelada» con cero filas indistinguible de un dia sin actividad.
   *
   * R11 — `filas` vacio NO es un no-op: se escribe la cabecera igual, con `filas = 0`.
   */
  async crearSnapshot(input: CrearSnapshotInput): Promise<CrearSnapshotResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cabecera = await tx.rankingSnapshotDia.create({
          data: {
            fecha: input.fecha,
            minAsignadasPodio: input.minAsignadasPodio,
            filas: input.filas.length,
          },
          select: { id: true },
        });
        if (input.filas.length > 0) {
          await tx.rankingSnapshotFila.createMany({
            data: input.filas.map((fila) => ({
              snapshotId: cabecera.id,
              puesto: fila.puesto,
              posicion: fila.posicion,
              mensajeroId: fila.mensajeroId,
              mensajeroNombre: fila.mensajeroNombre,
              entregadas: fila.entregadas,
              asignadas: fila.asignadas,
              // Money-safe: el STRING de escala 2 entra a la columna DECIMAL(12,2) por
              // `Prisma.Decimal`, nunca por `parseFloat` (patron PremioRankingRepository).
              premioMonto: fila.premioMonto === null ? null : new Prisma.Decimal(fila.premioMonto),
              premioDescripcion: fila.premioDescripcion,
            })),
          });
        }
        return { creado: true, filas: input.filas.length };
      });
    } catch (error) {
      if (!esColisionDeFecha(error)) throw error;
      // R12 — la fecha ya estaba congelada: no se crea, altera ni borra nada. Se lee el
      // conteo YA congelado para que el reporte del cron diga cuantas filas tiene esa fecha
      // de verdad, y no cuantas se habrian escrito.
      const existente = await this.prisma.rankingSnapshotDia.findUnique({
        where: { fecha: input.fecha },
        select: { filas: true },
      });
      return { creado: false, filas: existente?.filas ?? 0 };
    }
  }

  /**
   * R25 — `ORDER BY puesto ASC` y nada mas: el orden congelado es DATO, no derivacion. Aqui
   * no se reordena ni se recalcula ninguna posicion.
   *
   * R31 — el `Decimal` del premio se serializa a STRING de escala 2 EN EL REPO, igual que
   * `PremioRankingRepository.toDTO`: ningun `Prisma.Decimal` sale de esta capa.
   */
  async obtenerPorFecha(fecha: Date): Promise<SnapshotDiaRow | null> {
    const row = await this.prisma.rankingSnapshotDia.findUnique({
      where: { fecha },
      include: { filasSnapshot: { orderBy: { puesto: "asc" } } },
    });
    if (row === null) return null;
    return {
      fecha: row.fecha,
      generadoAt: row.generadoAt,
      minAsignadasPodio: row.minAsignadasPodio,
      filas: row.filasSnapshot.map((fila) => ({
        puesto: fila.puesto,
        posicion: fila.posicion,
        mensajeroId: fila.mensajeroId,
        mensajeroNombre: fila.mensajeroNombre,
        entregadas: fila.entregadas,
        asignadas: fila.asignadas,
        premioMonto: fila.premioMonto === null ? null : fila.premioMonto.toFixed(2),
        premioDescripcion: fila.premioDescripcion,
      })),
    };
  }
}
