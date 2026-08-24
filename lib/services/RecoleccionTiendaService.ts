import { TOPE_RECOLECTADAS_HOY } from "@/lib/constants/recoleccion-tienda";
import type {
  IGestionOrdenRepository,
  MiAsignacionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
// Feature 271: el motivo del bloqueo lo compone el MISMO formateador que la pantalla y la campana.
import { avisoBloqueo } from "@/lib/constants/bloqueo-mensajero";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRecoleccionTiendaService,
  ListarRecoleccionServiceResult,
  RecolectarEnTiendaServiceResult,
} from "@/lib/interfaces/services/IRecoleccionTiendaService";
import { toDTO } from "@/lib/services/MisAsignacionesService";
import type { RecoleccionOrdenDTO } from "@/lib/types/recoleccion-tienda";
import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";

// Feature 157 — RECOLECCION EN TIENDA por el mensajero (arista #43, declarada por la 154 y sin
// productor hasta aqui). El mensajero va a la tienda, escanea el QR de la etiqueta y la orden
// pasa `por_recolectar_en_tienda -> en_ruta_bodega_central`, donde empalma con el tramo que ya
// existe: la bodega central la recibe por QR (feature 138) y queda en `en_bodega_central`.
//
// Espejo estructural de `RecepcionBodegaCentralService` con tres diferencias:
//   - el rol autorizado es `mensajero` (el acto fisico es suyo), no acceso total;
//   - hay guardia de PROPIEDAD: solo la recolecta el mensajero asignado (R30);
//   - hay guardia de BLOQUEO por cierre pendiente (R31), la misma que `MisAsignacionesService`.
// El par ORIGEN->DESTINO es UNICO, asi que no hay tabla state-aware que resolver.

// Feature 157 (ampliada 2026-07-31): se recolecta lo que ALGUIEN tiene asignado, y eso es
// `recolectando`. Una orden en `por_recolectar_en_tienda` no tiene mensajero, asi que la
// guardia de propiedad la rechazaria igualmente: el origen y el dueño van de la mano.
const ORIGEN_RECOLECCION = "recolectando";
const DESTINO_RECOLECCION = "en_ruta_bodega_central";

// ⚠️ FEATURE 271 — AQUI VIVIA `MSG_BLOQUEADO`, Y SE QUEDABA CORTO DE UNA FORMA MEDIBLE. Decia
// «Tenés un cierre pendiente sin resolver», y con la regla nueva hay un caso —ACUMULACION, N>=2 y
// V=0— en el que el mensajero NO TIENE NADA QUE RESOLVER: sus dos cierres estan enviados y esperando
// al administrador. Un mensaje que le atribuye una tarea que no tiene lo manda a buscar un boton que
// no existe (R51).
//
// Pasa a componerse con el MISMO formateador que la pantalla y la campana (`avisoBloqueo`), que
// distingue los tres casos y dice en cada uno quien tiene la pelota.
//
// Lo que NO cambia: con un cierre `solicitado` a secas (N=1, V=0) SI recolecta —la pelota esta en el
// tejado del admin, no en el suyo—. Esa es la mitad de la regla del 2026-08-20 que sobrevive.

// Motivo del `conflict` cuando la escritura guardada no afecto ninguna fila (R34).
const MSG_CARRERA = "la orden cambio de estado durante la recoleccion";

// Feature 167 (R31) — el tope de presentacion de «Recolectadas hoy» se APLICA aqui pero VIVE en
// `lib/constants/recoleccion-tienda.ts`: el aviso de recorte que lee el mensajero nombra ese
// mismo numero, y con el literal duplicado en la UI cambiar el tope dejaba el aviso mintiendo
// (hallazgo m5 del review). Una sola fuente para los dos lados.

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como Pick
// para dobles de test sin DB/HTTP (patron `RecepcionBodegaCentralService`).
type RecoleccionTiendaRepo = Pick<
  IOrdenRepository,
  | "findByNumGuiaForTransicion"
  | "findEstatusIdByValue"
  | "recolectarEnTienda"
  | "findBloqueoDetalle" // feature 271: la regla N/V + el motivo que CUENTA (R25/R27)
>;

// Feature 167 — la LECTURA del apartado consume otros dos repos, tambien por `Pick` para poder
// doblarlos sin DB:
//   - `findMisAsignaciones` (repo de gestion) ya es "las ordenes de ESTE mensajero en ESTOS
//     estados", con su WHERE de propiedad y de `deleted_at IS NULL`. Duplicarlo en otro repo
//     seria una segunda copia del filtro que NO puede divergir (design §10, A5);
//   - `findRecoleccionesDeActor` (repo de historial) es la fuente de «Recolectadas hoy».
// Los dos son REQUERIDOS a proposito (precedente de la 160): una dependencia opcional deja que
// el wiring se la olvide y que el dato desaparezca en silencio de la pantalla del mensajero.
type RecoleccionGestionRepo = Pick<
  IGestionOrdenRepository,
  "findMisAsignaciones" | "findMisAsignacionesByIds"
>;
type RecoleccionHistorialRepo = Pick<IOrdenHistorialRepository, "findRecoleccionesDeActor">;

export class RecoleccionTiendaService implements IRecoleccionTiendaService {
  constructor(
    private readonly repo: RecoleccionTiendaRepo,
    private readonly repoGestion: RecoleccionGestionRepo,
    private readonly repoHistorial: RecoleccionHistorialRepo,
    /**
     * Feature 167 (R27) — reloj INYECTABLE (patron `GestionOrdenRepository`). La ventana de
     * "hoy" es la unica logica temporal de este service; con el reloj global los tests de los
     * bordes (23:59 y 00:00 hora CR) tendrian que falsear `Date` para todo el proceso.
     */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recolectarEnTienda(
    numGuia: number,
    actor: Actor,
  ): Promise<RecolectarEnTiendaServiceResult> {
    // 1. Rol: solo el mensajero recolecta (R29). Maestro/admin NO tienen camino aqui.
    if (actor.rol !== "mensajero") return { status: "forbidden" };

    // 2. FEATURE 271 (R25/R27): bloqueo por la regla N/V, ANTES de leer la orden (R31). Mismo orden
    //    que `gestionar`, de modo que un mensajero bloqueado no llega siquiera a saber si la guia
    //    existe. Recolectar en tienda es COBRAR, asi que le toca la MISMA regla que gestionar — y
    //    desde el 2026-08-23 tambien la misma que RECIBIR trabajo nuevo: ya no hay dos politicas.
    const bloqueo = await this.repo.findBloqueoDetalle(actor.usuarioId);
    if (bloqueo.bloqueado) {
      return { status: "conflict", motivo: avisoBloqueo(bloqueo, { conCta: true }) };
    }

    // 3. Cargar por num_guia. `findByNumGuiaForTransicion` NO filtra borradas: aqui se
    //    distingue "no existe" de "borrada", y ambas son `no_encontrada` (R30).
    const row = await this.repo.findByNumGuiaForTransicion(numGuia);
    if (!row || row.deletedAt !== null) return { status: "no_encontrada" };

    // 4. PROPIEDAD (R30): la orden de otro mensajero es indistinguible de una inexistente. Un
    //    status propio para la ajena filtraria su existencia a quien escanee una etiqueta suelta.
    if (row.mensajeroAsignadoId !== actor.usuarioId) return { status: "no_encontrada" };

    // 5. Idempotencia: ya recolectada -> no re-transiciona ni toca el historial (R32). Escanear
    //    dos veces la misma etiqueta es lo normal en una recoleccion de decenas de paquetes.
    if (row.estatusValue === DESTINO_RECOLECCION) return { status: "ya_recolectada" };

    // 6. Guardia de estado: fuera del origen no hay recoleccion que confirmar. Lleva el estado
    //    actual para que la UI pueda nombrarlo (R33).
    if (row.estatusValue !== ORIGEN_RECOLECCION) {
      return { status: "estado_invalido", estado: row.estatusValue };
    }

    // 7. El destino debe existir en el catalogo (sembrado por seedOrderStatus).
    const destinoId = await this.repo.findEstatusIdByValue(DESTINO_RECOLECCION);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: [`el catalogo no tiene ${DESTINO_RECOLECCION}`] },
      };
    }

    // 8. Transicion atomica. El UPDATE va guardado por estado de ORIGEN + no borrada + MENSAJERO:
    //    esa es la defensa REAL (los pasos 4-6 solo permiten reportar mejor). R26/R28/R34.
    const transiciono = await this.repo.recolectarEnTienda(
      row.id,
      ORIGEN_RECOLECCION,
      destinoId,
      actor.usuarioId,
      { actorUsuarioId: actor.usuarioId, origenTipo: "recoleccion_tienda" },
    );

    if (!transiciono) {
      // 9. R34: perdio la carrera. Se re-lee para distinguir "ya estaba recolectada" (idempotente)
      //    de un conflicto real.
      const despues = await this.repo.findByNumGuiaForTransicion(numGuia);
      if (despues && despues.estatusValue === DESTINO_RECOLECCION) {
        return { status: "ya_recolectada" };
      }
      return { status: "conflict", motivo: MSG_CARRERA };
    }

    return { status: "ok", ordenId: row.id, estado: DESTINO_RECOLECCION };
  }

  /**
   * Feature 167 (R21/R24/R25/R27/R31/R38) — los datos del apartado `/recoleccion`.
   *
   * Dos lecturas INDEPENDIENTES, en paralelo:
   *   1. lo que falta por recolectar -> estado ACTUAL `recolectando`, acotado al actor;
   *   2. lo que ya se recolecto hoy  -> HISTORIAL de la transicion, acotado al actor.
   *
   * La segunda NO puede derivarse del estado (design §10, A2): en cuanto la bodega central
   * recibe el paquete (138) la orden pasa a `en_bodega_central` y desapareceria de la lista
   * justo cuando el mensajero llega a la central, que es cuando quiere verla (R26).
   *
   * El bloqueo por cierre pendiente NO se deriva aqui: la pagina lo obtiene de
   * `estadoBloqueoMensajero()`, igual que `/mis-asignaciones`. Una sola derivacion en el portal.
   * Y estar bloqueado no oculta estas listas (R23): son lectura, no una accion.
   */
  async listarRecoleccion(actor: Actor): Promise<ListarRecoleccionServiceResult> {
    // MISMA guardia de rol que `recolectarEnTienda`: el apartado es del mensajero.
    if (actor.rol !== "mensajero") return { status: "forbidden" };

    // R27 — ventana de "hoy" = dia natural de Costa Rica (00:00 a 24:00 hora de pared de CR),
    // la MISMA convencion que usa la analitica (144/135). Costa Rica es UTC-6 fijo y sin
    // horario de verano, asi que todo borde cae en `...T06:00:00.000Z` y aqui no hay aritmetica
    // de zona propia: sale entera de `lib/utils/fecha-cr.ts`.
    //
    // NO se replica la ventana 18:00-18:00 de `RankingService` (medianoche UTC + 24h): es una
    // divergencia CONOCIDA con ticket propio (166) y el ranking ni siquiera cuenta
    // recolecciones (157/R38), asi que no hay ningun numero que el mensajero pueda ver en dos
    // sitios con dos valores distintos. Copiarla aqui propagaria el defecto a una superficie mas.
    const hoyCR = fechaCalendarioCR(this.now());
    const desde = inicioDelDiaCREnUtc(hoyCR); // inclusivo
    const hasta = inicioDelDiaSiguienteCREnUtc(hoyCR); // EXCLUSIVO

    const [pendientes, recolecciones] = await Promise.all([
      // R21: la propiedad y el estado los impone el WHERE del repo, no un filtro en memoria.
      this.repoGestion.findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOLECCION]),
      // R31: se pide UNA MAS que el tope para saber si hay recorte sin un conteo extra.
      this.repoHistorial.findRecoleccionesDeActor(
        actor.usuarioId,
        desde,
        hasta,
        TOPE_RECOLECTADAS_HOY + 1,
      ),
    ]);

    const recolectadasHoyRecortada = recolecciones.length > TOPE_RECOLECTADAS_HOY;
    const mostradas = recolecciones.slice(0, TOPE_RECOLECTADAS_HOY);

    // 2026-08-11 — «Recolectadas hoy» pinta la MISMA card, asi que sus filas necesitan los datos
    // de la orden y no solo los cuatro del historial. Segunda lectura, acotada a los ids que YA
    // se van a mostrar (nunca a los `+1` del sondeo de recorte) y con la guardia de propiedad en
    // el WHERE del repo. Se pide DESPUES del `Promise.all` porque depende de su resultado.
    const filas = await this.repoGestion.findMisAsignacionesByIds(
      actor.usuarioId,
      mostradas.map((r) => r.ordenId),
    );
    const porId = new Map(filas.map((row) => [row.id, row]));

    return {
      status: "ok",
      porRecolectar: pendientes.map(toRecoleccionOrdenDTO),
      // El orden lo manda el HISTORIAL (R28: de la mas reciente a la mas antigua), no la
      // segunda lectura. Una orden que el historial nombra pero que la lectura no devuelve
      // —borrada, o reasignada a otro mensajero— se CAE de la lista en vez de pintarse a
      // medias: la card no admite huecos.
      recolectadasHoy: mostradas.flatMap((r) => {
        const row = porId.get(r.ordenId);
        return row ? [{ ...toRecoleccionOrdenDTO(row), recolectadaAt: r.recolectadaAt }] : [];
      }),
      recolectadasHoyRecortada,
    };
  }
}

/**
 * Proyeccion a `RecoleccionOrdenDTO`.
 *
 * 2026-08-11 (decision del humano): el apartado pinta la MISMA card que «Por recoger», completa,
 * asi que el DTO deja de recortar. Reutiliza `toDTO` de `MisAsignacionesService` —la MISMA
 * proyeccion que alimenta esa card en Entregas— en vez de una copia local que podria divergir;
 * la fila de origen ya traia todos estos campos, de modo que no hay lectura nueva contra la base.
 *
 * Esto RETIRA el corte de R38 (167), que existia para que la card no pudiera mostrar cobro ni
 * ruta. El test de contrato que lo vigilaba pasa a verificar lo contrario: que la recoleccion
 * transporta lo mismo que Entregas.
 *
 * Los tres campos que `toDTO` deja en su default son correctos aqui y no se re-derivan:
 *   - `secuenciaRuta: null` — una orden por recolectar no es parada de ninguna ruta;
 *   - `marcarLuego: false` — la marca privada se resuelve con un repo que esta lectura no
 *     consume; es de la gestion en reparto, no de la recoleccion.
 * `intentosEntrega: 0` se fija explicito: una orden que todavia esta en la tienda no ha tenido
 * ningun intento de entrega, asi que el `0` es el dato REAL y no un relleno.
 *
 * `tiendaTelefono` es `?: string | null` en la fila (patron aditivo de la 157), asi que el
 * `?? null` garantiza `null` —nunca `undefined`— tambien con un doble de test que no lo declare.
 */
function toRecoleccionOrdenDTO(row: MiAsignacionRow): RecoleccionOrdenDTO {
  return {
    ...toDTO(row),
    tiendaTelefono: row.tiendaTelefono ?? null, // R20: `null` = sin controles de contacto
    intentosEntrega: 0,
  };
}
