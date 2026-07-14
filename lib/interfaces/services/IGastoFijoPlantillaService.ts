import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarGastoFijoPlantillaInput,
  CrearGastoFijoPlantillaInput,
  GastoFijoPlantillaDTO,
  SetActivaPlantillaInput,
} from "@/lib/types/gasto-fijo-plantilla";

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
}
