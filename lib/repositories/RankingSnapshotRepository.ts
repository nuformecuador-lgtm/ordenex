import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import { Prisma, type PrismaClient } from "@prisma/client";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import type {
  CrearSnapshotInput,
  CrearSnapshotResult,
  IRankingSnapshotRepository,
  PodioFilaConFecha,
  PodioFilaRow,
  RankingSnapshotAccionTxClient,
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
  // Ficha 362 (R9): `registrarAccionSobreFila` escribe en `historial_accion` con el `tx` que
  // recibe; `usuario` es lo que consulta el congelado del actor.
  "rankingSnapshotDia" | "rankingSnapshotFila" | "$transaction" | "historialAccion" | "usuario"
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

  /**
   * Feature 293 (T3.1, R4/R6) — el PODIO congelado de una fecha: las filas con `posicion` no
   * nula, `ORDER BY posicion ASC`.
   *
   * Dos consultas y no una con `include`, a proposito: hace falta distinguir «esa fecha no esta
   * congelada» (`null`, R6) de «esta congelada y nadie ocupo podio» (`[]`), y un `findMany` sobre
   * las filas no puede decir la diferencia — las dos darian cero filas y la pantalla mostraria el
   * texto equivocado.
   *
   * `posicion IS NOT NULL` va en el WHERE, no en un `filter` en memoria: el podio es 1-3 filas de
   * un snapshot que puede tener decenas.
   *
   * Money-safe (R35): el `Decimal` del premio sale como STRING de escala 2 EN EL REPO, igual que
   * en `obtenerPorFecha`. Ningun `Prisma.Decimal` cruza esta capa.
   */
  async listarPodioDeFecha(fecha: Date): Promise<PodioFilaRow[] | null> {
    const cabecera = await this.prisma.rankingSnapshotDia.findUnique({
      where: { fecha },
      select: { id: true },
    });
    if (cabecera === null) return null; // R6: esa fecha no tiene ranking congelado

    const filas = await this.prisma.rankingSnapshotFila.findMany({
      where: { snapshotId: cabecera.id, posicion: { not: null } },
      orderBy: { posicion: "asc" },
      select: {
        id: true,
        posicion: true,
        mensajeroId: true,
        mensajeroNombre: true,
        entregadas: true,
        asignadas: true,
        premioMonto: true,
        premioDescripcion: true,
      },
    });
    return filas.flatMap((f) =>
      // `posicion` es nullable en el esquema y el `not: null` de arriba ya la excluye; el guardia
      // esta para que un cambio de filtro no invente una posicion en vez de fallar.
      f.posicion === null
        ? []
        : [
            {
              filaId: f.id,
              posicion: f.posicion,
              mensajeroId: f.mensajeroId,
              mensajeroNombre: f.mensajeroNombre,
              entregadas: f.entregadas,
              asignadas: f.asignadas,
              premioMonto: f.premioMonto === null ? null : f.premioMonto.toFixed(2),
              premioDescripcion: f.premioDescripcion,
            },
          ],
    );
  }

  /**
   * Feature 293 (T3.1, R16) — UNA fila del podio por su id, con la fecha de su snapshot.
   *
   * `posicion: { not: null }` va en el WHERE y no en un `if` posterior: una fila fuera del podio
   * no tiene premio que registrar, y que la base no la devuelva es una barrera mas barata y mas
   * dificil de saltarse que una comprobacion en memoria.
   */
  async obtenerFilaDelPodio(filaId: string): Promise<PodioFilaConFecha | null> {
    const f = await this.prisma.rankingSnapshotFila.findFirst({
      where: { id: filaId, posicion: { not: null } },
      select: {
        id: true,
        posicion: true,
        mensajeroId: true,
        mensajeroNombre: true,
        entregadas: true,
        asignadas: true,
        premioMonto: true,
        premioDescripcion: true,
        snapshot: { select: { fecha: true } },
      },
    });
    if (f === null || f.posicion === null) return null;
    return {
      filaId: f.id,
      posicion: f.posicion,
      mensajeroId: f.mensajeroId,
      mensajeroNombre: f.mensajeroNombre,
      entregadas: f.entregadas,
      asignadas: f.asignadas,
      premioMonto: f.premioMonto === null ? null : f.premioMonto.toFixed(2),
      premioDescripcion: f.premioDescripcion,
      fecha: f.snapshot.fecha,
    };
  }

  /**
   * FICHA 362 (R6/R9) — `premio_ranking_registrado` / `premio_ranking_anulado`.
   *
   * ⚠️ ESTE METODO NO MUTA `ranking_snapshot_fila`, Y NO PUEDE: el snapshot es historia congelada
   * (R16 de la 196) y reescribirlo seria falsificar el podio. La mutacion que este registro
   * documenta es el DEVENGO en el libro del mensajero y su egreso de caja, que
   * `PremioRankingDevengoService` acaba de escribir en la MISMA transaccion que aqui se recibe.
   *
   * Recibe `tx` y por tanto no puede abrir la suya: si el registro falla, el devengo y el egreso
   * se van con el (R10); si el devengo no se escribio, el servicio sale antes y aqui no se llega
   * (R11).
   *
   * `premio_descripcion` NO entra en la etiqueta: la fila se identifica por el mensajero
   * CONGELADO y su puesto, que es lo que el podio significa.
   */
  async registrarAccionSobreFila(
    tx: RankingSnapshotAccionTxClient,
    input: {
      filaId: string;
      accion: "premio_ranking_registrado" | "premio_ranking_anulado";
      monto: string;
      actorUsuarioId: string | null;
    },
  ): Promise<void> {
    const fila = await tx.rankingSnapshotFila.findUnique({
      where: { id: input.filaId },
      select: { mensajeroNombre: true, puesto: true },
    });
    const actor = await resolverActorCongelado(tx, input.actorUsuarioId);
    await appendAccion(tx, [
      {
        accion: input.accion,
        entidadTipo: "ranking_snapshot_fila",
        entidadId: input.filaId,
        entidadEtiqueta: etiquetaDeEntidad("ranking_snapshot_fila", {
          mensajeroNombre: fila?.mensajeroNombre ?? "",
          puesto: fila?.puesto ?? 0,
        }),
        // STRING money-safe -> `Decimal`, sin pasar por `number` (R6).
        monto: new Prisma.Decimal(input.monto),
        ...actor,
      },
    ]);
  }
}
