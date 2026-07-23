import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GuardarNotaResult, LimpiarNotaResult } from "@/lib/types/nota-privada-mensajero";

// Feature 116 — contrato del servicio de la NOTA PRIVADA del mensajero por orden. Logica de
// negocio pura (sin HTTP ni Prisma): autoriza (rol `mensajero`), fija el `usuario_id` con el
// actor y persiste/limpia `nota` sobre `orden_mensajero_meta` (columna de la feature 115). NO
// toca `orden.notas` (nota de la tienda) ni `marcar_luego` (R3/R7). El borde (Server Action)
// traduce el resultado a tipado y agrega `unauthenticated`/`validation_error`.
export interface INotaPrivadaMensajeroService {
  /**
   * R1/R2/R3/R5/R9/R10/R16: crea o edita la nota privada del actor para `ordenId`. `forbidden`
   * si el rol no es mensajero (R10) o la orden no existe (violacion de FK -> resultado de
   * dominio, R16). Recorta `nota`; si queda vacia delega en `limpiar` (R5) y devuelve
   * `{ ok, nota: null }`. En `ok` refleja la `nota` persistida. El `usuario_id` es SIEMPRE el
   * del actor (nunca el input): la privacidad es estructural por la clave (usuario_id, orden_id).
   */
  guardar(ordenId: string, nota: string, actor: Actor): Promise<GuardarNotaResult>;

  /**
   * R4/R9/R10: deja `nota = NULL` en la fila del actor SIN borrarla (preserva `marcar_luego` de
   * la 115). Idempotente: `ok` aunque no hubiera fila. `forbidden` si el rol no es mensajero.
   */
  limpiar(ordenId: string, actor: Actor): Promise<LimpiarNotaResult>;
}
