import type { PostulacionRecursoConfig } from "@/lib/config/postulacion-recurso";
import type { IPostulacionRecursoRepository } from "@/lib/interfaces/repositories/IPostulacionRecursoRepository";
import type {
  IPurgaPostulacionRecursoService,
  PurgaPostulacionRecursoResultado,
} from "@/lib/interfaces/services/IPurgaPostulacionRecursoService";

/** Lector de configuracion inyectado; se invoca EN CADA corrida, nunca al construir. */
export type LeerPostulacionRecursoConfig = () => PostulacionRecursoConfig;

/**
 * Resta `meses` meses de calendario a `fecha`, en UTC, SIN desbordar al mes siguiente.
 *
 * Por que a mano y no `setUTCMonth` a secas: `new Date("2026-08-31").setUTCMonth(mes - 6)` da
 * el 3 de marzo, porque el 31 de febrero no existe y Postgres/JS lo empujan hacia adelante. Un
 * corte que se mueve HACIA ADELANTE en una purga significa borrar cosas mas nuevas de lo firmado.
 * Aqui el dia se ACOTA al ultimo del mes destino, que es el criterio conservador.
 *
 * Exportada para poder probarla sola: es la unica aritmetica de este archivo y decide que se borra.
 */
export function restarMesesUTC(fecha: Date, meses: number): Date {
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() - meses;
  const dia = fecha.getUTCDate();
  // Dia 0 del mes SIGUIENTE = ultimo dia del mes destino.
  const ultimoDiaDelMesDestino = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      anio,
      mes,
      Math.min(dia, ultimoDiaDelMesDestino),
      fecha.getUTCHours(),
      fecha.getUTCMinutes(),
      fecha.getUTCSeconds(),
      fecha.getUTCMilliseconds(),
    ),
  );
}

/**
 * Feature 253 (P2, FIRMADA EN CONTRA de la recomendacion del spec el 2026-08-21) — cron de purga
 * de las postulaciones de recurso YA ATENDIDAS.
 *
 * ⚠️ **ESTO BORRA, ES IRREVERSIBLE Y LO EJECUTA UN JOB DESATENDIDO.** No hay papelera, no hay
 * columna de borrado logico y no hay nadie mirando cuando corre. Por eso, lo que decide el borrado
 * cabe en una frase y esta escrito aqui y en el repositorio:
 *
 *   se borra una fila si —y solo si— `atendida_at` NO ES NULL y `atendida_at < now - N meses`.
 *
 * ⛔ `created_at` NO participa. Una postulacion SIN ATENDER no se borra JAMAS, por antigua que
 * sea: la antiguedad de la solicitud no es motivo para tirarla, y hacerlo destruiria justo lo que
 * nadie ha mirado todavia. `tests/integration/db/postulacion-recurso-migration.test.ts` lo
 * demuestra contra Postgres real con una fila pendiente de hace dos anos.
 *
 * No conoce HTTP ni Prisma: repositorio, lector de config y reloj entran por fuera.
 */
export class PurgaPostulacionRecursoService implements IPurgaPostulacionRecursoService {
  constructor(
    private readonly repo: IPostulacionRecursoRepository,
    private readonly leerConfig: LeerPostulacionRecursoConfig,
  ) {}

  async ejecutar(now: Date): Promise<PurgaPostulacionRecursoResultado> {
    // La configuracion se resuelve EN CADA CORRIDA: el proceso de una funcion serverless sobrevive
    // entre invocaciones, asi que congelarla al importar dejaria dos corridas con retencion
    // distinta usando la misma ventana. Mismo criterio que `loadPurgaPdfConfig` (feature 178).
    const cfg = this.leerConfig();
    const corte = restarMesesUTC(now, cfg.PURGA_RETENCION_MESES);
    const tope = cfg.PURGA_MAX_POR_CORRIDA;

    const borradas = await this.repo.purgarAtendidasAnterioresA(corte, tope);

    return {
      borradas,
      corte: corte.toISOString(),
      // Si la corrida agoto el tope, es que puede quedar historico por barrer. No se vuelve a
      // consultar la base para saberlo: una consulta extra por corrida para afinar un booleano
      // informativo no compensa, y la corrida de manana continua igual por donde quedo.
      quedaPendiente: borradas >= tope,
    };
  }
}
