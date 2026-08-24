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

  // El duenno referenciado debe ser un usuario con un rol tarifable: adminTienda
  // (tienda humana) o apiKey (cuenta dedicada de una API key, feature 81), que
  // tambien factura sus propias ordenes. Invariante de negocio; patron
  // `fulfillment` de la feature 27.
  // La zona referenciada (opcional) debe existir. Sin esta comprobacion un id
  // invalido escaparia como error crudo de FK en vez de como validation_error.
  private readonly ZONA_NO_EXISTE = {
    status: "validation_error" as const,
    fieldErrors: { zonaId: ["la zona indicada no existe"] },
  };

  private readonly TIENDA_NO_TARIFABLE = {
    status: "validation_error" as const,
    fieldErrors: {
      tiendaId: ["la tarifa debe asignarse a un adminTienda o a una API key"],
    },
  };

  async crear(input: CrearTarifaInput, actor: Actor): Promise<CrearTarifaServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    // Solo se comprueba si viene: `tiendaId` es opcional (null = no acotada a
    // ninguna tienda). Una tarifa sin tienda no tiene duenno cuyo rol validar.
    if (input.tiendaId != null && !(await this.repo.esTiendaAsignable(input.tiendaId))) {
      return this.TIENDA_NO_TARIFABLE;
    }

    // Solo se comprueba si viene: `zonaId` es opcional (null = no acotada).
    if (input.zonaId != null && !(await this.repo.existeZona(input.zonaId))) {
      return this.ZONA_NO_EXISTE;
    }

    const tarifa = await this.repo.create({
      tiendaId: input.tiendaId ?? null,
      valorFlete: input.valorFlete,
      valorFleteDevuelto: input.valorFleteDevuelto,
      valorFleteGam: input.valorFleteGam,
      valorFleteDevueltoGam: input.valorFleteDevueltoGam,
      fulfillment: input.fulfillment,
      comisionCod: input.comisionCod,
      ivaFlete: input.ivaFlete,
      ivaComisionCod: input.ivaComisionCod,
      tarifaEspecial: input.tarifaEspecial ?? null, // opcional: ausente = sin pacto especial
      zonaId: input.zonaId ?? null, // opcional: ausente = no acotada a una zona
      isDefault: input.isDefault ?? false, // marcarla por defecto es explicito
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

    const existente = await this.repo.findById(id);
    if (!existente) return { status: "not_found" }; // R21

    // Si se reasigna el duenno o se reactiva la tarifa, el duenno efectivo DEBE
    // seguir teniendo un rol tarifable (no se reactiva la tarifa de una cuenta
    // degradada, ni la de una API key que perdio su rol).
    // `tiendaEfectiva` puede quedar en null (la tarifa deja de estar acotada, o ya
    // no lo estaba): ahi no hay rol que exigir y la comprobacion no aplica.
    if (input.tiendaId !== undefined || input.status === "activo") {
      const tiendaEfectiva = input.tiendaId ?? existente.tiendaId;
      if (tiendaEfectiva != null && !(await this.repo.esTiendaAsignable(tiendaEfectiva))) {
        return this.TIENDA_NO_TARIFABLE;
      }
    }

    // Reasignar a una zona exige que exista; `null` (desacotar) no comprueba nada.
    if (input.zonaId != null && !(await this.repo.existeZona(input.zonaId))) {
      return this.ZONA_NO_EXISTE;
    }

    // R22: aplica solo los campos provistos, no toca id/created_at.
    const data = this.buildUpdateData(input);
    const actualizado = await this.repo.update(id, data);
    if (!actualizado) return { status: "not_found" }; // carrera: borrado entre medias
    return { status: "ok", tarifa: actualizado };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarTarifaServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R11/R12/R13

    const existente = await this.repo.findById(id);
    if (!existente) return { status: "not_found" };

    // Borrado FISICO (la tabla ya no tiene `deleted_at`). `referenced` = la tarifa
    // quedo congelada en un cierre y la FK RESTRICT no deja sacarla: es un conflicto
    // con el estado actual, no un "no existe". Patron `ZonaService.borrar`.
    const res = await this.repo.hardDelete(id);
    if (res === "not_found") return { status: "not_found" }; // carrera
    if (res === "referenced") return { status: "conflict" };
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
    // `null` viaja tal cual (limpia el pacto especial); solo `undefined` se ignora.
    if (input.tarifaEspecial !== undefined) data.tarifaEspecial = input.tarifaEspecial;
    // `null` viaja tal cual (desacota de la zona); solo `undefined` se ignora.
    if (input.zonaId !== undefined) data.zonaId = input.zonaId;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    return data;
  }
}
