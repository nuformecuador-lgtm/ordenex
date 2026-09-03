import type { RolValue } from "@prisma/client";
import type {
  ActualizarZonaInput,
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
  // FICHA 366 (R12): `ordenesReconciliadas` es cuantas ordenes cambiaron de zona por la
  // re-derivacion de ESTE guardado. Cero es un valor normal (R14), no una ausencia de dato.
  | { status: "ok"; zona: ZonaDTO; ordenesReconciliadas: number }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };

export type BorrarZonaServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict" };

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
}
