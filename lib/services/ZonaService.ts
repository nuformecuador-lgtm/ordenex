import { canonicalZonaNombre, normalizeZonaKey } from "@/lib/geo/normalize";
import {
  DistritosInexistentesError,
  DistritosYaAsignadosError,
  type IZonaRepository,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type {
  Actor,
  ActualizarZonaServiceResult,
  CrearZonaServiceResult,
  IZonaService,
  ListarCantonesServiceResult,
  ListarDistritosServiceResult,
  ListarProvinciasServiceResult,
  ListarZonasLightServiceResult,
  ListarZonasServiceResult,
  MarcarZonaGamServiceResult,
  ObtenerZonaServiceResult,
} from "@/lib/interfaces/services/IZonaService";
import type { ActualizarZonaInput, CrearZonaInput, ListarZonasInput } from "@/lib/types/zona";

// D2: escritura de zonas SOLO `maestro`; lectura del catalogo geografico y del
// listado ligero de zonas `maestro` + `admin`. Un rol no reconocido no pertenece a
// ningun conjunto -> forbidden (R16).
const WRITE_ROLES = new Set<string>(["maestro"]);
const READ_ROLES = new Set<string>(["maestro", "admin"]);

// Resultado del mapeo de errores de distrito (compartido por crear/actualizar).
type DistritoErrorResult =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; reason: "distrito"; distritoIds: string[] };

export class ZonaService implements IZonaService {
  constructor(
    private readonly repo: IZonaRepository,
    private readonly geoRepo: IGeoRepository,
  ) {}

  async crear(input: CrearZonaInput, actor: Actor): Promise<CrearZonaServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R16

    const canonical = canonicalZonaNombre(input.nombre);
    const key = normalizeZonaKey(input.nombre);
    if (canonical === null || key === null) {
      return { status: "validation_error", fieldErrors: { nombre: ["El nombre no puede estar vacio"] } }; // R19
    }

    const dup = await this.repo.findByNombreKey(key); // R21
    if (dup) return { status: "conflict", reason: "nombre" };

    try {
      const zona = await this.repo.create({
        nombre: canonical,
        pagoEntrega: input.pagoEntrega,
        pagoRechazo: input.pagoRechazo,
        esGam: input.esGam,
        distritoIds: input.distritoIds,
      });
      return { status: "ok", zona }; // R17
    } catch (error) {
      return this.mapDistritoError(error);
    }
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerZonaServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R16
    const zona = await this.repo.findById(id);
    if (!zona) return { status: "not_found" };
    return { status: "ok", zona };
  }

  async listar(input: ListarZonasInput, actor: Actor): Promise<ListarZonasServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R16
    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.repo.list({ skip, take: input.pageSize }); // R24
    return { status: "ok", items, page: input.page, pageSize: input.pageSize, total };
  }

  async actualizar(
    input: ActualizarZonaInput,
    actor: Actor,
  ): Promise<ActualizarZonaServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R16

    const { id, ...rest } = input;
    const existente = await this.repo.findById(id);
    if (!existente) return { status: "not_found" }; // R22

    let nombreCanonical: string | undefined;
    if (rest.nombre !== undefined) {
      const canonical = canonicalZonaNombre(rest.nombre);
      const key = normalizeZonaKey(rest.nombre);
      if (canonical === null || key === null) {
        return { status: "validation_error", fieldErrors: { nombre: ["El nombre no puede estar vacio"] } }; // R19
      }
      const dup = await this.repo.findByNombreKey(key, id); // R21 (excluye la propia)
      if (dup) return { status: "conflict", reason: "nombre" };
      nombreCanonical = canonical;
    }

    try {
      const zona = await this.repo.update(id, {
        nombre: nombreCanonical,
        pagoEntrega: rest.pagoEntrega,
        pagoRechazo: rest.pagoRechazo,
        esGam: rest.esGam,
        distritoIds: rest.distritoIds,
      });
      if (!zona) return { status: "not_found" }; // carrera: borrada entre medias
      return { status: "ok", zona }; // R22
    } catch (error) {
      return this.mapDistritoError(error);
    }
  }

  async marcarGam(id: string, actor: Actor): Promise<MarcarZonaGamServiceResult> {
    if (!WRITE_ROLES.has(actor.rol)) return { status: "forbidden" }; // R16
    const ok = await this.repo.setGam(id); // R23
    if (!ok) return { status: "not_found" };
    return { status: "ok" };
  }

  async listarLight(actor: Actor): Promise<ListarZonasLightServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R15/R16
    const items = await this.repo.listLight();
    return { status: "ok", items };
  }

  async listarProvincias(actor: Actor): Promise<ListarProvinciasServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R14/R16
    const items = await this.geoRepo.listProvincias();
    return { status: "ok", items };
  }

  async listarCantones(provinciaId: string, actor: Actor): Promise<ListarCantonesServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R14/R16
    const items = await this.geoRepo.listCantones(provinciaId);
    return { status: "ok", items };
  }

  async listarDistritos(cantonId: string, actor: Actor): Promise<ListarDistritosServiceResult> {
    if (!READ_ROLES.has(actor.rol)) return { status: "forbidden" }; // R14/R16
    const items = await this.geoRepo.listDistritos(cantonId);
    return { status: "ok", items };
  }

  // R19/R20: traduce los errores de dominio del repositorio. Distrito inexistente
  // -> validation_error; distrito ya en otra zona -> conflict(reason: distrito).
  private mapDistritoError(error: unknown): DistritoErrorResult {
    if (error instanceof DistritosInexistentesError) {
      return { status: "validation_error", fieldErrors: { distritoIds: ["Uno o mas distritos no existen en el catalogo"] } };
    }
    if (error instanceof DistritosYaAsignadosError) {
      return { status: "conflict", reason: "distrito", distritoIds: error.distritoIds };
    }
    throw error;
  }
}
