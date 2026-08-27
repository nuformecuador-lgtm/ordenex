import type { PrismaClient } from "@prisma/client";

// Feature 293 (T4.1, design §7 y §7.1) — EL PUERTO ESTRECHO de la caja principal para el premio
// del ranking, calcado del de la 173 (`ICajaPagoTiendaFeedService`) y por el mismo motivo:
//
// `IWalletMovimientoRepository` sabe escribir CUALQUIER categoria de la caja. Inyectarlo en
// `PremioRankingDevengoService` cambiaria una imposibilidad estructural por una promesa de buena
// conducta. Este puerto tiene DOS metodos y ninguno mas, y **no expone ni el tipo, ni la
// categoria, ni el origen** —los fija su implementador con literales—, asi que el servicio del
// premio no puede EXPRESAR una escritura en la caja que no sea el egreso del premio o su reverso.
// No es «no la llama»: es que no existe el metodo.

/**
 * Cliente de transaccion que necesita el puerto: el LIBRO DE LA CAJA, y nada mas.
 *
 * Que el `Pick` sea de UNA sola tabla no es cosmetico (criterio de `CajaPagoTiendaTxClient`): con
 * este tipo el puerto **no puede** tocar el libro del mensajero ni el ledger por tienda aunque
 * alguien lo intentara, y lo impide el compilador antes que cualquier test.
 */
export type CajaPremioRankingTxClient = Pick<PrismaClient, "walletMovimiento">;

/**
 * Lo que el puerto necesita saber del premio para llevarlo a la caja. **No lleva `tipo`, ni
 * `categoria`, ni `origenTipo`**, y esa ausencia es el requisito (R20).
 *
 * `filaId` es el id de la FILA DEL PODIO (`ranking_snapshot_fila.id`) y es la mitad de la clave de
 * idempotencia de las dos filas de caja. **No es el cierre**, y no es preferencia (design §3.4): el
 * unico de la caja es `(origen_tipo, origen_id, categoria)` SIN mensajero, y el feed del cierre ya
 * escribio `(cierre_dia, cierreId, egreso_pago_mensajero)` al aprobar; reusar esa clave haria que
 * el egreso del premio cayera en `ON CONFLICT DO NOTHING` — dinero fuera de la caja sin registro y
 * sin error.
 *
 * `monto` es STRING (money-safe) y es EL MISMO string congelado que va al libro del mensajero:
 * libro y caja no pueden discrepar por un redondeo.
 */
export interface MovimientoDeCajaDePremio {
  /** `ranking_snapshot_fila.id` — la fila del podio de la que nace el premio. */
  filaId: string;
  /** STRING escala 2. Nunca `number`. */
  monto: string;
  descripcion: string | null;
  registradoPor: string;
}

export interface ICajaPremioRankingFeedService {
  /**
   * R20 — el dinero SALE: `egreso` / `egreso_pago_mensajero` por el monto congelado del premio,
   * con origen `(ranking_snapshot_fila, filaId)`.
   *
   * Se reusa `egreso_pago_mensajero` —y no se crea una categoria de caja nueva— porque
   * `NATURALEZA_POR_CATEGORIA` ya la declara `propio` y el premio ES dinero propio de Ordenex que
   * se entrega a un mensajero: la clasificacion de la caja no cambia ni una linea, y
   * `lib/utils/finanzas-diarias.ts` lo suma en «pago a mensajeros del dia» sin tocarla.
   *
   * **No se pasa `fechaMovimiento`** (R23): la columna cae en su `DEFAULT CURRENT_TIMESTAMP`, es
   * decir el INSTANTE DEL REGISTRO. Fechar el egreso en el dia del podio reescribiria el dinero de
   * un dia ya leido, porque la caja se agrega POR DIA (design §11-G).
   *
   * Escribe en la `tx` que se le pasa (R20: la misma transaccion que escribe el devengo; si esto
   * falla, no queda la fila del libro). Devuelve cuantas filas se insertaron: **0 es la respuesta
   * correcta** al reintento del mismo premio, no un fallo — la barrera es el indice unico parcial
   * de la caja, no un `if`.
   */
  emitirEgresoPremio(
    tx: CajaPremioRankingTxClient,
    movimiento: MovimientoDeCajaDePremio,
  ): Promise<number>;
  /**
   * R29 — el dinero VUELVE: `ingreso` / `ingreso_ajuste` por el mismo monto, con el MISMO origen
   * `(ranking_snapshot_fila, filaId)` y otra categoria, de modo que las dos filas conviven y
   * ninguna puede duplicarse.
   *
   * **`ingreso_ajuste` y NO un `ingreso_reverso_*` nuevo**, y la diferencia con la 173 esta
   * medida: alli el reverso necesitaba categoria propia porque el egreso original era de TERCEROS
   * y devolverlo con `ingreso_ajuste` —de naturaleza `propio`— habria inflado la ganancia de
   * Ordenex con dinero ajeno. Aqui el egreso original (`egreso_pago_mensajero`) YA era propio, asi
   * que revertirlo con `ingreso_ajuste` deja la ganancia exactamente como estaba y no hace falta
   * ningun valor de enum nuevo.
   */
  reversarEgresoPremio(
    tx: CajaPremioRankingTxClient,
    movimiento: MovimientoDeCajaDePremio,
  ): Promise<number>;
}
