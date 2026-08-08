import type { IVehiculoRepository } from "@/lib/interfaces/repositories/IVehiculoRepository";
import type {
  Actor,
  IVehiculoService,
  ListarVehiculosServiceResult,
} from "@/lib/interfaces/services/IVehiculoService";

// Autz del catalogo vehiculos: SOLO `maestro` (R9). Cualquier otro rol
// (admin/mensajero/adminTienda/adminSatelite o desconocido) -> forbidden (R10).
// La ausencia de sesion (unauthenticated) se resuelve antes, en la Server Action.
const READ_ROLES = new Set<string>(["maestro"]);

export class VehiculoService implements IVehiculoService {
  constructor(private readonly repo: IVehiculoRepository) {}

  async listar(actor: Actor): Promise<ListarVehiculosServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R10
    const items = await this.repo.findMany(); // 3 filas: moto/carro/camion (R11)
    return { status: "ok", items };
  }

  // BORRADO 2026-08-07 (tanda 2): aqui vivia `obtener`. Su Server Action se borro en la
  // tanda 1 por no existir pantalla de vehiculos. El catalogo sigue siendo legible entero
  // por `listar`, que es lo unico que `configuracion/tarifas/page.tsx` necesita.
}
