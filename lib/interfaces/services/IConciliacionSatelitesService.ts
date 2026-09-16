import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ConsolidacionSateliteDTO,
  ListarConsolidacionesSateliteCompletoInput,
  ListarConsolidacionesSateliteInput,
  ListarSaldosSatelitesCompletoInput,
  ListarSaldosSatelitesInput,
  MarcarConsolidacionRecibidaInput,
  RevertirConciliacionInputBorde,
  SaldoSateliteDTO,
} from "@/lib/types/conciliacion-satelites";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 — CONTRATO DEL SERVICIO DE CONCILIACION DE SATELITES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Logica de negocio pura: no conoce HTTP (Request/Response/headers) ni Prisma. El borde (Server
// Action) resuelve `unauthenticated` y `validation_error`; el ROL lo decide ESTE servicio, porque
// es dominio y no transporte (R27, y el mismo reparto que `CierresBodegaAdminService`).
//
// QUIEN PUEDE (Q3, confirmado por el humano el 2026-09-16): `esAccesoTotal` = `maestro` **o**
// `admin`. Es exactamente quien aprueba hoy. Estrechar a `maestro` devolveria la dependencia de una
// sola persona, que es parte de lo que esta ficha viene a quitar.
//
// Money-safe: los importes cruzan como STRING de escala 2 en las dos direcciones (R20).

/** R23 — una pagina de la tabla de saldos por bodega satelite. */
export type ListarSaldosSatelitesServiceResult = ListarPaginadoServiceResult<SaldoSateliteDTO>;

/** R29 — el conjunto entero de saldos, para la descarga. */
export type ListarSaldosSatelitesCompletoServiceResult =
  ListarCompletoServiceResult<SaldoSateliteDTO>;

/** R24 — una pagina del desglose de consolidaciones de UNA bodega. */
export type ListarConsolidacionesSateliteServiceResult =
  ListarPaginadoServiceResult<ConsolidacionSateliteDTO>;

/** R29 — el desglose entero de esa bodega, para la descarga. */
export type ListarConsolidacionesSateliteCompletoServiceResult =
  ListarCompletoServiceResult<ConsolidacionSateliteDTO>;

/**
 * R9/R11 — el desenlace de MARCAR o de REVERTIR.
 *
 * `conflict` = la consolidacion existe pero ya no esta en el estado que la accion exige (R11: ya
 * estaba marcada; o al revertir, ya estaba pendiente). `no_encontrada` = no existe.
 *
 * NO hay `validation_error` aqui: el monto lo mata zod en el borde (R10). Si el servicio lo
 * redeclarara, serian dos definiciones de «cuanto dinero es valido».
 */
export type MarcaConciliacionServiceResult =
  | { status: "ok"; cierreBodegaId: string }
  | { status: "conflict" }
  | { status: "no_encontrada" }
  | { status: "forbidden" };

export interface IConciliacionSatelitesService {
  listarSaldosSatelites(
    input: ListarSaldosSatelitesInput,
    actor: Actor,
  ): Promise<ListarSaldosSatelitesServiceResult>;
  listarSaldosSatelitesCompleto(
    input: ListarSaldosSatelitesCompletoInput,
    actor: Actor,
  ): Promise<ListarSaldosSatelitesCompletoServiceResult>;
  listarConsolidacionesSatelite(
    input: ListarConsolidacionesSateliteInput,
    actor: Actor,
  ): Promise<ListarConsolidacionesSateliteServiceResult>;
  listarConsolidacionesSateliteCompleto(
    input: ListarConsolidacionesSateliteCompletoInput,
    actor: Actor,
  ): Promise<ListarConsolidacionesSateliteCompletoServiceResult>;
  /**
   * R9/R13/R14 — marca la consolidacion como RECIBIDA con su monto. NO escribe en ningun libro de
   * dinero: la marca es seguimiento, no contabilidad.
   */
  marcarRecibida(
    input: MarcarConsolidacionRecibidaInput,
    actor: Actor,
  ): Promise<MarcaConciliacionServiceResult>;
  /** R12/R13 — deshace la marca. El monto que se borra queda en el historial. */
  revertirConciliacion(
    input: RevertirConciliacionInputBorde,
    actor: Actor,
  ): Promise<MarcaConciliacionServiceResult>;
}
