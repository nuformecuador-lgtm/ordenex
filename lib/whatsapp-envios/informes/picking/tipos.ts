// Ficha 476 (design §4) — TIPOS del informe de picking. Solo tipos: este archivo lo puede importar
// la pantalla (el selector de tienda) sin arrastrar el repositorio, jsPDF ni la fuente embebida.

/** Una orden en preparacion de la tienda del picking, tal como la devuelve la base (R6/R14). */
export interface FilaPicking {
  ordenId: string;
  numRemision: string;
  numGuia: number | null;
  /** Texto libre `orden.producto` (se interpreta con el parser de la 345). */
  producto: string;
  /**
   * Entrada a `en_preparacion` (D5/R14): la ULTIMA transicion del historial con destino
   * `en_preparacion` y, si no hay ninguna, `orden.created_at`.
   */
  entrada: Date;
}

/** Una orden en preparacion de CUALQUIER tienda con fulfillment (resumen del selector, R3). */
export interface EntradaPorTienda {
  tiendaId: string;
  entrada: Date;
}

/** La tienda del parametro, leida al generar (R7). `null` si no existe. */
export interface TiendaPicking {
  id: string;
  nombre: string;
  fulfillment: boolean;
  /** `true` si su rol es `adminTienda`. */
  esTienda: boolean;
  /** `true` si `usuario.estado = 'activo'` (decision del leader: una tienda inactiva no hace picking). */
  activo: boolean;
}

/** Una tienda ofrecible en el selector: `adminTienda` con `fulfillment = true` (R3). */
export interface TiendaFulfillment {
  id: string;
  nombre: string;
}

/** R3 — una opcion del selector de tienda, con sus conteos AHORA para el N del formulario. */
export interface TiendaPickingDTO {
  tiendaId: string;
  nombre: string;
  /** Ordenes en preparacion. */
  ordenes: number;
  /** De ellas, las que llevan MAS de `diasAtraso` dias en preparacion (R15). */
  atrasadas: number;
}

/** R3/R4 — resultado de `listarTiendasPicking` (`lib/actions/informe-picking.ts`). */
export type ListarTiendasPickingResult =
  | { status: "ok"; tiendas: TiendaPickingDTO[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
