import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import {
  SinGestionDevueltaError,
  type IGestionOrdenRepository,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRechazoTiendaService,
  RechazarNovedadResult,
} from "@/lib/interfaces/services/IRechazoTiendaService";

// Estado de ORIGEN elegible (la DEVOLUCION ANCLADA de la 239: confirmada en bodega, visible para la
// tienda y con el reloj corriendo) y destino del rechazo. Valores de catalogo ya sembrados
// (`order_status`); esta feature NO agrega estados (R44).
//
// ⚠️ El destino sale del CATALOGO (`findEstatusIdByValue`), no de `ESTATUS_POR_RESULTADO`
// (`lib/types/gestion-destino.ts`). Ese mapa es «de resultado de gestion a estatus» y para
// `rechazada` devuelve `rechazada`, asi que usarlo aqui funcionaria POR COINCIDENCIA DE NOMBRE, no
// por significado: el origen de esta transicion es un ESTADO, no un resultado. La 239 ya rompio esa
// identidad de nombre para `devuelta` (su resultado lleva a `devolucion_por_confirmar`), y este es
// justo el sitio donde apoyarse en ella cuesta caro.
const ESTADO_ORIGEN = "devuelta";
const ESTADO_DESTINO = "rechazada";

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como `Pick` para
// poder usar dobles de test sin DB/HTTP (patron `ReprogramacionTiendaService`).
type RechazoOrdenRepo = Pick<IOrdenRepository, "findById" | "findEstatusIdByValue">;
type RechazoGestionRepo = Pick<IGestionOrdenRepository, "rechazarDesdeDevuelta">;

/**
 * 💰 Feature 240 — logica de negocio del RECHAZO MANUAL por la tienda. Impone la AUTZ por tienda
 * dueña (`adminTienda` cuya `usuarioId` ES el `orden.tienda_id`, patron `NovedadesService`/
 * `ReprogramacionTiendaService`) y la GUARDIA de estado (solo desde la devolucion anclada), y
 * delega la transicion atomica + la gestion sintetica al repo (choke point de la feature 49). No
 * conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 *
 * POR QUE UN SERVICIO NUEVO Y NO UN METODO DE `ReprogramacionTiendaService`: el nombre de esa clase
 * describe LO QUE HACE, y meter dentro el rechazo la convertiria en «el servicio de las cosas que la
 * tienda hace desde novedades», que es un cajon. Dos clases de treinta lineas con una guarda cada
 * una son mas baratas de leer que una de sesenta con dos caminos — y aqui uno de los dos mueve
 * dinero irreversible.
 */
export class RechazoTiendaService implements IRechazoTiendaService {
  constructor(
    private readonly ordenRepo: RechazoOrdenRepo,
    private readonly gestionRepo: RechazoGestionRepo,
  ) {}

  async rechazar(
    ordenId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarNovedadResult> {
    // 1. Cargar la orden; `findById` excluye borradas -> not_found.
    const orden = await this.ordenRepo.findById(ordenId);
    if (!orden) return { status: "not_found" };

    // 2. R2 — AUTZ por tienda dueña, ANTES de cualquier escritura y ANTES de mirar el estado. Solo
    //    el adminTienda cuya identidad ES el `orden.tienda_id`. Cualquier otro rol o tienda ->
    //    forbidden, sin efectos y SIN revelar en que estado esta la orden: el mismo valor para las
    //    dos causas, que es lo que impide usar este borde como oraculo de ordenes ajenas.
    if (actor.rol !== "adminTienda" || orden.tiendaId !== actor.usuarioId) {
      return { status: "forbidden" };
    }

    // 3. R3 — guardia de estado de origen. Elegible SOLO desde la devolucion anclada.
    //
    //    ⚠️ ESTO ES UNA LECTURA OPTIMISTA Y SE SABE: la barrera REAL es el `where` del `updateMany`
    //    del paso 5 (R4), que comprueba y escribe en la misma sentencia. Entre este `if` y aquella
    //    sentencia el cron de la 99 puede escalar la orden. Existe igualmente porque permite
    //    devolver `conflict` con su motivo SIN haber intentado escribir, que es lo que hace la
    //    pantalla legible: la tienda lee «esta orden ya no estaba en devolucion» en vez de un error.
    //
    //    NO se comprueba si el plazo vencio (R25/D9): el plazo decide cuando nadie decide.
    //    NO se comprueba el bloqueo del cierre del mensajero: seria un interbloqueo (la tienda no
    //    podria resolver su orden porque el mensajero no cerro su dia).
    if (orden.estatusValue !== ESTADO_ORIGEN) {
      return {
        status: "conflict",
        motivo: `la orden no esta en ${ESTADO_ORIGEN} (estado actual: ${orden.estatusValue ?? "desconocido"})`,
      };
    }

    // 4. Resolver los estatus del catalogo (guarda + destino). Falta de seed -> config_error, que
    //    es FALLO CERRADO: sin el id de `devuelta` no hay guarda que poner en el `where`, y escribir
    //    sin guarda es exactamente lo que R4 prohibe.
    const [estatusDevueltaId, estatusRechazadaId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTADO_ORIGEN),
      this.ordenRepo.findEstatusIdByValue(ESTADO_DESTINO),
    ]);
    if (estatusDevueltaId === null || estatusRechazadaId === null) {
      return { status: "config_error" };
    }

    // 5. 💰 Transicion atomica + gestion sintetica via el choke point de la 49 (R8-R16). La guarda
    //    por `estatus_id = devuelta` del repo hace la accion idempotente frente al doble envio y a
    //    la carrera con el cron: si perdio la carrera (`count = 0`), el repo devuelve `false` sin
    //    dejar ni un efecto, y el `cobroRechazado` no se cobra dos veces (R21).
    //
    //    ⚠️ R10 — Y SI LA ORDEN NO TIENE GESTION `devuelta` VIGENTE, EL REPO LANZA. Ese `throw` es
    //    correcto y se queda: es lo que ABORTA la transaccion y revierte el `updateMany`, en vez de
    //    dejar la orden en `rechazada` sin gestion y sin historial. Lo que NO era correcto es como
    //    salia de aqui. Hasta el 2026-08-20 subia como un `Error` pelado, se normalizaba a
    //    `INTERNAL` y `toResolverNovedadActionError` LANZABA al no reconocer ese codigo: la tienda
    //    pulsaba «Rechazar» con su motivo escrito y NO PASABA NADA — ni cambio, ni aviso—. Un boton
    //    mudo, que es el defecto que esta ficha vino a cerrar, una capa mas abajo.
    //
    //    Se captura SOLO esa clase y se re-lanza todo lo demas: una caida de base tiene que seguir
    //    siendo `INTERNAL`, porque no es un desenlace de negocio y nadie puede hacer nada con ella
    //    desde la pantalla. Mismo patron, linea por linea, que
    //    `DeshacerAsignacionService` con `DeshacerAsignacionConflictoError`.
    let ok: boolean;
    try {
      ok = await this.gestionRepo.rechazarDesdeDevuelta({
        ordenId,
        estatusDevueltaId,
        estatusRechazadaId,
        motivo, // R12: obligatorio, ya validado en el borde
        actorUsuarioId: actor.usuarioId, // R11: quien decidio. NO es el mensajero de la gestion.
      });
    } catch (error) {
      if (error instanceof SinGestionDevueltaError) {
        // Sin efectos: la transaccion ya revirtio el cambio de estado. La orden sigue en la
        // devolucion anclada y la tienda la sigue viendo en su lista.
        return { status: "sin_gestion_origen" };
      }
      throw error;
    }
    // R3/R31: carrera perdida (o doble submit) -> la orden ya no estaba en la devolucion anclada.
    // La pantalla NO debe afirmar que la rechazo: devuelve `conflict` con su motivo.
    if (!ok) {
      return {
        status: "conflict",
        motivo: `la orden ya no esta en ${ESTADO_ORIGEN}`,
      };
    }
    return { status: "ok" };
  }
}
