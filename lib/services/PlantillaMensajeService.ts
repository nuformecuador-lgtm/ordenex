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
  EnviarAprobacionPlantillaServiceResult,
  IPlantillaMensajeService,
  ListarPlantillasCompletoServiceResult,
  MarcarBienvenidaPlantillaServiceResult,
  ListarPlantillasServiceResult,
  PreviewPlantillaServiceResult,
} from "@/lib/interfaces/services/IPlantillaMensajeService";
import type {
  ActualizarPlantillaInput,
  CambiarEstadoPlantillaInput,
  CrearPlantillaInput,
  ListarPlantillasCompletoInput,
  ListarPlantillasInput,
} from "@/lib/types/plantilla-mensaje";
import { descargaConfig } from "@/lib/config/descarga";
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
        // 2026-08-26: GUARDAR YA NO ES ENVIAR. Nace `saved_not_aprobation` y aqui NO se llama
        // a `trasCrear`: la propagacion a Meta pasa a ser un acto explicito y confirmado del
        // maestro (`enviarAprobacion`). El motivo es que enviar a Meta NO SE PUEDE DESHACER
        // —una vez en revision, ni se cancela ni se retira— y el alta era la unica mutacion
        // del modulo que disparaba un efecto irreversible sin preguntar. Guardar un borrador
        // pasa a costar cero.
        estado: "saved_not_aprobation",
      });
      return { status: "ok", plantilla };
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

  /**
   * Feature 170 (T B.1, design §2.1) — el MISMO listado sin recorte por pagina, para la
   * descarga del dataset completo.
   *
   * Como en usuarios, NO hay `construirWhere` que extraer: `listar` no arma ningun
   * predicado; el `where` (incluida la exclusion de las borradas, `deletedAt: null`) vive
   * ENTERO dentro de `repo.list`. Por eso la paridad de R19 no se consigue copiando un
   * criterio, sino llamando al MISMO metodo: si manana el repositorio cambia lo que
   * excluye, los dos caminos cambian a la vez porque son el mismo camino.
   *
   * El alcance por rol de este listado es su guard: solo `maestro`. Se evalua ANTES de
   * tocar la base (R17).
   */
  async listarCompleto(
    input: ListarPlantillasCompletoInput,
    actor: Actor,
  ): Promise<ListarPlantillasCompletoServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R17
    void input; // el listado no admite filtros: el schema solo tenia `page`/`pageSize`

    const limite = descargaConfig.MAX_FILAS;

    // R29: nunca mas de N+1 filas materializadas; el `total` sigue siendo exacto (sale
    // del `count` del repositorio, independiente del `take`).
    const { items, total } = await this.repo.list({ skip: 0, take: limite + 1 });

    // R27/R28: o van TODAS las filas, o va el error accionable con los conteos. Jamas un
    // archivo truncado en silencio.
    if (total > limite) return { status: "limite_excedido", total, limite };

    return { status: "ok", items, total };
  }

  // BORRADO 2026-08-07 (tanda 2): aqui vivia `obtener`. Su Server Action se borro en la
  // tanda 1 por nacer sin pantalla de detalle. `this.repo.findById` NO muere: lo siguen
  // usando `actualizar` y `eliminar`, que estan vivas.

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
      const actualizada = await this.repo.update(id, data);
      if (!actualizada) return { status: "not_found" }; // R21

      // EDITAR UN BORRADOR NO LO ENVIA. Una plantilla que nunca salio de casa
      // (`saved_not_aprobation` y sin `templateId`) se sigue guardando y sigue siendo un
      // borrador: si el primer `Guardar` de una edicion la mandara a Meta, el estado nuevo
      // duraria exactamente una edicion y "guardar sin aprobacion" no significaria nada.
      // El aviso de la UI —"actualizar la envia para aprobacion"— habla de las OTRAS: las que
      // Meta ya tiene, que es donde editar si tiene consecuencia.
      const esBorradorNuncaEnviado =
        actual.estado === "saved_not_aprobation" && actual.templateId === null;
      if (esBorradorNuncaEnviado) return { status: "ok", plantilla: actualizada };

      // Propaga el cambio a Meta (crea el template si aun no estaba enlazado, o lo actualiza)
      // y la deja EN REVISION. Meta no aprueba una edicion en caliente: el template vuelve a
      // la cola de revision, asi que dejarla `activo` aqui la anunciaria como enviable
      // mientras Meta todavia la mira. `pending` la saca de `listarEnviables` hasta que el
      // cron de 24 h traiga el veredicto. Es la razon de que la UI avise ANTES de editar.
      //
      // Sin WhatsApp configurado no se toca el estado: no hubo envio, y marcarla `pending`
      // seria decir que Meta la esta revisando cuando no ha recibido nada.
      await this.whatsapp?.trasActualizar(actualizada);
      if (this.whatsapp === undefined) return { status: "ok", plantilla: actualizada };
      const plantilla = (await this.repo.updateEstado(id, "pending")) ?? actualizada;
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

  /**
   * Manda la plantilla a revision de Meta y la deja `pending`.
   *
   * NO ES REVERSIBLE y por eso es un metodo aparte con su confirmacion en la UI: una vez que
   * el template entra en revision no hay forma de cancelarlo desde aqui ni desde Meta.
   *
   * El propagador NUNCA lanza: si Meta esta caida encola un job de reintento. Por eso el exito
   * local significa "queda enviada o en cola de envio", que es exactamente lo que `pending`
   * describe; un fallo de red no puede dejar la fila diciendo que sigue guardada sin enviar
   * cuando el reintento la va a mandar en cuanto corra el cron.
   */
  async enviarAprobacion(
    id: string,
    actor: Actor,
  ): Promise<EnviarAprobacionPlantillaServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    const actual = await this.repo.findById(id);
    if (!actual) return { status: "not_found" };

    // Sin credenciales de WhatsApp el CRUD local funciona igual, pero no hay a quien enviar:
    // se dice, en vez de fingir un envio y dejar la fila mintiendo en `pending`.
    if (this.whatsapp === undefined) return { status: "no_configurado" };

    // Ya en revision: no se reenvia (seria una segunda peticion a Meta por el mismo cuerpo) y
    // tampoco es un error que el maestro tenga que resolver.
    if (actual.estado === "pending") return { status: "ya_enviada", plantilla: actual };

    await this.whatsapp.trasActualizar(actual); // crea el template si no estaba enlazado
    const plantilla = (await this.repo.updateEstado(id, "pending")) ?? actual;
    return { status: "ok", plantilla };
  }

  /**
   * Marca la plantilla como MENSAJE DE BIENVENIDA (el envio automatico al recoger el paquete).
   *
   * NO toca Meta ni el estado de revision: elegir cual es la de bienvenida es una decision
   * local sobre plantillas que ya existen, no un cambio del texto que Meta aprobo. Por eso
   * tampoco hay confirmacion en la UI: es reversible marcando otra.
   *
   * Se permite desde CUALQUIER estado a proposito. Acotarlo a `activo` obligaria al maestro a
   * esperar la aprobacion de Meta para poder siquiera declarar su intencion, y el momento del
   * envio —que es quien tiene que exigir una plantilla enviable— no es este.
   */
  async marcarMensajeBienvenida(
    id: string,
    actor: Actor,
  ): Promise<MarcarBienvenidaPlantillaServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R5

    const plantilla = await this.repo.marcarWelcomeMessage(id);
    if (!plantilla) return { status: "not_found" }; // no existe o esta borrada
    return { status: "ok", plantilla };
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
