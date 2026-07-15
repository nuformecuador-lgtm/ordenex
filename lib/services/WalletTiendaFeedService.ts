import { Prisma } from "@prisma/client";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  IWalletTiendaFeedService,
  WalletTiendaFeedTxClient,
} from "@/lib/interfaces/services/IWalletTiendaFeedService";
import { walletTiendaConfig, type WalletTiendaConfig } from "@/lib/config/wallet-tienda";
import { detalleDe, leerDetallePorOrden, tarifaDe } from "@/lib/utils/cierre-detalle";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { conceptoIngresoADebitoTienda } from "@/lib/utils/mapeo-concepto-tienda";
import { WALLET_INGRESO_CONCEPTO_SEED, type WalletIngresoConcepto } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

// Las 2 categorias de devolucion de la 42 que el interruptor Q3 puede descartar del ledger
// de la tienda (R10/R28). NO tocan la 42.
const CONCEPTOS_DEVOLUCION: readonly WalletIngresoConcepto[] = [
  "ingreso_flete_devolucion",
  "ingreso_iva_flete_devolucion",
];

function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// Acumulador de un concepto agregado por (tienda, categoria).
interface Acumulado {
  tiendaId: string;
  tipo: "credito" | "debito";
  categoria: WalletTiendaMovimientoCategoria;
  total: Prisma.Decimal;
}

/**
 * Feature 43 (design §2.2) — construye los movimientos del LEDGER POR TIENDA de un cierre
 * aprobado. Corre DENTRO de la transaccion de aprobacion (misma `tx` que la 42, R7). NO
 * define formula nueva: REUTILIZA `derivarIngresoOrden` (42) para los debitos (los 6
 * conceptos que Ordenex se queda) y `montoRecibido` para el credito COD (Q2/R9). Agrega por
 * (tienda, concepto), OMITE totales 0.00 (R11) y aplica el interruptor Q3 en UN SOLO punto
 * (R28). Money-safe: Prisma.Decimal, salida STRING. NO persiste (lo hace el repo en la tx).
 *
 * Feature 69 (R13/R14) — deriva desde el SNAPSHOT (`cierre_detail`); NO lee `orden`, `zona`
 * ni `tarifas` VIVAS. Aqui el vector era aun peor que en la 42: se leia `orden.tienda_id`
 * vivo, o sea A QUIEN se le acredita/debita. Re-apuntar la orden a otra tienda entre
 * SOLICITAR y APROBAR movia el dinero de ledger. Ahora `tiendaId` viene CONGELADO.
 *
 * Dos cosas que a proposito NO se congelan:
 * - `montoRecibido` sigue saliendo de `gestion_orden`: es el COD realmente recaudado POR ESA
 *   GESTION (dato de la gestion, inmutable de facto), no un dato de la orden.
 * - El interruptor Q3 se sigue leyendo al aprobar: es POLITICA DE LA CASA, no un dato de la
 *   orden. Congelarlo seria congelar una decision de negocio, no un hecho.
 */
export class WalletTiendaFeedService implements IWalletTiendaFeedService {
  constructor(
    // Interruptor Q3 (R28): unico punto de lectura. Default = singleton de config del modulo;
    // se inyecta para poder verificar ambos estados del flag en test sin manipular env.
    private readonly config: WalletTiendaConfig = walletTiendaConfig,
  ) {}

  async construirMovimientosPorTienda(
    cierreId: string,
    tx: WalletTiendaFeedTxClient,
  ): Promise<CrearMovimientoTiendaInput[]> {
    // Feature 69/R13: el SNAPSHOT aporta lo de la ORDEN (congelado) y `gestion_orden` lo de
    // la GESTION: el `resultado` y el COD REALMENTE recaudado (`montoRecibido`). Money-safe:
    // los Decimal se leen como STRING/Decimal, nunca number.
    const [byOrden, gestiones] = await Promise.all([
      leerDetallePorOrden(cierreId, tx),
      tx.gestionOrden.findMany({
        where: { cierreId },
        select: { ordenId: true, resultado: true, montoRecibido: true },
      }),
    ]);

    // R28: se lee el interruptor UNA sola vez, aqui.
    const debitaFleteDevolucion = this.config.TIENDA_DEBITA_FLETE_DEVOLUCION;

    // Agrega por (tiendaId, categoria). El orden de insercion es determinista.
    const acc = new Map<string, Acumulado>();
    const bump = (
      tiendaId: string,
      tipo: "credito" | "debito",
      categoria: WalletTiendaMovimientoCategoria,
      aporte: Prisma.Decimal,
    ) => {
      const k = `${tiendaId}|${categoria}`;
      const prev = acc.get(k);
      if (prev) prev.total = prev.total.add(aporte);
      else acc.set(k, { tiendaId, tipo, categoria, total: aporte });
    };

    for (const g of gestiones) {
      // R14: sin fallback a datos vivos; si falta la fila congelada, la aprobacion ABORTA.
      const d = detalleDe(byOrden, cierreId, g.ordenId);
      // R13: A QUIEN se le acredita/debita sale del SNAPSHOT, no de la orden viva.
      const tiendaId = d.tiendaId;

      // CREDITO propio de la 43 (Q2/R9): COD REALMENTE recaudado; null -> 0.00. Sale de la
      // GESTION a proposito (no se congela): es lo que esa gestion recaudo de verdad.
      const codRecaudado = new Prisma.Decimal(
        g.montoRecibido === null ? "0" : g.montoRecibido.toFixed(2),
      );
      bump(tiendaId, "credito", "cod_recaudado", codRecaudado);

      // DEBITOS: identicos a la 42 (misma funcion), mapeados a categorias de debito. Ahora
      // desde las entradas CONGELADAS (R13) y la tarifa congelada (R9 preservado: `tarifa_id`
      // NULL -> null -> debitos 0.00, sin bloquear).
      const derivado = derivarIngresoOrden(
        {
          resultado: g.resultado,
          esCentral: d.esCentral,
          // La comision sigue basada en montoCobrar (decision de la 42, la 43 NO la altera).
          montoCobrar: d.montoCobrar === null ? null : d.montoCobrar.toFixed(2),
          cobraComision: d.cobraComision,
        },
        tarifaDe(d),
      );

      for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
        // R28/R10: interruptor Q3 — si esta en false, DESCARTA los 2 debitos de devolucion
        // del ledger de la tienda (sin tocar el credito COD, el resto de debitos ni la 42).
        if (!debitaFleteDevolucion && CONCEPTOS_DEVOLUCION.includes(concepto)) continue;
        const aporte = derivado[concepto];
        if (aporte === undefined) continue; // el concepto no aplica a esta gestion
        bump(tiendaId, "debito", conceptoIngresoADebitoTienda(concepto), aporte);
      }
    }

    // R11: 1 movimiento por (tienda, concepto), OMITIENDO los que quedan en 0.00.
    const out: CrearMovimientoTiendaInput[] = [];
    for (const a of acc.values()) {
      const total = round2(a.total);
      if (!total.gt(0)) continue;
      out.push({
        tiendaId: a.tiendaId,
        tipo: a.tipo,
        categoria: a.categoria,
        monto: total.toFixed(2),
        origenTipo: "cierre_dia",
        origenId: cierreId,
        descripcion: null,
        registradoPor: null,
      });
    }
    return out;
  }
}
