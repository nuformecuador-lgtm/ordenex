// FICHA 401 (design §5.2) — LA REGLA de «la geocodificacion esta caida por configuracion
// NUESTRA», el aviso que sale de ella y la recuperacion de los jobs que murieron por esa causa.
//
// QUE ARREGLA, MEDIDO EN PRODUCCION. El 2026-09-08 el proveedor rechazo TODAS las peticiones
// durante 19 h 55 min: ninguna alerta se disparo, y cuando la credencial volvio los 25 jobs
// muertos NO se recuperaron solos — el leader entro a la base de produccion a resucitarlos a mano.
// El criterio de exito de esta ficha, en una frase: si el incidente se repite, nadie debe tener
// que abrir la base de datos.
//
// DI POR INTERFACES (`docs/architecture.md`): no conoce Next.js, ni Prisma, ni `fetch`. El
// notificador es parametro de constructor con DEFAULT NO-OP; el composition root
// (`lib/services/jobs/geocodificacion-handler.ts`) inyecta el real. Nunca al reves: en este repo
// la base local es COMPARTIDA, y un service construido en una suite sin cablear su notificador no
// puede permitirse escribir avisos.
//
// PRIVACIDAD (R26): este archivo NUNCA emite direccion, coordenadas, id de orden, guia ni
// credencial por el logger. Los mensajes son AGREGADOS y citan la operacion, nunca el dato.
import type { IGeocodeSaludRepository } from "@/lib/interfaces/repositories/IGeocodeSaludRepository";
import type { IGeocodeSaludService } from "@/lib/interfaces/services/IGeocodeSaludService";
import type { GeocodeSaludConfig } from "@/lib/config/geocode-salud";
import {
  notificadorNoOp,
  type GeocodificacionCaidaNotificador,
} from "@/lib/notificaciones/notificadores";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

/** Logger inyectable, mismo molde que `GeocodeLogger` de la 91. NUNCA recibe PII ni secretos. */
export interface GeocodeSaludLogger {
  warn(message: string): void;
}
const defaultLogger: GeocodeSaludLogger = { warn: () => {} };

const MS_POR_MINUTO = 60_000;

/**
 * R3 — LA REGLA, y es una funcion PURA a proposito: separar «que se cuenta» (el repositorio, con
 * su ventana ya aplicada en el `desde`) de «cuanto basta» (esto) es lo que la hace testeable sin
 * base de datos.
 *
 * La ventana NO entra aqui porque ya esta aplicada en la consulta. Meterla tambien en esta funcion
 * seria un segundo sitio donde equivocarse.
 */
export function hayCaida(jobsConMarcador: number, config: GeocodeSaludConfig): boolean {
  return jobsConMarcador >= config.GEOCODE_CAIDA_JOBS_MINIMOS;
}

export class GeocodeSaludService implements IGeocodeSaludService {
  constructor(
    private readonly repo: IGeocodeSaludRepository,
    private readonly config: GeocodeSaludConfig,
    private readonly notificar: GeocodificacionCaidaNotificador = notificadorNoOp,
    private readonly logger: GeocodeSaludLogger = defaultLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * R2/R3/R4/R7/R11 — un intento acaba de morir por configuracion propia.
   *
   * ⚠️ EL OFF-BY-ONE, EXPLICITO (design §5.3). El fallo del job EN CURSO todavia no esta
   * persistido —`fail()` corre despues, en `JobQueueService.manejarFallo`—, asi que la consulta lo
   * EXCLUYE y aqui se compara `otros + 1`. Sin esa exclusion el job en curso se contaria dos veces
   * (si trae marcador de un intento anterior) o cero (si es su primer fallo), y el umbral efectivo
   * bailaria entre 2 y 4 segun el intento.
   *
   * NUNCA LANZA (R11): el desenlace del job no puede depender de que el aviso salga. El notificador
   * ya es best-effort por construccion, y aun asi se envuelve — un doble que lance en una suite no
   * puede cambiar lo que hace la cola.
   */
  async registrarFalloConfig(jobId: string, ahora: Date): Promise<void> {
    try {
      const desde = new Date(ahora.getTime() - this.config.GEOCODE_CAIDA_VENTANA_MIN * MS_POR_MINUTO);
      const otros = await this.repo.contarFallosConfigDesde(desde, jobId);

      // R4: sin umbral no hay aviso. Un fallo de configuracion AISLADO no emite nada — el marcador
      // cubre tambien «falta la credencial», que aparece de forma legitima en un despliegue.
      if (!hayCaida(otros + 1, this.config)) return;

      await this.notificar({ afectados: otros + 1, diaCR: fechaCalendarioCR(ahora) });
      // Cifra AGREGADA y sin PII: cuantas direcciones, nunca cuales.
      this.logger.warn(
        `[geocodificacion] caida por configuracion detectada: ${otros + 1} job(s) afectado(s)`,
      );
    } catch (error) {
      // NO es un `catch` vacio (`docs/conventions.md`): queda registrado con la operacion y su
      // causa. Y no se propaga: el intento fallido debe seguir tratandose EXACTAMENTE como hoy.
      //
      // R26 — por que se puede registrar el mensaje del error sin filtrar secretos: los UNICOS
      // colaboradores de este service son el repositorio de `jobs`, cinco numeros de
      // configuracion, un notificador y este logger. NINGUNO ve la credencial del proveedor
      // (`GOOGLE_MAPS_API_KEY` vive en `GeocodeConfig`, que este archivo ni importa), asi que no
      // hay camino por el que pueda llegar hasta aqui.
      this.logger.warn(
        `[geocodificacion] la evaluacion de la caida fallo (best-effort): ${mensajeDe(error)}`,
      );
    }
  }

  /**
   * R13/R19/R21/R22/R24 — el proveedor respondio bien DE VERDAD: se devuelven a la cola hasta
   * `LOTE` jobs muertos por configuracion, los mas antiguos primero y escalonados.
   *
   * Los tres numeros que pasa son las tres defensas de design §6:
   *   · `limite`       — R21, techo por respuesta satisfactoria (nunca «todos de golpe»);
   *   · `espaciadoMs`  — R22, el intervalo del cron, para que como mucho UNO de la tanda sea
   *                     reclamable en cada corrida de 10 y los otros ocho tipos conserven su turno;
   *   · `tocadoAntesDe`— R24, el enfriamiento, para que un proveedor intermitente no pueda hacer
   *                     reintentar un mismo job sin fin.
   *
   * Devuelve cuantos revivio. Quien lo llama lo hace dentro de un `try/catch` (R20): una
   * recuperacion caida NO puede revertir una geocodificacion buena que ya esta escrita.
   */
  async registrarExitoProveedor(ahora: Date): Promise<number> {
    const n = await this.repo.revivirFallosConfig({
      ahora,
      limite: this.config.GEOCODE_RECUPERACION_LOTE,
      espaciadoMs: this.config.GEOCODE_RECUPERACION_ESPACIADO_MS,
      tocadoAntesDe: new Date(
        ahora.getTime() - this.config.GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN * MS_POR_MINUTO,
      ),
    });
    if (n > 0) {
      // La unica huella forense de la recuperacion (design §8-A10: no se emite un aviso de «se
      // recupero»; un aviso de buenas noticias en la misma campana que las alertas la degrada).
      this.logger.warn(`[geocodificacion] recuperados ${n} job(s) muertos por configuracion`);
    }
    return n;
  }
}

/** Mensaje de un error desconocido, sin arrastrar el objeto entero al log. */
function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
