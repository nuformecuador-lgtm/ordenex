import type { GestionCausaDevolucion } from "@prisma/client";
import { reintentosConfig } from "@/lib/config/reintentos";
import type {
  DevueltaSlaRow,
  IDevolucionSlaRepository,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  DevolucionSlaResult,
  IDevolucionSlaService,
} from "@/lib/interfaces/services/IDevolucionSlaService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";

// Estatus destino de las transiciones del cron (valores de catalogo YA sembrados; esta feature
// NO agrega estados). Origen SIEMPRE `devuelta` (guarda de idempotencia en el repo).
const ESTATUS_DEVUELTA = "devuelta";
const ESTATUS_EN_BODEGA = "en_bodega_central"; // reintento -> bodega central
const ESTATUS_EN_BODEGA_SATELITE = "en_bodega_satelite"; // reintento -> bodega satelite
const ESTATUS_RECHAZADA = "rechazada"; // escalado (final)

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
// R6/Q3: ventanas ROLLING desde el anclaje. `not_found` = 24h; `wrong_*` = 5 dias (accion el
// dia 6). Independientes de la cadencia con la que corra el cron (horario).
const VENTANA_NOT_FOUND_MS = 24 * HORA_MS;
const VENTANA_WRONG_MS = 5 * DIA_MS;

// Metodos de repo/servicio consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
type OrdenRepo = Pick<IOrdenRepository, "findEstatusIdByValue">;
/**
 * FEATURE 276 (T10, R30) — el `Pick` pasa de `contarIntentos` a `contarIntentosEnLote`, y es un
 * cambio de FORMA con dos motivos, no una optimizacion suelta:
 *
 *  (a) la rama `wrong_*` ahora TAMBIEN necesita el numero (R28). Si cada rama contara por su
 *      cuenta habria DOS formas de obtener el mismo dato en el mismo servicio — la clase exacta de
 *      divergencia que 215/R4 («una sola definicion de intento») existe para impedir;
 *  (b) de paso desaparece el N+1: una consulta por corrida en vez de una por orden.
 */
type HistorialSvc = Pick<IOrdenHistorialService, "contarIntentosEnLote">;

// Log de aviso inyectable: por defecto console.warn. NUNCA registra PII/secretos (R11): solo
// conteos agregados.
export interface DevolucionSlaLogger {
  warn(message: string): void;
}
const defaultLogger: DevolucionSlaLogger = { warn: (m) => console.warn(m) };

/**
 * Feature 99 (design §3.3, R6/R13/R14-R19/R26/R27/R28) — logica de negocio del cron SLA de
 * devoluciones diferidas. Por cada orden que REPOSA en `devuelta`, evalua su ventana ROLLING
 * desde el anclaje derivado (ultima gestion `devuelta` vigente): `not_found` a las 24h se libera
 * a bodega (reintento) si el conteo de intentos derivado (49) es menor que el umbral, o escala a
 * `rechazada` si lo alcanza; `wrong_number`/`wrong_address` escalan DIRECTO a `rechazada` a los 5
 * dias. Resiliente por orden (un fallo no aborta la corrida) e idempotente (la guarda por estado
 * del repo evita el doble efecto). No conoce HTTP ni Prisma directo; testeable con dobles y reloj
 * fijo.
 */
export class DevolucionSlaService implements IDevolucionSlaService {
  constructor(
    private readonly repo: IDevolucionSlaRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly historial: HistorialSvc,
    private readonly logger: DevolucionSlaLogger = defaultLogger,
  ) {}

  async ejecutar(now: Date): Promise<DevolucionSlaResult> {
    // Resuelve los estatus una sola vez (no por orden). Guarda si falta el seed (R27).
    const [estatusDevueltaId, estatusBodegaId, estatusBodegaSateliteId, estatusRechazadaId] =
      await Promise.all([
        this.ordenRepo.findEstatusIdByValue(ESTATUS_DEVUELTA),
        this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_BODEGA),
        this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_BODEGA_SATELITE),
        this.ordenRepo.findEstatusIdByValue(ESTATUS_RECHAZADA),
      ]);
    if (
      estatusDevueltaId === null ||
      estatusBodegaId === null ||
      estatusBodegaSateliteId === null ||
      estatusRechazadaId === null
    ) {
      // R27: catalogo incompleto -> no actua (resultado controlado, no crash). Aviso sin PII.
      this.logger.warn(
        "[procesar-devueltas-sla] catalogo de estados incompleto (seed pendiente); no se procesa",
      );
      return { evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 0, legadas: 0 };
    }

    // R12: la clasificacion a central usa la zona central (o null: todo cae a satelite, fallback
    // seguro de `resolverDestinoCierre`).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    const umbral = reintentosConfig.MIN_INTENTOS_ENTREGA; // R15/R16

    const candidatas = await this.repo.findDevueltasSla();

    // FEATURE 276 (T10, R28/R30) — UN SOLO CONTEO POR CORRIDA, para LAS DOS RAMAS.
    //
    // Las dos leen de este mismo `Map`, asi que por construccion no pueden discrepar sobre cuantos
    // intentos tiene una orden. Con `ids` vacio el servicio no emite ni una consulta (el propio
    // `contarIntentosEnLote` corta).
    //
    // CARRERA CONOCIDA Y ACEPTADA (design §9.2): entre este conteo y la escritura, una aprobacion
    // de cierre concurrente puede subir un contador. Direccion del error: la orden NO escala, o
    // sea NO COBRA. Es la direccion segura y queda declarada.
    const intentosPorOrden = await this.historial.contarIntentosEnLote(
      candidatas.map((c) => c.ordenId),
    );

    let evaluadas = 0;
    let liberadas = 0;
    let escaladas = 0;
    let omitidas = 0;
    // Feature 239 (R14): corte TRANSVERSAL, no un quinto cubo. Cuenta las candidatas cuya ventana
    // se ancla por la rama LEGADA (sin fila de `anclaje_devolucion`), se acabe omitiendo,
    // evaluando, liberando o escalando. Es lo que hace observable la poblacion que quedo en vuelo
    // el dia del despliegue, para poder verla llegar a cero y quedarse ahi.
    let legadas = 0;

    for (const orden of candidatas) {
      try {
        if (orden.origenAncla === "legado") legadas += 1;
        // R28: sin causa en la ultima gestion vigente -> se omite (no se adivina ventana).
        if (orden.causa === null) {
          omitidas += 1;
          continue;
        }
        const intentos = intentosPorOrden.get(orden.ordenId) ?? 0; // R30: del Map, no de una consulta

        // 💰 FEATURE 276 (T10, R28) — LA RAMA `wrong_*` DEJA DE ESPERAR CUANDO YA NO HAY INTENTOS.
        //
        // MIENTRAS una orden repose en `devuelta` con causa `wrong_number`/`wrong_address` y sus
        // intentos vigentes alcancen el umbral, escala en la PRIMERA corrida posterior a su
        // anclaje, sin esperar sus cinco dias.
        //
        // POR QUE ESTO NO CAMBIA *QUE* PASA, SOLO *CUANDO* —y es lo que lo hace aceptable—: esa
        // rama YA escalaba a `rechazada` de forma INCONDICIONAL al vencer la ventana. Consultar el
        // contador no puede producir un desenlace distinto del que la orden iba a tener: adelanta
        // hasta 5 dias el MISMO desenlace.
        //
        // POR QUE ESOS 5 DIAS DEJAN DE PODER PRODUCIR ALGO UTIL: su funcion era darle a la tienda
        // tiempo de corregir la direccion y reprogramar. Pero con el tope puesto, una orden en el
        // umbral que se reprograme acaba en bodega y R18 le niega la asignacion —y desde la Q2 la
        // reprogramacion ni siquiera se acepta—. Son 5 dias de mercaderia parada a cambio de una
        // salida que el propio tope acaba de cerrar. Medido: la guia `28098171` llevaba 89,1 h de
        // 120 esperando un desenlace ya decidido.
        //
        // ⚠️ ES LA PRIMERA VEZ QUE ESTE SISTEMA *ADELANTA* UN COBRO. Lo que lo hace aceptable es
        // que el cobro es el mismo y era seguro; lo que lo hace peligroso es que depende del
        // contador. Por eso R33 congela el criterio de conteo en esta ficha.
        const esWrong = orden.causa !== "not_found";
        const escalaPorTope = esWrong && intentos >= umbral;

        // R14/R13/R17 (ventana viva): aun no vence -> la orden reposa en `devuelta`, no se actua.
        // R29: por DEBAJO del umbral la ventana de cinco dias se aplica exactamente como hoy.
        if (!escalaPorTope && !venceVentana(orden.causa, orden.ancladaAt, now)) {
          evaluadas += 1;
          continue;
        }

        if (orden.causa === "not_found") {
          // Feature 215 (R15) — QUE cuenta este numero, con el criterio VIGENTE: los CIERRES
          // APROBADOS DISTINTOS en los que la orden tuvo un resultado de gestion vigente
          // `rechazada`, `devuelta` o `reprogramada`. Ya NO cuenta transiciones del historial:
          // la devolucion o la reprogramacion del mensajero no suman por si solas en el instante
          // de la gestion (R10/R11); suman cuando el admin APRUEBA el cierre que las agrupa.
          //
          // CONSECUENCIA DIRECCIONAL, declarada y aceptada: con el ancla en `aprobado` el conteo
          // de casi toda orden BAJA respecto del criterio anterior, asi que el escalado se
          // RETRASA. El riesgo de esta feature NO es cobrar de mas: es NO COBRAR. Una orden cuyo
          // cierre queda `solicitado` sin atender, `vencido` sin re-solicitar o `rechazado` se
          // queda en 0 indefinidamente, y este cron la libera a bodega una y otra vez sin
          // escalar jamas -> el `cobroRechazado` (56) nunca se emite.
          //
          // Eso era la pregunta Q5. **CERRADA CON RIESGO ACEPTADO el 2026-08-13** (decision D14
          // del humano, medida el 2026-08-14 sobre 12 cierres: 12 aprobados, cero abiertos). El
          // supuesto operativo es explicito: «el cierre se cerrara en algun momento por un
          // usuario». Este comentario decia «ABIERTA» hasta el 2026-08-19 y citarlo ya llevo una
          // vez a conclusiones falsas; el servicio nunca cambio de logica por ello.
          //
          // FEATURE 239 — Q5 CAMBIA DE FORMA, y conviene leer en que direccion. Antes: un cierre
          // sin aprobar dejaba la orden girando en `devuelta` y NUNCA se cobraba. Con la mitad
          // que se mergeo el 2026-08-18: la dejaba invisible Y SE COBRABA IGUAL a las 24 h — ese
          // era el fallo. Desde la 239: la orden se queda CONGELADA en `devolucion_por_confirmar`
          // —no se ve, no corre reloj, no se cobra— y esa poblacion es CONTABLE, que antes no lo
          // era. El dano pasa de dinero mal cobrado a mercaderia parada. La alerta operativa que
          // vigila esa poblacion (M3 del §7bis de la 215) sigue siendo ficha aparte.
          if (intentos >= umbral) {
            // R16: alcanzo el umbral -> escala a `rechazada`.
            const ok = await this.escalar(orden, estatusDevueltaId, estatusRechazadaId);
            if (ok) escaladas += 1;
            else omitidas += 1; // R24/R25: guarda de estado ya no vigente
          } else {
            // R15: reintento -> bodega responsable derivada de la zona, limpia el mensajero.
            const ok = await this.liberar(
              orden,
              centralZonaId,
              estatusDevueltaId,
              estatusBodegaId,
              estatusBodegaSateliteId,
            );
            if (ok) liberadas += 1;
            else omitidas += 1;
          }
        } else {
          // R17: `wrong_number` / `wrong_address` -> escalado DIRECTO a `rechazada`, sin bucle.
          const ok = await this.escalar(orden, estatusDevueltaId, estatusRechazadaId);
          if (ok) escaladas += 1;
          else omitidas += 1;
        }
      } catch {
        // R26: un fallo por orden no aborta la corrida; se contabiliza y se continua.
        omitidas += 1;
      }
    }

    if (omitidas > 0) {
      this.logger.warn(
        `[procesar-devueltas-sla] ${omitidas} orden(es) omitida(s) en esta corrida`,
      );
    }
    if (legadas > 0) {
      // R35: SOLO un conteo agregado. Ni ids, ni guias, ni tiendas, ni mensajeros.
      this.logger.warn(
        `[procesar-devueltas-sla] ${legadas} devolucion(es) sin fila de anclaje (rama legada)`,
      );
    }
    return { evaluadas, liberadas, escaladas, omitidas, legadas };
  }

  /** R15: reintento -> bodega responsable derivada de la zona (reusa el ruteo 41/46). */
  private liberar(
    orden: DevueltaSlaRow,
    centralZonaId: string | null,
    estatusDevueltaId: string,
    estatusBodegaId: string,
    estatusBodegaSateliteId: string,
  ): Promise<boolean> {
    const { destinoTipo } = resolverDestinoCierre(orden.zonaId, centralZonaId);
    const destinoEstatusId =
      destinoTipo === "bodega_central" ? estatusBodegaId : estatusBodegaSateliteId;
    return this.repo.liberarDevueltaSla({
      ordenId: orden.ordenId,
      destinoEstatusId,
      estatusDevueltaId,
    });
  }

  /** R16/R17/R20-R25: escalado a `rechazada` con la gestion sintetica (Option A del dinero). */
  private escalar(
    orden: DevueltaSlaRow,
    estatusDevueltaId: string,
    estatusRechazadaId: string,
  ): Promise<boolean> {
    return this.repo.escalarDevueltaSla({
      ordenId: orden.ordenId,
      estatusDevueltaId,
      estatusRechazadaId,
      mensajeroId: orden.mensajeroId, // R22: atribuye el ingreso de bodega a este mensajero
      motivo: `escalado SLA ${orden.causa}`,
    });
  }
}

/**
 * R6/R13: vencimiento ROLLING desde el anclaje. `not_found` -> 24h; `wrong_number`/
 * `wrong_address` -> 5 dias. Funcion pura para pruebas deterministas con reloj fijo.
 */
function venceVentana(
  causa: GestionCausaDevolucion,
  ancladaAt: Date,
  now: Date,
): boolean {
  const transcurrido = now.getTime() - ancladaAt.getTime();
  if (causa === "not_found") return transcurrido >= VENTANA_NOT_FOUND_MS;
  return transcurrido >= VENTANA_WRONG_MS; // wrong_number | wrong_address
}
