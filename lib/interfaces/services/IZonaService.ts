import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarZonaInput,
  CantonLightDTO,
  CrearZonaInput,
  DistritoCatalogoDTO,
  ListarZonasInput,
  ProvinciaLightDTO,
  ZonaDTO,
  ZonaLightDTO,
} from "@/lib/types/zona";

// Feature 24. Se reutiliza el `Actor` (`{ usuarioId, rol }`) resuelto desde la
// sesion (R13). Resultados de dominio discriminados por `status`; el borde (Server
// Action) los pasa tal cual (R25/R26).
export type { Actor };

type ValidationResult = { status: "validation_error"; fieldErrors: Record<string, string[]> };
type Forbidden = { status: "forbidden" };
type NotFound = { status: "not_found" };
// R20/R21: el conflicto identifica su causa.
type Conflict = { status: "conflict"; reason: "nombre" | "distrito"; distritoIds?: string[] };

export type CrearZonaServiceResult =
  | { status: "ok"; zona: ZonaDTO }
  | ValidationResult
  | Forbidden
  | Conflict;

export type ObtenerZonaServiceResult =
  | { status: "ok"; zona: ZonaDTO }
  | Forbidden
  | NotFound;

export type ListarZonasServiceResult =
  | { status: "ok"; items: ZonaDTO[]; page: number; pageSize: number; total: number }
  | Forbidden;

export type ActualizarZonaServiceResult =
  | { status: "ok"; zona: ZonaDTO }
  | ValidationResult
  | Forbidden
  | NotFound
  | Conflict;

export type MarcarZonaGamServiceResult =
  | { status: "ok" }
  | Forbidden
  | NotFound;

export type ListarZonasLightServiceResult =
  | { status: "ok"; items: ZonaLightDTO[] }
  | Forbidden;

export type ListarProvinciasServiceResult =
  | { status: "ok"; items: ProvinciaLightDTO[] }
  | Forbidden;

export type ListarCantonesServiceResult =
  | { status: "ok"; items: CantonLightDTO[] }
  | Forbidden;

export type ListarDistritosServiceResult =
  | { status: "ok"; items: DistritoCatalogoDTO[] }
  | Forbidden;

export interface IZonaService {
  crear(input: CrearZonaInput, actor: Actor): Promise<CrearZonaServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerZonaServiceResult>;
  listar(input: ListarZonasInput, actor: Actor): Promise<ListarZonasServiceResult>;
  actualizar(input: ActualizarZonaInput, actor: Actor): Promise<ActualizarZonaServiceResult>;
  marcarGam(id: string, actor: Actor): Promise<MarcarZonaGamServiceResult>;
  listarLight(actor: Actor): Promise<ListarZonasLightServiceResult>;
  // Catalogo geografico global (R14).
  listarProvincias(actor: Actor): Promise<ListarProvinciasServiceResult>;
  listarCantones(provinciaId: string, actor: Actor): Promise<ListarCantonesServiceResult>;
  listarDistritos(cantonId: string, actor: Actor): Promise<ListarDistritosServiceResult>;
}
