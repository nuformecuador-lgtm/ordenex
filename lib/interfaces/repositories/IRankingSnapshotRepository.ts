// Feature 196 (design §4.2) — contrato del repositorio del SNAPSHOT del ranking. SOLO
// queries Prisma; cero logica de negocio: quien decide que mensajero entra, en que orden y
// con que premio es `RankingSnapshotService`. Aqui solo se escribe lo que llega y se lee lo
// que hay.
//
// Money-safe (R31): el `premioMonto` entra y sale como STRING de escala 2. Ningun
// `Prisma.Decimal` cruza esta frontera, ni hacia el service ni hacia el cliente.

import type { PrismaClient } from "@prisma/client";

/**
 * FICHA 362 (R9) — el cliente que acepta `registrarAccionSobreFila`: SOLO lo que hace falta para
 * leer la fila del podio y escribir la fila del registro. Recortado a proposito: quien lo recibe
 * no puede tocar nada mas.
 */
export type RankingSnapshotAccionTxClient = Pick<
  PrismaClient,
  "rankingSnapshotFila" | "historialAccion" | "usuario"
>;

/** Una fila del snapshot tal como el service la deja lista para persistir. */
export interface FilaSnapshotInput {
  /** 1..N, contiguo. Las filas llegan YA ORDENADAS por este campo. */
  puesto: number;
  /** 1|2|3 si ocupo podio; `null` si no (R6/R9). */
  posicion: number | null;
  mensajeroId: string;
  /** Nombre CONGELADO (R16): el de la corrida, no el actual. */
  mensajeroNombre: string;
  entregadas: number;
  asignadas: number;
  /** STRING escala 2 o `null`. Solo puede ser no nulo si `posicion !== null` (R8, CHECK). */
  premioMonto: string | null;
  premioDescripcion: string | null;
}

export interface CrearSnapshotInput {
  /** Medianoche UTC de la fecha calendario CR (convencion `@db.Date`, `fechaComoDate`). */
  fecha: Date;
  /** Umbral APLICADO en esta corrida; se congela con la cabecera (R1). */
  minAsignadasPodio: number;
  /** Ya ordenadas por `puesto`. Vacio = dia sin actividad -> cabecera con `filas = 0` (R11). */
  filas: FilaSnapshotInput[];
}

export interface CrearSnapshotResult {
  /** `false` = la fecha YA estaba congelada y no se escribio nada (R12). No es un error. */
  creado: boolean;
  /** Filas del snapshot que quedo en la base: las recien escritas, o las que ya habia. */
  filas: number;
}

/** Fila congelada tal como sale de la base (premio ya serializado a STRING). */
export interface SnapshotFilaRow {
  puesto: number;
  posicion: number | null;
  mensajeroId: string;
  mensajeroNombre: string;
  entregadas: number;
  asignadas: number;
  premioMonto: string | null;
  premioDescripcion: string | null;
}

/** Cabecera congelada con sus filas en el ORDEN CONGELADO (`puesto` asc, R25). */
export interface SnapshotDiaRow {
  fecha: Date;
  generadoAt: Date;
  minAsignadasPodio: number;
  filas: SnapshotFilaRow[];
}

/**
 * Feature 293 (T3.1, R4) — una fila del PODIO congelado de una fecha, con lo justo para la
 * pantalla de premios y para el registro. Es un tipo PROPIO y no `SnapshotFilaRow`: aquel
 * alimenta el DTO del historico, cuyo contrato declara que viaja al cliente
 * (`lib/types/ranking-snapshot.ts`), y el `filaId` no viaja ahi.
 *
 * `filaId` es la clave del `ranking_snapshot_fila`, y es lo UNICO que el cliente manda al
 * registrar (R16): mensajero, fecha, posicion y monto los resuelve el servidor desde aqui.
 */
export interface PodioFilaRow {
  filaId: string;
  /** 1 | 2 | 3. Las filas sin podio no salen de este metodo. */
  posicion: number;
  mensajeroId: string;
  /** Nombre CONGELADO (R4): el de la corrida, no el actual. */
  mensajeroNombre: string;
  entregadas: number;
  asignadas: number;
  /** STRING escala 2 o `null` (sin premio). NUNCA el premio VIGENTE (R15). */
  premioMonto: string | null;
  premioDescripcion: string | null;
}

export interface IRankingSnapshotRepository {
  /**
   * R14 — escribe cabecera + filas en UNA transaccion: todo o nada. Un fallo a mitad deja la
   * fecha SIN cabecera y SIN filas; no existe el snapshot parcial.
   *
   * R12 — si la fecha ya estaba congelada, la colision del UNIQUE de `fecha` (P2002) se
   * traduce a `{ creado: false }` SIN propagar: la reejecucion (reintento de Vercel o
   * invocacion manual) es el camino ESPERADO, no un error, y no debe disparar un 500 ni
   * reescribir en silencio lo que quiza ya se comunico y se pago. Cualquier otro P2002 —el
   * de `(snapshot_id, puesto)`, por ejemplo— SI se propaga: ese si seria un defecto.
   */
  crearSnapshot(input: CrearSnapshotInput): Promise<CrearSnapshotResult>;
  /**
   * R25/R26 — la cabecera de la fecha con TODAS sus filas ordenadas por `puesto` asc, o
   * `null` si esa fecha no tiene cabecera («el cron no corrio»). Una cabecera con `filas`
   * vacio es un resultado distinto y legitimo («ese dia no hubo actividad»).
   */
  obtenerPorFecha(fecha: Date): Promise<SnapshotDiaRow | null>;
  /**
   * Feature 293 (T3.1, R4/R6) — las filas del PODIO (`posicion` 1, 2 o 3) de esa fecha, en orden
   * de posicion ascendente, tal como se congelaron.
   *
   * `null` = esa fecha NO tiene snapshot (R6: «ese dia no tiene ranking congelado»), que es
   * distinto de `[]` = la fecha esta congelada pero nadie ocupo podio. Las dos cosas se dicen en
   * pantalla con textos distintos, asi que el repositorio no puede colapsarlas.
   */
  listarPodioDeFecha(fecha: Date): Promise<PodioFilaRow[] | null>;
  /**
   * Feature 293 (T3.1, R16) — UNA fila del podio por su id, con la FECHA de su snapshot.
   *
   * Es la lectura que sostiene R16: la peticion del cliente solo dice CUAL fila se registra, y
   * todo lo demas —mensajero, fecha del podio, posicion y monto CONGELADO— sale de aqui. Ningun
   * dato del cliente puede influir en lo que se escribe.
   *
   * `null` = ese id no existe, o existe pero no ocupo podio (`posicion IS NULL`): una fila sin
   * podio no tiene premio que registrar y no se distingue de una inexistente a efectos de esta
   * feature.
   */
  obtenerFilaDelPodio(filaId: string): Promise<PodioFilaConFecha | null>;
  /**
   * FICHA 362 (R6/R9) — registra `premio_ranking_registrado` / `premio_ranking_anulado` sobre la
   * fila del podio, DENTRO de la `tx` que ya abre `PremioRankingDevengoService`.
   *
   * NO muta `ranking_snapshot_fila` —el snapshot es historia congelada y no se reescribe—: la
   * mutacion que documenta son el devengo y el egreso de caja que el servicio acaba de escribir
   * en esa misma transaccion. Por eso recibe `tx` y no puede abrir la suya (R10/R11).
   */
  registrarAccionSobreFila(
    tx: RankingSnapshotAccionTxClient,
    input: {
      filaId: string;
      accion: "premio_ranking_registrado" | "premio_ranking_anulado";
      monto: string;
      actorUsuarioId: string | null;
    },
  ): Promise<void>;
}

/** La fila del podio mas la fecha calendario de su snapshot (`@db.Date`, medianoche UTC). */
export interface PodioFilaConFecha extends PodioFilaRow {
  /** Fecha del snapshot tal como esta en la columna: medianoche UTC del dia calendario CR. */
  fecha: Date;
}
