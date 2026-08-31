// Feature 255 (design.md §5) — contrato del service de COTIZACION por API key.
//
// El service NO conoce HTTP: no importa nada de `next/*`, no recibe `Request` y no lanza
// para los casos de negocio. Devuelve un resultado DISCRIMINADO y el route handler lo
// traduce, exactamente igual que hace `cargarViaApi` con `BulkOrdenResult` (feature 88).
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import type { CotizacionResumen } from "@/lib/types/cotizacion";

/**
 * Las TRES lecturas geograficas que la cotizacion necesita, y NADA MAS (alternativa A6 de
 * `design.md` §7: no hay un repositorio propio, porque `IOrdenRepository` ya las expone y una
 * segunda forma de leer las mismas tablas divergiria en el `normalize`).
 *
 * El `Pick` no es cosmetico: es lo que hace la LECTURA PURA (R43/R44/R45) estructural. Un
 * `createManyOrdenes`, un `generarGuiaLote` o cualquier escritura del repositorio ni siquiera
 * estan al alcance del service, asi que una cotizacion no puede persistir por descuido.
 */
export type CotizacionGeoRepository = Pick<
  IOrdenRepository,
  "findAllProvincias" | "findCantonesByProvinciaIds" | "findDistritosByCantonIds"
>;

/**
 * Resultado discriminado (design.md §5):
 * - `ok` -> `200` con el resumen (contadores + el detalle por fila; sin agregado del lote).
 * - `sin_tarifa` -> `409` con el mensaje fijo de R13. NUNCA un importe en cero: la inversion
 *   deliberada del gap D1/R8 de la feature 98 (R15).
 * - `forbidden` -> `403`. El rol se comprueba ANTES de tocar tarifa o geografia.
 */
export type CotizacionOrdenResult =
  | { status: "ok"; resumen: CotizacionResumen }
  | { status: "sin_tarifa" }
  | { status: "forbidden" };

export interface ICotizacionOrdenService {
  /**
   * Cotiza un lote de filas CRUDAS (clave = columna, valor = texto) contra la tarifa
   * cotizable de la tienda del actor. Orden normativo (R14): rol -> tarifa (UNA vez por
   * peticion, R11) -> precarga geografica -> por fila.
   *
   * No persiste NADA (R43), no consume guias (R44) y no deja rastro de auditoria (R45).
   */
  cotizar(rows: RawRow[], actor: Actor): Promise<CotizacionOrdenResult>;
}
