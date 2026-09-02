import {
  DeshacerAsignacionConflictoError,
  type DeshacerAsignacionItem,
  type IOrdenRepository,
  type OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type {
  DeshacerAsignacionInput,
  DeshacerAsignacionServiceResult,
  DestinoReversion,
  IDeshacerAsignacionService,
} from "@/lib/interfaces/services/IDeshacerAsignacionService";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_DESTINO_NO_DECLARADO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_HISTORIAL,
  msgEstadoNoReversible,
} from "@/lib/services/mensajes-deshacer-asignacion";

// Feature 149 — logica de negocio del "deshacer asignacion". Servicio PROPIO (design §7-C: no
// se extiende `RecuperacionBodegaService`, cuya guarda es `devuelta`, cuyo origen_tipo es
// `recuperacion_manual` y que ENCIENDE `prioridad`). No conoce HTTP ni Prisma: se instancia con
// dobles en los tests.

/** R16: unicos estados de origen reversibles. Cualquier otro es `conflict` con su nombre. */
const ORIGENES_REVERSIBLES: ReadonlySet<string> = new Set([
  "por_recoger", // caso (a): asignada a un mensajero que aun no la recogio
  "en_ruta_bodega_satelite", // caso (b): ruteada a una satelite que aun no la recibio
]);

/**
 * R12/D3' — tabla CERRADA de normalizacion del origen leido del historial al destino de la
 * reversion. Un origen que NO este aqui se rechaza (R13, fallo cerrado): no se adivina.
 * `en_fulfillment`/`en_preparacion` normalizan a `en_bodega_central` porque las transiciones
 * que los producen dejan el paquete en la bodega CENTRAL, y volver a un estado pre-guia con
 * `num_guia` ya impreso seria un hibrido inconsistente (design §D3').
 *
 * ⚠️ `en_fulfillment` SE CONSERVA aunque la feature 155 lo retirara del catalogo, y no es un
 * descuido de la integracion. Las claves de este mapa son origenes LEIDOS DEL HISTORIAL, no
 * estados alcanzables hoy: `orden_historial_estado` sigue citando ese value en filas anteriores
 * a la 155 —es exactamente la razon por la que el `DELETE` condicional de su migracion resulto
 * NO-OP y la fila del catalogo sobrevivio huerfana—. Una orden asignada ANTES de la 155 que hoy
 * siga en `por_recoger` tiene ese origen en su historial; quitar la entrada la haria fallar
 * CERRADO (R13) al deshacer, en vez de devolverla a la bodega central. Por eso el tipo de la
 * clave es `string` y no `OrderStatusValue`: el historial es inmutable y sobrevive al catalogo.
 */
const NORMALIZACION_DESTINO: ReadonlyMap<string, DestinoReversion> = new Map([
  ["en_bodega_central", "en_bodega_central"],
  ["en_bodega_satelite", "en_bodega_satelite"],
  ["en_fulfillment", "en_bodega_central"],
  ["en_preparacion", "en_bodega_central"],
]);

const ROL_SATELITE = "adminSatelite";

/** La familia de transiciones que ESTA accion escribe (`origen_tipo` de su fila de historial). */
const FAMILIA_DESHACER = "deshacer_asignacion";

/**
 * FICHA 363 — CONTRA QUE SE VERIFICA LA INFERENCIA, AHORA QUE NO ES CONTRA LA ZONA.
 *
 * Por cada estado de origen, los destinos que el inventario CERRADO de la feature 140 declara
 * PARA LA FAMILIA `deshacer_asignacion`. Derivado de `TRANSICIONES`, no re-escrito: una arista
 * nueva o retirada llega aqui sola, y una segunda copia seria una segunda verdad.
 *
 * Hoy vale exactamente:
 *   por_recoger              -> { en_bodega_central, en_bodega_satelite }   (#46, #47)
 *   en_ruta_bodega_satelite  -> { en_bodega_central }                       (#45)
 *   recolectando             -> { por_recolectar_en_tienda }                (#46 de la 157)
 *
 * POR QUE ESTA ES LA AUTORIDAD CORRECTA Y LA ZONA NO LO ERA:
 *
 *  1. La zona dice a que bodega PERTENECE la orden, NO donde esta el paquete. Una orden de zona
 *     satelite espera en la bodega CENTRAL hasta que la rutean: ese es el flujo normal, y la
 *     comparacion anterior lo llamaba incoherencia. Mismo malentendido que corrigio la 357.
 *  2. Verificar el destino CONTRA EL HISTORIAL —de donde ya sale— seria una asercion contra su
 *     propia fuente: siempre verde. Y en su version util («solo se vuelve a donde la orden
 *     estuvo») rompe justo las dos filas que SI son inferencia: `en_fulfillment` y
 *     `en_preparacion` normalizan a `en_bodega_central` sin que la orden haya pasado por ahi.
 *  3. Esta comprobacion NO es redundante con la guardia de escritura. `assertTransicionValida`
 *     (140) ignora la familia a proposito, asi que para una orden en `en_ruta_bodega_satelite`
 *     DEJARIA PASAR el destino `en_bodega_satelite`: esa arista existe (#10), pero es la de la
 *     RECEPCION SATELITE. Sin este filtro por familia, una inferencia equivocada no reventaria:
 *     escribiria «recibida en la satelite» un paquete que nadie recibio, en silencio y con el
 *     historial diciendo `deshacer_asignacion`. Falsificar la custodia de un paquete es
 *     exactamente el riesgo que la guarda original queria cubrir.
 */
const DESTINOS_DECLARADOS_DESHACER: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(TRANSICIONES).map(([origen, destinos]) => [
    origen,
    new Set(destinos.filter((d) => d.via === FAMILIA_DESHACER).map((d) => d.to)),
  ]),
);

/**
 * Metodos de repo que consume el service (inyeccion por constructor, `Pick` para dobles de test
 * sin DB). `findMensajerosBloqueadosPorCierres` NO figura A PROPOSITO (Q1 CERRADA, R19): QUITARLE
 * trabajo a un mensajero no es DARSELO ni gestionarlo, asi que su bloqueo por cierres no aplica —la
 * orden nunca se recogio y no hay dinero asociado—. Dejarlo fuera del tipo hace imposible
 * consultarlo por descuido.
 *
 * ⚠️ FEATURE 271 (2026-08-23): la exclusion NO cambia, pero su vecina SI. La ASIGNACION volvio a
 * consultar el predicado —recibir trabajo nuevo se bloquea otra vez, reparto Y recoleccion—, asi que
 * la asimetria que aqui se afirma ya no es «asignar tampoco mira cierres»: es «desasignar no, y
 * asignar si».
 */
export type DeshacerAsignacionRepo = Pick<
  IOrdenRepository,
  "findUsuarioZonaId" | "findByIdsForTransicion" | "findEstatusIdByValue" | "deshacerAsignacionLote"
>;

export type DeshacerAsignacionHistorialRepo = Pick<
  IOrdenHistorialRepository,
  "findOrigenesReversion"
>;

/**
 * FICHA 363 — AQUI VIVIA `DeshacerAsignacionZonaRepo`, el `Pick` de `IZonaRepository` con el
 * que se leia el id de la zona central, Y SE VA CON LA COMPARACION QUE LO NECESITABA.
 *
 * Ese id tenia UN solo consumidor: la guarda de coherencia zona/destino. Retirada esa
 * comparacion, mantener la dependencia habria dejado (i) una consulta cuyo resultado nadie lee y
 * (ii) un `validation_error` («zona central no configurada») que bloqueaba el deshacer sin
 * proteger nada. La zona del ACTOR (R4/R5/R6) no se toca: sale de `repo.findUsuarioZonaId` y
 * sigue igual.
 */
export class DeshacerAsignacionService implements IDeshacerAsignacionService {
  constructor(
    private readonly repo: DeshacerAsignacionRepo,
    private readonly historialRepo: DeshacerAsignacionHistorialRepo,
  ) {}

  async deshacer(
    input: DeshacerAsignacionInput,
    actor: Actor,
  ): Promise<DeshacerAsignacionServiceResult> {
    // 1. R1/R2: autorizacion por ROL antes de tocar dato alguno. Ningun otro rol pasa.
    const esSatelite = actor.rol === ROL_SATELITE;
    if (!esAccesoTotal(actor.rol) && !esSatelite) return { status: "forbidden" };

    const ordenIds = [...new Set(input.ordenIds)];
    if (ordenIds.length === 0) return { status: "ok", resultados: [] };

    // 2. R6: la zona del `adminSatelite` se resuelve SERVER-SIDE, nunca se acepta del cliente.
    // Acceso total => `null` => sin restriccion de zona (R3).
    const zonaActor = esSatelite ? await this.repo.findUsuarioZonaId(actor.usuarioId) : null;
    if (esSatelite && zonaActor === null) return { status: "sin_zona" };

    // 3. FICHA 363: aqui se leia la zona central para poder compararla con la de la orden. La
    // comparacion se fue (paso 6) y la lectura con ella; la guarda de configuracion que la
    // acompanaba no protegia nada por si sola.

    // 4. R16/R17/R18 + R4: precarga (incluye borradas, para distinguir motivos).
    const ordenes = await this.repo.findByIdsForTransicion(ordenIds);
    const ordenMap = new Map(ordenes.map((o) => [o.id, o]));

    // R4: zona ajena => `forbidden` del LOTE COMPLETO (no `conflict`): el actor no tiene
    // permiso sobre esa orden, no es un problema de estado. Se evalua primero para no filtrar
    // el estado de una orden que el actor no deberia poder mirar.
    if (zonaActor !== null) {
      for (const orden of ordenes) {
        if (orden.deletedAt === null && orden.zonaId !== zonaActor) return { status: "forbidden" };
      }
    }

    const detalle: DetalleConflicto[] = [];
    const validas: OrdenTransicionRow[] = [];
    for (const id of ordenIds) {
      const orden = ordenMap.get(id);
      if (!orden) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_NO_EXISTE }); // R18
        continue;
      }
      if (orden.deletedAt !== null) {
        detalle.push({ ordenId: id, motivo: MSG_ORDEN_BORRADA }); // R17
        continue;
      }
      if (!ORIGENES_REVERSIBLES.has(orden.estatusValue)) {
        detalle.push({ ordenId: id, motivo: msgEstadoNoReversible(orden.estatusValue) }); // R16
        continue;
      }
      validas.push(orden);
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R20: sin efectos

    // 5. Catalogo de estados. Se resuelve ANTES de la derivacion (y no en el paso 8 del design)
    // porque `findOrigenesReversion` necesita el `estatus_id` ACTUAL de cada orden, no su
    // `value`. Falta de seed => `validation_error`, mismo mensaje que el resto de services.
    const valoresNecesarios = [
      ...ORIGENES_REVERSIBLES,
      "en_bodega_central",
      "en_bodega_satelite",
    ];
    const idsCatalogo = new Map<string, string>();
    for (const value of valoresNecesarios) {
      const id = await this.repo.findEstatusIdByValue(value);
      if (id === null) {
        return {
          status: "validation_error",
          fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] },
        };
      }
      idsCatalogo.set(value, id);
    }

    // 6. R11/R12: derivacion del destino DESDE EL HISTORIAL (jamas desde la zona), UNA consulta
    // para todo el lote.
    const origenes = await this.historialRepo.findOrigenesReversion(
      validas.map((o) => ({
        ordenId: o.id,
        estatusActualId: idsCatalogo.get(o.estatusValue) as string,
      })),
    );

    const items: DeshacerAsignacionItem[] = [];
    const origenEstatusIdPorOrden = new Map<string, string>();
    const destinoPorOrden = new Map<string, DestinoReversion>();
    for (const orden of validas) {
      const origenValue = origenes.get(orden.id) ?? null;
      const destino = origenValue === null ? undefined : NORMALIZACION_DESTINO.get(origenValue);
      if (destino === undefined) {
        // R13 (fallo CERRADO): sin fila, fila de creacion (origen NULL) o origen fuera de la
        // tabla de normalizacion. NUNCA se adivina un destino.
        detalle.push({ ordenId: orden.id, motivo: MSG_SIN_HISTORIAL });
        continue;
      }
      // R14/R15 (FICHA 363): la normalizacion SIGUE SIENDO una inferencia y SIGUE VERIFICANDOSE,
      // pero contra el inventario CERRADO de transiciones de la 140 filtrado por la familia de
      // ESTA accion —no contra la zona de la orden, que dice a que bodega PERTENECE y no donde
      // esta el paquete—. Ver `DESTINOS_DECLARADOS_DESHACER` para el porque de esta autoridad.
      //
      // Lo que caza, y que la guardia de escritura NO cazaria: una orden en
      // `en_ruta_bodega_satelite` cuyo destino inferido fuese `en_bodega_satelite`. Nadie la ha
      // recibido en la satelite; escribir ese estado falsificaria la custodia del paquete.
      // Fallo CERRADO: un estado sin entrada en el mapa tampoco pasa.
      const declarados = DESTINOS_DECLARADOS_DESHACER.get(orden.estatusValue);
      if (declarados === undefined || !declarados.has(destino)) {
        detalle.push({ ordenId: orden.id, motivo: MSG_DESTINO_NO_DECLARADO });
        continue;
      }
      items.push({ ordenId: orden.id, destinoEstatusId: idsCatalogo.get(destino) as string });
      origenEstatusIdPorOrden.set(orden.id, idsCatalogo.get(orden.estatusValue) as string);
      destinoPorOrden.set(orden.id, destino);
    }
    if (detalle.length > 0) return { status: "conflict", detalle }; // R20: sin efectos

    // 7. R5: el `adminSatelite` solo deshace hacia SU bodega. Un destino `en_bodega_central`
    // (caso b, o una orden de la central) es competencia de la bodega central: `forbidden`.
    if (esSatelite) {
      for (const destino of destinoPorOrden.values()) {
        if (destino !== "en_bodega_satelite") return { status: "forbidden" };
      }
    }

    // 8. R19 (Q1 CERRADA): NO se consulta `findMensajerosBloqueadosPorCierres`. El cierre pendiente
    // del mensajero NO bloquea el DESHACER: la orden nunca se recogio, no hay dinero asociado, y
    // quitarle trabajo a quien esta atascado es lo contrario de darselo.
    //
    // ⚠️ FEATURE 271 (2026-08-23): la ASIGNACION volvio a aplicar el predicado —y ahora tambien la
    // recoleccion—, asi que la asimetria deliberada de esta linea es «desasignar no, asignar si», y
    // sigue fijada por un test.

    // 9. Escritura transaccional todo-o-nada (R20/R21). `zonaActor` no-null => guarda de zona
    // repetida en el WHERE del UPDATE (defensa en profundidad anti-TOCTOU).
    try {
      await this.repo.deshacerAsignacionLote(
        items,
        origenEstatusIdPorOrden,
        {
          actorUsuarioId: actor.usuarioId,
          origenTipo: "deshacer_asignacion", // R25
          motivo: input.motivo, // R23/R24: uno por lote, ya recortado en el borde
        },
        zonaActor,
      );
    } catch (error) {
      if (error instanceof DeshacerAsignacionConflictoError) {
        // R21: alguien recogio/recibio/corto la orden entre la validacion y la escritura. La
        // tx ya revirtio el lote COMPLETO; aqui solo se compone el detalle re-leyendo el estado.
        return { status: "conflict", detalle: await this.detalleCarrera(error) };
      }
      throw error;
    }

    // 10. R8/R9/R10: lote revertido.
    return {
      status: "ok",
      resultados: items.map((i) => ({
        ordenId: i.ordenId,
        estado: destinoPorOrden.get(i.ordenId) as DestinoReversion,
      })),
    };
  }

  /** R21: motivo por orden de las que perdieron la carrera, re-leyendo su estado actual. */
  private async detalleCarrera(
    error: DeshacerAsignacionConflictoError,
  ): Promise<DetalleConflicto[]> {
    const ids = [...error.ordenIdsNoTransicionadas];
    const actuales = await this.repo.findByIdsForTransicion(ids);
    const actualMap = new Map(actuales.map((o) => [o.id, o]));
    return ids.map((ordenId) => {
      const orden = actualMap.get(ordenId);
      if (!orden) return { ordenId, motivo: MSG_ORDEN_NO_EXISTE };
      if (orden.deletedAt !== null) return { ordenId, motivo: MSG_ORDEN_BORRADA };
      if (!ORIGENES_REVERSIBLES.has(orden.estatusValue)) {
        return { ordenId, motivo: msgEstadoNoReversible(orden.estatusValue) };
      }
      return { ordenId, motivo: MSG_CARRERA };
    });
  }
}
