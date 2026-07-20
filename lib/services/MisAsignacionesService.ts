import { Prisma } from "@prisma/client";
import { GESTION_MIME_EXTENSION, gestionConfig, type GestionMimeType } from "@/lib/config/gestion";
import { reintentosConfig } from "@/lib/config/reintentos";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  GestionOrdenData,
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
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
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";

// Estado de origen de "Recoger" (feature 17) y destino tras recoger (feature 36).
const ORIGEN_RECOGER = "en_espera_aceptacion";
const ESTADO_EN_REPARTO = "en_reparto";
// Unico estado de origen valido para gestionar los 4 resultados (R18).
const ORIGEN_GESTION = "en_reparto";

// Feature 47 — destinos de la transicion de SEGUIMIENTO de una gestion `devuelta` (valores
// de catalogo YA sembrados en ORDER_STATUS_SEED; esta feature NO agrega estados, R21).
const ESTATUS_RECHAZADA = "rechazada"; // escalado (final) al alcanzar el umbral
const ESTATUS_EN_BODEGA = "en_bodega"; // reintento -> bodega central
const ESTATUS_EN_BODEGA_SATELITE = "en_bodega_satelite"; // reintento -> bodega satelite

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
    private readonly ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue">,
    private readonly storage: IFileStorage,
    private readonly signedUrls: ISignedUrlProvider,
    // Feature 47: deps añadidas al FINAL (no rompe el orden existente). El derivador de
    // intentos (49) y la zona central para la bodega responsable (41/54). Solo se consumen
    // en la rama `devuelta`.
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentos">,
    private readonly zonaRepo: Pick<IZonaRepository, "findCentralZonaId">,
    // Feature 92 (R23/R28): dep anadida al FINAL (no rompe el orden existente). Se usa
    // para leer la secuencia optimizada al listar y para persistir el origen `gps` que
    // el navegador adjunta a recoger/gestionar.
    private readonly rutaRepo: Pick<
      IRutaOptimizadaRepository,
      "findByMensajero" | "upsertOrigen"
    >,
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

  async listarMisAsignaciones(actor: Actor): Promise<ListarMisAsignacionesServiceResult> {
    if (actor.rol !== "mensajero") return { status: "forbidden" }; // R12

    const [ordenEnGestionId, rows, entregadas, montoEntregadas, ruta] = await Promise.all([
      this.repo.getOrdenEnGestion(actor.usuarioId), // R20
      this.repo.findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOGER, ESTADO_EN_REPARTO]), // R9/R13
      this.repo.contarEntregadas(actor.usuarioId), // Feature 61: KPI entregadas
      this.repo.sumMontoCobrarEntregadas(actor.usuarioId), // KPI "Total a cobrar" (parte entregada)
      this.rutaRepo.findByMensajero(actor.usuarioId), // Feature 92/R28: secuencia optimizada
    ]);

    // Feature 92 (R28): posicion por orden. Vacio si nunca se optimizo -> todas las cards
    // quedan "sin posicion" y conservan el orden actual, que es el comportamiento previo.
    const secuencias = ruta?.secuenciaPorOrden ?? new Map<string, number>();

    const porRecoger: MiAsignacionDTO[] = [];
    const porGestionar: MiAsignacionDTO[] = [];
    for (const row of rows) {
      const dto = toDTO(row);
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
    const codEnReparto = porGestionar.reduce((sum, o) => sum + (o.montoCobrar ?? 0), 0);
    const kpis: MisAsignacionesKpis = {
      pendientes: porGestionar.length,
      entregadas,
      porCobrar: codEnReparto,
      // Total a cobrar ACUMULADO: COD en_reparto + COD ya entregado. Estable al entregar;
      // se descuenta al gestionar como reprogramada/devuelta/rechazada (fuera de ambos sets).
      totalACobrar: codEnReparto + montoEntregadas,
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

    // R23/R30: subir evidencia (entrega/rechazo/devolucion) ANTES de la transaccion.
    let storagePath: string | null = null;
    let contentType: string | null = null;
    if (
      input.resultado === "entregada" ||
      input.resultado === "rechazada" ||
      input.resultado === "devuelta" // feature 75: evidencia obligatoria tambien en Devolver
    ) {
      const ext = GESTION_MIME_EXTENSION[input.evidencia.contentType as GestionMimeType] ?? "bin";
      const path = `${input.ordenId}/${input.resultado}-${Date.now()}.${ext}`;
      storagePath = await this.storage.upload({
        path,
        bytes: input.evidencia.bytes,
        contentType: input.evidencia.contentType,
      });
      contentType = input.evidencia.contentType;
    }

    const gestion = buildGestionData(input, storagePath, contentType);

    // Feature 47 (R1/R4/R5/R8/R9): SOLO la rama `devuelta` gana una transicion de
    // SEGUIMIENTO (las otras 3 ramas quedan intactas -> R19). La decision (reintento a
    // bodega vs escalado a rechazada) se toma ANTES de la tx con el conteo derivado de la
    // 49; el puntero de bloqueo 1-a-1 del mensajero evita TOCTOU (design §2.3). El repo solo
    // escribe: la REGLA vive aqui.
    let seguimiento: { destinoEstatusId: string; limpiaMensajero: boolean } | undefined;
    if (input.resultado === "devuelta") {
      const decision = await this.resolverSeguimientoDevuelta(orden);
      if (decision.status !== "ok") return decision;
      seguimiento = decision.seguimiento;
    }

    try {
      // R23/R26/R28/R30: INSERT gestion + UPDATE estatus + limpiar puntero, atomico.
      // Feature 47 (R6/R7/R10/R11): + transicion de seguimiento (reintento/escalado) en la
      // MISMA tx cuando hay `seguimiento` (rama devuelta).
      await this.repo.crearGestionYTransicionar({
        ordenId: input.ordenId,
        mensajeroId: actor.usuarioId,
        gestion,
        nuevoEstatusId,
        seguimiento,
      });
    } catch (error) {
      // R23/R30: si la transaccion falla tras subir, limpiar el objeto (best-effort).
      if (storagePath) await this.storage.remove([storagePath]);
      throw error;
    }

    // Feature 92 (R23): igual que en `recogerAsignaciones`, tras la transaccion.
    await this.registrarUbicacion(actor.usuarioId, input.ubicacion);

    // R8: la evidencia se muestra con URL firmada de TTL acotado, nunca el path crudo.
    let evidenciaUrl: string | undefined;
    if (storagePath) {
      evidenciaUrl = await this.signedUrls.createSignedUrl(
        storagePath,
        gestionConfig.SIGNED_URL_TTL_SECONDS,
      );
    }
    return { status: "ok", ordenId: input.ordenId, estado: input.resultado, evidenciaUrl };
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

  /**
   * Feature 47 (R1/R2/R5/R8/R9) — REGLA de reintento vs escalado de una gestion `devuelta`.
   * Lee el conteo de intentos previos (derivador de la 49), calcula el intento actual y lo
   * compara con el umbral configurable (R3). `intentoActual >= umbral` -> ESCALADO a
   * `rechazada` (final, conserva el mensajero). `intentoActual < umbral` -> REINTENTO a la
   * bodega responsable derivada de la zona (`en_bodega`/`en_bodega_satelite`, limpia el
   * mensajero, R6). `zonaId` null -> fallback central `en_bodega` (R5 edge). Resuelve el id
   * del destino via `findEstatusIdByValue`; catalogo incompleto -> validation_error (mismo
   * patron que ya usa `gestionar`). El actor del seguimiento lo fija el repo (null, sistema).
   */
  private async resolverSeguimientoDevuelta(
    orden: OrdenGestionRow,
  ): Promise<
    | { status: "ok"; seguimiento: { destinoEstatusId: string; limpiaMensajero: boolean } }
    | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  > {
    const intentosPrevios = await this.historial.contarIntentos(orden.id); // R1/R2 (derivador 49)
    const intentoActual = intentosPrevios + 1;
    const umbral = reintentosConfig.MIN_INTENTOS_ENTREGA; // R3

    if (intentoActual >= umbral) {
      // R8/R9: la N-esima devolucion (N = umbral) escala a `rechazada` (final). NO limpia el
      // mensajero: deja el rastro del ultimo (mismo trato que un rechazo directo, para la 48).
      const destinoEstatusId = await this.ordenRepo.findEstatusIdByValue(ESTATUS_RECHAZADA);
      if (destinoEstatusId === null) return this.catalogoIncompleto();
      return { status: "ok", seguimiento: { destinoEstatusId, limpiaMensajero: false } };
    }

    // R5: reintento -> bodega responsable derivada de la zona (reusa el ruteo 30/33/46).
    // `zonaId` null -> fallback central (`en_bodega`), sin consultar la zona central.
    let value: string;
    if (orden.zonaId === null) {
      value = ESTATUS_EN_BODEGA;
    } else {
      const centralZonaId = await this.zonaRepo.findCentralZonaId();
      const { destinoTipo } = resolverDestinoCierre(orden.zonaId, centralZonaId);
      value = destinoTipo === "bodega_central" ? ESTATUS_EN_BODEGA : ESTATUS_EN_BODEGA_SATELITE;
    }
    const destinoEstatusId = await this.ordenRepo.findEstatusIdByValue(value);
    if (destinoEstatusId === null) return this.catalogoIncompleto();
    // R6: reintento limpia el mensajero (handoff a la bodega, patron liberacion 46).
    return { status: "ok", seguimiento: { destinoEstatusId, limpiaMensajero: true } };
  }

  private catalogoIncompleto(): {
    status: "validation_error";
    fieldErrors: Record<string, string[]>;
  } {
    return {
      status: "validation_error",
      fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
    };
  }
}

function toDTO(row: MiAsignacionRow): MiAsignacionDTO {
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
    notas: row.notas,
    tiendaNombre: row.tiendaNombre,
    zonaNombre: row.zonaNombre,
    provinciaNombre: row.provinciaNombre,
    cantonNombre: row.cantonNombre,
    distritoNombre: row.distritoNombre,
    // Feature 92 (R28): la posicion la resuelve el llamador con el mapa de la ruta; el
    // default `null` es correcto para "Por recoger", que nunca tiene posicion.
    secuenciaRuta: null,
  };
}

/** Arma los campos nullable de gestion_orden segun el resultado (R23/R26/R28/R30). */
function buildGestionData(
  input: GestionarInput,
  storagePath: string | null,
  contentType: string | null,
): GestionOrdenData {
  switch (input.resultado) {
    case "entregada":
      return {
        resultado: "entregada",
        montoRecibido: input.montoRecibido,
        metodoPago: input.metodoPago,
        evidenciaStoragePath: storagePath,
        evidenciaContentType: contentType,
      };
    case "reprogramada":
      return {
        resultado: "reprogramada",
        fechaReprogramacion: input.fechaReprogramacion,
        motivo: input.motivo,
      };
    case "devuelta":
      // Feature 73/R11/R12: la causa va en su COLUMNA propia, APARTE del texto libre; el
      // `motivo` se persiste EXACTAMENTE como lo escribio el mensajero, sin decoracion.
      // Pedido: la devolucion ahora persiste la FOTO de evidencia (obligatoria), igual que
      // entrega/rechazo (mismas columnas genericas de gestion_orden).
      return {
        resultado: "devuelta",
        causaDevolucion: input.causaDevolucion,
        motivo: input.motivo,
        // Feature 75: la evidencia (subida ANTES de la tx, espejo de rechazada) entra al INSERT.
        evidenciaStoragePath: storagePath,
        evidenciaContentType: contentType,
      };
    case "rechazada":
      return {
        resultado: "rechazada",
        motivo: input.motivo,
        evidenciaStoragePath: storagePath,
        evidenciaContentType: contentType,
      };
  }
}
