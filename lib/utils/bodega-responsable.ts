import type { CierreDestinoTipo } from "@/lib/types/cierre";

// Feature 41 (R1) — derivación ÚNICA de la "bodega responsable" de un mensajero a
// partir de su zona, extraída de `CierreDiaService.solicitarCierre` (features 37/54)
// para compartirla con el corte diario (`CorteDiarioService`) sin duplicar la regla.
//
// `bodega_central` si la zona del mensajero ES la central (`findCentralZonaId()`);
// `bodega_satelite` de su propia zona en caso contrario. Fallback SEGURO (design §6,
// feature 55 pendiente): si `centralZonaId` es null NINGÚN mensajero clasifica como
// central -> `bodega_satelite` con su propia zona (no lanza).
export interface DestinoCierre {
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
}

export function resolverDestinoCierre(
  zonaId: string,
  centralZonaId: string | null,
): DestinoCierre {
  const destinoTipo: CierreDestinoTipo =
    centralZonaId !== null && zonaId === centralZonaId ? "bodega_central" : "bodega_satelite";
  return { destinoTipo, destinoZonaId: zonaId };
}
