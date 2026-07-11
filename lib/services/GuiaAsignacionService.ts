// Feature 17 — Orquesta "Generar guia" (R18-R25/R27-R29) y "asignar desde
// bodega" (R26-R29). Servicio dedicado, separado de OrdenService (CRUD): guarda
// por estado de origen + secuencia de num_guia + transaccion por lote no encajan
// en el `actualizar` generico (design.md, alternativa D descartada).
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AsignarBodegaInput,
  AsignarBodegaResultadoItem,
  AsignarBodegaServiceResult,
  DetalleConflicto,
  GenerarGuiaInput,
  GenerarGuiaServiceResult,
  IGuiaAsignacionService,
} from "@/lib/interfaces/services/IGuiaAsignacionService";

// R27: unicos estados de origen validos para "Generar guia".
const ORIGEN_GENERAR_GUIA = new Set(["en_fulfillment", "en_preparacion"]);
// R27: unico estado de origen valido para "asignar desde bodega".
const ORIGEN_BODEGA = "en_bodega";

const ESTATUS_EN_ESPERA_ACEPTACION = "en_espera_aceptacion"; // R21/R22/R26
const ESTATUS_EN_BODEGA = "en_bodega"; // R23

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

export class GuiaAsignacionService implements IGuiaAsignacionService {
  constructor(private readonly repo: IOrdenRepository) {}

  async generarGuia(input: GenerarGuiaInput, actor: Actor): Promise<GenerarGuiaServiceResult> {
    // --- Autorizacion (R11-R13), antes de tocar datos ---
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const { decisiones } = input;
    if (decisiones.length === 0) return { status: "ok", resultados: [] };

    const ordenIds = distinct(decisiones.map((d) => d.ordenId));
    const mensajeroIds = distinct(
      decisiones.map((d) => d.mensajeroId).filter((id): id is string => id !== null),
    );

    // --- Precarga (R28: SIN filtro de zona) ---
    const [ordenes, mensajerosValidos] = await Promise.all([
      this.repo.findByIdsForTransicion(ordenIds),
      this.repo.findMensajeroIdsValidos(mensajeroIds),
    ]);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    // --- Validacion por orden (R27/R28); fallo -> ABORTA sin efectos (R25/R29) ---
    const detalle: DetalleConflicto[] = [];
    for (const d of decisiones) {
      const orden = ordenMap.get(d.ordenId);
      if (!orden) {
        detalle.push({ ordenId: d.ordenId, motivo: "orden no existe" });
        continue;
      }
      if (orden.deletedAt !== null) {
        detalle.push({ ordenId: d.ordenId, motivo: "orden borrada" });
        continue;
      }
      if (!ORIGEN_GENERAR_GUIA.has(orden.estatusValue)) {
        detalle.push({
          ordenId: d.ordenId,
          motivo: `estado de origen no permitido: ${orden.estatusValue}`,
        });
        continue;
      }
      if (d.mensajeroId !== null && !mensajerosValidos.has(d.mensajeroId)) {
        detalle.push({ ordenId: d.ordenId, motivo: "mensajeroId no valido" });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle };

    // --- Resolver estatus destino por value (guarda defensiva si falta el seed) ---
    const [estatusEsperaId, estatusBodegaId] = await Promise.all([
      this.repo.findEstatusIdByValue(ESTATUS_EN_ESPERA_ACEPTACION),
      this.repo.findEstatusIdByValue(ESTATUS_EN_BODEGA),
    ]);
    if (estatusEsperaId === null || estatusBodegaId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // --- Persistencia transaccional (R25): TODAS reciben num_guia (R19) ---
    const resultadosRaw = await this.repo.generarGuiaLote(
      decisiones.map((d) => ({
        ordenId: d.ordenId,
        estatusId: d.mensajeroId !== null ? estatusEsperaId : estatusBodegaId,
        mensajeroAsignadoId: d.mensajeroId,
      })),
    );
    const numGuiaByOrden = new Map(resultadosRaw.map((r) => [r.ordenId, r.numGuia]));

    const resultados = decisiones.map((d) => ({
      ordenId: d.ordenId,
      numGuia: numGuiaByOrden.get(d.ordenId) as number, // presente: toda decision valida paso por generarGuiaLote
      estado: d.mensajeroId !== null ? ESTATUS_EN_ESPERA_ACEPTACION : ESTATUS_EN_BODEGA,
    }));

    return { status: "ok", resultados };
  }

  async asignarDesdeBodega(
    input: AsignarBodegaInput,
    actor: Actor,
  ): Promise<AsignarBodegaServiceResult> {
    // --- Autorizacion (R11-R13) ---
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", resultados: [] };

    // --- R28: mensajeroId debe corresponder a un usuario con rol mensajero ---
    const mensajerosValidos = await this.repo.findMensajeroIdsValidos([input.mensajeroId]);
    if (!mensajerosValidos.has(input.mensajeroId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["mensajeroId no valido"] },
      };
    }

    // --- Validacion por orden (R27): origen unico permitido = en_bodega ---
    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    const detalle: DetalleConflicto[] = [];
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (!orden) {
        detalle.push({ ordenId: id, motivo: "orden no existe" });
        continue;
      }
      if (orden.deletedAt !== null) {
        detalle.push({ ordenId: id, motivo: "orden borrada" });
        continue;
      }
      if (orden.estatusValue !== ORIGEN_BODEGA) {
        detalle.push({
          ordenId: id,
          motivo: `estado de origen no permitido: ${orden.estatusValue}`,
        });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R29: aborta sin efectos

    const estatusEsperaId = await this.repo.findEstatusIdByValue(ESTATUS_EN_ESPERA_ACEPTACION);
    if (estatusEsperaId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // R26/R5: NO reasigna num_guia, ya lo tienen de "Generar guia".
    await this.repo.asignarBodegaLote(ordenIds, input.mensajeroId, estatusEsperaId);

    const resultados: AsignarBodegaResultadoItem[] = ordenIds.map((ordenId) => ({
      ordenId,
      estado: ESTATUS_EN_ESPERA_ACEPTACION,
    }));
    return { status: "ok", resultados };
  }
}
