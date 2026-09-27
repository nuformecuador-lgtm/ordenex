import type { Actor } from "@/lib/interfaces/services/IZonaService";
import type { GuardarSinpeBodegaInput, SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";

/**
 * ⭑ FICHA 429 — EL CONTRATO DE LA SUPERFICIE DEL SINPE POR BODEGA.
 *
 * Tres operaciones y ninguna mas: ver, guardar y confirmar. La estrechez es el punto — lo que el
 * `adminSatelite` gana con esta ficha son literalmente DOS CAMPOS de SU bodega, no un trozo del
 * CRUD de zonas.
 *
 * ⚠️ EL `Actor` SE REUSA de `IZonaService` a proposito: es `{ usuarioId, rol }`, y esta ficha NO lo
 * ensancha con la zona. Un `zonaId` en el actor de sesion seria un permiso viajando por el cliente;
 * la zona que decide quien puede editar que se lee de la BASE, dentro del servicio (R20).
 */

export type ListarSinpeBodegasServiceResult =
  | { status: "ok"; items: SinpeBodegaDTO[] }
  | { status: "forbidden" };

export type GuardarSinpeBodegaServiceResult =
  | { status: "ok"; bodega: SinpeBodegaDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ConfirmarSinpeBodegaServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" };

export interface ISinpeBodegaService {
  /**
   * Las bodegas que este actor puede VER, cada una con su `editable` ya decidido en el servidor.
   * `adminSatelite` ve SOLO la suya; `admin` y `maestro`, las ocho.
   */
  listar(actor: Actor): Promise<ListarSinpeBodegasServiceResult>;
  /**
   * Guarda el par de UNA bodega. El `zonaId` dice QUE se quiere tocar; nunca SI se puede
   * (R20: eso lo decide la zona que la base le asigna al actor).
   */
  guardar(
    zonaId: string,
    input: GuardarSinpeBodegaInput,
    actor: Actor,
  ): Promise<GuardarSinpeBodegaServiceResult>;
  /** «Está bien»: marca la bodega como revisada. No acepta valores (R25). */
  confirmar(zonaId: string, actor: Actor): Promise<ConfirmarSinpeBodegaServiceResult>;
}
