import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RechazoSlaTiendaDTO } from "@/lib/types/rechazo-sla-tienda";

// Feature 102 (T8, design §5.2) — contrato del servicio de RECHAZOS POR SLA de la tienda: lista
// paginada de solo-lectura de las ordenes que el cron SLA (99) escalo a `rechazada`, acotada a la
// tienda del adminTienda. Logica de negocio pura (sin HTTP ni Prisma); el borde (Server Action) la
// traduce a resultado tipado. Solo el rol `adminTienda` (R13). Patron `INovedadesService`.

// Input paginado. `pageSize` lo fija el borde (10); el service lo recibe ya acotado.
export interface ListarRechazosSlaTiendaInput {
  page: number;
  pageSize: number;
}

// R12/R14: respuesta paginada `{ items, total, page, pageSize }` (shape identico al de novedades /
// mi-wallet para reutilizar `Pagination`). `forbidden` si el rol no es adminTienda (R13), sin
// exponer datos de ordenes.
export type ListarRechazosSlaTiendaServiceResult =
  | { status: "ok"; items: RechazoSlaTiendaDTO[]; total: number; page: number; pageSize: number }
  | { status: "forbidden" };

export interface IRechazosSlaTiendaService {
  /**
   * R12/R13/R14/R15: lista la pagina de rechazos por SLA de la tienda del actor (acotada SIEMPRE a
   * `actor.usuarioId` = tiendaId, R13), con el monto de 56 por orden (R14). Solo lectura (R16). Rol
   * != adminTienda -> forbidden (R13).
   */
  listar(
    input: ListarRechazosSlaTiendaInput,
    actor: Actor,
  ): Promise<ListarRechazosSlaTiendaServiceResult>;
}
