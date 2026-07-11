import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
  type IUserRepository,
  type UpdateUsuarioData,
  type UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import type {
  Actor,
  ActualizarUsuarioServiceResult,
  CambiarEstadoUsuarioServiceResult,
  CrearUsuarioServiceResult,
  IUsuarioService,
  ListarRolesServiceResult,
  ListarTiposIdentificacionServiceResult,
  ListarUsuariosServiceResult,
  ObtenerUsuarioServiceResult,
} from "@/lib/interfaces/services/IUsuarioService";
import type {
  ActualizarUsuarioInput,
  CambiarEstadoUsuarioInput,
  CrearUsuarioInput,
  ListarUsuariosInput,
} from "@/lib/types/usuario";
import { hashPassword } from "@/lib/utils/password";
import { generateStrongPassword } from "@/lib/utils/password-generator";

// Decision 1: SOLO `maestro` tiene lectura Y escritura del modulo. Cualquier otro
// rol (incluido uno no reconocido) -> forbidden (R3/R4).
const ALLOWED_ROLES = new Set<string>(["maestro"]);

export class UsuarioService implements IUsuarioService {
  constructor(private readonly repo: IUserRepository) {}

  async crear(input: CrearUsuarioInput, actor: Actor): Promise<CrearUsuarioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R3/R4

    // R30: resuelve la contrasena segun el modo. Nunca se loguea (R25/R34).
    const generated = input.passwordMode === "generate";
    const plain = generated ? generateStrongPassword() : input.password; // R32/R31
    const passwordHash = await hashPassword(plain); // R7/R34: solo se persiste el hash

    // Feature 27/R4a (Decision P1): la invariante de rol se calcula aqui, NO se
    // confia en la UI. Solo `adminTienda` puede quedar con `fulfillment = true`.
    const fulfillment = await this.resolverFulfillment(input.rolId, input.fulfillment ?? false);

    try {
      const usuario = await this.repo.create({
        nombre: input.nombre,
        email: input.email,
        telefono: input.telefono,
        cedula: input.cedula,
        tipoIdentificacionId: input.tipoIdentificacionId,
        rolId: input.rolId,
        passwordHash,
        estado: "activo", // R8: nace activo (a diferencia de la postulacion publica)
        fulfillment, // R8/R9: valor efectivo ya restringido por rol
      });
      // R33: contrasena en claro UNA vez solo en modo autogenerado; R35: nunca en manual.
      return generated
        ? { status: "ok", usuario, generatedPassword: plain }
        : { status: "ok", usuario };
    } catch (error) {
      return this.mapCrearError(error);
    }
  }

  async listar(input: ListarUsuariosInput, actor: Actor): Promise<ListarUsuariosServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R3/R4

    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.repo.list({
      skip,
      take: input.pageSize, // ya acotado a MAX_PAGE_SIZE por el schema (R13)
      sortBy: input.sortBy,
      sortDir: input.sortDir,
    });

    return { status: "ok", items, page: input.page, pageSize: input.pageSize, total };
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerUsuarioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R3/R4

    const usuario = await this.repo.findById(id);
    if (!usuario) return { status: "not_found" };
    return { status: "ok", usuario };
  }

  async actualizar(
    id: string,
    input: ActualizarUsuarioInput,
    actor: Actor,
  ): Promise<ActualizarUsuarioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R3/R4

    // Feature 27/R12/R4a: se recalcula `fulfillment` con el rol resultante, por lo
    // que se necesita el usuario actual (rol e/o valor previo). `null` -> not_found.
    const actual = await this.repo.findById(id);
    if (!actual) return { status: "not_found" }; // R17

    const data = await this.buildUpdateData(input, actual); // R16: solo campos editables
    try {
      const usuario = await this.repo.update(id, data);
      if (!usuario) return { status: "not_found" }; // R17
      return { status: "ok", usuario }; // R19
    } catch (error) {
      if (error instanceof CatalogoInvalidoError) {
        return { status: "validation_error", fieldErrors: { [error.campo]: [error.message] } }; // R18
      }
      throw error;
    }
  }

  async cambiarEstado(
    id: string,
    input: CambiarEstadoUsuarioInput,
    actor: Actor,
  ): Promise<CambiarEstadoUsuarioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R3/R4

    const usuario = await this.repo.setEstado(id, input.estado); // R20/R21: baja logica
    if (!usuario) return { status: "not_found" }; // R22
    return { status: "ok", usuario };
  }

  async listarTiposIdentificacion(
    actor: Actor,
  ): Promise<ListarTiposIdentificacionServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R3/R4

    const tipos = await this.repo.listTiposIdentificacion(); // R29
    return { status: "ok", tipos };
  }

  async listarRoles(actor: Actor): Promise<ListarRolesServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R3/R4

    const roles = await this.repo.listRoles();
    return { status: "ok", roles };
  }

  // R9/R10/R11: traduce los errores de dominio del repositorio a resultados
  // discriminados. Nunca expone la contrasena ni el hash.
  private mapCrearError(error: unknown): CrearUsuarioServiceResult {
    if (error instanceof CatalogoInvalidoError) {
      return { status: "validation_error", fieldErrors: { [error.campo]: [error.message] } }; // R9
    }
    if (error instanceof UsuarioDuplicadoError) {
      return { status: "conflict", campo: error.campo }; // R10/R11
    }
    throw error;
  }

  private async buildUpdateData(
    input: ActualizarUsuarioInput,
    actual: UsuarioPublico,
  ): Promise<UpdateUsuarioData> {
    const data: UpdateUsuarioData = {};
    if (input.nombre !== undefined) data.nombre = input.nombre;
    if (input.telefono !== undefined) data.telefono = input.telefono;
    if (input.rolId !== undefined) data.rolId = input.rolId;
    if (input.tipoIdentificacionId !== undefined) {
      data.tipoIdentificacionId = input.tipoIdentificacionId;
    }

    // Feature 27/R12/R4a: se recalcula solo si cambia `fulfillment` o el rol. Con
    // el rol resultante (el nuevo si se edita, o el actual) se aplica la invariante:
    // solo `adminTienda` puede quedar en `true`; un cambio a otro rol fuerza `false`.
    // Si el rol se mantiene `adminTienda` y no se envia `fulfillment`, se conserva
    // el valor actual (no se pisa por defecto).
    if (input.fulfillment !== undefined || input.rolId !== undefined) {
      const rolIdResultante = input.rolId ?? actual.rolId;
      const deseado = input.fulfillment ?? actual.fulfillment;
      data.fulfillment = await this.resolverFulfillment(rolIdResultante, deseado);
    }
    return data;
  }

  // Feature 27/R4a (Decision P1): resuelve el flag efectivo. Solo `adminTienda`
  // puede quedar en `true`; para cualquier otro rol se fuerza `false`, ignorando
  // un `true` recibido. El `value` del rol se resuelve desde su `id` via el repo.
  private async resolverFulfillment(rolId: string, deseado: boolean): Promise<boolean> {
    if (!deseado) return false;
    const roles = await this.repo.listRoles();
    const rolValue = roles.find((r) => r.id === rolId)?.value;
    return rolValue === "adminTienda";
  }
}
