import { vi } from "vitest";

import type { IReprogramadasRetenidasService } from "@/lib/interfaces/services/IReprogramadasRetenidasService";

/**
 * FICHA 462 (T2.9) — el DOBLE del conteo de reprogramadas retenidas que las suites de
 * `CierresAdminService` pasan como septimo argumento (REQUERIDO, sin default: design §5.1).
 *
 * Devuelve un `Map` VACIO: ningun cierre retiene. Las suites que miden la marca construyen el suyo
 * con cifras (`tests/unit/services/cierres-admin-retenidas.test.ts`); las demas solo necesitan que
 * el servicio compile y que la marca no aparezca.
 *
 * Es un `vi.fn`: quien quiera afirmar «UNA llamada por pagina» puede contarlas.
 */
export type RetenidasDoble = Pick<IReprogramadasRetenidasService, "contarPorCierre"> & {
  contarPorCierre: ReturnType<typeof vi.fn<IReprogramadasRetenidasService["contarPorCierre"]>>;
};

export function sinRetenidas(): RetenidasDoble {
  return {
    contarPorCierre: vi.fn<IReprogramadasRetenidasService["contarPorCierre"]>(
      async () => new Map<string, number>(),
    ),
  };
}

/** Un doble que marca los cierres indicados con esas cifras (los demas no aparecen). */
export function conRetenidas(marcas: Record<string, number>): RetenidasDoble {
  return {
    contarPorCierre: vi.fn<IReprogramadasRetenidasService["contarPorCierre"]>(
      async (_hoyCR, cierreIds) =>
        new Map(
          [...cierreIds]
            .filter((id) => (marcas[id] ?? 0) > 0)
            .map((id) => [id, marcas[id] as number]),
        ),
    ),
  };
}
