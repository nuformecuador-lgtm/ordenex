import type { RolValue } from "@prisma/client";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

// Actor autenticado que ejecuta la operacion. El rol se resuelve desde la sesion
// (resolveActorFromSession) y determina la autorizacion: solo `maestro` (R9/R10).
export interface Actor {
  usuarioId: string;
  rol: RolValue;
}

// Resultados de dominio del servicio (sin acoplarse a HTTP). El borde (Server
// Action) los traduce/expone. P1=A: solo lectura, sin validation_error/conflict.
export type ListarVehiculosServiceResult =
  | { status: "ok"; items: VehiculoDTO[] }
  | { status: "forbidden" };

export type ObtenerVehiculoServiceResult =
  | { status: "ok"; vehiculo: VehiculoDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export interface IVehiculoService {
  listar(actor: Actor): Promise<ListarVehiculosServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerVehiculoServiceResult>;
}
