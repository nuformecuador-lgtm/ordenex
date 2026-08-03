import type { RolValue } from "@prisma/client";
import type {
  CrearOrdenInput,
  ActualizarOrdenInput,
  ListarOrdenesInput,
  ListarOrdenesCompletoInput,
  OrdenDTO,
  OrdenListItemDTO,
} from "@/lib/types/orden";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// Actor autenticado que ejecuta la operacion. El rol se resuelve desde la sesion
// (R19) y determina la autorizacion (matriz R20-R24).
export interface Actor {
  usuarioId: string;
  rol: RolValue;
  /**
   * Feature 146 (A3, design §1.5) — zona del actor (`usuario.zona_id`), insumo del
   * predicado de visibilidad de las notificaciones acotadas por zona (R16). OPCIONAL a
   * proposito: el campo es ADITIVO y ningun consumidor existente (ni los ~cientos de
   * literales `Actor` de los tests) tiene que declararlo. `resolveActorFromSession` SI lo
   * puebla siempre; los consumidores que lo necesitan normalizan con `?? null`.
   */
  zonaId?: string | null;
}

// Resultados de dominio del servicio (sin acoplarse a HTTP). El borde (Server
// Action) los traduce al resultado tipado expuesto (R42).
export type CrearOrdenServiceResult =
  | { status: "ok"; orden: OrdenDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "conflict" };

export type ObtenerOrdenServiceResult =
  | { status: "ok"; orden: OrdenDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

// Feature 170 (T H.2): reexpresado sobre el contrato comun de listado paginado
// (`lib/types/listado-paginado`). Es el MOLDE que copian los 13 listados del Anexo III
// (design §11.4), asi que la forma vive en un solo sitio y no en catorce.
export type ListarOrdenesServiceResult = ListarPaginadoServiceResult<OrdenListItemDTO>;

/**
 * Feature 151 (design §4.1) — lectura SIN paginacion para la descarga del dataset
 * completo. Mismo servicio que `listar` para heredar autorizacion y acotamiento por
 * rol/zona (D3): `limite_excedido` NUNCA viaja con filas (R20/R21) y `forbidden`
 * tampoco (R14).
 */
export type ListarOrdenesCompletoServiceResult =
  | { status: "ok"; items: OrdenListItemDTO[]; total: number }
  | { status: "limite_excedido"; total: number; limite: number } // R20
  | { status: "forbidden" }; // R14

export type ActualizarOrdenServiceResult =
  | { status: "ok"; orden: OrdenDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };

export type BorrarOrdenServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" };

export interface IOrdenService {
  crear(input: CrearOrdenInput, actor: Actor): Promise<CrearOrdenServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerOrdenServiceResult>;
  listar(input: ListarOrdenesInput, actor: Actor): Promise<ListarOrdenesServiceResult>;
  /** Feature 151/R11: mismo listado, sin recorte por pagina y con tope duro (R20/R22). */
  listarCompleto(
    input: ListarOrdenesCompletoInput,
    actor: Actor,
  ): Promise<ListarOrdenesCompletoServiceResult>;
  actualizar(
    id: string,
    input: ActualizarOrdenInput,
    actor: Actor,
  ): Promise<ActualizarOrdenServiceResult>;
  borrar(id: string, actor: Actor): Promise<BorrarOrdenServiceResult>;
}
