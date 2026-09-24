import { reintentosConfig } from "@/lib/config/reintentos";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { IOrdenDiaRepartoCambioRepository } from "@/lib/interfaces/repositories/IOrdenDiaRepartoCambioRepository";
import type { IOrdenTraspasoRepository } from "@/lib/interfaces/repositories/IOrdenTraspasoRepository";
import type { OrdenDTO } from "@/lib/types/orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IOrdenHistorialService,
  ObtenerHistorialServiceResult,
} from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  OrdenHistorialCorreccionDiaDTO,
  OrdenHistorialEntradaDTO,
  OrdenHistorialEventoDTO,
  OrdenHistorialTransicionDTO,
  OrdenHistorialTraspasoDTO,
} from "@/lib/types/orden-historial";

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
 * FEATURE 262 (B26, design §14.3) — EL ORDEN ENTRE LAS CLASES CUANDO EL INSTANTE EMPATA.
 *
 * Es una regla ARBITRARIA, y por eso se DECLARA en vez de dejarla al `sort`:
 * `Array.prototype.sort` es estable desde ES2019, pero la estabilidad solo fija el orden DENTRO
 * de la lista de entrada, y aqui hay DOS listas. Sin regla, el orden dependeria de como se
 * concatenaron — un detalle de implementacion gobernando lo que alguien lee para entender que
 * paso con su paquete.
 *
 * El `Record` es exhaustivo sobre el discriminante: si la union gana una tercera clase, esto NO
 * COMPILA y hay que decidir donde cae, en vez de que se cuele al final por casualidad.
 */
const RANGO_POR_CLASE: Record<OrdenHistorialEntradaDTO["clase"], number> = {
  transicion: 0,
  correccion_dia: 1,
  /**
   * FICHA 427 (T20, design §9) — LA TERCERA CLASE, y este `Record` es donde la 262 dejo puesta la
   * trampa que la obligo a decidirse: añadir `OrdenHistorialTraspasoDTO` a la union dejo este
   * objeto SIN COMPILAR hasta escribir esta linea. Ese rojo era la funcionalidad.
   *
   * VA LA ULTIMA (rango 2) y es una regla ARBITRARIA, como las otras dos, pero no caprichosa: un
   * traspaso NO cambia el estado de la orden (R21) ni su dia (R16), asi que cuando comparte
   * instante con una transicion o con una correccion lo que paso PRIMERO es aquello —el cambio
   * real sobre la orden— y el traspaso es el apunte de quien la lleva a partir de ahi.
   */
  traspaso_mensajero: 2,
  /**
   * FICHA 454 (T1.21, design §12.4) — LA CUARTA CLASE, los hechos sin transicion (`orden_evento`).
   * VA LA ULTIMA (rango 3): cuando comparte instante con una transicion, lo que paso primero es la
   * transicion. El caso real es la migracion M3, que escribe en el MISMO instante el rastro
   * `ayuda_tienda -> en_reparto` y el evento de ayuda abierta: la ayuda se lee DESPUES de volver a
   * `en_reparto`, que es lo que la derivacion exige (`ayuda-abierta.ts`, «ninguna transicion
   * posterior»).
   */
  evento_orden: 3,
};

/**
 * FEATURE 262 (B26, R40/R41) — LA FUSION DE LAS FUENTES DE LA LINEA DE TIEMPO. Funcion PURA:
 * sin repos, sin reloj y sin `await`, para poder probar la regla de orden sin base y sin dobles.
 *
 * ⭑ FICHA 427 (T20, R29): desde hoy son TRES fuentes. El tercer parametro son los TRASPASOS de la
 * orden entre mensajeros, y entra por la misma puerta y con las mismas reglas que las correcciones.
 *
 * POR QUE VIVE EN EL SERVIDOR Y NO EN EL COMPONENTE (R41, design §A18): 49/R26 puso el orden
 * cronologico en el servicio. Ordenar en el navegador seria una SEGUNDA definicion del orden y
 * obligaria al componente a comparar `Date`s — justo lo que la 246 y la 261 sacaron del cliente.
 *
 * LA REGLA, completa y sin huecos:
 *   1. Ascendente por `createdAt`.
 *   2. Empate EXACTO de instante -> primero la transicion, despues la correccion.
 *   3. Dentro de cada fuente se preserva el orden que la fuente entrego (el `sort` es estable y
 *      cada fuente entra contigua, asi que dos entradas de la misma fuente con el mismo instante
 *      salen como vinieron). El de correcciones es determinista (`created_at ASC, id ASC`,
 *      §14.2); el de transiciones es `created_at asc` a secas — HOY TAMPOCO DESEMPATA, y esta
 *      ficha NO lo cambia: es una propiedad preexistente y tocar esa consulta afecta a doce
 *      features.
 *
 * LAS DOS FUENTES SON COMPARABLES porque las dos columnas se llenan con el `DEFAULT`
 * `CURRENT_TIMESTAMP`. En Postgres eso es el instante en que EMPEZO la transaccion, no el del
 * commit: dos escrituras solapadas pueden ordenarse por su inicio. Es una propiedad que la linea
 * de tiempo YA TIENE hoy dentro de una sola tabla; se hereda al fusionar y se declara (limite 9).
 * Lo que NO se hace es inventar un segundo criterio para una de las dos.
 *
 * R45: con `correcciones` vacio el resultado es la lista de transiciones tal cual — mismas
 * entradas, mismo orden, mismo contenido. Lo mismo vale, palabra por palabra, para `traspasos`
 * (427/T21, no-regresion): la inmensa mayoria de las ordenes no se traspasan nunca y su linea de
 * tiempo tiene que salir EXACTAMENTE como salia antes de esta ficha.
 */
export function fusionarLineaDeTiempo(
  transiciones: readonly OrdenHistorialTransicionDTO[],
  correcciones: readonly OrdenHistorialCorreccionDiaDTO[],
  traspasos: readonly OrdenHistorialTraspasoDTO[],
  // FICHA 454 (T1.21): la CUARTA fuente. OBLIGATORIA por lo mismo que las otras (un «sin eventos»
  // por defecto seria un drawer que enseña menos de lo que hay sin romper nada).
  eventos: readonly OrdenHistorialEventoDTO[],
): OrdenHistorialEntradaDTO[] {
  const entradas: OrdenHistorialEntradaDTO[] = [
    ...transiciones,
    ...correcciones,
    ...traspasos,
    ...eventos,
  ];
  return entradas.sort((a, b) => {
    const delta = a.createdAt.getTime() - b.createdAt.getTime();
    if (delta !== 0) return delta;
    return RANGO_POR_CLASE[a.clase] - RANGO_POR_CLASE[b.clase];
  });
}

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
    /**
     * FEATURE 262 (B26): la SEGUNDA fuente de la linea de tiempo, el rastro de correcciones del
     * dia de reparto.
     *
     * ES OBLIGATORIO A PROPOSITO, aunque los 13 sitios que solo usan `contarIntentos*` tengan
     * que pasarlo. Un parametro opcional con «sin correcciones» por defecto convertiria un
     * cableado olvidado en un drawer que ENSEÑA MENOS de lo que hay y no rompe nada: el fallo
     * mudo exacto que esta ficha existe para evitar. Con el obligatorio, olvidarlo es un rojo de
     * `pnpm typecheck`.
     */
    private readonly correccionRepo: IOrdenDiaRepartoCambioRepository,
    /**
     * FICHA 427 (T20, R29): la TERCERA fuente de la linea de tiempo, el rastro de traspasos de la
     * orden entre mensajeros.
     *
     * ES OBLIGATORIO POR LA MISMA RAZON QUE SU VECINO, y no se repite el argumento por inercia: un
     * parametro opcional con «sin traspasos» por defecto convertiria un cableado olvidado en un
     * drawer que ENSEÑA MENOS de lo que hay —justo la orden cuyo mensajero cambio, que es la que
     * mas falta hace explicar— y no rompe nada. Con el obligatorio, olvidarlo en cualquiera de los
     * 33 sitios que construyen este servicio es un rojo de `pnpm typecheck`.
     */
    private readonly traspasoRepo: IOrdenTraspasoRepository,
  ) {}

  async obtenerHistorial(ordenId: string, actor: Actor): Promise<ObtenerHistorialServiceResult> {
    if (!KNOWN_ROLES.has(actor.rol)) return { status: "forbidden" }; // R27: rol desconocido

    const orden = await this.ordenRepo.findById(ordenId); // excluye borradas -> not_found
    if (!orden) return { status: "not_found" };

    const decision = await this.autorizar(ordenId, orden, actor);
    if (decision !== "ok") return { status: decision };

    // FEATURE 262 (B26, R37/R41): la linea de tiempo se arma de DOS fuentes —las transiciones de
    // estado y el rastro de correcciones del dia de reparto— y se fusiona AQUI, en el servidor.
    //
    // R44: las dos lecturas van DESPUES de `decision === "ok"`. La autorizacion NO se toca y NO
    // gana ninguna regla: quien puede ver la linea de tiempo ve tambien sus correcciones, y quien
    // no, no llega a leer ninguna de las dos.
    //
    // FICHA 427 (T20, R29): y una TERCERA, el rastro de traspasos entre mensajeros. Entra por la
    // misma puerta y DESPUES de `decision === "ok"`, por lo mismo: la autorizacion de lectura NO
    // cambia y NO gana ninguna regla — quien ve la linea de tiempo de la orden ve tambien sus
    // traspasos, con los mismos recortes por rol de hoy (design §9).
    //
    // FICHA 454 (T1.21, R30): y una CUARTA, los hechos sin transicion (`orden_evento`): gestion
    // registrada/anulada/corregida y la ida y vuelta de la ayuda. Misma puerta, DESPUES de la
    // autorizacion y sin regla nueva: la ven los mismos roles que hoy ven la linea de tiempo.
    const [transiciones, correcciones, traspasos, eventos] = await Promise.all([
      this.historialRepo.findHistorialByOrden(ordenId), // R26 cronologico
      this.correccionRepo.findCorreccionesByOrden(ordenId), // created_at asc, id asc
      this.traspasoRepo.findTraspasosByOrden(ordenId), // created_at asc, id asc
      this.historialRepo.findEventosByOrden(ordenId), // created_at asc, id asc (454)
    ]);
    const entradas = fusionarLineaDeTiempo(transiciones, correcciones, traspasos, eventos); // R40 + 427/R29 + 454/R30
    // Feature 47 (R15/R17): junto a la linea de tiempo, el conteo de intentos DERIVADO
    // (consume el derivador de la 49) y el umbral configurable, para que la UI muestre
    // "intento X de N" sin fetchear datos sensibles en el cliente. La autz NO cambia: esta
    // lectura ya paso la visibilidad de la orden (R27/R17).
    // Feature 215/R6/R10/R20: el numero que sale de aqui es EL MISMO que consume el cron SLA
    // (mismo metodo, mismo punto unico). Lo que cambio con la 215 no es la forma —el drawer
    // sigue exponiendo `intentos` + `umbral`— sino el VALOR: son los cierres APROBADOS
    // distintos en los que la orden tuvo un resultado contable, no las transiciones.
    const intentos = await this.contarIntentos(ordenId); // R1/R3
    const umbral = reintentosConfig.MIN_INTENTOS_ENTREGA; // R3
    return { status: "ok", entradas, intentos, umbral };
  }

  /**
   * Feature 215 (R1/R6/R9) — PUNTO UNICO del conteo de intentos. Delega directo en el
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

  /**
   * Pedido humano (2026-08-27) — PUNTO UNICO de «esta orden ya fue gestionada». Delega directo
   * en el repositorio, igual que `contarIntentosEnLote`, y corta el lote vacio aqui para que el
   * contrato del servicio no dependa de la implementacion del repo.
   */
  async idsConGestionPosteriorEnLote(ordenIds: string[]): Promise<Set<string>> {
    if (ordenIds.length === 0) return new Set();
    return this.historialRepo.findIdsConTransicionPosteriorACreacion(ordenIds);
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
