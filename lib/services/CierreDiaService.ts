import { cierreConfig } from "@/lib/config/cierre";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  CierreGestionPendienteRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  DeshacerGestionServiceResult,
  ICierreDiaService,
  ListarCierreDiaServiceResult,
  ListarCierresPasadosCompletoServiceResult,
  ListarCierresPasadosServiceResult,
  SolicitarCierreServiceResult,
  VerCierrePasadoServiceResult,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { GestionResultado } from "@prisma/client";
import { descargaConfig } from "@/lib/config/descarga";
import { ESTATUS_DEVOLUCION_POR_CONFIRMAR } from "@/lib/types/gestion-destino";
import { rangoDePagina } from "@/lib/utils/rango-pagina";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";
import {
  computeTotales,
  derivarPagos,
  derivarIngresoBodega,
} from "@/lib/utils/cierre-totales";
import {
  emitirBestEffort,
  notificadorNoOp,
  type CierreNotificador,
} from "@/lib/notificaciones/notificadores";

// Solo el rol autorizado en el modulo (R1/R2): el mensajero, SIEMPRE acotado a su
// propio `usuario.id` (el filtro por mensajero vive en el repo, en el WHERE).
const ROL_AUTORIZADO = "mensajero";

// R10: estados de una orden asignada que aun cuenta como "pendiente de gestion".
// Mientras el mensajero tenga alguna en estos estados, no puede cerrar.
//
// FEATURE 235 (T4.1, R22/R23) - `ayuda_tienda` ENTRA AQUI POR SU NOMBRE, y este es todo el cambio
// funcional del bloqueo. Hasta el 2026-08-19 una orden con ayuda pedida bloqueaba el cierre POR
// ACCIDENTE: la solicitud era una bandera y la orden seguia en `en_reparto`, que si estaba en esta
// lista. Nadie habia escrito nunca «una orden en ayuda bloquea el cierre», asi que el dia que la
// orden dejara de estar en `en_reparto` -exactamente lo que hace esta feature- el bloqueo habria
// desaparecido en silencio. R23 pide que se derive de una LISTA EXPLICITA en la que el estatus
// figure por su nombre: aqui esta.
//
// Por que debe bloquear: el paquete sigue EN LA MANO del mensajero. Cerrar el dia con una orden
// suya sin desenlace dejaria el paquete fuera de todo cuadre.
const ESTADOS_PENDIENTES = ["por_recoger", "en_reparto", "ayuda_tienda"];

// Mensajes accionables del gate/precondicion (R10/R11) y del ruteo (R12/R16).
const MSG_PENDIENTES = "Tenes ordenes sin gestionar; gestionalas antes de cerrar."; // R10
const MSG_VACIO = "No tenes gestiones pendientes de cierre."; // R11
const MSG_DUPLICADO = "Ya tenes un cierre solicitado pendiente de aprobacion."; // R12
const MSG_SIN_ZONA = "No tenes una zona asignada; contacta a tu administrador."; // R16

// Feature 111/R5/R20: motivo ACCIONABLE del bloqueo total sobre las guías (texto fijo
// i18n-ready, SIN PII ni datos del cierre). Un mensajero con un cierre `solicitado`/`vencido`
// no puede hacer NADA con las guías (gestionar/recoger/escoger/deshacer) hasta resolverlo.
const MSG_BLOQUEADO =
  "Tenes un cierre pendiente sin resolver; resolvelo antes de gestionar tus guias."; // R5/R20

// Feature 67 — mensajes ACCIONABLES del deshacer (constantes i18n-ready, patron MSG_* de la 37).
const MSG_YA_EN_CIERRE = "Esta gestion ya esta incluida en un cierre solicitado; no se puede deshacer."; // R2
const MSG_YA_DESHECHA = "Esta gestion ya fue deshecha."; // R3
const MSG_NO_ES_LA_ULTIMA = "Esta orden tiene una gestion mas reciente; hay que deshacer esa primero."; // R4
const MSG_ORDEN_MOVIDA = "Esta orden ya fue procesada por la bodega; ya no se puede deshacer."; // R5
const MSG_ORDEN_BORRADA = "Esta orden fue eliminada; ya no se puede deshacer su gestion."; // R6
// 💰 Feature 237 (T5.5, D3 firmada por el humano el 2026-08-20, R38). ACCIONABLE: le dice al
// mensajero QUE paso, POR QUE no puede tocarlo y A QUIEN acudir — no es un «no se puede» a secas.
const MSG_GESTION_DE_LA_TIENDA =
  "Esta orden la resolvió la tienda desde su pantalla de ayuda; solo ella puede corregirlo. Escribile por el chat de la orden.";
const MSG_CATALOGO = "catalogo de estados incompleto (seed pendiente)"; // patron `gestionar` (36)

// Feature 67/R18: unico estado desde el que se puede volver a gestionar (`ORIGEN_GESTION` de
// MisAsignacionesService, guardia `cargarOrdenGestionable`). Destino del deshacer.
const ESTADO_EN_REPARTO = "en_reparto";

/**
 * Feature 67/R5 (design §5.3) — REGLA: estado en el que la orden DEBE estar para que su gestion
 * sea deshacible, derivado del `resultado` de esa gestion. Es la guardia de "la orden no se
 * movio": si la bodega ya la reasigno/ruteo/recibio, o el cron libero una `reprogramada`, o se
 * devolvio a la tienda de origen, o un admin ajusto el estado, el deshacer es peligroso -> conflict.
 * Derivado de `crearGestionYTransicionar` + `resolverSeguimientoDevuelta` (verificado):
 *   - entregada/reprogramada/rechazada: destino = `resultado`, sin seguimiento.
 *   - devuelta: la 47 emite un SEGUIMIENTO en la MISMA tx y la orden NUNCA reposa en `devuelta`
 *     (reintento -> `en_bodega_central`/`en_bodega_satelite`; escalado -> `rechazada`). `devuelta` se
 *     acepta SOLO por defensa ante filas anteriores a la 47.
 *   - incidente (feature 158/R14, Q-D): destino = `resultado`, sin seguimiento. `incidente` es
 *     TERMINAL: ninguna otra via la mueve de ahi (R13), asi que si la orden NO esta exactamente
 *     en `incidente` es que alguien la saco por un camino que esta feature no declara -> conflict.
 */
const ESTADOS_ESPERADOS: Record<GestionResultado, readonly string[]> = {
  entregada: ["entregada"],
  reprogramada: ["reprogramada"],
  rechazada: ["rechazada"],
  // Feature 239 (T1.5, R24) — `devolucion_por_confirmar` va PRIMERO y es una CORRECCION DE
  // REGRESION, no una asercion que se actualiza: desde la 239 una gestion `devuelta` deja la
  // orden en el PRE-ESTADO (`ESTATUS_POR_RESULTADO`, `lib/types/gestion-destino.ts`), asi que
  // sin este value la guarda de "la orden sigue exactamente donde la dejo esa gestion" no casa
  // NUNCA y el mensajero deja de poder deshacer su propia devolucion del dia. Los cuatro de
  // detras se conservan intactos: siguen siendo los sitios donde una devolucion YA ANCLADA
  // puede estar cuando alguien intenta deshacerla (reintento a bodega o escalado del cron, mas
  // `devuelta` por defensa ante filas anteriores a la 47/239).
  devuelta: [
    ESTATUS_DEVOLUCION_POR_CONFIRMAR,
    "en_bodega_central",
    "en_bodega_satelite",
    "rechazada",
    "devuelta",
  ],
  incidente: ["incidente"], // feature 158 (Q-D): el incidente SI se puede deshacer
};

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran
// como Pick para dobles de test sin DB/red (patron RecepcionSateliteService).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
// Feature 39: ademas de la zona (37), el service resuelve el vehiculo del mensajero
// para el resolver de tarifa. Feature 67: + `findEstatusIdByValue` (resuelve `en_reparto`).
// Feature 111/R5 -> 241: + `findMensajerosBloqueadosParaGestion` (guarda EXPLICITA de
// `deshacerGestion`; sin duplicar la derivacion ni flag persistido). Deshacer una gestion ES
// gestionar —mueve la guia y descuadra el cobro—, asi que le toca la politica de gestion:
// `vencido`/`rechazado` bloquean, `solicitado` no.
type OrdenRepo = Pick<
  IOrdenRepository,
  "findUsuarioZonaId" | "findUsuarioVehiculoId" | "findEstatusIdByValue" | "findMensajerosBloqueadosParaGestion"
>;

/**
 * Feature 37 — logica de negocio del "Cierre del dia" del mensajero. Lista el
 * detalle del dia + totales (money-safe con Prisma.Decimal), firma evidencias (R5)
 * y crea la solicitud de cierre con destino derivado por zona (R15) y snapshot de
 * totales (R14). No conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class CierreDiaService implements ICierreDiaService {
  constructor(
    private readonly repo: ICierreDiaRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly signedUrls: ISignedUrlProvider,
    // Feature 39: resolver de la tarifa de pago al mensajero (por zona+vehiculo).
    private readonly tarifaZonaRepo: ITarifaZonaMensajeroRepository,
    /**
     * Feature 146 (R24/R25): notificador de "cierre por aprobar". El DEFAULT es NO-OP: el
     * composition root (`lib/actions/cierre-dia.ts`) inyecta el real. BEST-EFFORT: corre
     * despues de la escritura ya guardada del cierre y nunca altera su resultado.
     */
    private readonly notificarCierre: CierreNotificador = notificadorNoOp,
  ) {}

  /**
   * Feature 146/R24 — punto UNICO de emision del aviso "cierre por aprobar", compartido por
   * los TRES caminos de exito de `solicitarCierre` (`vencido -> solicitado`,
   * `rechazado -> solicitado` y creacion). Los dos de transicion solo devuelven un booleano, de
   * modo que el id del cierre, su zona destino y el nombre del mensajero se leen aqui, despues
   * del exito. La dedupe del emisor evita el segundo aviso cuando el MISMO cierre se
   * re-solicita sin que nadie haya leido el primero (R27).
   */
  private async avisarCierrePorAprobar(mensajeroId: string): Promise<void> {
    await emitirBestEffort("cierre_dia_por_aprobar", async () => {
      const info = await this.repo.findCierreSolicitado?.(mensajeroId);
      if (!info) return; // sin cierre resoluble no se inventa un aviso
      await this.notificarCierre({
        cierreId: info.id,
        zonaId: info.destinoZonaId,
        mensajeroNombre: info.mensajeroNombre,
      });
    });
  }

  /**
   * Feature 39/R1-R4: resuelve la tarifa de pago vigente del mensajero (por su zona +
   * vehiculo, con fallback a la tarifa por defecto de la zona). `null` si el mensajero no
   * tiene zona o la zona no tiene tarifa -> pago 0.00 no bloqueante (R8).
   */
  private async resolveTarifaMensajero(usuarioId: string): Promise<PagoTarifa | null> {
    const zonaId = await this.ordenRepo.findUsuarioZonaId(usuarioId); // R4: zona del MENSAJERO
    if (zonaId === null) return null; // sin zona -> pago 0.00 (R8), no bloquea la vista
    const vehiculoId = await this.ordenRepo.findUsuarioVehiculoId(usuarioId);
    return this.tarifaZonaRepo.resolvePagoTarifa(zonaId, vehiculoId); // R1/R2/R3
  }

  async listarCierreDia(actor: Actor): Promise<ListarCierreDiaServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1/R2

    // R2/R3/R10/R18: SOLO lectura (R17). Filtrado por el actor en el repo. Feature 39:
    // resuelve la tarifa de pago del mensajero UNA vez (por zona+vehiculo) para derivar
    // el pago EN VIVO (R10/R11), en paralelo con el resto de lecturas.
    const [gestiones, pendientes, cierresPasados, tarifa] = await Promise.all([
      this.repo.findGestionesPendientes(actor.usuarioId),
      this.repo.contarOrdenesPendientesGestion(actor.usuarioId, ESTADOS_PENDIENTES),
      this.repo.findCierresByMensajero(actor.usuarioId),
      this.resolveTarifaMensajero(actor.usuarioId),
    ]);

    // R10/R11: pago DERIVADO por gestion (money-safe) + total, con la tarifa vigente.
    // Concepto INDEPENDIENTE del dinero recibido (R21): no toca `totales`.
    const { pagoByGestionId, total: totalPagoMensajero } = derivarPagos(gestiones, tarifa);

    // Feature 56/R9/R10: ingreso de bodega por rechazo DERIVADO por gestion + total, con la
    // MISMA tarifa ya resuelta (sin query extra). Concepto INDEPENDIENTE del pago al
    // mensajero (R7b) y del dinero recibido (R20). R23: tarifaFaltante = (tarifa === null).
    const { ingresoByGestionId, total: totalIngresoBodegaRechazos } = derivarIngresoBodega(
      gestiones,
      tarifa,
    );
    const tarifaFaltante = tarifa === null;

    // R5: firma en lote las evidencias (path crudo -> URL firmada de TTL acotado).
    const paths = gestiones
      .map((g) => g.evidenciaStoragePath)
      .filter((p): p is string => p !== null);
    const urlByPath =
      paths.length > 0
        ? await this.signedUrls.createSignedUrls(paths, cierreConfig.SIGNED_URL_TTL_SECONDS)
        : {};

    // R3: agrupa por resultado (las 4 claves siempre presentes). R10: cada DTO expone el
    // pago DERIVADO en vivo (override del snapshot, que aqui es null: gestion sin cerrar).
    // Feature 158/R16/R18: 5 claves — el `incidente` es un grupo PROPIO del detalle.
    const grupos: CierreGrupos = {
      entregada: [],
      reprogramada: [],
      devuelta: [],
      rechazada: [],
      incidente: [],
    };
    for (const g of gestiones) {
      grupos[g.resultado].push(
        toDetalleDTO(
          g,
          urlByPath,
          pagoByGestionId[g.gestionId], // feature 39: pago DERIVADO en vivo (override snapshot)
          ingresoByGestionId[g.gestionId], // feature 56: ingreso DERIVADO en vivo (override snapshot)
          tarifaFaltante, // feature 56/R23: derivado server-side (tarifa === null)
        ),
      );
    }

    // R7/R8/R9: totales por metodo con Prisma.Decimal (exactos al centavo).
    const totales = computeTotales(gestiones);

    // R10/R11: gate de "Solicitar cierre" con motivo accionable.
    let puedesSolicitar = true;
    let motivoBloqueo: string | null = null;
    if (pendientes > 0) {
      puedesSolicitar = false;
      motivoBloqueo = MSG_PENDIENTES; // R10
    } else if (gestiones.length === 0) {
      puedesSolicitar = false;
      motivoBloqueo = MSG_VACIO; // R11
    }

    // Feature 111/R13 (datos): derivado de `cierresPasados` ya cargado (sin query extra).
    // Habilita el CTA "Solicitar aprobación del cierre vencido" con independencia del gate de
    // creación (`puedesSolicitar`), que sigue siendo el del flujo de la 37.
    const tieneVencido = cierresPasados.some((c) => c.estado === "vencido");
    // Feature 109/R31 (datos): `true` si hay un cierre `rechazado` en el historico (derivado de
    // `cierresPasados`, sin query extra). Habilita el MISMO CTA de re-solicitud que el `vencido`
    // (111/R13): un `rechazado` NO es terminal (bloquea hasta re-solicitar + aprobar).
    const tieneRechazado = cierresPasados.some((c) => c.estado === "rechazado");

    return {
      status: "ok",
      grupos,
      totales,
      totalPagoMensajero, // R11: separado de `totales` (R21)
      totalIngresoBodegaRechazos, // feature 56/R10: separado de `totales` y del pago al mensajero (R20)
      puedesSolicitar,
      motivoBloqueo,
      cierresPasados,
      tieneVencido, // feature 111/R13
      tieneRechazado, // feature 109/R31
    };
  }

  /**
   * Detalle de UN cierre PASADO del propio mensajero (solo lectura, pedido humano: "ver" un
   * cierre anterior y no solo su fila de totales).
   *
   * Dos diferencias deliberadas con `listarCierreDia`:
   *  - Los montos por gestion NO se re-derivan de la tarifa de hoy: se usa el SNAPSHOT
   *    congelado al solicitar (por eso `toDetalleDTO` va SIN overrides). Un cierre ya
   *    solicitado no puede cambiar de importe porque alguien edite una tarifa.
   *  - El scope es del REPO (`id` + `mensajero_id` en el WHERE): un cierre ajeno o
   *    inexistente cae en `no_encontrada` sin distinguirse.
   */
  async verCierrePasado(
    cierreId: string,
    actor: Actor,
  ): Promise<VerCierrePasadoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1/R2

    const found = await this.repo.findCierrePropioConGestiones(cierreId, actor.usuarioId);
    if (found === null) return { status: "no_encontrada" };

    // R5: evidencias SOLO firmadas. Best-effort DELIBERADO (mismo criterio que el detalle del
    // admin): si el storage no responde, el comprobante se sirve SIN sus fotos en vez de no
    // servirse — es una vista de consulta, las fotos la ilustran.
    const paths = found.gestiones
      .map((g) => g.evidenciaStoragePath)
      .filter((p): p is string => p !== null);
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

    const grupos: CierreGrupos = {
      entregada: [],
      reprogramada: [],
      devuelta: [],
      rechazada: [],
      incidente: [],
    };
    for (const g of found.gestiones) {
      // Sin overrides de pago/ingreso: el DTO expone el snapshot leido de la gestion.
      grupos[g.resultado].push(toDetalleDTO(g, urlByPath));
    }

    return { status: "ok", cierre: found.cierre, grupos };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — «Cierres solicitados» del mensajero,
   * paginado en servidor.
   *
   * El acotamiento por actor es el de `listarCierreDia` y no admite variantes: el rol tiene
   * que ser `mensajero` y el `mensajero_id` del WHERE es `actor.usuarioId`. No hay un
   * parametro por el que pedir el historico de otro mensajero, y por eso paginar no puede
   * ampliar el alcance de nadie (R44).
   *
   * UNA sola llamada al repositorio (R54), frente a las cuatro que `listarCierreDia` hace
   * para pintar la pantalla entera: el conteo de R41 viaja dentro de ella.
   */
  async listarCierresPasadosPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarCierresPasadosServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1/R2

    const { items, total } = await this.repo.findCierresByMensajeroPaginado(
      actor.usuarioId, // el acotamiento por actor: sale de la sesion, nunca de la peticion
      rangoDePagina(input),
    );

    return {
      status: "ok",
      items,
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }

  /**
   * Feature 184 — Tanda C (R1/R4/R6/R9) — el CONJUNTO de «Cierres solicitados» del propio
   * mensajero, sin recorte, que es del que sale el archivo.
   *
   * **Lo que cierra, y por que este listado estaba en la lista de los caros.** Hasta hoy el
   * archivo se producia releyendo `listarCierreDia()`, el listado COMPUESTO de la pantalla
   * entera: cuatro lecturas (las gestiones del dia, el contador de pendientes, este historico y
   * la tarifa por zona+vehiculo), los pagos e ingresos derivados de cada gestion, los totales
   * por metodo de pago y —lo que de verdad cuesta— la FIRMA EN LOTE de las evidencias
   * fotograficas de todas las gestiones del dia contra Supabase Storage. El archivo no lleva
   * ninguna de esas URL: sus ocho columnas salen enteras del `CierrePasadoDTO`. Aqui es UNA
   * consulta y cero llamadas al firmador (R9).
   *
   * **No lleva `input`, y es deliberado** (mismo criterio que los dos conjuntos de la tanda B):
   * este listado no admite filtros —su schema de pagina solo tenia `page`/`pageSize`— y quitarlos
   * deja una lista blanca de CERO claves. El borde la sigue aplicando entera —un `mensajeroId`
   * colado muere alli con `validation_error` (R17)— pero no hay nada que transportar hasta aqui.
   *
   * El alcance ES el actor y no admite variantes: el rol tiene que ser `mensajero` y el
   * `mensajero_id` del WHERE es `actor.usuarioId` (R4), exactamente como en la pagina.
   *
   * **Excepcion declarada a R29 de la 170.** R29 —feature `done`, requisito vivo— pide no
   * materializar NI transportar mas de `N + 1` filas por encima del tope. Aqui se cumple lo
   * segundo: superado el tope viajan dos enteros y ninguna fila. No lo primero:
   * `findCierresByMensajero` es un `findMany` sin `take`, asi que el historico entero llega a
   * memoria y el tope lo evalua este servicio despues. De los once listados que declaran esta
   * excepcion, este es el mas acotado por construccion: son los cierres de UN mensajero, uno por
   * dia trabajado, y el alcance lo fija el propio actor; alcanzar el tope le costaria años de
   * operacion continua.
   *
   * Aun asi es una excepcion, no un cumplimiento. No se cierra porque hacerlo pide `limite + 1`
   * MAS un `count` para conservar el total exacto del aviso (R6): la segunda consulta que R15 de
   * esta feature mide y prohibe. Decision humana del 2026-08-05, en el design §3.1.
   */
  async listarCierresPasadosCompleto(
    actor: Actor,
  ): Promise<ListarCierresPasadosCompletoServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R4: antes del repo

    // El MISMO metodo del que la pagina saca su recorte: mismo where, mismo orden y el mismo
    // mapper de dinero. Un gemelo `…Completo` habria sido la tercera declaracion del criterio.
    const conjunto = await this.repo.findCierresByMensajero(actor.usuarioId);

    const limite = descargaConfig.MAX_FILAS;
    // R6: o van TODAS las filas del conjunto, o van solo los conteos. Nunca un archivo truncado.
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    return { status: "ok", items: conjunto, total: conjunto.length };
  }

  async solicitarCierre(actor: Actor): Promise<SolicitarCierreServiceResult> {
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }; // R1

    // Feature 111/R6/R9/R10: si el mensajero tiene un cierre `vencido`, "Solicitar cierre"
    // NO crea un cierre nuevo: transiciona ese `vencido -> solicitado` (escritura guardada por
    // estado). Va ANTES del flujo de creación y EXENTO de la precondición de "sin pendientes"
    // (R9, anti-deadlock: el mensajero está bloqueado para gestionar —R1— y quedaría atrapado
    // si además no pudiera enviar su vencido a aprobación). NO recalcula ni re-snapshotea (R8:
    // el repo solo cambia `estado`). Invariante R10: el corte no crea `vencido` con `solicitado`
    // presente (41 R10) y aquí se transiciona en vez de crear una segunda fila.
    //
    // FEATURE 235 (R24): con `ayuda_tienda` en `ESTADOS_PENDIENTES`, esta ruta se comporta
    // EXACTAMENTE igual que con `en_reparto` - es decir, una orden en ayuda NO la bloquea, porque
    // esta rama no consulta pendientes. Es deliberado y se afirma en test para que nadie lo
    // «arregle»: quitarle la exencion reabre el deadlock que la 111/R9 cerro.
    if (await this.repo.existeCierreVencido(actor.usuarioId)) {
      const ok = await this.repo.transicionarVencidoASolicitado(actor.usuarioId);
      // R7: 0 filas = el vencido ya fue resuelto/transicionado entre la lectura y la escritura.
      if (!ok) return { status: "conflict", motivo: MSG_DUPLICADO };
      await this.avisarCierrePorAprobar(actor.usuarioId); // feature 146/R24
      return { status: "ok", via: "vencido_solicitado" }; // R8: sin snapshot nuevo
    }

    // Feature 109/R28 (modelo GLOBAL): un cierre `rechazado` ya NO es terminal — BLOQUEA (R29) y es
    // RE-SOLICITABLE (`rechazado -> solicitado`, espejo EXACTO del `vencido`). Misma rama, mismo gate
    // (EXENTO de la precondicion de "sin pendientes", anti-deadlock: el mensajero esta bloqueado y
    // quedaria atrapado). Money-safe (R28: el repo solo cambia `estado`).
    //
    // ⚠️ FEATURE 241 (2026-08-20) — AQUI DECIA «el desbloqueo definitivo y la liberacion de
    // `sin_gestionar` ocurren SOLO al APROBAR (R16)», Y LA PRIMERA MITAD YA NO ES CIERTA. Son DOS
    // cosas distintas y confundirlas fue justo lo que se propago a la pantalla:
    //
    //   - EL BLOQUEO DEL MENSAJERO SE LEVANTA AQUI, AL RE-SOLICITAR. `solicitado` NO esta en
    //     `ESTADOS_CIERRE_BLOQUEAN_GESTION` (`OrdenRepository`), asi que en cuanto esta rama
    //     escribe `rechazado -> solicitado` el mensajero vuelve a gestionar y cobrar. No espera a
    //     nadie: la pelota pasa al admin y el ya hizo lo suyo.
    //   - LA LIBERACION DE `sin_gestionar` SI OCURRE SOLO AL APROBAR (109/R16). La emite el admin,
    //     en otro camino y otra transaccion (`CierresAdminRepository`, origen
    //     `liberacion_sin_gestionar`). Esa mitad no la toco la 241.
    //
    // Prometerle al mensajero un bloqueo mas largo del real lo deja esperando de brazos cruzados
    // una aprobacion que ya no necesita. El aviso de la pantalla decia eso y se corrigio; esta
    // frase era su fuente, asi que se corrige tambien o el proximo que lea el servicio la copia.
    //
    // FEATURE 235 (R24): mismo caso que el `vencido` de arriba, y misma razon. Ninguna de las dos
    // rutas de RE-solicitud comprueba pendientes.
    if (await this.repo.existeCierreRechazado(actor.usuarioId)) {
      const ok = await this.repo.transicionarRechazadoASolicitado(actor.usuarioId);
      if (!ok) return { status: "conflict", motivo: MSG_DUPLICADO };
      await this.avisarCierrePorAprobar(actor.usuarioId); // feature 146/R24
      return { status: "ok", via: "rechazado_solicitado" }; // R28: sin snapshot nuevo
    }

    // R11: sin `vencido` -> flujo de creación de la 37 SIN CAMBIOS (precondiciones + snapshot).
    // R10: precondicion — sin ordenes pendientes de gestion.
    const pendientes = await this.repo.contarOrdenesPendientesGestion(
      actor.usuarioId,
      ESTADOS_PENDIENTES,
    );
    if (pendientes > 0) return { status: "conflict", motivo: MSG_PENDIENTES };

    // R12: a lo sumo un cierre `solicitado` por mensajero a la vez.
    if (await this.repo.existeCierreSolicitado(actor.usuarioId)) {
      return { status: "conflict", motivo: MSG_DUPLICADO };
    }

    // R11: no se cierra un dia vacio.
    const gestiones = await this.repo.findGestionesPendientes(actor.usuarioId);
    if (gestiones.length === 0) return { status: "conflict", motivo: MSG_VACIO };

    // R15/R16: ruteo por la zona del mensajero (server-side).
    const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) {
      // R16: sin zona -> no se crea el cierre; mensaje accionable.
      return { status: "validation_error", fieldErrors: { zona: [MSG_SIN_ZONA] } };
    }
    // R15 + design §6 (feature 55 pendiente): si findCentralZonaId() devuelve null,
    // NINGUN mensajero clasifica como central -> fallback SEGURO a bodega_satelite
    // con su propia zona (no lanzar). La clasificacion a central empieza a funcionar
    // en runtime cuando la 55 marque la zona central. Feature 41/B1: derivacion UNICA
    // compartida con el corte diario (resolverDestinoCierre).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    const { destinoTipo } = resolverDestinoCierre(zonaId, centralZonaId);

    // R14: snapshot de totales calculado en este instante (mismo calculo que 3.1.4).
    const totales = computeTotales(gestiones);

    // R12/R13: snapshot del pago al mensajero con la tarifa vigente en ESTE instante
    // (por zona del mensajero + vehiculo; zonaId ya resuelto). El numero se congela: una
    // edicion posterior de la tarifa (feature 55) NO altera el cierre (R15).
    const vehiculoId = await this.ordenRepo.findUsuarioVehiculoId(actor.usuarioId);
    const tarifa = await this.tarifaZonaRepo.resolvePagoTarifa(zonaId, vehiculoId);
    const { pagoByGestionId, total: totalPagoMensajero } = derivarPagos(gestiones, tarifa);

    // Feature 56/R8/R11/R12: snapshot del ingreso de bodega por rechazos con la MISMA
    // tarifa ya resuelta (sin query extra) y el MISMO destino ya calculado (R8: el ingreso
    // queda atribuido a destinoTipo/destinoZonaId del cierre). El numero se congela: una
    // edicion posterior de la tarifa (feature 55) NO altera el cierre (R14).
    const { ingresoByGestionId, total: totalIngresoBodegaRechazos } = derivarIngresoBodega(
      gestiones,
      tarifa,
    );

    // R13/R14: transaccion todo-o-nada (INSERT + vincular gestiones + snapshot pago + ingreso).
    // Feature 41/C1: `crearCierre` devuelve null si el UPDATE guardado vincula 0 gestiones
    // (una solicitud/corte concurrente ya las vinculo entre la lectura y la escritura); se
    // reporta como conflicto sin efectos (todo-o-nada), como el duplicado (R12).
    const cierreId = await this.repo.crearCierre({
      mensajeroId: actor.usuarioId,
      destinoTipo,
      destinoZonaId: zonaId,
      totales,
      pagoByGestionId, // R12: pago snapshoteado por gestion
      totalPagoMensajero, // R13: total snapshoteado
      ingresoByGestionId, // feature 56/R11: ingreso snapshoteado por gestion
      totalIngresoBodegaRechazos, // feature 56/R12: total snapshoteado del ingreso de bodega
    });
    if (cierreId === null) return { status: "conflict", motivo: MSG_VACIO };

    await this.avisarCierrePorAprobar(actor.usuarioId); // feature 146/R24

    // Feature 111/P2: `via: "creado"` distingue el toast del camino de creación (37) del de
    // transición del vencido; los consumidores previos ignoran el campo.
    return { status: "ok", via: "creado", cierreId, totales, destinoTipo };
  }

  /**
   * Feature 67 (design §5.2) — REGLA del deshacer: 8 guardias antes de la UNICA escritura.
   * Todas devuelven SIN efectos. El orden importa: autz (R8/R9) antes que negocio, y las
   * lecturas mas baratas primero.
   */
  async deshacerGestion(gestionId: string, actor: Actor): Promise<DeshacerGestionServiceResult> {
    // 1) R8 (F1.4-f): SOLO el rol mensajero, antes de tocar el repo. El admin no tiene ventana
    // para deshacer (la ventana muere al solicitar el cierre, que es cuando el admin lo ve).
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" };

    // Feature 111/R5 (Q2, guarda EXPLICITA belt-and-suspenders) + 241: un mensajero con un cierre
    // `vencido` o `rechazado` no puede tocar sus guías, y DESHACER es tocarlas. MISMO predicado
    // que `gestionar` (`findMensajerosBloqueadosParaGestion`), ANTES de cualquier lectura o
    // escritura de la gestión. No se apoya en el no-op natural.
    //
    // Con `solicitado` NO bloquea (regla firmada 2026-08-20): ese mensajero está esperando al
    // admin, y su ventana de deshacer muere igual sola en cuanto la gestión quede atada al cierre
    // (guarda 4, `gestion.cierreId !== null`), que es la protección de verdad del dinero.
    const bloqueados = await this.ordenRepo.findMensajerosBloqueadosParaGestion([actor.usuarioId]);
    if (bloqueados.has(actor.usuarioId)) return { status: "conflict", motivo: MSG_BLOQUEADO };

    // 2) R9: inexistente -> forbidden (NO se distingue de ajena, patron 36/R31: no revela que
    // la gestion existe).
    const gestion = await this.repo.findGestionParaDeshacer(gestionId);
    if (gestion === null) return { status: "forbidden" };

    // 3) R9: gestion de OTRO mensajero -> forbidden, sin exponer ningun dato suyo.
    if (gestion.mensajeroId !== actor.usuarioId) return { status: "forbidden" };

    // 💰 3-bis) FEATURE 237 (T5.5, D3, R38) — LA GESTION QUE REGISTRO LA TIENDA NO SE DESHACE.
    //
    // Va JUSTO DESPUES de la guardia de propiedad y no antes: hasta aqui no se sabe que la gestion
    // sea de este mensajero, y decirle «la resolvio la tienda» sobre una gestion ajena filtraria
    // informacion de una orden que no es suya. Despues de la 3, ya es suya y el mensaje es seguro.
    //
    // Y va ANTES de las guardias 4-8 a proposito, aunque esas sean mas baratas: las cinco
    // devolverian un motivo que en este caso MIENTE («ya esta en un cierre», «la movio la
    // bodega»…), y este repo tiene escrito lo que cuesta un dato falso con formato de dato. El
    // dato ya viene con la fila (`findGestionParaDeshacer` lo trae), asi que esta guardia no
    // cuesta ni una consulta mas.
    //
    // POR QUE EXISTE, con los numeros delante. La gestion de la tienda nace con `mensajero_id` =
    // este mensajero —lo que la mete en su cierre (237/R3)— y con `cierre_id = NULL` (R9), asi que
    // PASA LAS OCHO GUARDIAS. Sin esta linea, el mensajero revierte la decision de la tienda: la
    // orden vuelve a `en_reparto` reasignada a el, desaparecen el intento contado y el
    // `cobroRechazado`, y LA TIENDA NO SE ENTERA (la fila ya no esta en ninguna de sus pestañas).
    // Medido en produccion el 2026-08-20: deshacer se usa en 7 de 57 gestiones (12 %) y un rechazo
    // mueve hasta ₡1.000. No es una precaucion, es un agujero con caudal.
    //
    // El desenlace elegido (D3-b) tiene su precio DECLARADO: un rechazo equivocado de la tienda no
    // tiene deshacer. Se acepta porque el peor caso es recuperable —el paquete vuelve a la tienda
    // por el flujo de devolucion— mientras que el contrario borra dinero sin consentimiento.
    if (gestion.desdeAyudaTienda) {
      return { status: "conflict", motivo: MSG_GESTION_DE_LA_TIENDA };
    }

    // 4) R2 (decision 1 del humano): la VENTANA es `cierre_id IS NULL`. Ya vinculada a un
    // cierre = sus totales estan snapshoteados y la wallet la cobrara al aprobar -> conflict.
    if (gestion.cierreId !== null) return { status: "conflict", motivo: MSG_YA_EN_CIERRE };

    // 5) R3: ya anulada -> conflict. Un segundo envio NO vuelve a transicionar la orden.
    if (gestion.anuladaAt !== null) return { status: "conflict", motivo: MSG_YA_DESHECHA };

    // 6) R6: orden borrada (soft-delete) -> conflict.
    if (gestion.orden.deletedAt !== null) return { status: "conflict", motivo: MSG_ORDEN_BORRADA };

    // 7) R4: solo se deshace la gestion NO anulada mas reciente de la orden.
    const ultimaId = await this.repo.findUltimaGestionNoAnuladaId(gestion.ordenId);
    if (ultimaId !== gestion.gestionId) return { status: "conflict", motivo: MSG_NO_ES_LA_ULTIMA };

    // 8) R5: la orden debe seguir EXACTAMENTE en el estado que dejo esa gestion. Si avanzo por
    // otra via (bodega, cron de liberacion, devolucion a la tienda de origen, ajuste admin),
    // arrancarla de ahi es peligroso -> conflict con mensaje accionable.
    if (!ESTADOS_ESPERADOS[gestion.resultado].includes(gestion.orden.estatusValue)) {
      return { status: "conflict", motivo: MSG_ORDEN_MOVIDA };
    }

    // R18: destino del deshacer. Catalogo incompleto -> validation_error (patron `gestionar`).
    const estatusEnRepartoId = await this.ordenRepo.findEstatusIdByValue(ESTADO_EN_REPARTO);
    if (estatusEnRepartoId === null) {
      return { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO] } };
    }

    // R11/R18-R23: UNICA escritura, atomica. `false` = una guardia del WHERE perdio la carrera
    // dentro de la tx (p. ej. `solicitarCierre` vinculo la gestion primero, o la bodega movio
    // la orden) -> rollback, sin efectos parciales -> conflict.
    const ok = await this.repo.anularGestionYDevolverAGestion({
      gestionId: gestion.gestionId,
      ordenId: gestion.ordenId,
      mensajeroId: gestion.mensajeroId, // R19: repone la asignacion al AUTOR de la gestion
      actorUsuarioId: actor.usuarioId, // R11/R20: rastro de quien deshizo
      estatusEsperadoId: gestion.orden.estatusId, // R5: id REAL leido (guardia optimista)
      estatusEnRepartoId,
    });
    if (!ok) return { status: "conflict", motivo: MSG_ORDEN_MOVIDA };

    // R32/R34: no se toca la evidencia (ni el objeto del bucket ni `evidencia_storage_path`) ni
    // se produce movimiento de dinero: la wallet solo se alimenta al APROBAR el cierre, y una
    // gestion con `cierre_id = NULL` jamas llega a los feeds.
    return { status: "ok", ordenId: gestion.ordenId };
  }
}

// R4/R5/R6: arma el DTO de detalle; la evidencia se expone SOLO firmada (R5).
// Exportado para reuso por CierresAdminService (feature 38): el detalle admin usa el
// MISMO mapper de gestion -> DTO (reuso F1.4-b).
// Feature 39: `pagoMensajero` opcional. En la vista EN VIVO del mensajero (37) se pasa el
// pago DERIVADO (override, R10). En el detalle admin (38/40) NO se pasa y se usa el
// snapshot `g.pagoMensajero` leido de la columna (R16). Nunca se mezcla con montoRecibido.
// Feature 56: `ingresoBodegaRechazo` opcional (mismo patron que `pagoMensajero`): en la
// vista EN VIVO (37) se pasa el ingreso DERIVADO (override, R9); en el detalle admin (38/40)
// NO se pasa y se usa el snapshot `g.ingresoBodegaRechazo` leido de la columna (R15/R19).
// `tarifaFaltante` (R23, F1.4-Q6): derivado server-side del `tarifa === null` en la vista
// EN VIVO; en el detalle admin (snapshot, sin re-resolver tarifa) es `false` por defecto.
export function toDetalleDTO(
  g: CierreGestionPendienteRow,
  urlByPath: Record<string, string>,
  pagoMensajero?: string | null,
  ingresoBodegaRechazo?: string | null,
  tarifaFaltante = false,
): CierreDetalleGestion {
  return {
    gestionId: g.gestionId,
    ordenId: g.ordenId,
    numGuia: g.numGuia,
    numRemision: g.numRemision,
    destinatario: g.destinatario,
    direccion: g.direccion,
    zonaNombre: g.zonaNombre,
    provinciaNombre: g.provinciaNombre,
    cantonNombre: g.cantonNombre,
    distritoNombre: g.distritoNombre,
    producto: g.producto,
    tiendaNombre: g.tiendaNombre,
    resultado: g.resultado,
    montoRecibido: g.montoRecibido,
    // Feature 212/R31: el escalar se CONSERVA (lo pinta la UI de hoy) y el desglose viaja a su
    // lado (lo consume la 213). Passthrough puro: el mapper no re-deriva ni normaliza nada —
    // el reparto por metodo ya lo decidio el repositorio al leer las lineas.
    metodoPago: g.metodoPago,
    pagos: g.pagos,
    motivo: g.motivo,
    fechaReprogramacion: g.fechaReprogramacion,
    evidenciaUrl: g.evidenciaStoragePath ? (urlByPath[g.evidenciaStoragePath] ?? null) : null,
    pagoMensajero: pagoMensajero !== undefined ? pagoMensajero : g.pagoMensajero,
    ingresoBodegaRechazo:
      ingresoBodegaRechazo !== undefined ? ingresoBodegaRechazo : g.ingresoBodegaRechazo,
    tarifaFaltante,
    // Feature 102/R9/R11: passthrough del flag ya derivado en el repo (admin: del historial;
    // vista en vivo del mensajero: `false`). El service no re-deriva la clasificacion.
    esRechazoSla: g.esRechazoSla,
    // 💰 Feature 237 (D6/R41): passthrough del OTRO flag derivado del historial. Este SI lo lleva
    // la vista en vivo del mensajero, y es su razon de ser: sin el, firma un cierre con una
    // gestion que no hizo y una evidencia que no subio, y no puede explicarla si le preguntan.
    // El service no re-deriva nada — el predicado vive en `lib/utils/gestion-tienda-ayuda-flag.ts`
    // y los tres repositorios que producen la fila lo aplican sobre el historial.
    desdeAyudaTienda: g.desdeAyudaTienda,
    // Feature 158/R9/R34: passthrough de la causa tipificada del incidente. La pueblan los DOS
    // repos (vista en vivo y detalles de admin); `null` en cualquier otro resultado.
    causaIncidente: g.causaIncidente,
    // Feature 158/R19/R22/R34: passthrough del monto de la indemnizacion (money-safe STRING,
    // ya serializado por el repo). Solo llega poblado desde los repos de ADMIN (38/40): la
    // vista EN VIVO del mensajero no lo selecciona (design §7.2), asi que ahi es SIEMPRE
    // `null`. El mapper NO decide eso — lo decide la proyeccion de cada repo, que es donde
    // una feature futura tendria que ir a cambiarlo a proposito.
    indemnizacion: g.indemnizacion,
    // Passthrough: solo viene poblado desde los repos de admin (38/40), que lo derivan del
    // snapshot. En la vista en vivo del mensajero es `undefined` y la UI no muestra nada.
    ingresoOrdenex: g.ingresoOrdenex,
  };
}

