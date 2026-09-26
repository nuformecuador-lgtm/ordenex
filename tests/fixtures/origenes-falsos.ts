// Ficha 458-A (TA.2) — un `IOrigenLegibleService` falso para los tests de BORDE de los libros: el
// borde adjunta `origen` a cada fila de la rama `ok`, y estos tests miden el borde, no la lectura de
// las entidades (esa vive en `tests/unit/services/wallet-origen-legible.test.ts` y en
// `tests/integration/db/wallet-origen-legible.test.ts`).

import type { IOrigenLegibleService } from "@/lib/interfaces/services/IOrigenLegibleService";
import type { FilaConOrigenTecnico, OrigenLegibleDTO } from "@/lib/types/wallet-origen";

export const ORIGEN_FALSO: OrigenLegibleDTO = { texto: "Origen legible de prueba", enlace: null };

export const ORIGENES_FALSOS: IOrigenLegibleService = {
  async resolver(_libro, filas) {
    return filas.map(() => ORIGEN_FALSO);
  },
  async adjuntar<T extends FilaConOrigenTecnico>(_libro: unknown, filas: readonly T[]) {
    return filas.map((f) => ({ ...f, origen: ORIGEN_FALSO }));
  },
};

/** La fila tal como la entrega el borde desde la 458-A: la del servicio + `origen`. */
export function conOrigenFalso<T>(fila: T): T & { origen: OrigenLegibleDTO } {
  return { ...fila, origen: ORIGEN_FALSO };
}
