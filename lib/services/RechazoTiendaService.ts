import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import {
  SinGestionDevueltaError,
  type IGestionOrdenRepository,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { ITarifaVigenteRepository } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type {
  CrearCobroRechazoTiendaInput,
  IRechazoTiendaCobroRepository,
} from "@/lib/interfaces/repositories/IRechazoTiendaCobroRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRechazoTiendaService,
  RechazarNovedadResult,
} from "@/lib/interfaces/services/IRechazoTiendaService";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { clavePar } from "@/lib/utils/cascada-tarifa";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// Estado de ORIGEN elegible (la DEVOLUCION ANCLADA de la 239: confirmada en bodega, visible para la
// tienda y con el reloj corriendo) y destino del rechazo. Valores de catalogo ya sembrados
// (`order_status`); esta feature NO agrega estados (R44).
//
// ⚠️ El destino sale del CATALOGO (`findEstatusIdByValue`), no de `ESTATUS_POR_RESULTADO`
// (`lib/types/gestion-destino.ts`). Ese mapa es «de resultado de gestion a estatus» y para
// `rechazada` devuelve `rechazada`, asi que usarlo aqui funcionaria POR COINCIDENCIA DE NOMBRE, no
// por significado: el origen de esta transicion es un ESTADO, no un resultado. La 239 ya rompio esa
// identidad de nombre para `devuelta` (su resultado lleva a `devolucion_por_confirmar`), y este es
// justo el sitio donde apoyarse en ella cuesta caro.
const ESTADO_ORIGEN = "devuelta";
const ESTADO_DESTINO = "rechazada";

/**
 * 💰 FICHA 337 (segunda mitad) — el RESULTADO de gestion con el que se deriva el importe. Es el
 * MISMO que `GestionOrdenRepository.rechazarDesdeDevuelta` le pone a la gestion sintetica: si los
 * dos divergieran, se le cobraria a la tienda un concepto que su propia gestion no justifica.
 */
const RESULTADO_DE_LA_GESTION = "rechazada" as const;

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como `Pick` para
// poder usar dobles de test sin DB/HTTP (patron `ReprogramacionTiendaService`).
type RechazoOrdenRepo = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "findBaseCobroDevolucion"
>;
type RechazoGestionRepo = Pick<IGestionOrdenRepository, "rechazarDesdeDevuelta">;
/** FICHA 337: solo la cascada de tarifa por LOTE, que es la unica que trae ademas el `tarifaId`. */
type RechazoTarifaRepo = Pick<ITarifaVigenteRepository, "resolveTarifas">;
/** FICHA 337: solo el alta del pendiente. Este service no lista cobros y no decide ninguno. */
type RechazoCobroRepo = Pick<IRechazoTiendaCobroRepository, "crearPendiente">;

/**
 * 💰 Feature 240 — logica de negocio del RECHAZO MANUAL por la tienda. Impone la AUTZ por tienda
 * dueña (`adminTienda` cuya `usuarioId` ES el `orden.tienda_id`, patron `NovedadesService`/
 * `ReprogramacionTiendaService`) y la GUARDIA de estado (solo desde la devolucion anclada), y
 * delega la transicion atomica + la gestion sintetica al repo (choke point de la feature 49). No
 * conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 *
 * POR QUE UN SERVICIO NUEVO Y NO UN METODO DE `ReprogramacionTiendaService`: el nombre de esa clase
 * describe LO QUE HACE, y meter dentro el rechazo la convertiria en «el servicio de las cosas que la
 * tienda hace desde novedades», que es un cajon. Dos clases de treinta lineas con una guarda cada
 * una son mas baratas de leer que una de sesenta con dos caminos — y aqui uno de los dos mueve
 * dinero irreversible.
 *
 * 💰 ⏳ FICHA 337 (segunda mitad, 2026-08-31) — ESTE SERVICIO GANA SU VIA DE COBRO PROPIA.
 *
 * Hasta hoy este metodo NO emitia dinero, y su docstring lo decia: el cobro del flete de devolucion
 * salia de PRESTADO, cuando el siguiente cierre del MENSAJERO recogia la gestion sintetica y
 * alguien lo aprobaba. La primera mitad de esta ficha cerro esa via —era el defecto: el mensajero
 * firmaba un documento con trabajo que no hizo— y el cobro quedo EN PAUSA. Aqui esta su sustituto:
 * el rechazo crea un COBRO PENDIENTE contra la tienda (`rechazo_tienda_cobro`) en la MISMA
 * transaccion, y un administrador lo aprueba despues. **La aprobacion va ANTES del cobro**
 * (decision del humano del 2026-08-31): emitirlo en el acto habria quitado la revision previa que
 * daba la aprobacion del cierre.
 *
 * ⚠️ EL IMPORTE SE CONGELA AQUI Y NO SE VUELVE A CALCULAR. Sale de `derivarIngresoOrden`, la misma
 * funcion que usan los dos feeds del cierre, con la tarifa que resuelve AHORA. Recalcularlo al
 * aprobar cobraria un importe que nadie autorizo si la tarifa cambio entre medias — y aqui esa
 * ventana puede durar dias.
 */
export class RechazoTiendaService implements IRechazoTiendaService {
  constructor(
    private readonly ordenRepo: RechazoOrdenRepo,
    private readonly gestionRepo: RechazoGestionRepo,
    /**
     * FICHA 337 — resuelve la tarifa del par (tienda, zona) para CONGELAR el importe del cobro.
     * Se usa `resolveTarifas` (el lote) y no `resolveTarifa` (el singular) porque solo aquel
     * devuelve tambien el `tarifaId`, que es la contrapartida auditable de un importe congelado:
     * sin el, dentro de tres meses nadie puede decir de que fila salio.
     */
    private readonly tarifaRepo: RechazoTarifaRepo,
    /** FICHA 337 — da de alta el COBRO PENDIENTE dentro de la transaccion del rechazo. */
    private readonly cobroRepo: RechazoCobroRepo,
    /**
     * Reloj INYECTABLE. Decide el `generado_el` del cobro (dia CALENDARIO de Costa Rica), que es
     * la columna por la que ordena la cola. Un test no puede depender de un `new Date()` escondido
     * aqui dentro.
     */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async rechazar(
    ordenId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarNovedadResult> {
    // 1. Cargar la orden; `findById` excluye borradas -> not_found.
    const orden = await this.ordenRepo.findById(ordenId);
    if (!orden) return { status: "not_found" };

    // 2. R2 — AUTZ por tienda dueña, ANTES de cualquier escritura y ANTES de mirar el estado. Solo
    //    el adminTienda cuya identidad ES el `orden.tienda_id`. Cualquier otro rol o tienda ->
    //    forbidden, sin efectos y SIN revelar en que estado esta la orden: el mismo valor para las
    //    dos causas, que es lo que impide usar este borde como oraculo de ordenes ajenas.
    if (actor.rol !== "adminTienda" || orden.tiendaId !== actor.usuarioId) {
      return { status: "forbidden" };
    }

    // 3. R3 — guardia de estado de origen. Elegible SOLO desde la devolucion anclada.
    //
    //    ⚠️ ESTO ES UNA LECTURA OPTIMISTA Y SE SABE: la barrera REAL es el `where` del `updateMany`
    //    del paso 5 (R4), que comprueba y escribe en la misma sentencia. Entre este `if` y aquella
    //    sentencia el cron de la 99 puede escalar la orden. Existe igualmente porque permite
    //    devolver `conflict` con su motivo SIN haber intentado escribir, que es lo que hace la
    //    pantalla legible: la tienda lee «esta orden ya no estaba en devolucion» en vez de un error.
    //
    //    NO se comprueba si el plazo vencio (R25/D9): el plazo decide cuando nadie decide.
    //    NO se comprueba el bloqueo del cierre del mensajero: seria un interbloqueo (la tienda no
    //    podria resolver su orden porque el mensajero no cerro su dia).
    if (orden.estatusValue !== ESTADO_ORIGEN) {
      return {
        status: "conflict",
        motivo: `la orden no esta en ${ESTADO_ORIGEN} (estado actual: ${orden.estatusValue ?? "desconocido"})`,
      };
    }

    // 4. Resolver los estatus del catalogo (guarda + destino). Falta de seed -> config_error, que
    //    es FALLO CERRADO: sin el id de `devuelta` no hay guarda que poner en el `where`, y escribir
    //    sin guarda es exactamente lo que R4 prohibe.
    const [estatusDevueltaId, estatusRechazadaId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTADO_ORIGEN),
      this.ordenRepo.findEstatusIdByValue(ESTADO_DESTINO),
    ]);
    if (estatusDevueltaId === null || estatusRechazadaId === null) {
      return { status: "config_error" };
    }

    // 4-bis. 💰 FICHA 337 — CONGELAR LO QUE SE LE VA A COBRAR A LA TIENDA, ANTES de escribir nada.
    //
    //    Va aqui, fuera de la transaccion, a proposito: lo que congela el importe es COPIARLO, no
    //    el aislamiento, y meter dos lecturas mas dentro de una transaccion que escribe dinero solo
    //    alarga su bloqueo de fila. Lo que SI entra en la transaccion es la INSERCION (paso 5).
    const cobro = await this.congelarCobro(ordenId);

    // 5. 💰 Transicion atomica + gestion sintetica via el choke point de la 49 (R8-R16). La guarda
    //    por `estatus_id = devuelta` del repo hace la accion idempotente frente al doble envio y a
    //    la carrera con el cron: si perdio la carrera (`count = 0`), el repo devuelve `false` sin
    //    dejar ni un efecto — y SIN COBRO, porque el hook solo corre si la gestion se creo (R21).
    //
    //    ⚠️ R10 — Y SI LA ORDEN NO TIENE GESTION `devuelta` VIGENTE, EL REPO LANZA. Ese `throw` es
    //    correcto y se queda: es lo que ABORTA la transaccion y revierte el `updateMany`, en vez de
    //    dejar la orden en `rechazada` sin gestion y sin historial. Lo que NO era correcto es como
    //    salia de aqui. Hasta el 2026-08-20 subia como un `Error` pelado, se normalizaba a
    //    `INTERNAL` y `toResolverNovedadActionError` LANZABA al no reconocer ese codigo: la tienda
    //    pulsaba «Rechazar» con su motivo escrito y NO PASABA NADA — ni cambio, ni aviso—. Un boton
    //    mudo, que es el defecto que esta ficha vino a cerrar, una capa mas abajo.
    //
    //    Se captura SOLO esa clase y se re-lanza todo lo demas: una caida de base tiene que seguir
    //    siendo `INTERNAL`, porque no es un desenlace de negocio y nadie puede hacer nada con ella
    //    desde la pantalla. Mismo patron, linea por linea, que
    //    `DeshacerAsignacionService` con `DeshacerAsignacionConflictoError`.
    let ok: boolean;
    try {
      ok = await this.gestionRepo.rechazarDesdeDevuelta({
        ordenId,
        estatusDevueltaId,
        estatusRechazadaId,
        motivo, // R12: obligatorio, ya validado en el borde
        actorUsuarioId: actor.usuarioId, // R11: quien decidio. NO es el mensajero de la gestion.
        // 💰 FICHA 337 — EL ALTA DEL COBRO, DENTRO DE LA MISMA TRANSACCION que crea la gestion.
        //
        // El hook recibe el `gestionId` recien creado, que es a la vez LA CLAVE DE IDEMPOTENCIA
        // del cobro (`rechazo_tienda_cobro_gestion_uq`) y el `origen_id` con el que se escribiran
        // los apuntes al aprobar. Por eso el alta no puede ir antes: la clave no existe todavia.
        //
        // `undefined` cuando no hay nada que cobrar (sin tarifa vigente, o flete de devolucion en
        // 0,00). Entonces el repositorio se comporta EXACTAMENTE como antes de esta ficha y el
        // rechazo sigue adelante: la direccion segura del error es no cobrar.
        trasCrearGestion:
          cobro === null
            ? undefined
            : async (tx, gestionId) => {
                await this.cobroRepo.crearPendiente(tx, { ...cobro, gestionId });
              },
      });
    } catch (error) {
      if (error instanceof SinGestionDevueltaError) {
        // Sin efectos: la transaccion ya revirtio el cambio de estado. La orden sigue en la
        // devolucion anclada y la tienda la sigue viendo en su lista.
        return { status: "sin_gestion_origen" };
      }
      throw error;
    }
    // R3/R31: carrera perdida (o doble submit) -> la orden ya no estaba en la devolucion anclada.
    // La pantalla NO debe afirmar que la rechazo: devuelve `conflict` con su motivo.
    if (!ok) {
      return {
        status: "conflict",
        motivo: `la orden ya no esta en ${ESTADO_ORIGEN}`,
      };
    }
    return { status: "ok" };
  }

  /**
   * 💰 FICHA 337 (segunda mitad) — LO QUE SE LE VA A COBRAR A LA TIENDA POR ESTE RECHAZO,
   * CONGELADO. Devuelve todo lo que la fila del cobro necesita MENOS el `gestionId`, que todavia
   * no existe: lo pone el hook, con la gestion ya creada.
   *
   * Devuelve `null` cuando NO hay nada que cobrar, y ese `null` tiene DOS causas legitimas que
   * comparten desenlace a proposito:
   *   1. la tienda no tiene tarifa vigente para su par (tienda, zona) — `derivarIngresoOrden`
   *      devuelve el objeto vacio, que es el «gap seguro» de R9 de la feature 42: no bloquea;
   *   2. la tarifa existe pero su flete de devolucion es 0,00 — un cobro de cero no es un cobro,
   *      exactamente como `agregarIngresosPorConcepto` OMITE los conceptos en 0.00 (R10 de la 42).
   *      El CHECK `rechazo_tienda_cobro_montos_validos` lo exige ademas en la base.
   *
   * En los dos casos EL RECHAZO SIGUE ADELANTE. La direccion segura del error aqui es no cobrar:
   * un cobro fantasma contra una tienda es peor que un cobro que no se emitio, y la gestion queda
   * en la base con todo lo necesario para darlo de alta a mano si hiciera falta.
   *
   * ⚠️ NO SE CALCULA NADA EN ESTE METODO. `derivarIngresoOrden` es la MISMA funcion que usan el
   * feed de la caja (42) y el del ledger por tienda (43) al aprobar un cierre; lo unico que se hace
   * con su salida es serializarla a STRING con `toFixed(2)`, que es del propio `Decimal` y no pasa
   * por `number`. Si un dia cambia la formula del cierre, cambia esta con ella: no pueden divergir
   * por construccion.
   */
  private async congelarCobro(
    ordenId: string,
  ): Promise<Omit<CrearCobroRechazoTiendaInput, "gestionId"> | null> {
    const base = await this.ordenRepo.findBaseCobroDevolucion(ordenId);
    // La orden desaparecio entre el paso 1 y este (borrado logico). No se cobra, y el rechazo
    // seguira su curso: el `updateMany` guardado del repo tampoco la va a encontrar.
    if (base === null) return null;

    // La cascada (tienda, zona) de la feature 274, en su forma de LOTE con un solo par: es la que
    // devuelve `tarifaId`. `null` = ningun nivel tiene fila (R2 de la 274).
    const par = { tiendaId: base.tiendaId, zonaId: base.zonaId };
    const tarifas = await this.tarifaRepo.resolveTarifas([par]);
    const tarifa = tarifas.get(clavePar(par)) ?? null;

    const derivado = derivarIngresoOrden(
      {
        resultado: RESULTADO_DE_LA_GESTION,
        esCentral: base.esCentral, // elige la columna GAM del flete de devolucion
        esZonaEspecial: base.esZonaEspecial, // elige el pacto especial del distrito, si lo hay
        // Los dos de abajo NO los mira la rama `rechazada` de la formula (solo la `entregada`).
        // Viajan de verdad, y no como `null`/`false` de relleno, porque son parte del contrato de
        // entrada: un dato falso con forma de dato es lo que nadie vuelve a mirar.
        montoCobrar: base.montoCobrar,
        cobraComision: base.cobraComision,
      },
      tarifa,
    );

    const flete = derivado.ingreso_flete_devolucion;
    // Sin tarifa el objeto viene vacio; con flete de devolucion en 0,00 no hay cobro que emitir.
    if (flete === undefined || !flete.gt(0)) return null;
    const iva = derivado.ingreso_iva_flete_devolucion;

    return {
      ordenId: base.ordenId,
      tiendaId: base.tiendaId, // CONGELADA: a quien se le cobra (leccion 69/R13)
      montoFlete: flete.toFixed(2), // Decimal -> STRING, sin pasar por `number`
      // El IVA puede venir en 0,00 con una tarifa al 0 %. `"0.00"` es un valor REAL y se guarda: lo
      // que no se hace es emitir su apunte al aprobar (R10 de la 42, aplicada en el servicio).
      montoIva: iva === undefined ? "0.00" : iva.toFixed(2),
      // Auditoria: QUE FILA de `tarifas` produjo los dos importes. `null` no puede darse en esta
      // rama (sin tarifa no hay flete), pero se escribe total en vez de con un `!`.
      tarifaId: tarifa === null ? null : tarifa.tarifaId,
      // Dia CALENDARIO de Costa Rica. NO `toISOString().slice(0,10)`: despues de las 18:00 CR eso
      // devuelve el dia SIGUIENTE (el off-by-one que cerro la feature 166).
      generadoEl: fechaCalendarioCR(this.now()),
    };
  }
}
