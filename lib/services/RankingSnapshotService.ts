import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CongelarResult,
  IRankingSnapshotService,
  ObtenerSnapshotResult,
} from "@/lib/interfaces/services/IRankingSnapshotService";
import type {
  FilaSnapshotInput,
  IRankingSnapshotRepository,
} from "@/lib/interfaces/repositories/IRankingSnapshotRepository";
import type { IRankingRepository } from "@/lib/interfaces/repositories/IRankingRepository";
import type { IPremioRankingRepository } from "@/lib/interfaces/repositories/IPremioRankingRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { PremioRankingDTO } from "@/lib/types/ranking";
import type { RankingSnapshotFilaDTO } from "@/lib/types/ranking-snapshot";
import { loadRankingConfig, type RankingConfig } from "@/lib/config/ranking";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  asignarPodio,
  formatearPct,
  ordenarAgregados,
  type AgregadoOrdenable,
} from "@/lib/ranking/orden-ranking";
import { fechaComoDate, fechaObjetivo, ventanaDelDia } from "@/lib/ranking/snapshot-dia";

// Feature 196 (design §4.1) — logica de negocio del snapshot diario del ranking. No conoce
// HTTP ni Prisma: repos por inyeccion, instante por parametro, config inyectable.
//
// Consume el modulo puro `lib/ranking/orden-ranking.ts` —el MISMO que consume
// `RankingService`— y los MISMOS tres repositorios del ranking en vivo. Esa es toda la
// garantia de R3: no hay aqui ni un comparador, ni una regla de podio, ni un redondeo
// propios que puedan divergir del vivo en silencio.

/** Rol lector adicional (solo lectura) ademas del acceso total, igual que el vivo. */
const ROL_LECTOR_SOLO_LECTURA = "mensajero";

/** Premio congelado de una posicion de podio (R7). */
interface PremioCongelado {
  monto: string | null;
  descripcion: string | null;
}

/**
 * R5 — «actividad» es tener al menos una entrega contada o al menos una orden asignada ese
 * dia. `0/0` no produce fila. Ojo: `entregadas > 0` con `asignadas === 0` SI es actividad
 * (una orden asignada ayer y entregada hoy), y esa fila se congela con `pct` indefinido.
 */
function tieneActividad(agregado: AgregadoOrdenable): boolean {
  return agregado.entregadas > 0 || agregado.asignadas > 0;
}

export class RankingSnapshotService implements IRankingSnapshotService {
  private readonly config: RankingConfig;

  constructor(
    private readonly snapshotRepo: IRankingSnapshotRepository,
    private readonly rankingRepo: IRankingRepository,
    private readonly userRepo: IUserRepository,
    private readonly premioRepo: IPremioRankingRepository,
    config?: RankingConfig,
  ) {
    this.config = config ?? loadRankingConfig();
  }

  /**
   * R2/R15 — la fecha sale de `now` y de ningun otro sitio.
   *
   * ORDEN DE LAS OPERACIONES, que es la decision de diseño de este metodo:
   *
   *   1. se construye el universo COMPLETO del vivo (todos los mensajeros ACTIVOS, incluidos
   *      los de 0/0) — R3: mismo universo;
   *   2. se ordena y se asigna podio sobre ese universo completo — R3: mismo orden, mismo
   *      umbral, misma regla de podio;
   *   3. y SOLO DESPUES se filtran las filas sin actividad — R5.
   *
   * Filtrar ANTES daria exactamente el mismo resultado, y no por casualidad: una fila 0/0
   * tiene el porcentaje INDEFINIDO, asi que (a) nunca es elegible para podio —quitarla no
   * puede mover ni una posicion— y (b) el comparador la manda siempre a la cola de los
   * indefinidos. Se hace en este orden igualmente porque es el que DEMUESTRA R3: el criterio
   * corre sobre la misma lista que el vivo, y el filtro de R5 es un paso posterior y
   * separado, no una variacion del criterio.
   *
   * El `puesto` se RENUMERA 1..N sobre las filas que quedan. Es lo que R6 y el glosario
   * piden —«la posicion en la lista completa CONGELADA»— y lo que la base espera: `puesto`
   * es 1..N sin huecos y `filas` cuenta esas mismas N. Conservar el puesto del vivo dejaria
   * agujeros («puesto 7» en una tabla de 3 filas) que no significan nada para quien lee el
   * historico. Lo que R3 fija es el ORDEN RELATIVO y el PODIO, y los dos se conservan
   * intactos: la renumeracion no reordena nada.
   */
  async congelar(now: Date): Promise<CongelarResult> {
    const fecha = fechaObjetivo(now);
    const { desde, hasta } = ventanaDelDia(fecha);

    // Las mismas cuatro lecturas del vivo, sobre la ventana del dia YA CERRADO.
    const [mensajeros, entregadas, asignadas, premios] = await Promise.all([
      this.userRepo.listMensajeros(),
      this.rankingRepo.contarEntregadasPorMensajero(desde, hasta),
      this.rankingRepo.contarAsignadasPorMensajero(desde, hasta),
      this.premioRepo.listar(),
    ]);

    const entregadasPorId = new Map(entregadas.map((c) => [c.mensajeroId, c.total]));
    const asignadasPorId = new Map(asignadas.map((c) => [c.mensajeroId, c.total]));
    const agregados: AgregadoOrdenable[] = mensajeros.map((m) => ({
      mensajeroId: m.id,
      nombre: m.nombre,
      entregadas: entregadasPorId.get(m.id) ?? 0,
      asignadas: asignadasPorId.get(m.id) ?? 0,
    }));

    const premioPorPosicion = mapaDePremios(premios);
    const filas: FilaSnapshotInput[] = asignarPodio(
      ordenarAgregados(agregados),
      this.config.MIN_ASIGNADAS_PODIO,
    )
      .filter(({ agregado }) => tieneActividad(agregado)) // R5
      .map(({ agregado, posicion }, indice) => {
        // R7/R8: el premio se congela SOLO si la fila ocupa posicion de podio. Fuera del
        // podio no hay monto ni descripcion, y el CHECK de la base lo reafirma.
        const premio = posicion === null ? null : (premioPorPosicion.get(posicion) ?? null);
        return {
          puesto: indice + 1, // R6: 1..N contiguo sobre las filas congeladas
          posicion,
          mensajeroId: agregado.mensajeroId,
          mensajeroNombre: agregado.nombre, // R16: el nombre de HOY queda congelado
          entregadas: agregado.entregadas, // R10: numerador crudo, nunca la tasa
          asignadas: agregado.asignadas, // R10: denominador crudo
          premioMonto: premio?.monto ?? null,
          premioDescripcion: premio?.descripcion ?? null,
        };
      });

    // R11: aunque `filas` este vacio se escribe la cabecera. «Ese dia no hubo actividad» es
    // un hecho que hay que poder distinguir de «el cron no corrio esa fecha» (R26).
    const resultado = await this.snapshotRepo.crearSnapshot({
      fecha: fechaComoDate(fecha),
      minAsignadasPodio: this.config.MIN_ASIGNADAS_PODIO, // R1: el umbral APLICADO
      filas,
    });

    return {
      status: resultado.creado ? "creado" : "omitido", // R12
      fecha,
      filas: resultado.filas,
    };
  }

  /**
   * R27/R28 — misma autorizacion que el vivo: acceso total y `mensajero`; cualquier otro rol
   * (o sin sesion, que el borde traduce a un rol sin permiso) no ve NADA. El `mensajero` ve
   * el historico COMPLETO, sin recorte a sus propias filas (decision humana 4).
   *
   * R25 — se devuelven las filas EN EL ORDEN EN QUE VIENEN del repositorio (`puesto` asc).
   * Aqui no hay ni un `sort` ni un recalculo de posiciones: el orden congelado es dato.
   */
  async obtenerPorFecha(actor: Actor, fecha: string): Promise<ObtenerSnapshotResult> {
    if (!esAccesoTotal(actor.rol) && actor.rol !== ROL_LECTOR_SOLO_LECTURA) {
      return { status: "forbidden" };
    }

    const row = await this.snapshotRepo.obtenerPorFecha(fechaComoDate(fecha));
    // R26: sin cabecera = el cron no corrio esa fecha. Distinto de cabecera con 0 filas.
    if (row === null) return { status: "sin_snapshot", fecha };

    const filas: RankingSnapshotFilaDTO[] = row.filas.map((f) => ({
      puesto: f.puesto,
      posicion: f.posicion,
      mensajeroId: f.mensajeroId,
      nombre: f.mensajeroNombre, // R16: el congelado, jamas `usuario.nombre`
      entregadas: f.entregadas,
      asignadas: f.asignadas,
      // R10/R31: el porcentaje se DERIVA de los dos enteros congelados, con el mismo
      // redondeo del vivo, y cruza como STRING. `premioMonto` ya viene STRING del repo.
      pct: formatearPct(f.entregadas, f.asignadas),
      premioMonto: f.premioMonto,
      premioDescripcion: f.premioDescripcion,
    }));

    return {
      status: "ok",
      data: {
        fecha, // la fecha consultada, ya en formato calendario `YYYY-MM-DD`
        generadoAt: row.generadoAt.toISOString(), // R24: «generado el...»
        minAsignadasPodio: row.minAsignadasPodio,
        filas,
      },
    };
  }
}

/** Premio vigente por posicion de podio (Q2: el de la corrida, no el de las 23:59 CR). */
function mapaDePremios(premios: PremioRankingDTO[]): Map<number, PremioCongelado> {
  return new Map(premios.map((p) => [p.posicion, { monto: p.monto, descripcion: p.descripcion }]));
}
