import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";

// Feature 149 (design §1/§5) — contrato del servicio que DESHACE una asignacion a mensajero
// (caso a, `por_recoger`) o un ruteo a bodega satelite (caso b, `en_ruta_bodega_satelite`)
// mientras el paquete no haya salido de la bodega ni haya sido recibido en otra.
//
// Logica de negocio PURA: sin HTTP, sin Prisma, sin `next/`. El borde (Server Action,
// `lib/actions/deshacer-asignacion.ts`) resuelve la sesion, valida con zod y traduce el
// resultado. `DetalleConflicto` se REUTILIZA de `IGuiaAsignacionService`: es el mismo contrato
// por-orden que ya consumen las acciones por lote del listado.

/** Un lote: N ordenes y UN motivo comun (R24). El `motivo` llega ya recortado por el borde. */
export interface DeshacerAsignacionInput {
  ordenIds: string[];
  motivo: string;
}

/** Estados de BODEGA a los que puede volver una orden (D3': la tabla de normalizacion). */
export type DestinoReversion = "en_bodega_central" | "en_bodega_satelite";

export interface DeshacerAsignacionResultadoItem {
  ordenId: string;
  estado: DestinoReversion;
}

/**
 * Mismo patron de resultado que `GuiaAsignacionService` / `IAsignacionSateliteService`:
 *   - `forbidden`        rol no autorizado (R1/R2), zona ajena (R4) o caso (b) pedido por un
 *                        `adminSatelite` (R5);
 *   - `sin_zona`         `adminSatelite` sin zona asignada (R6);
 *   - `validation_error` guardas de configuracion (zona central sin configurar, catalogo de
 *                        estados incompleto);
 *   - `conflict`         rechazo POR ORDEN con motivo tipado (R13-R18, R21), todo-o-nada (R20).
 */
export type DeshacerAsignacionServiceResult =
  | { status: "ok"; resultados: DeshacerAsignacionResultadoItem[] }
  | { status: "forbidden" }
  | { status: "sin_zona" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };

export interface IDeshacerAsignacionService {
  /**
   * R1-R33: revierte el lote completo o ninguna orden. El destino de cada orden se DERIVA de su
   * historial (nunca de su zona) y se normaliza a un estado de bodega; si no se puede derivar,
   * la orden se rechaza (fallo CERRADO). El cierre de dia pendiente del mensajero NO bloquea
   * esta accion (Q1 CERRADA, R19).
   */
  deshacer(
    input: DeshacerAsignacionInput,
    actor: Actor,
  ): Promise<DeshacerAsignacionServiceResult>;
}
