// Feature 17 — Orquesta "Generar guia" (R18-R25/R27-R29) y "asignar desde
// bodega" (R26-R29). Servicio dedicado, separado de OrdenService (CRUD): guarda
// por estado de origen + secuencia de num_guia + transaccion por lote no encajan
// en el `actualizar` generico (design.md, alternativa D descartada).
// Feature 30 — extiende el cuerpo (no las firmas, R18): resuelve la zona GAM
// (guardia R4), clasifica cada orden GAM/no-GAM por `zonaId === centralZonaId`, valida
// el mensajero contra la zona GAM (R6) y agrega la accion dedicada
// `rutearABodegaSatelite` (R13). Inyecta `IZonaRepository`.
//
// FEATURE 156 — NUMERAR ≠ ASIGNAR. "Generar guia" pasa de tres efectos (numerar +
// asignar mensajero + rutear a satelite) a UNO SOLO: numerar y mover de
// `en_preparacion` a `en_bodega_central`. `generarGuia` ya NO escribe
// `mensajero_asignado_id` (R2), ya no clasifica GAM/no-GAM (R13), ya no rutea a
// satelite (R3) y por tanto ya no aplica ni la guarda de mensajero bloqueado (R10),
// ni la de bodega satelite bloqueada (R11), ni el gate de coordenadas (R12): son
// guardas de la ASIGNACION, y esta via ya no asigna a nadie.
//
// Los DOS caminos de asignacion vivos NO cambian y conservan sus guardas intactas:
//   - `asignarDesdeBodega`  (en_bodega_central  -> por_recoger, mensajero central)
//   - `AsignacionSateliteService` (en_bodega_satelite -> por_recoger, mensajero satelite)
// Tras esta feature esos dos son los UNICOS escritores de `mensajero_asignado_id`
// del sistema (R19), y ambos siguen exigiendo `gateCoordenadas`/`asignabilidad`.
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AsignarBodegaInput,
  AsignarBodegaResultadoItem,
  AsignarBodegaServiceResult,
  AsignarRecoleccionInput,
  AsignarRecoleccionServiceResult,
  DesasignarRecoleccionInput,
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
import { esAccesoTotal } from "@/lib/auth/acceso-total";

// Feature 156/R4 + 155/R29: UNICO estado de origen valido para "Generar guia". El estado
// de fulfillment que la 156 ya habia sacado de esta constante quedo RETIRADO del catalogo
// por la 155, asi que no hay forma de volver a nombrarlo aqui.
const ORIGEN_GENERAR_GUIA = "en_preparacion";
// R27: unico estado de origen valido para "asignar desde bodega".
const ORIGEN_BODEGA = "en_bodega_central";
// Feature 157/R5: unico estado de origen valido para "asignar recoleccion en tienda". El
// paquete sigue fisicamente en la tienda; de ahi solo sale recolectandolo.
const ORIGEN_RECOLECCION = "por_recolectar_en_tienda";
// Feature 156/R15 + 155/R29: UNICO estado de origen valido para rutear a satelite (antes un
// Set de tres estados). Se deja como constante SEPARADA de `ORIGEN_BODEGA` aunque hoy valgan
// lo mismo: documentan dos acciones distintas y un cambio futuro en una no debe arrastrar a
// la otra por accidente. Una orden en un origen NO admitido produce `conflict` y NO altera
// ninguna otra orden del lote (155/R29).
const ORIGEN_RUTEO_SATELITE = "en_bodega_central";

// Feature 46/R2: estatus bloqueado por reprogramacion (guardia explicito y tipado).
const ESTATUS_REPROGRAMADA = "reprogramada";

const ESTATUS_EN_ESPERA_ACEPTACION = "por_recoger"; // R26 (asignarDesdeBodega)
const ESTATUS_EN_BODEGA = "en_bodega_central"; // feature 156/R3: destino UNICO de generar guia
const ESTATUS_EN_RUTA_BODEGA_SATELITE = "en_ruta_bodega_satelite"; // feature 30/R9
// Feature 157 (ampliacion): destino de la asignacion de recoleccion. Que exista este estado
// es lo que impide reasignar en bucle: al asignar, la orden SALE del monton de disponibles.
const ESTATUS_RECOLECTANDO = "recolectando";

// Feature 30/R4: mensaje del guardia de zona GAM no configurada (accionable, sin
// filtrar internals: convenciones de manejo de errores).
const GAM_NO_CONFIGURADA: Record<string, string[]> = {
  zona: ["zona GAM no configurada"],
};

// Feature 41/R13 RETIRADA (pedido humano 2026-08-18): aqui vivia el motivo accionable de
// "mensajero bloqueado por cierre pendiente". Ninguna de las dos asignaciones de este service
// lo emite ya — un cierre abierto o vencido no impide asignar. Se retira la constante con la
// guarda: un mensaje que nadie puede recibir es peor que ninguno, porque invita a volver a
// cablearlo sin releer por que se quito.

// Feature 157 (regla de DEDICACION, decision del humano 2026-07-31) — recolectar en tienda
// y repartir son viajes incompatibles: quien va a una tienda a recoger un lote sale con el
// vehiculo vacio y vuelve a la central, asi que no puede llevar encima entregas pendientes.
// La regla vale en las DOS direcciones y por eso vive en este service, que es el que decide
// las dos asignaciones.
//
// Asimetria deliberada en lo que cuenta como "ocupado": las otras RECOLECCIONES no
// bloquean —un viaje a la tienda son N ordenes, y exigir cero pendientes impediria asignar
// la segunda del mismo lote—, pero cualquier orden de REPARTO si.
const ESTADOS_REPARTO_PENDIENTE = ["por_recoger", "en_reparto"];
// Lo que ocupa a un mensajero es la recoleccion que TIENE ASIGNADA (`recolectando`); las que
// esperan sin dueño no son de nadie y por tanto no bloquean a nadie.
const ESTADOS_RECOLECCION_PENDIENTE = [ESTATUS_RECOLECTANDO];
const MSG_MENSAJERO_CON_REPARTO =
  "el mensajero tiene ordenes de reparto pendientes: una recoleccion en tienda exige ir sin carga";
const MSG_MENSAJERO_CON_RECOLECCION =
  "el mensajero tiene una recoleccion en tienda pendiente: debe cerrarla antes de recibir reparto";

// Ajuste maestro: motivo cuando una orden se rutearia a una bodega satelite que tiene al
// menos un mensajero BLOQUEADO (mas cierres abiertos de los tolerados). Asi la bodega esta
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
   * Feature 92 (R8) — guarda del writer de `mensajero_asignado_id` de este service.
   * Devuelve el `detalle` de las ordenes NO asignables (vacio si todas lo son).
   *
   * TODO-O-NADA POR LOTE: es el contrato ya vigente de estos services (una sola orden
   * conflictiva aborta el lote entero sin efectos), no se cambia aqui.
   *
   * Solo se evaluan las ordenes que REALMENTE reciben mensajero. Feature 156/R12/R19:
   * tras retirar la asignacion de `generarGuia`, el UNICO consumidor de este gate en
   * esta clase es `asignarDesdeBodega` — y ahi se conserva INTACTO. Numerar una orden
   * y moverla a la bodega central no la mete en la ruta de nadie, asi que no se le
   * exigen coordenadas todavia: se le exigiran cuando la bodega la asigne (aqui o via
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

  /**
   * Feature 156 — "Generar guia" con UN SOLO efecto: numerar y mover a la bodega
   * central. `en_preparacion -> en_bodega_central` (arista #5 del grafo), sin
   * mensajero y sin ruteo.
   *
   * Lo que este metodo YA NO hace (y por que no se traslada a ningun sitio nuevo):
   *   - resolver la zona GAM / clasificar GAM-no-GAM (R13): sin destino que decidir,
   *     el dato no hace falta; la clasificacion vive intacta en `asignarDesdeBodega`
   *     y `rutearABodegaSatelite`, que si la necesitan;
   *   - validar el mensajero contra la zona GAM (R2): no hay mensajero que validar;
   *   - la guarda de mensajero bloqueado por cierre (R10): idem;
   *   - la guarda de bodega satelite bloqueada (R11): esta via ya no rutea a ninguna;
   *   - el gate de asignabilidad por coordenadas (R12): numerar no mete la orden en
   *     la ruta de nadie. Se le exigiran coordenadas a la orden cuando la bodega la
   *     asigne — ahi el gate sigue puesto (R19).
   */
  async generarGuia(input: GenerarGuiaInput, actor: Actor): Promise<GenerarGuiaServiceResult> {
    // --- Autorizacion (R9), antes de tocar datos ---
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const ordenIds = distinct(input.ordenIds);
    // Inalcanzable DESDE LA ACTION: `generarGuiaSchema.ordenIds` ya exige `.min(1)`, asi que
    // un lote vacio muere en el borde con `validation_error` (2026-08-05). Se conserva como
    // defensa en profundidad para quien llame al service directamente (otros services, tests).
    if (ordenIds.length === 0) return { status: "ok", resultados: [] };

    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    // --- Validacion por orden (R4/R7); fallo -> ABORTA el lote sin efectos (R6) ---
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
      // Feature 46/R2: orden reprogramada -> bloqueada hasta su fecha; motivo tipado.
      if (orden.estatusValue === ESTATUS_REPROGRAMADA) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA });
        continue;
      }
      // R4: origen UNICO `en_preparacion`. Cualquier otro estado -> conflict (155/R29).
      if (orden.estatusValue !== ORIGEN_GENERAR_GUIA) {
        detalle.push({
          ordenId: id,
          motivo: `estado de origen no permitido: ${orden.estatusValue}`,
        });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle };

    const estatusBodegaId = await this.repo.findEstatusIdByValue(ESTATUS_EN_BODEGA);
    // Guardia de catalogo (mismo criterio que `asignarDesdeBodega`/`rutearABodegaSatelite`):
    // el destino debe existir en `order_status`. Si falta, se aborta ANTES de persistir
    // con un error accionable, en vez de dejar pasar un null disfrazado de string.
    if (estatusBodegaId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // --- Persistencia transaccional (R6): TODAS reciben num_guia idempotente (R5) ---
    // R2: `mensajeroAsignadoId: null` SIEMPRE. Ademas de no escribir el mensajero, deja
    // `asignado_at` sin estampar (el repo solo lo toca cuando el mensajero no es nulo).
    const resultadosRaw = await this.repo.generarGuiaLote(
      ordenIds.map((ordenId) => ({
        ordenId,
        estatusId: estatusBodegaId,
        mensajeroAsignadoId: null,
      })),
      // Feature 49/#3 (R8): actor = quien ejecuto; origen leido por-orden dentro de la tx.
      { actorUsuarioId: actor.usuarioId, origenTipo: "generacion_guia" },
    );
    const numGuiaByOrden = new Map(resultadosRaw.map((r) => [r.ordenId, r.numGuia]));

    // R1/R3/R5: destino UNICO `en_bodega_central` y el num_guia efectivo (el que ya
    // tenia, si lo tenia: la guarda `WHERE num_guia IS NULL` del repo es idempotente).
    const resultados = ordenIds.map((ordenId) => ({
      ordenId,
      numGuia: numGuiaByOrden.get(ordenId) as number, // presente: paso por generarGuiaLote
      estado: ESTATUS_EN_BODEGA,
    }));

    return { status: "ok", resultados };
  }

  async asignarDesdeBodega(
    input: AsignarBodegaInput,
    actor: Actor,
  ): Promise<AsignarBodegaServiceResult> {
    // --- Autorizacion (R11-R13/R16) ---
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const ordenIds = distinct(input.ordenIds);
    // Inalcanzable DESDE LA ACTION: `asignarBodegaSchema.ordenIds` ya exige `.min(1)`
    // (2026-08-05). Se conserva como defensa en profundidad para llamadas directas al service.
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

    // --- Validacion por orden (R27): origen en_bodega_central + zona GAM (R12) ---
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
      // R12: por construccion en_bodega_central solo tiene ordenes GAM, pero se valida.
      if (orden.zonaId !== centralZonaId) {
        detalle.push({ ordenId: id, motivo: "orden de zona no-GAM" });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R29/R17: aborta sin efectos

    // --- Feature 41/R13/R23 RETIRADA (pedido humano 2026-08-18) ---
    // Aqui vivia la guarda de "mensajero bloqueado por cierre abierto/vencido", que impedia
    // asignarle guias a quien arrastrara un cierre sin resolver. SE RETIRA: asignar a un
    // mensajero debe poder hacerse tenga o no cierres pendientes.
    //
    // El predicado NO desaparece del repo (`findMensajerosBloqueados`) porque otras superficies
    // lo siguen usando —`deshacerGestion`, la recoleccion en tienda y el aviso del panel del
    // mensajero—, y esas NO estaban en el alcance de este cambio. Lo que se retira es su efecto
    // sobre ESTA accion.

    // --- Feature 157: simetrica de la anterior. Un mensajero con una recoleccion sin
    //     confirmar tiene un viaje a la tienda comprometido; darle reparto ahora lo obliga
    //     a elegir cual incumple. Se le libera en cuanto confirme la recoleccion. ---
    const conRecoleccion = await this.repo.findMensajerosConOrdenesEn(
      [input.mensajeroId],
      ESTADOS_RECOLECCION_PENDIENTE,
    );
    if (conRecoleccion.has(input.mensajeroId)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({
          ordenId,
          motivo: MSG_MENSAJERO_CON_RECOLECCION,
        })),
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
    // Feature 49/#4 (R12): actor = el maestro; destino por_recoger.
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

  /**
   * Feature 157 (R3-R9) — cuarta accion del mismo service: el maestro decide QUE mensajero va
   * a la tienda a recolectar. Vive aqui, y no en un service nuevo, porque es la misma
   * responsabilidad que las otras tres y reusa sus mismas piezas (`findByIdsForTransicion`,
   * `findMensajerosBloqueados` y el contrato `DetalleConflicto` que la UI ya sabe pintar).
   *
   * Es la unica que NO transiciona: la orden sigue en `por_recolectar_en_tienda` hasta que el
   * mensajero confirme la recoleccion. Dos ausencias deliberadas frente a `asignarDesdeBodega`:
   *   - NO se acota el mensajero por zona (decision del humano, 2026-07-30): el filtro de las
   *     otras asignaciones es la zona de ENTREGA de la orden, que para ir a recoger a una
   *     tienda no significa nada. Basta rol `mensajero` y no estar bloqueado por cierre.
   *   - NO se invoca `gateCoordenadas` (R9): la orden no entra a ninguna ruta todavia, asi que
   *     exigirle coordenadas bloquearia una recoleccion por un dato que aun no hace falta.
   */
  async asignarRecoleccion(
    input: AsignarRecoleccionInput,
    actor: Actor,
  ): Promise<AsignarRecoleccionServiceResult> {
    // --- 1. Autorizacion (R8) ---
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    // --- 2. Lote vacio: idempotencia trivial, patron de las otras tres acciones ---
    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", resultados: [] };

    // --- 3. Validacion por orden (R5): origen UNICO `por_recolectar_en_tienda` ---
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
      if (orden.estatusValue !== ORIGEN_RECOLECCION) {
        detalle.push({
          ordenId: id,
          motivo: `estado de origen no permitido: ${orden.estatusValue}`,
        });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // aborta sin efectos (R5)

    // --- 4. R6: el mensajero existe y su rol es `mensajero`. SIN filtro de zona ---
    const mensajerosValidos = await this.repo.findMensajeroIdsValidos([input.mensajeroId]);
    if (!mensajerosValidos.has(input.mensajeroId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: ["mensajeroId no valido"] },
      };
    }

    // --- 5. R7 RETIRADA (pedido humano 2026-08-18): ver `asignarDesdeBodega`. Un cierre abierto
    //     o vencido ya no impide mandar a un mensajero a recolectar. ---

    // --- 5b. Regla de dedicacion: quien recolecta va sin carga de reparto ---
    const conReparto = await this.repo.findMensajerosConOrdenesEn(
      [input.mensajeroId],
      ESTADOS_REPARTO_PENDIENTE,
    );
    if (conReparto.has(input.mensajeroId)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({
          ordenId,
          motivo: MSG_MENSAJERO_CON_REPARTO,
        })),
      };
    }

    // --- 6. El destino debe existir en el catalogo (sembrado por seedOrderStatus) ---
    const destinoId = await this.repo.findEstatusIdByValue(ESTATUS_RECOLECTANDO);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: [`el catalogo no tiene ${ESTATUS_RECOLECTANDO}`] },
      };
    }

    // --- 7. Unica escritura: mensajero + TRANSICION a `recolectando`, con su rastro ---
    await this.repo.asignarRecoleccionLote(
      ordenIds,
      input.mensajeroId,
      ORIGEN_RECOLECCION,
      destinoId,
      { actorUsuarioId: actor.usuarioId, origenTipo: "asignacion_recoleccion" },
    );

    return { status: "ok", resultados: ordenIds.map((ordenId) => ({ ordenId })) };
  }

  /**
   * Feature 157 (ampliacion 2026-07-31) — "Quitar mensajero": revierte una recoleccion
   * asignada (`recolectando` -> `por_recolectar_en_tienda`) y la deja SIN mensajero.
   *
   * Es el camino explicito que sustituye a la reasignacion silenciosa: antes, asignar sobre
   * una orden ya asignada la sobreescribia sin dejar rastro y sin sacarla nunca del monton.
   * Ahora cambiar de mensajero son dos actos deliberados —revertir y volver a asignar— y los
   * dos quedan en el historial. Mismas guardias y mismo todo-o-nada que la asignacion.
   */
  async desasignarRecoleccion(
    input: DesasignarRecoleccionInput,
    actor: Actor,
  ): Promise<AsignarRecoleccionServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const ordenIds = distinct(input.ordenIds);
    if (ordenIds.length === 0) return { status: "ok", resultados: [] };

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
      // Origen UNICO: solo se revierte lo que esta asignado. Una orden ya recolectada
      // (en ruta a la central) no vuelve por aqui: ese tramo tiene su propio camino.
      if (orden.estatusValue !== ESTATUS_RECOLECTANDO) {
        detalle.push({
          ordenId: id,
          motivo: `estado de origen no permitido: ${orden.estatusValue}`,
        });
      }
    }
    if (detalle.length > 0) return { status: "conflict", detalle };

    const destinoId = await this.repo.findEstatusIdByValue(ORIGEN_RECOLECCION);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: [`el catalogo no tiene ${ORIGEN_RECOLECCION}`] },
      };
    }

    await this.repo.desasignarRecoleccionLote(ordenIds, ESTATUS_RECOLECTANDO, destinoId, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "deshacer_asignacion",
    });

    return { status: "ok", resultados: ordenIds.map((ordenId) => ({ ordenId })) };
  }

  async rutearABodegaSatelite(
    input: RutearSateliteInput,
    actor: Actor,
  ): Promise<RutearSateliteServiceResult> {
    // --- Autorizacion (R16) ---
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const ordenIds = distinct(input.ordenIds);
    // Inalcanzable DESDE LA ACTION: `rutearSateliteSchema.ordenIds` ya exige `.min(1)`
    // (2026-08-05). Se conserva como defensa en profundidad para llamadas directas al service.
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
      // Feature 156/R15/R16: origen UNICO `en_bodega_central`. Antes se admitian tres
      // estados; el paquete se rutea desde donde esta fisicamente, y eso es la bodega
      // central. Cualquier otro origen -> conflict, sin efecto sobre el lote (155/R29).
      if (orden.estatusValue !== ORIGEN_RUTEO_SATELITE) {
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
