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

// R7/R8/R9: suma con Prisma.Decimal (exacto). Solo `entregada` con montoRecibido
// aporta; reprogramada/devuelta/rechazada cuentan $0 (R8). Serializa a STRING (R9).
export function computeTotales(gestiones: CierreGestionPendienteRow[]): CierreTotales {
  let efectivo = new Prisma.Decimal(0);
  let simpe = new Prisma.Decimal(0);
  let transferencia = new Prisma.Decimal(0);
  for (const g of gestiones) {
    if (g.resultado !== "entregada" || g.montoRecibido === null) continue; // R8
    const monto = new Prisma.Decimal(g.montoRecibido);
    switch (g.metodoPago) {
      case "efectivo":
        efectivo = efectivo.plus(monto);
        break;
      case "SINPE":
        simpe = simpe.plus(monto);
        break;
      case "transferencia":
        transferencia = transferencia.plus(monto);
        break;
      default:
        break; // entregada sin metodo (dato inconsistente): no suma (defensivo)
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
