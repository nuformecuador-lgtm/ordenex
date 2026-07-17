import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  ActualizarPlantillaServiceResult,
  CrearPlantillaServiceResult,
  IGastoFijoPlantillaService,
  ListarPlantillasServiceResult,
  SetActivaPlantillaServiceResult,
} from "@/lib/interfaces/services/IGastoFijoPlantillaService";
import type {
  ActualizarGastoFijoPlantillaInput,
  CrearGastoFijoPlantillaInput,
  SetActivaPlantillaInput,
} from "@/lib/types/gasto-fijo-plantilla";

// Rol autorizado (R17): el maestro (dueno de la caja central), espejo de WalletService.
const ROL_AUTORIZADO = "maestro";

/**
 * Feature 45 — logica de negocio de las PLANTILLAS de gasto fijo (CRUD del maestro). No conoce
 * HTTP ni Prisma directamente: recibe el repo por inyeccion. Guardia de rol maestro (R17) en
 * TODOS los metodos. Sin borrado (R25): la desactivacion (setActivaPlantilla) detiene la
 * generacion del cron preservando el historial. Money-safe: DTOs con montos STRING.
 */
export class GastoFijoPlantillaService implements IGastoFijoPlantillaService {
  constructor(private readonly repo: IGastoFijoPlantillaRepository) {}

  async crearPlantilla(
    input: CrearGastoFijoPlantillaInput,
    actor: Actor,
  ): Promise<CrearPlantillaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R17
    // Feature 84: la periodicidad llega SIEMPRE resuelta desde el borde (el schema zod aplica los
    // defaults meses/1/hoy-CR cuando la UI actual no la manda), asi que aca no hay fallback.
    const plantilla = await this.repo.crear({
      concepto: input.concepto,
      monto: input.monto,
      periodicidadUnidad: input.periodicidadUnidad,
      periodicidadCantidad: input.periodicidadCantidad,
      fechaCobro: input.fechaCobro,
    }); // R24
    return { status: "ok", plantilla };
  }

  async actualizarPlantilla(
    input: ActualizarGastoFijoPlantillaInput,
    actor: Actor,
  ): Promise<ActualizarPlantillaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R17
    const existente = await this.repo.obtenerPorId(input.id);
    if (existente === null) return { status: "not_found" };
    const plantilla = await this.repo.actualizar(input.id, {
      concepto: input.concepto,
      monto: input.monto,
      periodicidadUnidad: input.periodicidadUnidad,
      periodicidadCantidad: input.periodicidadCantidad,
      fechaCobro: input.fechaCobro,
    }); // R25 (feature 84: tambien mueve el ciclo/ancla)
    return { status: "ok", plantilla };
  }

  async setActivaPlantilla(
    input: SetActivaPlantillaInput,
    actor: Actor,
  ): Promise<SetActivaPlantillaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R17
    const existente = await this.repo.obtenerPorId(input.id);
    if (existente === null) return { status: "not_found" };
    const plantilla = await this.repo.setActiva(input.id, input.activa); // R25 (sin borrado)
    return { status: "ok", plantilla };
  }

  async listarPlantillas(actor: Actor): Promise<ListarPlantillasServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R17
    const plantillas = await this.repo.listar(); // R26 (activas e inactivas)
    return { status: "ok", plantillas };
  }
}
