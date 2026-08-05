import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarGastoFijoPlantillaInput,
  CrearGastoFijoPlantillaInput,
  GastoFijoPlantillaDTO,
  SetActivaPlantillaInput,
} from "@/lib/types/gasto-fijo-plantilla";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// Feature 45 (design §2.2b) — contrato del servicio de PLANTILLAS de gasto fijo (CRUD del
// maestro). Rol autorizado: maestro (R17). Resultados de dominio (sin acoplar a HTTP). Sin
// borrado (R25): la desactivacion es el mecanismo para dejar de generar. Money-safe: DTOs con
// montos STRING.

export type CrearPlantillaServiceResult =
  | { status: "ok"; plantilla: GastoFijoPlantillaDTO }
  | { status: "forbidden" };

export type ActualizarPlantillaServiceResult =
  | { status: "ok"; plantilla: GastoFijoPlantillaDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export type SetActivaPlantillaServiceResult =
  | { status: "ok"; plantilla: GastoFijoPlantillaDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ListarPlantillasServiceResult =
  | { status: "ok"; plantillas: GastoFijoPlantillaDTO[] }
  | { status: "forbidden" };

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41): UNA PAGINA de las plantillas + el total del
 * conjunto. Contrato comun de T H.2, sin campos extra.
 */
export type ListarPlantillasPaginadoServiceResult =
  ListarPaginadoServiceResult<GastoFijoPlantillaDTO>;

/**
 * Feature 184 — Tanda G (R1/R6) — el CONJUNTO de las plantillas para el archivo, sin recorte.
 * Ni `forbidden` ni `limite_excedido` viajan nunca con filas.
 */
export type ListarPlantillasCompletoServiceResult =
  ListarCompletoServiceResult<GastoFijoPlantillaDTO>;

export interface IGastoFijoPlantillaService {
  /** R17/R24: solo maestro; crea una plantilla (activa=true). Forbidden sin efectos. */
  crearPlantilla(
    input: CrearGastoFijoPlantillaInput,
    actor: Actor,
  ): Promise<CrearPlantillaServiceResult>;
  /** R17/R25: solo maestro; edita concepto/monto. not_found si el id no existe. */
  actualizarPlantilla(
    input: ActualizarGastoFijoPlantillaInput,
    actor: Actor,
  ): Promise<ActualizarPlantillaServiceResult>;
  /** R17/R25: solo maestro; activa/desactiva (sin borrado). not_found si el id no existe. */
  setActivaPlantilla(
    input: SetActivaPlantillaInput,
    actor: Actor,
  ): Promise<SetActivaPlantillaServiceResult>;
  /** R17/R26: solo maestro; lista todas las plantillas (activas e inactivas). */
  listarPlantillas(actor: Actor): Promise<ListarPlantillasServiceResult>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): las plantillas, paginadas en el
   * servidor.
   *
   * MISMA guardia de rol que `listarPlantillas` (`esAccesoTotal`, R17) evaluada ANTES de
   * tocar el repositorio: paginar no puede ensanchar el alcance de nadie (R44). Cualquier otro
   * rol -> forbidden, sin filas y sin total.
   */
  listarPlantillasPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPlantillasPaginadoServiceResult>;
  /**
   * Feature 184 — Tanda G (R1/R4/R6): el MISMO listado sin recorte por pagina, para el archivo.
   *
   * MISMA guardia de rol (`esAccesoTotal`) evaluada ANTES de tocar el repositorio, la MISMA
   * lectura de la que sale la pagina (`listar()`) y el tope del servidor. Sin parametro de
   * entrada: este listado no admite filtros, asi que no hay nada que transportar.
   */
  listarPlantillasCompleto(actor: Actor): Promise<ListarPlantillasCompletoServiceResult>;
}
