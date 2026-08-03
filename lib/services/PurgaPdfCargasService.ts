import type { PurgaPdfConfig } from "@/lib/config/purga-pdf";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { IPurgaPdfCargasRepository } from "@/lib/interfaces/repositories/IPurgaPdfCargasRepository";
import type {
  IPurgaPdfCargasService,
  PurgaResultado,
} from "@/lib/interfaces/services/IPurgaPdfCargasService";

/** Milisegundos de un dia; la ventana de retencion se mide en dias exactos. */
const DIA_MS = 24 * 60 * 60 * 1000;

/** Lector de configuracion inyectado; se invoca EN CADA corrida (R4), nunca al construir. */
export type LeerPurgaPdfConfig = () => PurgaPdfConfig;

/**
 * Feature 178 (design §4.3, R4/R5/R10/R12/R19/R20/R21/R22/R24) — logica de negocio del cron diario
 * de purga de los PDF de etiquetas de cargas antiguas. Agrupa por `carga_id` (R7): la carga y
 * TODAS sus ordenes se resuelven como una sola unidad. No conoce HTTP ni Prisma: repositorio,
 * Storage y lector de config entran por constructor, asi que se prueba con dobles sin DB ni red.
 *
 * ORDEN Y POLITICA DE FALLO (decision (b) de la puerta F1.4, design §6): `storage.remove` va
 * SIEMPRE ANTES de `repo.limpiarReferencias`. Si `remove` no lanza, se limpia SIEMPRE (borrado
 * best-effort). Si `remove` LANZA, esa carga NO se limpia, el error SE PROPAGA y la corrida
 * termina en codigo de error (R23): NO hay reintento interno, ni backoff, ni bucle de espera. La
 * recuperacion es la corrida del dia siguiente (R19), porque esa carga conserva su referencia viva
 * y sigue siendo candidata; `remove` es idempotente sobre paths inexistentes por contrato de
 * `IFileStorage`.
 *
 * `objetosBorrados` significa **"rutas ENVIADAS a borrar"**, NO "confirmadas": medido en
 * `lib/storage/SupabaseFileStorage.ts` — `remove` DESCARTA el `{ error }` que devuelve el SDK e
 * `IFileStorage.remove` devuelve `Promise<void>`, asi que el service no puede distinguir un
 * borrado correcto de uno fallido. Ampliar `IFileStorage` quedo fuera de alcance por decision del
 * humano. Nadie debe leer ese conteo como una garantia de espacio liberado.
 */
export class PurgaPdfCargasService implements IPurgaPdfCargasService {
  constructor(
    private readonly repo: IPurgaPdfCargasRepository,
    /** Ya construido CON el bucket de etiquetas por el composition root de la ruta (R11). */
    private readonly storage: IFileStorage,
    private readonly leerConfig: LeerPurgaPdfConfig,
  ) {}

  async ejecutar(now: Date): Promise<PurgaResultado> {
    // R4: la configuracion se resuelve EN CADA CORRIDA. El proceso de una funcion serverless
    // sobrevive entre invocaciones: congelarla aqui haria que dos corridas con configuracion
    // distinta usasen la misma ventana.
    const cfg = this.leerConfig();
    // R5: corte INCLUSIVO `now - N dias` (decision (f)). Con N = 0 el corte ES `now`, asi que
    // entra tambien lo creado ese mismo dia (consecuencia declarada en `requirements.md`).
    const corte = new Date(now.getTime() - cfg.PURGA_PDF_RETENCION_DIAS * DIA_MS);
    const tope = cfg.PURGA_PDF_MAX_CARGAS_POR_CORRIDA; // R21

    // R7/R8/R9: unidades de purga (carga + rutas de TODAS sus ordenes, incluidas las borradas),
    // solo con referencia viva y solo por debajo del corte. Las ordenes con `carga_id` NULL no
    // aparecen aqui por construccion de la agrupacion (R17).
    const candidatas = await this.repo.findCargasPurgables(corte, tope);

    let cargasPurgadas = 0;
    let ordenesAfectadas = 0;
    let objetosBorrados = 0;

    // SECUENCIAL a proposito (design §4.3): el borrado ya va agrupado por carga en una sola
    // llamada a `remove`, y paralelizar multiplicaria la presion sobre Storage y sobre el pool de
    // Prisma dentro de una funcion con `maxDuration` acotado.
    for (const candidata of candidatas) {
      const paths = [candidata.cargaPath, ...candidata.ordenPaths].filter(
        (path): path is string => path !== null && path !== undefined,
      );

      // R10/R12: UNA sola llamada por carga con el consolidado + todas las individuales; con cero
      // rutas NO se invoca a Storage, ni siquiera con una lista vacia.
      if (paths.length > 0) {
        await this.storage.remove(paths);
        objetosBorrados += paths.length;
      }

      // R13/R14/R15: solo despues de que `remove` no haya lanzado (design §6).
      const { ordenesActualizadas } = await this.repo.limpiarReferencias(candidata.cargaId);
      ordenesAfectadas += ordenesActualizadas;
      cargasPurgadas += 1;
    }

    // R22: se declara el pendiente en vez de encolar una continuacion; lo retoma la corrida del
    // dia siguiente (orden `created_at` ASC: siempre lo mas viejo primero).
    const quedaPendiente = await this.repo.quedanCargasPurgables(corte, tope);

    // R24: resumen SOLO numerico, sin PII ni rutas ni ids.
    return { cargasPurgadas, ordenesAfectadas, objetosBorrados, quedaPendiente };
  }
}
