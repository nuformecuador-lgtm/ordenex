import type { GestionResultado, MetodoPagoValue } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreEstado, CierreDestinoTipo } from "@/lib/types/cierre";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { OrderStatusValue } from "@/lib/types/order-status";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";

// Feature 37 — contrato del servicio del "Cierre del dia" del mensajero. Logica de
// negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a
// resultado tipado y resuelve `unauthenticated`. Solo el rol `mensajero`, SIEMPRE
// acotado a su `usuario.id` (R1/R2). Money-safe: los Decimal cruzan como STRING.

// Los 4 resultados posibles de una gestion (feature 36); discriminador del grupo.
export type CierreResultado = GestionResultado;

// DTO de una gestion incluida en el detalle del dia (R3/R4/R5/R6). Nombres ya
// resueltos (no IDs de catalogo). `montoRecibido` serializado a STRING (money-safe,
// R9), null salvo `entregada`. `evidenciaUrl` es la URL FIRMADA (R5), nunca el
// storage_path crudo.
export interface CierreDetalleGestion {
  gestionId: string;
  ordenId: string;
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
  montoRecibido: string | null; // Decimal->string; solo entregada (R6)
  // Feature 212/R31: DEPRECADO pero VIVO. Se CONSERVA mientras la presentacion actual lo
  // consuma; su retiro lo decide la 213. `null` cuando la entrega tiene 0 o >=2 metodos.
  metodoPago: MetodoPagoValue | null; // solo entregada (R6)
  /**
   * Feature 212/R31: DESGLOSE del recaudo de la entrega — 0..N lineas `(metodo, monto)`,
   * money-safe STRING escala 2, en orden de declaracion del enum (`efectivo`, `SINPE`,
   * `transferencia`). `[]` cuando la gestion no cobro nada o no es `entregada`.
   *
   * Convive con `metodoPago` A PROPOSITO: entre el merge de esta ficha y el de la 213 la
   * pantalla sigue pintando el campo escalar, y el desglose es lo que la 213 consumira para
   * pintar el detalle y para concatenar la celda de las dos descargas.
   */
  pagos: { metodo: MetodoPagoValue; monto: string }[];
  motivo: string | null; // reprogramada/devuelta/rechazada (R4)
  fechaReprogramacion: string | null; // ISO date (YYYY-MM-DD); solo reprogramada (R4)
  evidenciaUrl: string | null; // URL FIRMADA (R5), nunca el storage_path
  // Feature 39/R10/R16: pago al mensajero (money-safe STRING). En la vista EN VIVO (37)
  // es DERIVADO por resultado+tarifa; en el detalle admin (38/40) es el snapshot leido.
  // `null` en cierres pre-migracion (R22). Concepto INDEPENDIENTE de montoRecibido (R21).
  pagoMensajero: string | null;
  // Feature 56/R9/R15: ingreso de bodega por rechazo (money-safe STRING). En la vista EN
  // VIVO (37) es DERIVADO por resultado+tarifa; en el detalle admin (38/40) es el snapshot
  // leido. `null` en cierres pre-migracion (R22). Concepto INDEPENDIENTE del pago al
  // mensajero (R7b) y del dinero recibido (R20). Solo `rechazada` con tarifa que aplica != 0.00.
  ingresoBodegaRechazo: string | null;
  // Feature 56/R23 (F1.4-Q6): flag derivado SERVER-SIDE. `true` SOLO cuando el resolver de
  // tarifa devolvio `null` (zona SIN tarifa capturada, incluye el caso sin zona); `false`
  // cuando existe tarifa aunque sus montos sean 0.00. Reemplaza la heuristica de frontend
  // `entregada && pago === "0.00"` de la 39, para entregas Y rechazos. En el detalle admin
  // (38/40), donde no se re-resuelve la tarifa (snapshot), es `false` por defecto.
  tarifaFaltante: boolean;
  // Feature 102/R9/R11: `true` si la gestion `rechazada` fue escalada por el cron SLA (99),
  // `false` si es un rechazo manual del mensajero (o cualquier otro resultado). En el detalle
  // admin (38/40) alimenta la marca por fila; en la vista EN VIVO del mensajero (37) es `false`
  // por defecto (esa vista no expone el desglose SLA).
  esRechazoSla: boolean;
  /**
   * 💰 Feature 237 (D6, R41) — `true` si la gestion la registro LA TIENDA desde su pestaña de
   * ayuda. La fila del cierre del dia del mensajero lo dice CON PALABRAS, para que no firme como
   * suya una gestion que no hizo, con una evidencia que no subio.
   *
   * Passthrough puro desde `CierreGestionPendienteRow`: el servicio no re-deriva la clasificacion,
   * igual que con `esRechazoSla`.
   */
  desdeAyudaTienda: boolean;
  /**
   * Feature 158/R9/R34: causa TIPIFICADA del incidente (`danado`/`perdido`/`robado`), leida de
   * `gestion_orden.causa_incidente`. `null` en cualquier otro resultado — es un campo POR
   * RAMA, como `metodoPago` o `fechaReprogramacion`.
   *
   * La pueblan LOS DOS caminos (vista en vivo del mensajero y detalles de admin): no es un
   * dato sensible ni de dinero, es el hecho que el propio mensajero reporto. R34 la exige en
   * la pantalla de aprobacion; sin ella el admin tendria que decidir el monto de una
   * indemnizacion sin saber si el paquete se rompio o se lo robaron.
   *
   * El VALUE crudo no se pinta nunca: la capa de presentacion lo traduce
   * (`CAUSA_INCIDENTE_LABEL`).
   */
  causaIncidente: CausaIncidente | null;
  /**
   * Feature 158/R19/R22/R34: monto de la indemnizacion (money-safe STRING, escala 2), leido de
   * `gestion_orden.indemnizacion`. `null` en cualquier resultado que no sea `incidente` y
   * tambien en un `incidente` cuyo cierre AUN NO se aprobo (el monto lo captura el admin al
   * aprobar, R19): ahi `null` significa «todavia no hay monto», no «monto cero».
   *
   * ⚠️ SOLO lo pueblan los detalles de ADMIN (38/40). En la vista EN VIVO del mensajero (37)
   * es SIEMPRE `null`, y a proposito — no por casualidad de que ahi las gestiones tengan
   * `cierre_id IS NULL`. La indemnizacion es plata que Ordenex paga por el paquete, NO del
   * mensajero (R17: un incidente no le paga nada), y un numero grande junto a su gestion se
   * leeria como una deuda suya. La decision es de `design.md` §7.2 («el mensajero no ve la
   * indemnizacion: no es plata suya») y se implementa en el REPO, no en la UI: la columna ni
   * siquiera se selecciona en la consulta del mensajero, asi que no puede filtrarse por un
   * cambio de pantalla. Mismo patron que `ingresoOrdenex`, que tampoco cruza a esa vista.
   */
  indemnizacion: string | null;
  /**
   * Desglose del ingreso de Ordenex (flete, IVA, comision) + la tarifa congelada de esa
   * orden. Solo lo pueblan los detalles de ADMIN (38/40), que leen del snapshot; en la vista
   * EN VIVO del mensajero es `undefined` (no ve el ingreso de la empresa, y ademas no hay
   * snapshot todavia). `null` en cierres pre-snapshot.
   */
  ingresoOrdenex?: IngresoOrdenexDTO | null;
}

/**
 * Tarifa CONGELADA en `cierre_detail` al solicitar el cierre (feature 69/R8: las 8 columnas
 * se congelan todas o ninguna). Es la tarifa COMPLETA de la tienda, no solo la que aplico:
 * el admin necesita ver de donde sale el numero, incluida la variante que NO se uso.
 * Money-safe: los montos y porcentajes cruzan como STRING (nunca number/parseFloat).
 * Los `%` van 0..100 (no factor), tal cual se capturan.
 */
export interface TarifaSnapshotDTO {
  tarifaId: string;
  valorFlete: string;
  valorFleteGam: string;
  valorFleteDevuelto: string;
  valorFleteDevueltoGam: string;
  comisionCod: string; // % 0..100 sobre montoCobrar
  ivaFlete: string; // % 0..100 sobre el flete
  ivaComisionCod: string; // % 0..100 sobre la comision
  // Monto FIJO de fulfillment congelado (2026-08-19). `null` en los cierres anteriores a la
  // columna: no hay valor correcto que inventar hacia atras, y un "0.00" diria "no se cobro",
  // que es otra cosa. NO participa del `total` del ingreso: no es un concepto de la formula.
  fulfillment: string | null;
}

/**
 * Desglose del ingreso de Ordenex por orden, DERIVADO server-side del snapshot congelado
 * con la MISMA funcion que alimenta las wallets al aprobar (`derivarIngresoOrden`): la
 * pantalla del admin y el dinero que se liquida no pueden salir de dos formulas distintas.
 *
 * Los conceptos son `null` cuando NO aplican a ese resultado (una entrega no tiene flete de
 * devolucion; una orden con `cobraComision: false` no tiene comision). `null` != "0.00": el
 * primero es "este concepto no existe acá", el segundo es un monto real de cero.
 *
 * `tarifa === null` es el gap conocido (feature 69/R9): la tienda no tenia tarifa vigente al
 * solicitar, asi que ningun concepto se derivo. No bloquea el cierre; se avisa en la UI.
 */
export interface IngresoOrdenexDTO {
  montoCobrar: string | null; // COD a recaudar, congelado (distinto de montoRecibido)
  cobraComision: boolean;
  esCentral: boolean; // zona GAM: elige la COLUMNA de tarifa, no la formula (R21)
  flete: string | null;
  ivaFlete: string | null;
  fleteDevolucion: string | null;
  ivaFleteDevolucion: string | null;
  comisionCod: string | null;
  ivaComisionCod: string | null;
  // Agrupados (concepto + su IVA en UN solo monto): es como se lee el dinero en las tablas
  // y los paneles. El detalle separado sigue arriba, para el desglose que muestra la
  // formula. `null` cuando el concepto no aplica a ese resultado.
  fleteConIva: string | null;
  fleteDevolucionConIva: string | null;
  comisionConIva: string | null;
  total: string; // suma de los conceptos presentes (STRING escala 2)
  tarifa: TarifaSnapshotDTO | null; // null = sin tarifa vigente al solicitar (R9)
}

/**
 * Totales por concepto de un cierre: la suma del desglose de TODAS sus gestiones. A
 * diferencia de los movimientos de wallet (que OMITEN los conceptos en 0.00), acá cada
 * concepto se emite siempre: es una vista de auditoria, y un "0.00" explicito dice algo
 * distinto a una fila ausente. Money-safe: STRING escala 2.
 */
export interface TotalesIngresoOrdenex {
  montoCobrar: string;
  // Agrupados (concepto + su IVA): lo que se muestra en los paneles.
  fleteConIva: string;
  fleteDevolucionConIva: string;
  comisionConIva: string;
  total: string;
  // Detalle separado del agrupado de arriba. No se pinta en los paneles; existe para poder
  // auditar cuanto de cada agrupado es IVA sin volver a recorrer las ordenes.
  flete: string;
  ivaFlete: string;
  fleteDevolucion: string;
  ivaFleteDevolucion: string;
  comisionCod: string;
  ivaComisionCod: string;
}

// Totales por metodo de pago + general (R7/R8). Decimal serializado a STRING (R9).
export interface CierreTotales {
  efectivo: string;
  simpe: string;
  transferencia: string;
  general: string;
}

// Grupos por resultado (R3): las 4 claves siempre presentes (aunque vacias).
export type CierreGrupos = Record<CierreResultado, CierreDetalleGestion[]>;

// Un cierre pasado del mensajero (R18): estado + destino + totales snapshot.
export interface CierrePasadoDTO {
  cierreId: string;
  estado: CierreEstado;
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  totales: CierreTotales;
  totalPagoMensajero: string; // feature 39/R13: total snapshot del pago al mensajero (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R12: total snapshot del ingreso de bodega por rechazos (STRING)
  solicitadoAt: string; // ISO
  /**
   * Fecha de resolucion (aprobado/rechazado) e ISO; `null` mientras siga abierto. Viajan al
   * mensajero porque son SU cierre: sin el motivo, un `rechazado` en su histórico no le dice
   * que tiene que corregir. Ambos son OPCIONALES en el tipo por retrocompat de los dobles.
   */
  resueltoAt?: string | null;
  motivoRechazo?: string | null;
}

// R2-R11/R17/R18: detalle del dia + totales + gate de "Solicitar cierre" +
// historico. `forbidden` si el rol no es mensajero (R1/R2). `unauthenticated` lo
// resuelve el borde (Server Action).
export type ListarCierreDiaServiceResult =
  | {
      status: "ok";
      grupos: CierreGrupos;
      totales: CierreTotales;
      totalPagoMensajero: string; // feature 39/R11: total DERIVADO del pago al mensajero (STRING), separado de `totales`
      totalIngresoBodegaRechazos: string; // feature 56/R10: total DERIVADO del ingreso de bodega por rechazos (STRING), separado de `totales` y del pago al mensajero
      puedesSolicitar: boolean; // R10/R11: false si hay pendientes o no hay gestiones
      motivoBloqueo: string | null; // texto accionable si !puedesSolicitar
      cierresPasados: CierrePasadoDTO[]; // R18
      // Feature 111/R13 (datos): `true` si el mensajero tiene un cierre `vencido` en el
      // histórico (derivado de `cierresPasados`, sin query extra). Habilita el CTA
      // diferenciado "Solicitar aprobación del cierre vencido" en la UI, con independencia de
      // `puedesSolicitar`. El service SIEMPRE lo puebla; opcional en el tipo por retrocompat.
      tieneVencido?: boolean;
      // Feature 109/R31 (datos): `true` si el mensajero tiene un cierre `rechazado` en el
      // histórico. En el modelo GLOBAL un `rechazado` NO es terminal: bloquea y es RE-SOLICITABLE.
      // Habilita el MISMO CTA de re-solicitud que el `vencido` (111/R13). SIEMPRE poblado;
      // opcional por retrocompat.
      tieneRechazado?: boolean;
    }
  | { status: "forbidden" };

/**
 * Detalle de UN cierre YA SOLICITADO del propio mensajero (pedido humano: poder "ver" un
 * cierre anterior, no solo su fila de totales). Es SOLO LECTURA y estrictamente propio: el
 * scope por `mensajero_id` va en el WHERE del repo, asi que un id ajeno o inexistente cae en
 * `no_encontrada` sin distinguirse (mismo criterio que el detalle del admin, 38/R13).
 *
 * Muestra lo MISMO que la vista en vivo del dia —sus gestiones agrupadas por resultado y sus
 * totales—, con dos diferencias: los montos salen del SNAPSHOT congelado al solicitar (no se
 * re-derivan de la tarifa de hoy) y la indemnizacion sigue sin viajar (design §7.2: no es
 * plata suya; la consulta ni la selecciona).
 */
/**
 * Feature 264 (R9/R10) — UNA ORDEN QUE EL CORTE DIARIO BARRIO A `sin_gestionar` al crear un
 * cierre.
 *
 * NO es un resultado de gestion: no tiene gestion, y por eso NO tiene NI UN campo de dinero. Ni
 * monto cobrado, ni monto recibido, ni metodo de pago, ni pago al mensajero, ni ingreso de
 * Ordenex, ni ingreso de bodega, ni indemnizacion, ni evidencia, ni resultado (R10). Si algun dia
 * aparece uno aqui, es un bug de diseño y no una mejora: R19/R20/R22 dicen que estas ordenes no
 * mueven un solo total, y la unica forma de que eso sea IMPOSIBLE en vez de VIGILADO es que no
 * haya campo donde meter un importe. Lo vigila
 * `tests/unit/guards/cierre-sin-gestion-sin-dinero.guardia.test.ts`.
 *
 * Los descriptivos son los CONGELADOS al barrer (R11), no los que la orden tenga hoy.
 *
 * VIVE AQUI Y NO EN EL CONTRATO DEL ADMIN, aunque el design lo situara alli. Declararlo en
 * `ICierresAdminService.ts` obligaba a que ESTE archivo lo importara, y esa arista nueva metia
 * `lib/types/cierres-admin.ts` y `lib/types/wallet.ts` —que importan `Prisma` como VALOR— en el
 * grafo que recorre el panel del mensajero: el bundle del navegador se llevaba el cliente de
 * Prisma entero. Lo cazo `tests/unit/guards/pagos-captura.guardia.test.ts` (R19 de la 212), y por
 * eso la dependencia va en el sentido que ya existia: el contrato del admin depende de este, no
 * al reves. Desde alli se RE-EXPORTA, asi que la ruta que nombra el design sigue resolviendo.
 */
export interface CierreOrdenSinGestion {
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  producto: string;
  tiendaNombre: string;
  zonaNombre: string;
  /** `en_reparto` | `ayuda_tienda`; `null` SOLO si no consta (R4/R32/R33). */
  estatusOrigen: OrderStatusValue | null;
}

export type VerCierrePasadoServiceResult =
  | {
      status: "ok";
      cierre: CierrePasadoDTO;
      grupos: CierreGrupos; // por resultado (mismo reuso que la vista en vivo)
      /**
       * Feature 264 (Q1/R30) — EL MISMO PAR DE CAMPOS QUE EL DETALLE DEL ADMIN, porque es EL MISMO
       * COMPONENTE de pantalla (`CierreFacturaDetalle`, renderizado por los dos modulos). Que
       * pintara la seccion en una superficie y la callara en la otra es el arreglo a medias que se
       * corrigio en la 263.
       *
       * Nada de dinero cruza por aqui —la lista no tiene ni un campo de importe—, asi que la regla
       * de audiencia de la 38/40 (§7.2: «el mensajero no ve la plata de la empresa») no aplica:
       * son SUS ordenes, las que le bloquearon el cierre.
       */
      ordenesSinGestion: CierreOrdenSinGestion[];
      /** R27/R28: `false` = cierre ANTERIOR al registro. `[]` con `false` NO es «no hubo ninguna». */
      sinGestionRegistrado: boolean;
    }
  | { status: "forbidden" } // rol != mensajero
  | { status: "no_encontrada" }; // id inexistente o de otro mensajero (no se distinguen)

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41): UNA PAGINA de los cierres solicitados por el
 * mensajero + el total del conjunto. Contrato comun de T H.2, sin campos extra.
 *
 * `tieneVencido`/`tieneRechazado` NO viajan aqui a proposito: son avisos de la PANTALLA
 * derivados del historico COMPLETO, y siguen llegando por `listarCierreDia`. Derivarlos de
 * una pagina los volveria falsos en cuanto el cierre vencido cayera en la pagina 2 (R50).
 */
export type ListarCierresPasadosServiceResult = ListarPaginadoServiceResult<CierrePasadoDTO>;

/**
 * Feature 184 — Tanda C (R1/R4/R6/R9) — el CONJUNTO de «Cierres solicitados» del PROPIO
 * mensajero, sin recorte, que es del que sale el archivo.
 *
 * Hermano de `listarCierresPasadosPaginado`: mismo guard, mismo acotamiento por actor, mismo
 * metodo de repositorio y por tanto MISMO mapper de dinero. Lo unico que no lleva es el recorte.
 *
 * **Y, sobre todo, no firma ninguna URL de evidencia (R9).** Hasta hoy este archivo se producia
 * releyendo `listarCierreDia()`, que ademas del historico trae las gestiones del dia, resuelve la
 * tarifa del mensajero y firma en lote las evidencias fotograficas de TODAS ellas contra Supabase
 * Storage. El archivo no lleva ninguna de esas URL —sus ocho columnas salen enteras del
 * `CierrePasadoDTO`—, asi que firmarlas para generarlo era trabajo perdido, y pagado en red.
 */
export type ListarCierresPasadosCompletoServiceResult =
  ListarCompletoServiceResult<CierrePasadoDTO>;

// R10-R16: solicitud de cierre. Sin input de negocio (el actor y sus gestiones lo
// determinan todo). `conflict` cubre R10 (pendientes) / R11 (vacio) / R12
// (duplicado); `validation_error` cubre R16 (sin zona).
export type SolicitarCierreServiceResult =
  | {
      status: "ok";
      // Feature 111/R6/P2 + feature 109/R28: distingue el toast del cliente. `creado` = cierre nuevo
      // (flujo 37); `vencido_solicitado` = transición vencido→solicitado (R6/R8);
      // `rechazado_solicitado` = transición rechazado→solicitado (109/R28), ambas SIN cierre nuevo
      // ni snapshot. El service SIEMPRE lo puebla; opcional en el tipo por retrocompat.
      via?: "creado" | "vencido_solicitado" | "rechazado_solicitado";
      // Presentes SOLO en la rama de creación (`via: "creado"`); ausentes al transicionar un
      // vencido (R8: no se re-lee ni recalcula el snapshot money-critical del cierre).
      cierreId?: string;
      totales?: CierreTotales;
      destinoTipo?: CierreDestinoTipo;
    }
  | { status: "forbidden" } // rol != mensajero (R1)
  | { status: "conflict"; motivo: string } // R10 pendientes / R11 vacio / R12 duplicado / 111 R7
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R16 sin zona

// Feature 67/R1-R6/R8-R10 — resultado del deshacer. `ok` devuelve el `ordenId` para que la
// vista sepa que orden volvio a `en_reparto`. `forbidden` cubre R8 (rol != mensajero) y R9
// (gestion ajena o inexistente: NO se distinguen, para no revelar datos de gestiones ajenas).
// `conflict` con motivo ACCIONABLE cubre R2 (ya en un cierre), R3 (ya deshecha), R4 (no es la
// mas reciente), R5 (la orden ya se movio) y R6 (orden borrada). `validation_error` cubre el
// catalogo de estados incompleto. `unauthenticated` (R7) lo resuelve el borde (Server Action).
export type DeshacerGestionServiceResult =
  | { status: "ok"; ordenId: string }
  | { status: "forbidden" } // R8/R9
  | { status: "conflict"; motivo: string } // R2/R3/R4/R5/R6
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export interface ICierreDiaService {
  /**
   * R2-R11/R17/R18: lista las gestiones del dia del mensajero (cierre_id IS NULL)
   * agrupadas por resultado, con totales por metodo de pago, el gate de "Solicitar
   * cierre" y el historico de cierres. Solo lectura (R17). Rol != mensajero ->
   * forbidden.
   */
  listarCierreDia(actor: Actor): Promise<ListarCierreDiaServiceResult>;
  /**
   * Detalle de UN cierre PASADO del propio mensajero (solo lectura). El scope por
   * `mensajero_id` vive en el WHERE del repo: un cierre ajeno o inexistente ->
   * `no_encontrada`, sin distinguirlos. Rol != mensajero -> `forbidden`.
   */
  verCierrePasado(cierreId: string, actor: Actor): Promise<VerCierrePasadoServiceResult>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): «Cierres solicitados» del mensajero
   * (R18), paginado en el servidor.
   *
   * MISMO acotamiento por actor que `listarCierreDia`: rol `mensajero` y `actor.usuarioId`
   * como `mensajero_id` del WHERE (nunca un id de la peticion). Un mensajero no puede pedir
   * la pagina 1 del historico de otro: no hay parametro por el que pedirlo. R44 se cumple por
   * construccion. Cualquier otro rol -> forbidden, sin filas y sin total.
   */
  listarCierresPasadosPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarCierresPasadosServiceResult>;
  /**
   * Feature 184 — Tanda C (R1/R4/R6/R9): el CONJUNTO de «Cierres solicitados» del propio
   * mensajero, sin recorte, para producir el archivo.
   *
   * **No recibe entrada**: este listado no admite filtros, asi que su lista blanca —derivada de
   * la de la pagina quitando `page`/`pageSize`— no deja ninguna clave, y la barrera se aplica
   * entera en el borde (R17). El alcance ES el actor: `actor.usuarioId` va al `mensajero_id` del
   * WHERE y no hay parametro por el que pedir el historico de otro (R4).
   *
   * El tope de filas se evalua aqui (R6): superarlo NO entrega filas ni un archivo truncado.
   *
   * **R9:** ni una llamada al firmador de URL. La relectura que sustituye (`listarCierreDia`)
   * firma las evidencias de todas las gestiones del dia; el archivo no usa ninguna.
   */
  listarCierresPasadosCompleto(actor: Actor): Promise<ListarCierresPasadosCompletoServiceResult>;
  /**
   * R10-R16: crea la solicitud de cierre (`solicitado`) agrupando TODAS las
   * gestiones pendientes del mensajero, con destino derivado por zona (R15) y
   * totales snapshot (R14). Todo-o-nada (R13).
   */
  solicitarCierre(actor: Actor): Promise<SolicitarCierreServiceResult>;
  /**
   * Feature 67/R1-R6/R8/R9/R18/R19 — DESHACE una gestion: la ANULA con rastro (no la borra,
   * decision 2 del humano) y devuelve su orden a `en_reparto` con su mensajero, de forma
   * atomica. La VENTANA es `cierre_id IS NULL` (decision 1): antes de solicitar el cierre.
   * Solo el propio mensajero dueño de la gestion (F1.4-f); cualquier otro rol -> `forbidden`.
   * NO toca el puntero `usuario.orden_en_gestion_id` (R29/R30, F1.4-c): la orden se retoma con
   * `escogerParaGestion` (36), que ya tiene la guardia 1-a-1.
   *
   * FEATURE 261 (B6, R17/R18/R19) — `now` es el reloj INYECTABLE del que salen los DOS valores
   * que la escritura necesita: el instante de la reasignacion (`asignado_at = now`) y el dia de
   * Costa Rica en curso (`startOfDayCR(now)`). Un solo reloj para las dos columnas.
   *
   * Y la regla del dia cambia: al deshacer, el dia de reparto pasa a ser el de hoy **salvo que
   * la orden ya este reservada para un dia POSTERIOR**, en cuyo caso se CONSERVA. Una reserva
   * futura no se cancela por reponer una asignacion.
   */
  deshacerGestion(
    gestionId: string,
    actor: Actor,
    now?: Date,
  ): Promise<DeshacerGestionServiceResult>;
}
