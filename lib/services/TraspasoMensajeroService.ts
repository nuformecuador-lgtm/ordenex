import { randomUUID } from "node:crypto";

import {
  TraspasoMensajeroConflictoError,
  type IOrdenRepository,
  type OrdenTransicionRow,
  type TraspasoMensajeroItem,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type {
  ITraspasoMensajeroService,
  TraspasarMensajeroInput,
  TraspasoMensajeroServiceResult,
} from "@/lib/interfaces/services/ITraspasoMensajeroService";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  notificadorNoOp,
  type TraspasoCedidoNotificador,
  type TraspasoRecibidoNotificador,
} from "@/lib/notificaciones/notificadores";
import {
  MSG_CARRERA_TRASPASO,
  MSG_DESTINO_IGUAL_A_ORIGEN,
  MSG_DESTINO_NO_VALIDO,
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_MENSAJERO_CON_RECOLECCION,
  MSG_MENSAJERO_NO_ASIGNABLE,
  MSG_MENSAJERO_SIN_VEHICULO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_DE_OTRO_MENSAJERO,
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_SIN_MENSAJERO,
  MSG_ORIGEN_NO_UNICO,
  msgEstadoNoTraspasable,
} from "@/lib/services/mensajes-traspaso";

// FICHA 427 (T15, design §3/§6/§8) — TRASPASAR a otro mensajero lo que uno YA LLEVA ENCIMA.
//
// EL CASO QUE LA ORIGINA, medido el 2026-09-14: un mensajero se enfermo a media jornada y sus 31
// ordenes `en_reparto` las tuvo que hacer otro. La aplicacion no sabia hacerlo —ninguno de los
// cuatro escritores de `orden.mensajero_asignado_id` parte de `en_reparto`— y se resolvio
// escribiendo a mano contra produccion: 31 ordenes y 31 conversaciones de chat.
//
// SERVICIO PROPIO, no una rama mas de `DeshacerAsignacionService` ni de `GuiaAsignacionService`
// (design §A1): deshacer DEVUELVE EL PAQUETE A LA BODEGA derivando el destino del historial, y el
// paquete esta en una moto. Encadenar «deshacer + asignar» escribiria dos transiciones de estado
// FALSAS por orden y volveria a pasar el gate de coordenadas y el tope de intentos, bloqueando
// ordenes que ya estan en la calle. Falsificar la custodia de un paquete es exactamente el riesgo
// que la 149 documenta.
//
// NO CONOCE HTTP NI PRISMA: se instancia con dobles en los tests.

/**
 * R4 — los UNICOS estados traspasables, y la lista vive en UNA sola constante.
 *
 * `en_reparto`: el caso de la ficha, el paquete va encima del mensajero.
 * `ayuda_tienda`: significa literalmente «el mensajero pidio ayuda y EL PAQUETE SIGUE CON EL, EN LA
 * CALLE» (235/R1). Es el MISMO hecho fisico, y este repo ya pago una vez el olvido de `ayuda_tienda`
 * en una lista de esta familia — de ahi la guardia `carga-del-mensajero`, a la que esta constante
 * entra como NOVENO miembro (D4, decidido por el humano el 2026-09-14).
 *
 * LOS QUE QUEDAN FUERA, y por que cada uno (design §2):
 *   · `por_recoger`          — el paquete esta EN LA BODEGA, no con nadie. Ya tiene su accion (149)
 *                              y su camino correcto es deshacer + reasignar, que vuelve a pasar el
 *                              gate de coordenadas, el tope de intentos y el dia.
 *   · `devolviendo_a_tienda` — decision del humano: ahi el problema es DONDE ESTA LA CAJA. Mover la
 *                              asignacion AFIRMARIA una custodia que nadie verifico.
 *   · `sin_gestionar`        — pertenece al cierre de su mensajero por un PREDICADO VIVO. Traspasarla
 *                              la sacaria del cierre abierto del origen y la meteria en el del
 *                              destino, en silencio y MOVIENDO DINERO.
 */
//
// FICHA 454 (T1.17, R54/R28): `ayuda_tienda` sale porque deja de ser estado — una orden con ayuda
// abierta sigue `en_reparto` y SIGUE siendo traspasable (con su ayuda abierta, R28). Lo que ya no se
// traspasa es una orden `en_reparto` con gestion PENDIENTE de confirmar: su gestion y su cierre son
// del mensajero de origen. Esa exclusion no cabe en una lista de estados: vive en la guarda de abajo
// y, bajo candado, en `traspasarMensajeroLote`.
export const ESTADOS_TRASPASABLES = ["en_reparto"];

/**
 * Metodos de repo que consume el service (inyeccion por constructor, `Pick` para dobles de test sin
 * DB, patron `DeshacerAsignacionRepo`).
 *
 * ⚠️ DOS AUSENCIAS DELIBERADAS, Y VAN ESCRITAS PORQUE EL PRECEDENTE DE ESTE REPO ES QUE UNA GUARDA
 * AUSENTE SIN RAZON ESCRITA SE VUELVE A CABLEAR SIN RELEER POR QUE SE QUITO (design §8):
 *
 *   1. **EL TOPE DE INTENTOS (276) NO SE APLICA (R14).** `contarIntentosEnLote` no figura en este
 *      `Pick`, asi que no se puede consultar por descuido. Esa puerta existe para que una orden
 *      agotada NO SALGA A LA CALLE — y esta YA esta en la calle. Aplicarla aqui dejaria el paquete
 *      en manos de un enfermo y sin salida; ademas un traspaso no cuenta ningun intento.
 *   2. **EL GATE DE COORDENADAS (92) NO SE APLICA (R14).** `findParaAsignabilidad` tampoco figura.
 *      La orden ya paso ese gate al asignarse. Sin coordenadas solo pierde su sitio en la ruta
 *      optimizada —queda como parada sin posicionar, al final—, que es un problema de ORDEN DE
 *      VISITA, no de custodia.
 *
 * ⚠️ Y UNA ASIMETRIA: `findMensajerosBloqueadosPorCierres` SI figura, pero se consulta SOLO sobre el
 * DESTINO (R11) y NUNCA sobre el ORIGEN (R12). Quitarle trabajo a quien esta atascado es lo
 * contrario de darselo — y el caso de la ficha es alguien que NO PUEDE SEGUIR. Bloquear el origen
 * atraparia exactamente el caso que esta ficha existe para desatascar.
 */
export type TraspasoMensajeroRepo = Pick<
  IOrdenRepository,
  | "findByIdsForTransicion"
  | "findEstatusIdByValue"
  | "findMensajeroIdsValidosByZona"
  | "findMensajeroIdsConVehiculo"
  | "findMensajerosNoAsignablesPorEstado"
  | "findMensajerosBloqueadosPorCierres"
  | "findMensajerosConOrdenesEn"
  | "findUsuarioNombre"
  | "traspasarMensajeroLote"
  // FICHA 454 (R54): el motivo en palabras de «ya esta gestionada».
  | "findIdsConGestionPendiente"
>;

/** FICHA 454 (R54): una orden gestionada y pendiente de confirmar no cambia de mensajero. */
const MSG_GESTION_PENDIENTE =
  "la orden ya esta gestionada y pendiente de confirmar: no se puede traspasar";

/** R13: lo que ocupa al destino con un viaje a tienda ya comprometido (regla de dedicacion, 157). */
const ESTADOS_RECOLECCION_PENDIENTE = ["recolectando"];

/** Fallo CERRADO: sin catalogo de estados no hay guarda de estado que aplicar. */
const MSG_CATALOGO_INCOMPLETO = "catalogo de estados incompleto (seed pendiente)";

export class TraspasoMensajeroService implements ITraspasoMensajeroService {
  /**
   * ⚠️ EL CABLEADO ES LA MITAD DEL REQUISITO. Los DOS notificadores tienen como DEFAULT el NO-OP
   * (patron `notificadores.ts`): un service construido sin cablearlos —tipicamente un doble de
   * test— no escribe ni una notificacion, POR CONSTRUCCION y sin husmear el entorno. Los REALES los
   * inyecta el composition root, que aqui es la Server Action `lib/actions/traspasar-mensajero.ts`.
   *
   * Este repo ya tuvo **2 de 7 notificadores muertos con la suite entera en verde** porque nadie
   * comprobaba que alguien los PASARA, solo que el modulo los importara. Por eso hay un test del
   * composition root (`tests/unit/actions/traspasar-mensajero.test.ts`) que afirma que el servicio
   * los RECIBE, y no que la accion los importe.
   */
  constructor(
    private readonly repo: TraspasoMensajeroRepo,
    private readonly notificarRecibido: TraspasoRecibidoNotificador = notificadorNoOp,
    private readonly notificarCedido: TraspasoCedidoNotificador = notificadorNoOp,
  ) {}

  async traspasar(
    input: TraspasarMensajeroInput,
    actor: Actor,
  ): Promise<TraspasoMensajeroServiceResult> {
    // 1. R1/R2/R3 — AUTORIZACION POR ROL ANTES DE TOCAR DATO ALGUNO. `maestro` y `admin`, los
    //    mismos que hoy asignan desde la central. Cualquier otro rol —`mensajero`, `adminTienda`,
    //    `adminSatelite` y las credenciales de API— sale por aqui SIN una sola lectura.
    //
    //    El `adminSatelite` queda FUERA en esta ficha (D1, decidido el 2026-09-14): hoy no tiene
    //    NINGUNA superficie donde ver una orden `en_reparto` —su pantalla trabaja sobre
    //    `en_bodega_satelite`, paquetes que aun no ha recogido nadie— y abrirlo exige acotar por
    //    zona las ordenes Y los mensajeros mas su guarda de bodega bloqueada: es otra superficie, no
    //    un `||` mas. Queda como seguimiento S1.
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    const ordenIds = [...new Set(input.ordenIds)];
    // Inalcanzable DESDE LA ACTION (`ordenIds` exige `.min(1)`). Defensa en profundidad para
    // llamadas directas al service.
    if (ordenIds.length === 0) {
      return { status: "validation_error", fieldErrors: { ordenIds: ["lote vacio"] } };
    }

    // 2. R5/R6/R8 — PRE-CARGA Y ORIGEN DERIVADO. `findByIdsForTransicion` incluye las borradas, que
    //    es lo que permite distinguir «no existe» de «borrada» en el motivo.
    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    const detalle: DetalleConflicto[] = [];
    const validas: OrdenTransicionRow[] = [];
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (!orden) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_EXISTE });
        continue;
      }
      if (orden.deletedAt !== null) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_BORRADA });
        continue;
      }
      // R4/R5: el rechazo NOMBRA el estado, para que el operador sepa QUE hacer con esa orden.
      if (!ESTADOS_TRASPASABLES.includes(orden.estatusValue)) {
        detalle.push({ ordenId: id, motivo: msgEstadoNoTraspasable(orden.estatusValue) });
        continue;
      }
      // Una orden traspasable SIN mensajero no deberia existir (los dos estados llegan asignados),
      // pero si apareciera no es un traspaso: es una asignacion. Fallo CERRADO.
      if (!orden.mensajeroAsignadoId) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_SIN_MENSAJERO });
        continue;
      }
      validas.push(orden);
    }
    // FICHA 454 (R54): gestionada = pendiente de confirmar; no se traspasa.
    const pendientes = await this.repo.findIdsConGestionPendiente(validas.map((o) => o.id));
    for (const o of validas) {
      if (pendientes.has(o.id)) detalle.push({ ordenId: o.id, motivo: MSG_GESTION_PENDIENTE });
    }
    // R5: una sola rechazada aborta el lote ENTERO y SIN EFECTOS — ni una escritura, ni una fila de
    // rastro, ni una conversacion movida.
    if (detalle.length > 0) return { status: "conflict", detalle };

    // R6/R8 — EL ORIGEN SE DERIVA DE LAS ORDENES, Y TIENE QUE SER UNO SOLO. Un lote con dos origenes
    // no tiene caso de uso, deja la confirmacion de R35 sin poder decir «de quien a quien» y haria
    // ambiguo el encolado de reoptimizacion (habria que reoptimizar N rutas de origen).
    const origenes = new Set(validas.map((o) => o.mensajeroAsignadoId as string));
    if (origenes.size > 1) {
      // El motivo va POR ORDEN, como el resto de las guardas de lote: las que no son del primer
      // mensajero se nombran, para que quien traspasa vea CUALES sobran.
      const mayoritario = validas[0].mensajeroAsignadoId as string;
      return {
        status: "conflict",
        detalle: validas.map((o) => ({
          ordenId: o.id,
          motivo:
            o.mensajeroAsignadoId === mayoritario ? MSG_ORIGEN_NO_UNICO : MSG_ORDEN_DE_OTRO_MENSAJERO,
        })),
      };
    }
    const mensajeroOrigenId = [...origenes][0];

    // 3. R7 — destino == origen. La UI ya lo excluye del selector y el CHECK de la base lo hace
    //    inescribible; esta es la red del medio, y la que produce un motivo legible.
    if (input.mensajeroDestinoId === mensajeroOrigenId) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroDestinoId: [MSG_DESTINO_IGUAL_A_ORIGEN] },
      };
    }

    // 4. LAS GUARDAS DEL DESTINO, en el orden de design §8.
    //
    //    R9: rol `mensajero` Y de la zona de CADA orden del lote. Se evalua zona por zona porque un
    //    lote puede mezclar zonas y el destino tiene que servir para TODAS: un mensajero de la zona
    //    A no puede quedarse con una orden de la zona B.
    for (const zonaId of new Set(validas.map((o) => o.zonaId))) {
      const validos = await this.repo.findMensajeroIdsValidosByZona(
        [input.mensajeroDestinoId],
        zonaId,
      );
      if (!validos.has(input.mensajeroDestinoId)) {
        return {
          status: "validation_error",
          fieldErrors: { mensajeroDestinoId: [MSG_DESTINO_NO_VALIDO] },
        };
      }
    }

    // R10: vehiculo. Motivo PROPIO (no «no valido»): el mensajero existe y es de la zona; lo que
    // falta es su vehiculo, y eso se arregla en otra pantalla.
    const conVehiculo = await this.repo.findMensajeroIdsConVehiculo([input.mensajeroDestinoId]);
    if (!conVehiculo.has(input.mensajeroDestinoId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroDestinoId: [MSG_MENSAJERO_SIN_VEHICULO] },
      };
    }

    // R10: estado de cuenta que admite trabajo. Un mensajero dado de baja no recibe 31 paquetes.
    const noAsignables = await this.repo.findMensajerosNoAsignablesPorEstado([
      input.mensajeroDestinoId,
    ]);
    if (noAsignables.has(input.mensajeroDestinoId)) {
      return {
        status: "validation_error",
        fieldErrors: { mensajeroDestinoId: [MSG_MENSAJERO_NO_ASIGNABLE] },
      };
    }

    // R11: DESTINO bloqueado por cierres. Regla de la 271: RECIBIR TRABAJO NUEVO si se bloquea.
    //
    // ⚠️ R12 — EL **ORIGEN** NO SE CONSULTA, Y ES UNA DECISION, NO UN OLVIDO. Quitarle trabajo a
    // quien esta atascado es lo contrario de darselo, y el caso de la ficha es alguien que NO PUEDE
    // SEGUIR. Aplicar aqui la guarda al origen atraparia exactamente el caso que esta ficha existe
    // para desatascar: el mensajero enfermo que ademas arrastra un cierre sin aprobar se quedaria
    // con sus 31 paquetes.
    const bloqueados = await this.repo.findMensajerosBloqueadosPorCierres([
      input.mensajeroDestinoId,
    ]);
    if (bloqueados.has(input.mensajeroDestinoId)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({
          ordenId,
          motivo: MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
        })),
      };
    }

    // R13: regla de dedicacion de la 157. Quien tiene un viaje a tienda comprometido no puede
    // ademas llevar reparto: saldria con el vehiculo lleno a recoger un lote.
    const conRecoleccion = await this.repo.findMensajerosConOrdenesEn(
      [input.mensajeroDestinoId],
      ESTADOS_RECOLECCION_PENDIENTE,
    );
    if (conRecoleccion.has(input.mensajeroDestinoId)) {
      return {
        status: "conflict",
        detalle: ordenIds.map((ordenId) => ({ ordenId, motivo: MSG_MENSAJERO_CON_RECOLECCION })),
      };
    }

    // 5. El catalogo de estados: el repositorio guarda por `estatus_id`, no por `value`. Falta de
    //    seed => `validation_error` (fallo CERRADO), mismo mensaje que el resto de services.
    const idPorValue = new Map<string, string>();
    for (const value of ESTADOS_TRASPASABLES) {
      const id = await this.repo.findEstatusIdByValue(value);
      if (id === null) {
        return { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] } };
      }
      idPorValue.set(value, id);
    }

    // 6. R27 — EL `lote_id` DEL ACTO. Uno por traspaso, no uno por orden: es lo que distingue «se
    //    traspasaron 31 ordenes de una vez» de «hubo 31 traspasos», y es ADEMAS la entidad de los
    //    dos avisos (design §6.5). Se genera AQUI, que es la unica capa que sabe donde empieza y
    //    donde acaba un acto.
    const loteId = randomUUID();
    const items: TraspasoMensajeroItem[] = validas.map((o) => ({
      ordenId: o.id,
      // R24: el estatus que ESTE servicio acaba de validar. El repositorio compara contra el bajo
      // `FOR UPDATE`, asi que si alguien movio la orden entremedias el lote entero se revierte.
      estatusIdEsperado: idPorValue.get(o.estatusValue) as string,
    }));

    // 7. R15-R32 — LA ESCRITURA, todo-o-nada, con el chat, el rastro y los DOS encolados dentro.
    let aplicado;
    try {
      aplicado = await this.repo.traspasarMensajeroLote({
        loteId,
        mensajeroOrigenId,
        mensajeroDestinoId: input.mensajeroDestinoId,
        ordenes: items,
        // R25/R26: quien traspaso y con que rol. El rol se CONGELA en la fila del rastro: el rol
        // vivo de esa persona puede cambiar manana y la historia no se re-etiqueta.
        actor: { usuarioId: actor.usuarioId, rol: actor.rol },
        motivo: input.motivo, // R28: uno por lote, ya recortado en el borde
      });
    } catch (error) {
      if (error instanceof TraspasoMensajeroConflictoError) {
        // R24: alguien movio la orden entre la validacion y la escritura. La tx YA revirtio el lote
        // COMPLETO; aqui solo se compone el detalle re-leyendo el estado (patron `detalleCarrera`
        // de la 149).
        return { status: "conflict", detalle: await this.detalleCarrera(error, mensajeroOrigenId) };
      }
      throw error;
    }

    // 8. LOS NOMBRES, para que la pantalla pueda decir «de quien a quien» (R35/R36) y para el anexo
    //    de los dos avisos. Se leen DESPUES de la escritura: no son insumo de ninguna guarda.
    const [origenNombre, destinoNombre] = await Promise.all([
      this.repo.findUsuarioNombre(mensajeroOrigenId),
      this.repo.findUsuarioNombre(input.mensajeroDestinoId),
    ]);

    // 9. R38-R43 — LOS DOS AVISOS, **FUERA** DE LA TRANSACCION Y BEST-EFFORT.
    //
    //    ⚠️ Fuera y best-effort, y NO por comodidad (design §6.5): dentro de una transaccion de
    //    Postgres un error de sentencia aborta la transaccion ENTERA, asi que un aviso caido
    //    REVERTIRIA un traspaso legitimo y dejaria el paquete en manos de quien ya no puede
    //    entregarlo. La direccion segura del error es la contraria: EL TRASPASO MANDA, EL AVISO ES
    //    CORTESIA. Los notificadores son `emitirBestEffort` por dentro, asi que no propagan; el
    //    `try` es la red por si alguien inyecta uno que SI lo haga — y el resultado sigue siendo
    //    `ok`, porque el traspaso YA esta escrito (R41).
    //
    //    UNO POR ACTO Y POR MENSAJERO (R38/R39), jamas uno por orden: con 31 ordenes serian 31
    //    campanadas y 31 interrupciones de push, y la accion que el aviso pide no es sobre un
    //    paquete concreto sino sobre la lista entera.
    //
    //    EL ANEXO ES EL NOMBRE DEL **OTRO** MENSAJERO en cada uno: es el dato con el que la persona
    //    entiende que paso. NI EL MOTIVO escrito por quien traspaso ni ningun dato del destinatario
    //    de las ordenes (R40).
    try {
      await this.notificarRecibido({
        loteId: aplicado.loteId,
        mensajeroUsuarioId: input.mensajeroDestinoId,
        cuantas: aplicado.movidas,
        otroMensajeroNombre: origenNombre,
      });
    } catch {
      // El notificador ya registra el fallo con contexto (`emitirBestEffort` -> `defaultLogger`).
      // Aqui no se vuelve a loggear para no duplicar la entrada, y NO se propaga: el traspaso esta
      // escrito y quien lo pidio tiene que verlo como lo que es, un exito.
    }
    try {
      await this.notificarCedido({
        loteId: aplicado.loteId,
        mensajeroUsuarioId: mensajeroOrigenId,
        cuantas: aplicado.movidas,
        otroMensajeroNombre: destinoNombre,
      });
    } catch {
      // Idem. Y en `try` SEPARADO del de arriba a proposito: si el primero revienta, el segundo
      // tiene que emitirse igual — con un solo `try` envolviendo a los dos, un fallo del aviso al
      // destino dejaria al origen sin el suyo, en silencio.
    }

    return {
      status: "ok",
      movidas: aplicado.movidas,
      conversaciones: aplicado.conversaciones,
      origen: { id: mensajeroOrigenId, nombre: origenNombre ?? "" },
      destino: { id: input.mensajeroDestinoId, nombre: destinoNombre ?? "" },
    };
  }

  /**
   * R24 — motivo POR ORDEN de las que perdieron la carrera, re-leyendo su estado actual. Patron
   * `detalleCarrera` de la 149: la transaccion ya revirtio el lote completo, asi que esto solo
   * compone el mensaje.
   */
  private async detalleCarrera(
    error: TraspasoMensajeroConflictoError,
    mensajeroOrigenId: string,
  ): Promise<DetalleConflicto[]> {
    const ids = [...error.ordenIdsNoMovidas];
    const actuales = await this.repo.findByIdsForTransicion(ids);
    const actualMap = new Map(actuales.map((o) => [o.id, o]));
    return ids.map((ordenId) => {
      const orden = actualMap.get(ordenId);
      if (!orden) return { ordenId, motivo: MSG_ORDEN_NO_EXISTE };
      if (orden.deletedAt !== null) return { ordenId, motivo: MSG_ORDEN_BORRADA };
      if (!ESTADOS_TRASPASABLES.includes(orden.estatusValue)) {
        return { ordenId, motivo: msgEstadoNoTraspasable(orden.estatusValue) };
      }
      if (orden.mensajeroAsignadoId !== mensajeroOrigenId) {
        return { ordenId, motivo: MSG_ORDEN_DE_OTRO_MENSAJERO };
      }
      return { ordenId, motivo: MSG_CARRERA_TRASPASO };
    });
  }
}
