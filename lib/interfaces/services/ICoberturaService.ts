// Ficha 465 (design §3.4) — contrato del servicio del Excel de cobertura por distrito.
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import type { CoberturaDistritoDTO } from "@/lib/types/cobertura";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";

export type ListarCoberturaServiceResult = ListarCompletoServiceResult<CoberturaDistritoDTO>;

export interface ICoberturaService {
  /**
   * Una fila por distrito del catalogo, clasificada y ordenada (R4-R15). Solo `maestro`: con
   * otro rol devuelve `forbidden` SIN tocar el repositorio (R2). Solo lee (R21).
   */
  listar(actor: Actor): Promise<ListarCoberturaServiceResult>;
}
