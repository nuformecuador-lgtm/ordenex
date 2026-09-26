// Ficha 458-A (TA.2) — adjunta el origen legible a los RESULTADOS de los servicios de los libros,
// sin tocar sus contratos de servicio (cada servicio sigue devolviendo sus DTO; el borde, que es el
// composition root, le añade `origen` antes de devolver). Solo la rama `ok` gana origen: ninguna
// rama de error viaja con filas, y esta pieza no cambia eso.

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrigenLegibleService } from "@/lib/interfaces/services/IOrigenLegibleService";
import type { ConOrigen, FilaConOrigenTecnico, LibroWallet } from "@/lib/types/wallet-origen";

/** Un resultado paginado (`{ status: "ok", data: { movimientos } }`) con origen en cada fila. */
export type ConOrigenEnPagina<R> = R extends { status: "ok"; data: infer D }
  ? D extends { movimientos: (infer T)[] }
    ? Omit<R, "data"> & { data: Omit<D, "movimientos"> & { movimientos: ConOrigen<T>[] } }
    : R
  : R;

/** Un resultado completo (`{ status: "ok", items }`) con origen en cada fila. */
export type ConOrigenEnItems<R> = R extends { status: "ok"; items: (infer T)[] }
  ? Omit<R, "items"> & { items: ConOrigen<T>[] }
  : R;

type Pagina = { status: "ok"; data: { movimientos: FilaConOrigenTecnico[] } };
type Items = { status: "ok"; items: FilaConOrigenTecnico[] };

export async function origenEnPagina<R extends { status: string }>(
  origenes: IOrigenLegibleService,
  libro: LibroWallet,
  r: R,
  actor: Actor,
): Promise<ConOrigenEnPagina<R>> {
  if (r.status !== "ok" || !("data" in r)) return r as ConOrigenEnPagina<R>;
  const pagina = r as unknown as Pagina;
  const movimientos = await origenes.adjuntar(libro, pagina.data.movimientos, actor);
  return { ...pagina, data: { ...pagina.data, movimientos } } as unknown as ConOrigenEnPagina<R>;
}

export async function origenEnItems<R extends { status: string }>(
  origenes: IOrigenLegibleService,
  libro: LibroWallet,
  r: R,
  actor: Actor,
): Promise<ConOrigenEnItems<R>> {
  if (r.status !== "ok" || !("items" in r)) return r as ConOrigenEnItems<R>;
  const completo = r as unknown as Items;
  const items = await origenes.adjuntar(libro, completo.items, actor);
  return { ...completo, items } as unknown as ConOrigenEnItems<R>;
}
