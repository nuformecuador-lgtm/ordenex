import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GastoFijoCobroTxClient } from "@/lib/interfaces/repositories/IGastoFijoCobroRepository";
import type { GastoFijoPlantillaTxClient } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type {
  ActualizarGastoFijoPlantillaInput,
  CrearGastoFijoPlantillaInput,
  EliminarPlantillaInput,
  GastoFijoPlantillaDTO,
  SetActivaPlantillaInput,
} from "@/lib/types/gasto-fijo-plantilla";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// Feature 45 (design §2.2b) — contrato del servicio de PLANTILLAS de gasto fijo (CRUD del
// maestro). Rol autorizado: acceso total (R17). Resultados de dominio (sin acoplar a HTTP).
// Money-safe: DTOs con montos STRING.
//
// El CRUD incluye BORRADO desde la ficha 332, que **revoca** el «sin borrado» de `45/R25`
// (decision humana del 2026-08-29). Motivo: la tabla de plantillas acumula ruido y el historico
// del libro no depende de la plantilla —no hay FK y la descripcion del movimiento ya lleva el
// concepto y el periodo—. Puntero: `specs/332-eliminar-plantilla-gasto-fijo`; la nota larga esta
// en `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts`.

export type CrearPlantillaServiceResult =
  | { status: "ok"; plantilla: GastoFijoPlantillaDTO }
  | { status: "forbidden" };

export type ActualizarPlantillaServiceResult =
  | { status: "ok"; plantilla: GastoFijoPlantillaDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export type SetActivaPlantillaServiceResult =
  | { status: "ok"; plantilla: GastoFijoPlantillaDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

/**
 * Ficha 332 (R2/R4/R7) — resultado del BORRADO de una plantilla.
 *
 * Hasta la 333, `ok` no llevaba payload: no hay nada que devolver de una fila que ya no existe, y
 * la pantalla relee su pagina desde el servidor (R18) en vez de reconstruir el estado desde esta
 * respuesta.
 *
 * ⚠️ FICHA 333 (F1b, R56) — `ok` GANA `pendientesCancelados`, y ese numero NO es cosmetico. La
 * confirmacion anuncia cuantos cobros pendientes se van a cancelar (R55) con un numero leido
 * ANTES de aceptar; si entre el aviso y la ejecucion alguien aprobo, rechazo o el cron genero
 * otro, el borrado SIGUE ADELANTE y este campo dice cuantos se cancelaron REALMENTE. Abortar un
 * borrado legitimo por una carrera que el usuario no puede ver seria castigarle por ella.
 */
export type EliminarPlantillaServiceResult =
  | { status: "ok"; pendientesCancelados: number }
  | { status: "forbidden" }
  | { status: "not_found" };

/**
 * Ficha 333 (F1b, R45) — el cliente que la transaccion del BORRADO necesita: las DOS tablas que
 * toca, y ninguna mas. `gasto_fijo_cobro` (la cancelacion) y `gasto_fijo_plantilla` (el DELETE).
 * El libro sigue fuera de alcance por el TIPO: no hay por donde tocarlo (R8 de la 332).
 */
export type EliminarPlantillaTx = GastoFijoCobroTxClient & GastoFijoPlantillaTxClient;

/**
 * Ficha 333 (F1b, R45) — ejecuta `fn` dentro de UNA transaccion y revierte si lanza: o se
 * cancelan los cobros pendientes Y desaparece la plantilla, o no ocurre ninguna de las dos cosas.
 *
 * Se INYECTA por constructor (precedente: `LiquidacionTxRunner`): el servicio no importa Prisma.
 */
export type EliminarPlantillaTxRunner = <T>(
  fn: (tx: EliminarPlantillaTx) => Promise<T>,
) => Promise<T>;

export type ListarPlantillasServiceResult =
  | { status: "ok"; plantillas: GastoFijoPlantillaDTO[] }
  | { status: "forbidden" };

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41): UNA PAGINA de las plantillas + el total del
 * conjunto. Contrato comun de T H.2, sin campos extra.
 */
export type ListarPlantillasPaginadoServiceResult =
  ListarPaginadoServiceResult<GastoFijoPlantillaDTO>;

/**
 * Feature 184 — Tanda G (R1/R6) — el CONJUNTO de las plantillas para el archivo, sin recorte.
 * Ni `forbidden` ni `limite_excedido` viajan nunca con filas.
 */
export type ListarPlantillasCompletoServiceResult =
  ListarCompletoServiceResult<GastoFijoPlantillaDTO>;

export interface IGastoFijoPlantillaService {
  /** R17/R24: solo maestro; crea una plantilla (activa=true). Forbidden sin efectos. */
  crearPlantilla(
    input: CrearGastoFijoPlantillaInput,
    actor: Actor,
  ): Promise<CrearPlantillaServiceResult>;
  /** R17/R25: solo maestro; edita concepto/monto. not_found si el id no existe. */
  actualizarPlantilla(
    input: ActualizarGastoFijoPlantillaInput,
    actor: Actor,
  ): Promise<ActualizarPlantillaServiceResult>;
  /**
   * R17/R25: acceso total; activa/desactiva. not_found si el id no existe.
   *
   * Sigue existiendo tal cual despues de la ficha 332 (R11): desactivar es «no se cobra POR
   * AHORA» —reversible, la fila se queda y conserva el id—, eliminar es «no se cobra nunca mas y
   * no quiero verlo». Colapsarlas obligaria a borrar para pausar.
   */
  setActivaPlantilla(
    input: SetActivaPlantillaInput,
    actor: Actor,
  ): Promise<SetActivaPlantillaServiceResult>;
  /**
   * Ficha 332 (R1/R2/R3/R4/R7) — ELIMINA una plantilla. Acceso total (`esAccesoTotal`, la misma
   * guardia que crear/editar/activar), evaluada ANTES de tocar el repositorio. `not_found` si la
   * fila ya no estaba, sin efectos y sin excepcion.
   *
   * **Revoca `45/R25`** («el sistema NO DEBE borrar plantillas»), decision humana del 2026-08-29.
   * Motivo: la tabla acumula ruido y el historico no depende de la plantilla. Puntero:
   * `specs/332-eliminar-plantilla-gasto-fijo`.
   *
   * R8/R9 — EL LIBRO NO SE TOCA. Borrar una plantilla no crea, modifica ni elimina ningun
   * `wallet_movimiento`. Los egresos `egreso_gasto_fijo` que ya genero siguen listandose con su
   * monto, su `fecha_movimiento`, su `origen_id` y su `descripcion` intactos; la descripcion ya
   * lleva concepto y periodo, asi que la fila se explica sola sin la plantilla.
   *
   * ⚠️ RIESGO R-1 (design §7), AQUI PORQUE ES DONDE SE DECIDE: la clave de idempotencia del cron
   * es `origen_id = '<plantillaId>:<periodo>'`. Eliminar TIRA el id; una plantilla nueva con el
   * mismo concepto nace con otro uuid, o sea otra clave, y el indice unico parcial NO impide que
   * se vuelva a cobrar un periodo ya cobrado. Por eso la confirmacion empuja a DESACTIVAR cuando
   * la intencion es pausar (R16): desactivar conserva el id, y con el la clave.
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * ✅ CONTRATO CON LA FICHA 333 (R25) — **CUMPLIDO el 2026-08-29** (tanda F1b de la 333). El
   * texto de abajo se conserva TAL CUAL porque es el contrato que se firmo y el que la guardia
   * `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` vigila; lo que cambia es
   * que ya no describe un futuro. Como se cumplio, punto por punto:
   *
   *   1. `eliminarPlantilla` ABRE la transaccion e invoca `cancelarPorPlantilla` del servicio de
   *      cobros —que ejecuta `cancelarPendientesDePlantilla` sobre ese mismo `tx`— ANTES del
   *      `DELETE`, y los dos pasos van dentro de ella (R45). Y si alguien la quitara, la BASE lo
   *      impide: con `plantilla_id ON DELETE SET NULL` y el CHECK
   *      `gasto_fijo_cobro_pendiente_con_plantilla`, el `DELETE` de una plantilla con pendientes
   *      vivos ABORTA RUIDOSAMENTE (R46).
   *   2. El conteo previo lo sirve `contarCobrosPendientesDePlantillaAction`, que el dialogo de
   *      confirmacion llama AL ABRIRSE (R55).
   *   3. Si el numero cambio entre el aviso y la ejecucion, el borrado SIGUE y
   *      `EliminarPlantillaServiceResult.pendientesCancelados` reporta el numero REAL (R56).
   *
   * Texto original del traspaso (2026-08-29, ficha 332):
   *
   *   1. **Cancelar los cobros pendientes de la plantilla en la MISMA operacion atomica** que la
   *      borra: una transaccion que abarque los dos pasos. Media cancelacion con la plantilla ya
   *      borrada deja pendientes huerfanos apuntando a una plantilla que no existe, y esos si
   *      serian inalcanzables.
   *   2. **Contarlos ANTES** y pasar el numero a la confirmacion, para que el usuario lea «se
   *      cancelaran 2 cobros pendientes» antes de aceptar, no despues.
   *   3. Si al ejecutar el borrado el numero cambio (alguien aprobo uno entre medias), lo decide
   *      la 333: la ficha 332 NO lo prejuzga.
   *
   * Punto de sutura: la transaccion entra AQUI y `EliminarPlantillaServiceResult` es el tipo que
   * ganara el campo del conteo. No se deja hoy ni un parametro opcional ni un `deps` de mas «por
   * si acaso»: un asiento vacio esperando a un invitado que quiza cambie de forma es peor que
   * ninguno. Ver `specs/332-eliminar-plantilla-gasto-fijo/design.md §5`.
   * ─────────────────────────────────────────────────────────────────────────────────────────
   *
   * El invitado llego: la transaccion entra por `EliminarPlantillaTxRunner` y el conteo sale por
   * `pendientesCancelados`, exactamente donde la 332 dijo que entrarian.
   */
  eliminarPlantilla(
    input: EliminarPlantillaInput,
    actor: Actor,
  ): Promise<EliminarPlantillaServiceResult>;
  /** R17/R26: solo maestro; lista todas las plantillas (activas e inactivas). */
  listarPlantillas(actor: Actor): Promise<ListarPlantillasServiceResult>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): las plantillas, paginadas en el
   * servidor.
   *
   * MISMA guardia de rol que `listarPlantillas` (`esAccesoTotal`, R17) evaluada ANTES de
   * tocar el repositorio: paginar no puede ensanchar el alcance de nadie (R44). Cualquier otro
   * rol -> forbidden, sin filas y sin total.
   */
  listarPlantillasPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPlantillasPaginadoServiceResult>;
  /**
   * Feature 184 — Tanda G (R1/R4/R6): el MISMO listado sin recorte por pagina, para el archivo.
   *
   * MISMA guardia de rol (`esAccesoTotal`) evaluada ANTES de tocar el repositorio, la MISMA
   * lectura de la que sale la pagina (`listar()`) y el tope del servidor. Sin parametro de
   * entrada: este listado no admite filtros, asi que no hay nada que transportar.
   */
  listarPlantillasCompleto(actor: Actor): Promise<ListarPlantillasCompletoServiceResult>;
}
