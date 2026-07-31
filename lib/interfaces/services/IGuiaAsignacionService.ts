import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 17 — contrato del servicio de "Generar guia" / asignacion de
// mensajero. Logica de negocio pura (sin HTTP, sin Prisma); el borde (Server
// Action, `lib/actions/ordenes-guia.ts`) la traduce a resultado tipado.

// Feature 156 (R1/R14): "Generar guia" deja de decidir mensajero. La entrada es un
// LOTE DE IDS, misma forma que `RutearSateliteInput`. El tipo `GenerarGuiaDecision`
// (`{ ordenId, mensajeroId }`) se RETIRO a proposito: un campo que el servidor
// tendria que ignorar o rechazar siempre es un contrato que miente sobre lo que la
// operacion hace (design.md §6, alternativa A descartada).
export interface GenerarGuiaInput {
  ordenIds: string[];
}

// R26: un solo mensajero para el lote completo (asignacion desde bodega).
export interface AsignarBodegaInput {
  ordenIds: string[];
  mensajeroId: string;
}

export interface GenerarGuiaResultadoItem {
  ordenId: string;
  numGuia: number;
  estado: string; // feature 156/R3: SIEMPRE "en_bodega_central" (destino unico)
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

// Feature 157/R3: un solo mensajero para el lote completo, mismo patron que
// `AsignarBodegaInput`. La orden NO cambia de estado (sigue en `por_recolectar_en_tienda`
// hasta que el mensajero la recolecte): esto solo dice QUIEN va a ir a la tienda.
export interface AsignarRecoleccionInput {
  ordenIds: string[];
  mensajeroId: string;
}

// Feature 157: mismo shape que `AsignarBodegaServiceResult` a proposito, para que el
// traductor de errores del modal (`guia-decision-error-messages.ts`) sirva sin cambios.
// El `resultados` no lleva `estado` porque no hay transicion que reportar (R4).
export type AsignarRecoleccionServiceResult =
  | { status: "ok"; resultados: { ordenId: string }[] }
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
   * Feature 156 (R1-R9) — NUMERAR ≠ ASIGNAR. Asigna `num_guia` (idempotente, R5) a
   * TODAS las ordenes del lote y las transiciona de `en_preparacion` (origen UNICO,
   * R4) a `en_bodega_central` (destino UNICO, R3), transaccional (todo-o-nada, R6).
   * NO escribe `mensajero_asignado_id` ni `asignado_at` (R2): la asignacion ocurre
   * despues y SIEMPRE desde una bodega (`asignarDesdeBodega` o
   * `AsignacionSateliteService`). Solo acceso total (`maestro`/`admin`).
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
   * Feature 30/R13/R16/R17 + feature 156/R15/R16: rutea una o varias ordenes no-GAM a
   * `en_ruta_bodega_satelite` desde `en_bodega_central`, que tras la 156 es el UNICO
   * origen admitido (antes eran tres: el paquete se rutea desde donde esta
   * fisicamente). Asigna `num_guia` (R10) y deja el mensajero
   * en NULL (R9). Guardia R4 (zona GAM configurada). Una orden GAM en el lote ->
   * `conflict` ("orden GAM no se rutea a satelite"). Solo acceso total.
   */
  rutearABodegaSatelite(
    input: RutearSateliteInput,
    actor: Actor,
  ): Promise<RutearSateliteServiceResult>;
  /**
   * Feature 157 (R3-R9): asigna el mensajero que ira a la tienda a RECOLECTAR un lote de
   * ordenes en `por_recolectar_en_tienda` (origen unico). A diferencia de las otras tres
   * acciones NO transiciona: escribe solo `mensajero_asignado_id`, y ni `num_guia` (ya lo
   * tiene desde que nacio) ni `asignado_at` (R38: la recoleccion no entra al ranking, cuyo
   * denominador es esa columna). Tampoco pasa por el gate de coordenadas (R9): la orden no
   * entra a ninguna ruta todavia. Solo acceso total.
   */
  asignarRecoleccion(
    input: AsignarRecoleccionInput,
    actor: Actor,
  ): Promise<AsignarRecoleccionServiceResult>;
}
