// FICHA 337 (segunda mitad) — configuracion del dominio «cobro por rechazo desde novedades».
// Patron literal de `lib/config/gasto-fijo.ts`: `readPositiveInt` con fallback y singleton
// exportado, para no hardcodear cotas de negocio (`docs/architecture.md`: «sin hardcode de
// contexto»).
//
// Solo cubre el TOPE de la cola de pendientes de `/wallet`. La cola es un puñado de filas —los
// rechazos de escritorio son unidades al dia, no miles— y el tope existe por la misma razon que
// en la 333: para que la consulta no salga sin `take` el dia que alguien deje de decidir durante
// un mes, y para que la pantalla pueda enseñar el `total` REAL del servidor al lado de una lista
// recortada en vez de mentir con `items.length`.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RechazoTiendaCobroConfig {
  /** Cuantas filas de la cola se envian a la pantalla como maximo. El `total` va aparte. */
  MAX_PAGE_SIZE: number;
}

export function loadRechazoTiendaCobroConfig(): RechazoTiendaCobroConfig {
  return {
    MAX_PAGE_SIZE: readPositiveInt("RECHAZO_TIENDA_COBRO_MAX_PAGE_SIZE", 100),
  };
}

export const rechazoTiendaCobroConfig: RechazoTiendaCobroConfig = loadRechazoTiendaCobroConfig();
