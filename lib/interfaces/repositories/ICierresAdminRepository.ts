import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";

// Feature 38 — contrato del repositorio de "Cierres del dia" del admin. Solo queries
// Prisma; sin logica de negocio (esa vive en CierresAdminService). El ALCANCE
// (rol+zona destino) SIEMPRE va en el WHERE (R2/R13), nunca filtrado en memoria.
// Money-safe: los Decimal se devuelven ya serializados a STRING.

// Alcance de un admin: tipo de bodega destino + (opcional) su zona. El maestro no se
// acota por zona (destinoZonaId = null); el adminSatelite si (su zona).
export interface Alcance {
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string | null;
}

// Fila cruda de un cierre dentro del alcance (cabecera). Totales ya como STRING
// (money-safe); `resueltoAt`/`motivoRechazo` null mientras `solicitado`.
export interface CierreAdminResumenRow {
  cierreId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  estado: CierreEstado;
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  destinoZonaNombre: string;
  totales: {
    efectivo: string;
    simpe: string;
    transferencia: string;
    general: string;
  };
  totalPagoMensajero: string; // feature 39/R17: snapshot total del pago al mensajero (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R16: snapshot total del ingreso de bodega por rechazos (STRING)
  solicitadoAt: string; // ISO
  resueltoAt: string | null; // ISO
  motivoRechazo: string | null;
}

// Feature 109 (T3.1, R16-R19): config OPCIONAL de la LIBERACION de ordenes `sin_gestionar` a
// bodega. Presente SOLO al APROBAR (la resuelve el service via `findEstatusIdByValue`/
// `findCentralZonaId`); ausente al rechazar (R27: un rechazo NO libera). Los estatus ids del
// catalogo + la zona central se pasan por input (el repo no re-resuelve catalogo).
export interface LiberacionSinGestionarConfig {
  sinGestionarEstatusId: string;
  enBodegaEstatusId: string; // destino central
  enBodegaSateliteEstatusId: string; // destino satelite
  centralZonaId: string | null; // null = ningun mensajero clasifica central (fallback satelite)
}

// Feature 139 (T1.1, R5): config OPCIONAL del DISPARO de la devolucion de RECHAZADAS al APROBAR
// el cierre. Presente SOLO al aprobar (la resuelve el service via `findEstatusIdByValue`/
// `findCentralZonaId`); ausente al rechazar (R10: un rechazo NO dispara). Los estatus ids del
// catalogo + la zona central se pasan por input (el repo no re-resuelve catalogo). Molde de
// `LiberacionSinGestionarConfig`. El destino por orden lo decide `resolverDestinoCierre` sobre la
// zona de la orden: bodega satelite -> `porDevolverId`; bodega central -> `porDevolverATiendaId`.
export interface DevolucionRechazadasConfig {
  rechazadaId: string; // estado de ORIGEN (guarda del updateMany, R7/R22)
  porDevolverId: string; // destino satelite
  porDevolverATiendaId: string; // destino central
  centralZonaId: string | null; // null = ningun mensajero clasifica central (fallback satelite)
}

// Datos de la transicion guardada (aprobar/rechazar). `motivoRechazo` = null al
// aprobar; el motivo (ya validado) al rechazar.
export interface ResolverCierreInput {
  cierreId: string;
  alcance: Alcance;
  nuevoEstado: "aprobado" | "rechazado";
  resueltoPor: string;
  motivoRechazo: string | null;
  // Feature 109 (T3.1, R16-R19): presente SOLO al aprobar -> DENTRO de la MISMA tx libera las
  // ordenes `sin_gestionar` del mensajero del cierre a bodega (por zona, con `prioridad = true`),
  // via el choke point. Ausente = no hay liberacion (rechazo, o cierres sin la config).
  liberacionSinGestionar?: LiberacionSinGestionarConfig;
  // Feature 139 (T1.1, R5-R11): presente SOLO al aprobar -> DENTRO de la MISMA tx (tras liberar
  // `sin_gestionar`) transiciona las `rechazada` del mensajero del cierre a `por_devolver`
  // (satelite) / `por_devolver_a_tienda` (central) por zona, via el choke point
  // (`origen_tipo = devolucion_rechazada`). Money-neutral: NO toca mensajero/prioridad (R8).
  // Ausente = no dispara (rechazo R10, o cierres sin la config).
  devolucionRechazadas?: DevolucionRechazadasConfig;
}

// Resultado de la transicion guardada: `updated` (aplicada), `conflict` (existe en
// alcance pero ya no esta `solicitado`, R12), `fuera_de_alcance` (no existe o de otra
// bodega/zona, R13).
export type ResolverCierreResult = "updated" | "conflict" | "fuera_de_alcance";

export interface ICierresAdminRepository {
  /**
   * R2/R4/R5/R8/R9: cierres del alcance (WHERE destino_tipo + destino_zona_id si !=
   * null), join a usuario/zona para nombres, orderBy solicitadoAt desc. Totales
   * snapshot -> STRING. Usa el indice [destinoTipo, destinoZonaId].
   */
  findCierresByAlcance(alcance: Alcance): Promise<CierreAdminResumenRow[]>;
  /**
   * R6/R7/R9/R13: un cierre SOLO si su destino casa el alcance en el WHERE (guardia
   * R13) + sus gestiones (WITH_DETALLE, reuso 37, WHERE cierre_id = X). Fuera de
   * alcance / inexistente -> null (no se distingue).
   */
  findCierreByIdEnAlcance(
    cierreId: string,
    alcance: Alcance,
  ): Promise<{ cierre: CierreAdminResumenRow; gestiones: CierreGestionPendienteRow[] } | null>;
  /**
   * R10-R15: transicion atomica y guardada de `solicitado` -> nuevoEstado, SOLO si
   * el cierre sigue `solicitado` y casa el alcance (updateMany con guardia). NO toca
   * gestion_orden ni otra tabla (R15). Distingue updated/conflict/fuera_de_alcance.
   */
  resolverCierre(input: ResolverCierreInput): Promise<ResolverCierreResult>;
  /**
   * Feature 111/R16 — VALVULA DE ESCAPE: destraba un `vencido` ABANDONADO transicionandolo
   * `vencido -> solicitado` en NOMBRE del mensajero (para el mensajero que nunca lo solicita y
   * dejaria a su bodega bloqueada, 41 R17). Escritura GUARDADA por estado + alcance:
   * `updateMany WHERE id = cierreId AND estado = 'vencido' AND <alcance>` `SET estado =
   * 'solicitado'`. SOLO cambia `estado`: NO recalcula ni muta el snapshot money-critical, ni
   * toca `resuelto_por`/`resuelto_at` (money-safe, R16/R21; la auditoria la deja la resolucion
   * posterior, R17). `count === 0` -> `conflict` (ya no es `vencido`) o `fuera_de_alcance` (no
   * existe / otra bodega-zona), como `resolverCierre`.
   */
  forzarSolicitudVencido(cierreId: string, alcance: Alcance): Promise<ResolverCierreResult>;
}
