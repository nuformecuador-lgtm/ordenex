import { Prisma } from "@prisma/client";
import { GESTION_MIME_EXTENSION, gestionConfig, type GestionMimeType } from "@/lib/config/gestion";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  GestionOrdenData,
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type {
  DetalleConflicto,
  EscogerServiceResult,
  GestionarInput,
  GestionarServiceResult,
  IMisAsignacionesService,
  LiberarServiceResult,
  ListarMisAsignacionesServiceResult,
  MiAsignacionDTO,
  MisAsignacionesKpis,
  RecogerInput,
  RecogerServiceResult,
} from "@/lib/interfaces/services/IMisAsignacionesService";
import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";

// Feature 111/R1/R4/R20: motivo ACCIONABLE del bloqueo total sobre las guías (texto fijo
// i18n-ready, SIN PII ni datos del cierre). Mientras el mensajero tenga un cierre
// `solicitado`/`vencido` sin resolver no puede gestionar NI recoger/escoger.
const MSG_BLOQUEADO =
  "Tenes un cierre pendiente sin resolver; resolvelo antes de gestionar tus guias."; // R1/R4/R20

// Estado de origen de "Recoger" (feature 17) y destino tras recoger (feature 36).
const ORIGEN_RECOGER = "por_recoger";
const ESTADO_EN_REPARTO = "en_reparto";
// Unico estado de origen valido para gestionar los 4 resultados (R18).
const ORIGEN_GESTION = "en_reparto";

// El `value` de order_status destino coincide 1:1 con el `resultado` de la
// gestion (entregada/reprogramada/devuelta/rechazada).

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Logica de negocio del flujo del mensajero (feature 36). Orquesta el repo de
 * gestion + el catalogo de estados + Storage (evidencias) + firma de URLs. No
 * conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class MisAsignacionesService implements IMisAsignacionesService {
  constructor(
    private readonly repo: IGestionOrdenRepository,
    // Feature 111/R1-R4: + `findMensajerosBloqueados` — MISMO predicado derivado de la
    // asignación (`solicitado`/`vencido`), sin duplicar la derivación ni flag persistido. La
    // guarda de bloqueo total lo consume en gestionar/recoger/escoger.
    private readonly ordenRepo: Pick<
      IOrdenRepository,
      "findEstatusIdByValue" | "findMensajerosBloqueados"
    >,
    private readonly storage: IFileStorage,
    private readonly signedUrls: ISignedUrlProvider,
    // Feature 92 (R23/R28): se usa para leer la secuencia optimizada al listar y para
    // persistir el origen `gps` que el navegador adjunta a recoger/gestionar.
    //
    // Feature 99 (R1/R29): la rama `devuelta` YA NO re-rutea de inmediato. El derivador de
    // intentos (49) y la zona central (54) que servian a `resolverSeguimientoDevuelta` se
    // RELOCALIZARON al servicio del cron `DevolucionSlaService`; por eso desaparecieron del
    // constructor. `gestionar` deja la orden REPOSANDO en `devuelta` y el cron SLA decide.
    private readonly rutaRepo: Pick<
      IRutaOptimizadaRepository,
      "findByMensajero" | "upsertOrigen"
    >,
    // Feature 115 (R17/R20): meta privada del mensajero. Solo LECTURA aqui para reflejar en el
    // listado, del PROPIO actor: la marca "gestionar mas tarde" (`findMarcarLuegoByMensajero`,
    // 115) y la nota privada (`findNotasByMensajero`, feature 116/R6/R8). La ESCRITURA vive en
    // OrdenMensajeroMetaService (marca) y NotaPrivadaMensajeroService (nota).
    private readonly metaRepo: Pick<
      IOrdenMensajeroMetaRepository,
      "findMarcarLuegoByMensajero" | "findNotasByMensajero"
    >,
    // Feature 160 (R11/R12/R24): derivador de intentos EN LOTE, dependencia REQUERIDA (una dep
    // opcional dejaria que el wiring se la olvidara y el dato desapareciera en silencio de las
    // superficies del mensajero). `import type` + `Pick`: sin ciclo de modulos y testeable con
    // dobles.
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
  ) {}

  /**
   * Feature 92 (R23/R25): persiste la ubicacion del navegador como origen `gps` de la ruta
   * del mensajero. BEST-EFFORT A PROPOSITO: si falla, la accion del mensajero (recoger,
   * gestionar) NO debe romperse por no haber podido guardar una coordenada auxiliar. R25
   * es explicito: la geolocalizacion nunca bloquea el flujo, solo lo mejora.
   */
  private async registrarUbicacion(
    mensajeroId: string,
    ubicacion: { lat: number; lng: number } | undefined,
  ): Promise<void> {
    if (ubicacion === undefined) return;
    try {
      await this.rutaRepo.upsertOrigen(mensajeroId, {
        lat: ubicacion.lat,
        lng: ubicacion.lng,
        capturadaAt: new Date(),
        fuente: "gps",
      });
    } catch {
      // Silencioso a proposito: no hay nada accionable que decirle al mensajero, y el
      // servicio de optimizacion caera al escalon siguiente del origen (R24).
    }
  }

  /**
   * Feature 111/R1-R4/R2 — predicado de bloqueo total: `true` si el mensajero tiene un cierre
   * en estado bloqueante (`solicitado`/`vencido`). REUSA `findMensajerosBloqueados` (mismo
   * helper derivado de la asignación); NO duplica la derivación ni introduce un flag persistido.
   */
  private async estaBloqueado(usuarioId: string): Promise<boolean> {
    const bloqueados = await this.ordenRepo.findMensajerosBloqueados([usuarioId]);
    return bloqueados.has(usuarioId);
  }

  async listarMisAsignaciones(actor: Actor): Promise<ListarMisAsignacionesServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    // Los KPIs de entregadas son DEL DIA, no acumulados: el mensajero mira esta fila para
    // saber como va SU jornada, y un acumulado historico solo crece y deja de informar.
    // La ventana es la del dia de Costa Rica y se calcula AQUI (una sola vez, compartida
    // por los dos KPIs) para que ambos midan exactamente el mismo dia aunque el reloj
    // cruce la medianoche entre las dos queries del `Promise.all`.
    const hoy = fechaCalendarioCR();
    const dia = { desde: inicioDelDiaCREnUtc(hoy), hasta: inicioDelDiaSiguienteCREnUtc(hoy) };

    const [ordenEnGestionId, rows, entregadas, montoGestionadas, ruta, marcadasLuego, notasPrivadas] =
      await Promise.all([
        this.repo.getOrdenEnGestion(actor.usuarioId), // R20
        // Feature 167 (R34) — CORTE LIMPIO: Entregas lee EXACTAMENTE los dos estados de su
        // propio flujo. La recoleccion en tienda salio de aqui a su apartado propio
        // (`/recoleccion`, `RecoleccionTiendaService.listarRecoleccion`). Que el estado
        // `recolectando` NO se lea es la forma FUERTE del aislamiento: lo que no se lee no
        // puede contaminar los KPIs, el mapa, la ruta ni el corte del dia (R36).
        this.repo.findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOGER, ESTADO_EN_REPARTO]), // R9/R13
        this.repo.contarEntregadas(actor.usuarioId, dia), // Feature 61: KPI entregadas (HOY)
        this.repo.sumMontoCobrarGestionadas(actor.usuarioId, dia), // "Total a cobrar" (parte gestionada HOY)
        this.rutaRepo.findByMensajero(actor.usuarioId), // Feature 92/R28: secuencia optimizada
        // Feature 115 (R17/R20): marcas "gestionar mas tarde" del PROPIO actor (Set<ordenId>).
        this.metaRepo.findMarcarLuegoByMensajero(actor.usuarioId),
        // Feature 116 (R6/R8): notas privadas del PROPIO actor (Map<ordenId, nota>). Misma query
        // acotada por `usuario_id = actor` que garantiza que nunca trae la nota de otro mensajero.
        this.metaRepo.findNotasByMensajero(actor.usuarioId),
      ]);

    // Feature 92 (R28): posicion por orden. Vacio si nunca se optimizo -> todas las cards
    // quedan "sin posicion" y conservan el orden actual, que es el comportamiento previo.
    const secuencias = ruta?.secuenciaPorOrden ?? new Map<string, number>();

    // Feature 160 (R12/R13/R15): UN solo lote con la union de los ids de los DOS grupos, sobre
    // las ordenes YA acotadas al mensajero actor (`findMisAsignaciones(actor.usuarioId, ...)`).
    // Sin asignaciones -> 0 consultas al historial (R13).
    const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));

    const porRecoger: MiAsignacionDTO[] = [];
    const porGestionar: MiAsignacionDTO[] = [];
    for (const row of rows) {
      // Feature 115 (R17): merge de la marca por orden (patron de `secuencias`); `false` si no
      // hay fila. Se aplica a AMBOS grupos: la marca es un dato de la pareja (mensajero, orden).
      // Feature 116 (R6/R8): merge de la nota privada del propio actor (`null` si no hay nota).
      // Feature 160 (R14/R19): `?? 0` — las ordenes sin intentos no vienen en el Map y el `0`
      // es un valor CONOCIDO que SIEMPRE se expone, no un dato ausente.
      const dto = {
        ...toDTO(row),
        marcarLuego: marcadasLuego.has(row.id),
        notaPrivada: notasPrivadas.get(row.id) ?? null,
        intentosEntrega: intentos.get(row.id) ?? 0,
      };
      if (row.estatusValue === ORIGEN_RECOGER) {
        // R29: "Por recoger" no se toca. Sus ordenes no son paradas de ninguna ruta.
        porRecoger.push(dto);
      } else if (row.estatusValue === ESTADO_EN_REPARTO) {
        porGestionar.push({ ...dto, secuenciaRuta: secuencias.get(row.id) ?? null });
      }
    }

    // Feature 92 (R28): reordenado. El REPOSITORIO no cambia su `orderBy` (`createdAt
    // desc` sigue siendo el orden base y el de "Por recoger"); el reordenado vive AQUI.
    //
    // Las que tienen posicion van primero por `secuencia` asc; las que no la tienen —las
    // que entraron a la ruta despues de la ultima optimizacion— van AL FINAL conservando
    // el `createdAt desc` que ya traian. `sort` de JS es ESTABLE desde ES2019, que es
    // exactamente lo que conserva ese orden relativo sin volver a ordenarlo.
    porGestionar.sort((a, b) => {
      if (a.secuenciaRuta === null && b.secuenciaRuta === null) return 0;
      if (a.secuenciaRuta === null) return 1; // sin posicion -> al final
      if (b.secuenciaRuta === null) return -1;
      return a.secuenciaRuta - b.secuenciaRuta;
    });
    const paradasSinOptimizar = porGestionar.filter((o) => o.secuenciaRuta === null).length;
    // Feature 61: KPIs derivados de las ordenes en_reparto (porGestionar) + el conteo
    // de entregadas. `pendientes` = en camino; `porCobrar` = COD por recaudar (null = 0).
    //
    // OJO con la asimetria, que es DELIBERADA: `pendientes`/`porCobrar` NO llevan ventana
    // de dia y `entregadas`/`totalACobrar` si. Los dos primeros salen de `porGestionar`,
    // que es la lista que el mensajero tiene DEBAJO de los KPIs: acotarlos por fecha
    // dejaria fuera lo que quedo en reparto de ayer —trabajo que sigue en su mano— y el
    // KPI dejaria de cuadrar con la lista que lo acompaña. Son indicadores de ESTADO VIVO
    // ("lo que me falta"), no de jornada. Los otros dos son de JORNADA ("lo que llevo
    // hecho hoy") y por eso se cortan a medianoche CR.
    //
    // Y por eso `porCobrar` es un reduce y no una query: `porGestionar` YA son exactamente
    // las ordenes en reparto del mensajero, asi que la base ya respondio esa pregunta.
    // Preguntarsela de nuevo seria una segunda fuente de verdad para el mismo numero, libre
    // de discrepar de la lista que lo acompaña.
    const codEnReparto = porGestionar.reduce((sum, o) => sum + (o.montoCobrar ?? 0), 0);
    const kpis: MisAsignacionesKpis = {
      pendientes: porGestionar.length,
      entregadas,
      porCobrar: codEnReparto,
      // Total a cobrar DEL DIA = lo que el mensajero YA gestiono hoy (cualquier resultado)
      // + lo que todavia lleva en reparto. Los dos sumandos son DISJUNTOS: la query excluye
      // `en_reparto`, que es justo lo que aporta `codEnReparto`. No se mueve al gestionar
      // —la orden solo cambia de sumando— y se reinicia al cruzar la medianoche CR.
      totalACobrar: codEnReparto + montoGestionadas,
    };
    return {
      status: "ok",
      porRecoger,
      porGestionar,
      ordenEnGestionId,
      kpis,
      // Feature 92 (R27/R30): sin ruta persistida el estado es `vigente` con
      // `calculadaAt: null` — "nunca se calculo" NO es "esta desactualizada"; la UI
      // distingue los dos casos con `calculadaAt`.
      ruta: {
        estado: ruta?.estado ?? "vigente",
        calculadaAt: ruta?.calculadaAt ?? null,
        origenFuente: ruta?.origenFuente ?? null,
        paradasSinOptimizar,
      },
    }; // R10
  }

  async recogerAsignaciones(input: RecogerInput, actor: Actor): Promise<RecogerServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", recogidas: [] };

    // Feature 111/R4 (Q3): bloqueo total — un mensajero con un cierre pendiente
    // (`solicitado`/`vencido`) no puede RECOGER. Guarda al inicio (ANTES de cualquier efecto:
    // la transición vive en `recogerLote`), MISMO predicado que gestionar. Sin PII (R20).
    if (await this.estaBloqueado(actor.usuarioId)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({ ordenId, motivo: MSG_BLOQUEADO })),
      };
    }

    const rows = await this.repo.findByIdsParaGestion(ordenIds);
    const rowById = new Map(rows.map((r) => [r.id, r]));

    // R17: propiedad/existencia -> forbidden (aborta sin efectos).
    for (const id of ordenIds) {
      const row = rowById.get(id);
      if (!row || row.mensajeroAsignadoId !== actor.usuarioId) {
        return { status: "forbidden" };
      }
    }
    // R17: origen invalido / borrada -> conflict (aborta sin efectos).
    const detalle: DetalleConflicto[] = [];
    for (const id of ordenIds) {
      const row = rowById.get(id) as OrdenGestionRow;
      if (row.deletedAt !== null) {
        detalle.push({ ordenId: id, motivo: "orden borrada" });
      } else if (row.estatusValue !== ORIGEN_RECOGER) {
        detalle.push({ ordenId: id, motivo: `estado de origen no permitido: ${row.estatusValue}` });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle };

    const [origenId, destinoId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ORIGEN_RECOGER),
      this.ordenRepo.findEstatusIdByValue(ESTADO_EN_REPARTO),
    ]);
    if (origenId === null || destinoId === null) {
      return {
        status: "conflict",
        detalle: [{ ordenId: ordenIds[0], motivo: "catalogo de estados incompleto (seed pendiente)" }],
      };
    }

    await this.repo.recogerLote(ordenIds, actor.usuarioId, origenId, destinoId); // R15/R16
    // Feature 92 (R23): el origen se persiste DESPUES de la transicion, y su fallo no la
    // revierte: el mensajero ya recogio, eso es lo que importa.
    await this.registrarUbicacion(actor.usuarioId, input.ubicacion);
    return { status: "ok", recogidas: ordenIds };
  }

  async escogerParaGestion(ordenId: string, actor: Actor): Promise<EscogerServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    // Feature 111/R4 (Q3): bloqueo total — mensajero con cierre pendiente no puede ESCOGER una
    // orden para gestión. Guarda al inicio, ANTES de fijar el puntero (sin efectos parciales).
    if (await this.estaBloqueado(actor.usuarioId)) {
      return { status: "conflict", motivo: MSG_BLOQUEADO };
    }

    const guardia = await this.cargarOrdenGestionable(ordenId, actor);
    if (guardia.status !== "ok") return guardia;

    // R19-R21: fija el puntero de forma idempotente; si ya hay OTRA activa -> conflict.
    const fijada = await this.repo.setOrdenEnGestion(actor.usuarioId, ordenId);
    if (!fijada) {
      return { status: "conflict", motivo: "ya tienes otra orden en gestion" };
    }
    return { status: "ok", ordenId };
  }

  async gestionar(input: GestionarInput, actor: Actor): Promise<GestionarServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    // Feature 111/R1/R2/R3 (obligatorio): bloqueo total — un mensajero con un cierre pendiente
    // (`solicitado`/`vencido`) NO puede GESTIONAR. Guarda al INICIO, ANTES de cargar la orden y
    // de subir la evidencia a Storage -> sin efectos parciales (R3: ni upload, ni transición, ni
    // fila `gestion_orden`). MISMO predicado derivado de la asignación (R2). Sin PII (R20).
    if (await this.estaBloqueado(actor.usuarioId)) {
      return { status: "conflict", motivo: MSG_BLOQUEADO };
    }

    const guardia = await this.cargarOrdenGestionable(input.ordenId, actor);
    if (guardia.status !== "ok") return guardia;
    const orden = guardia.orden;

    // R21: no gestionar una orden distinta de la activa (si hay una activa).
    const activa = await this.repo.getOrdenEnGestion(actor.usuarioId);
    if (activa !== null && activa !== input.ordenId) {
      return { status: "conflict", motivo: "tienes otra orden activa en gestion" };
    }

    // R22 (h): ENTREGADA exige monto == montoCobrar EXACTO; si no cuadra, no
    // persiste. Comparacion en Decimal (no float) para evitar falsos negativos
    // por representacion binaria de los montos. `montoCobrar` null = orden SIN
    // cobro: cuadra con un recaudo de 0 (mismo trato que montoCobrar 0).
    if (input.resultado === "entregada") {
      const cuadra = new Prisma.Decimal(input.montoRecibido).equals(
        new Prisma.Decimal(orden.montoCobrar ?? 0),
      );
      if (!cuadra) {
        return {
          status: "validation_error",
          fieldErrors: {
            montoRecibido: ["el monto recibido debe cuadrar con el monto a cobrar de la orden"],
          },
        };
      }
    }

    const nuevoEstatusId = await this.ordenRepo.findEstatusIdByValue(input.resultado);
    if (nuevoEstatusId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // Feature 119 (R9/R10): subida SECUENCIAL y determinista de las N evidencias ANTES de la
    // transaccion, acumulando en `uploaded` los paths ya subidos para poder COMPENSAR
    // (storage.remove) ante cualquier fallo. El bucle secuencial hace la compensacion trivial:
    // `uploaded` contiene EXACTAMENTE lo subido hasta el fallo (sin rastrear promesas de un
    // Promise.all que rechaza). Para el tope de 3 fotos el costo de no paralelizar es despreciable.
    const uploaded: string[] = [];
    const evidencias: { storagePath: string; contentType: string; indice: number }[] = [];
    if (
      input.resultado === "entregada" ||
      input.resultado === "rechazada" ||
      input.resultado === "devuelta" || // feature 75: evidencia obligatoria tambien en Devolver
      // Feature 158 (R10, Q-B): el INCIDENTE sube sus 1..N fotos por el MISMO camino
      // compensado, en las TRES causas (tambien `perdido` y `robado`). El borde ya exigio
      // `min(1)`, asi que aqui nunca llega una lista vacia.
      input.resultado === "incidente"
    ) {
      try {
        for (let i = 0; i < input.evidencias.length; i++) {
          const ev = input.evidencias[i];
          const ext = GESTION_MIME_EXTENSION[ev.contentType as GestionMimeType] ?? "bin";
          // `-i` garantiza unicidad del path entre las fotos de la MISMA gestion (mismo `Date.now()`).
          const path = `${input.ordenId}/${input.resultado}-${Date.now()}-${i}.${ext}`;
          const stored = await this.storage.upload({
            path,
            bytes: ev.bytes,
            contentType: ev.contentType,
          });
          uploaded.push(stored);
          evidencias.push({ storagePath: stored, contentType: ev.contentType, indice: i });
        }
      } catch (error) {
        // R10: falla la subida #k -> borrar las k-1 ya subidas y NO persistir NADA (el repo ni
        // se invoca). El fallo se propaga como error, no como resultado de dominio.
        if (uploaded.length > 0) await this.storage.remove(uploaded);
        throw error;
      }
    }

    const gestion = buildGestionData(input, evidencias);

    try {
      // R23/R26/R28/R30 + R9: INSERT gestion + N filas de evidencia + UPDATE estatus + limpiar
      // puntero, TODO en una unica transaccion (todo-o-nada).
      // Feature 99 (R1/R29): la rama `devuelta` transiciona la orden a `devuelta` y la DEJA
      // ahi (sin transicion de seguimiento inmediata: ni reintento a bodega ni escalado). La
      // devolucion se contabiliza como intento (R2) por el append a `devuelta` del choke
      // point; el cron SLA (`DevolucionSlaService`) decide al vencer la ventana.
      await this.repo.crearGestionYTransicionar({
        ordenId: input.ordenId,
        mensajeroId: actor.usuarioId,
        gestion,
        nuevoEstatusId,
      });
    } catch (error) {
      // R11: la transaccion fallo DESPUES de subir -> borrar las N evidencias subidas
      // (best-effort) y propagar; no queda ninguna fila persistida.
      if (uploaded.length > 0) await this.storage.remove(uploaded);
      throw error;
    }

    // Feature 92 (R23): igual que en `recogerAsignaciones`, tras la transaccion.
    await this.registrarUbicacion(actor.usuarioId, input.ubicacion);

    // R13: cada evidencia se muestra con URL firmada de TTL acotado, NUNCA el path crudo ni el
    // bucket. Se mapea en el ORDEN de `uploaded` (indice 0..N-1) para preservar la portada primero.
    let evidenciaUrls: string[] | undefined;
    if (uploaded.length > 0) {
      const urlByPath = await this.signedUrls.createSignedUrls(
        uploaded,
        gestionConfig.SIGNED_URL_TTL_SECONDS,
      );
      evidenciaUrls = uploaded
        .map((p) => urlByPath[p])
        .filter((u): u is string => typeof u === "string");
    }
    return { status: "ok", ordenId: input.ordenId, estado: input.resultado, evidenciaUrls };
  }

  async liberarGestion(ordenId: string, actor: Actor): Promise<LiberarServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12/R35
    // R35: idempotente y concurrencia-seguro. El repo limpia SOLO si el puntero
    // del propio actor apunta a esa orden; devolvemos ok aunque no hubiera nada.
    await this.repo.liberarOrdenEnGestion(actor.usuarioId, ordenId);
    return { status: "ok" };
  }

  /**
   * Guardia comun (R18/R31): la orden existe, es del actor y su origen es
   * `en_reparto`. Devuelve la fila o un resultado de rechazo.
   */
  private async cargarOrdenGestionable(
    ordenId: string,
    actor: Actor,
  ): Promise<{ status: "ok"; orden: OrdenGestionRow } | { status: "forbidden" } | { status: "conflict"; motivo: string }> {
    const rows = await this.repo.findByIdsParaGestion([ordenId]);
    const orden = rows[0];
    if (!orden || orden.mensajeroAsignadoId !== actor.usuarioId) {
      return { status: "forbidden" }; // R31: orden ajena o inexistente
    }
    if (orden.deletedAt !== null) {
      return { status: "conflict", motivo: "orden borrada" };
    }
    if (orden.estatusValue !== ORIGEN_GESTION) {
      return { status: "conflict", motivo: `solo se gestiona desde ${ORIGEN_GESTION}` }; // R18
    }
    return { status: "ok", orden };
  }
}

/**
 * Proyeccion fila -> DTO de una asignacion del mensajero.
 *
 * EXPORTADA (2026-08-11, pedido humano «la recoleccion usa la misma card que Por recoger»):
 * `RecoleccionTiendaService` la reutiliza para alimentar la MISMA card con los MISMOS campos.
 * Copiar las veinte lineas alli habria dejado dos proyecciones que no pueden divergir sin que
 * una de las dos pantallas empiece a pintar huecos.
 */
export function toDTO(row: MiAsignacionRow): MiAsignacionDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatusValue,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    peso: row.peso,
    montoCobrar: row.montoCobrar,
    // Feature 97: coordenadas de la parada (ya number|null desde el repo). El mapa las usa en
    // `porGestionar`; el campo es de la orden, asi que viaja tambien en `porRecoger`.
    latitud: row.latitud,
    longitud: row.longitud,
    notas: row.notas,
    tiendaNombre: row.tiendaNombre,
    // Contacto de la tienda dueña de la orden. `?? null` porque la fila lo declara opcional
    // (patron aditivo): un doble de test que no lo ponga produce `null`, no `undefined`, igual
    // que hace el repo real cuando la tienda no lo tiene registrado.
    //
    // DEUDA DECLARADA (feature 167): este campo entro con la 157 para el apartado de
    // recoleccion, que ya NO vive en Entregas. Aqui queda sin consumidor. NO se retira en esta
    // feature porque `design.md §2.3` no lo lista entre las retiradas y sacarlo tocaria los
    // fixtures de media docena de tests de Entregas; queda como pregunta abierta en la bitacora.
    // Lo que SI sigue siendo necesario es el campo homonimo de `MiAsignacionRow`: de ahi lo lee
    // `RecoleccionTiendaService.listarRecoleccion` para su propio DTO.
    tiendaTelefono: row.tiendaTelefono ?? null,
    zonaNombre: row.zonaNombre,
    provinciaNombre: row.provinciaNombre,
    cantonNombre: row.cantonNombre,
    distritoNombre: row.distritoNombre,
    // Feature 92 (R28): la posicion la resuelve el llamador con el mapa de la ruta; el
    // default `null` es correcto para "Por recoger", que nunca tiene posicion.
    secuenciaRuta: null,
    // Feature 115 (R17): default `false`; el llamador lo sobreescribe con la marca real del
    // actor (`marcadasLuego.has(row.id)`). Aqui SIEMPRE nace un boolean concreto.
    marcarLuego: false,
    // Feature 116 (R6/R8): default `null`; el llamador lo sobreescribe con la nota real del
    // actor (`notasPrivadas.get(row.id)`). Aqui SIEMPRE nace un `string | null` concreto.
    notaPrivada: null,
  };
}

/**
 * Arma los campos nullable de gestion_orden segun el resultado (R23/R26/R28/R30). Feature 119:
 * las ramas con foto pasan la LISTA `evidencias` (1..N); el repo deriva de ella la portada
 * (indice 0) hacia las columnas viejas (dual-write, R12) e inserta las N filas hijas.
 */
function buildGestionData(
  input: GestionarInput,
  evidencias: { storagePath: string; contentType: string; indice: number }[],
): GestionOrdenData {
  // Feature 193 (R1/R6/R14): la ubicacion es transversal a las CINCO ramas, asi que se arma
  // una vez y se esparce, en vez de repetirla en cada `return` —que es como una rama nueva
  // acaba naciendo sin ella—.
  //
  // El `?? null` es explicito y no cosmetico: `undefined` haria que Prisma OMITIERA la
  // columna del INSERT en vez de escribir NULL. Con columnas nullable el resultado
  // coincidiria hoy, pero deja de coincidir en cuanto alguien anada un `@default`, y el fallo
  // seria silencioso. El borde ya garantizo que llega O la ubicacion O el motivo (R8-R12).
  const geo = {
    ubicacionLat: input.ubicacion?.lat ?? null,
    ubicacionLng: input.ubicacion?.lng ?? null,
    ubicacionAusencia: input.ubicacionAusencia ?? null,
  };
  switch (input.resultado) {
    case "entregada":
      return {
        ...geo,
        resultado: "entregada",
        montoRecibido: input.montoRecibido,
        metodoPago: input.metodoPago,
        evidencias,
      };
    case "reprogramada":
      return {
        ...geo,
        resultado: "reprogramada",
        fechaReprogramacion: input.fechaReprogramacion,
        motivo: input.motivo,
      };
    case "devuelta":
      // Feature 73/R11/R12: la causa va en su COLUMNA propia, APARTE del texto libre; el
      // `motivo` se persiste EXACTAMENTE como lo escribio el mensajero, sin decoracion.
      // Feature 75/119: la devolucion persiste sus 1..N fotos de evidencia (obligatorias).
      return {
        ...geo,
        resultado: "devuelta",
        causaDevolucion: input.causaDevolucion,
        motivo: input.motivo,
        evidencias,
      };
    case "rechazada":
      return {
        ...geo,
        resultado: "rechazada",
        motivo: input.motivo,
        evidencias,
      };
    // Feature 158/R9/R10/R11: la causa va en su COLUMNA propia, APARTE del texto libre; el
    // `motivo` se persiste EXACTAMENTE como lo escribio el mensajero. NO se arma
    // `montoRecibido` ni `metodoPago` (no hay recaudo) ni `indemnizacion` (el monto lo captura
    // el admin al aprobar el cierre, R19/R22).
    case "incidente":
      return {
        ...geo,
        resultado: "incidente",
        causaIncidente: input.causaIncidente,
        motivo: input.motivo,
        evidencias,
      };
  }
}
