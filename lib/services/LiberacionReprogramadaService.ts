import type {
  ILiberacionReprogramadaRepository,
  OrdenLiberableRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  ILiberacionReprogramadaService,
  LiberacionResult,
} from "@/lib/interfaces/services/ILiberacionReprogramadaService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";

// Estatus destino de la liberacion segun la bodega responsable (F1.4-a). Valores de
// catalogo ya sembrados (ORDER_STATUS_SEED); esta feature NO agrega estados.
const ESTATUS_EN_BODEGA = "en_bodega_central"; // central
const ESTATUS_EN_BODEGA_SATELITE = "en_bodega_satelite"; // satelite
const ESTATUS_REPROGRAMADA = "reprogramada"; // origen (guarda de idempotencia)

/**
 * FEATURE 276 (T6.2, R12/R15) — el UNICO estado de cierre que cierra la puerta del contador.
 *
 * Los otros tres NO valen, y no por omision: `solicitado` puede aprobarse en cualquier momento;
 * `vencido` y `rechazado` tambien, porque `forzarSolicitudVencido` los devuelve a `solicitado`
 * (`ESTADOS_REABRIBLES = ["vencido","rechazado"]`). Es decir: NINGUN cierre queda fuera del alcance
 * de una aprobacion posterior, asi que mientras no este `aprobado` esa gestion todavia puede sumar
 * +1 y la orden no puede volver a circulacion (R31/R32).
 *
 * Se compara contra este literal y no contra `CierreEstado` importado de Prisma a proposito: el
 * repositorio devuelve el estado como `string` crudo (es un HECHO, no una decision), y aqui es
 * donde ese hecho se interpreta.
 */
const CIERRE_APROBADO = "aprobado";

/**
 * FEATURE 276 (T6.2, R12/R14) — LA REGLA, en una funcion pura y con nombre.
 *
 * Una orden se libera cuando su gestion `reprogramada` vigente **ya no puede subir el contador**.
 * Y «puede subir el contador» no es una definicion nueva: son DOS de las seis condiciones del
 * predicado unico de intentos (`whereIntentosVigentes`) aplicadas a UNA sola gestion —nacer de una
 * visita real, y pertenecer a un cierre aprobado—.
 *
 * Los dos casos que liberan:
 *   (a) la gestion NO es visita real (p. ej. `reprogramacion_tienda`, la reprogramacion de
 *       escritorio de la 100): nunca va a contar, asi que esperar no ganaria nada y costaria
 *       latencia (R14);
 *   (b) es visita real PERO su cierre ya esta `aprobado`: el +1 ya ocurrio y el contador que
 *       leen las puertas de asignacion (R18) ya esta al dia (R15).
 *
 * El caso que NO libera y que es la RAIZ de la ficha: visita real + cierre sin aprobar (incluido
 * `cierreId = null`, la gestion del dia que aun no se ha cerrado). Ahi el contador va por detras, y
 * liberar seria devolver la orden a bodega con el numero viejo — el 4.º intento que la 276 cierra.
 */
export function puedeLiberarse(orden: OrdenLiberableRow): boolean {
  if (!orden.gestionEsVisitaReal) return true; // (a) R14
  return orden.gestionCierreEstado === CIERRE_APROBADO; // (b) R15
}

// Metodos de repo consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
type OrdenRepo = Pick<IOrdenRepository, "findEstatusIdByValue">;

// Log de aviso inyectable: por defecto console.warn. NUNCA registra PII/secretos (R19):
// solo conteos agregados.
export interface LiberacionLogger {
  warn(message: string): void;
}
const defaultLogger: LiberacionLogger = { warn: (m) => console.warn(m) };

/**
 * FICHA 315 — etiqueta del disparador, SOLO para los avisos. Que un log diga cual de los dos
 * caminos hablo es lo que permitira, la proxima vez, contestar «¿por que esta orden salio a las
 * 14:48 y no a las 00:00?» sin adivinar.
 */
const ETIQUETA_RELOJ = "liberar-reprogramadas";
const ETIQUETA_CIERRE = "liberar-al-aprobar-cierre";
/** FICHA 371 — el tercer disparador: la correccion de la fecha de una reprogramacion. */
const ETIQUETA_CORRECCION = "liberar-tras-corregir-fecha";

/**
 * Lo que se resuelve UNA vez por corrida y no depende de las candidatas: la zona central (para
 * derivar la bodega responsable) y los tres estatus del catalogo. `null` = catalogo incompleto.
 */
interface ContextoLiberacion {
  centralZonaId: string | null;
  estatusReprogramadaId: string;
  estatusBodegaId: string;
  estatusBodegaSateliteId: string;
}

/** Corrida que no libero nada. Funcion y no constante: cada llamada devuelve su propio objeto. */
function sinLiberacion(): LiberacionResult {
  return { evaluadas: 0, liberadas: 0, omitidas: 0, esperandoCierre: 0 };
}

/**
 * Feature 46 — logica de negocio de la liberacion programada (R12-R14/R17). Por cada
 * orden reprogramada cuya fecha ya llego (`hoyCR`), deriva su bodega responsable
 * (`resolverDestinoCierre`, reusa la regla 41/37) y la transiciona a `en_bodega_central` /
 * `en_bodega_satelite` limpiando el mensajero y marcando la liberacion. Resiliente por
 * orden (patron `CorteDiarioService`) e idempotente (la transicion saca la orden de
 * `reprogramada`, R17). No conoce HTTP ni Prisma directo; testeable con dobles.
 */
export class LiberacionReprogramadaService implements ILiberacionReprogramadaService {
  constructor(
    private readonly repo: ILiberacionReprogramadaRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly logger: LiberacionLogger = defaultLogger,
  ) {}

  async ejecutarLiberacion(hoyCR: Date): Promise<LiberacionResult> {
    const ctx = await this.resolverContexto(ETIQUETA_RELOJ);
    if (ctx === null) return sinLiberacion();
    // R10: candidatas (reprogramadas, no borradas, fecha <= hoy CR).
    const ordenes = await this.repo.findOrdenesLiberables(hoyCR);
    return this.liberarCandidatas(ordenes, ctx, ETIQUETA_RELOJ);
  }

  /**
   * FICHA 315 — el MISMO bucle, con las candidatas acotadas al cierre recien aprobado.
   *
   * No re-implementa nada: mismo contexto, mismo `puedeLiberarse`, mismo `liberarOrden` guardado
   * por `estatus_id = reprogramada` (idempotente: si la corrida del reloj ya la solto, este pase
   * afecta 0 filas y cuenta como `omitida`, no como fallo). Lo unico distinto es de donde salen
   * las candidatas y la etiqueta del log.
   *
   * Los dos disparadores y por que ninguno sobra estan explicados en
   * `ILiberacionReprogramadaService.liberarPorCierreAprobado`.
   */
  async liberarPorCierreAprobado(cierreId: string, hoyCR: Date): Promise<LiberacionResult> {
    const ctx = await this.resolverContexto(ETIQUETA_CIERRE);
    if (ctx === null) return sinLiberacion();
    const ordenes = await this.repo.findOrdenesLiberablesDeCierre(cierreId, hoyCR);
    return this.liberarCandidatas(ordenes, ctx, ETIQUETA_CIERRE);
  }

  /**
   * FICHA 371 — EL MISMO BUCLE, con la candidata acotada a la orden recien corregida.
   *
   * Tampoco re-implementa nada: mismo contexto, mismo `puedeLiberarse` —la puerta de la 276 se
   * RESPETA, no se salta—, mismo `liberarOrden` guardado por `estatus_id = reprogramada`. Lo que
   * cambia es de donde sale la candidata y la etiqueta del log.
   *
   * QUIEN LEE EL RESULTADO Y PARA QUE: la Server Action de la correccion traduce estos contadores
   * al discriminante que la pantalla pinta. `liberadas: 1` = la orden volvio a bodega en el acto;
   * `esperandoCierre: 1` = la fecha ya vencio pero su cierre no esta aprobado y sigue esperando;
   * `evaluadas: 0` = se corrigio a un dia futuro y espera al calendario, que es lo correcto.
   */
  async liberarOrdenCorregida(ordenId: string, hoyCR: Date): Promise<LiberacionResult> {
    const ctx = await this.resolverContexto(ETIQUETA_CORRECCION);
    if (ctx === null) return sinLiberacion();
    const ordenes = await this.repo.findOrdenesLiberablesDeOrden(ordenId, hoyCR);
    return this.liberarCandidatas(ordenes, ctx, ETIQUETA_CORRECCION);
  }

  /**
   * Zona central + los tres estatus del catalogo, resueltos UNA vez por corrida (no por orden).
   * `null` = el catalogo esta incompleto (seed pendiente) y no se libera nada: resultado
   * controlado, no crash. Aviso agregado sin PII (R19).
   */
  private async resolverContexto(etiqueta: string): Promise<ContextoLiberacion | null> {
    // R12: la clasificacion a central usa la zona central (o null: todo cae a satelite,
    // fallback seguro de `resolverDestinoCierre`).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();

    const [estatusReprogramadaId, estatusBodegaId, estatusBodegaSateliteId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTATUS_REPROGRAMADA),
      this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_BODEGA),
      this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_BODEGA_SATELITE),
    ]);
    if (
      estatusReprogramadaId === null ||
      estatusBodegaId === null ||
      estatusBodegaSateliteId === null
    ) {
      this.logger.warn(
        `[${etiqueta}] catalogo de estados incompleto (seed pendiente); no se libera`,
      );
      return null;
    }
    return { centralZonaId, estatusReprogramadaId, estatusBodegaId, estatusBodegaSateliteId };
  }

  /**
   * EL BUCLE, compartido por los dos disparadores. Resiliente por orden (un fallo no aborta la
   * corrida) e idempotente (la escritura va guardada por el estatus de origen).
   */
  private async liberarCandidatas(
    ordenes: OrdenLiberableRow[],
    ctx: ContextoLiberacion,
    etiqueta: string,
  ): Promise<LiberacionResult> {
    // R13: una marca unica para toda la corrida.
    const corridaAt = new Date();

    let liberadas = 0;
    let omitidas = 0;
    // FEATURE 276 (R12/R13): las que se quedan quietas esperando la aprobacion de un cierre.
    let esperandoCierre = 0;

    for (const orden of ordenes) {
      try {
        // 💰 FEATURE 276 (T6.2, R12/R13/R14/R15) — LA PUERTA DE LA RAIZ.
        //
        // Aqui nacia el 4.º intento: `findOrdenesLiberables` devolvia la orden por fecha SIN MIRAR
        // EL CIERRE, asi que volvia a bodega con el contador todavia en el valor viejo y la puerta
        // de la asignacion (R18) la dejaba pasar leyendo un reloj parado.
        //
        // R13: cuando NO se libera, no se toca NADA — ni estado, ni mensajero, ni dia de reparto,
        // ni prioridad—. El `continue` va ANTES de `liberarOrden`, que es la unica escritura de
        // este bucle. Y NO cuenta como `omitida`: omitir es un fallo o una carrera perdida; esto
        // es la regla funcionando.
        //
        // FICHA 315: la puerta se comprueba TAMBIEN en el camino del evento, y no es redundante.
        // El cierre que se acaba de aprobar es el de la gestion vigente en el caso normal, pero
        // entre el commit y esta lectura pueden haber pasado cosas; la regla se pregunta contra lo
        // que la base dice AHORA, no contra lo que el llamador cree.
        if (!puedeLiberarse(orden)) {
          esperandoCierre += 1;
          continue;
        }
        // R12: bodega responsable derivada de la zona (misma regla que el corte 41).
        const { destinoTipo } = resolverDestinoCierre(orden.zonaId, ctx.centralZonaId);
        const destinoEstatusId =
          destinoTipo === "bodega_central" ? ctx.estatusBodegaId : ctx.estatusBodegaSateliteId;

        const ok = await this.repo.liberarOrden({
          ordenId: orden.id,
          destinoEstatusId,
          estatusReprogramadaId: ctx.estatusReprogramadaId,
          corridaAt,
        });
        // R17: false = ya salio de `reprogramada` entre la lectura y la escritura
        // (carrera/idempotencia) -> se omite, no es fallo.
        if (ok) liberadas += 1;
        else omitidas += 1;
      } catch {
        // R14: un fallo por orden no aborta la corrida; se contabiliza y se continua.
        omitidas += 1;
      }
    }

    if (omitidas > 0) {
      this.logger.warn(`[${etiqueta}] ${omitidas} orden(es) no liberada(s) en esta corrida`);
    }
    if (esperandoCierre > 0) {
      // R38: SOLO un conteo agregado. Ni ids, ni guias, ni tiendas, ni mensajeros. Es lo unico que
      // hace visible la poblacion congelada del «Riesgo declarado»; la alerta operativa sobre ella
      // sigue siendo ficha aparte (M3 del §7bis de la 215).
      this.logger.warn(
        `[${etiqueta}] ${esperandoCierre} orden(es) esperan la aprobacion de su cierre`,
      );
    }

    return { evaluadas: ordenes.length, liberadas, omitidas, esperandoCierre };
  }
}
