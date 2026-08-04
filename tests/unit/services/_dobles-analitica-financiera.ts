import { vi } from "vitest";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { AgregadoCategoriaCaja } from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import type {
  AgregadoTiendaLedger,
  TotalPorMetodoCierre,
} from "@/lib/interfaces/repositories/IRecaudoAnaliticaRepository";
import type {
  CuentaMensajeroAlCorte,
  SaldoTiendaAlCorte,
} from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";
import type {
  GrupoCierrePorEstado,
  SnapshotCierreAprobado,
  TotalLedgerPorOrigenCierre,
} from "@/lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository";
import { AnaliticaFinancieraService } from "@/lib/services/AnaliticaFinancieraService";
import type {
  ImporteAnalitico,
  ImporteConNeto,
  ImporteSoloBruto,
} from "@/lib/types/analitica-financiera";

// Feature 127 / TANDA D — DOBLES DE LOS CUATRO REPOSITORIOS (R31).
//
// El servicio se construye con interfaces, asi que su suite entera corre SIN base de datos y sin
// `DATABASE_URL`. Estos dobles no son la base falsa de la TANDA C (`_fake-prisma-dinero.ts`, que
// ejecuta `where`/`groupBy` de verdad y sigue siendo la que juzga a los repositorios): aqui la
// frontera que se prueba es OTRA —lo que el servicio hace con lo que el repositorio le entrega—,
// y por eso el doble devuelve filas fijas y REGISTRA cada llamada.
//
// Registrar las llamadas no es adorno: R5 y R10 exigen que ante un dominio invalido NO se
// consulte nada, y eso solo se puede afirmar mirando el espia, no el resultado.

export interface DatosFinancieros {
  readonly caja: readonly AgregadoCategoriaCaja[];
  readonly porMetodo: readonly TotalPorMetodoCierre[];
  readonly porTienda: readonly AgregadoTiendaLedger[];
  readonly saldoTiendas: readonly SaldoTiendaAlCorte[];
  readonly cuentaMensajeros: readonly CuentaMensajeroAlCorte[];
  readonly porEstado: readonly GrupoCierrePorEstado[];
  readonly snapshots: readonly SnapshotCierreAprobado[];
  readonly ledger: readonly TotalLedgerPorOrigenCierre[];
}

const VACIO: DatosFinancieros = {
  caja: [],
  porMetodo: [],
  porTienda: [],
  saldoTiendas: [],
  cuentaMensajeros: [],
  porEstado: [],
  snapshots: [],
  ledger: [],
};

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };

/** `now` fijo: el determinismo del DTO no puede depender del reloj (R28). */
export const AHORA = new Date("2026-08-02T15:00:00.000Z");

export function consultaDe(metricaId: string, raw: unknown = { rango: "dia" }): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(raw, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/* -------------------------------------------------------------------------- */
/* Feature 183 — leer un importe de la union discriminada, SIN apagar la union  */
/* -------------------------------------------------------------------------- */
//
// Desde ⟨D12⟩ (2026-08-04) `ImporteAnalitico` es `ImporteConNeto | ImporteSoloBruto` y `.neto`
// no se puede leer sin estrechar por `forma`. Un `as ImporteConNeto` en cada caso apagaria justo
// la comprobacion que la union existe para dar. Estos dos helpers NO apagan nada: AFIRMAN la
// forma antes de devolver, asi que si una metrica cambiara de forma sin querer, el caso que la
// lee se pone rojo con un mensaje que dice cual y cual llego.

/** El importe estrechado a `bruto_y_neto`, o un fallo con nombre. */
export function conNeto(importe: ImporteAnalitico, contexto = "el importe"): ImporteConNeto {
  if (importe.forma !== "bruto_y_neto") {
    throw new Error(`${contexto}: se esperaba forma "bruto_y_neto" y llego "${importe.forma}"`);
  }
  return importe;
}

/** El importe estrechado a `solo_bruto`, o un fallo con nombre. */
export function soloBruto(importe: ImporteAnalitico, contexto = "el importe"): ImporteSoloBruto {
  if (importe.forma !== "solo_bruto") {
    throw new Error(`${contexto}: se esperaba forma "solo_bruto" y llego "${importe.forma}"`);
  }
  return importe;
}

export function armarServicio(datos: Partial<DatosFinancieros> = {}, umbral?: string) {
  const d = { ...VACIO, ...datos };

  const ingresos = { sumarPorCategoria: vi.fn(async () => d.caja) };
  const recaudo = {
    porMetodoDeCierresResueltos: vi.fn(async () => d.porMetodo),
    porTiendaDeLedger: vi.fn(async () => d.porTienda),
  };
  const cuentasPorPagar = {
    saldoPorTiendaAlCorte: vi.fn(async () => d.saldoTiendas),
    cuentaPorPagarMensajerosAlCorte: vi.fn(async () => d.cuentaMensajeros),
  };
  const conciliacion = {
    contarCierresPorEstado: vi.fn(async () => d.porEstado),
    totalesDeCierresAprobados: vi.fn(async () => d.snapshots),
    sumarLedgerPorOrigenDeCierre: vi.fn(async () => d.ledger),
  };
  const logger: ErrorLogger = { logError: vi.fn() };

  const espias = [
    ingresos.sumarPorCategoria,
    recaudo.porMetodoDeCierresResueltos,
    recaudo.porTiendaDeLedger,
    cuentasPorPagar.saldoPorTiendaAlCorte,
    cuentasPorPagar.cuentaPorPagarMensajerosAlCorte,
    conciliacion.contarCierresPorEstado,
    conciliacion.totalesDeCierresAprobados,
    conciliacion.sumarLedgerPorOrigenDeCierre,
  ];

  const servicio =
    umbral === undefined
      ? new AnaliticaFinancieraService(ingresos, recaudo, cuentasPorPagar, conciliacion, logger)
      : new AnaliticaFinancieraService(
          ingresos,
          recaudo,
          cuentasPorPagar,
          conciliacion,
          logger,
          umbral,
        );

  return {
    servicio,
    ingresos,
    recaudo,
    cuentasPorPagar,
    conciliacion,
    logger,
    /** Cuantas veces se le pregunto ALGO a CUALQUIER repositorio. */
    consultasHechas: () => espias.reduce((n, e) => n + e.mock.calls.length, 0),
  };
}
