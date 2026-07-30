import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ResumenCargaOrdenDTO } from "@/lib/types/carga-masiva-resumen";

// Feature 16 — contrato del servicio del resumen del lote recien cargado.
// Resultados discriminados de dominio (patron IOrdenService), sin acoplarse a
// HTTP; el borde (Server Action) los traduce a ActionError.
//
// Feature 159: la interfaz se llamaba `IAsignacionMensajeroService` y declaraba
// tres metodos. Los otros dos —listar mensajeros y sugerir su asignacion— se
// retiraron con la sugerencia de mensajero; el resumen del lote es una capacidad
// distinta que sobrevive (design §2.3), y da nombre a lo que queda.

export type ResumenCargaMasivaServiceResult =
  | { status: "ok"; ordenes: ResumenCargaOrdenDTO[] }
  | { status: "forbidden" };

export interface IResumenCargaMasivaService {
  /** R6/R11: resumen del lote (num_remision -> orden), solo adminTienda, tienda propia. */
  resumenCargaMasiva(
    input: { numRemisiones: string[] },
    actor: Actor,
  ): Promise<ResumenCargaMasivaServiceResult>;
}
