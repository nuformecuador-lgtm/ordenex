import type { RolValue } from "@prisma/client";
import type {
  ActualizarTarifaInput,
  TarifaDTO,
  CrearTarifaInput,
  ListarTarifasInput,
} from "@/lib/types/tarifa";

// Actor autenticado que ejecuta la operacion. El rol se resuelve desde la
// sesion (R9) y determina la autorizacion (matriz R10-R13).
export interface Actor {
  usuarioId: string;
  rol: RolValue;
}

// Resultados de dominio del servicio (sin acoplarse a HTTP). El borde (Server
// Action) los traduce al resultado tipado expuesto (R26). Sin estado
// `conflict` (id es uuid, nombre no es unico).
export type CrearTarifaServiceResult =
  | { status: "ok"; tarifa: TarifaDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" };

export type ObtenerTarifaServiceResult =
  | { status: "ok"; tarifa: TarifaDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ListarTarifasServiceResult =
  | { status: "ok"; items: TarifaDTO[]; page: number; pageSize: number; total: number }
  | { status: "forbidden" };

export type ActualizarTarifaServiceResult =
  | { status: "ok"; tarifa: TarifaDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };

export type BorrarTarifaServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  // La tarifa esta congelada en algun cierre (`cierre_detail.tarifa_id`, FK
  // RESTRICT): el borrado es fisico y esa fila no se puede sacar.
  | { status: "conflict" };

export interface ITarifaService {
  crear(input: CrearTarifaInput, actor: Actor): Promise<CrearTarifaServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerTarifaServiceResult>;
  listar(input: ListarTarifasInput, actor: Actor): Promise<ListarTarifasServiceResult>;
  actualizar(
    id: string,
    input: ActualizarTarifaInput,
    actor: Actor,
  ): Promise<ActualizarTarifaServiceResult>;
  borrar(id: string, actor: Actor): Promise<BorrarTarifaServiceResult>;
}
