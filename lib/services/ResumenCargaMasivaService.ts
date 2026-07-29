// Feature 16 — Resumen del lote recien cargado por la carga masiva. Logica de
// negocio pura (sin HTTP, sin Prisma directo), inyecta IOrdenRepository.
//
// Feature 159: el servicio se llamaba `AsignacionMensajeroService` y orquestaba
// ademas el listado de mensajeros y la sugerencia de su asignacion. Esas dos
// capacidades se retiraron (design §2.3); el resumen del lote NO es la sugerencia
// y sobrevive, en solo lectura.
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IResumenCargaMasivaService,
  ResumenCargaMasivaServiceResult,
} from "@/lib/interfaces/services/IResumenCargaMasivaService";

export class ResumenCargaMasivaService implements IResumenCargaMasivaService {
  constructor(private readonly ordenRepo: IOrdenRepository) {}

  /** R6/R11: SOLO adminTienda, sobre su propia tienda (tiendaId = actor.usuarioId). */
  async resumenCargaMasiva(
    input: { numRemisiones: string[] },
    actor: Actor,
  ): Promise<ResumenCargaMasivaServiceResult> {
    if (actor.rol !== "adminTienda") return { status: "forbidden" };
    const ordenes = await this.ordenRepo.findResumenByNumRemisiones(
      input.numRemisiones,
      actor.usuarioId,
    );
    return { status: "ok", ordenes };
  }
}
