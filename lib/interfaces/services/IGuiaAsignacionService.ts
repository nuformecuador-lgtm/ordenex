import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 17 — contrato del servicio de "Generar guia" / asignacion de
// mensajero. Logica de negocio pura (sin HTTP, sin Prisma); el borde (Server
// Action, `lib/actions/ordenes-guia.ts`) la traduce a resultado tipado.

// R24/decision 5: decision FINAL por orden en una sola llamada; `mensajeroId:
// null` significa "sin mensajero" (destino en_bodega, R23).
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

export interface IGuiaAsignacionService {
  /**
   * R18-R25/R27-R29: asigna num_guia (idempotente, R5) a TODAS las ordenes del
   * lote elegibles (origen en_fulfillment | en_preparacion) y transiciona cada
   * una a en_espera_aceptacion (con mensajero) o en_bodega (sin mensajero),
   * transaccional (todo-o-nada). Solo `maestro`.
   */
  generarGuia(input: GenerarGuiaInput, actor: Actor): Promise<GenerarGuiaServiceResult>;
  /**
   * R26-R29: asigna mensajero a ordenes en en_bodega (origen unico permitido),
   * pasan a en_espera_aceptacion; NUNCA toca num_guia (ya asignado). Solo `maestro`.
   */
  asignarDesdeBodega(
    input: AsignarBodegaInput,
    actor: Actor,
  ): Promise<AsignarBodegaServiceResult>;
}
