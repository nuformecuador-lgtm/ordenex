// Feature 92 (design §5) — servicio que recalcula la ruta de UN mensajero. DI por
// INTERFACES (docs/architecture.md §Service): no conoce Next.js, ni Prisma, ni `fetch`.
//
// PRIVACIDAD (R14): las coordenadas de entrega son DATO PERSONAL — identifican el
// domicilio del destinatario, y la ubicacion del mensajero es dato de una persona
// trabajando. Este archivo NUNCA emite coordenadas, direccion ni credencial por el logger
// ni por un mensaje de error, y no usa `console.*`.
//
// ═══ LAS CUATRO GUARDAS DE COSTE SON LO IMPORTANTE DE ESTE ARCHIVO ═══
// Cada llamada a `optimizeTours` se FACTURA. El orden de los pasos esta elegido para que
// las guardas mas baratas corten antes que las caras:
//
//   R20  job obsoleto (una optimizacion posterior ya cubrio este evento) -> 0 llamadas
//   R34  dos pulsaciones del boton dentro del intervalo minimo           -> 0 llamadas
//   R35  0 o 1 parada con coordenadas                                    -> 0 llamadas
//   R38  mas de RUTA_MAX_PARADAS -> se recorta, no se paga por el exceso
//   R36  mismo conjunto de paradas y mismo origen que la ultima vez      -> 0 llamadas
//
// ═══ ANTE FALLO DEL PROVEEDOR SE CONSERVA EL ULTIMO ORDEN VALIDO (R27) ═══
// Decision explicita del humano. NUNCA se borra la secuencia previa y NUNCA se cae en
// silencio a `createdAt desc`: la ruta se marca `desactualizada` (lo que alimenta el aviso
// de la UI) y se LANZA para que la cola aplique su backoff.
import { createHash } from "node:crypto";
import type { IRouteOptimizationClient } from "@/lib/interfaces/external/IRouteOptimizationClient";
import type {
  IRutaOptimizadaRepository,
  OrigenFuente,
  RutaOptimizadaDTO,
} from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RouteOptimizationConfig } from "@/lib/config/route-optimization";
import type {
  EjecutarOptimizacionOpts,
  EjecutarOptimizacionResult,
  IOptimizacionRutaService,
} from "@/lib/interfaces/services/IOptimizacionRutaService";

/** Fuente de las paradas. `Pick` para que los dobles de test no implementen 40 metodos. */
export interface ParadasRepo {
  findParadasEnReparto(mensajeroId: string): Promise<ParadaRutaRow[]>;
}

/** Logger inyectable, patron `GeocodeLogger` de la 91. NUNCA recibe PII ni secretos. */
export interface RutaLogger {
  warn(message: string): void;
}
const defaultLogger: RutaLogger = { warn: () => {} };

/** El proveedor fallo (transitorio o config invalida). La cola aplica su backoff. */
export class RutaIntentoFallidoError extends Error {
  constructor(detalle: string) {
    super(detalle);
    this.name = "RutaIntentoFallidoError";
  }
}

/**
 * Redondeo del origen para la huella de R36. 4 decimales ≈ 11 m: mas fino haria que el
 * jitter del GPS parado en un semaforo invalidara la huella y disparara una llamada
 * facturada por cada lectura. Mas grueso perderia cambios de calle reales.
 */
const ORIGEN_DECIMALES = 4;

export class OptimizacionRutaService implements IOptimizacionRutaService {
  constructor(
    private readonly rutas: IRutaOptimizadaRepository,
    private readonly paradasRepo: ParadasRepo,
    private readonly client: IRouteOptimizationClient,
    private readonly config: RouteOptimizationConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: RutaLogger = defaultLogger,
  ) {}

  async ejecutar(
    mensajeroId: string,
    opts: EjecutarOptimizacionOpts,
  ): Promise<EjecutarOptimizacionResult> {
    const ahora = this.now();

    // R23: la ubicacion del navegador se persiste ANTES de cualquier guarda. Aunque la
    // optimizacion se omita, la posicion capturada sigue siendo util para la siguiente.
    if (opts.ubicacion !== undefined) {
      await this.rutas.upsertOrigen(mensajeroId, {
        lat: opts.ubicacion.lat,
        lng: opts.ubicacion.lng,
        capturadaAt: ahora,
        fuente: "gps",
      });
    }

    const ruta = await this.rutas.findByMensajero(mensajeroId);

    // ── R20: guarda de OBSOLESCENCIA ──────────────────────────────────────────────
    // El job de debounce en vuelo no se puede cancelar (`IJobRepository` no lo expone y
    // NO se le anade, design §4.1). Si entre su encolado y su ejecucion una optimizacion
    // posterior ya recalculo la ruta, este job no tiene nada que hacer: completarlo sin
    // llamar es el ahorro que compensa no poder cancelar.
    if (
      opts.jobCreatedAt !== undefined &&
      ruta?.calculadaAt != null &&
      opts.jobCreatedAt < ruta.calculadaAt
    ) {
      return { status: "omitida", razon: "obsoleta" };
    }

    // ── R34: intervalo minimo del boton manual ────────────────────────────────────
    // Solo aplica al disparo manual: los de la cola ya estan acotados por el debounce y
    // por la guarda de obsolescencia. Dos pulsaciones seguidas (doble clic, o el mensajero
    // impaciente) NO producen dos llamadas facturadas.
    if (opts.motivo === "manual" && ruta?.calculadaAt != null) {
      const transcurridoS = (ahora.getTime() - ruta.calculadaAt.getTime()) / 1000;
      if (transcurridoS < this.config.RUTA_SYNC_MIN_INTERVALO_S) {
        return { status: "omitida", razon: "intervalo_minimo" };
      }
    }

    const todas = await this.paradasRepo.findParadasEnReparto(mensajeroId);
    // R37: las ordenes SIN coordenadas se EXCLUYEN de la optimizacion, no la abortan.
    // Quedan como paradas sin posicion (R28) y la lectura las muestra al final.
    const conCoordenadas = todas.filter(
      (p): p is ParadaRutaRow & { latitud: number; longitud: number } =>
        p.latitud !== null && p.longitud !== null,
    );

    // ── R35: 0 o 1 parada ─────────────────────────────────────────────────────────
    // Optimizar un punto no significa nada: no hay orden que calcular. Se persiste la
    // secuencia trivial (o se limpia la vieja, si el mensajero ya entrego todo) SIN
    // llamar al proveedor.
    if (conCoordenadas.length <= 1) {
      const unica = conCoordenadas[0];
      const origen =
        unica !== undefined
          ? this.resolverOrigen(ruta, conCoordenadas, ahora)
          : this.origenSoloDeUltimaConocida(ruta);
      await this.rutas.reemplazarSecuencia(
        mensajeroId,
        unica !== undefined ? [unica.ordenId] : [],
        {
          calculadaAt: ahora,
          origen,
          huellaSet: this.huella(
            unica !== undefined ? [unica.ordenId] : [],
            origen,
          ),
        },
      );
      return { status: "omitida", razon: "sin_paradas" };
    }

    // ── R38: tope de paradas ──────────────────────────────────────────────────────
    // `findParadasEnReparto` ya devuelve `createdAt asc`, que es el criterio pedido: se
    // optimizan las mas antiguas y el resto queda sin posicion (R28), no se descarta.
    const paradas = conCoordenadas.slice(0, this.config.RUTA_MAX_PARADAS);
    if (conCoordenadas.length > this.config.RUTA_MAX_PARADAS) {
      // Mensaje AGREGADO: un conteo, jamas un id ni una coordenada.
      this.logger.warn(
        `[optimizacion_ruta] paradas recortadas al tope (${this.config.RUTA_MAX_PARADAS})`,
      );
    }

    const origen = this.resolverOrigen(ruta, paradas, ahora);

    // ── R36: huella del conjunto + origen ─────────────────────────────────────────
    // Si nada cambio desde la ultima optimizacion valida, el resultado seria identico:
    // pagarlo otra vez es tirar dinero. La huella ordena los ids para ser independiente
    // del orden de lectura, e incluye el origen redondeado.
    const huellaSet = this.huella(
      paradas.map((p) => p.ordenId),
      origen,
    );
    if (ruta?.huellaSet === huellaSet && ruta.estado === "vigente") {
      return { status: "omitida", razon: "sin_cambios" };
    }

    // ── Llamada FACTURADA al proveedor ────────────────────────────────────────────
    const outcome = await this.client.optimizar({
      origen: { lat: origen.lat, lng: origen.lng },
      paradas: paradas.map((p) => ({ ordenId: p.ordenId, lat: p.latitud, lng: p.longitud })),
    });

    if (outcome.status === "ok") {
      await this.rutas.reemplazarSecuencia(mensajeroId, outcome.secuencia, {
        calculadaAt: ahora,
        origen,
        huellaSet,
      });
      return { status: "ok", paradas: outcome.secuencia.length };
    }

    // R27: fallo del proveedor. NO se tocan las paradas — el ultimo orden valido queda
    // INTACTO. Se marca la ruta `desactualizada` (aviso de la UI) y se LANZA para que la
    // cola aplique su backoff. `outcome.detalle` viene ya saneado del cliente: cita la
    // operacion y el estado HTTP, nunca el token, la URL ni una coordenada (R14).
    if (outcome.status === "config_invalida") {
      // Ruidoso a proposito (mismo criterio que la 91): preferimos un dead-letter VISIBLE
      // a rutas que dejan de actualizarse en silencio.
      this.logger.warn("[optimizacion_ruta] el proveedor rechazo la credencial");
    }
    await this.rutas.marcarDesactualizada(mensajeroId, outcome.detalle);
    throw new RutaIntentoFallidoError(outcome.detalle);
  }

  /**
   * R24/R25 — resolucion del ORIGEN, en tres escalones. NUNCA falla ni bloquea: la
   * denegacion del permiso de geolocalizacion en el navegador simplemente hace que no
   * llegue `ubicacion`, y se cae al escalon siguiente (R25).
   *
   *   1. `gps` con antiguedad < RUTA_ORIGEN_TTL_MIN   -> fuente "gps"
   *   2. la ultima conocida AUNQUE este vencida        -> fuente "ultima_conocida"
   *   3. el CENTROIDE de las paradas                   -> fuente "centroide"
   *
   * No hay cuarto escalon: si no hubiera ni una parada con coordenadas, la guarda R35 ya
   * habria cortado antes de llegar aqui. El centroide se eligio porque el esquema NO tiene
   * coordenadas de zona ni de bodega (verificado) y no requiere ninguna llamada externa;
   * anadirlas queda como seguimiento (design §11.2).
   *
   * La fuente se PERSISTE y se muestra en la UI: el mensajero debe saber cuando la ruta se
   * calculo desde un punto aproximado.
   */
  private resolverOrigen(
    ruta: RutaOptimizadaDTO | null,
    paradas: { latitud: number; longitud: number }[],
    ahora: Date,
  ): { lat: number; lng: number; fuente: OrigenFuente } {
    if (ruta !== null && ruta.origenLat !== null && ruta.origenLng !== null) {
      const vigente =
        ruta.origenAt !== null &&
        ahora.getTime() - ruta.origenAt.getTime() <= this.config.RUTA_ORIGEN_TTL_MIN * 60_000;
      return {
        lat: ruta.origenLat,
        lng: ruta.origenLng,
        // Escalon 1 vs 2: la MISMA coordenada, pero la fuente cambia para que la UI pueda
        // avisar de que el punto de partida esta viejo.
        fuente: vigente && ruta.origenFuente === "gps" ? "gps" : "ultima_conocida",
      };
    }
    // Escalon 3: centroide aritmetico de las paradas.
    const lat = paradas.reduce((s, p) => s + p.latitud, 0) / paradas.length;
    const lng = paradas.reduce((s, p) => s + p.longitud, 0) / paradas.length;
    return { lat, lng, fuente: "centroide" };
  }

  /**
   * Caso borde de R35 con CERO paradas: no hay centroide posible (dividir entre cero). Se
   * usa la ultima ubicacion conocida si la hay, y `null` si tampoco. La secuencia vieja se
   * limpia igual: el mensajero entrego todo y no quedan paradas que ordenar.
   */
  private origenSoloDeUltimaConocida(
    ruta: RutaOptimizadaDTO | null,
  ): { lat: number; lng: number; fuente: OrigenFuente } | null {
    if (ruta === null || ruta.origenLat === null || ruta.origenLng === null) return null;
    return { lat: ruta.origenLat, lng: ruta.origenLng, fuente: "ultima_conocida" };
  }

  /**
   * R36 — huella del conjunto de paradas + origen. Los ids se ORDENAN antes de hashear:
   * la huella identifica el CONJUNTO, no el orden de lectura (si dependiera del orden,
   * cualquier reordenacion de la consulta dispararia una llamada facturada de mas).
   * El origen se redondea (ver `ORIGEN_DECIMALES`) para absorber el jitter del GPS.
   */
  private huella(
    ordenIds: string[],
    origen: { lat: number; lng: number } | null,
  ): string {
    const ids = [...ordenIds].sort().join(",");
    const punto =
      origen === null
        ? "sin-origen"
        : `${origen.lat.toFixed(ORIGEN_DECIMALES)},${origen.lng.toFixed(ORIGEN_DECIMALES)}`;
    return createHash("sha256").update(`${punto}|${ids}`, "utf8").digest("hex");
  }
}
