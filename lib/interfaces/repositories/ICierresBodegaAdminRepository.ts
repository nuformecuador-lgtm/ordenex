import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";

// Feature 40 — contrato del repositorio de "Cierres de bodega" del maestro (aprobar /
// rechazar). Solo queries Prisma; sin logica de negocio (esa vive en
// CierresBodegaAdminService). El maestro NO se acota por zona (todo va a la central).
// Money-safe: los Decimal se devuelven ya serializados a STRING. Reusa
// CierreGestionPendienteRow + WITH_DETALLE/toPendienteRow de la feature 37 para el
// detalle de gestiones.

// Cabecera de un cierre_dia incluido en un cierre de bodega (para el detalle): el
// mensajero + totales snapshot (STRING). El detalle deriva de sus gestiones.
export interface CierreBodegaDetalleCierreRow {
  cierreDiaId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  totales: CierreTotales; // snapshot del cierre_dia (STRING escala 2)
  totalPagoMensajero: string; // feature 39/R20: snapshot del pago al mensajero del cierre_dia (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R19: snapshot del ingreso de bodega por rechazos del cierre_dia (STRING)
}

// Datos de la transicion guardada (aprobar/rechazar) de un cierre de bodega.
// `motivoRechazo` = null al aprobar; el motivo (ya validado) al rechazar.
export interface ResolverCierreBodegaInput {
  id: string;
  nuevoEstado: "aprobado" | "rechazado";
  resueltoPor: string;
  motivoRechazo: string | null;
}

// Resultado de la transicion guardada: `updated` (aplicada), `conflict` (existe pero
// ya no esta `solicitado`, R18), `fuera_de_alcance` (no existe, R19).
export type ResolverCierreBodegaResult = "updated" | "conflict" | "fuera_de_alcance";

export interface ICierresBodegaAdminRepository {
  /**
   * R15: todos los cierres de bodega, join a zona/usuario para nombres +
   * _count.cierresDia, orderBy solicitadoAt desc. Totales snapshot -> STRING. Sin
   * filtro de zona (el maestro es global).
   */
  findCierresBodega(): Promise<CierreBodegaResumenRow[]>;
  /**
   * R11: el cierre de bodega (cabecera + totales snapshot) + por cada cierre_dia
   * incluido (WHERE cierre_bodega_id=id) su cabecera y sus gestiones (WITH_DETALLE,
   * reuso 37, WHERE cierre_id=cierre_dia.id). `null` si el cierre de bodega no existe
   * (R19).
   */
  findCierreBodegaConDetalle(id: string): Promise<{
    cierre: CierreBodegaResumenRow;
    cierresDia: {
      resumen: CierreBodegaDetalleCierreRow;
      gestiones: CierreGestionPendienteRow[];
    }[];
  } | null>;
  /**
   * R16-R22: transicion atomica y guardada de `solicitado` -> nuevoEstado, SOLO si el
   * cierre de bodega sigue `solicitado` (updateMany con guardia de estado). Un solo
   * UPDATE de estado + auditoria; NO toca cierre_dia ni otra tabla (R21/R22).
   * Distingue updated/conflict/fuera_de_alcance.
   */
  resolverCierreBodega(input: ResolverCierreBodegaInput): Promise<ResolverCierreBodegaResult>;
}
