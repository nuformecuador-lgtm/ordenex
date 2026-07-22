import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { PlantillaPublica } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type {
  ActualizarPlantillaInput,
  CambiarEstadoPlantillaInput,
  CrearPlantillaInput,
  ListarPlantillasInput,
  PlantillaListItemDTO,
} from "@/lib/types/plantilla-mensaje";

// Feature 107 — contrato del service. Reutiliza el `Actor` de IOrdenService
// (`{ usuarioId, rol }`), resuelto desde la sesion (R4). SOLO `maestro` (R5).
export type { Actor };

export type CrearPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R16
  | { status: "conflict"; campo: "nombre" } // R10
  | { status: "forbidden" }; // R5

export type ListarPlantillasServiceResult =
  | { status: "ok"; items: PlantillaListItemDTO[]; page: number; pageSize: number; total: number }
  | { status: "forbidden" };

export type ObtenerPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "forbidden" }
  | { status: "not_found" }; // R28

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
  obtener(id: string, actor: Actor): Promise<ObtenerPlantillaServiceResult>;
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
