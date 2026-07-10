import type { ICobroRepository, UpdateCobroData } from "@/lib/interfaces/repositories/ICobroRepository";
import type {
  Actor,
  ActualizarCobroServiceResult,
  BorrarCobroServiceResult,
  CrearCobroServiceResult,
  ICobroService,
  ListarCobrosServiceResult,
  ObtenerCobroServiceResult,
} from "@/lib/interfaces/services/ICobroService";
import type { ActualizarCobroInput, CrearCobroInput, ListarCobrosInput } from "@/lib/types/cobro";

// Matriz rol -> operacion (R9-R13). maestro CRUD completo (R10); admin solo
// lectura (R11); adminTienda/mensajero sin acceso (R12); un rol no reconocido
// no pertenece a ninguno de los dos conjuntos -> forbidden (R13).
const READ_ROLES = new Set<string>(["maestro", "admin"]); // R10/R11
const WRITE_ROLES = new Set<string>(["maestro"]); // R10/R11/D4: solo maestro escribe

export class CobroService implements ICobroService {
  constructor(private readonly repo: ICobroRepository) {}

  async crear(input: CrearCobroInput, actor: Actor): Promise<CrearCobroServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const cobro = await this.repo.create({
      nombre: input.nombre,
      valorFlete: input.valorFlete,
      valorFleteDevuelto: input.valorFleteDevuelto,
      valorFleteGam: input.valorFleteGam,
      valorFleteDevueltoGam: input.valorFleteDevueltoGam,
      fulfillment: input.fulfillment,
      comisionCod: input.comisionCod,
      ivaFlete: input.ivaFlete,
      ivaComisionCod: input.ivaComisionCod,
    });
    return { status: "ok", cobro }; // R16
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerCobroServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const cobro = await this.repo.findById(id); // excluye borrados (R19)
    if (!cobro) return { status: "not_found" }; // R17
    return { status: "ok", cobro };
  }

  async listar(input: ListarCobrosInput, actor: Actor): Promise<ListarCobrosServiceResult> {
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
    input: ActualizarCobroInput,
    actor: Actor,
  ): Promise<ActualizarCobroServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const existente = await this.repo.findById(id); // excluye borrados (R19)
    if (!existente) return { status: "not_found" }; // R21

    // R22: aplica solo los campos provistos, no toca id/created_at.
    const data = this.buildUpdateData(input);
    const actualizado = await this.repo.update(id, data);
    if (!actualizado) return { status: "not_found" }; // carrera: borrado entre medias
    return { status: "ok", cobro: actualizado };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarCobroServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const existente = await this.repo.findById(id); // excluye ya borrados (R25)
    if (!existente) return { status: "not_found" }; // R25

    const ok = await this.repo.softDelete(id); // R24: soft delete
    if (!ok) return { status: "not_found" };
    return { status: "ok" };
  }

  private buildUpdateData(input: ActualizarCobroInput): UpdateCobroData {
    const data: UpdateCobroData = {};
    if (input.nombre !== undefined) data.nombre = input.nombre;
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
