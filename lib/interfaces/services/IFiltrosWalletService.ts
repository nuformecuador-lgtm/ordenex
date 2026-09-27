import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreDeCuentaOpcionDTO,
  CierresDeLaCuentaInput,
  ConceptoConMovimientosDTO,
  ConceptosConMovimientosInput,
  QuienDelLibroCajaOpcionDTO,
  QuienesDelLibroCajaInput,
} from "@/lib/types/wallet-filtros";

export type ConceptosConMovimientosServiceResult =
  | { status: "ok"; conceptos: ConceptoConMovimientosDTO[] }
  | { status: "forbidden" };

export type QuienesDelLibroCajaServiceResult =
  | { status: "ok"; opciones: QuienDelLibroCajaOpcionDTO[]; hayMas: boolean }
  | { status: "forbidden" };

export type CierresDeLaCuentaServiceResult =
  | { status: "ok"; opciones: CierreDeCuentaOpcionDTO[]; hayMas: boolean }
  | { status: "forbidden" };

/** Ficha 458-A (TA.3/TA.4) — los filtros de la wallet. El rol se comprueba ANTES de leer. */
export interface IFiltrosWalletService {
  conceptosConMovimientos(
    input: ConceptosConMovimientosInput,
    actor: Actor,
  ): Promise<ConceptosConMovimientosServiceResult>;
  cierresDeLaCuenta(input: CierresDeLaCuentaInput, actor: Actor): Promise<CierresDeLaCuentaServiceResult>;
  /** Ficha 458-E (TE.2, R59) — las opciones del selector «A quién» del libro de la caja. */
  quienesDelLibroCaja(input: QuienesDelLibroCajaInput, actor: Actor): Promise<QuienesDelLibroCajaServiceResult>;
}
