import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  ActualizarPlantillaServiceResult,
  CrearPlantillaServiceResult,
  IGastoFijoPlantillaService,
  ListarPlantillasPaginadoServiceResult,
  ListarPlantillasServiceResult,
  SetActivaPlantillaServiceResult,
} from "@/lib/interfaces/services/IGastoFijoPlantillaService";
import type {
  ActualizarGastoFijoPlantillaInput,
  CrearGastoFijoPlantillaInput,
  SetActivaPlantillaInput,
} from "@/lib/types/gasto-fijo-plantilla";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { rangoDePagina } from "@/lib/utils/rango-pagina";

// Roles autorizados (R17): acceso total (maestro/admin, dueños de la caja central), espejo de
// WalletService.

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
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17
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
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17
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
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17
    const existente = await this.repo.obtenerPorId(input.id);
    if (existente === null) return { status: "not_found" };
    const plantilla = await this.repo.setActiva(input.id, input.activa); // R25 (sin borrado)
    return { status: "ok", plantilla };
  }

  async listarPlantillas(actor: Actor): Promise<ListarPlantillasServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17
    const plantillas = await this.repo.listar(); // R26 (activas e inactivas)
    return { status: "ok", plantillas };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — las plantillas, paginadas en servidor.
   *
   * El guard de rol va PRIMERO, antes de tocar el repositorio: es el MISMO `esAccesoTotal`
   * (R17) que el listado sin paginar, asi que el conjunto visible es exactamente el mismo
   * (R44). UNA sola llamada al repositorio (R54): el conteo viaja dentro de ella.
   */
  async listarPlantillasPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPlantillasPaginadoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17

    const { items, total } = await this.repo.listarPaginado(rangoDePagina(input));

    return {
      status: "ok",
      items,
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }
}
