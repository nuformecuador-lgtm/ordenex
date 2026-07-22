import { reintentosConfig } from "@/lib/config/reintentos";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { OrdenDTO } from "@/lib/types/orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IOrdenHistorialService,
  ObtenerHistorialServiceResult,
} from "@/lib/interfaces/services/IOrdenHistorialService";

// Estado destino que cuenta como "intento de entrega fallido" para el derivador (R24).
const ESTATUS_DEVUELTA = "devuelta";

// Roles reconocidos por la lectura del historial. Un rol fuera de este conjunto -> forbidden
// (R27: sin visibilidad, no filtra datos).
const KNOWN_ROLES = new Set<string>([
  "maestro",
  "admin",
  "adminTienda",
  "mensajero",
  "adminSatelite",
]);

/**
 * Feature 49 (design §4.1) — servicio de LECTURA del historial de estados. Autoriza por la
 * visibilidad de la orden (R27), MAS estricto que `OrdenService.obtener` (que solo restringe
 * adminTienda): tambien acota mensajero (a sus asignadas/actuadas) y adminSatelite (a su
 * zona). Devuelve la linea de tiempo cronologica (R26). Inyeccion de dependencias por
 * constructor (interfaces), testeable sin DB.
 */
export class OrdenHistorialService implements IOrdenHistorialService {
  constructor(
    private readonly ordenRepo: IOrdenRepository,
    private readonly historialRepo: IOrdenHistorialRepository,
  ) {}

  async obtenerHistorial(ordenId: string, actor: Actor): Promise<ObtenerHistorialServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R27: rol desconocido

    const orden = await this.ordenRepo.findById(ordenId); // excluye borradas -> not_found
    if (!orden) return { status: "not_found" };

    const decision = await this.autorizar(ordenId, orden, actor);
    if (decision !== "ok") return { status: decision };

    const entradas = await this.historialRepo.findHistorialByOrden(ordenId); // R26 cronologico
    // Feature 47 (R15/R17): junto a la linea de tiempo, el conteo de intentos DERIVADO
    // (consume el derivador de la 49) y el umbral configurable, para que la UI muestre
    // "intento X de N" sin fetchear datos sensibles en el cliente. La autz NO cambia: esta
    // lectura ya paso la visibilidad de la orden (R27/R17).
    const intentos = await this.contarIntentos(ordenId); // R1/R2
    const umbral = reintentosConfig.MIN_INTENTOS_ENTREGA; // R3
    return { status: "ok", entradas, intentos, umbral };
  }

  async contarIntentos(ordenId: string): Promise<number> {
    // R24/R25: derivado del historial (conteo de destinos `devuelta`), sin columna
    // materializada. Si el catalogo no tiene el estado (seed pendiente), no hay intentos
    // contables -> 0.
    // Feature 67/R24/R27/R28: el conteo es de transiciones VIGENTES — excluye las causadas
    // por gestiones ANULADAS (deshechas) sin tocar el historial (append-only, 67/R23). Este
    // UNICO punto alimenta a la vez la regla de reintento-vs-escalado (feature 99:
    // `DevolucionSlaService.ejecutar`, tras relocalizarse desde la 47) y la linea de tiempo
    // (`obtenerHistorial().intentos`, R28): por construccion no pueden divergir.
    const devueltaId = await this.ordenRepo.findEstatusIdByValue(ESTATUS_DEVUELTA);
    if (devueltaId === null) return 0;
    return this.historialRepo.contarPorDestinoVigentes(ordenId, devueltaId);
  }

  // R27: decide la visibilidad de la orden para el actor. `orden` ya viene NO borrada.
  // adminTienda ajena -> not_found (no filtrar); mensajero/adminSatelite sin visibilidad ->
  // forbidden.
  private async autorizar(
    ordenId: string,
    orden: OrdenDTO,
    actor: Actor,
  ): Promise<"ok" | "forbidden" | "not_found"> {
    switch (actor.rol) {
      case "maestro":
      case "admin":
        return "ok"; // vision total
      case "adminTienda":
        return orden.tiendaId === actor.usuarioId ? "ok" : "not_found";
      case "mensajero": {
        // Asignada ahora, o actuada en algun momento (estuvo asignada) -> visible.
        if (orden.mensajeroAsignadoId === actor.usuarioId) return "ok";
        const actuo = await this.historialRepo.existeActuacionDe(ordenId, actor.usuarioId);
        return actuo ? "ok" : "forbidden";
      }
      case "adminSatelite": {
        const zonaActor = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
        return zonaActor !== null && orden.zonaId === zonaActor ? "ok" : "forbidden";
      }
      default:
        return "forbidden";
    }
  }
}
