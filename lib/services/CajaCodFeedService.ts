import { Prisma } from "@prisma/client";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaCodFeedTxClient,
  ICajaCodFeedService,
} from "@/lib/interfaces/services/ICajaCodFeedService";

/**
 * Feature 173 (design §3.1, R11/R12/R13/R17) — construye el INGRESO de contra-entrega de un
 * cierre aprobado: el dinero de las tiendas que entra en la caja principal de Ordenex.
 *
 * Corre DENTRO de la transaccion de aprobacion (misma `tx` que los feeds 42/43/44/158) y
 * DESPUES de que el ledger por tienda (43) haya escrito sus creditos. NO persiste: devuelve
 * las filas y el repositorio de la 42 las inserta idempotentemente.
 *
 * **Por que lee el LEDGER y no las gestiones.** El importe que entra en la caja tiene que ser,
 * por construccion, el MISMO que se le acredito a las tiendas (R12). Recalcularlo desde
 * `gestion_orden.montoRecibido` crearia dos formulas para el mismo dinero: el dia que
 * divergieran, la caja diria una cosa y el saldo de la tienda otra, y ningun test lo notaria.
 * Es el patron literal de `WalletIndemnizacionFeedService`, que lee de la base lo que el bloque
 * anterior de la misma `tx` escribio.
 *
 * Money-safe: `Prisma.Decimal` de punta a punta, salida STRING escala 2. Nunca `number`,
 * nunca `parseFloat`.
 */
export class CajaCodFeedService implements ICajaCodFeedService {
  async construirIngresoCod(
    cierreId: string,
    tx: CajaCodFeedTxClient,
  ): Promise<CrearMovimientoInput[]> {
    // R12: los creditos de contra-entrega de ESE cierre. Las cuatro claves del WHERE son
    // necesarias y ninguna sobra:
    //  - `origenTipo`/`origenId`: el cierre, y no otro (sin ellas se sumaria el COD de todos).
    //  - `categoria`: `cod_recaudado` y ninguna de las otras nueve del ledger.
    //  - `tipo`: `credito`; los debitos del mismo cierre (flete, comision, IVA) son lo que
    //    Ordenex SE QUEDA, no lo que recaudo a nombre de la tienda.
    const creditos = await tx.walletTiendaMovimiento.findMany({
      where: {
        origenTipo: "cierre_dia",
        origenId: cierreId,
        categoria: "cod_recaudado",
        tipo: "credito",
      },
      select: { monto: true },
    });

    let total = new Prisma.Decimal(0);
    for (const c of creditos) total = total.plus(c.monto);

    // R13: un cierre sin contra-entrega NO emite fila — ni una en 0.00. Mismo criterio que el
    // feed de ingresos de la 42 (omite conceptos en 0.00), que la 44 con P = 0 y que la 158
    // con un cierre sin incidentes. Una fila en 0.00 seria ruido en el libro y en la descarga.
    if (!total.gt(0)) return [];

    // R14/R48: `origen_tipo = cierre_dia` + `origen_id = cierreId` + `categoria` -> el indice
    // unico parcial `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL` de la 42
    // da la idempotencia A NIVEL DE BASE: re-aprobar el cierre no emite un segundo ingreso.
    //
    // `registradoPor` va `null` como en todos los movimientos automaticos; la autoria humana
    // queda en `cierre_dia.resuelto_por`/`resuelto_at` (38/R14).
    //
    // R17: sin `fechaMovimiento` A PROPOSITO -> `DEFAULT CURRENT_TIMESTAMP`, el mismo instante
    // que los demas movimientos de caja de esta aprobacion.
    return [
      {
        tipo: "ingreso",
        categoria: "ingreso_cod_recaudado",
        monto: total.toFixed(2),
        origenTipo: "cierre_dia",
        origenId: cierreId,
        descripcion: null,
        registradoPor: null,
      },
    ];
  }
}
