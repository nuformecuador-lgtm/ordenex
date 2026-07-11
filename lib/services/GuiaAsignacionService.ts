// Feature 17 — Orquesta "Generar guia" (R18-R25/R27-R29) y "asignar desde
// bodega" (R26-R29). Servicio dedicado, separado de OrdenService (CRUD): guarda
// por estado de origen + secuencia de num_guia + transaccion por lote no encajan
// en el `actualizar` generico (design.md, alternativa D descartada).
// Feature 30 — extiende el cuerpo (no las firmas, R18): resuelve la zona GAM
// (guardia R4), clasifica cada orden GAM/no-GAM por `zonaId === gamZonaId`, valida
// el mensajero contra la zona GAM (R6), rechaza mensajero en ordenes no-GAM (R8),
// rutea las no-GAM a `en_ruta_bodega_satelite` con num_guia (R9/R10/R11) y agrega
// la accion dedicada `rutearABodegaSatelite` (R13). Inyecta `IZonaRepository`.
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AsignarBodegaInput,
  AsignarBodegaResultadoItem,
  AsignarBodegaServiceResult,
  DetalleConflicto,
  GenerarGuiaInput,
  GenerarGuiaServiceResult,
  IGuiaAsignacionService,
  RutearSateliteInput,
  RutearSateliteResultadoItem,
  RutearSateliteServiceResult,
} from "@/lib/interfaces/services/IGuiaAsignacionService";

// R27: unicos estados de origen validos para "Generar guia".
const ORIGEN_GENERAR_GUIA = new Set(["en_fulfillment", "en_preparacion"]);
// R27: unico estado de origen valido para "asignar desde bodega".
const ORIGEN_BODEGA = "en_bodega";
// Feature 30/R13 (decision (d)): origenes validos para rutear a satelite.
const ORIGEN_RUTEO_SATELITE = new Set(["en_fulfillment", "en_preparacion", "en_bodega"]);

const ESTATUS_EN_ESPERA_ACEPTACION = "en_espera_aceptacion"; // R21/R22/R26
const ESTATUS_EN_BODEGA = "en_bodega"; // R23
const ESTATUS_EN_RUTA_BODEGA_SATELITE = "en_ruta_bodega_satelite"; // feature 30/R9

// Feature 30/R4: mensaje del guardia de zona GAM no configurada (accionable, sin
// filtrar internals: convenciones de manejo de errores).
const GAM_NO_CONFIGURADA: Record<string, string[]> = {
  zona: ["zona GAM no configurada"],
};

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

export class GuiaAsignacionService implements IGuiaAsignacionService {
  constructor(
    private readonly repo: IOrdenRepository,
    private readonly zonaRepo: IZonaRepository,
  ) {}

  async generarGuia(input: GenerarGuiaInput, actor: Actor): Promise<GenerarGuiaServiceResult> {
    // --- Autorizacion (R11-R13/R16), antes de tocar datos ---
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const { decisiones } = input;
    if (decisiones.length === 0) return { status: "ok", resultados: [] };

    // --- Guardia R4: la zona GAM debe estar configurada ---
    const gamZonaId = await this.zonaRepo.findGamZonaId();
    if (gamZonaId === null) {
      return { status: "validation_error", fieldErrors: GAM_NO_CONFIGURADA };
    }

    const ordenIds = distinct(decisiones.map((d) => d.ordenId));
    const mensajeroIds = distinct(
      decisiones.map((d) => d.mensajeroId).filter((id): id is string => id !== null),
    );

    // --- Precarga: ordenes (con zona/GAM) + mensajeros validos de la zona GAM (R6) ---
    const [ordenes, mensajerosValidos] = await Promise.all([
      this.repo.findByIdsForTransicion(ordenIds),
      this.repo.findMensajeroIdsValidosByZona(mensajeroIds, gamZonaId),
    ]);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    // --- Validacion por orden (R27/R6/R8); fallo -> ABORTA sin efectos (R11/R17) ---
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
      const esGam = orden.zonaId === gamZonaId;
      if (esGam) {
        // R6: mensajero (sugerido confirmado u override) debe ser de la zona GAM.
        if (d.mensajeroId !== null && !mensajerosValidos.has(d.mensajeroId)) {
          detalle.push({ ordenId: d.ordenId, motivo: "mensajeroId no valido (no GAM)" });
        }
      } else {
        // R8: una orden no-GAM NO puede recibir mensajero; su unica transicion es
        // el ruteo a satelite (mensajeroId debe venir null).
        if (d.mensajeroId !== null) {
          detalle.push({
            ordenId: d.ordenId,
            motivo: "no se puede asignar mensajero a orden de zona no-GAM",
          });
        }
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle };

    // --- Resolver estatus destino por value (guarda defensiva si falta el seed) ---
    const hayNoGam = decisiones.some((d) => {
      const orden = ordenMap.get(d.ordenId);
      return orden !== undefined && orden.zonaId !== gamZonaId;
    });
    const [estatusEsperaId, estatusBodegaId, estatusRutaSateliteId] = await Promise.all([
      this.repo.findEstatusIdByValue(ESTATUS_EN_ESPERA_ACEPTACION),
      this.repo.findEstatusIdByValue(ESTATUS_EN_BODEGA),
      this.repo.findEstatusIdByValue(ESTATUS_EN_RUTA_BODEGA_SATELITE),
    ]);
    if (
      estatusEsperaId === null ||
      estatusBodegaId === null ||
      (hayNoGam && estatusRutaSateliteId === null)
    ) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // --- Construir decisiones del lote: GAM por regla 17, no-GAM a satelite (R11) ---
    function estatusDestino(ordenId: string, mensajeroId: string | null): {
      estatusId: string;
      mensajeroAsignadoId: string | null;
      estado: string;
    } {
      const orden = ordenMap.get(ordenId);
      const esGam = orden !== undefined && orden.zonaId === gamZonaId;
      if (!esGam) {
        // R9/R10: no-GAM -> en_ruta_bodega_satelite, sin mensajero, con num_guia.
        return {
          estatusId: estatusRutaSateliteId as string,
          mensajeroAsignadoId: null,
          estado: ESTATUS_EN_RUTA_BODEGA_SATELITE,
        };
      }
      if (mensajeroId !== null) {
        return {
          estatusId: estatusEsperaId as string,
          mensajeroAsignadoId: mensajeroId,
          estado: ESTATUS_EN_ESPERA_ACEPTACION,
        };
      }
      return {
        estatusId: estatusBodegaId as string,
        mensajeroAsignadoId: null,
        estado: ESTATUS_EN_BODEGA,
      };
    }

    // --- Persistencia transaccional (R11/R17): TODAS reciben num_guia (R10/R19) ---
    const resultadosRaw = await this.repo.generarGuiaLote(
      decisiones.map((d) => {
        const destino = estatusDestino(d.ordenId, d.mensajeroId);
        return {
          ordenId: d.ordenId,
          estatusId: destino.estatusId,
          mensajeroAsignadoId: destino.mensajeroAsignadoId,
        };
      }),
    );
    const numGuiaByOrden = new Map(resultadosRaw.map((r) => [r.ordenId, r.numGuia]));

    const resultados = decisiones.map((d) => ({
      ordenId: d.ordenId,
      numGuia: numGuiaByOrden.get(d.ordenId) as number, // presente: paso por generarGuiaLote
      estado: estatusDestino(d.ordenId, d.mensajeroId).estado,
    }));

    return { status: "ok", resultados };
  }

  async asignarDesdeBodega(
    input: AsignarBodegaInput,
    actor: Actor,
  ): Promise<AsignarBodegaServiceResult> {
    // --- Autorizacion (R11-R13/R16) ---
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", resultados: [] };

    // --- Guardia R4 ---
    const gamZonaId = await this.zonaRepo.findGamZonaId();
    if (gamZonaId === null) {
      return { status: "validation_error", fieldErrors: GAM_NO_CONFIGURADA };
    }

    // --- R6: mensajeroId debe ser un usuario rol mensajero de la zona GAM ---
    const mensajerosValidos = await this.repo.findMensajeroIdsValidosByZona(
      [input.mensajeroId],
      gamZonaId,
    );
    if (!mensajerosValidos.has(input.mensajeroId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["mensajeroId no valido"] },
      };
    }

    // --- Validacion por orden (R27): origen en_bodega + zona GAM (R12) ---
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
        continue;
      }
      // R12: por construccion en_bodega solo tiene ordenes GAM, pero se valida.
      if (orden.zonaId !== gamZonaId) {
        detalle.push({ ordenId: id, motivo: "orden de zona no-GAM" });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R29/R17: aborta sin efectos

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

  async rutearABodegaSatelite(
    input: RutearSateliteInput,
    actor: Actor,
  ): Promise<RutearSateliteServiceResult> {
    // --- Autorizacion (R16) ---
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", resultados: [] };

    // --- Guardia R4 ---
    const gamZonaId = await this.zonaRepo.findGamZonaId();
    if (gamZonaId === null) {
      return { status: "validation_error", fieldErrors: GAM_NO_CONFIGURADA };
    }

    // --- Validacion por orden (R17): existe, no borrada, origen permitido, no-GAM ---
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
      if (!ORIGEN_RUTEO_SATELITE.has(orden.estatusValue)) {
        detalle.push({
          ordenId: id,
          motivo: `estado de origen no permitido: ${orden.estatusValue}`,
        });
        continue;
      }
      // Solo no-GAM: una orden GAM aqui es un error del maestro.
      if (orden.zonaId === gamZonaId) {
        detalle.push({ ordenId: id, motivo: "orden GAM no se rutea a satelite" });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R17: aborta sin efectos

    const estatusRutaSateliteId = await this.repo.findEstatusIdByValue(
      ESTATUS_EN_RUTA_BODEGA_SATELITE,
    );
    if (estatusRutaSateliteId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // R10: num_guia idempotente + estado + mensajero NULL (transaccional).
    await this.repo.rutearBodegaSateliteLote(ordenIds, estatusRutaSateliteId);

    const resultados: RutearSateliteResultadoItem[] = ordenIds.map((ordenId) => ({
      ordenId,
      estado: ESTATUS_EN_RUTA_BODEGA_SATELITE,
    }));
    return { status: "ok", resultados };
  }
}
