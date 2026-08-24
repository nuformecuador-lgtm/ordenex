import {
  CorreccionDiaConflictoError,
  type CorreccionDiaAplicada,
  type IOrdenRepository,
  type OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type {
  CorregirDiaRepartoInput,
  CorregirDiaRepartoServiceResult,
  ICorreccionDiaRepartoService,
} from "@/lib/interfaces/services/ICorreccionDiaRepartoService";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolverFechaReparto, fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";
import {
  notificadorNoOp,
  type DiaRepartoCorregidoNotificador,
} from "@/lib/notificaciones/notificadores";
import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_DIA,
  MSG_SIN_MENSAJERO,
  MSG_YA_ES_ESE_DIA,
  msgEstadoSinDiaVivo,
} from "@/lib/services/mensajes-correccion-dia-reparto";

// Feature 262 — logica de negocio de «corregir el dia de reparto de un lote ya asignado». Servicio
// PROPIO (design §3): `GuiaAsignacionService` es SOLO acceso total y SOLO zona GAM, y
// `AsignacionSateliteService` es SOLO `adminSatelite` y SOLO su zona; la correccion cruza las dos,
// asi que meterla en cualquiera de ellos obligaria a abrir con un `if` la autorizacion de un
// servicio que decide a quien se le asigna trabajo.
//
// No conoce HTTP ni Prisma: se instancia con dobles en los tests.

/**
 * D2 — LOS ESTADOS EN LOS QUE EL DIA DE REPARTO TODAVIA DECIDE ALGO, y por tanto los unicos sobre
 * los que se ofrece la correccion (R6).
 *
 *  · `por_recoger`  — el caso principal: el lote esta en la bodega, marcado para el dia que no es.
 *  · `en_reparto`   — la poblacion que la 261 dejo ATRAPADA: el paquete ya esta en la mano del
 *                     mensajero y no puede gestionarlo. Sin este estado, esta ficha no rescata el
 *                     caso que la motivo.
 *  · `ayuda_tienda` — el mismo bloqueo por la otra puerta: 261/R28 impide que la tienda resuelva
 *                     una orden reservada, y el paquete SIGUE con el mensajero (235/R1). El dia
 *                     esta tan vivo aqui como en `en_reparto`.
 *
 * ⚠️ ESTA LISTA ENTRA EN UN CENSO QUE YA EXISTE, y ahi esta la mitad del valor de declararla:
 * `tests/unit/guards/carga-del-mensajero.guardia.test.ts` vigila, miembro a miembro, las listas que
 * deciden sobre «lo que el mensajero lleva encima» y exige que incluyan `ayuda_tienda` con su razon
 * escrita. Quitar `ayuda_tienda` de aqui pone esa guardia ROJA (M-s).
 */
const ESTADOS_CON_DIA_DE_REPARTO_VIVO = ["por_recoger", "en_reparto", "ayuda_tienda"];

const ROL_SATELITE = "adminSatelite";

/**
 * Metodos de repo que consume el service (inyeccion por constructor, `Pick` para dobles de test sin
 * DB).
 *
 * ⚠️ `findMensajerosBloqueadosPorCierres` NO FIGURA, Y SIGUE SIENDO A PROPOSITO (R14) — pero el
 * MOTIVO cambio el 2026-08-23 y conviene que quede escrito. Antes se apoyaba en la regla 2 de la
 * 241 («la asignacion esta exenta»), que la FEATURE 271 REVIRTIO: recibir trabajo nuevo SI se
 * bloquea. La exclusion se conserva por su OTRA razon, que no depende de aquella regla: CORREGIR EL
 * DIA DE UNA ORDEN QUE EL MENSAJERO YA TIENE EN LA MANO NO ES DARLE TRABAJO NUEVO NI GESTIONAR — no
 * mueve dinero, no crea una gestion y no cambia de estado. Bloquearla dejaria una orden mal fechada
 * sin forma de arreglarse justo cuando su dueño esta atascado.
 *
 * Dejar el metodo fuera del TIPO hace imposible consultarlo por descuido. Patron
 * `DeshacerAsignacionRepo`.
 */
export type CorreccionDiaRepartoRepo = Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "corregirDiaRepartoLote"
>;

export class CorreccionDiaRepartoService implements ICorreccionDiaRepartoService {
  /**
   * El notificador por DEFECTO es el NO-OP (patron `notificadores.ts:11-19`): un service construido
   * sin cablearlo —tipicamente un doble de test— no escribe ni una notificacion, POR CONSTRUCCION y
   * sin husmear el entorno. El notificador REAL lo inyecta el composition root, que aqui es la
   * Server Action `lib/actions/corregir-dia-reparto.ts`.
   */
  constructor(
    private readonly repo: CorreccionDiaRepartoRepo,
    private readonly notificar: DiaRepartoCorregidoNotificador = notificadorNoOp,
  ) {}

  async corregir(
    input: CorregirDiaRepartoInput,
    actor: Actor,
    now: Date = new Date(),
  ): Promise<CorregirDiaRepartoServiceResult> {
    // 1. R11/R15: autorizacion por ROL antes de tocar dato alguno. Exactamente quien puede ELEGIR
    //    el dia al asignar: acceso total (maestro/admin) y `adminSatelite`. Nadie mas — ni el
    //    `adminTienda` (no elige el dia al asignar ni opera la ruta) ni el `mensajero` (es la parte
    //    BLOQUEADA por la reserva, y quien sufre un bloqueo no puede ser quien lo levanta). El
    //    rechazo no revela el estado de ninguna orden: se devuelve ANTES de leer nada.
    const esSatelite = actor.rol === ROL_SATELITE;
    if (!esAccesoTotal(actor.rol) && !esSatelite) return { status: "forbidden" };

    const ordenIds = [...new Set(input.ordenIds)];
    if (ordenIds.length === 0) return { status: "ok", corregidas: 0, dia: input.dia };

    // 2. R12: la zona del `adminSatelite` se resuelve SERVER-SIDE, jamas se acepta del cliente.
    //    Acceso total => `null` => sin restriccion de zona (alcanza cualquier zona, mismo reparto
    //    que «Deshacer asignacion», 149/R3).
    const zonaActor = esSatelite ? await this.repo.findUsuarioZonaId(actor.usuarioId) : null;
    if (esSatelite && zonaActor === null) return { status: "sin_zona" };

    // 3. R2/R3: LA FECHA SE RESUELVE AQUI, UNA VEZ PARA TODO EL LOTE, en el servidor y con un reloj
    //    inyectable. El repositorio la recibe ya resuelta: un solo sitio que sabe traducir
    //    «hoy/mañana» es un solo sitio donde ese criterio puede equivocarse, y recalcularla abajo
    //    abriria la puerta a que dos capas de la misma peticion cayeran a distinto lado de la
    //    medianoche (doctrina de `lib/utils/dia-reparto.ts`).
    //
    //    Y el PASADO no se prohibe con un `if`: no es expresable. El contrato solo admite dos
    //    tokens, «el dia en curso» y «el siguiente» (D3). Un `if (fecha < hoy)` seria exactamente
    //    la clase de linea que un dia alguien relaja «para un caso puntual».
    const fecha = resolverFechaReparto(input.dia, now);
    const fechaTexto = fechaRepartoComoTexto(fecha);

    // 4. R5/R6/R7 + R4: precarga del lote (INCLUYE borradas, para poder distinguir motivos).
    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    // R12: zona ajena => `forbidden` DEL LOTE COMPLETO, no `conflict`. Es un problema de permiso,
    // no de estado, y se evalua ANTES del pre-chequeo para no filtrar el estado de una orden que el
    // actor no deberia poder mirar. Mismo criterio que 149/R4.
    if (zonaActor !== null) {
      for (const orden of ordenes) {
        if (orden.deletedAt === null && orden.zonaId !== zonaActor) return { status: "forbidden" };
      }
    }

    const detalle: DetalleConflicto[] = [];
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (!orden) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_EXISTE });
        continue;
      }
      const motivo = this.motivoDeRechazo(orden, fechaTexto);
      if (motivo !== null) detalle.push({ ordenId: id, motivo });
    }
    // R8: una sola rechazada aborta el lote ENTERO y SIN EFECTOS — ni una escritura, ni una fila de
    // rastro, ni una llamada al repositorio de escritura.
    if (detalle.length > 0) return { status: "conflict", detalle };

    // 5. El catalogo de estados: el repositorio filtra por `estatus_id`, no por `value`. Falta de
    //    seed => `validation_error` (fallo CERRADO), mismo mensaje que el resto de services.
    const estatusIds: string[] = [];
    for (const value of ESTADOS_CON_DIA_DE_REPARTO_VIVO) {
      const id = await this.repo.findEstatusIdByValue(value);
      if (id === null) {
        return { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] } };
      }
      estatusIds.push(id);
    }

    // 6. R1/R8/R9/R22: escritura transaccional todo-o-nada, con el rastro en la MISMA tx.
    //    `zonaActor` no-null => guarda de zona repetida en el `WHERE` (defensa en profundidad
    //    anti-TOCTOU, patron `deshacerAsignacionLote`).
    let aplicadas: CorreccionDiaAplicada[];
    try {
      aplicadas = await this.repo.corregirDiaRepartoLote(ordenIds, fecha, estatusIds, zonaActor, {
        actorUsuarioId: actor.usuarioId,
        motivo: input.motivo, // R21: uno por lote, ya recortado en el borde
      });
    } catch (error) {
      if (error instanceof CorreccionDiaConflictoError) {
        // R9: alguien movio la orden entre la validacion y la escritura. La tx ya revirtio el lote
        // COMPLETO; aqui solo se compone el detalle re-leyendo el estado (patron `detalleCarrera`).
        return { status: "conflict", detalle: await this.detalleCarrera(error, fechaTexto) };
      }
      throw error;
    }

    // 7. R46/R49/R50 — EL AVISO, FUERA DE LA TRANSACCION Y SOLO SI (6) CONFIRMO.
    //
    //    ⚠️ Fuera y best-effort, y no por comodidad (A22): dentro de una transaccion de Postgres un
    //    error de sentencia aborta la transaccion ENTERA, asi que un aviso caido REVERTIRIA una
    //    correccion legitima y devolveria la orden al estado inalcanzable del que esta ficha existe
    //    para sacarla. La direccion segura del error es la contraria: la correccion manda, el aviso
    //    es cortesia. `notificar` es `emitirBestEffort` por dentro, asi que no propaga; el `try`
    //    de aqui es la red por si alguien inyecta un notificador que si lo hace — y el resultado
    //    sigue siendo `ok`, porque la correccion YA esta escrita (R49).
    //
    //    UN AVISO POR CORRECCION (R50), no uno por lote: agregar («3 de tus ordenes cambiaron de
    //    dia») impediria nombrar QUE paquete, que es el unico dato con el que el mensajero hace algo
    //    (A23).
    for (const c of aplicadas) {
      try {
        await this.notificar({
          cambioId: c.cambioId, // LA ENTIDAD es la correccion, no la orden: sin esto la dedupe se
          // comeria en silencio el segundo aviso de la misma orden (A20)
          mensajeroUsuarioId: c.mensajeroAsignadoId,
          fechaNuevaISO: fechaRepartoComoTexto(c.fechaNueva),
          // R48: la guia si existe, y si no la remision. Identifica la orden SIN exponer
          // destinatario, direccion, telefono ni monto. Y sin el motivo escrito (A24).
          anexo: c.numGuia !== null ? String(c.numGuia) : c.numRemision,
        });
      } catch {
        // `notificar` ya registra el fallo con contexto (`emitirBestEffort` -> `defaultLogger`).
        // Aqui no se vuelve a loggear para no duplicar la entrada, y NO se propaga: la correccion
        // esta escrita y el usuario tiene que verla como lo que es, un exito.
      }
    }

    // 8. R10: el lote quedo para el dia elegido. La frase con palabras la compone la pantalla con
    //    `confirmacionDiaReparto`, la MISMA funcion que ya usa la asignacion (R18).
    return { status: "ok", corregidas: aplicadas.length, dia: input.dia };
  }

  /**
   * El motivo por el que UNA orden no se puede corregir, o `null` si se puede. Devuelve el PRIMER
   * motivo que aplica, en el orden en que el operador lo entiende: existe -> viva -> estado -> tiene
   * mensajero -> tiene dia -> el dia es otro.
   */
  private motivoDeRechazo(orden: OrdenTransicionRow, fechaTexto: string): string | null {
    if (orden.deletedAt !== null) return MSG_ORDEN_BORRADA;
    if (!ESTADOS_CON_DIA_DE_REPARTO_VIVO.includes(orden.estatusValue)) {
      return msgEstadoSinDiaVivo(orden.estatusValue); // R6: el rechazo NOMBRA el estado
    }
    // `?? null` normaliza el `?` del campo aditivo de la 157; el repo siempre lo emite.
    if ((orden.mensajeroAsignadoId ?? null) === null) return MSG_SIN_MENSAJERO; // R5
    if (orden.fechaReparto === null) return MSG_SIN_DIA; // R4/R5
    // R7: comparar los dos dias COMO TEXTO `YYYY-MM-DD` y no con `getTime()`. `fechaReparto` es un
    // `@db.Date` que Prisma devuelve como la medianoche UTC de esa fecha, y `resolverFechaReparto`
    // produce exactamente esa misma convencion; pasarlos los dos por `fechaRepartoComoTexto` compara
    // FECHAS CALENDARIO y no instantes, que es lo que la regla dice.
    if (fechaRepartoComoTexto(orden.fechaReparto) === fechaTexto) return MSG_YA_ES_ESE_DIA;
    return null;
  }

  /** R9: motivo por orden de las que perdieron la carrera, re-leyendo su estado actual. */
  private async detalleCarrera(
    error: CorreccionDiaConflictoError,
    fechaTexto: string,
  ): Promise<DetalleConflicto[]> {
    const ids = [...error.ordenIdsNoCorregidas];
    const actuales = await this.repo.findByIdsForTransicion(ids);
    const actualMap = new Map(actuales.map((o) => [o.id, o]));
    return ids.map((ordenId) => {
      const orden = actualMap.get(ordenId);
      if (!orden) return { ordenId, motivo: MSG_ORDEN_NO_EXISTE };
      return { ordenId, motivo: this.motivoDeRechazo(orden, fechaTexto) ?? MSG_CARRERA };
    });
  }
}
