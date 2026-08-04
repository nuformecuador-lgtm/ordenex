import type { PrismaClient } from "@prisma/client";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { ICajaCodFeedService } from "@/lib/interfaces/services/ICajaCodFeedService";
import type { ICajaPagoTiendaFeedService } from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";
import type { WalletMovimientoCategoria, WalletMovimientoTipo } from "@/lib/types/wallet";

// Feature 173 (design §6, `[P3]` = (a)) — REGISTRO RETROACTIVO de los datos ya escritos.
//
// La caja empieza a llevar el contra-entrega y el pago a las tiendas a partir de las tandas B y
// C. Todo lo anterior —cierres ya aprobados, pagos ya registrados, anulaciones ya hechas— no
// tiene su fila en la caja, asi que las dos cifras solo serian correctas de hoy en adelante.
// Esto lo arregla, y lo hace bajo tres reglas duras:
//
//  1. **SOLO INSERTA** (R42). Ni un `update`, ni un `delete`, ni un `upsert`. El libro es
//     append-only; una fila de dinero no se corrige, se compensa. Aqui ni siquiera hay que
//     compensar nada: lo que falta es la fila, no un valor equivocado.
//  2. **Las fechas salen del ORIGEN** (R41), nunca del reloj. Fechar con `now()` meteria dinero
//     de julio en el mes en que alguien corrio el script y descuadraria todo informe por rango,
//     en silencio y para siempre (el libro es inmutable).
//  3. **Nada se calcula por una via propia** (R36/R37/R38). Las filas las construyen los MISMOS
//     emisores del camino vivo —`ICajaCodFeedService` (Tanda B) y `ICajaPagoTiendaFeedService`
//     (Tanda C)—, de modo que categorias, claves de origen y montos no pueden divergir de lo
//     que la aplicacion escribe hoy. Si aqui hubiera una segunda formula, el dia que las dos
//     discreparan no habria forma de decir cual tiene razon.

/** Los tres modos del ejecutable. `simular` es el DEFECTO: escribir exige un flag explicito. */
export const MODOS_BACKFILL_CAJA = ["simular", "aplicar", "comprobar"] as const;
export type ModoBackfillCaja = (typeof MODOS_BACKFILL_CAJA)[number];

/** Los TRES origenes de `design.md §6.1`. Los pagos a MENSAJERO no estan, y es `[P2]` = (a). */
export const ORIGENES_BACKFILL_CAJA = [
  "cierre_aprobado",
  "pago_a_tienda",
  "anulacion_de_pago_a_tienda",
] as const;
export type OrigenBackfillCaja = (typeof ORIGENES_BACKFILL_CAJA)[number];

/**
 * Un documento existente al que le falta su fila en la caja.
 *
 * `movimiento` NO se construye aqui: es la fila TAL CUAL la emitiria el camino vivo, con su
 * `tipo`, su `categoria`, su clave de origen y su monto. Por eso este tipo no declara ninguna
 * categoria: el backfill no elige ninguna (R36/R37/R38).
 */
export interface FilaRetroactiva {
  readonly origen: OrigenBackfillCaja;
  /** El id del DOCUMENTO que la justifica —el cierre o el pago—. Es lo que `--comprobar` NOMBRA (R43). */
  readonly documentoId: string;
  readonly movimiento: CrearMovimientoInput;
}

/** R40 — «cuantas filas insertaria, de que categoria y por que monto total». */
export interface ResumenPorCategoria {
  readonly tipo: WalletMovimientoTipo;
  readonly categoria: WalletMovimientoCategoria;
  readonly filas: number;
  readonly montoTotal: string; // STRING escala 2 (money-safe)
}

export interface InformeBackfillCaja {
  readonly modo: ModoBackfillCaja;
  /**
   * Instante de la CORRIDA, en ISO. Es un METADATO del informe y el unico sitio de toda esta
   * feature donde el reloj aparece: ninguna fila se fecha con el (R41). Esta aqui a proposito,
   * para que el reloj este cableado de verdad y la prueba por mutacion «fechar con `now()`»
   * pueda ejecutarse sobre codigo vivo.
   */
  readonly instante: string;
  /** Cuantos documentos se miraron de cada origen. R43 exige recorrerlos TODOS. */
  readonly examinados: Readonly<Record<OrigenBackfillCaja, number>>;
  /** Los que no tienen su movimiento de caja, con su documento por su nombre (R43). */
  readonly pendientes: readonly FilaRetroactiva[];
  readonly porCategoria: readonly ResumenPorCategoria[];
  /** Filas realmente insertadas. **Siempre 0 fuera de `aplicar`** (R40/R42). */
  readonly insertadas: number;
  /**
   * R44 — describe el estado ENCONTRADO, no el que queda: `true` solo si al mirar no habia
   * ni un documento sin su movimiento de caja. Tras un `aplicar` que inserto algo sera `false`,
   * y eso es correcto: la comprobacion se vuelve a correr despues, y es ella la que cierra.
   */
  readonly alDia: boolean;
}

/**
 * Cliente de LECTURA de los tres origenes mas el libro de la caja.
 *
 * `walletTiendaMovimiento` esta porque lo exige `ICajaCodFeedService`, que es quien lee los
 * creditos de contra-entrega: el backfill no lo consulta por su cuenta ni lo escribe.
 */
export type CajaBackfillClient = Pick<
  PrismaClient,
  "cierreDia" | "liquidacionPago" | "liquidacionAnulacion" | "walletTiendaMovimiento" | "walletMovimiento"
>;

export interface CajaBackfillDeps {
  readonly cliente: CajaBackfillClient;
  /** Tanda B: construye la fila del contra-entrega de un cierre. Se REUSA, no se copia. */
  readonly codFeed: ICajaCodFeedService;
  /**
   * Tanda C: el puerto de la liquidacion, construido sobre el repositorio que se le pase.
   *
   * Es una FABRICA y no el puerto ya montado por un motivo: el backfill necesita las dos filas
   * del camino vivo **antes** de decidir si las escribe —la simulacion (R40) tiene que poder
   * decir la categoria y el monto sin tocar la base—, y el puerto solo sabe escribir. Se le da
   * un recolector, y las filas que el puerto «escribe» ahi son exactamente las que la
   * liquidacion escribiria en la caja. Cero copias de la categoria, del tipo y del origen.
   */
  readonly crearPuertoDePago: (repo: IWalletMovimientoRepository) => ICajaPagoTiendaFeedService;
  /** El UNICO escritor: `createMany({ skipDuplicates })`. No expone `update` ni `delete` (R47). */
  readonly cajaRepo: IWalletMovimientoRepository;
  /** Solo para fechar el INFORME. Ninguna fila se fecha con esto (R41). */
  readonly ahora: () => Date;
}

export interface ICajaBackfillTesoreriaService {
  /**
   * R36-R44 — recorre los tres origenes, descarta los que ya tienen su movimiento de caja y,
   * **solo en `aplicar`**, inserta lo que falta.
   *
   * Idempotente por partida doble (R39): el filtro de arriba evita mandar lo que ya existe, y
   * el `createMany({ skipDuplicates: true })` del repositorio de la 42 lo garantiza a nivel de
   * BASE contra el indice unico parcial `(origen_tipo, origen_id, categoria)`. La segunda de
   * dos corridas seguidas inserta 0 filas, y correrlo sobre datos que ya pasaron por el camino
   * vivo tampoco duplica: la clave de origen es la MISMA porque la fila es la misma.
   */
  ejecutar(modo: ModoBackfillCaja): Promise<InformeBackfillCaja>;
}
