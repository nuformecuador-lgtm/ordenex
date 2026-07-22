import type { GestionResultado, MetodoPagoValue } from "@prisma/client";
import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";
import type {
  CierrePasadoDTO,
  CierreTotales,
  IngresoOrdenexDTO,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 37 — contrato del repositorio del cierre del dia. Solo queries Prisma;
// sin logica de negocio (esa vive en CierreDiaService). Money-safe: los Decimal se
// devuelven ya serializados a STRING (montoRecibido, totales), y `crearCierre`
// recibe los totales snapshot como STRING para construir Prisma.Decimal.

// Fila de una gestion pendiente de cierre (cierre_id IS NULL) con el detalle de la
// orden ya resuelto (R3/R4). `montoRecibido` en STRING (money-safe, R9), null salvo
// entregada. `evidenciaStoragePath` es el path CRUDO del bucket privado; el service
// lo FIRMA antes de exponerlo (R5).
export interface CierreGestionPendienteRow {
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
  resultado: GestionResultado;
  montoRecibido: string | null;
  metodoPago: MetodoPagoValue | null;
  motivo: string | null;
  fechaReprogramacion: string | null; // ISO date (YYYY-MM-DD)
  evidenciaStoragePath: string | null;
  // Feature 39: pago al mensajero SNAPSHOTEADO de la gestion (money-safe STRING). `null`
  // en gestiones aun sin cerrar / cierres pre-migracion (R22). En la vista EN VIVO (37)
  // el service lo DERIVA; en el detalle admin (38/40) es el snapshot leido de la columna.
  pagoMensajero: string | null;
  // Feature 56: ingreso de bodega por rechazo SNAPSHOTEADO de la gestion (money-safe
  // STRING). `null` en gestiones aun sin cerrar / cierres pre-migracion (R21/R22). Solo
  // `rechazada` con tarifa que aplica es != 0.00. Concepto INDEPENDIENTE de pagoMensajero
  // (R7b) y del dinero recibido (R20). En vivo (37) el service lo DERIVA; en admin (38/40)
  // es el snapshot leido de la columna.
  ingresoBodegaRechazo: string | null;
  // Feature 102/R1/R3: clasificacion SLA (cron 99) vs manual (mensajero) de una gestion
  // `rechazada`, DERIVADA del historial inmutable (`origen_tipo = escalado_devuelta_sla`), sin
  // columna nueva. La pueblan los repos de ADMIN (38/40); en la vista EN VIVO del mensajero (37)
  // es `false` por defecto (no expone el desglose, R11).
  esRechazoSla: boolean;
  // Desglose del ingreso de Ordenex + tarifa congelada, DERIVADO del snapshot. Solo lo
  // pueblan los repos de ADMIN (38/40): la vista en vivo del mensajero (37) no lo expone.
  ingresoOrdenex?: IngresoOrdenexDTO | null;
}

// Datos para crear la solicitud de cierre (R13/R14). Totales snapshot como STRING.
export interface CrearCierreInput {
  mensajeroId: string;
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  // Feature 41/C1 (R8): estado con el que se crea el cierre. La 37 crea `solicitado`
  // (default); el corte diario crea `vencido` reusando la MISMA tx de vinculacion +
  // snapshot. Solo estos dos valores son validos como estado de creacion.
  estado?: Extract<CierreEstado, "solicitado" | "vencido">;
  totales: CierreTotales;
  // Feature 39/R12/R14: pago al mensajero snapshoteado por gestion (gestionId -> STRING)
  // + total del cierre (STRING). Se persisten en la MISMA tx que crea el cierre.
  pagoByGestionId: Record<string, string>;
  totalPagoMensajero: string;
  // Feature 56/R11/R12/R13: ingreso de bodega por rechazo snapshoteado por gestion
  // (gestionId -> STRING) + total del cierre (STRING). Se persisten en la MISMA tx que
  // crea el cierre, en paralelo al pago al mensajero.
  ingresoByGestionId: Record<string, string>;
  totalIngresoBodegaRechazos: string;
}

// Fila cruda de un cierre pasado (R18); el repo la mapea a CierrePasadoDTO.
export type CierrePasadoRow = CierrePasadoDTO & { estado: CierreEstado };

// Feature 67 — proyeccion MINIMA de la gestion candidata a deshacerse + el estado real de su
// orden, con TODO lo que necesitan las guardias del service (design 64 §5.2) y nada mas (no
// expone montos ni evidencia: la decision no los usa). `anuladaAt` != null = ya deshecha (R3);
// `cierreId` != null = ya vinculada a un cierre (R2). `orden.estatusId` es el id REAL leido de
// la fila (no un `value`): se pasa tal cual como guardia del UPDATE, sin re-resolver catalogo.
export interface GestionDeshacerRow {
  gestionId: string;
  ordenId: string;
  mensajeroId: string; // R9: dueño de la gestion (la autz la decide el service)
  resultado: GestionResultado; // R5: insumo de la tabla ESTADOS_ESPERADOS
  cierreId: string | null; // R2
  anuladaAt: Date | null; // R3
  orden: {
    deletedAt: Date | null; // R6
    estatusId: string; // R5: id real del estado actual (guardia del UPDATE)
    estatusValue: string; // R5: `value` legible para contrastar con ESTADOS_ESPERADOS
  };
}

// Feature 67/R11/R18/R19/R20/R22 — input de la UNICA escritura del deshacer. `estatusEsperadoId`
// es el `orden.estatusId` REAL leido por `findGestionParaDeshacer` (guardia optimista: si la
// orden se movio entre la lectura y la escritura, el UPDATE afecta 0 filas -> rollback).
export interface AnularGestionInput {
  gestionId: string;
  ordenId: string;
  mensajeroId: string; // R19: mensajero AUTOR (al que se repone la asignacion)
  actorUsuarioId: string; // R11/R20: quien deshace (rastro + actor del historial)
  estatusEsperadoId: string; // R5: estado en el que la orden DEBE seguir estando
  estatusEnRepartoId: string; // R18: destino
}

export interface ICierreDiaRepository {
  /**
   * R2/R3: gestiones del mensajero con `cierre_id IS NULL` + detalle de la orden
   * (join a orden/tienda/geografia). Filtro por mensajero en el WHERE. Solo query.
   */
  findGestionesPendientes(mensajeroId: string): Promise<CierreGestionPendienteRow[]>;
  /**
   * R10: cuenta las ordenes asignadas al mensajero (no borradas) cuyo estado esta
   * en `estados` (en_espera_aceptacion/en_reparto = pendientes de gestion).
   */
  contarOrdenesPendientesGestion(mensajeroId: string, estados: string[]): Promise<number>;
  /** R12: `true` si el mensajero ya tiene un cierre en estado `solicitado`. */
  existeCierreSolicitado(mensajeroId: string): Promise<boolean>;
  /**
   * R13/R14: bajo prisma.$transaction (todo-o-nada): (a) INSERT cierre_dia con el
   * destino derivado + los totales snapshot (estado `solicitado` por defecto, o
   * `vencido` para el corte diario, feature 41/C1), (b) UPDATE gestion_orden SET
   * cierre_id = <nuevo> WHERE mensajero_id = actor AND cierre_id IS NULL (guardia de
   * propiedad + no-cerradas; concurrencia-segura). Devuelve el id del cierre, o `null`
   * si el UPDATE guardado vincula 0 gestiones (carrera: otra solicitud/corte las vinculo
   * primero) -> rollback de la tx, sin efectos (R8/R9/R23).
   */
  crearCierre(input: CrearCierreInput): Promise<string | null>;
  /** R18: cierres del mensajero (mas reciente primero) con estado + totales. */
  findCierresByMensajero(mensajeroId: string): Promise<CierrePasadoDTO[]>;
  /**
   * Feature 67 — lee la gestion candidata a deshacerse + el estado real de su orden. Devuelve
   * la fila SIN juzgarla (las guardias de R2/R3/R5/R6/R9 viven en el service); `null` si la
   * gestion no existe. Solo query.
   */
  findGestionParaDeshacer(gestionId: string): Promise<GestionDeshacerRow | null>;
  /**
   * Feature 67/R4 — id de la gestion NO anulada mas reciente de la orden (`orderBy created_at
   * desc`), o `null` si la orden no tiene ninguna vigente. El service exige que coincida con la
   * gestion a deshacer: solo se deshace la ULTIMA. Se ordena por `gestion_orden.created_at` (una
   * gestion por tx) y NO por filas de historial, que pueden empatar en `created_at` (design §8).
   */
  findUltimaGestionNoAnuladaId(ordenId: string): Promise<string | null>;
  /**
   * Feature 67/R11/R18-R23 — UNICA escritura del deshacer, todo-o-nada en UNA `$transaction`
   * (R22): (1) ANULA la gestion con rastro (`anulada_at`/`anulada_por`) conservando intactos
   * todos sus datos originales (R11/R12), (2) devuelve la orden a `en_reparto` REPONIENDO la
   * asignacion al mensajero autor (R18/R19: una gestion `devuelta` con reintento habia limpiado
   * `mensajero_asignado_id`), (3) registra la transicion por el CHOKE POINT del historial
   * (`appendCambioEstado`, `origen_tipo = deshacer_gestion`) en la MISMA tx (R20/R21). NO toca
   * `usuario.orden_en_gestion_id` (R29) ni ninguna fila previa del historial (R23).
   *
   * Ambas escrituras van GUARDADAS en su WHERE (concurrencia-segura): si la gestion dejo de ser
   * deshacible o la orden se movio entre la lectura y la escritura, afecta 0 filas -> rollback
   * -> `false` SIN efectos parciales (el service lo traduce a `conflict`). `true` = deshecha.
   */
  anularGestionYDevolverAGestion(input: AnularGestionInput): Promise<boolean>;
}
