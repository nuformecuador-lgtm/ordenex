import { Prisma } from "@prisma/client";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import { pagoPorResultado } from "@/lib/utils/pago-mensajero";
import { ingresoBodegaPorResultado } from "@/lib/utils/ingreso-bodega";

// Feature 41 (R4/R8) — helpers de SNAPSHOT del cierre extraídos de `CierreDiaService`
// (features 37/39/56) a un util reusable, SIN alterar la aritmética `Prisma.Decimal`
// (money-critical). Los consumen `solicitarCierre` (congela el snapshot del cierre
// `solicitado`) y `CorteDiarioService` (congela el snapshot del cierre `vencido`): un
// `vencido` es indistinguible de un `solicitado` en cuanto a totales; solo cambia el
// estado y el actor (el job vs el mensajero). NUNCA number/parseFloat sobre montos.

// Feature 39/R10-R13: pago al mensajero por gestión (DERIVADO/snapshot según uso) +
// total, con la tarifa ya resuelta. Solo `entregada` paga `cobroEntregado`; el resto
// 0.00 (F1.4). Suma money-safe con Prisma.Decimal (R9). Separado del dinero recibido (R21).
export function derivarPagos(
  gestiones: CierreGestionPendienteRow[],
  tarifa: PagoTarifa | null,
): { pagoByGestionId: Record<string, string>; total: string } {
  const pagoByGestionId: Record<string, string> = {};
  let total = new Prisma.Decimal(0);
  for (const g of gestiones) {
    const pago = pagoPorResultado(g.resultado, tarifa);
    pagoByGestionId[g.gestionId] = pago;
    total = total.plus(pago);
  }
  return { pagoByGestionId, total: total.toFixed(2) };
}

// Feature 56/R9-R12: ingreso de BODEGA por rechazo por gestión (DERIVADO/snapshot
// según uso) + total, con la MISMA tarifa ya resuelta para el pago. ESPEJO de
// `derivarPagos`: solo `rechazada` con tarifa que aplica genera ingreso; el resto 0.00.
// Suma money-safe con Prisma.Decimal (R7). Independiente del pago al mensajero (R7b) y
// del dinero recibido (R20).
export function derivarIngresoBodega(
  gestiones: CierreGestionPendienteRow[],
  tarifa: PagoTarifa | null,
): { ingresoByGestionId: Record<string, string>; total: string } {
  const ingresoByGestionId: Record<string, string> = {};
  let total = new Prisma.Decimal(0);
  for (const g of gestiones) {
    const ingreso = ingresoBodegaPorResultado(g.resultado, tarifa);
    ingresoByGestionId[g.gestionId] = ingreso;
    total = total.plus(ingreso);
  }
  return { ingresoByGestionId, total: total.toFixed(2) };
}

// R7/R8/R9: suma con Prisma.Decimal (exacto). Solo `entregada` aporta;
// reprogramada/devuelta/rechazada cuentan $0 (R8). Serializa a STRING (R9).
//
// Feature 208 (R24-R28/R30): la fuente del reparto por metodo son las LINEAS del desglose
// (`g.pagos`), no el par escalar `montoRecibido`/`metodoPago`. Cada linea cae en el balde de
// SU metodo, asi que una entrega cobrada 5.000 en efectivo + 3.000 por transferencia aporta
// 5.000 a `efectivo` y 3.000 a `transferencia`, y no 8.000 a un solo balde.
//
// Esto NO es cosmetica: `cierre_dia.total_efectivo` es la `E` del `min(P, E)` del pago al
// mensajero (feature 44). Sumar de mas aqui no produce un numero feo en pantalla — le paga de
// mas o de menos a una persona. Por eso el reparto se prueba con mutaciones
// (`tests/unit/utils/cierre-totales-pagos.test.ts`) y no con un test de humo.
//
// Una gestion `entregada` SIN lineas no aporta a ningun balde (R26), que es el equivalente
// exacto del `default: break` defensivo que tenia el switch escalar para una entrega sin
// metodo. Y no hay fallback al par escalar (design §3.1): si una proyeccion se olvidara del
// desglose, el total sale CERO —ruidoso— en vez de plausible.
export function computeTotales(gestiones: CierreGestionPendienteRow[]): CierreTotales {
  let efectivo = new Prisma.Decimal(0);
  let simpe = new Prisma.Decimal(0);
  let transferencia = new Prisma.Decimal(0);
  for (const g of gestiones) {
    if (g.resultado !== "entregada") continue; // R8/R25
    for (const p of g.pagos) {
      const monto = new Prisma.Decimal(p.monto);
      switch (p.metodo) {
        case "efectivo":
          efectivo = efectivo.plus(monto);
          break;
        case "SINPE":
          simpe = simpe.plus(monto);
          break;
        case "transferencia":
          transferencia = transferencia.plus(monto);
          break;
      }
    }
  }
  const general = efectivo.plus(simpe).plus(transferencia);
  return {
    efectivo: efectivo.toFixed(2),
    simpe: simpe.toFixed(2),
    transferencia: transferencia.toFixed(2),
    general: general.toFixed(2),
  };
}
