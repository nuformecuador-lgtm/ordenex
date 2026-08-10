// Feature 192 (B2.1/B7.1, design.md §5 y §5.bis) — EL PUERTO DE LECTURA DEL TABLERO.
//
// Contrato NEUTRAL: sin Prisma, sin Next y sin `process.env`. Las dos consultas de la
// feature viven detras de el, y las dos comparten el mismo recorte multi-tenant.
//
// El `filtro` NO es un `where` de Prisma ni una cadena SQL: es el ALCANCE ya traducido por
// la lista blanca del servicio (`design.md §3.3`). Que sea una union de dos variantes —y no
// un `zonaId: string | null` suelto— es lo que impide que un fallo de datos produzca una
// consulta sin recorte: `null` no es representable.

import type { FilaTableroDia, OrdenDetalleDia } from "@/lib/types/tablero-dia";
import type { VentanaDiaCR } from "@/lib/utils/ventana-dia-cr";

/**
 * El recorte de filas, ya resuelto y validado por el servicio (R4/R5/R10). El repositorio no
 * lo interpreta: lo escribe en el `WHERE` sobre `orden.zona_id` y nada mas.
 */
export type FiltroAlcanceTablero =
  | { readonly tipo: "global" }
  | { readonly tipo: "zona"; readonly zonaId: string };

/**
 * Una fila de conteo por mensajero. Tiene EXACTAMENTE la forma de la tarjeta (`R25`): los
 * ocho contadores salen del mismo `COUNT(*)` particionado, no de restas en la aplicacion.
 */
export type FilaConteoMensajero = FilaTableroDia;

/** Pagina pedida del detalle. `pagina` es 1-based, como el listado de ordenes. */
export interface PaginaDetalle {
  readonly pagina: number;
  readonly pageSize: number;
}

/**
 * R51/R55 — la pagina de ordenes MAS el total del dia. El `total` sale de la MISMA consulta
 * (ventana `COUNT(*) OVER ()`), no de un segundo viaje: si viniera de otra consulta podria
 * discrepar de las filas que acompana y el cuadre con `asignadas` seria casual.
 */
export interface PaginaOrdenesDelDia {
  readonly ordenes: readonly OrdenDetalleDia[];
  readonly total: number;
}

export interface ITableroDiaRepository {
  /**
   * R36/R39 — UNA sola consulta agregada; devuelve una fila por mensajero con ordenes
   * asignadas hoy dentro del alcance, y su cardinalidad NO crece con el numero de ordenes.
   */
  contarPorMensajero(
    ventana: VentanaDiaCR,
    filtro: FiltroAlcanceTablero,
  ): Promise<readonly FilaConteoMensajero[]>;

  /**
   * R47/R55 — el detalle, BAJO DEMANDA y paginado. El recorte por zona vuelve a viajar aqui
   * (R41): el detalle no se fia de que la tarjeta pulsada ya viniera recortada.
   */
  listarOrdenesDelDia(
    ventana: VentanaDiaCR,
    filtro: FiltroAlcanceTablero,
    mensajeroId: string,
    pagina: PaginaDetalle,
  ): Promise<PaginaOrdenesDelDia>;
}
