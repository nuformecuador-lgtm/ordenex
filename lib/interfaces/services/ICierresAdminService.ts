import type { MetodoPagoValue } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CatalogoFiltrosCierresDTO,
  FiltrosCierres,
  FiltrosDescargaGestiones,
} from "@/lib/types/filtros-cierres";
import type { CierreEstado, CierreDestinoTipo } from "@/lib/types/cierre";
import type { ActualizarPagosGestionInput } from "@/lib/types/cierres-admin";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type {
  CierreGrupos,
  CierreOrdenSinGestion,
  CierreResultado,
  CierreTotales,
  IngresoOrdenexDTO,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 38 — contrato del servicio "Cierres del dia" del admin (maestro /
// adminSatelite). Logica de negocio pura (sin HTTP ni Prisma); el borde (Server
// Action) la traduce a resultado tipado y resuelve `unauthenticated`. Solo lectura +
// la transicion aprobar/rechazar. Money-safe: los Decimal cruzan como STRING (R9).
// REUSA CierreTotales / CierreGrupos (grupos por resultado) de la feature 37.

// Cabecera de un cierre dentro del alcance del admin (cola + historico, R2-R5/R8).
// Nombres ya resueltos (no IDs crudos). `totales` = snapshot money-safe (R8/R9).
/**
 * FEATURE 271 (T7.1, R48) — LO QUE LA ADMINISTRACION VE EN LA FILA DE UN CIERRE: que ese mensajero
 * esta BLOQUEADO y POR QUE (cuantos cierres arrastra y cual toca resolver primero).
 *
 * ⚠️ Y POR QUE ESTO Y NO METER `rechazado` EN LA COLA, que era la via barata. Q2, resuelta por el
 * humano el 2026-08-23: **NO**. Sobre un `rechazado` LA BODEGA YA DECIDIO, y la cola significa
 * «pendiente de MI decision»; meterlo ahi cambia lo que la cola significa, y de paso tocaria un
 * modulo que leen TRES pantallas para arreglar un problema de UNA. `ESTADOS_COLA_CIERRE_DIA` NO SE
 * TOCA.
 *
 * ⚠️ Y QUE NADIE SAQUE LA CONCLUSION CONTRARIA: que un `rechazado` no este en la cola NO deja al
 * mensajero sin rescate. `forzarSolicitudVencido` acepta `vencido` **y** `rechazado`
 * (`ESTADOS_REABRIBLES`), asi que la administracion conserva la salida (R49).
 */
export interface BloqueoMensajeroEnFila {
  /** El veredicto de la regla N/V sobre el DUEÑO de este cierre. */
  bloqueado: boolean;
  /** N — cuantos cierres sin aprobar arrastra ese mensajero (este incluido). */
  cierresAbiertos: number;
  /** V — cuantos de esos esperan a que el MENSAJERO los reenvie. */
  cierresPorReenviar: number;
}

export interface CierreAdminResumen {
  cierreId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  /**
   * FEATURE 271 (R48): el estado de bloqueo del mensajero DUEÑO de este cierre. Viaja CON la fila
   * —no en una cola nueva ni en una pantalla nueva— porque es un dato DE la fila. Opcional
   * (aditivo): los consumidores que no lo pinten siguen compilando.
   */
  bloqueoMensajero?: BloqueoMensajeroEnFila;
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

/**
 * Feature 184 — Tanda D (T D.2, R1/R6) — el HISTORICO ENTERO del alcance, sin recorte: el
 * conjunto del que sale el ARCHIVO de ese listado.
 *
 * Mismo elemento que la pagina (`CierreAdminResumen`), porque el archivo proyecta exactamente
 * las columnas que la tabla enseña (R12) y las proyecta con la misma funcion. `limite_excedido`
 * lleva SOLO conteos: ni una fila, ni un conjunto truncado (R6).
 */
export type ListarHistoricoCierresAdminCompletoServiceResult =
  ListarCompletoServiceResult<CierreAdminResumen>;

/**
 * Feature 184 — Tanda D (T D.2, R1/R6) — la COLA ENTERA de pendientes de decision del alcance.
 *
 * Se declara aparte del historico aunque su forma coincida, por el mismo motivo que sus dos
 * schemas de pagina: son dos listados distintos y el nombre es lo unico que dice cual de las
 * dos mitades se esta pidiendo.
 */
export type ListarPendientesCierresAdminCompletoServiceResult =
  ListarCompletoServiceResult<CierreAdminResumen>;

/**
 * Feature 230 (T1.1, design §2.4) — UNA GESTION de un cierre, lista para proyectar a una fila
 * de la HOJA FUNDIDA (la descarga detallada que cruza los cierres de varios mensajeros).
 *
 * Es el DTO COMPARTIDO por los DOS bordes de lectura de la feature —el de «cierres del dia»
 * (`ICierresAdminService`) y el de «cierres de bodega» (`ICierresBodegaAdminService`, que lo
 * importa de aqui)— para que las dos salidas emitan las MISMAS columnas desde la MISMA
 * proyeccion (R26). Los dos listados son particiones DISJUNTAS del negocio (design §2.6), no
 * dos vistas del mismo conjunto: por eso hay dos bordes y un solo DTO.
 *
 * **NO es `CierreDetalleGestion`** (design §2.5), y las diferencias son requisitos, no estilo:
 *
 *  - **Sin `evidenciaUrl` y sin NINGUN campo derivado de la evidencia** (R22/R40/R41). Aquel
 *    lleva la URL FIRMADA, y una hoja reenviada por correo con ella dentro es acceso a la foto
 *    sin sesion. La forma mas fuerte de cumplirlo es que el servidor no emita NADA relativo a
 *    la evidencia por este camino —ni siquiera un booleano `tieneEvidencia`—: asi no hay campo
 *    que manana pueda convertirse en columna por descuido. Lo cubre su test (T3.4c).
 *  - **Sin `gestionId` ni `ordenId`** (R42): identificadores internos con forma de uuid. El
 *    identificador de negocio de la fila es `numRemision`.
 *  - **CON `mensajeroNombre` y `cierreSolicitadoAt`** (R8/R11): la descarga de hoy es de UN
 *    cierre y el mensajero va en el NOMBRE del archivo; al cruzar cierres, sin esas dos celdas
 *    las filas no se distinguen entre si.
 *
 * Money-safe (R43/R44): todo monto viaja como el STRING del snapshot TAL CUAL. Ni conversion
 * numerica, ni simbolo de moneda, ni separador de miles, ni aritmetica.
 *
 * OJO, R3: nada de esto toca `TIENE_EVIDENCIA_COL/_SI/_NO` ni el helper `tieneEvidencia` de
 * `cierre-gestiones-descarga-columnas.ts`, que siguen sirviendo a las CINCO descargas por
 * seccion del detalle de un cierre. Solo la hoja fundida no los usa.
 */
export interface CierreGestionDescargaDTO {
  // --- identidad del cierre al que pertenece la gestion (R8/R11) ---
  mensajeroNombre: string;
  /** ISO del `solicitado_at` del cierre; la fila lo emite como dia calendario. */
  cierreSolicitadoAt: string;
  // --- identidad de negocio de la gestion (SIN uuid, R42) ---
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  direccion: string | null;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  producto: string;
  tiendaNombre: string;
  resultado: CierreResultado;
  // --- datos POR RAMA; money-safe STRING del snapshot, tal cual (R43/R44) ---
  montoRecibido: string | null;
  /** Desglose del recaudo (feature 212). `[]` cuando la gestion no tiene lineas de pago. */
  pagos: { metodo: MetodoPagoValue; monto: string }[];
  motivo: string | null;
  /** Dia calendario `YYYY-MM-DD`; `null` fuera de `reprogramada`. */
  fechaReprogramacion: string | null;
  esRechazoSla: boolean;
  causaIncidente: CausaIncidente | null;
  /** `null` = todavia NO capturada (R47). No es cero: cero diria «no se indemniza». */
  indemnizacion: string | null;
  pagoMensajero: string | null;
  ingresoBodegaRechazo: string | null;
  /** `null` = la orden no tenia tarifa vigente al solicitar (gap conocido de la feature 69). */
  ingresoOrdenex: IngresoOrdenexDTO | null;
}

/**
 * Feature 230 (T1.1) — el conjunto de gestiones del que sale la hoja fundida, tal como lo
 * devuelve cualquiera de los DOS servicios.
 *
 * Reusa el union comun de la 170 (`lib/types/descarga-listado.ts`), con su garantia escrita: ni
 * `limite_excedido` ni `forbidden` llevan nunca `items`. El tope lo evalua el SERVICIO —el
 * mismo `descargaConfig.MAX_FILAS` que sus dos hermanos, sin constante nueva (D13/R21)— y
 * superarlo es un ERROR ACCIONABLE con los conteos, jamas un archivo truncado en silencio.
 */
export type ListarGestionesDescargaServiceResult =
  ListarCompletoServiceResult<CierreGestionDescargaDTO>;

// R6-R9/R13: detalle completo de UN cierre. Reusa CierreGrupos (grupos por
// resultado) de la 37. `no_encontrada` = id inexistente o fuera de alcance (R13, no
// se distingue). `forbidden` = rol invalido (R1).
// Feature 264 — el DTO de una orden sin gestionar se DECLARA en `ICierreDiaService` y se
// re-exporta aqui. El sentido de la dependencia no es un capricho: al reves, este archivo
// arrastraba `lib/types/cierres-admin.ts` y `lib/types/wallet.ts` —que importan `Prisma` como
// VALOR— al grafo del panel del mensajero, y con ellos el cliente de Prisma al bundle del
// navegador. Lo cazo `tests/unit/guards/pagos-captura.guardia.test.ts`.
export type { CierreOrdenSinGestion } from "@/lib/interfaces/services/ICierreDiaService";

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
      /**
       * Feature 264 (R7) — las ordenes que el corte barrio al crear ESTE cierre y ningun otro.
       * `[]` significa «no hubo ninguna» SOLO si `sinGestionRegistrado` es `true`.
       */
      ordenesSinGestion: CierreOrdenSinGestion[];
      /**
       * Feature 264 (R27/R28) — `false` = este cierre es ANTERIOR al registro y su lista es
       * IRRECUPERABLE (la aprobacion ya borro el unico rastro que habia). `[]` con `false` NO es
       * «no hubo ninguna»: es «no lo sabemos», y la pantalla tiene que DECIRLO. Una seccion
       * ausente o vacia en ese caso comunica «no hubo ninguna», que es tranquilizador y falso.
       *
       * Los dos campos viajan JUNTOS SIEMPRE, y por eso esto no se modela como
       * `ordenesSinGestion: CierreOrdenSinGestion[] | null`: un `null` obliga a CADA consumidor a
       * acordarse de distinguir los dos casos, y ya sabemos como acaba eso.
       */
      sinGestionRegistrado: boolean;
    }
  | { status: "forbidden" } // rol invalido (R1)
  | { status: "no_encontrada" }; // id inexistente o de otra bodega/zona (R13)

// Feature 158 (R19/R24): un monto de indemnizacion por gestion `incidente` del cierre, ya
// validado en el borde. Money-safe: STRING de extremo a extremo.
export interface IndemnizacionCapturadaInput {
  gestionId: string;
  monto: string;
}

/**
 * Feature 238 (T2.2, R7/R12) — UNA gestion que bodega declara tener DELANTE, ya validada en el
 * borde (uuid + entero positivo).
 *
 * `numGuia` es lo que se LEYO —camara o teclado, el medio no se registra (D7)— y el servicio lo
 * contrasta con la guia REAL de la orden de esa gestion. Sin ese contraste, un fallo de mapeo del
 * cliente confirmaria el paquete equivocado y nadie se enteraria: el conteo cuadraria igual.
 */
export interface ConfirmacionFisicaInput {
  gestionId: string;
  numGuia: number;
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

/**
 * Pedido humano (2026-08-19) — desenlaces de la CORRECCIÓN del desglose de pago de una gestión
 * desde el detalle de un cierre abierto.
 *
 *  - `forbidden`: el rol no corrige desgloses. Son maestro y admin, y NADIE más — ni siquiera
 *    el `adminSatelite`, que sí tiene alcance para VER los cierres de su bodega: reescribir lo
 *    que un mensajero declaró haber cobrado no es lectura de su bodega, es tocar la caja.
 *  - `no_encontrada`: la gestión no existe, no está en un cierre, o su cierre no es del alcance.
 *    Los tres van juntos a propósito: distinguirlos revelaría cierres ajenos.
 *  - `conflict`: el cierre dejó de estar ABIERTO (lo aprobaron o rechazaron mientras el diálogo
 *    estaba abierto). La corrección NO se aplica; la pantalla recarga y enseña el estado nuevo.
 *  - `validation_error`: la suma no cuadra con lo que el mensajero declaró, o la gestión no es
 *    una entrega con cobro. Por campo, como el resto de este borde.
 */
export type ActualizarPagosGestionServiceResult =
  | { status: "ok"; gestionId: string; totales: CierreTotales }
  | { status: "forbidden" }
  | { status: "no_encontrada" }
  | { status: "conflict" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

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
    input: { page: number; pageSize: number; filtros?: FiltrosCierres },
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
    input: { page: number; pageSize: number; filtros?: FiltrosCierres },
    actor: Actor,
  ): Promise<ListarPendientesCierresAdminServiceResult>;
  /**
   * Feature 184 — Tanda D (T D.2, R1/R4/R6): el HISTORICO ENTERO del alcance, del que sale el
   * ARCHIVO de ese listado.
   *
   * MISMO `resolveAlcance` que la pagina —el rol y la zona salen del actor, nunca de la
   * entrada— y MISMO corte cola/historico. Recibe los MISMOS `filtros` que su pagina (pedido
   * humano del 2026-08-16): el archivo es «esto que estoy viendo, entero», no «todo lo del
   * alcance». Lo que no recibe es paginacion ni alcance.
   * Rol invalido -> `forbidden` ANTES de tocar el repositorio; `adminSatelite` sin zona ->
   * conjunto vacio sin consultar. Supera el tope -> `limite_excedido` con conteos y sin filas.
   */
  listarHistoricoCierresAdminCompleto(
    actor: Actor,
    filtros?: FiltrosCierres,
  ): Promise<ListarHistoricoCierresAdminCompletoServiceResult>;
  /**
   * Feature 184 — Tanda D (T D.2, R1/R4/R6): la COLA ENTERA de pendientes de decision del
   * alcance, del que sale el ARCHIVO de ese listado. Espejo exacto del anterior.
   */
  listarPendientesCierresAdminCompleto(
    actor: Actor,
    filtros?: FiltrosCierres,
  ): Promise<ListarPendientesCierresAdminCompletoServiceResult>;
  /**
   * Feature 230 — Tanda 2 (T2.2, R13/R14/R15/R16/R18/R20/R21/R22) — las GESTIONES de los
   * cierres del dia del alcance del actor, a grano de GESTION, de las que sale la HOJA FUNDIDA.
   *
   * MISMO `resolveAlcance` que los cuatro listados de esta pantalla: el rol y la zona salen del
   * ACTOR y jamas de la entrada (R15), y se componen con los recortes por CONJUNCION, de modo
   * que `filtros` solo puede QUITAR filas dentro del alcance ya resuelto y nunca ensancharlo
   * (R37: un `mensajeroIds` de otra zona cruza con el alcance y da vacio, no error).
   *
   * Mismo orden de desenlaces que sus hermanos: rol invalido -> `forbidden` ANTES de tocar el
   * repositorio (R18); `adminSatelite` sin zona -> conjunto VACIO sin consultar la base y NO
   * `forbidden` (R20); superar `descargaConfig.MAX_FILAS` -> `limite_excedido` con conteos y
   * sin filas (R21).
   *
   * **NO firma ninguna URL de evidencia** (R22): el bloque `signedUrls.createSignedUrls` de
   * `verCierreDetalle` no se copia aqui. Seria trabajo pagado en red para tirarlo despues, y
   * ademas un agujero: la hoja no lleva columna de evidencia en absoluto.
   *
   * `filtros` es OBLIGATORIO y su `mensajeroIds` no admite lista vacia: el conjunto de esta
   * descarga lo redacta el usuario en el dialogo (D5/D11), y «sin mensajeros elegidos» no es
   * «todos», es «no descargues nada» (R39).
   */
  listarGestionesCierresAdminCompleto(
    actor: Actor,
    filtros: FiltrosDescargaGestiones,
  ): Promise<ListarGestionesDescargaServiceResult>;
  /**
   * Pedido humano del 2026-08-16 — las OPCIONES de los filtros de la pantalla (bodegas destino
   * y mensajeros), ya acotadas al alcance del actor.
   *
   * Misma puerta y mismo orden que los listados: rol invalido -> `forbidden` antes de tocar el
   * repositorio; `adminSatelite` sin zona -> catalogo VACIO, no `forbidden`.
   */
  obtenerCatalogoFiltros(
    actor: Actor,
  ): Promise<
    { status: "ok"; catalogo: CatalogoFiltrosCierresDTO } | { status: "forbidden" }
  >;
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
   *
   * Feature 238 (R7-R16): `confirmacionFisica` trae UNA entrada por gestion del cierre cuyo
   * PAQUETE vuelve a bodega (`devuelta`, `rechazada`, `reprogramada`). El service exige
   * COBERTURA EXACTA contra las gestiones reales —ni falta ni sobra— ANTES de las
   * indemnizaciones y ANTES de tocar el repo (R14): si falta un paquete no tiene sentido validar
   * montos que se van a descartar. Con la cobertura correcta, la marca por gestion se escribe
   * DENTRO de la misma transaccion que aprueba (R17). Por defecto `[]`, que es el camino
   * INTACTO de un cierre sin nada que devolver (R16) — 3 de cada 12 cierres medidos.
   */
  /**
   * Pedido humano (2026-08-19) — corrige el reparto por método de UNA gestión de un cierre
   * ABIERTO. Solo maestro/admin.
   *
   * Lo que NO puede hacer, y es la mitad del contrato: mover el total. La suma de las líneas
   * tiene que ser EXACTAMENTE `gestion_orden.monto_recibido`, comparada en `Prisma.Decimal`
   * contra el valor de la base —nunca contra un total que venga del cliente—. El dinero que el
   * mensajero declaró sigue siendo el suyo; lo que cambia es en qué balde cae.
   */
  actualizarPagosGestion(
    input: ActualizarPagosGestionInput,
    actor: Actor,
  ): Promise<ActualizarPagosGestionServiceResult>;
  aprobarCierre(
    cierreId: string,
    actor: Actor,
    indemnizaciones?: ReadonlyArray<IndemnizacionCapturadaInput>,
    confirmacionFisica?: ReadonlyArray<ConfirmacionFisicaInput>,
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
   * estado en el repo (0 filas -> conflict). NO recalcula el snapshot (R21).
   * Fuera de alcance -> no_encontrada.
   *
   * ⚠️ FEATURE 241 (2026-08-20): decia «y NO desbloquea (R18: el desbloqueo ocurre al aprobar el
   * `solicitado` resultante…)». SI DESBLOQUEA, en el acto, porque `solicitado` dejo de bloquear la
   * gestion. Lo que el `aprobar` posterior sigue haciendo —y que esta valvula no hace— es RESOLVER:
   * registrar `resuelto_por`/`resuelto_at` (R17) y mover el dinero.
   */
  forzarSolicitudVencido(
    cierreId: string,
    actor: Actor,
  ): Promise<ForzarSolicitudVencidoServiceResult>;
}
