// Feature 17 — Orquesta "Generar guia" (R18-R25/R27-R29) y "asignar desde
// bodega" (R26-R29). Servicio dedicado, separado de OrdenService (CRUD): guarda
// por estado de origen + secuencia de num_guia + transaccion por lote no encajan
// en el `actualizar` generico (design.md, alternativa D descartada).
// Feature 30 — extiende el cuerpo (no las firmas, R18): resuelve la zona GAM
// (guardia R4), clasifica cada orden GAM/no-GAM por `zonaId === centralZonaId`, valida
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
import { MSG_ORDEN_REPROGRAMADA_BLOQUEADA } from "@/lib/services/mensajes-bloqueo";
import type { IAsignabilidadCoordenadasService } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import { esAsignable, motivoAsignabilidad } from "@/lib/services/AsignabilidadCoordenadasService";

// R27: unicos estados de origen validos para "Generar guia".
const ORIGEN_GENERAR_GUIA = new Set(["en_fulfillment", "en_preparacion"]);
// R27: unico estado de origen valido para "asignar desde bodega".
const ORIGEN_BODEGA = "en_bodega";
// Feature 30/R13 (decision (d)): origenes validos para rutear a satelite.
const ORIGEN_RUTEO_SATELITE = new Set(["en_fulfillment", "en_preparacion", "en_bodega"]);

// Feature 46/R2: estatus bloqueado por reprogramacion (guardia explicito y tipado).
const ESTATUS_REPROGRAMADA = "reprogramada";

const ESTATUS_EN_ESPERA_ACEPTACION = "en_espera_aceptacion"; // R21/R22/R26
const ESTATUS_EN_BODEGA = "en_bodega"; // R23
const ESTATUS_EN_RUTA_BODEGA_SATELITE = "en_ruta_bodega_satelite"; // feature 30/R9

// Feature 30/R4: mensaje del guardia de zona GAM no configurada (accionable, sin
// filtrar internals: convenciones de manejo de errores).
const GAM_NO_CONFIGURADA: Record<string, string[]> = {
  zona: ["zona GAM no configurada"],
};

// Feature 41/R13: motivo accionable cuando un mensajero destino esta bloqueado por un
// cierre pendiente (solicitado/vencido). No se le asignan nuevas ordenes hasta resolverlo.
const MSG_MENSAJERO_BLOQUEADO = "mensajero bloqueado por cierre pendiente";

// Ajuste maestro: motivo cuando una orden se rutearia a una bodega satelite que tiene al
// menos un mensajero con un cierre abierto. Con un cierre pendiente la bodega esta
// cuadrando caja: no recibe ordenes nuevas hasta resolverlo.
const MSG_BODEGA_SATELITE_BLOQUEADA =
  "bodega satelite bloqueada: tiene un mensajero con un cierre abierto";

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

export class GuiaAsignacionService implements IGuiaAsignacionService {
  constructor(
    private readonly repo: IOrdenRepository,
    private readonly zonaRepo: IZonaRepository,
    // Feature 92 (R8): gate de asignabilidad por coordenadas. Dep NUEVA al final, patron
    // de las features 30/41/47. Es REQUERIDA a proposito: si fuera opcional, olvidarla en
    // una fabrica nueva desactivaria el gate en silencio y volveria a entrar a la ruta una
    // orden sin coordenadas, que es exactamente lo que esta feature existe para impedir.
    private readonly asignabilidad: IAsignabilidadCoordenadasService,
  ) {}

  /**
   * Feature 92 (R8) — guarda comun de los DOS writers de `mensajero_asignado_id` de este
   * service. Devuelve el `detalle` de las ordenes NO asignables (vacio si todas lo son).
   *
   * TODO-O-NADA POR LOTE: es el contrato ya vigente de estos services (una sola orden
   * conflictiva aborta el lote entero sin efectos), no se cambia aqui.
   *
   * Solo se evaluan las ordenes que REALMENTE reciben mensajero: una orden no-GAM que se
   * rutea a satelite no se asigna a nadie, asi que su falta de coordenadas no bloquea nada
   * todavia (se le exigiran cuando la bodega satelite la asigne, via
   * `AsignacionSateliteService`).
   */
  private async gateCoordenadas(ordenIds: string[]): Promise<DetalleConflicto[]> {
    if (ordenIds.length === 0) return [];
    const filas = await this.repo.findParaAsignabilidad(ordenIds);
    const estados = await this.asignabilidad.evaluar(filas);
    const detalle: DetalleConflicto[] = [];
    for (const ordenId of ordenIds) {
      const estado = estados.get(ordenId);
      if (esAsignable(estado)) continue;
      // `estado` indefinido = la orden no existe (el gate devuelve una entrada por cada
      // fila recibida). No deberia pasar aqui —las guardas de existencia corren antes—,
      // pero se trata como NO asignable: nunca se deja pasar por omision.
      detalle.push({
        ordenId,
        motivo: estado === undefined ? "orden no existe" : motivoAsignabilidad(estado),
      });
    }
    return detalle;
  }

  /**
   * Ajuste maestro: de `zonaIds` (zonas destino satelite), devuelve las que estan
   * BLOQUEADAS para recibir nuevas ordenes porque AL MENOS 1 de sus mensajeros tiene un
   * cierre abierto (`solicitado`/`vencido`): con un cierre pendiente la bodega esta
   * cuadrando caja y no recibe ordenes nuevas hasta resolverlo. Una zona sin mensajeros
   * NO se bloquea (no hay cierre que resolver). Misma regla que el gate de seleccion del
   * maestro y que `existeBodegaSateliteBloqueada`, para que no diverjan.
   * Reutiliza primitivas de repo existentes (sin ampliar la interfaz):
   * `findMensajerosByZona` + `findMensajerosBloqueados` por zona.
   */
  private async zonasSateliteBloqueadas(zonaIds: string[]): Promise<Set<string>> {
    const zonasUnicas = distinct(zonaIds);
    if (zonasUnicas.length === 0) return new Set();
    const bloqueadas = new Set<string>();
    await Promise.all(
      zonasUnicas.map(async (zonaId) => {
        const mensajeros = await this.repo.findMensajerosByZona(zonaId);
        if (mensajeros.length === 0) return;
        const bloqueados = await this.repo.findMensajerosBloqueados(
          mensajeros.map((m) => m.id),
        );
        if (bloqueados.size > 0) bloqueadas.add(zonaId);
      }),
    );
    return bloqueadas;
  }

  async generarGuia(input: GenerarGuiaInput, actor: Actor): Promise<GenerarGuiaServiceResult> {
    // --- Autorizacion (R11-R13/R16), antes de tocar datos ---
    if (actor.rol !== "maestro") return { status: "forbidden" };

    const { decisiones } = input;
    if (decisiones.length === 0) return { status: "ok", resultados: [] };

    // --- Guardia R4: la zona GAM debe estar configurada ---
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    if (centralZonaId === null) {
      return { status: "validation_error", fieldErrors: GAM_NO_CONFIGURADA };
    }

    const ordenIds = distinct(decisiones.map((d) => d.ordenId));
    const mensajeroIds = distinct(
      decisiones.map((d) => d.mensajeroId).filter((id): id is string => id !== null),
    );

    // --- Precarga: ordenes (con zona/GAM) + mensajeros validos de la zona GAM (R6) ---
    const [ordenes, mensajerosValidos] = await Promise.all([
      this.repo.findByIdsForTransicion(ordenIds),
      this.repo.findMensajeroIdsValidosByZona(mensajeroIds, centralZonaId),
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
      // Feature 46/R2: orden reprogramada -> bloqueada hasta su fecha; motivo tipado.
      if (orden.estatusValue === ESTATUS_REPROGRAMADA) {
        detalle.push({ ordenId: d.ordenId, motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA });
        continue;
      }
      if (!ORIGEN_GENERAR_GUIA.has(orden.estatusValue)) {
        detalle.push({
          ordenId: d.ordenId,
          motivo: `estado de origen no permitido: ${orden.estatusValue}`,
        });
        continue;
      }
      const esGam = orden.zonaId === centralZonaId;
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

    // --- Feature 41/R13/R23: guarda de mensajero bloqueado, ANTES de persistir ---
    // Un mensajero con cierre `solicitado`/`vencido` no recibe nuevas asignaciones. El
    // ruteo a satelite (ordenes sin mensajero) NO se bloquea (no asigna mensajero).
    const bloqueados = await this.repo.findMensajerosBloqueados(mensajeroIds);
    if (bloqueados.size > 0) {
      const detalleBloqueo: DetalleConflicto[] = [];
      for (const d of decisiones) {
        if (d.mensajeroId !== null && bloqueados.has(d.mensajeroId)) {
          detalleBloqueo.push({ ordenId: d.ordenId, motivo: MSG_MENSAJERO_BLOQUEADO });
        }
      }
      if (detalleBloqueo.length > 0) return { status: "conflict", detalle: detalleBloqueo };
    }

    // --- Ajuste maestro: no se puede rutear a una bodega satelite cuyos mensajeros
    // esten TODOS en cierre. Aplica a las ordenes NO-GAM del lote (destino satelite). ---
    const zonasNoGam = new Set<string>();
    for (const d of decisiones) {
      const orden = ordenMap.get(d.ordenId);
      if (orden && orden.zonaId !== centralZonaId) zonasNoGam.add(orden.zonaId);
    }
    const zonasBloqueadas = await this.zonasSateliteBloqueadas([...zonasNoGam]);
    if (zonasBloqueadas.size > 0) {
      const detalleZona: DetalleConflicto[] = [];
      for (const d of decisiones) {
        const orden = ordenMap.get(d.ordenId);
        if (orden && orden.zonaId !== centralZonaId && zonasBloqueadas.has(orden.zonaId)) {
          detalleZona.push({ ordenId: d.ordenId, motivo: MSG_BODEGA_SATELITE_BLOQUEADA });
        }
      }
      if (detalleZona.length > 0) return { status: "conflict", detalle: detalleZona };
    }

    // --- Feature 92/R8: gate de asignabilidad por coordenadas, ANTES de persistir ---
    // Solo las ordenes GAM que reciben mensajero: son las unicas que escriben
    // `mensajero_asignado_id` y, por tanto, las unicas que entran a la ruta de alguien.
    const idsQueRecibenMensajero = decisiones
      .filter((d) => d.mensajeroId !== null && ordenMap.get(d.ordenId)?.zonaId === centralZonaId)
      .map((d) => d.ordenId);
    const detalleCoords = await this.gateCoordenadas(distinct(idsQueRecibenMensajero));
    if (detalleCoords.length > 0) return { status: "conflict", detalle: detalleCoords };

    const [estatusEsperaId, estatusBodegaId, estatusRutaSateliteId] = await Promise.all([
      this.repo.findEstatusIdByValue(ESTATUS_EN_ESPERA_ACEPTACION),
      this.repo.findEstatusIdByValue(ESTATUS_EN_BODEGA),
      this.repo.findEstatusIdByValue(ESTATUS_EN_RUTA_BODEGA_SATELITE),
    ]);
    // Guardia de catalogo (mismo criterio que `asignarDesdeBodega`/`rutearABodegaSatelite`):
    // los tres destinos posibles del lote deben existir en `order_status`. Si falta alguno,
    // se aborta ANTES de persistir (R11/R17) con un error accionable, en vez de dejar pasar
    // un null disfrazado de string hasta la escritura.
    if (estatusEsperaId === null || estatusBodegaId === null || estatusRutaSateliteId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // --- Construir decisiones del lote: GAM por regla 17, no-GAM a satelite (R11) ---
    // Arrow `const` (no `function`): una declaracion se hoistea y TS descarta el
    // estrechamiento de la guardia de catalogo de arriba; asi los tres ids entran ya
    // como `string` y no hace falta ningun cast.
    const estatusDestino = (
      ordenId: string,
      mensajeroId: string | null,
    ): {
      estatusId: string;
      mensajeroAsignadoId: string | null;
      estado: string;
    } => {
      const orden = ordenMap.get(ordenId);
      const esGam = orden !== undefined && orden.zonaId === centralZonaId;
      if (!esGam) {
        // R9/R10: no-GAM -> en_ruta_bodega_satelite, sin mensajero, con num_guia.
        return {
          estatusId: estatusRutaSateliteId,
          mensajeroAsignadoId: null,
          estado: ESTATUS_EN_RUTA_BODEGA_SATELITE,
        };
      }
      if (mensajeroId !== null) {
        return {
          estatusId: estatusEsperaId,
          mensajeroAsignadoId: mensajeroId,
          estado: ESTATUS_EN_ESPERA_ACEPTACION,
        };
      }
      return {
        estatusId: estatusBodegaId,
        mensajeroAsignadoId: null,
        estado: ESTATUS_EN_BODEGA,
      };
    };

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
      // Feature 49/#3 (R11): actor = el maestro; origen leido por-orden dentro de la tx.
      { actorUsuarioId: actor.usuarioId, origenTipo: "generacion_guia" },
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
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    if (centralZonaId === null) {
      return { status: "validation_error", fieldErrors: GAM_NO_CONFIGURADA };
    }

    // --- R6: mensajeroId debe ser un usuario rol mensajero de la zona GAM ---
    const mensajerosValidos = await this.repo.findMensajeroIdsValidosByZona(
      [input.mensajeroId],
      centralZonaId,
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
      // Feature 46/R2: orden reprogramada -> bloqueada; motivo tipado (antes del origen).
      if (orden.estatusValue === ESTATUS_REPROGRAMADA) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA });
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
      if (orden.zonaId !== centralZonaId) {
        detalle.push({ ordenId: id, motivo: "orden de zona no-GAM" });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R29/R17: aborta sin efectos

    // --- Feature 41/R13/R23: guarda de mensajero bloqueado, ANTES de persistir ---
    const bloqueados = await this.repo.findMensajerosBloqueados([input.mensajeroId]);
    if (bloqueados.has(input.mensajeroId)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({ ordenId, motivo: MSG_MENSAJERO_BLOQUEADO })),
      };
    }

    // --- Feature 92/R8: gate de asignabilidad por coordenadas, ANTES de persistir ---
    // Aqui TODAS las ordenes del lote reciben mensajero (es la accion "asignar desde
    // bodega"), asi que se evalua el lote entero.
    const detalleCoords = await this.gateCoordenadas(ordenIds);
    if (detalleCoords.length > 0) return { status: "conflict", detalle: detalleCoords };

    const estatusEsperaId = await this.repo.findEstatusIdByValue(ESTATUS_EN_ESPERA_ACEPTACION);
    if (estatusEsperaId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // R26/R5: NO reasigna num_guia, ya lo tienen de "Generar guia".
    // Feature 49/#4 (R12): actor = el maestro; destino en_espera_aceptacion.
    await this.repo.asignarBodegaLote(ordenIds, input.mensajeroId, estatusEsperaId, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "asignacion_bodega",
    });

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
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    if (centralZonaId === null) {
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
      if (orden.zonaId === centralZonaId) {
        detalle.push({ ordenId: id, motivo: "orden GAM no se rutea a satelite" });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R17: aborta sin efectos

    // --- Ajuste maestro: no se rutea a una bodega satelite cuyos mensajeros esten TODOS
    // en cierre. Aqui todas las ordenes son NO-GAM (destino su zona satelite). ---
    const zonasDestino = new Set<string>();
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (orden && orden.zonaId !== centralZonaId) zonasDestino.add(orden.zonaId);
    }
    const zonasBloqueadas = await this.zonasSateliteBloqueadas([...zonasDestino]);
    if (zonasBloqueadas.size > 0) {
      const detalleZona: DetalleConflicto[] = [];
      for (const id of ordenIds) {
        const orden = ordenMap.get(id);
        if (orden && orden.zonaId !== centralZonaId && zonasBloqueadas.has(orden.zonaId)) {
          detalleZona.push({ ordenId: id, motivo: MSG_BODEGA_SATELITE_BLOQUEADA });
        }
      }
      if (detalleZona.length > 0) return { status: "conflict", detalle: detalleZona };
    }

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
    // Feature 49/#5 (R13): actor = el maestro; destino en_ruta_bodega_satelite.
    await this.repo.rutearBodegaSateliteLote(ordenIds, estatusRutaSateliteId, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "ruteo_satelite",
    });

    const resultados: RutearSateliteResultadoItem[] = ordenIds.map((ordenId) => ({
      ordenId,
      estado: ESTATUS_EN_RUTA_BODEGA_SATELITE,
    }));
    return { status: "ok", resultados };
  }
}
