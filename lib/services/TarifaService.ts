import type { ITarifaRepository, UpdateTarifaData } from "@/lib/interfaces/repositories/ITarifaRepository";
import type {
  Actor,
  ActualizarTarifaServiceResult,
  BorrarTarifaServiceResult,
  CrearTarifaServiceResult,
  ITarifaService,
  ListarTarifasServiceResult,
  ObtenerTarifaServiceResult,
} from "@/lib/interfaces/services/ITarifaService";
import type { ActualizarTarifaInput, CrearTarifaInput, ListarTarifasInput } from "@/lib/types/tarifa";

// Matriz rol -> operacion (R9-R13). maestro CRUD completo (R10); admin solo
// lectura (R11); adminTienda/mensajero sin acceso (R12); un rol no reconocido
// no pertenece a ninguno de los dos conjuntos -> forbidden (R13).
const READ_ROLES = new Set<string>(["maestro", "admin"]); // R10/R11
const WRITE_ROLES = new Set<string>(["maestro"]); // R10/R11/D4: solo maestro escribe

export class TarifaService implements ITarifaService {
  constructor(private readonly repo: ITarifaRepository) {}

  // La tienda referenciada debe ser un usuario con rol adminTienda (invariante
  // de negocio; patron `fulfillment` de la feature 27).
  private readonly TIENDA_NO_ADMIN = {
    status: "validation_error" as const,
    fieldErrors: { tiendaId: ["la tienda debe ser un usuario adminTienda"] },
  };

  async crear(input: CrearTarifaInput, actor: Actor): Promise<CrearTarifaServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    if (!(await this.repo.esTiendaAdminTienda(input.tiendaId))) return this.TIENDA_NO_ADMIN;

    const tarifa = await this.repo.create({
      tiendaId: input.tiendaId,
      valorFlete: input.valorFlete,
      valorFleteDevuelto: input.valorFleteDevuelto,
      valorFleteGam: input.valorFleteGam,
      valorFleteDevueltoGam: input.valorFleteDevueltoGam,
      fulfillment: input.fulfillment,
      comisionCod: input.comisionCod,
      ivaFlete: input.ivaFlete,
      ivaComisionCod: input.ivaComisionCod,
    });
    return { status: "ok", tarifa }; // R16
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerTarifaServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const tarifa = await this.repo.findById(id); // excluye borrados (R19)
    if (!tarifa) return { status: "not_found" }; // R17
    return { status: "ok", tarifa };
  }

  async listar(input: ListarTarifasInput, actor: Actor): Promise<ListarTarifasServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.repo.list({
      skip,
      take: input.pageSize, // ya acotado a MAX_PAGE_SIZE por el schema (R18)
    });

    return {
      status: "ok",
      items,
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async actualizar(
    id: string,
    input: ActualizarTarifaInput,
    actor: Actor,
  ): Promise<ActualizarTarifaServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const existente = await this.repo.findById(id); // excluye borrados (R19)
    if (!existente) return { status: "not_found" }; // R21

    // Si se reasigna la tienda o se reactiva la tarifa, la tienda efectiva DEBE
    // seguir siendo adminTienda (no se reactiva una tarifa de una tienda degradada).
    if (input.tiendaId !== undefined || input.status === "activo") {
      const tiendaEfectiva = input.tiendaId ?? existente.tiendaId;
      if (!(await this.repo.esTiendaAdminTienda(tiendaEfectiva))) return this.TIENDA_NO_ADMIN;
    }

    // R22: aplica solo los campos provistos, no toca id/created_at.
    const data = this.buildUpdateData(input);
    const actualizado = await this.repo.update(id, data);
    if (!actualizado) return { status: "not_found" }; // carrera: borrado entre medias
    return { status: "ok", tarifa: actualizado };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarTarifaServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const existente = await this.repo.findById(id); // excluye ya borrados (R25)
    if (!existente) return { status: "not_found" }; // R25

    const ok = await this.repo.softDelete(id); // R24: soft delete
    if (!ok) return { status: "not_found" };
    return { status: "ok" };
  }

  private buildUpdateData(input: ActualizarTarifaInput): UpdateTarifaData {
    const data: UpdateTarifaData = {};
    if (input.tiendaId !== undefined) data.tiendaId = input.tiendaId;
    if (input.status !== undefined) data.status = input.status;
    if (input.valorFlete !== undefined) data.valorFlete = input.valorFlete;
    if (input.valorFleteDevuelto !== undefined) data.valorFleteDevuelto = input.valorFleteDevuelto;
    if (input.valorFleteGam !== undefined) data.valorFleteGam = input.valorFleteGam;
    if (input.valorFleteDevueltoGam !== undefined) {
      data.valorFleteDevueltoGam = input.valorFleteDevueltoGam;
    }
    if (input.fulfillment !== undefined) data.fulfillment = input.fulfillment;
    if (input.comisionCod !== undefined) data.comisionCod = input.comisionCod;
    if (input.ivaFlete !== undefined) data.ivaFlete = input.ivaFlete;
    if (input.ivaComisionCod !== undefined) data.ivaComisionCod = input.ivaComisionCod;
    return data;
  }
}
