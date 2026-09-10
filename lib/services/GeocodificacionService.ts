// Feature 91 (design §5) — servicio que resuelve UN job de geocodificacion. DI por
// INTERFACES (docs/architecture.md §Service): no conoce Next.js, ni Prisma, ni `fetch`.
//
// PRIVACIDAD (R31): la direccion es DATO PERSONAL. Este archivo NUNCA emite direccion,
// coordenadas ni credencial por el logger, y no usa `console.*`. Los mensajes son
// agregados y citan la operacion, nunca el dato.
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { IGeocodeCacheRepository } from "@/lib/interfaces/repositories/IGeocodeCacheRepository";
import type { IOrdenGeocodeRepository } from "@/lib/interfaces/repositories/IOrdenGeocodeRepository";
import type { IGeocodeClient } from "@/lib/interfaces/external/IGeocodeClient";
import type { GeocodeConfig } from "@/lib/config/geocode";
import { construirQueryDireccion, hashDireccion } from "@/lib/geo/direccion-query";
import { marcarFalloConfigGeocode } from "@/lib/geo/fallo-config-geocode";

/** Estados que se persisten en `orden.geocode_status`. */
export const STATUS_OK = "OK";
export const STATUS_SIN_RESULTADOS = "ZERO_RESULTS";
export const STATUS_CONSULTA_INVALIDA = "INVALID_REQUEST";
/** Estado PROPIO (no del proveedor): la orden no tiene direccion geocodificable (R9). */
export const STATUS_SIN_DIRECCION = "SIN_DIRECCION";

/** Logger inyectable, patron `JobsLogger` de la 90. NUNCA recibe PII ni secretos. */
export interface GeocodeLogger {
  warn(message: string): void;
}
const defaultLogger: GeocodeLogger = { warn: () => {} };

/**
 * R25: falta la credencial del proveedor. Se LANZA (no se completa el job) para que la
 * cola lo reintente cuando la configuracion se arregle. `JobQueueService.drenar` captura
 * por job, asi que el resto del lote — incluido `liberar_reprogramadas`, que comparte el
 * cron `/api/cron/procesar-jobs` — sigue drenando sin verse afectado.
 */
export class GeocodeNoConfiguradoError extends Error {
  constructor() {
    // FEATURE 400 (2026-09-09, R11): el mensaje viaja MARCADO. Falta de credencial es un
    // fallo NUESTRO, no de la direccion, y el gate de asignabilidad tiene que poder
    // distinguirlo al otro lado de la cola (`jobs.last_error`), donde lo unico que queda
    // es esta cadena. El texto legible NO cambia: solo gana el prefijo.
    super(marcarFalloConfigGeocode("geocodificacion: GOOGLE_MAPS_API_KEY no esta configurada"));
    this.name = "GeocodeNoConfiguradoError";
  }
}

/**
 * FALLO TRANSITORIO del intento: red, timeout, HTTP 5xx, cuota (`OVER_QUERY_LIMIT`),
 * estado desconocido del proveedor. La cola aplica su backoff y lo reintenta.
 *
 * FEATURE 400 (2026-09-09, R16) — REGLA VIGENTE: este error es SOLO para el transitorio.
 * Hasta esta ficha su docstring decia «el proveedor rechazo la peticion (REQUEST_DENIED)
 * **o** hubo un fallo transitorio», y esa ambiguedad ERA el bug: rio abajo los dos casos
 * quedaban indistinguibles, y un corte de credencial se leia en pantalla como «Direccion
 * no encontrada» (42 ordenes bloqueadas 19 horas el 2026-09-08). El caso de configuracion
 * tiene ahora su propia clase, `GeocodeConfigInvalidaError`, y su propio marcador.
 *
 * Consecuencia deliberada: este error NO lleva marcador. Un job muerto por red o por cuota
 * sigue bloqueando la asignacion, que es lo que el humano decidio (design §8-A5).
 */
export class GeocodeIntentoFallidoError extends Error {
  constructor(detalle: string) {
    super(detalle);
    this.name = "GeocodeIntentoFallidoError";
  }
}

/**
 * FEATURE 400 (2026-09-09, R11) — el proveedor RECHAZO la peticion (`REQUEST_DENIED`):
 * credencial, facturacion o configuracion del proyecto. La direccion NUNCA llego a
 * consultarse, asi que este fallo no dice absolutamente nada sobre ella.
 *
 * Su `message` va MARCADO (`marcarFalloConfigGeocode`) para que la causa sobreviva al
 * salto por la cola y `AsignabilidadCoordenadasService` pueda clasificar la orden como
 * `asignable_sin_ubicacion` en vez de bloquearla.
 *
 * NO extiende `GeocodeIntentoFallidoError` a proposito: si lo hiciera, un
 * `toBeInstanceOf(GeocodeIntentoFallidoError)` seguiria verde sobre este caso y los dos
 * volverian a ser el mismo cubo — que es exactamente el defecto que esta ficha corrige.
 */
export class GeocodeConfigInvalidaError extends Error {
  constructor(detalle: string) {
    super(marcarFalloConfigGeocode(detalle));
    this.name = "GeocodeConfigInvalidaError";
  }
}

/** R14: el payload solo lleva el id de la orden. Cualquier otra forma es un error. */
const payloadSchema = z.object({ ordenId: z.string().min(1) });

export class GeocodificacionService {
  constructor(
    private readonly ordenes: IOrdenGeocodeRepository,
    private readonly cache: IGeocodeCacheRepository,
    private readonly client: IGeocodeClient,
    private readonly config: GeocodeConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: GeocodeLogger = defaultLogger,
  ) {}

  /**
   * Ejecuta el job. Su DESENLACE es el contrato de la tabla normativa del gate F1.4-Q3
   * (requirements.md Bloque E): retornar = `complete`; lanzar = backoff y, agotados los
   * intentos, dead-letter.
   */
  async ejecutar(job: JobDTO): Promise<void> {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error("geocodificacion: payload invalido (se esperaba { ordenId })");
    }
    const { ordenId } = parsed.data;

    // R30: orden inexistente o borrada -> job COMPLETADO sin error. Una orden borrada no
    // es un fallo del sistema; reintentarla no la va a resucitar.
    const orden = await this.ordenes.findParaGeocodificar(ordenId);
    if (orden === null) return;

    const query = construirQueryDireccion({
      direccion: orden.direccion,
      distritoNombre: orden.distritoNombre,
      cantonNombre: orden.cantonNombre,
      provinciaNombre: orden.provinciaNombre,
    });

    // R9: sin direccion geocodificable. No deberia haberse encolado, pero la direccion
    // pudo vaciarse entre el encolado y la ejecucion. Se deja constancia y se completa.
    if (query === null) {
      await this.ordenes.guardarResultado(ordenId, {
        latitud: null,
        longitud: null,
        precision: null,
        status: STATUS_SIN_DIRECCION,
        geocodedAt: this.now(),
      });
      return;
    }

    const hash = hashDireccion(query);

    // R26: acierto de cache -> se escribe en la orden SIN tocar la red ni pagar.
    const enCache = await this.cache.findByHash(hash);
    if (enCache !== null) {
      await this.ordenes.guardarResultado(ordenId, {
        latitud: enCache.latitud,
        longitud: enCache.longitud,
        precision: enCache.precision,
        status: STATUS_OK,
        geocodedAt: this.now(),
      });
      return;
    }

    // R25: sin credencial se lanza ANTES de llamar. Mensaje agregado, sin PII.
    if (this.config.GOOGLE_MAPS_API_KEY === null) {
      this.logger.warn("[geocodificacion] job sin credencial configurada");
      throw new GeocodeNoConfiguradoError();
    }

    const outcome = await this.client.geocodificar(query);

    switch (outcome.status) {
      case "ok": {
        // R18/R20: se guarda SIEMPRE la precision reportada, incluida APPROXIMATE (Q8);
        // el umbral de calidad lo decidira el primer consumidor.
        await this.cache.upsert(hash, {
          latitud: outcome.latitud,
          longitud: outcome.longitud,
          precision: outcome.precision,
          payloadCrudo: outcome.crudo,
        });
        await this.ordenes.guardarResultado(ordenId, {
          latitud: outcome.latitud,
          longitud: outcome.longitud,
          precision: outcome.precision,
          status: STATUS_OK,
          geocodedAt: this.now(),
        });
        return;
      }
      case "sin_resultados": {
        // R21: determinista. Reintentar gastaria 5 llamadas PAGADAS por una direccion que
        // nunca va a resolver y contaminaria el dead-letter con ruido permanente.
        await this.ordenes.guardarResultado(ordenId, {
          latitud: null,
          longitud: null,
          precision: null,
          status: STATUS_SIN_RESULTADOS,
          geocodedAt: this.now(),
        });
        return;
      }
      case "consulta_invalida": {
        // R22: consulta malformada, determinista: reintentar no la mejora.
        await this.ordenes.guardarResultado(ordenId, {
          latitud: null,
          longitud: null,
          precision: null,
          status: STATUS_CONSULTA_INVALIDA,
          geocodedAt: this.now(),
        });
        return;
      }
      case "transitorio":
        // R23: cuota, error desconocido, 5xx o red -> falla RECUPERABLE, la cola aplica
        // su backoff. NO se escribe nada en la orden.
        throw new GeocodeIntentoFallidoError(outcome.detalle);
      case "config_invalida":
        // R24: credencial o facturacion rota. Ruidoso a proposito (Q3): preferimos una
        // cola de fallidos VISIBLE a jobs completados en silencio sin coordenadas.
        // R34 (maxIntentos 8) amortigua el caso hasta ~4 h de corte.
        //
        // FEATURE 400 (2026-09-09, R11/R16): error PROPIO y MARCADO, no el generico de
        // transitorio. Es el unico camino de este switch —junto con la credencial ausente,
        // arriba— en el que la direccion NO llego a consultarse: el fallo es nuestro, y el
        // gate de asignabilidad debe poder dejar pasar la asignacion por eso.
        this.logger.warn("[geocodificacion] el proveedor rechazo la peticion");
        throw new GeocodeConfigInvalidaError(outcome.detalle);
    }
  }
}
