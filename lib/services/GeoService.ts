import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type {
  Actor,
  IGeoService,
  ListarCantonesServiceResult,
  ListarDistritosServiceResult,
  ListarProvinciasServiceResult,
} from "@/lib/interfaces/services/IGeoService";

// Feature 55/R10: la lectura del catalogo geografico es EXCLUSIVA del rol maestro
// (mismo gate que el CRUD de zonas).
function esMaestro(actor: Actor): boolean {
  return actor.rol === "maestro";
}

// Servicio delgado sobre IGeoRepository (DI por constructor, testeable sin DB).
// Una unica responsabilidad: exponer el catalogo geografico con el gate maestro.
export class GeoService implements IGeoService {
  constructor(private readonly repo: IGeoRepository) {}

  async listarProvincias(actor: Actor): Promise<ListarProvinciasServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const items = await this.repo.listProvincias();
    return { status: "ok", items };
  }

  async listarCantones(
    provinciaId: string,
    actor: Actor,
  ): Promise<ListarCantonesServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const items = await this.repo.listCantones(provinciaId);
    return { status: "ok", items };
  }

  async listarDistritos(
    cantonId: string,
    actor: Actor,
  ): Promise<ListarDistritosServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const items = await this.repo.listDistritos(cantonId);
    return { status: "ok", items };
  }
}
