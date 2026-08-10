// Feature 196 (design §4.2) — contrato del repositorio del SNAPSHOT del ranking. SOLO
// queries Prisma; cero logica de negocio: quien decide que mensajero entra, en que orden y
// con que premio es `RankingSnapshotService`. Aqui solo se escribe lo que llega y se lee lo
// que hay.
//
// Money-safe (R31): el `premioMonto` entra y sale como STRING de escala 2. Ningun
// `Prisma.Decimal` cruza esta frontera, ni hacia el service ni hacia el cliente.

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
}
