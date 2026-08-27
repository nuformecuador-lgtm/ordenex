import { Prisma } from "@prisma/client";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
// FEATURE 276 (T9, R7): el umbral de intentos se resuelve AQUI, en el servicio, y viaja al
// repositorio como un numero dentro de `liberacionSinGestionar`. La capa de datos no lee
// configuracion: si lo hiciera, habria dos fuentes del mismo umbral.
import { reintentosConfig } from "@/lib/config/reintentos";
import type {
  CatalogoFiltrosCierresDTO,
  FiltrosCierres,
  FiltrosDescargaGestiones,
} from "@/lib/types/filtros-cierres";
import { CATALOGO_FILTROS_CIERRES_VACIO } from "@/lib/types/filtros-cierres";
import { cierreConfig } from "@/lib/config/cierre";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  Alcance,
  CierreAdminResumenRow,
  GestionIncidenteDelCierre,
  GestionRetornableDelCierre,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ILiquidacionPagoRepository } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreGrupos } from "@/lib/interfaces/services/ICierreDiaService";
import type { ActualizarPagosGestionInput } from "@/lib/types/cierres-admin";
import type { CierreEstado } from "@/lib/types/cierre";
import type {
  ActualizarPagosGestionServiceResult,
  AprobarCierreServiceResult,
  CierreAdminResumen,
  CierreDetalleAdminServiceResult,
  ForzarSolicitudVencidoServiceResult,
  ICierresAdminService,
  ConfirmacionFisicaInput,
  IndemnizacionCapturadaInput,
  ListarCierresAdminServiceResult,
  ListarGestionesDescargaServiceResult,
  ListarHistoricoCierresAdminCompletoServiceResult,
  ListarHistoricoCierresAdminServiceResult,
  ListarPendientesCierresAdminCompletoServiceResult,
  ListarPendientesCierresAdminServiceResult,
  RechazarCierreServiceResult,
} from "@/lib/interfaces/services/ICierresAdminService";
import { descargaConfig } from "@/lib/config/descarga";
import { esColaCierreDia } from "@/lib/utils/colas-cierre";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";
import { excesoIndemnizacion } from "@/lib/utils/tope-indemnizacion";
import { rangoDePagina } from "@/lib/utils/rango-pagina";
import { toDetalleDTO } from "@/lib/services/CierreDiaService";
import {
  gananciaOrdenex,
  pagoTiendaOrdenex,
  totalesIngresoOrdenex,
} from "@/lib/utils/ingreso-ordenex";
import { desglosarIngresoBodegaPorOrigen } from "@/lib/utils/desglose-rechazos-sla";
import { ESTATUS_DEVOLUCION_POR_CONFIRMAR } from "@/lib/types/gestion-destino";
// FEATURE 271 (R48/R10): la regla del bloqueo se CONSULTA, no se re-deriva aqui.
import { SIN_CIERRES_ABIERTOS, estaBloqueadoPorCierres } from "@/lib/utils/bloqueo-cierre";
// FEATURE 271 (T6.6, R42/R47): el aviso de «quedaste BLOQUEADO» que emite el RECHAZO. Mismo
// mecanismo que sus hermanos de la 146: notificador INYECTADO con default no-op + best-effort.
import {
  emitirBestEffort,
  notificadorNoOp,
  type MensajeroBloqueadoNotificador,
} from "@/lib/notificaciones/notificadores";

// Roles autorizados en el modulo (R1): acceso total (maestro/admin -> bodega central) y el
// adminSatelite (su bodega). Cualquier otro -> forbidden.
const ROL_ADMIN_SATELITE = "adminSatelite";

// Mensaje accionable cuando falta el motivo de rechazo (R11).
const MSG_MOTIVO_REQUERIDO = "El motivo de rechazo es obligatorio.";

// Pedido humano (2026-08-19) — estados del cierre en los que su desglose todavia se corrige.
// Misma lista que la guardia del repositorio; aqui sirve para dar un `conflict` legible ANTES
// de abrir la transaccion, no para sustituirla (la de verdad es la del WHERE).
const ESTADOS_CIERRE_ABIERTO: CierreEstado[] = ["solicitado", "vencido"];

// Mensajes de la correccion del desglose. Sin PII y sin nombrar al mensajero: dicen QUE esta
// mal, que es lo unico que el admin necesita para arreglarlo.
const MSG_PAGOS_SOLO_ENTREGA = "Solo una entrega tiene desglose de pago que corregir.";
const MSG_PAGOS_SIN_COBRO = "Esta orden no tiene cobro asociado: no hay nada que repartir.";
const msgDescuadre = (total: string) => `El desglose debe sumar exactamente ${total}.`;

// Feature 158 (R19/R20/R21) — mensajes accionables de la captura de indemnizaciones. Texto
// fijo i18n-ready y SIN PII: nombran la gestion por su id (que el admin ya tiene en pantalla),
// nunca al mensajero, al destinatario ni al monto.
const MSG_INDEMNIZACION_FALTANTE = "Falta el monto de indemnización de este incidente.";
const MSG_INDEMNIZACION_AJENA =
  "Este monto no corresponde a un incidente de este cierre.";
const MSG_INDEMNIZACION_DUPLICADA = "Hay dos montos para el mismo incidente.";

// Feature 238 (T2.2, design §3.2, R9-R13) — los SEIS desenlaces de la confirmacion fisica, uno
// por correccion posible de quien esta en el mostrador con el paquete en la mano. Texto fijo
// i18n-ready y SIN PII: nombran la gestion por su id (que el admin ya tiene en pantalla), nunca
// al mensajero, al destinatario ni a la tienda (R44).
//
// CON TILDES, y los once mensajes de este bloque con ellas (decision del leader, 2026-08-19).
// Estos textos NO son identificadores ni logs: salen por `fieldErrors` a la pantalla de bodega y
// los lee una persona con el paquete en la mano. El 2026-08-07 este repo encontro SIETE etiquetas
// mal escritas que doce mil tests daban por buenas —entre ellas «Ordenes creadas», la palabra
// central del producto, en la primera pantalla del maestro—: ninguna suite miraba el texto que lee
// un humano. La consistencia con los vecinos era el argumento para no divergir; la salida fue
// arreglar los once, no heredar el defecto.
const MSG_CONFIRMACION_FALTANTE = "Falta confirmar la recepción de este paquete.";
const MSG_CONFIRMACION_AJENA = "Esta gestión no pertenece a lo que vuelve en este cierre.";
const MSG_CONFIRMACION_DUPLICADA = "Este paquete se confirmó dos veces.";
// R11: mensaje PROPIO, distinto del de gestion ajena. La diferencia no es cosmetica: «no
// pertenece» invita a buscar el paquete, y aqui el paquete NO EXISTE (se perdio, se robo o se
// dano) y lo que corresponde es indemnizarlo (158).
const MSG_CONFIRMACION_INCIDENTE =
  "Los incidentes no se confirman: el paquete no vuelve a bodega.";
const MSG_CONFIRMACION_GUIA_DISTINTA = "La guía leída no es la de este paquete.";
// R13: la orden llego a reparto sin guia. Medido el 2026-08-19: hoy no existe esa poblacion.
// Se bloquea y se DICE, nunca se omite en silencio — omitirla dejaria un paquete aprobado sin
// que nadie lo tuviera delante, que es justo lo que esta feature viene a impedir.
const MSG_CONFIRMACION_SIN_GUIA =
  "Este paquete no tiene número de guía y no se puede confirmar. Avisá a un administrador.";

// Feature 239 (T2.1, R9): catalogo incompleto -> la aprobacion NO ocurre. Texto SIN PII y con el
// mismo tono accionable que el resto (patron `MSG_CATALOGO` de la 36/67).
const MSG_CATALOGO_ANCLAJE =
  "No se puede aprobar: el catálogo de estados está incompleto (seed pendiente).";

// Feature 109 (T3.1, R16): estados del catalogo que consume la LIBERACION de `sin_gestionar` al
// aprobar (destinos de bodega por zona de la orden).
const ESTADO_SIN_GESTIONAR = "sin_gestionar";
const ESTADO_EN_BODEGA = "en_bodega_central";
const ESTADO_EN_BODEGA_SATELITE = "en_bodega_satelite";

// Feature 139 (T1.2, R5): estados del catalogo que consume el DISPARO de la devolucion de
// RECHAZADAS al aprobar. Origen `rechazada`; destinos por zona de la orden: bodega satelite ->
// `por_devolver`, bodega central -> `por_devolver_a_tienda` (misma regla `resolverDestinoCierre`).
const ESTADO_RECHAZADA = "rechazada";
const ESTADO_POR_DEVOLVER = "por_devolver";
const ESTADO_POR_DEVOLVER_A_TIENDA = "por_devolver_a_tienda";

// Feature 239 (T2.1, R4/R9): los DOS estados del ANCLAJE de la devolucion. Origen = el
// pre-estado en el que el mensajero deja la orden al gestionar (`ESTATUS_POR_RESULTADO` de
// `lib/types/gestion-destino.ts`, punto unico de esa regla); destino = `devuelta`.
const ESTADO_DEVUELTA = "devuelta";

// Metodos de repo consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
// Feature 109 (T3.1): + `findEstatusIdByValue` para resolver los estatus destino de la liberacion.
type OrdenRepo = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findEstatusIdByValue"
  // FEATURE 271 (T7.1, R48): el estado de bloqueo del mensajero viaja en la fila del cierre.
  // Se pide el CONTADOR en lote y no el detalle por fila: son decenas de filas por pagina.
  | "contarCierresAbiertosPorMensajero"
  // FEATURE 271 (T6.6, R42/R43): el DETALLE de UN mensajero —N, V y cual toca primero— para el
  // aviso del RECHAZO. Es el detalle y no el contador porque el texto tiene que CONTAR: un
  // «estas bloqueado» a secas no cumple R43. Se pide UNA vez, por rechazo, fuera de toda tx.
  | "findBloqueoDetalle"
>;
/**
 * Feature 172 (T C.2) — de todo el repositorio de la liquidacion, este servicio consume DOS
 * metodos, y los dos son de LECTURA. El `Pick` no es cosmetico: deja escrito —y hace que el
 * typecheck lo imponga— que la pantalla de cierres puede DERIVAR el pendiente y no puede
 * registrar, anular ni tocar un solo pago. Aprobar y pagar son dos escrituras distintas (§8).
 */
type LiquidacionLecturaRepo = Pick<
  ILiquidacionPagoRepository,
  "sumarVigentesPorCierre" | "obtenerCierreParaPago"
>;

/**
 * Feature 293 (T2.3, design §7) — del repositorio del LIBRO del mensajero, esta pantalla consume
 * UN metodo, y es de LECTURA. Mismo criterio que el `Pick` de arriba y por el mismo motivo: deja
 * escrito —y hace que el typecheck lo imponga— que la pantalla de cierres puede DERIVAR lo
 * pagable con el premio dentro, y NO puede escribir un premio (R3: el premio solo nace de un
 * acto humano en `Wallet > Mensajeros`).
 */
type PremiosLecturaRepo = Pick<IPagoMensajeroMovimientoRepository, "sumarPremiosVivosPorCierre">;

// Resultado interno de resolver el alcance del actor (R2/R3).
type AlcanceResult =
  | { status: "ok"; alcance: Alcance }
  | { status: "sinZona" } // adminSatelite sin zona (R3)
  | { status: "forbidden" }; // rol invalido (R1)

/**
 * Feature 38 — logica de negocio de "Cierres del dia" del admin (maestro /
 * adminSatelite). Lista los cierres del alcance (rol+zona), muestra el detalle con
 * evidencias firmadas (R7) y transiciona `solicitado` -> aprobado/rechazado con
 * guardia de estado+alcance (R12/R13). No conoce HTTP ni Prisma; testeable con dobles.
 */
export class CierresAdminService implements ICierresAdminService {
  constructor(
    private readonly repo: ICierresAdminRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly signedUrls: ISignedUrlProvider,
    // Feature 172 (T C.2): SOLO LECTURA de los pagos ya registrados, para derivar el pendiente
    // de cada cierre aprobado (R22/R26/R28). Es una dependencia OBLIGATORIA a proposito: si
    // fuera opcional, olvidar cablearla dejaria todos los pendientes en silencio a `null` —una
    // deuda invisible— en vez de romper el build.
    private readonly liquidacionRepo: LiquidacionLecturaRepo,
    /**
     * Feature 293 (T2.3/T2.5, R24/R26/R27) — SOLO LECTURA de los premios imputados, para que lo
     * pagable de cada cierre aprobado sea `snapshot + premios vivos − pagos vigentes` y no una
     * segunda formula.
     *
     * OBLIGATORIA, sin default, y por el MISMO motivo que `liquidacionRepo`: si fuera opcional,
     * olvidar cablearla dejaria los pendientes SIN el premio en silencio —un cierre que la
     * pantalla declara saldado cuando debe ₡5.000— en vez de romper el build. Va DESPUES de
     * `liquidacionRepo` y ANTES del notificador opcional, asi que no hay forma de cablearla
     * «casi bien».
     */
    private readonly premiosRepo: PremiosLecturaRepo,
    /**
     * FEATURE 271 (T6.6, R42/R47) — notificador de «quedaste BLOQUEADO», con DEFAULT NO-OP. Lo
     * dispara el RECHAZO, que es la UNICA via por la que un mensajero llega a tener DOS cierres
     * re-solicitables (solicita el dia 1, solicita el dia 2, el admin rechaza los dos): sin este
     * aviso, el caso mas confuso de todos es justo el que llega mudo y el mensajero se entera de
     * que le rechazaron el cierre al toparse con el bloqueo.
     *
     * OPCIONAL Y CON DEFAULT NO-OP, a diferencia de `liquidacionRepo`, que es obligatorio: alli
     * un olvido de cableado dejaria todos los pendientes en `null` en silencio, aqui el riesgo va
     * en la direccion CONTRARIA. Este servicio lo instancian trece suites y una base de datos
     * LOCAL COMPARTIDA esta al otro lado; con el real por defecto, cualquiera de ellas escribiria
     * avisos de verdad. El composition root (`lib/actions/cierres-admin.ts`) inyecta el real, y
     * hay una guardia que lo comprueba (`notificacion-notificadores-reales.test.ts`).
     */
    private readonly notificarBloqueo: MensajeroBloqueadoNotificador = notificadorNoOp,
  ) {}

  /**
   * FEATURE 271 (T6.6, R42/R43/R47) — el aviso de «quedaste BLOQUEADO» que sigue a un RECHAZO.
   *
   * Tres propiedades, y las tres son deliberadas:
   *
   *  1. **FUERA de la transaccion del rechazo, y despues de que haya confirmado.** No se pasa
   *     ningun notificador a `resolverCierre`: ese metodo abre la tx que mueve el estado del
   *     cierre y el aviso no entra ahi. En Postgres un error de sentencia aborta la transaccion
   *     ENTERA, asi que un aviso caido REVERTIRIA un rechazo legitimo — la misma leccion que la
   *     262 dejo escrita en `notificarDiaRepartoCorregidoCon`.
   *  2. **BEST-EFFORT.** `emitirBestEffort` absorbe el fallo y lo deja registrado con su causa.
   *     EL RECHAZO MANDA, EL AVISO ES CORTESIA: si la campana esta caida, el rechazo sigue
   *     siendo valido y el admin no ve un error por algo que ya ocurrio (R47).
   *  3. **Relee el detalle DESPUES de escribir.** El `N`/`V` que el texto cuenta es el de AHORA,
   *     con el `rechazado` recien creado ya dentro; calcularlo antes diria uno menos.
   *
   * LA ENTIDAD DE LA NOTIFICACION ES EL CIERRE RECHAZADO, no el mensajero: dos rechazos son dos
   * `entidad_id`, luego la clave `notificacion_dedupe_key` no colisiona y el segundo rechazo SI
   * avisa aunque el primero siga sin leerse (R44). Elegir mal la entidad convierte «avisar dos
   * veces» en un silencio estructural.
   *
   * POR QUE SE RELEE EL CIERRE: `rechazarCierre` recibe un `cierreId` y un actor que es el ADMIN;
   * el mensajero y la zona destino —los dos destinatarios del aviso— viven en la fila. Se relee
   * con `findCierreByIdEnAlcance` y con EL MISMO `alcance` que acaba de autorizar la escritura,
   * asi que el aviso no puede alcanzar un cierre que este admin no podia tocar. Es una lectura de
   * mas en un camino que un humano ejecuta a mano y raras veces —la pantalla acaba de correr esa
   * misma consulta para pintarle el detalle—, y evita abrir una consulta nueva en el repositorio.
   */
  private async avisarBloqueoPorRechazo(cierreId: string, alcance: Alcance): Promise<void> {
    await emitirBestEffort("mensajero_bloqueado_por_cierres", async () => {
      const detalle = await this.repo.findCierreByIdEnAlcance(cierreId, alcance);
      if (detalle === null) return; // sin cierre resoluble no se inventa un aviso
      const { mensajeroId, destinoZonaId } = detalle.cierre;
      const bloqueo = await this.ordenRepo.findBloqueoDetalle(mensajeroId);
      // Tras un rechazo `V >= 1` y el mensajero esta bloqueado, asi que esto casi siempre pasa.
      // Casi: entre la escritura y esta lectura el mensajero pudo re-solicitar el cierre (R16 lo
      // permite SIEMPRE, es el anti-deadlock). Avisar entonces seria mandarle un aviso que dice
      // lo que el servidor ya no hace, que es el fallo que R43 prohibe por su nombre.
      if (!bloqueo.bloqueado) return;
      await this.notificarBloqueo({
        cierreId,
        zonaId: destinoZonaId,
        mensajeroUsuarioId: mensajeroId,
        bloqueo,
      });
    });
  }

  // R1/R2/R3: resuelve el alcance server-side por rol+zona. Acceso total (maestro/admin) ve
  // todos los `bodega_central` (sin filtro de zona); el adminSatelite solo su zona satelite.
  private async resolveAlcance(actor: Actor): Promise<AlcanceResult> {
    if (esAccesoTotal(actor.rol)) {
      return { status: "ok", alcance: { destinoTipo: "bodega_central", destinoZonaId: null } };
    }
    if (actor.rol === ROL_ADMIN_SATELITE) {
      const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
      if (zonaId === null) return { status: "sinZona" }; // R3
      return { status: "ok", alcance: { destinoTipo: "bodega_satelite", destinoZonaId: zonaId } };
    }
    return { status: "forbidden" }; // R1: cualquier otro rol
    // Nota: `zonaRepo.findCentralZonaId()` queda como verificacion defensiva reservada
    // (design §3.1): el destino ya viene resuelto/persistido por la 37; la 38 filtra
    // por destino_tipo/destino_zona_id (columnas indexadas), sin releer la zona central.
  }

  async listarCierresAdmin(actor: Actor): Promise<ListarCierresAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") {
      return { status: "ok", pendientes: [], historico: [], sinZona: true }; // R3
    }

    // R2: el filtro por alcance vive en el repo (WHERE), nunca en memoria.
    const rows = await this.repo.findCierresByAlcance(scope.alcance);

    // R4/R5 + feature 41/E2 (R20): partir por estado. Los estados RESOLUBLES
    // (`solicitado` y `vencido`) van a la cola de pendientes; los resueltos
    // (`aprobado`/`rechazado`) al historico. El `vencido` viaja con su `estado` en el
    // resumen, para que el frontend lo etiquete diferenciado dentro de la cola (R20).
    // Feature 172 (T C.2): UNA sola agregacion para las DOS listas, no una por lista y menos
    // una por fila. Los cierres de la cola no aportan ningun id (no estan aprobados, R28).
    const resumenes = await this.conPendiente(rows);

    const pendientes: CierreAdminResumen[] = [];
    const historico: CierreAdminResumen[] = [];
    for (const resumen of resumenes) {
      // Feature 170 (T I.1): el corte sale de `ESTADOS_COLA_CIERRE_DIA` y ya no de dos
      // literales aqui. Es EL MISMO que el repositorio escribe como WHERE al paginar el
      // historico (R44): dos escrituras del mismo criterio es como una fila se cae de una
      // lista sin que nadie lo note.
      if (esColaCierreDia(resumen.estado)) pendientes.push(resumen);
      else historico.push(resumen);
    }
    return { status: "ok", pendientes, historico, sinZona: false };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — el HISTORICO, paginado en servidor.
   *
   * No reimplementa nada del alcance: reusa `resolveAlcance`, que es el `construirWhere` de
   * este servicio (el rol y la zona se resuelven server-side y NUNCA se aceptan del cliente).
   * Por eso paginar no puede ampliar lo que ve nadie — R44 se cumple por construccion, no por
   * vigilancia.
   *
   * `sinZona` -> pagina VACIA, no `forbidden`: el `adminSatelite` sin zona tiene acceso al
   * modulo, lo que no tiene es alcance que consultar. Es lo mismo que devuelve hoy
   * `listarCierresAdmin` (historico `[]`), asi que la pantalla no cambia de comportamiento.
   * Y ni una consulta se ejecuta en ese caso.
   *
   * UNA sola llamada al repositorio, igual que el listado sin paginar (R54): el conteo que
   * R41 exige viaja DENTRO de ella.
   */
  async listarHistoricoCierresAdminPaginado(
    input: { page: number; pageSize: number; filtros?: FiltrosCierres },
    actor: Actor,
  ): Promise<ListarHistoricoCierresAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") {
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 }; // R3
    }

    // Pedido humano del 2026-08-16: los filtros RECORTAN dentro del alcance que este servicio
    // acaba de resolver — van al repositorio como tercer argumento y se componen con `AND`,
    // nunca en lugar de `scope.alcance`. Un `adminSatelite` que pida la zona del vecino obtiene
    // la interseccion (vacio), no la zona del vecino.
    const { items, total } = await this.repo.findHistoricoPaginado(
      scope.alcance,
      rangoDePagina(input),
      input.filtros,
    );

    return {
      status: "ok",
      // R8/R9: mismo mapper que el listado sin paginar. Feature 172 (T C.2): + el pendiente,
      // con UNA sola agregacion para toda la pagina (el numero de consultas no crece con
      // `pageSize`, que es la misma propiedad que R54 exige del resto de este listado).
      items: await this.conPendiente(items),
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54) — la COLA de pendientes de decision,
   * paginada en servidor.
   *
   * Espejo exacto del metodo del historico: MISMO `resolveAlcance` (el rol y la zona salen del
   * usuario, nunca de la peticion) y MISMO corte, que aqui es el `in` de
   * `ESTADOS_COLA_CIERRE_DIA` donde alli era el `notIn`. R44 se cumple por construccion.
   *
   * R49: NO se agrega dinero aqui. Los montos que la pantalla muestra por esta cola son los
   * SNAPSHOT de cada cierre, que viajan por fila tal cual (`toResumen` no recomputa nada); la
   * pantalla no deriva de este array ningun total. Lo que el `total` de la respuesta alimenta
   * es el CONTADOR de cabecera (R42), que es un conteo de filas, no dinero.
   *
   * `sinZona` -> pagina vacia sin consultar la base, igual que hoy: `listarCierresAdmin`
   * devuelve `pendientes: []` para ese mismo actor.
   */
  async listarPendientesCierresAdminPaginado(
    input: { page: number; pageSize: number; filtros?: FiltrosCierres },
    actor: Actor,
  ): Promise<ListarPendientesCierresAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") {
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 }; // R3
    }

    const { items, total } = await this.repo.findColaPaginada(
      scope.alcance,
      rangoDePagina(input),
      input.filtros, // recorte DENTRO del alcance (ver la nota del historico)
    );

    return {
      status: "ok",
      // R8/R9: mismo mapper que el listado sin paginar. Feature 172 (T C.2): el campo viaja
      // tambien aqui —siempre `null`, porque la cola son cierres NO aprobados (R28)— para que
      // las tres listas tengan la MISMA forma y la pantalla no tenga dos contratos.
      items: await this.conPendiente(items),
      page: input.page,
      pageSize: input.pageSize,
      total, // R41/R42: el total del CONJUNTO de la cola, nunca `items.length`
    };
  }

  /**
   * Feature 184 — Tanda D (T D.2, R1/R4/R6) — el HISTORICO ENTERO del alcance, sin recorte, que
   * es del que sale el archivo.
   *
   * **Lo que cierra.** Hasta hoy ese archivo se producia releyendo `listarCierresAdmin()`, que
   * trae el alcance ENTERO —cola e historico— y lo parte en memoria para que la pantalla se
   * quede con una de las dos mitades. Aqui se lee SOLO el historico, cortado en la base por el
   * mismo criterio que su pagina (R16).
   *
   * **Lleva `filtros` y NO lleva `input`, y las dos mitades son deliberadas.** Hasta el
   * 2026-08-16 este listado no admitia filtros y la lista blanca de su conjunto era de CERO
   * claves. El pedido humano de ese dia le dio cuatro (fecha, bodega destino, mensajero), y el
   * archivo recibe LOS MISMOS que la pagina: si no, «descargar» dejaria de significar «esto que
   * estoy viendo, entero». Lo que sigue sin viajar es la paginacion —un conjunto no tiene
   * pagina— y, sobre todo, el ALCANCE: sale del ACTOR, como en la pagina, y un `destinoZonaId`
   * en singular colado en el input muere en el borde con `validation_error` (R17). El plural
   * que si existe es un recorte: solo puede quitar filas dentro del alcance ya resuelto.
   *
   * `sinZona` -> conjunto vacio sin consultar la base, no `forbidden`: el `adminSatelite` sin
   * zona tiene acceso al modulo, lo que no tiene es alcance. Es lo mismo que devuelven hoy
   * `listarCierresAdmin` (`historico: []`) y la pagina.
   *
   * **Excepcion declarada a R29 de la 170.** R29 —feature `done`, requisito vivo— exige el tope
   * en el SERVIDOR y, superado, no materializar NI transportar mas de `N + 1` filas. Transportar
   * se cumple: por encima del tope no sale ni una fila, y ni siquiera se paga el `conPendiente`
   * de abajo. Materializar NO: `findHistoricoCompleto` es un `findMany` sin `take`, asi que el
   * historico del alcance entra entero en memoria y el tope lo mide esta funcion despues. El
   * conjunto es un cierre por mensajero y dia dentro del alcance —para un maestro, el alcance es
   * la operacion ENTERA—, y los cierres aprobados no se purgan: crece de forma monotona.
   *
   * Se acepta por el coste de lo contrario: para conservar el total EXACTO que el aviso publica
   * (R6) habria que pedir `limite + 1` y ademas un `count`, es decir la segunda consulta que R15
   * de esta feature mide y que esta migracion vino a quitar. Decision humana del 2026-08-05,
   * anotada en el design §3.1. Esto es una excepcion declarada, no un cumplimiento de R29.
   */
  async listarHistoricoCierresAdminCompleto(
    actor: Actor,
    filtros?: FiltrosCierres,
  ): Promise<ListarHistoricoCierresAdminCompletoServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R4: antes del repo
    if (scope.status === "sinZona") return { status: "ok", items: [], total: 0 };

    // Los MISMOS filtros que la pagina: el archivo tiene que ser «esto que estoy viendo,
    // entero», no «todo lo del alcance» (ver la nota del schema completo, `lib/types`).
    const conjunto = await this.repo.findHistoricoCompleto(scope.alcance, filtros);

    const limite = descargaConfig.MAX_FILAS;
    // R6: o van TODAS las filas del conjunto, o van solo los conteos. Nunca un archivo truncado.
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    // MISMO enriquecido que la pagina, y por eso las filas del archivo son las de la pagina y no
    // unas parecidas. `conPendiente` es UNA agregacion para todo el conjunto —no una por fila—,
    // asi que su coste no crece con el numero de filas. Se paga aunque el archivo no lleve la
    // columna del pendiente: emitir `null` ahi seria decir «este cierre no esta aprobado»
    // (172/R28) de cierres que SI lo estan, y eso es un dato equivocado en un DTO de dinero.
    return { status: "ok", items: await this.conPendiente(conjunto), total: conjunto.length };
  }

  /**
   * Feature 184 — Tanda D (T D.2, R1/R4/R6) — la COLA ENTERA de pendientes de decision del
   * alcance, sin recorte, para el archivo.
   *
   * Comparte con el de arriba la relectura que evita, y aqui se nota mas: la cola es la mitad
   * PEQUEÑA del conjunto (los cierres sin resolver), asi que producir su archivo arrastraba
   * todo el historico del alcance —que crece sin tope con los dias— para descartarlo.
   *
   * Los mismos `filtros` que su pagina, y por el mismo motivo que su hermano; el alcance sigue
   * saliendo del actor y no de la peticion.
   *
   * **Excepcion declarada a R29 de la 170**, la misma de arriba con el signo cambiado: se cumple
   * el transporte —superado el tope no va ninguna fila— y no el materializar, porque
   * `findColaCompleta` tampoco lleva cota. El riesgo, en cambio, es el menor de los dos: la cola
   * son los cierres pendientes de DECISION, la mitad que se vacia cada vez que el admin trabaja,
   * y no acumula con los dias como el historico. Misma decision del 2026-08-05 y mismo motivo:
   * acotar en base costaria el `count` extra que R15 de esta feature prohibe (design §3.1).
   */
  async listarPendientesCierresAdminCompleto(
    actor: Actor,
    filtros?: FiltrosCierres,
  ): Promise<ListarPendientesCierresAdminCompletoServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R4: antes del repo
    if (scope.status === "sinZona") return { status: "ok", items: [], total: 0 };

    const conjunto = await this.repo.findColaCompleta(scope.alcance, filtros); // idem

    const limite = descargaConfig.MAX_FILAS;
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite }; // R6
    }

    return { status: "ok", items: await this.conPendiente(conjunto), total: conjunto.length };
  }

  /**
   * Feature 230 — Tanda 2 (T2.2, R13-R16/R18/R20-R22) — las GESTIONES de los cierres del dia del
   * alcance, a grano de GESTION, de las que sale la HOJA FUNDIDA.
   *
   * Calcado de sus dos hermanos de arriba, y el calco es el requisito (R16): el criterio de
   * alcance no se reimplementa, se DELEGA en el mismo `resolveAlcance` que resuelve los cuatro
   * listados de esta pantalla. Por eso el orden de desenlaces tambien es el mismo —`forbidden`
   * antes del repositorio (R18), `sinZona` como conjunto vacio sin consultar la base y no como
   * `forbidden` (R20), y el tope evaluado aqui con `descargaConfig.MAX_FILAS` (R21)—.
   *
   * `filtros` son RECORTES y nunca alcance (R15): viajan al repositorio para componerse por
   * CONJUNCION con el alcance ya resuelto, de modo que un `mensajeroIds` de otra zona da CERO
   * filas (R37) y no un error — que es exactamente el mismo desenlace que un mensajero sin
   * cierres en el rango (R38), y eso es deliberado: distinguirlos filtraria informacion sobre
   * el alcance ajeno.
   *
   * **Ni una llamada a `this.signedUrls`** (R22). No es un olvido: el bloque de firma en lote de
   * `verCierreDetalle` seria trabajo pagado en red para tirarlo despues —la hoja no tiene
   * columna de evidencia— y, sobre todo, una URL firmada dentro de un archivo que se reenvia
   * por correo es acceso a la foto sin sesion.
   *
   * **Misma excepcion declarada a R29 de la 170** que sus dos hermanos: el tope se cumple en el
   * TRANSPORTE (por encima de el no sale ni una fila) y no en el MATERIALIZAR, porque la lectura
   * del repositorio es un `findMany` sin `take`. Aqui pesa mas que alli —el grano es la gestion,
   * no el cierre—, y por eso el rango de fechas del dialogo (R31) es la mitigacion de producto,
   * no un adorno: sin el, el conjunto por defecto es todo el historico del mensajero.
   */
  async listarGestionesCierresAdminCompleto(
    actor: Actor,
    filtros: FiltrosDescargaGestiones,
  ): Promise<ListarGestionesDescargaServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R18: antes del repo
    if (scope.status === "sinZona") return { status: "ok", items: [], total: 0 }; // R20

    const conjunto = await this.repo.findGestionesPorAlcanceCompleto(scope.alcance, filtros);

    const limite = descargaConfig.MAX_FILAS;
    // R21: o van TODAS las filas del conjunto, o van solo los conteos. Nunca un archivo truncado.
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    return { status: "ok", items: conjunto, total: conjunto.length };
  }

  /**
   * Pedido humano del 2026-08-16 — las opciones de los filtros de la pantalla.
   *
   * Misma puerta que los listados y en el mismo orden: rol invalido -> `forbidden` ANTES de
   * tocar el repositorio; `adminSatelite` sin zona -> catalogo VACIO sin consultar la base (no
   * `forbidden`: tiene acceso al modulo, lo que no tiene es alcance — es la misma respuesta que
   * dan sus listados, que devuelven cero filas).
   */
  async obtenerCatalogoFiltros(
    actor: Actor,
  ): Promise<
    { status: "ok"; catalogo: CatalogoFiltrosCierresDTO } | { status: "forbidden" }
  > {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" };
    if (scope.status === "sinZona") {
      return { status: "ok", catalogo: CATALOGO_FILTROS_CIERRES_VACIO };
    }
    return { status: "ok", catalogo: await this.repo.findCatalogoFiltros(scope.alcance) };
  }

  async verCierreDetalle(
    cierreId: string,
    actor: Actor,
  ): Promise<CierreDetalleAdminServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    // Sin zona no hay alcance valido: cualquier cierre esta, por definicion, fuera de
    // alcance (no se puede consultar sin acotar). R13: no_encontrada, sin filtrar.
    if (scope.status === "sinZona") return { status: "no_encontrada" };

    // R13: la guardia de alcance va en el WHERE del repo; null si no casa (no se
    // distingue "no existe" de "otra bodega/zona").
    const found = await this.repo.findCierreByIdEnAlcance(cierreId, scope.alcance);
    if (found === null) return { status: "no_encontrada" };

    // R7: firma en lote las evidencias (path crudo -> URL firmada de TTL acotado).
    const paths = found.gestiones
      .map((g) => g.evidenciaStoragePath)
      .filter((p): p is string => p !== null);
    // Best-effort DELIBERADO: si el storage no responde (credencial ausente, servicio
    // caido), el detalle se sirve SIN evidencias en vez de no servirse. Las evidencias
    // ilustran la decision; no son la decision. Bloquear el comprobante entero por ellas
    // deja el cierre sin poder aprobarse ni rechazarse, y un cierre atascado bloquea a su
    // mensajero y, por la regla de zona, las asignaciones de toda su zona. El fallo por
    // objeto concreto ya lo absorbe el provider, que omite lo que no puede firmar.
    let urlByPath: Record<string, string> = {};
    if (paths.length > 0) {
      try {
        urlByPath = await this.signedUrls.createSignedUrls(
          paths,
          cierreConfig.SIGNED_URL_TTL_SECONDS,
        );
      } catch {
        urlByPath = {};
      }
    }

    // R6: agrupa por resultado (4 claves siempre presentes) con el mapper reuso 37.
    // Feature 158/R18: 5 claves — el `incidente` es un grupo PROPIO del detalle del admin.
    const grupos: CierreGrupos = {
      entregada: [],
      reprogramada: [],
      devuelta: [],
      rechazada: [],
      incidente: [],
    };
    for (const g of found.gestiones) {
      grupos[g.resultado].push(toDetalleDTO(g, urlByPath));
    }

    // Totales por concepto del cierre: se suman desde el MISMO desglose por orden que ve el
    // admin en las tablas, no por una consulta aparte que podria no cuadrar con ellas.
    const totalesIngreso = totalesIngresoOrdenex(found.gestiones);

    // Ganancia DERIVADA: el ingreso bruto MENOS lo que se le debe al mensajero. El pago sale
    // del snapshot del cierre (no se recomputa, R4); el ingreso, del desglose por orden.
    // Feature 172 (T C.2/R26): el detalle tambien trae el pendiente —R26 lo pide «en el listado
    // de cierres Y en el detalle de ese cierre»—, por el mismo camino y con una sola agregacion.
    const [resumen] = await this.conPendiente([found.cierre]);
    const ganancia = gananciaOrdenex(totalesIngreso.total, resumen.totalPagoMensajero);

    // Pago a la tienda DERIVADO: lo RECIBIDO (total general) menos lo que Ordenex le factura
    // sobre esa plata. Sale de otra resta que la ganancia: parte de lo cobrado, no del bruto.
    const pagoTienda = pagoTiendaOrdenex(
      resumen.totales.general,
      totalesIngreso.fleteConIva,
      totalesIngreso.comisionConIva,
    );

    // Feature 102/R4-R8/R10: desglose SLA/manual del ingreso de bodega por rechazos, particionando
    // los montos por gestion YA snapshoteados por su clasificacion (esRechazoSla). SOLO LECTURA
    // (R6/R16): el `total` se LEE del snapshot del cierre (no se recomputa); la particion asegura
    // `sla + manual === total` (R5). El alcance satelite recibe este mismo desglose (R10).
    const desglose = desglosarIngresoBodegaPorOrigen(found.gestiones);
    const desgloseIngresoBodegaRechazos = {
      sla: desglose.totalSla,
      manual: desglose.totalManual,
      total: resumen.totalIngresoBodegaRechazos, // snapshot leido (R6), no recomputado
    };

    return {
      status: "ok",
      cierre: resumen,
      grupos,
      totalesIngreso,
      desgloseIngresoBodegaRechazos,
      ganancia,
      pagoTienda,
      // FEATURE 264 (B5, R7/R9/R27) — MAPEO DIRECTO, y deliberadamente aburrido.
      //
      // Passthrough puro de lo que el repositorio congelo: sin firmar URLs (no hay evidencia que
      // firmar), sin derivar nada y sin rozar `totalesIngreso`, `ganancia`, `pagoTienda` ni
      // `desgloseIngresoBodegaRechazos`. R19/R20 se cumplen aqui por AUSENCIA de codigo: no hay
      // ninguna linea que sume esta lista a un total, porque no hay en ella nada que sumar.
      ordenesSinGestion: found.sinGestion,
      // R27/R28: se emite TAL CUAL. Traducir un `false` a «lista vacia» seria volver a confundir
      // «no lo sabemos» con «no hubo ninguna», que es justo lo que esta feature vino a separar.
      sinGestionRegistrado: found.sinGestionRegistrado,
    };
  }

  async aprobarCierre(
    cierreId: string,
    actor: Actor,
    // Feature 158 (R19/R36): default `[]` = el contrato de la 38 intacto. Un cierre SIN
    // incidentes se aprueba exactamente como hoy; uno CON incidentes y lista vacia cae en la
    // guardia de cobertura de abajo, asi que el default no abre ningun agujero.
    indemnizaciones: ReadonlyArray<IndemnizacionCapturadaInput> = [],
    // Feature 238 (R7/R15/R16): cuarto parametro posicional con default, exactamente como la 158
    // anadio el tercero. `[]` = «no se confirmo nada», que NO es lo mismo que «no habia nada que
    // confirmar»: si el cierre tiene retornables, la guardia de abajo lo rechaza (R15).
    confirmacionFisica: ReadonlyArray<ConfirmacionFisicaInput> = [],
  ): Promise<AprobarCierreServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // Feature 238 (T2.2, design §3.2, R7-R16) — COBERTURA EXACTA DE LOS PAQUETES QUE VUELVEN, y
    // va ANTES que la de indemnizaciones POR LA MISMA RAZON por la que la pantalla pone la
    // ventana de escaneo antes que la captura de montos (R37): si falta un paquete, no tiene
    // sentido validar dinero que se va a descartar. Las dos guardias son independientes y las dos
    // devuelven ANTES de tocar el repo (R14), asi que un envio incompleto no llega ni a abrir la
    // transaccion de aprobacion.
    const errorConfirmacion = await this.validarConfirmacionFisica(
      cierreId,
      scope.alcance,
      confirmacionFisica,
    );
    if (errorConfirmacion !== null) return errorConfirmacion;

    // Feature 158 (R19/R20/R21/R25) — COBERTURA EXACTA, ANTES de tocar el repo. El conjunto de
    // `gestionId` recibidos debe ser IGUAL al de gestiones `incidente` del cierre, leidas
    // DENTRO del alcance ya resuelto (R25: fuera de alcance devuelve [], sin revelar nada).
    // Falta alguna -> error por esa gestion (R19/R20); sobra alguna, o no es un incidente de
    // este cierre -> error por esa entrada (R21). En los dos casos el cierre queda
    // `solicitado` y NO se emite ningun movimiento.
    const errorCobertura = await this.validarCoberturaIndemnizaciones(
      cierreId,
      scope.alcance,
      indemnizaciones,
    );
    if (errorCobertura !== null) return errorCobertura;

    // Feature 109 (T3.1, R16): resuelve la config de la LIBERACION de `sin_gestionar` (estatus
    // destino por zona + zona central). Se pasa SOLO al aprobar; el repo la corre DENTRO de la tx,
    // guardada por `estatus_id = sin_gestionar` (no-op si el cierre no tiene ordenes congeladas,
    // R20). Si el catalogo no tiene los estados (seed pendiente) -> undefined (no libera, defensivo).
    // Feature 139 (T1.2, R5): + resuelve la config del DISPARO de la devolucion de `rechazada`
    // (origen `rechazada`; destinos `por_devolver`/`por_devolver_a_tienda` por zona; reusa
    // `centralZonaId`). Se pasa SOLO al aprobar; el repo la corre DENTRO de la misma tx, tras la
    // liberacion `sin_gestionar`, guardada por `estatus_id = rechazada` (no-op si el mensajero no
    // tiene rechazadas, R7). Catalogo incompleto (seed pendiente) -> undefined (no dispara, defensivo).
    const [
      sinGestionarEstatusId,
      enBodegaEstatusId,
      enBodegaSateliteEstatusId,
      rechazadaId,
      porDevolverId,
      porDevolverATiendaId,
      centralZonaId,
      preEstadoId,
      devueltaId,
    ] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTADO_SIN_GESTIONAR),
      this.ordenRepo.findEstatusIdByValue(ESTADO_EN_BODEGA),
      this.ordenRepo.findEstatusIdByValue(ESTADO_EN_BODEGA_SATELITE),
      this.ordenRepo.findEstatusIdByValue(ESTADO_RECHAZADA),
      this.ordenRepo.findEstatusIdByValue(ESTADO_POR_DEVOLVER),
      this.ordenRepo.findEstatusIdByValue(ESTADO_POR_DEVOLVER_A_TIENDA),
      this.zonaRepo.findCentralZonaId(),
      // Feature 239 (T2.1, R4/R9): los dos ids del ANCLAJE.
      this.ordenRepo.findEstatusIdByValue(ESTATUS_DEVOLUCION_POR_CONFIRMAR),
      this.ordenRepo.findEstatusIdByValue(ESTADO_DEVUELTA),
    ]);
    // 💰 FEATURE 276 (T9, R7/R21): la config gana el destino `rechazada` y el UMBRAL. El umbral se
    // resuelve AQUI, en el servicio, y viaja como numero: el repositorio no lee configuracion.
    //
    // ⚠️ `rechazadaId !== null` entra en la MISMA condicion, y eso es FALLO CERRADO deliberado: si
    // el catalogo no resuelve `rechazada`, este bloque NO se cablea y la liberacion `sin_gestionar`
    // entera no ocurre —igual que hoy cuando falta cualquiera de los otros tres ids—. La
    // alternativa (cablear el bloque sin destino de rechazo) mandaria a bodega ordenes que ya
    // agotaron sus intentos, en silencio, que es exactamente lo que esta ficha cierra.
    const liberacionSinGestionar =
      sinGestionarEstatusId !== null &&
      enBodegaEstatusId !== null &&
      enBodegaSateliteEstatusId !== null &&
      rechazadaId !== null
        ? {
            sinGestionarEstatusId,
            enBodegaEstatusId,
            enBodegaSateliteEstatusId,
            centralZonaId,
            rechazadaEstatusId: rechazadaId,
            umbralIntentos: reintentosConfig.MIN_INTENTOS_ENTREGA,
          }
        : undefined;
    const devolucionRechazadas =
      rechazadaId !== null && porDevolverId !== null && porDevolverATiendaId !== null
        ? { rechazadaId, porDevolverId, porDevolverATiendaId, centralZonaId }
        : undefined;

    // Feature 239 (T2.1, design §3.3, R9) — FALLO CERRADO, y aqui la diferencia con las dos
    // configs de arriba es deliberada: aquellas caen a `undefined` y la aprobacion sigue
    // adelante sin esa rama (degradacion silenciosa aceptada). Si NO se puede resolver el
    // pre-estado o `devuelta`, la aprobacion NO OCURRE — ni transicion del cierre, ni
    // movimientos de dinero, ni anclaje—, porque aprobar sin poder anclar deja la devolucion
    // congelada para siempre: invisible para la tienda, sin reloj y sin que nadie se entere.
    // Es exactamente el estado del que esta feature viene a sacarnos, asi que no se acepta ni
    // una vez. Sin efectos parciales: se devuelve ANTES de tocar el repo.
    if (preEstadoId === null || devueltaId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: [MSG_CATALOGO_ANCLAJE] },
      };
    }

    // R10/R12-R15: transicion guardada. Aprobar limpia motivoRechazo (null).
    const res = await this.repo.resolverCierre({
      cierreId,
      alcance: scope.alcance,
      nuevoEstado: "aprobado",
      resueltoPor: actor.usuarioId, // R14
      motivoRechazo: null,
      liberacionSinGestionar, // feature 109/R16: libera `sin_gestionar` en la misma tx
      devolucionRechazadas, // feature 139/R5: dispara la devolucion de `rechazada` en la misma tx
      // Feature 239/R4: ANCLA las devoluciones de este cierre en la MISMA tx. OBLIGATORIO (no
      // opcional como las dos de arriba): sin el, la orden se queda en el pre-estado para
      // siempre. Ver `AnclajeDevolucionConfig`.
      anclajeDevolucion: { preEstadoId, devueltaId },
      // Feature 158/R22: los montos ya con cobertura EXACTA verificada. El repo los escribe
      // GUARDADOS por `(cierreId, resultado)` y emite el egreso en la MISMA tx.
      indemnizaciones,
      // Feature 238/R17: las gestiones cuyo paquete bodega declaro tener delante, ya con su
      // cobertura EXACTA verificada arriba. Solo viajan los ids: la guia ya se contrasto (R12) y
      // el repo no la persiste. OBLIGATORIO en esta rama —puede ser `[]`, pero no puede faltar—
      // para que un olvido de cableado rompa el typecheck en vez de dejar la marca sin escribir.
      confirmacionFisica: confirmacionFisica.map(({ gestionId }) => ({ gestionId })),
    });
    if (res === "updated") {
      // Feature 172 (T C.2, §8/R16): el pendiente se deriva DESPUES de que la aprobacion haya
      // confirmado, nunca dentro de su transaccion. Un fallo aqui no puede revertir la
      // aprobacion —que es justo lo que el humano descarto (decision 3, alternativa A)—.
      return {
        status: "ok",
        cierreId,
        estado: "aprobado",
        pendientePagoMensajero: await this.pendienteTrasAprobar(cierreId),
      };
    }
    if (res === "conflict") return { status: "conflict" }; // R12
    return { status: "no_encontrada" }; // fuera_de_alcance (R13)
  }

  /**
   * Feature 172 (T C.2, §5/R22/R26/R28) — rellena `pendientePagoMensajero` de un conjunto de
   * filas con **UNA sola consulta**, sea la pagina de 1 fila o de 100.
   *
   * Tres propiedades, y las tres son el motivo de que esta funcion exista:
   *
   *  1. **Una llamada por listado, no una por fila.** `sumarVigentesPorCierre` recibe los ids de
   *     la pagina y devuelve un mapa. El numero de consultas NO crece con `pageSize` — la misma
   *     propiedad que la 170 exige (R54) del resto de esta pantalla, y se verifica CONTANDO
   *     llamadas, no leyendo este comentario.
   *  2. **Solo los APROBADOS entran en la consulta** (R28): un cierre en la cola no tiene nada
   *     que pagar y su pendiente es `null`, que no es lo mismo que `"0.00"` (R27).
   *  3. **`toResumen` sigue sin recomputar dinero.** El mapper emite `null` y punto; la
   *     derivacion vive aqui, en `derivarPendienteCierre`, que es la fuente unica de la regla
   *     (§5) y reusa a su vez `calcularSplitPago` de la 44. Los snapshots `P` y `E` se LEEN de
   *     la fila (`totalPagoMensajero`, `totales.efectivo`); no se recalculan.
   */
  private async conPendiente(rows: CierreAdminResumenRow[]): Promise<CierreAdminResumen[]> {
    const resumenes = rows.map(toResumen); // R8/R9: snapshots tal cual, sin recomputar
    const idsAprobados = resumenes
      .filter((r) => r.estado === "aprobado")
      .map((r) => r.cierreId);

    // UNA sola llamada, siempre: tambien con la lista vacia, para que el conteo de consultas de
    // este listado sea el mismo se pinte lo que se pinte.
    const pagados = await this.liquidacionRepo.sumarVigentesPorCierre(idsAprobados);
    // Feature 293 (T2.3, §6/6, R24/R27): los PREMIOS VIVOS de la misma pagina, con la misma
    // propiedad —UNA llamada por listado, no una por fila—. Es lo que hace que un cierre saldado
    // al que se le registra un premio vuelva a aparecer con «Pendiente de liquidar».
    const premios = await this.premiosRepo.sumarPremiosVivosPorCierre(idsAprobados);

    // FEATURE 271 (T7.1, R48) — EL ESTADO DE BLOQUEO DEL MENSAJERO, EN LA FILA.
    //
    // UNA sola consulta para TODO el listado (`groupBy` en lote), no una por fila: son decenas de
    // filas por pagina y un N+1 aqui es una pagina que tarda segundos. Y se pide el CONTEO, no el
    // detalle: la fila necesita decir CUANTOS arrastra y si esta bloqueado, no releer el mas viejo
    // de cada uno.
    //
    // Se consulta el MISMO predicado que aplica el servidor, no se re-deriva: la administracion ve
    // exactamente el estado con el que el mensajero se va a topar (R10).
    const conteo = await this.ordenRepo.contarCierresAbiertosPorMensajero([
      ...new Set(resumenes.map((r) => r.mensajeroId)),
    ]);

    return resumenes.map((r) => {
      const c = conteo.get(r.mensajeroId) ?? SIN_CIERRES_ABIERTOS;
      const bloqueoMensajero = {
        bloqueado: estaBloqueadoPorCierres(c),
        cierresAbiertos: c.n,
        cierresPorReenviar: c.v,
      };
      return r.estado === "aprobado"
        ? {
            ...r,
            bloqueoMensajero,
            pendientePagoMensajero: derivarPendienteCierre({
              pagoDebido: r.totalPagoMensajero, // P — snapshot de la 39, NUNCA reescrito (293/R13)
              efectivo: r.totales.efectivo, // E — snapshot de la 37
              premiosVivos: premios[r.cierreId] ?? "0.00", // Σ premios VIVOS del cierre (293/R24)
              pagadoVigente: pagados[r.cierreId] ?? "0.00", // Σ pagos VIGENTES del cierre (R80)
            }),
          }
        : { ...r, bloqueoMensajero }; // R28: no aprobado -> `null` (lo que ya puso `toResumen`)
    });
  }

  /**
   * Feature 172 (T C.2, §8) — el pendiente del cierre RECIEN aprobado.
   *
   * Va por `obtenerCierreParaPago` y no por `findCierreByIdEnAlcance` porque lo que hace falta
   * son cuatro columnas del cierre (`P`, `E`, estado, id) y aquel arrastra todas las gestiones
   * del cierre con su detalle. Es una lectura, no una escritura: la aprobacion ya confirmo.
   *
   * `"0.00"` si el cierre no se puede releer —imposible en el camino real, porque acabamos de
   * actualizarlo— y es la respuesta segura: no ofrece pagar una cifra que nadie ha derivado. El
   * pendiente real seguira apareciendo en el listado, que lo recalcula cada vez que alguien mira.
   */
  private async pendienteTrasAprobar(cierreId: string): Promise<string> {
    const cierre = await this.liquidacionRepo.obtenerCierreParaPago(cierreId);
    if (cierre === null) return "0.00";
    const pagados = await this.liquidacionRepo.sumarVigentesPorCierre([cierreId]);
    // Feature 293 (T2.3, §6/7): al APROBAR aun no puede haber premio —el premio se registra
    // despues y solo sobre un cierre ya aprobado—, asi que esta lectura devolvera `"0.00"`
    // siempre. Se hace igual, y a proposito: dos formulas para el mismo numero es como dos
    // pantallas acaban diciendo cifras distintas (R26).
    const premios = await this.premiosRepo.sumarPremiosVivosPorCierre([cierreId]);
    return derivarPendienteCierre({
      pagoDebido: cierre.totalPagoMensajero,
      efectivo: cierre.totalEfectivo,
      premiosVivos: premios[cierreId] ?? "0.00",
      pagadoVigente: pagados[cierreId] ?? "0.00",
    });
  }

  /**
   * Feature 238 (T2.2, design §3.2, R7-R16) — COBERTURA EXACTA de la confirmacion fisica.
   * ESPEJO de `validarCoberturaIndemnizaciones`, y por el mismo motivo: el borde (zod) no sabe
   * que gestiones tiene ese cierre, asi que la cobertura solo se puede comprobar leyendo el
   * cierre DENTRO del alcance del actor. Eso es logica de negocio y vive aqui (design §10-F).
   *
   * Devuelve `null` si el conjunto de `gestionId` recibidos es IGUAL al de gestiones del cierre
   * que vuelven a bodega; si no, un `validation_error` con un error POR GESTION (R8/R9/R10), que
   * es lo que permite a la pantalla pintarlo en SU fila y no como un bloqueo mudo.
   *
   * NO hay puerta de escape (D2, firmada el 2026-08-19): un solo paquete perdido devuelve el
   * cierre entero. La salida cuando un paquete no llego YA EXISTE y es rechazar el cierre con
   * motivo, que se lo devuelve al mensajero. Esa friccion es exactamente lo que hace que los
   * paquetes aparezcan; ablandarla aqui la deshace el primer dia de prisa.
   */
  private async validarConfirmacionFisica(
    cierreId: string,
    alcance: Alcance,
    confirmacionFisica: ReadonlyArray<ConfirmacionFisicaInput>,
  ): Promise<{ status: "validation_error"; fieldErrors: Record<string, string[]> } | null> {
    const esperadas = await this.repo.findGestionesRetornablesDelCierre(cierreId, alcance);
    // R16: un cierre SIN nada que devolver se aprueba con el MISMO comportamiento y el MISMO
    // payload que antes de esta feature — ni una consulta mas aguas abajo. Medido: es 3 de cada
    // 12 cierres, un camino de igual rango, no un `else` de cortesia.
    if (esperadas.length === 0 && confirmacionFisica.length === 0) return null;

    const porId = new Map<string, GestionRetornableDelCierre>(
      esperadas.map((g) => [g.gestionId, g]),
    );
    const fieldErrors: Record<string, string[]> = {};
    const vistos = new Set<string>();

    // La lectura de los incidentes es PEREZOSA y se hace COMO MUCHO UNA VEZ: solo hace falta
    // para redactar el mensaje de una entrada que no esta en el conjunto esperado (R11), que es
    // el camino de error. En el camino feliz —el que corre siempre en produccion— no se paga.
    let idsIncidente: Set<string> | null = null;
    const esIncidenteDeEsteCierre = async (gestionId: string): Promise<boolean> => {
      idsIncidente ??= new Set(
        (await this.repo.findGestionesIncidenteDelCierre(cierreId, alcance)).map(
          (g) => g.gestionId,
        ),
      );
      return idsIncidente.has(gestionId);
    };

    for (const { gestionId, numGuia } of confirmacionFisica) {
      if (vistos.has(gestionId)) {
        // R10: la misma gestion confirmada dos veces. Sin esto, dos entradas cubririan una sola
        // gestion y el conteo cuadraria con un paquete menos delante.
        fieldErrors[gestionId] = [MSG_CONFIRMACION_DUPLICADA];
        continue;
      }
      vistos.add(gestionId);
      const esperada = porId.get(gestionId);
      if (esperada === undefined) {
        // R11 vs R10: distinguir el INCIDENTE de la gestion ajena. Los incidentes de ESTE cierre
        // ya se leen para la cobertura de la 158, asi que no cuesta una consulta mas. Y la
        // distincion importa: «no pertenece» invita a buscar el paquete; el incidente no hay
        // donde buscarlo.
        fieldErrors[gestionId] = [
          (await esIncidenteDeEsteCierre(gestionId))
            ? MSG_CONFIRMACION_INCIDENTE
            : MSG_CONFIRMACION_AJENA,
        ];
        continue;
      }
      if (esperada.numGuia === null) {
        // R13: la orden no tiene numero de guia. La gestion NO se omite del conjunto esperado
        // (sale de la lectura como cualquier otra) y aqui se bloquea nombrando el motivo.
        fieldErrors[gestionId] = [MSG_CONFIRMACION_SIN_GUIA];
      } else if (esperada.numGuia !== numGuia) {
        // R12: se leyo una guia que no es la de este paquete. Es la diferencia entre «bodega
        // tuvo ESTE paquete delante» y «bodega escaneo algo».
        fieldErrors[gestionId] = [MSG_CONFIRMACION_GUIA_DISTINTA];
      }
    }

    // R9: falta la confirmacion de alguna gestion del conjunto esperado -> error en ESA gestion.
    for (const { gestionId } of esperadas) {
      if (!vistos.has(gestionId)) fieldErrors[gestionId] = [MSG_CONFIRMACION_FALTANTE];
    }

    if (Object.keys(fieldErrors).length === 0) return null;
    return { status: "validation_error", fieldErrors };
  }

  /**
   * Feature 158 (R19/R20/R21) — COBERTURA EXACTA de los montos de indemnizacion. Devuelve
   * `null` si el conjunto de `gestionId` recibidos es IGUAL al de gestiones `incidente` del
   * cierre; si no, un `validation_error` con un error POR GESTION (la UI los pinta por fila).
   *
   * Se resuelve aqui y no en el borde a proposito: el borde (zod) no sabe que gestiones tiene
   * ese cierre. Y va ANTES de llamar al repo para que un envio incompleto NO llegue a abrir la
   * transaccion de aprobacion.
   *
   * Fix «tope de negocio» (2026-08-04): ademas de la cobertura, aqui se acota el IMPORTE contra
   * el valor de la orden (`excesoIndemnizacion`). Vive en el mismo sitio y por el mismo motivo:
   * el borde no sabe cuanto valia el paquete, y la comprobacion tiene que ocurrir ANTES de que
   * se abra la transaccion que mueve el dinero. Este es UNO de los dos emisores; el otro es
   * `IncidenteAdminService.aprobar`, y los dos tienen que aplicarlo o el agujero sigue abierto
   * por el que falte.
   */
  private async validarCoberturaIndemnizaciones(
    cierreId: string,
    alcance: Alcance,
    indemnizaciones: ReadonlyArray<IndemnizacionCapturadaInput>,
  ): Promise<{ status: "validation_error"; fieldErrors: Record<string, string[]> } | null> {
    const delCierre = await this.repo.findGestionesIncidenteDelCierre(cierreId, alcance);
    // R36: sin incidentes y sin montos, el camino de hoy queda INTACTO (ni una consulta mas
    // aguas abajo, ni un campo nuevo obligatorio).
    if (delCierre.length === 0 && indemnizaciones.length === 0) return null;

    // El valor de la ORDEN de cada gestion esperada: es a la vez el conjunto de ids admitidos
    // (cobertura) y el tope de negocio de cada monto. Un solo mapa para las dos cosas, porque
    // salen de la MISMA lectura.
    const esperados = new Map<string, GestionIncidenteDelCierre["ordenMontoCobrar"]>(
      delCierre.map((g) => [g.gestionId, g.ordenMontoCobrar]),
    );
    const fieldErrors: Record<string, string[]> = {};
    const vistos = new Set<string>();

    for (const { gestionId, monto } of indemnizaciones) {
      if (vistos.has(gestionId)) {
        // R21: dos montos para la misma gestion. Sin esto, el ultimo ganaria en silencio.
        fieldErrors[gestionId] = [MSG_INDEMNIZACION_DUPLICADA];
        continue;
      }
      vistos.add(gestionId);
      // R21: una gestion que no pertenece a este cierre, o cuyo resultado no es `incidente`,
      // no esta en `esperados` (el repo filtra por las dos cosas).
      if (!esperados.has(gestionId)) {
        fieldErrors[gestionId] = [MSG_INDEMNIZACION_AJENA];
        continue;
      }
      // TOPE: tecnico + negocio (el valor de la orden). El monto viaja STRING y se compara con
      // `Prisma.Decimal` dentro del helper: nunca `number`, nunca `parseFloat`.
      const exceso = excesoIndemnizacion(monto, esperados.get(gestionId) ?? null);
      if (exceso !== null) fieldErrors[gestionId] = [exceso];
    }
    // R19/R20: falta el monto de alguna gestion `incidente` del cierre.
    for (const { gestionId } of delCierre) {
      if (!vistos.has(gestionId)) fieldErrors[gestionId] = [MSG_INDEMNIZACION_FALTANTE];
    }

    if (Object.keys(fieldErrors).length === 0) return null;
    return { status: "validation_error", fieldErrors };
  }

  /**
   * Pedido humano (2026-08-19) — CORRECCIÓN del desglose de pago de una gestión de un cierre
   * ABIERTO, desde el detalle del cierre. Solo maestro/admin.
   *
   * Las cuatro guardias, en este orden y todas ANTES de escribir:
   *
   *  1. **Rol.** `esAccesoTotal` y nada más. El `adminSatelite` tiene alcance para VER los
   *     cierres de su bodega (`resolveAlcance` se lo da), y aquí se le niega A PROPÓSITO:
   *     reescribir lo que un mensajero declaró haber cobrado no es leer su bodega. Por eso el
   *     guard va antes de resolver el alcance y no se apoya en él.
   *  2. **Alcance.** La gestión tiene que estar en un cierre del alcance del actor; el
   *     repositorio lo impone en el WHERE. Fuera de alcance e inexistente son el mismo
   *     desenlace: distinguirlos revelaría cierres ajenos.
   *  3. **Estado.** El cierre tiene que estar ABIERTO. Aprobado ya se liquidó; rechazado se
   *     corrige re-solicitándolo. Se comprueba aquí para dar un `conflict` legible, y OTRA VEZ
   *     dentro de la transacción (anti-TOCTOU): entre este `if` y la escritura cabe una
   *     aprobación de otro admin.
   *  4. **La suma.** En `Prisma.Decimal`, contra el `monto_recibido` que está EN LA BASE. El
   *     total no viaja en la petición justamente para que esta comparación no pueda hacerse
   *     contra un número que eligió la pantalla.
   */
  async actualizarPagosGestion(
    input: ActualizarPagosGestionInput,
    actor: Actor,
  ): Promise<ActualizarPagosGestionServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // guardia 1

    const scope = await this.resolveAlcance(actor);
    // Acceso total siempre resuelve alcance; las otras dos ramas son inalcanzables tras el
    // guard de rol y se tratan como «aquí no hay nada tuyo» en vez de asumirlo.
    if (scope.status !== "ok") return { status: "forbidden" };

    const gestion = await this.repo.findGestionEditableEnCierre(
      input.gestionId,
      scope.alcance,
    );
    if (gestion === null) return { status: "no_encontrada" }; // guardia 2

    if (!ESTADOS_CIERRE_ABIERTO.includes(gestion.cierreEstado)) {
      return { status: "conflict" }; // guardia 3
    }

    // Solo una ENTREGA reparte dinero; los otros cuatro resultados no cobran nada (R8/R25), así
    // que no hay desglose que corregir y aceptar uno inventaría un cobro.
    if (gestion.resultado !== "entregada") {
      return {
        status: "validation_error",
        fieldErrors: { lineas: [MSG_PAGOS_SOLO_ENTREGA] },
      };
    }

    // Una entrega SIN cobro (`monto_recibido` 0 o NULL) no tiene nada que repartir: cero
    // colones no se dividen entre métodos, son CERO líneas (misma regla 4 del borde del
    // mensajero, feature 212/R14).
    const montoRecibido = new Prisma.Decimal(gestion.montoRecibido ?? 0);
    if (montoRecibido.lte(0)) {
      return {
        status: "validation_error",
        fieldErrors: { lineas: [MSG_PAGOS_SIN_COBRO] },
      };
    }

    // Guardia 4: la suma, exacta. `Prisma.Decimal` y no `number`: 0.1 + 0.2 en coma flotante no
    // es 0.3, y este número decide cuánto se le paga a una persona.
    const suma = input.lineas.reduce(
      (acc, l) => acc.plus(new Prisma.Decimal(l.monto)),
      new Prisma.Decimal(0),
    );
    if (!suma.equals(montoRecibido)) {
      return {
        status: "validation_error",
        fieldErrors: { lineas: [msgDescuadre(montoRecibido.toFixed(2))] },
      };
    }

    const res = await this.repo.actualizarPagosGestion({
      gestionId: input.gestionId,
      alcance: scope.alcance,
      editadoPor: actor.usuarioId, // el rastro: quién reescribió lo que declaró el mensajero
      lineas: input.lineas,
    });
    if (res.status === "updated") {
      return { status: "ok", gestionId: input.gestionId, totales: res.totales };
    }
    if (res.status === "conflict") return { status: "conflict" };
    return { status: "no_encontrada" };
  }

  async rechazarCierre(
    cierreId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarCierreServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1

    // R11 (defensa): el borde ya valido con zod, pero el service re-exige motivo no
    // vacio antes de tocar el repo.
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      return { status: "validation_error", fieldErrors: { motivo: [MSG_MOTIVO_REQUERIDO] } };
    }

    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // R11-R15: transicion guardada; persiste el motivo con el cierre.
    const res = await this.repo.resolverCierre({
      cierreId,
      alcance: scope.alcance,
      nuevoEstado: "rechazado",
      resueltoPor: actor.usuarioId, // R14
      motivoRechazo: motivoLimpio,
    });
    if (res === "updated") {
      // FEATURE 271 (T6.6, R42): el aviso va AQUI —despues de que el rechazo haya confirmado y
      // fuera de su transaccion— y NUNCA altera lo que se devuelve. Ver `avisarBloqueoPorRechazo`.
      await this.avisarBloqueoPorRechazo(cierreId, scope.alcance);
      return { status: "ok", cierreId, estado: "rechazado" };
    }
    // `conflict` y `no_encontrada` NO avisan, y esa es media R42: un aviso por un rechazo que no
    // ocurrio le diria al mensajero que esta bloqueado por un cierre que sigue esperando decision.
    if (res === "conflict") return { status: "conflict" }; // R12
    return { status: "no_encontrada" }; // fuera_de_alcance (R13)
  }

  async forzarSolicitudVencido(
    cierreId: string,
    actor: Actor,
  ): Promise<ForzarSolicitudVencidoServiceResult> {
    // R16: acotada al alcance del admin (rol+zona destino), MISMO resolver que aprobar/rechazar.
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" }; // R1
    if (scope.status === "sinZona") return { status: "no_encontrada" }; // R13

    // R16: transicion guardada por estado ('vencido') + alcance en el repo. Money-safe (R21):
    // NO recalcula el snapshot ni toca `resuelto_por`/`resuelto_at`.
    //
    // ⚠️ FEATURE 241 (2026-08-20): aqui decia «R18: NO desbloquea; el desbloqueo ocurre al APROBAR
    // el `solicitado` resultante». SI DESBLOQUEA, en el acto: `solicitado` salio de
    // `ESTADOS_CIERRE_BLOQUEAN_GESTION`. Lo que sigue ocurriendo solo al aprobar es la resolucion
    // del dinero y la auditoria (R17), que es otra cosa.
    const res = await this.repo.forzarSolicitudVencido(cierreId, scope.alcance);
    if (res === "updated") return { status: "ok", cierreId, estado: "solicitado" };
    if (res === "conflict") return { status: "conflict" }; // ya no es `vencido`
    return { status: "no_encontrada" }; // fuera_de_alcance / inexistente (R13)
  }
}

// Row cruda -> resumen de dominio. La fila ya trae los totales como STRING (R9) y las
// marcas de tiempo en ISO; el service no recomputa nada (R8, snapshot money-critical).
function toResumen(row: CierreAdminResumenRow): CierreAdminResumen {
  return {
    cierreId: row.cierreId,
    mensajeroId: row.mensajeroId,
    mensajeroNombre: row.mensajeroNombre,
    estado: row.estado,
    destinoTipo: row.destinoTipo,
    destinoZonaId: row.destinoZonaId,
    destinoZonaNombre: row.destinoZonaNombre,
    totales: row.totales,
    totalPagoMensajero: row.totalPagoMensajero, // R17: snapshot, sin recomputar
    totalIngresoBodegaRechazos: row.totalIngresoBodegaRechazos, // feature 56/R16: snapshot, sin recomputar
    // Feature 172 (T C.2): el mapper NO deriva dinero. Emite `null` —el valor de un cierre no
    // aprobado (R28)— y el servicio lo rellena en `conPendiente` para los aprobados, con UNA
    // agregacion por pagina. Si la derivacion viviera aqui, seria una consulta por fila.
    pendientePagoMensajero: null,
    solicitadoAt: row.solicitadoAt,
    resueltoAt: row.resueltoAt,
    motivoRechazo: row.motivoRechazo,
  };
}
