import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { PlantillaPublica } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type {
  ActualizarPlantillaInput,
  CambiarEstadoPlantillaInput,
  CrearPlantillaInput,
  ListarPlantillasCompletoInput,
  ListarPlantillasInput,
  PlantillaListItemDTO,
} from "@/lib/types/plantilla-mensaje";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// Feature 107 — contrato del service. Reutiliza el `Actor` de IOrdenService
// (`{ usuarioId, rol }`), resuelto desde la sesion (R4). SOLO `maestro` (R5).
export type { Actor };

export type CrearPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R16
  | { status: "conflict"; campo: "nombre" } // R10
  | { status: "forbidden" }; // R5

// Feature 170 (T H.2): reexpresado sobre el contrato comun de listado paginado
// (`lib/types/listado-paginado`). Misma forma, una sola definicion.
export type ListarPlantillasServiceResult = ListarPaginadoServiceResult<PlantillaListItemDTO>;

/**
 * Feature 170 (T B.1) — lectura SIN paginacion para la descarga. Mismo guard de rol
 * (`maestro`) que `listar`, de modo que `forbidden` y `limite_excedido` no puedan viajar
 * con filas (R17/R27).
 */
export type ListarPlantillasCompletoServiceResult =
  ListarCompletoServiceResult<PlantillaListItemDTO>;

// BORRADO 2026-08-07 (tanda 2): aqui vivia `ObtenerPlantillaServiceResult`, del metodo
// `obtener` que se va de esta interfaz mas abajo.

export type ActualizarPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R16
  | { status: "conflict"; campo: "nombre" } // R10/R22
  | { status: "forbidden" }
  | { status: "not_found" }; // R21

export type CambiarEstadoPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "forbidden" }
  | { status: "not_found" }; // R26

export type EliminarPlantillaServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }; // R29

export type PreviewPlantillaServiceResult =
  | { status: "ok"; texto: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R16
  | { status: "forbidden" };

export interface IPlantillaMensajeService {
  crear(input: CrearPlantillaInput, actor: Actor): Promise<CrearPlantillaServiceResult>;
  listar(input: ListarPlantillasInput, actor: Actor): Promise<ListarPlantillasServiceResult>;
  /**
   * Feature 170/R9: el MISMO listado sin recorte por pagina, para la descarga. Reusa el
   * `repo.list` del listado —el que ya excluye las borradas (R19)— con `skip: 0` y
   * `take: tope + 1`, mas el guard del tope (R27/R29).
   */
  listarCompleto(
    input: ListarPlantillasCompletoInput,
    actor: Actor,
  ): Promise<ListarPlantillasCompletoServiceResult>;
  actualizar(
    id: string,
    input: ActualizarPlantillaInput,
    actor: Actor,
  ): Promise<ActualizarPlantillaServiceResult>;
  cambiarEstado(
    id: string,
    input: CambiarEstadoPlantillaInput,
    actor: Actor,
  ): Promise<CambiarEstadoPlantillaServiceResult>;
  eliminar(id: string, actor: Actor): Promise<EliminarPlantillaServiceResult>;
  preview(cuerpo: string, actor: Actor): Promise<PreviewPlantillaServiceResult>;
}
