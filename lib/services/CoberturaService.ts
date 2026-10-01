import { descargaConfig } from "@/lib/config/descarga";
import type { ICoberturaRepository } from "@/lib/interfaces/repositories/ICoberturaRepository";
import type {
  ICoberturaService,
  ListarCoberturaServiceResult,
} from "@/lib/interfaces/services/ICoberturaService";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import { clasificarCobertura, compararCobertura } from "@/lib/utils/cobertura-distrito";

// Ficha 465 (design §3.4) — el Excel de cobertura por distrito. Logica pura de orquestacion:
// puerta de rol, dos lecturas, clasificacion y orden. Sin Next.js y SIN escrituras (R21).

export class CoberturaService implements ICoberturaService {
  constructor(
    private readonly repo: ICoberturaRepository,
    private readonly maxFilas: number = descargaConfig.MAX_FILAS,
  ) {}

  async listar(actor: Actor): Promise<ListarCoberturaServiceResult> {
    // R2: antes de leer nada.
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const [distritos, zonaIds] = await Promise.all([
      this.repo.listDistritos(),
      this.repo.listZonaIdsConTarifaGeneral(),
    ]);
    const conTarifaGeneral = new Set(zonaIds);

    const items = distritos
      .map((row) => clasificarCobertura(row, conTarifaGeneral))
      .sort(compararCobertura);

    // El tope unico de la app (feature 151): o todas las filas o el error, nunca un truncado.
    if (items.length > this.maxFilas) {
      return { status: "limite_excedido", total: items.length, limite: this.maxFilas };
    }
    return { status: "ok", items, total: items.length };
  }
}
