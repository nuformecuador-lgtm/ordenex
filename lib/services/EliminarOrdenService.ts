import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type {
  EliminarOrdenInput,
  EliminarOrdenServiceResult,
  IEliminarOrdenService,
} from "@/lib/interfaces/services/IEliminarOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
// Las DOS: `esOrdenEliminable` DECIDE, y `esEstadoEliminable` solo sirve para elegir CUAL de los
// dos motivos se devuelve. La decision nunca sale de la primera mitad sola.
import {
  esEstadoEliminable,
  esOrdenEliminable,
} from "@/lib/types/order-status-eliminables";
import { resolverAlcanceBorradoOrden } from "@/lib/services/alcance-borrado-orden";
import {
  MSG_ORDEN_CON_INTENTOS,
  MSG_ORDEN_NO_ELIMINABLE,
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_YA_BORRADA,
} from "@/lib/services/mensajes-eliminar-orden";

// Feature «eliminar orden» — logica de negocio del BORRADO LOGICO. No conoce HTTP ni Prisma: se
// instancia con dobles en los tests.

/**
 * Metodos de repo que consume el service. `findByIdsForTransicion` es la MISMA precarga que usan
 * las demas acciones por lote, y se elige justamente porque INCLUYE las borradas: es lo que
 * permite distinguir «no existe» de «ya borrada» en el detalle del conflicto.
 */
export type EliminarOrdenRepo = Pick<
  IOrdenRepository,
  "findByIdsForTransicion" | "softDelete"
>;

// FICHA 319 (2026-08-28) — AQUI VIVIA `EliminarOrdenHistorial`, el `Pick` de
// `idsConGestionPosteriorEnLote` con el que este service contaba las TRANSICIONES de la orden.
// Se retiro con aquel conteo, y no se deja inyectado sin uso: una dependencia que nadie consulta
// es el cable suelto que hace creer al siguiente lector que la regla sigue mirando el historial.

/**
 * ⭑ PEDIDO HUMANO 2026-09-04 — EL HISTORIAL VUELVE, PARA OTRA PREGUNTA.
 *
 * Y hay que leerlo despacio, porque a un metro de distancia parece que se deshace la 319. NO ES
 * LO MISMO:
 *   - lo que se retiro: `idsConGestionPosteriorEnLote`, «¿esta orden se movio alguna vez?».
 *     Contaba CUALQUIER transicion, asi que imprimir la etiqueta descalificaba la orden y dejaba
 *     la ventana vacia (CERO eliminables de 429 vivas en produccion).
 *   - lo que entra: `contarIntentosEnLote`, «¿se INTENTO ENTREGAR alguna vez?» (feature 215).
 *     Cuenta cierres aprobados con una gestion vigente de `rechazada`/`devuelta`/`reprogramada`.
 *     Generar la guia, recolectar y mover el paquete entre bodegas NO lo incrementan.
 *
 * El metodo retirado sigue prohibido aqui, y la guardia lo afirma por su nombre. La razon de que
 * este si se acepte es que no reintroduce el modo de fallo: el numero se queda en `0` durante
 * toda la ventana que la 319 abrio.
 *
 * `Pick` y no la interfaz entera, como en el resto del repo: este service pregunta UNA cosa al
 * historial y no debe poder hacer nada mas con el.
 */
export type EliminarOrdenHistorial = Pick<IOrdenHistorialService, "contarIntentosEnLote">;

export class EliminarOrdenService implements IEliminarOrdenService {
  constructor(
    private readonly repo: EliminarOrdenRepo,
    private readonly intentos: EliminarOrdenHistorial,
  ) {}

  async eliminar(
    input: EliminarOrdenInput,
    actor: Actor,
  ): Promise<EliminarOrdenServiceResult> {
    // 1. Autorizacion antes de tocar dato alguno, y NO escrita aqui: la resuelve
    // `resolverAlcanceBorradoOrden`, la MISMA funcion que usa el canal por API key. Devuelve
    // «todas» (maestro), «propias» (la tienda, con su `ownerId`) o «denegado».
    //
    // ⭑ FICHA 358 (2026-09-02) — QUE CAMBIO Y QUE NO. El humano abrio el borrado POR PANTALLA a
    // la tienda, acotado a lo suyo. No es un permiso nuevo: es la MISMA regla que la tienda ya
    // tenia por API desde la ficha 320 —mismo predicado de estado, mismo dueño forzado dentro del
    // `where`— con otra forma. Lo reportado que lo motiva: «Nuform quiere eliminar NA-495 y no le
    // aparece el checkbox».
    //
    // LO QUE SE CONSERVA de la decision del 2026-08-27 (que estrecho la regla de maestro/admin a
    // solo maestro): el `admin` SIGUE sin poder borrar. Aquel motivo —«con dos roles capaces de
    // borrar, el rastro de quien lo hizo deja de ser una sola persona»— hablaba de dos roles del
    // EQUIPO borrando lo mismo. La tienda no entra en esa cuenta: solo alcanza lo suyo, y ya lo
    // alcanzaba por API. `esAccesoTotal` sigue sin servir aqui a proposito.
    //
    // ⚠️ ESTA AUTORIZACION NO ES LA FRONTERA. Que el alcance sea «propias» no impide nada por si
    // solo: lo que impide que la tienda A borre una orden de la tienda B es el `ownerId` que baja
    // al `where` de `softDelete` (paso 4). El chequeo de pertenencia del bucle de abajo existe
    // para poder decir POR QUE se rechaza, no para autorizar.
    const alcance = resolverAlcanceBorradoOrden(actor);
    if (alcance.alcance === "denegado") return { status: "forbidden" };
    /** `null` = sin frontera de tienda (maestro). Viaja tal cual al `where` del repositorio. */
    const ownerId = alcance.alcance === "propias" ? alcance.ownerId : null;

    const ordenIds = [...new Set(input.ordenIds)];
    if (ordenIds.length === 0) return { status: "ok", eliminadas: 0 };

    // 2. Precarga que INCLUYE borradas, para distinguir los motivos de rechazo. Desde la ficha
    // 319 es la UNICA consulta de lectura de la accion: el estado de la orden trae toda la
    // informacion que la decision necesita.
    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    // 2b. LOS INTENTOS DE ENTREGA DEL LOTE, en UNA sola consulta (pedido humano 2026-09-04).
    // Se pide para TODO el lote de golpe y no por orden dentro del bucle: una consulta por fila
    // es el incumplimiento que la feature 215 (R7) existe para impedir, y aqui el lote es de N.
    // Las ordenes sin intentos NO vienen en el Map; el `?? 0` de abajo resuelve el default, que
    // es un valor CONOCIDO y no un dato ausente (215/R8).
    //
    // Se consulta ANTES del bucle y para el lote entero —incluidas las que ya sabemos que van a
    // ser rechazadas por estado— porque el coste es el mismo (una consulta) y porque acotar la
    // lista obligaria a un primer recorrido solo para armarla.
    const intentosPorOrden = await this.intentos.contarIntentosEnLote(ordenIds);

    const detalle: DetalleConflicto[] = [];
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (!orden) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_EXISTE });
        continue;
      }
      // FICHA 358 — PERTENENCIA, y va ANTES que `deletedAt` a proposito. Una orden de otra
      // tienda se rechaza con el motivo de «no existe», el MISMO que un id inventado, y por la
      // razon que ya escribio la ficha 320 para el canal API: distinguirlos le confirmaria a una
      // tienda que ese id existe en el sistema —y, si fuera detras del chequeo de borradas, hasta
      // si la competencia la borro—. Colapsan los tres casos en uno solo.
      //
      // Esto NO es la frontera (la frontera es el `where` del paso 4): es lo que permite
      // devolver un motivo por orden y respetar el todo-o-nada. Si esta linea desapareciera, el
      // borrado seguiria sin ocurrir; lo que se perderia es el «conflict» y el lote saldria
      // «ok, eliminadas: 0», que es peor de leer pero no inseguro.
      if (ownerId !== null && orden.tiendaId !== ownerId) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_EXISTE });
        continue;
      }
      if (orden.deletedAt !== null) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_YA_BORRADA });
        continue;
      }
      // 3. EL PREDICADO DE NEGOCIO. FICHA 319 (pedido humano 2026-08-28): manda EL ESTADO, y
      // SOLO el estado. Antes eran dos condiciones y se exigian las dos —sin transicion
      // posterior a la creacion Y todavia en un estado de nacimiento—; el conteo de transiciones
      // SE RETIRA. Motivo del humano: el estado ya dice quien hizo que con el paquete, y el
      // conteo lo contradice al descalificar una orden solo por haberle impreso la etiqueta.
      //
      // Lo que costaba: generar la guia rompia las DOS mitades a la vez (anade fila de historial
      // y mueve a `en_bodega_central`), asi que una orden numerada no se podia borrar nunca. En
      // produccion, el 2026-08-28: CERO eliminables de 429 vivas.
      //
      // La lista y el porque de cada estado viven en `lib/types/order-status-eliminables.ts`, y
      // es la MISMA que consulta `OrdenService` para decidir si ofrece el boton. Sigue fallando
      // CERRADO: es una lista de INCLUSION, lo que no esta en ella no se borra.
      //
      // ⭑ PEDIDO HUMANO 2026-09-04 — LA REGLA PASA A TENER DOS MITADES y las dos se piden aqui,
      // a traves de `esOrdenEliminable`. La lista de estados crece a SIETE (entran los dos
      // `en_ruta_*` y `por_recoger`) y a cambio se exige CERO INTENTOS DE ENTREGA. No es el
      // conteo que la 319 retiro —aquel contaba transiciones y lo rompia imprimir la etiqueta—;
      // este cuenta cierres aprobados con gestion vigente, que es «se intento entregar». El
      // porque completo, en la cabecera de `order-status-eliminables.ts`.
      //
      // LOS DOS MOTIVOS SE DISTINGUEN a proposito: el de estado se puede resolver esperando, el
      // de intentos NO se resuelve nunca (el conteo es monotono creciente, 215/R32). Un solo
      // motivo para los dos dejaria al operador reintentando sobre una orden que jamas sera
      // borrable.
      const intentos = intentosPorOrden.get(id) ?? 0;
      if (!esEstadoEliminable(orden.estatusValue)) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_ELIMINABLE });
        continue;
      }
      if (!esOrdenEliminable(orden.estatusValue, intentos)) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_CON_INTENTOS });
      }
    }
    // Todo-o-nada por lote, como `deshacerAsignacion`: si UNA orden del lote no se puede borrar,
    // no se borra NINGUNA. Un borrado parcial silencioso dejaria al operador creyendo que borro
    // las N que marco.
    if (detalle.length > 0) return { status: "conflict", detalle };

    // 4. LA ESCRITURA, con la frontera de tienda DENTRO de su `where` (ficha 358). `ownerId`
    // viaja al repositorio, no se comprueba aqui: una comprobacion en memoria deja ventana entre
    // leer y escribir, y no cubre el camino nuevo que alguien enchufe mañana. Es literalmente lo
    // que ya hacia `softDeleteViaApi` con `tiendaId: params.ownerId`.
    //
    // NO se le pasa ademas la lista de estados eliminables, a diferencia del canal API, y es
    // deliberado: alli el lote es de UNA orden, asi que un estado que cambio entre la lectura y
    // el UPDATE solo puede dar 0 o 1. Aqui el lote es de N, y filtrar por estado en el `where`
    // podria borrar N-1 y dejar una fuera — un borrado PARCIAL, que es exactamente lo que el
    // todo-o-nada de arriba existe para impedir. La carrera queda declarada, no tapada:
    // `eliminadas` puede ser menor que el lote y el contrato ya lo dice.
    //
    // El estado NO cambia y NO se registra transicion en el historial: borrar no es transicionar,
    // y el historial de la orden se conserva intacto por si hay que auditarla.
    // FICHA 362 (R3/R9/R12): QUIEN borra viaja al repositorio, que congela nombre y rol en la
    // misma transaccion y registra UNA fila por orden EFECTIVAMENTE borrada.
    const eliminadas = await this.repo.softDelete({
      ids: ordenIds,
      ownerId,
      actorUsuarioId: actor.usuarioId,
    });
    return { status: "ok", eliminadas };
  }
}
