import type { ILiberacionReprogramadaRepository } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  ILiberacionReprogramadaService,
  LiberacionResult,
} from "@/lib/interfaces/services/ILiberacionReprogramadaService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";

// Estatus destino de la liberacion segun la bodega responsable (F1.4-a). Valores de
// catalogo ya sembrados (ORDER_STATUS_SEED); esta feature NO agrega estados.
const ESTATUS_EN_BODEGA = "en_bodega_central"; // central
const ESTATUS_EN_BODEGA_SATELITE = "en_bodega_satelite"; // satelite
const ESTATUS_REPROGRAMADA = "reprogramada"; // origen (guarda de idempotencia)

// Metodos de repo consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
type OrdenRepo = Pick<IOrdenRepository, "findEstatusIdByValue">;

// Log de aviso inyectable: por defecto console.warn. NUNCA registra PII/secretos (R19):
// solo conteos agregados.
export interface LiberacionLogger {
  warn(message: string): void;
}
const defaultLogger: LiberacionLogger = { warn: (m) => console.warn(m) };

/**
 * Feature 46 — logica de negocio de la liberacion programada (R12-R14/R17). Por cada
 * orden reprogramada cuya fecha ya llego (`hoyCR`), deriva su bodega responsable
 * (`resolverDestinoCierre`, reusa la regla 41/37) y la transiciona a `en_bodega_central` /
 * `en_bodega_satelite` limpiando el mensajero y marcando la liberacion. Resiliente por
 * orden (patron `CorteDiarioService`) e idempotente (la transicion saca la orden de
 * `reprogramada`, R17). No conoce HTTP ni Prisma directo; testeable con dobles.
 */
export class LiberacionReprogramadaService implements ILiberacionReprogramadaService {
  constructor(
    private readonly repo: ILiberacionReprogramadaRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly logger: LiberacionLogger = defaultLogger,
  ) {}

  async ejecutarLiberacion(hoyCR: Date): Promise<LiberacionResult> {
    // R12: la clasificacion a central usa la zona central (o null: todo cae a satelite,
    // fallback seguro de `resolverDestinoCierre`).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();

    // Resuelve los estatus una sola vez (no por orden). Guarda si falta el seed.
    const [estatusReprogramadaId, estatusBodegaId, estatusBodegaSateliteId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTATUS_REPROGRAMADA),
      this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_BODEGA),
      this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_BODEGA_SATELITE),
    ]);
    if (
      estatusReprogramadaId === null ||
      estatusBodegaId === null ||
      estatusBodegaSateliteId === null
    ) {
      // Catalogo incompleto: no se libera nada (resultado controlado, no crash). Aviso
      // agregado sin PII (R19).
      this.logger.warn(
        "[liberar-reprogramadas] catalogo de estados incompleto (seed pendiente); no se libera",
      );
      return { evaluadas: 0, liberadas: 0, omitidas: 0 };
    }

    // R10: candidatas (reprogramadas, no borradas, fecha <= hoy CR).
    const ordenes = await this.repo.findOrdenesLiberables(hoyCR);
    // R13: una marca unica para toda la corrida.
    const corridaAt = new Date();

    let liberadas = 0;
    let omitidas = 0;

    for (const orden of ordenes) {
      try {
        // R12: bodega responsable derivada de la zona (misma regla que el corte 41).
        const { destinoTipo } = resolverDestinoCierre(orden.zonaId, centralZonaId);
        const destinoEstatusId =
          destinoTipo === "bodega_central" ? estatusBodegaId : estatusBodegaSateliteId;

        const ok = await this.repo.liberarOrden({
          ordenId: orden.id,
          destinoEstatusId,
          estatusReprogramadaId,
          corridaAt,
        });
        // R17: false = ya salio de `reprogramada` entre la lectura y la escritura
        // (carrera/idempotencia) -> se omite, no es fallo.
        if (ok) liberadas += 1;
        else omitidas += 1;
      } catch {
        // R14: un fallo por orden no aborta la corrida; se contabiliza y se continua.
        omitidas += 1;
      }
    }

    if (omitidas > 0) {
      this.logger.warn(`[liberar-reprogramadas] ${omitidas} orden(es) no liberada(s) en esta corrida`);
    }

    return { evaluadas: ordenes.length, liberadas, omitidas };
  }
}
