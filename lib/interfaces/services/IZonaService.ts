import type { RolValue } from "@prisma/client";
import type {
  ActualizarZonaInput,
  ArbolZonas,
  CrearZonaInput,
  ListarZonasInput,
  ZonaDTO,
} from "@/lib/types/zona";

// Actor autenticado. El CRUD de zonas es exclusivo del rol maestro (feature 24).
export interface Actor {
  usuarioId: string;
  rol: RolValue;
}

export type CrearZonaServiceResult =
  | { status: "ok"; zona: ZonaDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" };

export type ObtenerZonaServiceResult =
  | { status: "ok"; zona: ZonaDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ListarZonasServiceResult =
  | { status: "ok"; items: ZonaDTO[]; page: number; pageSize: number; total: number }
  | { status: "forbidden" };

export type ActualizarZonaServiceResult =
  | { status: "ok"; zona: ZonaDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };

export type BorrarZonaServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict" };

export type ArbolZonasServiceResult =
  | { status: "ok"; arbol: ArbolZonas }
  | { status: "forbidden" };

export type MarcarGamServiceResult =
  | { status: "ok"; zona: ZonaDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export interface IZonaService {
  crear(input: CrearZonaInput, actor: Actor): Promise<CrearZonaServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerZonaServiceResult>;
  listar(input: ListarZonasInput, actor: Actor): Promise<ListarZonasServiceResult>;
  actualizar(
    id: string,
    input: ActualizarZonaInput,
    actor: Actor,
  ): Promise<ActualizarZonaServiceResult>;
  borrar(id: string, actor: Actor): Promise<BorrarZonaServiceResult>;
  arbol(actor: Actor): Promise<ArbolZonasServiceResult>;
  /** Feature 24/R3: fija el flag GAM de la zona (a lo sumo una en true). Solo maestro. */
  marcarGam(id: string, esGam: boolean, actor: Actor): Promise<MarcarGamServiceResult>;
}
