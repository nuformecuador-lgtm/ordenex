import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 17 — contrato del servicio de "Generar guia" / asignacion de
// mensajero. Logica de negocio pura (sin HTTP, sin Prisma); el borde (Server
// Action, `lib/actions/ordenes-guia.ts`) la traduce a resultado tipado.

// R24/decision 5: decision FINAL por orden en una sola llamada; `mensajeroId:
// null` significa "sin mensajero" (destino en_bodega_central, R23).
export interface GenerarGuiaDecision {
  ordenId: string;
  mensajeroId: string | null;
}

export interface GenerarGuiaInput {
  decisiones: GenerarGuiaDecision[];
}

// R26: un solo mensajero para el lote completo (asignacion desde bodega).
export interface AsignarBodegaInput {
  ordenIds: string[];
  mensajeroId: string;
}

export interface GenerarGuiaResultadoItem {
  ordenId: string;
  numGuia: number;
  estado: string;
}

export interface AsignarBodegaResultadoItem {
  ordenId: string;
  estado: string;
}

// Feature 30/R13 — ruteo dedicado de ordenes no-GAM a la bodega satelite.
export interface RutearSateliteInput {
  ordenIds: string[];
}

export interface RutearSateliteResultadoItem {
  ordenId: string;
  estado: string; // siempre "en_ruta_bodega_satelite"
}

// R29: motivo por orden cuando el lote se rechaza (orden inexistente, borrada,
// estado de origen no permitido). El servicio ABORTA sin efectos (R25).
export interface DetalleConflicto {
  ordenId: string;
  motivo: string;
}

export type GenerarGuiaServiceResult =
  | { status: "ok"; resultados: GenerarGuiaResultadoItem[] }
  | { status: "forbidden" } // R11-R13
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R28, catalogo incompleto
  | { status: "conflict"; detalle: DetalleConflicto[] }; // R27/R29

export type AsignarBodegaServiceResult =
  | { status: "ok"; resultados: AsignarBodegaResultadoItem[] }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };

// Feature 30/R13/R16/R17: resultado del ruteo a satelite. `validation_error`
// cubre la guardia R4 (zona GAM no configurada) y catalogo incompleto; `conflict`
// cubre origen invalido / borrada / orden GAM (no se rutea a satelite).
export type RutearSateliteServiceResult =
  | { status: "ok"; resultados: RutearSateliteResultadoItem[] }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };

export interface IGuiaAsignacionService {
  /**
   * R18-R25/R27-R29: asigna num_guia (idempotente, R5) a TODAS las ordenes del
   * lote elegibles (origen en_fulfillment | en_preparacion) y transiciona cada
   * una a por_recoger (con mensajero) o en_bodega_central (sin mensajero),
   * transaccional (todo-o-nada). Solo `maestro`.
   */
  generarGuia(input: GenerarGuiaInput, actor: Actor): Promise<GenerarGuiaServiceResult>;
  /**
   * R26-R29: asigna mensajero a ordenes en en_bodega_central (origen unico permitido),
   * pasan a por_recoger; NUNCA toca num_guia (ya asignado). Solo `maestro`.
   */
  asignarDesdeBodega(
    input: AsignarBodegaInput,
    actor: Actor,
  ): Promise<AsignarBodegaServiceResult>;
  /**
   * Feature 30/R13/R16/R17: rutea una o varias ordenes no-GAM a
   * `en_ruta_bodega_satelite` desde los origenes permitidos (`en_fulfillment`,
   * `en_preparacion`, `en_bodega_central`), asignando `num_guia` (R10) y dejando el
   * mensajero en NULL (R9). Guardia R4 (zona GAM configurada). Una orden GAM en
   * el lote -> `conflict` ("orden GAM no se rutea a satelite"). Solo `maestro`.
   */
  rutearABodegaSatelite(
    input: RutearSateliteInput,
    actor: Actor,
  ): Promise<RutearSateliteServiceResult>;
}
