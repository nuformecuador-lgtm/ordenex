import type { RolValue } from "@prisma/client";
import type {
  ActualizarVehiculoInput,
  CrearVehiculoInput,
  VehiculoDTO,
} from "@/lib/types/vehiculos";

// Actor autenticado que ejecuta la operacion. El rol se resuelve desde la sesion
// (resolveActorFromSession) y determina la autorizacion: solo `maestro` (R9/R10).
export interface Actor {
  usuarioId: string;
  rol: RolValue;
}

// Resultados de dominio del servicio (sin acoplarse a HTTP). El borde (Server
// Action) los traduce/expone. `unauthenticated` no aparece aqui: lo resuelve la
// Server Action antes de llamar al service.
export type ListarVehiculosServiceResult =
  | { status: "ok"; items: VehiculoDTO[] }
  | { status: "forbidden" };

export type CrearVehiculoServiceResult =
  | { status: "ok"; vehiculo: VehiculoDTO }
  | { status: "forbidden" }
  | { status: "conflict" } // ya existe un tipo con ese nombre (UNIQUE)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type ActualizarVehiculoServiceResult =
  | { status: "ok"; vehiculo: VehiculoDTO }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type BorrarVehiculoServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "in_use" }; // lo referencia un mensajero o una tarifa de zona

export interface IVehiculoService {
  listar(actor: Actor): Promise<ListarVehiculosServiceResult>;
  crear(input: CrearVehiculoInput, actor: Actor): Promise<CrearVehiculoServiceResult>;
  actualizar(
    id: string,
    input: ActualizarVehiculoInput,
    actor: Actor,
  ): Promise<ActualizarVehiculoServiceResult>;
  borrar(id: string, actor: Actor): Promise<BorrarVehiculoServiceResult>;
}
