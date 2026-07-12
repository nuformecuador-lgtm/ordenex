import type {
  CreateZonaData,
  IZonaRepository,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  Actor,
  ActualizarZonaServiceResult,
  ArbolZonasServiceResult,
  BorrarZonaServiceResult,
  CrearZonaServiceResult,
  IZonaService,
  ListarZonasServiceResult,
  ObtenerZonaServiceResult,
} from "@/lib/interfaces/services/IZonaService";
import type { ActualizarZonaInput, CrearZonaInput, ListarZonasInput } from "@/lib/types/zona";

// Feature 24: el CRUD de zonas es EXCLUSIVO del rol maestro.
function esMaestro(actor: Actor): boolean {
  return actor.rol === "maestro";
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

type PrepararResult =
  | { ok: true; data: CreateZonaData }
  | { ok: false; fieldErrors: Record<string, string[]> };

export class ZonaService implements IZonaService {
  constructor(private readonly repo: IZonaRepository) {}

  // Valida existencia de distritos y vehiculos y deduplica distritoIds. La regla
  // cobroVehiculo<->tarifas ya la garantizo Zod en el borde; aqui solo integridad
  // referencial (para errores de dominio limpios en vez de fallos de FK).
  private async prepararDatos(
    input: CrearZonaInput | ActualizarZonaInput,
  ): Promise<PrepararResult> {
    const fieldErrors: Record<string, string[]> = {};

    const distritoIds = distinct(input.distritoIds);
    const distritosExistentes = await this.repo.countExistingDistritos(distritoIds);
    if (distritosExistentes !== distritoIds.length) {
      fieldErrors.distritoIds = ["uno o mas distritoIds no existen"];
    }

    const vehiculoIds = distinct(
      input.tarifas
        .map((t) => t.vehiculoId)
        .filter((v): v is string => v !== undefined),
    );
    if (vehiculoIds.length > 0) {
      const vehiculosExistentes = await this.repo.countExistingVehiculos(vehiculoIds);
      if (vehiculosExistentes !== vehiculoIds.length) {
        fieldErrors.tarifas = ["uno o mas vehiculoId no existen"];
      }
    }

    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

    return {
      ok: true,
      data: {
        nombre: input.nombre,
        cobroVehiculo: input.cobroVehiculo,
        distritoIds,
        tarifas: input.tarifas.map((t) => ({
          cobroEntregado: t.cobroEntregado,
          cobroRechazado: t.cobroRechazado,
          vehiculoId: t.vehiculoId ?? null,
        })),
      },
    };
  }

  async crear(input: CrearZonaInput, actor: Actor): Promise<CrearZonaServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const prep = await this.prepararDatos(input);
    if (!prep.ok) return { status: "validation_error", fieldErrors: prep.fieldErrors };
    const zona = await this.repo.create(prep.data);
    return { status: "ok", zona };
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerZonaServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const zona = await this.repo.findById(id, true);
    if (!zona) return { status: "not_found" };
    return { status: "ok", zona };
  }

  async listar(input: ListarZonasInput, actor: Actor): Promise<ListarZonasServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const includeTarifas = input.include?.includes("tarifas") ?? false;
    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.repo.list({
      skip,
      take: input.pageSize,
      includeTarifas,
    });
    return { status: "ok", items, page: input.page, pageSize: input.pageSize, total };
  }

  async actualizar(
    id: string,
    input: ActualizarZonaInput,
    actor: Actor,
  ): Promise<ActualizarZonaServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const prep = await this.prepararDatos(input);
    if (!prep.ok) return { status: "validation_error", fieldErrors: prep.fieldErrors };
    const zona = await this.repo.update(id, prep.data);
    if (!zona) return { status: "not_found" };
    return { status: "ok", zona };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarZonaServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const res = await this.repo.hardDelete(id);
    if (res === "not_found") return { status: "not_found" };
    if (res === "referenced") return { status: "conflict" };
    return { status: "ok" };
  }

  async arbol(actor: Actor): Promise<ArbolZonasServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const arbol = await this.repo.arbol();
    return { status: "ok", arbol };
  }
}
