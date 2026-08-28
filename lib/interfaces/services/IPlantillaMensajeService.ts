import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { PlantillaEstado } from "@prisma/client";
import type { PlantillaPublica } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type {
  ActualizarPlantillaInput,
  CambiarEstadoPlantillaInput,
  CrearPlantillaInput,
  ListarPlantillasCompletoInput,
  ListarPlantillasInput,
  PlantillaListItemDTO,
} from "@/lib/types/plantilla-mensaje";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// Feature 107 — contrato del service. Reutiliza el `Actor` de IOrdenService
// (`{ usuarioId, rol }`), resuelto desde la sesion (R4). SOLO `maestro` (R5).
export type { Actor };

export type CrearPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R16
  | { status: "conflict"; campo: "nombre" } // R10
  | { status: "forbidden" }; // R5

// Feature 170 (T H.2): reexpresado sobre el contrato comun de listado paginado
// (`lib/types/listado-paginado`). Misma forma, una sola definicion.
export type ListarPlantillasServiceResult = ListarPaginadoServiceResult<PlantillaListItemDTO>;

/**
 * Feature 170 (T B.1) — lectura SIN paginacion para la descarga. Mismo guard de rol
 * (`maestro`) que `listar`, de modo que `forbidden` y `limite_excedido` no puedan viajar
 * con filas (R17/R27).
 */
export type ListarPlantillasCompletoServiceResult =
  ListarCompletoServiceResult<PlantillaListItemDTO>;

// BORRADO 2026-08-07 (tanda 2): aqui vivia `ObtenerPlantillaServiceResult`, del metodo
// `obtener` que se va de esta interfaz mas abajo.

export type ActualizarPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R16
  | { status: "conflict"; campo: "nombre" } // R10/R22
  | { status: "forbidden" }
  | { status: "not_found" }; // R21

export type CambiarEstadoPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "forbidden" }
  | { status: "not_found" }; // R26

export type EliminarPlantillaServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }; // R29

/**
 * ENVIO A APROBACION (2026-08-26). Propaga la plantilla a Meta y la deja `pending`.
 *
 * `no_configurado` es un estado propio y no un error generico: si faltan las credenciales de
 * WhatsApp el CRUD local sigue vivo (asi nacio el modulo) pero NO hay nada que aprobar, y
 * decirle al maestro "listo, enviada" cuando no salio nada seria mentirle. `ya_enviada` = la
 * plantilla ya estaba en revision; no se reenvia ni se cuenta como error.
 */
export type EnviarAprobacionPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "ya_enviada"; plantilla: PlantillaPublica }
  | { status: "no_configurado" }
  /**
   * La plantilla es DE TIENDA: su texto no va a Meta, asi que no hay aprobacion que pedir.
   * La UI ya le oculta el boton, pero el guard vive AQUI y no solo alli: ocultar un boton no
   * es impedir la accion, y esta es irreversible (crea un template en Meta que no se retira).
   */
  | { status: "no_aplica" }
  | { status: "forbidden" }
  | { status: "not_found" };

/**
 * MARCAR MENSAJE DE BIENVENIDA. No tiene rama de conflicto: marcar una plantilla DESMARCA la
 * anterior en la misma transaccion, asi que "ya hay otra" no es un problema que el maestro
 * tenga que resolver antes, es justo lo que la accion significa.
 */
/**
 * `estado_invalido` (2026-08-27): la plantilla existe pero NO esta `activo`, y la bienvenida
 * se envia sola —sin nadie que corrija—, asi que solo puede marcarse una enviable. Lleva el
 * `estado` que tiene para que la UI pueda decir CUAL es el problema y no un «no se pudo».
 * No es un `validation_error`: no hay ningun campo del formulario que el maestro pueda
 * arreglar, lo que falta es que Meta apruebe la plantilla.
 */
export type MarcarBienvenidaPlantillaServiceResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "estado_invalido"; estado: PlantillaEstado }
  /**
   * La plantilla es DE TIENDA: la bienvenida sale por Meta y esta nunca se envio alli, asi
   * que no hay template que mandar. Es un desenlace distinto de `estado_invalido` porque no
   * se arregla esperando: no es un tramite pendiente, es que no le corresponde.
   */
  | { status: "no_aplica" };

export type PreviewPlantillaServiceResult =
  | { status: "ok"; texto: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R16
  | { status: "forbidden" };

export interface IPlantillaMensajeService {
  crear(input: CrearPlantillaInput, actor: Actor): Promise<CrearPlantillaServiceResult>;
  listar(input: ListarPlantillasInput, actor: Actor): Promise<ListarPlantillasServiceResult>;
  /**
   * Feature 170/R9: el MISMO listado sin recorte por pagina, para la descarga. Reusa el
   * `repo.list` del listado —el que ya excluye las borradas (R19)— con `skip: 0` y
   * `take: tope + 1`, mas el guard del tope (R27/R29).
   */
  listarCompleto(
    input: ListarPlantillasCompletoInput,
    actor: Actor,
  ): Promise<ListarPlantillasCompletoServiceResult>;
  actualizar(
    id: string,
    input: ActualizarPlantillaInput,
    actor: Actor,
  ): Promise<ActualizarPlantillaServiceResult>;
  cambiarEstado(
    id: string,
    input: CambiarEstadoPlantillaInput,
    actor: Actor,
  ): Promise<CambiarEstadoPlantillaServiceResult>;
  eliminar(id: string, actor: Actor): Promise<EliminarPlantillaServiceResult>;
  /**
   * Manda la plantilla a revision de Meta y la deja `pending`. Es la UNICA via por la que una
   * plantilla sale hacia Meta desde el alta: `crear` ya no propaga (2026-08-26).
   */
  enviarAprobacion(id: string, actor: Actor): Promise<EnviarAprobacionPlantillaServiceResult>;
  /**
   * Deja ESTA plantilla como el mensaje de bienvenida (el que sale solo cuando el paquete es
   * recogido) y quita la marca de la que la tuviera. Es un `set`, no un `toggle`: desde la UI
   * no se desmarca sin elegir otra, porque "sin bienvenida" no es un estado que se pida.
   */
  marcarMensajeBienvenida(
    id: string,
    actor: Actor,
  ): Promise<MarcarBienvenidaPlantillaServiceResult>;
  preview(cuerpo: string, actor: Actor): Promise<PreviewPlantillaServiceResult>;
}
