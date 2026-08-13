import { reintentosConfig } from "@/lib/config/reintentos";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { OrdenDTO } from "@/lib/types/orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IOrdenHistorialService,
  ObtenerHistorialServiceResult,
} from "@/lib/interfaces/services/IOrdenHistorialService";

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
    // Feature 213/R6/R10/R20: el numero que sale de aqui es EL MISMO que consume el cron SLA
    // (mismo metodo, mismo punto unico). Lo que cambio con la 213 no es la forma —el drawer
    // sigue exponiendo `intentos` + `umbral`— sino el VALOR: son los cierres APROBADOS
    // distintos en los que la orden tuvo un resultado contable, no las transiciones.
    const intentos = await this.contarIntentos(ordenId); // R1/R3
    const umbral = reintentosConfig.MIN_INTENTOS_ENTREGA; // R3
    return { status: "ok", entradas, intentos, umbral };
  }

  /**
   * Feature 213 (R1/R6/R9) — PUNTO UNICO del conteo de intentos. Delega directo en el
   * repositorio: ya no hay traduccion `value -> id` que hacer.
   *
   * R9 (degradacion segura) AHORA SE SOSTIENE SOBRE ENUMS DE POSTGRES, que no pueden faltar:
   * el criterio se expresa con valores de `GestionResultado` y de `CierreEstado`, no con ids de
   * `order_status`. Es MAS fuerte que la degradacion por catalogo incompleto que sustituye, no
   * mas debil — antes un seed a medias apagaba el conteo entero; ahora no hay seed que pueda
   * faltar. Efecto lateral medible: desaparecen las 2 lecturas de `order_status` por llamada
   * (`resolverCriterio` ya no existe).
   *
   * Este UNICO punto alimenta a la vez la regla de reintento-vs-escalado del cron SLA (99,
   * `DevolucionSlaService.ejecutar`) y la linea de tiempo (`obtenerHistorial().intentos`): por
   * construccion no pueden divergir (R6).
   */
  async contarIntentos(ordenId: string): Promise<number> {
    return this.historialRepo.contarIntentosVigentes(ordenId);
  }

  async contarIntentosEnLote(ordenIds: string[]): Promise<Map<string, number>> {
    // R7: con `ids` vacio, Map vacio SIN emitir consulta. El repo ya corta, pero cortar aqui
    // deja el contrato del servicio explicito y no depende de la implementacion del repo.
    if (ordenIds.length === 0) return new Map();
    return this.historialRepo.contarIntentosVigentesEnLote(ordenIds);
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
