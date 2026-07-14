// Servicio generico para listar usuarios por rol (proyeccion id/nombre para
// selects). Logica de negocio pura (sin HTTP, sin Prisma directo); inyecta
// IUserRepository y reutiliza la estrategia `listByRol` del repositorio. Reemplaza
// el listado "quemado" de mensajeros por una unica implementacion parametrizable.
import type { RolValue } from "@prisma/client";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IUsuariosPorRolService,
  ListarUsuariosPorRolServiceResult,
} from "@/lib/interfaces/services/IUsuariosPorRolService";

// Misma politica de lectura que el listado de mensajeros (feature 16/R1/R5):
// adminTienda/maestro/admin pueden poblar el select; el resto -> forbidden.
const ALLOWED_ROLES = new Set<string>(["adminTienda", "maestro", "admin"]);

export class UsuariosPorRolService implements IUsuariosPorRolService {
  constructor(private readonly userRepo: IUserRepository) {}

  async listarPorRol(
    rolValue: RolValue,
    actor: Actor,
  ): Promise<ListarUsuariosPorRolServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    const usuarios = await this.userRepo.listByRol(rolValue);
    return { status: "ok", usuarios };
  }

  /** Atajo tipado: adminTienda activos, misma estrategia y autorizacion. */
  async listarAdminTiendas(actor: Actor): Promise<ListarUsuariosPorRolServiceResult> {
    return this.listarPorRol("adminTienda", actor);
  }
}
