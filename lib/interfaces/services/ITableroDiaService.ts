// Feature 192 (B3.1/B7.4, design.md §3 y §6) — EL PUERTO DEL SERVICIO DEL TABLERO.
//
// Dos lecturas y ninguna escritura. Ninguna de las dos conoce Next: el actor y el instante de
// referencia ENTRAN por parametro (R16/R72), asi que el servicio se prueba entero sin HTTP,
// sin cookies y sin base de datos.

import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { ResultadoDetalleDia, ResultadoTableroDia } from "@/lib/types/tablero-dia";

export interface ITableroDiaService {
  /**
   * Los conteos del dia en curso, dentro del alcance del actor. Devuelve un resultado
   * DISCRIMINADO: un denegado nunca es un tablero de ceros (R2/R3/R7/R9).
   */
  obtener(actor: ActorAnalitica | null, now: Date): Promise<ResultadoTableroDia>;

  /**
   * El detalle de UN mensajero. Vuelve a atravesar la frontera entera (R40): resuelve el
   * alcance otra vez y no recibe ningun filtro del cliente. Nunca pasa por la cache (R73).
   */
  detalle(
    actor: ActorAnalitica | null,
    now: Date,
    mensajeroId: string,
    pagina?: number,
  ): Promise<ResultadoDetalleDia>;
}
