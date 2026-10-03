import type { BusquedaResuelta, SuperficieConGuia } from "@/lib/types/busqueda-por-guia";

/**
 * FICHA 469 (design §2) — contrato del servicio que decide si el termino del libro es una busqueda por
 * GUIA o de TEXTO y, si es por guia, que movimientos salen. Lo usan igual la lectura paginada, la
 * descarga y el detalle de una fila. Sin Next, sin Prisma: recibe sus repositorios por constructor.
 */
export interface IBusquedaPorGuiaService {
  /**
   * R2–R15 — resuelve el termino en una superficie. `texto` si no identifica ninguna orden del alcance
   * (R5/R6: la respuesta es la de la 463). `guia` con la lista CERRADA de pares que el repositorio del
   * libro aplica en su `WHERE` (puede ir vacia: R22).
   */
  resolver(f: { termino: string; superficie: SuperficieConGuia }): Promise<BusquedaResuelta>;
  /**
   * R25/R29 — solo el paso 1: los ids de las ordenes que el termino identifica en ese alcance (vacio =
   * modo texto). Lo usa el detalle de una fila con el MISMO `tiendaId` que ya acota ese detalle.
   */
  identificar(f: { termino: string; tiendaId?: string }): Promise<string[]>;
}
