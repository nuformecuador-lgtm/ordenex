import type { TipoDeCuenta } from "@/lib/types/estado-cuenta";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";

// FICHA 458-D (T D.7, design §5; R30, R48) — las claves SWR del estado de cuenta, escritas UNA vez.
//
// REFRESCO DIRIGIDO (R30): tras registrar o anular desde el estado de cuenta de UNA cuenta se releen
// sus claves —todas sus páginas, periodos y chips— y NINGUNA de otra cuenta. El listado de su tipo
// (`/wallet/tiendas`, `/wallet/mensajeros`, `/wallet/satelites`) no se relee desde aquí: se vuelve a
// leer al montarse (Server Component + SWR), que es cuando alguien lo mira.
//
// FICHA 463 (R41): la clave lleva también el término y el orden del libro. Dos lecturas que difieran
// solo en eso piden filas distintas y no pueden compartir caché. El prefijo, el tipo y el id siguen
// siendo las tres primeras posiciones, así que `esClaveDeLaCuenta` casa también estas claves.

/** Prefijo de la clave. Identifica esta lectura entre todas las de la app. */
export const CLAVE_ESTADO_CUENTA = "estado-cuenta";

export interface FiltroEstadoCuenta {
  desde: string;
  hasta: string;
  chip: string;
  page: number;
  pageSize: number;
  /** FICHA 458-D (R10) — el cierre elegido, o "" sin filtro de cierre. */
  cierre: string;
  /** FICHA 463 (R41) — el término del buscador ("" sin búsqueda). */
  termino?: string;
  /** FICHA 463 (R41) — el orden del libro. Ausente = «Más recientes», el de por defecto. */
  sortDir?: DireccionOrden;
}

export function claveEstadoCuenta(
  tipo: TipoDeCuenta,
  id: string,
  f: FiltroEstadoCuenta,
): readonly [string, TipoDeCuenta, string, string, string, string, number, number, string, string, DireccionOrden] {
  return [
    CLAVE_ESTADO_CUENTA,
    tipo,
    id,
    f.desde,
    f.hasta,
    f.chip,
    f.page,
    f.pageSize,
    f.cierre,
    f.termino ?? "",
    f.sortDir ?? "desc",
  ] as const;
}

/** El predicado del `mutate`: TODAS las claves de ESTA cuenta, ninguna de otra. */
export function esClaveDeLaCuenta(tipo: TipoDeCuenta, id: string) {
  return (clave: unknown): boolean =>
    Array.isArray(clave) && clave[0] === CLAVE_ESTADO_CUENTA && clave[1] === tipo && clave[2] === id;
}
