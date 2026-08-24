import type { IVehiculoRepository } from "@/lib/interfaces/repositories/IVehiculoRepository";
import type {
  Actor,
  ActualizarVehiculoServiceResult,
  BorrarVehiculoServiceResult,
  CrearVehiculoServiceResult,
  IVehiculoService,
  ListarVehiculosServiceResult,
} from "@/lib/interfaces/services/IVehiculoService";
import type { ActualizarVehiculoInput, CrearVehiculoInput } from "@/lib/types/vehiculos";

// Autz del catalogo vehiculos: SOLO `maestro` (R9). Cualquier otro rol
// (admin/mensajero/adminTienda/adminSatelite o desconocido) -> forbidden (R10).
// La ausencia de sesion (unauthenticated) se resuelve antes, en la Server Action.
// Lectura y escritura comparten el mismo conjunto: quien ve el catalogo es quien lo
// administra, y abrir la lectura a mas roles seria una decision de producto aparte.
const READ_ROLES = new Set<string>(["maestro"]);
const WRITE_ROLES = new Set<string>(["maestro"]);

export class VehiculoService implements IVehiculoService {
  constructor(private readonly repo: IVehiculoRepository) {}

  async listar(actor: Actor): Promise<ListarVehiculosServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R10
    return { status: "ok", items: await this.repo.findMany() };
  }

  async crear(input: CrearVehiculoInput, actor: Actor): Promise<CrearVehiculoServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" };

    // El nombre llega YA normalizado por el schema del borde (recortado y con los
    // espacios internos colapsados), asi que la comprobacion de duplicado compara
    // la misma forma que se va a persistir.
    if (await this.repo.findByName(input.name)) return { status: "conflict" };

    return { status: "ok", vehiculo: await this.repo.create(input.name) };
  }

  async actualizar(
    id: string,
    input: ActualizarVehiculoInput,
    actor: Actor,
  ): Promise<ActualizarVehiculoServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" };

    const existente = await this.repo.findById(id);
    if (!existente) return { status: "not_found" };

    // Renombrar a un nombre que YA tiene otra fila es conflict; renombrarse a si
    // mismo (mismo id) no lo es -guardar sin cambios tiene que seguir funcionando-.
    const conEseNombre = await this.repo.findByName(input.name);
    if (conEseNombre && conEseNombre.id !== id) return { status: "conflict" };

    const actualizado = await this.repo.update(id, input.name);
    if (!actualizado) return { status: "not_found" }; // carrera: borrado entre medias
    return { status: "ok", vehiculo: actualizado };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarVehiculoServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" };

    const existente = await this.repo.findById(id);
    if (!existente) return { status: "not_found" };

    // Se pregunta ANTES de borrar para poder decir "esta en uso" en vez de traducir
    // a ciegas el fallo de la FK. La base sigue siendo la garantia real (RESTRICT):
    // esta comprobacion es para el MENSAJE, no para la integridad.
    if ((await this.repo.contarUsos(id)) > 0) return { status: "in_use" };

    const ok = await this.repo.delete(id);
    if (!ok) return { status: "not_found" };
    return { status: "ok" };
  }
}
