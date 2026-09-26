import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreDeCuentaOpcionDTO,
  CierresDeLaCuentaInput,
  ConceptoConMovimientosDTO,
  ConceptosConMovimientosInput,
} from "@/lib/types/wallet-filtros";

export type ConceptosConMovimientosServiceResult =
  | { status: "ok"; conceptos: ConceptoConMovimientosDTO[] }
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
}
