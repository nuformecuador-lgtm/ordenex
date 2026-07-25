import {
  PlantillaDuplicadaError,
  type IPlantillaMensajeRepository,
  type UpdatePlantillaData,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type {
  Actor,
  ActualizarPlantillaServiceResult,
  CambiarEstadoPlantillaServiceResult,
  CrearPlantillaServiceResult,
  EliminarPlantillaServiceResult,
  IPlantillaMensajeService,
  ListarPlantillasServiceResult,
  ObtenerPlantillaServiceResult,
  PreviewPlantillaServiceResult,
} from "@/lib/interfaces/services/IPlantillaMensajeService";
import type {
  ActualizarPlantillaInput,
  CambiarEstadoPlantillaInput,
  CrearPlantillaInput,
  ListarPlantillasInput,
} from "@/lib/types/plantilla-mensaje";
import { previewConEjemplos, validarCuerpo } from "@/lib/utils/plantilla-mensaje";
import type { PlantillaWhatsappPropagator } from "@/lib/services/whatsapp/plantilla-whatsapp-sync";

// R5: SOLO `maestro` tiene lectura Y escritura del modulo. Cualquier otro rol (incluido
// uno no reconocido) -> forbidden. Patron `UsuarioService.ALLOWED_ROLES`.
const ALLOWED_ROLES = new Set<string>(["maestro"]);

// R16: mensaje de la llave malformada en el cuerpo.
const CUERPO_MALFORMADO = "El cuerpo tiene una llave doble malformada";

export class PlantillaMensajeService implements IPlantillaMensajeService {
  // Integracion WhatsApp: propagador OPCIONAL. Sin el, el CRUD local se comporta igual que
  // antes (no toca Meta) — asi las suites existentes que construyen el service con solo el
  // repo siguen pasando. El borde real (buildPlantillaService) lo inyecta.
  constructor(
    private readonly repo: IPlantillaMensajeRepository,
    private readonly whatsapp?: PlantillaWhatsappPropagator,
  ) {}

  async crear(input: CrearPlantillaInput, actor: Actor): Promise<CrearPlantillaServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    // R16: valida SOLO la forma; R15: deriva las variables a persistir.
    const validado = validarCuerpo(input.cuerpo);
    if (!validado.ok) {
      return { status: "validation_error", fieldErrors: { cuerpo: [CUERPO_MALFORMADO] } };
    }

    try {
      const plantilla = await this.repo.create({
        nombre: input.nombre,
        cuerpo: input.cuerpo,
        variables: validado.variables, // R15
        createdBy: actor.usuarioId, // FK -> usuario creador (R8)
      });
      // Propaga a Meta (sincrono; encola reintento si falla). No bloquea el resultado local.
      await this.whatsapp?.trasCrear(plantilla);
      return { status: "ok", plantilla }; // nace `pending` (R12, default del schema)
    } catch (error) {
      if (error instanceof PlantillaDuplicadaError) {
        return { status: "conflict", campo: error.campo }; // R10
      }
      throw error;
    }
  }

  async listar(
    input: ListarPlantillasInput,
    actor: Actor,
  ): Promise<ListarPlantillasServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.repo.list({ skip, take: input.pageSize }); // R28 en el repo
    return { status: "ok", items, page: input.page, pageSize: input.pageSize, total };
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerPlantillaServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    const plantilla = await this.repo.findById(id); // R28: null si borrada
    if (!plantilla) return { status: "not_found" };
    return { status: "ok", plantilla };
  }

  async actualizar(
    id: string,
    input: ActualizarPlantillaInput,
    actor: Actor,
  ): Promise<ActualizarPlantillaServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    const actual = await this.repo.findById(id);
    if (!actual) return { status: "not_found" }; // R21

    const data: UpdatePlantillaData = {};
    if (input.nombre !== undefined) data.nombre = input.nombre;

    // R22: si el cuerpo cambia, valida su forma (R16) y recalcula variables (R15).
    if (input.cuerpo !== undefined) {
      const validado = validarCuerpo(input.cuerpo);
      if (!validado.ok) {
        return { status: "validation_error", fieldErrors: { cuerpo: [CUERPO_MALFORMADO] } };
      }
      data.cuerpo = input.cuerpo;
      data.variables = validado.variables;
    }

    // R22/R10: unicidad de nombre EXCLUYENDO la propia plantilla.
    if (input.nombre !== undefined && input.nombre !== actual.nombre) {
      const otra = await this.repo.findByNombre(input.nombre);
      if (otra && otra.id !== id) return { status: "conflict", campo: "nombre" };
    }

    try {
      const plantilla = await this.repo.update(id, data);
      if (!plantilla) return { status: "not_found" }; // R21
      // Propaga el cambio a Meta (crea el template si aun no estaba enlazado, o lo actualiza).
      await this.whatsapp?.trasActualizar(plantilla);
      return { status: "ok", plantilla };
    } catch (error) {
      if (error instanceof PlantillaDuplicadaError) {
        return { status: "conflict", campo: error.campo }; // R10 (carrera)
      }
      throw error;
    }
  }

  async cambiarEstado(
    id: string,
    input: CambiarEstadoPlantillaInput,
    actor: Actor,
  ): Promise<CambiarEstadoPlantillaServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    // R24: DESACTIVAR es la unica transicion del front; el schema ya acota a `inactivo`.
    const plantilla = await this.repo.updateEstado(id, input.estado);
    if (!plantilla) return { status: "not_found" }; // R26
    return { status: "ok", plantilla };
  }

  async eliminar(id: string, actor: Actor): Promise<EliminarPlantillaServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    // Se lee el nombre ANTES del soft-delete: el borrado en Meta es por nombre y despues del
    // soft-delete la fila deja de ser visible para el propagador/job.
    const actual = await this.repo.findById(id);
    if (!actual) return { status: "not_found" }; // R29

    const ok = await this.repo.softDelete(id); // R27: soft delete
    if (!ok) return { status: "not_found" }; // R29 (carrera)
    // Solo tiene sentido borrar en Meta si la plantilla llego a enlazarse alli.
    if (actual.templateId !== null) {
      await this.whatsapp?.trasEliminar(id, actual.nombre);
    }
    return { status: "ok" };
  }

  async preview(cuerpo: string, actor: Actor): Promise<PreviewPlantillaServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    // R16: una llave malformada no se renderiza; se reporta como validation_error.
    const validado = validarCuerpo(cuerpo);
    if (!validado.ok) {
      return { status: "validation_error", fieldErrors: { cuerpo: [CUERPO_MALFORMADO] } };
    }
    return { status: "ok", texto: previewConEjemplos(cuerpo) }; // R18/R19
  }
}
