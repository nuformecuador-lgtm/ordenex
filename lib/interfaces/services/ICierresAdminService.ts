import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreEstado, CierreDestinoTipo } from "@/lib/types/cierre";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";
import type {
  CierreGrupos,
  CierreTotales,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 38 — contrato del servicio "Cierres del dia" del admin (maestro /
// adminSatelite). Logica de negocio pura (sin HTTP ni Prisma); el borde (Server
// Action) la traduce a resultado tipado y resuelve `unauthenticated`. Solo lectura +
// la transicion aprobar/rechazar. Money-safe: los Decimal cruzan como STRING (R9).
// REUSA CierreTotales / CierreGrupos (grupos por resultado) de la feature 37.

// Cabecera de un cierre dentro del alcance del admin (cola + historico, R2-R5/R8).
// Nombres ya resueltos (no IDs crudos). `totales` = snapshot money-safe (R8/R9).
export interface CierreAdminResumen {
  cierreId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  estado: CierreEstado; // solicitado | aprobado | rechazado
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  destinoZonaNombre: string;
  totales: CierreTotales; // snapshot (money-safe string, R8/R9)
  totalPagoMensajero: string; // feature 39/R17: snapshot total del pago al mensajero (STRING), separado de `totales`
  totalIngresoBodegaRechazos: string; // feature 56/R16: snapshot total del ingreso de bodega por rechazos (STRING), separado de `totales` y del pago al mensajero
  /**
   * Feature 172 (T C.2, §5/R22/R26/R28) — lo que de ESTE cierre sigue sin entregarse al
   * mensajero, DERIVADO en el servidor: `min(P, E)` menos los pagos VIGENTES registrados contra
   * el (`derivarPendienteCierre`). STRING de escala 2, money-safe: la pantalla no hace
   * aritmetica con dinero (R14), solo lo pinta.
   *
   * **`null` = el cierre NO esta aprobado** (R28). No es «cero» ni «no se sabe»: en un cierre
   * `solicitado`, `vencido` o `rechazado` no hay nada que pagar todavia y la pantalla no debe
   * mostrar ni ofrecer nada relativo al pago. Los dos valores se distinguen a proposito, porque
   * `"0.00"` SI significa algo: aprobado y ya liquidado del todo (R27).
   *
   * Lo rellena el SERVICIO, no el repositorio ni `toResumen`: sale de una unica agregacion por
   * pagina (`sumarVigentesPorCierre`), no de una consulta por fila.
   */
  pendientePagoMensajero: string | null;
  solicitadoAt: string; // ISO
  resueltoAt: string | null; // ISO; null si solicitado (F1.4-e)
  motivoRechazo: string | null; // solo rechazado (F1.4-e)
}

// R2-R5/R8/R9: cola de `solicitado` (pendientes) + historico (aprobado/rechazado)
// del alcance del actor. `sinZona` = adminSatelite sin zona (R3). `forbidden` = rol
// != maestro/adminSatelite (R1). `unauthenticated` lo resuelve el borde.
export type ListarCierresAdminServiceResult =
  | {
      status: "ok";
      pendientes: CierreAdminResumen[]; // estado=solicitado (R4)
      historico: CierreAdminResumen[]; // aprobado/rechazado (R5)
      sinZona: boolean; // adminSatelite sin zona (R3)
    }
  | { status: "forbidden" }; // rol != maestro/adminSatelite (R1)

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41): UNA PAGINA del historico del alcance + el total del
 * conjunto. Es el contrato comun de T H.2 aplicado a `CierreAdminResumen`, sin campos extra.
 *
 * `sinZona` NO viaja aqui, y es deliberado: el contrato paginado son cuatro campos y el aviso
 * de «no tenes zona asignada» es de la PANTALLA, que lo sigue recibiendo por
 * `listarCierresAdmin`. Un `adminSatelite` sin zona recibe una pagina vacia con `total: 0`,
 * que es exactamente lo que veia antes (R44).
 */
export type ListarHistoricoCierresAdminServiceResult =
  ListarPaginadoServiceResult<CierreAdminResumen>;

/**
 * Feature 170 — FASE 2 (T J.1, R40/R41/R42): UNA PAGINA de la COLA de pendientes de decision
 * del alcance + el total del conjunto. Misma forma que el historico y por el mismo motivo: el
 * contrato de T H.2 son cuatro campos y ni uno mas.
 *
 * De su `total` sale el CONTADOR DE CABECERA que hoy dice `({pendientes.length})`
 * (`CierresAdminModule.tsx:442`). Es un conteo de filas, no dinero: los montos de esta pantalla
 * viajan por FILA como snapshot y no se derivan de este array (R49).
 */
export type ListarPendientesCierresAdminServiceResult =
  ListarPaginadoServiceResult<CierreAdminResumen>;

// R6-R9/R13: detalle completo de UN cierre. Reusa CierreGrupos (grupos por
// resultado) de la 37. `no_encontrada` = id inexistente o fuera de alcance (R13, no
// se distingue). `forbidden` = rol invalido (R1).
export type CierreDetalleAdminServiceResult =
  | {
      status: "ok";
      cierre: CierreAdminResumen;
      grupos: CierreGrupos; // por resultado (reuso 37)
      // Totales por concepto del ingreso de Ordenex del cierre, derivados del snapshot.
      totalesIngreso: TotalesIngresoOrdenex;
      // Feature 102/R4-R8/R10: desglose money-safe (STRING escala 2) del ingreso de bodega por
      // rechazos, particionado por origen. `sla` = escalados del cron SLA (99); `manual` =
      // rechazos del mensajero; `total` = el SNAPSHOT `cierre.totalIngresoBodegaRechazos` (leido,
      // NO recomputado, R6). Por construccion `sla + manual === total` (R5). Solo en el DETALLE
      // (Q4); llega igual al alcance satelite por el mismo camino (R10).
      desgloseIngresoBodegaRechazos: { sla: string; manual: string; total: string };
      // DERIVADO: `totalesIngreso.total` - `cierre.totalPagoMensajero` (STRING money-safe).
      // Lo que le queda a Ordenex del cierre. Puede ser NEGATIVO.
      ganancia: string;
      // DERIVADO: `cierre.totales.general` - `fleteConIva` - `comisionConIva` (STRING
      // money-safe). Lo que se le paga a la tienda. Puede ser NEGATIVO.
      pagoTienda: string;
    }
  | { status: "forbidden" } // rol invalido (R1)
  | { status: "no_encontrada" }; // id inexistente o de otra bodega/zona (R13)

// Feature 158 (R19/R24): un monto de indemnizacion por gestion `incidente` del cierre, ya
// validado en el borde. Money-safe: STRING de extremo a extremo.
export interface IndemnizacionCapturadaInput {
  gestionId: string;
  monto: string;
}

// R10/R12-R14: aprobar un cierre `solicitado` del alcance.
// Feature 158 (R19/R20/R21): + `validation_error` cuando los montos de indemnizacion no cubren
// EXACTAMENTE las gestiones `incidente` del cierre (falta alguna, sobra alguna, o alguna no es
// un incidente de ese cierre). El cierre queda en `solicitado` y no se emite ningun movimiento.
export type AprobarCierreServiceResult =
  | {
      status: "ok";
      cierreId: string;
      estado: "aprobado";
      /**
       * Feature 172 (T C.2, §8/R16/R22) — el pendiente del cierre RECIEN aprobado, derivado en
       * el servidor. Es lo que decide si tras aprobar se ofrece registrar el pago (R16) y con
       * que monto se prefija el formulario (R23); la UI no lo calcula (R14).
       *
       * Aqui es `string` y no `string | null`: el cierre acaba de quedar `aprobado`, asi que la
       * rama «no aprobado» de R28 no existe en este camino. `"0.00"` = no hay nada que ofrecer.
       *
       * **Aprobar y pagar siguen siendo dos escrituras distintas** (§8): este campo no
       * compromete a nada. Si el pago no se registra, el cierre queda aprobado y la deuda,
       * abierta y visible (R17/R18).
       */
      pendientePagoMensajero: string;
    }
  | { status: "forbidden" } // rol invalido (R1)
  | { status: "no_encontrada" } // id inexistente / otra bodega-zona (R13)
  | { status: "conflict" } // ya no esta `solicitado` (R12)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // 158/R19-R21

// R11-R14: rechazar un cierre `solicitado` del alcance; motivo obligatorio (R11).
export type RechazarCierreServiceResult =
  | { status: "ok"; cierreId: string; estado: "rechazado" }
  | { status: "forbidden" } // rol invalido (R1)
  | { status: "no_encontrada" } // id inexistente / otra bodega-zona (R13)
  | { status: "conflict" } // ya no esta `solicitado` (R12)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // motivo vacio (R11)

// Feature 111/R16 — VALVULA DE ESCAPE: destrabar un `vencido` abandonado (transicion
// `vencido -> solicitado` en nombre del mensajero). `ok` deja el cierre en `solicitado` (se
// aprueba/rechaza luego por la via normal). `conflict` = ya no es `vencido`; `no_encontrada` =
// id inexistente o fuera de alcance (R13); `forbidden` = rol no admin (R1).
export type ForzarSolicitudVencidoServiceResult =
  | { status: "ok"; cierreId: string; estado: "solicitado" }
  | { status: "forbidden" }
  | { status: "no_encontrada" }
  | { status: "conflict" };

export interface ICierresAdminService {
  /**
   * R2-R5/R8/R9: lista los cierres del alcance del actor (rol+zona), partidos en
   * pendientes (`solicitado`) e historico (`aprobado`/`rechazado`), con totales
   * snapshot. Solo lectura (R16). Rol invalido -> forbidden; adminSatelite sin zona
   * -> sinZona.
   */
  listarCierresAdmin(actor: Actor): Promise<ListarCierresAdminServiceResult>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): el HISTORICO del alcance, paginado en
   * el servidor.
   *
   * MISMO alcance que `listarCierresAdmin` (el `resolveAlcance` de rol+zona se reusa tal
   * cual, no se reimplementa) y MISMO corte cola/historico (`ESTADOS_COLA_CIERRE_DIA`), de
   * modo que paginar no pueda ensanchar lo que un actor ve: R44 se cumple por construccion.
   * Rol invalido -> forbidden, sin filas y sin total. `adminSatelite` sin zona -> pagina
   * vacia (no hay alcance que consultar), igual que hoy.
   */
  listarHistoricoCierresAdminPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarHistoricoCierresAdminServiceResult>;
  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54): la COLA de pendientes de decision
   * del alcance (`solicitado` + `vencido`), paginada en el servidor.
   *
   * MISMO `resolveAlcance` y MISMA constante de estados que la mitad del historico, con el
   * corte invertido: R44 se cumple por construccion, y la union de las dos paginas sigue
   * siendo exactamente lo que devuelve `listarCierresAdmin`. Rol invalido -> forbidden;
   * `adminSatelite` sin zona -> pagina vacia sin tocar la base.
   */
  listarPendientesCierresAdminPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPendientesCierresAdminServiceResult>;
  /**
   * R6-R9/R13/R16: detalle completo de un cierre del alcance (gestiones agrupadas
   * por resultado, evidencias firmadas). Solo lectura. Fuera de alcance ->
   * no_encontrada.
   */
  verCierreDetalle(cierreId: string, actor: Actor): Promise<CierreDetalleAdminServiceResult>;
  /**
   * R10/R12-R15: aprueba un cierre `solicitado` del alcance (transicion guardada).
   * Ya resuelto -> conflict; fuera de alcance -> no_encontrada.
   *
   * Feature 158 (R19-R22): `indemnizaciones` trae UN monto por gestion `incidente` del cierre.
   * El service exige COBERTURA EXACTA contra las gestiones reales (ni falta ni sobra) ANTES de
   * tocar el repo; con la cobertura correcta, la escritura de los montos y la emision del
   * egreso ocurren en la MISMA transaccion que la aprobacion. Por defecto `[]`, que es el
   * camino RETROCOMPATIBLE de un cierre sin incidentes (R36).
   */
  aprobarCierre(
    cierreId: string,
    actor: Actor,
    indemnizaciones?: ReadonlyArray<IndemnizacionCapturadaInput>,
  ): Promise<AprobarCierreServiceResult>;
  /**
   * R11-R15: rechaza un cierre `solicitado` del alcance con motivo obligatorio
   * (transicion guardada). Motivo vacio -> validation_error; ya resuelto ->
   * conflict; fuera de alcance -> no_encontrada.
   */
  rechazarCierre(
    cierreId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarCierreServiceResult>;
  /**
   * Feature 111/R16/R17/R18 — VALVULA DE ESCAPE (emergencia): destraba un `vencido`
   * ABANDONADO de su alcance transicionandolo `vencido -> solicitado` en nombre del mensajero.
   * Acotada por rol+zona destino (mismo `resolveAlcance` que aprobar/rechazar) y guardada por
   * estado en el repo (0 filas -> conflict). NO recalcula el snapshot (R21) y NO desbloquea
   * (R18: el desbloqueo ocurre al aprobar el `solicitado` resultante, que registra
   * `resuelto_por`/`resuelto_at`, R17). Fuera de alcance -> no_encontrada.
   */
  forzarSolicitudVencido(
    cierreId: string,
    actor: Actor,
  ): Promise<ForzarSolicitudVencidoServiceResult>;
}
