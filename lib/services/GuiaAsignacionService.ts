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
import {
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  // Pedido humano 2026-08-26: el mensajero dado de baja no recibe trabajo.
  MSG_MENSAJERO_NO_ASIGNABLE,
  // Feature 21: el mensajero destino necesita un vehiculo asociado para recibir trabajo.
  MSG_MENSAJERO_SIN_VEHICULO,
  MSG_ORDEN_REPROGRAMADA_BLOQUEADA,
  // FEATURE 276 (T7, R20): el motivo del tope, en su punto UNICO y compartido con el satelite.
  MSG_TOPE_INTENTOS_ASIGNACION,
} from "@/lib/services/mensajes-bloqueo";
import type { IAsignabilidadCoordenadasService } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
// FEATURE 276 (T7, R7): el umbral sale de la configuracion, nunca de un `3` escrito a mano.
import { reintentosConfig } from "@/lib/config/reintentos";
import { esAsignable, motivoAsignabilidad } from "@/lib/services/AsignabilidadCoordenadasService";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolverFechaReparto } from "@/lib/utils/dia-reparto";

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
//
// FEATURE 235 (R1, 2026-08-19) — `ayuda_tienda` ENTRA, y no es un apendice: es el caso mas claro de
// los tres. El estatus significa literalmente «el mensajero pidio ayuda sobre esta orden y EL
// PAQUETE SIGUE CON EL, EN LA CALLE» (R1). Un mensajero con una orden ahi lleva carga encima, asi
// que mandarlo a recolectar a una tienda es exactamente lo que la regla de dedicacion prohibe:
// «quien va a una tienda a recoger un lote sale con el vehiculo vacio y vuelve a la central».
//
// Dejarla fuera no habria sido una decision, habria sido un olvido con dirección peligrosa: el
// mensajero se leeria como «sin carga» JUSTO cuando esta atascado con un paquete que no puede
// entregar. La 235 movio la orden de `en_reparto` a un estatus propio y esta lista no se entero —
// la cazó la revision, no la suite—. La guardia `carga-del-mensajero.guardia.test.ts` existe para
// que la proxima vez la cace un test.
const ESTADOS_REPARTO_PENDIENTE = ["por_recoger", "en_reparto", "ayuda_tienda"];
// Lo que ocupa a un mensajero es la recoleccion que TIENE ASIGNADA (`recolectando`); las que
// esperan sin dueño no son de nadie y por tanto no bloquean a nadie.
const ESTADOS_RECOLECCION_PENDIENTE = [ESTATUS_RECOLECTANDO];
const MSG_MENSAJERO_CON_REPARTO =
  "el mensajero tiene ordenes de reparto pendientes: una recoleccion en tienda exige ir sin carga";
const MSG_MENSAJERO_CON_RECOLECCION =
  "el mensajero tiene una recoleccion en tienda pendiente: debe cerrarla antes de recibir reparto";

// FEATURE 241 (2026-08-20) — AQUI VIVIA `MSG_BODEGA_SATELITE_BLOQUEADA`, el motivo del `conflict`
// al rutear ordenes hacia una bodega satelite con algun mensajero en cierre. Se va con la guarda
// que lo emitia (ver `rutearABodegaSatelite`). El mapper de la UI conserva su entrada por el
// fragmento "bodega satelite bloqueada" (`guia-decision-error-messages.ts`): no estorba y es de
// otra capa, pero hoy ya nadie produce ese motivo.

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
    /**
     * 💰 FEATURE 276 (T7, R18): el derivador de intentos EN LOTE, para la puerta del tope de
     * `asignarDesdeBodega`.
     *
     * REQUERIDA a proposito —mismo motivo que `asignabilidad`, escrito arriba—: si fuera opcional,
     * olvidarla en una fabrica nueva desactivaria la puerta EN SILENCIO y volveria a salir a
     * reparto una orden que ya agoto sus intentos, que es exactamente lo que esta feature existe
     * para impedir. Va por `import type` + `Pick`: sin ciclo de modulos y testeable con dobles
     * (patron `MisAsignacionesService`).
     */
    private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
  ) {}

  /**
   * Feature 92 (R8) — guarda del writer de `mensajero_asignado_id` de este service.
   * Devuelve el `detalle` de las ordenes NO asignables (vacio si todas lo son).
   *
   * FEATURE 368 (2026-09-03, R18/R19) — YA NO ES TODO-O-NADA. Hasta esta ficha, una sola
   * orden con motivo de coordenadas abortaba el lote entero (contrato documentado aqui
   * mismo, ahora superado). Desde la 368, el llamador (`asignarDesdeBodega`) FILTRA el
   * `detalle` que este metodo devuelve: las asignables se asignan, las bloqueadas por
   * coordenadas se reportan como `partial` sin abortar nada. Este metodo NO cambia de
   * firma ni de logica interna — sigue devolviendo el `detalle` de las NO asignables, en
   * el mismo orden que `ordenIds` — el cambio de contrato vive entero en el llamador.
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

  /**
   * Feature 246 (T3.2, R1/R3/R5/R7): `now` es el reloj INYECTABLE desde el que se resuelve el dia
   * de reparto. Con default para que el borde (la Server Action) siga llamando con dos
   * argumentos; los tests lo pasan siempre, porque «hoy» y «mañana» solo se pueden probar
   * moviendo el reloj.
   */
  async asignarDesdeBodega(
    input: AsignarBodegaInput,
    actor: Actor,
    now: Date = new Date(),
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

    // --- Feature 21: el mensajero destino DEBE tener un vehiculo asociado ---
    // Motivo propio (no "mensajeroId no valido"): el mensajero existe y es de la zona;
    // lo que falta es su vehiculo, y eso se arregla en otra pantalla.
    const conVehiculo = await this.repo.findMensajeroIdsConVehiculo([input.mensajeroId]);
    if (!conVehiculo.has(input.mensajeroId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: [MSG_MENSAJERO_SIN_VEHICULO] },
      };
    }

    // --- Pedido humano (2026-08-26): el mensajero destino DEBE estar en un estado que admita
    // trabajo. Un `inactivo` seguia pasando por aqui: `findMensajeroIdsValidosByZona` mira rol y
    // zona, y el estado no es ninguna de las dos cosas. Motivo propio, misma forma que la guarda
    // del vehiculo de arriba: existe y es de la zona, pero esta dado de baja.
    const noAsignables = await this.repo.findMensajerosNoAsignablesPorEstado([input.mensajeroId]);
    if (noAsignables.has(input.mensajeroId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: [MSG_MENSAJERO_NO_ASIGNABLE] },
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

    // --- FEATURE 271 (T4.1, R28/R30) — LA GUARDA DE «MENSAJERO BLOQUEADO POR CIERRES» VUELVE ---
    //
    // ⚠️ ESTO REVIERTE UNA REGLA FIRMADA. Entre el 2026-08-18 y el 2026-08-23 aqui no habia guarda:
    // la feature 241 la dejo retirada a proposito con la regla 2 —«RECIBIR ASIGNACIONES NUNCA se
    // bloquea»—, firmada por el humano el 2026-08-20. El 2026-08-23 el humano revirtio esa mitad:
    // acumular dos cierres, o arrastrar uno re-solicitable, TAMBIEN bloquea recibir trabajo nuevo.
    // Palabras suyas sobre por que alcanza tambien a la recoleccion: «un mensajero no puede hacer
    // las dos gestiones, solo una a la vez».
    //
    // QUE SOBREVIVE DE LA 241, y es la mitad que hace que esta guarda no repita el incidente del
    // 18/08: un cierre `solicitado` A SECAS (N=1, V=0) **NO** bloquea. El mensajero que ya pidio su
    // cierre y espera al admin sigue recibiendo trabajo con normalidad. Lo que bloquea es N>=2 o
    // V>=1 — la regla completa vive en `lib/utils/bloqueo-cierre.ts` y NO se re-escribe aqui.
    //
    // VA ANTES DE CUALQUIER ESCRITURA y aborta el LOTE COMPLETO con `detalle` por orden (R30):
    // mismo contrato todo-o-nada que las demas guardas de este metodo. Ninguna orden cambia de
    // estado.
    //
    // ⚠️ Y NO SE REPONE EL `NOT EXISTS` DEL UPDATE CRUDO (design §12/A5). La guarda vive en el
    // service, UNA sola vez. Dos escrituras del mismo criterio en dos capas es literalmente lo que
    // produjo el incidente del 18/08: la lectura decia «pasa», el UPDATE tocaba 0 filas y el usuario
    // recibia «Actualiza la lista y vuelve a intentarlo», que era falso y no se arreglaba nunca.
    const bloqueadosReparto = await this.repo.findMensajerosBloqueadosPorCierres([
      input.mensajeroId,
    ]);
    if (bloqueadosReparto.has(input.mensajeroId)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({
          ordenId,
          motivo: MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
        })),
      };
    }

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

    // --- 💰 FEATURE 276 (T7/T8, R18/R19/R20) — LA ULTIMA PUERTA: NO SE ASIGNA UNA ORDEN AGOTADA ---
    //
    // MIENTRAS los intentos vigentes de una orden sean `>= umbral`, no se le puede dar a un
    // mensajero. Es la quinta via hacia la circulacion del design §1 y hasta esta ficha NO estaba
    // cerrada: este servicio no consultaba el contador en ningun punto.
    //
    // ⚠️ Y NO BASTA POR SI SOLA, que es lo que la hace facil de mal-entender. Cerrar SOLO esta
    // puerta seria poner un guardia que mira un reloj parado: la orden llega a bodega ANTES de que
    // su intento se cuente —el cierre todavia no se aprobo— y en ese instante el contador dice el
    // valor viejo y la deja pasar. Por eso la ficha 276 cierra ADEMAS la liberacion diferida
    // (`LiberacionReprogramadaService`), que es la raiz.
    //
    // UNA SOLA CONSULTA para todo el lote (`contarIntentosEnLote`, el metodo que la 215 creo
    // exactamente para esto): nada de N+1. R7: el umbral sale de `reintentosConfig`.
    //
    // TODO-O-NADA (R19): una sola orden en el umbral aborta el lote ENTERO, y el `detalle` lleva
    // UNA entrada POR ORDEN —tambien por las que si podian asignarse—, igual que las guardas
    // vecinas. Ninguna orden cambia de estado.
    const intentosPorOrden = await this.historial.contarIntentosEnLote(ordenIds);
    const umbralIntentos = reintentosConfig.MIN_INTENTOS_ENTREGA;
    if (ordenIds.some((id) => (intentosPorOrden.get(id) ?? 0) >= umbralIntentos)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({
          ordenId,
          // R20: el MISMO simbolo que emite la bodega satelite. Dos literales gemelos es como se
          // desincronizan dos pantallas que cuentan la misma regla.
          motivo: MSG_TOPE_INTENTOS_ASIGNACION,
        })),
      };
    }

    // --- Feature 92/R8: gate de asignabilidad por coordenadas, ANTES de persistir ---
    // Aqui TODAS las ordenes del lote reciben mensajero (es la accion "asignar desde
    // bodega"), asi que se evalua el lote entero.
    //
    // FEATURE 276: la puerta del tope va JUSTO ANTES de este gate y no despues. El rechazo por
    // tope es DEFINITIVO y el de coordenadas es CORREGIBLE: ensenar primero el que no tiene
    // arreglo evita que alguien salga a capturar coordenadas de una orden que no se va a asignar
    // igual.
    //
    // FEATURE 368 (2026-09-03, R1/R3/R4/R6/R18) — REGLA VIGENTE: asignacion PARCIAL, solo para
    // el motivo de coordenadas. Antes de esta ficha, `detalleCoords.length > 0` abortaba el lote
    // COMPLETO (`conflict`), aunque solo una orden estuviera bloqueada. Ahora se filtra: las
    // bloqueadas por coordenadas (`bloqueadasIds`) se separan del resto (`asignables`), y solo se
    // escribe/reporta como asignado el subconjunto `asignables`. Tres desenlaces (R15):
    //   - `asignables.length === 0` -> `conflict` con el `detalle` completo (R3, sin cambios: es
    //     el mismo camino de siempre cuando NINGUNA orden pasa el gate);
    //   - `detalleCoords.length === 0` -> `ok` con el lote completo (R4, sin cambios);
    //   - mezcla de las dos -> `partial`, con `resultados` (lo asignado) y `bloqueadas` (el
    //     `detalle` de coordenadas), ambos en el orden original de `ordenIds`.
    // El resto de motivos de este metodo (estado/pertenencia, mensajero, tope de intentos, todos
    // evaluados ANTES de este gate) siguen abortando el lote completo sin ningun cambio (R7/R8).
    const detalleCoords = await this.gateCoordenadas(ordenIds);
    const bloqueadasIds = new Set(detalleCoords.map((d) => d.ordenId));
    const asignables = ordenIds.filter((id) => !bloqueadasIds.has(id));
    if (asignables.length === 0) return { status: "conflict", detalle: detalleCoords }; // R3

    const estatusEsperaId = await this.repo.findEstatusIdByValue(ESTATUS_EN_ESPERA_ACEPTACION);
    if (estatusEsperaId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
      };
    }

    // Feature 246 (T3.2, R3/R5/R7) — LA ELECCION SE RESUELVE AQUI, UNA SOLA VEZ, Y PARA EL LOTE
    // ENTERO. `input.dia` es un TOKEN («hoy»/«manana»), no una fecha: el cliente no puede decidir
    // el dia (R6). `?? "hoy"` cubre la llamada directa al servicio sin el campo, que significa
    // exactamente lo mismo que el default del schema (R4). Una asignacion, un dia de reparto (R3):
    // la fecha se calcula una vez y viaja al repositorio como parametro, sin recalcularse abajo.
    const fechaReparto = resolverFechaReparto(input.dia ?? "hoy", now);

    // R26/R5: NO reasigna num_guia, ya lo tienen de "Generar guia".
    // Feature 49/#4 (R12): actor = el maestro; destino por_recoger.
    // Feature 368 (R1): escribe SOLO `asignables`, no `ordenIds` — el subconjunto que paso el
    // gate de coordenadas. `asignarBodegaLote` no cambia de firma: sigue siendo un unico
    // `WHERE id IN (...)` dentro de su propia `$transaction`, ahora sobre un array mas corto.
    await this.repo.asignarBodegaLote(
      asignables,
      input.mensajeroId,
      estatusEsperaId,
      { actorUsuarioId: actor.usuarioId, origenTipo: "asignacion_bodega" },
      fechaReparto, // R7: en la MISMA escritura que `asignado_at`
    );

    const resultados: AsignarBodegaResultadoItem[] = asignables.map((ordenId) => ({
      ordenId,
      estado: ESTATUS_EN_ESPERA_ACEPTACION,
    }));
    // R1/R4: `partial` si quedo alguna bloqueada por coordenadas, `ok` si el lote paso completo.
    return detalleCoords.length > 0
      ? { status: "partial", resultados, bloqueadas: detalleCoords }
      : { status: "ok", resultados };
  }

  /**
   * Feature 157 (R3-R9) — cuarta accion del mismo service: el maestro decide QUE mensajero va
   * a la tienda a recolectar. Vive aqui, y no en un service nuevo, porque es la misma
   * responsabilidad que las otras tres y reusa sus mismas piezas (`findByIdsForTransicion` y el
   * contrato `DetalleConflicto` que la UI ya sabe pintar).
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

    // --- 4b. Pedido humano (2026-08-26): ni recolectar. La recoleccion no filtra por zona (ver
    // la cabecera), asi que el estado es AQUI la unica guarda que separa a un mensajero de baja
    // del trabajo; misma regla y mismo texto que las otras dos escrituras.
    const noAsignablesRecoleccion = await this.repo.findMensajerosNoAsignablesPorEstado([
      input.mensajeroId,
    ]);
    if (noAsignablesRecoleccion.has(input.mensajeroId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroId: [MSG_MENSAJERO_NO_ASIGNABLE] },
      };
    }

    // --- 5. FEATURE 271 (T4.3, R31) — LA GUARDA DE BLOQUEO POR CIERRES, TAMBIEN AQUI ---
    //
    // ⚠️ ESTA GUARDA SE DIO LA VUELTA DOS VECES, y por eso conviene que su historia quede escrita.
    // La feature 41/R7 la puso; el 2026-08-18 se retiro; el 2026-08-20 la 241 ratifico la retirada
    // (declarando la asignacion exenta); y el 2026-08-23 el humano la repuso, esta vez SIN
    // excepcion de recoleccion. Sus palabras: «Error mío, en realidad no puede recibir recolecciones
    // porque son dos tareas diferentes, una cosa es ir a repartir y otra diferente es recoger en
    // tienda, un mensajero no puede hacer las dos gestiones, solo una a la vez.»
    //
    // NO NACE EN EL VACIO, y esto es lo que hace que no sea una politica inventada aqui: dos lineas
    // mas abajo esta MISMA accion ya consulta `findMensajerosConOrdenesEn` para aplicar la REGLA DE
    // DEDICACION (feature 157) — quien lleva reparto no recibe recoleccion, porque son la misma
    // jornada de trabajo. Esa regla es SEPARADA de este bloqueo y esta ficha NO la toca; se nombra
    // porque explica por que la excepcion no protegia nada: dejar entrar la recoleccion a un
    // mensajero bloqueado le daba exactamente el trabajo que el servidor le iba a rechazar en el
    // mostrador de la tienda (`RecoleccionTiendaService` YA bloquea el ACTO de recolectar).
    //
    // Mismo predicado, mismo motivo y mismo todo-o-nada que `asignarDesdeBodega`: un solo predicado,
    // todas las superficies (R10/R31).
    const bloqueadosRecoleccion = await this.repo.findMensajerosBloqueadosPorCierres([
      input.mensajeroId,
    ]);
    if (bloqueadosRecoleccion.has(input.mensajeroId)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({
          ordenId,
          motivo: MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
        })),
      };
    }

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

    // --- FEATURE 241 (2026-08-20): AQUI SE COMPROBABA QUE LA BODEGA SATELITE DE DESTINO NO
    //     TUVIERA NINGUN MENSAJERO EN CIERRE, y se va.
    //
    // Rutear ordenes a una bodega ES que esa bodega RECIBA TRABAJO, y la regla firmada dice que
    // recibir no se bloquea nunca. Ademas esta era la version mas desproporcionada del bloqueo:
    // por-ZONA y no por-mensajero, asi que el cierre de UNA persona paraba la bodega entera —
    // companeros sin ningun cierre incluidos— hasta que alguien aprobara, con una mediana de
    // 8,2 h y un p90 de 22,1 h de espera (investigacion 241 §5). Un satelite que cerraba a las
    // 18:00 no podia mover nada hasta la manana siguiente.
    //
    // NO SE «QUEDO SIN EFECTO», SE QUITA. Desde el 2026-08-18 no disparaba nunca porque el
    // predicado que consultaba estaba apagado por un tope inalcanzable; al reparar el predicado
    // en esta misma ficha habria vuelto a la vida SIN que nadie lo decidiera. Dejarla escrita
    // habria sido reponer por accidente justo lo que la regla 2 prohibe.
    //
    // Lo que NO cambia: el cierre de la PROPIA bodega hacia la central (causa (ii) de
    // `existeBodegaSateliteBloqueada`) sigue bloqueando en la pantalla del satelite. Eso no es el
    // cierre de un mensajero y nadie lo ha tocado.

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
