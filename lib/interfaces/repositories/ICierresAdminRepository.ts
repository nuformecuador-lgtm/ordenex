import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

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

// Feature 158 (T1.14, R19/R22): UN monto de indemnizacion, ya validado en el borde. El monto
// viaja como STRING (money-safe, R24) y solo se convierte a `Prisma.Decimal` al ESCRIBIR.
export interface IndemnizacionCapturada {
  gestionId: string;
  monto: string; // STRING 2 dec -> Prisma.Decimal en la impl
}

// Datos de la transicion guardada (aprobar/rechazar). `motivoRechazo` = null al
// aprobar; el motivo (ya validado) al rechazar.
export interface ResolverCierreInput {
  cierreId: string;
  alcance: Alcance;
  nuevoEstado: "aprobado" | "rechazado";
  resueltoPor: string;
  motivoRechazo: string | null;
  // Feature 158 (T1.14, R19-R23/R28): presente SOLO al aprobar -> DENTRO de la MISMA tx
  // escribe `gestion_orden.indemnizacion` (con `cierreId` y `resultado` como GUARDIA del
  // WHERE, no como filtro cosmetico) y emite el egreso `egreso_indemnizacion` del cierre.
  // Ausente/vacio = el cierre no tiene incidentes (o es un rechazo, R23) -> no escribe montos
  // ni emite movimiento. Mismo patron opcional que `liberacionSinGestionar` (109) y
  // `devolucionRechazadas` (139).
  indemnizaciones?: ReadonlyArray<IndemnizacionCapturada>;
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
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): UNA PAGINA del HISTORICO del alcance
   * (los cierres que NO estan en la cola de pendientes) + el TOTAL del conjunto.
   *
   * Mismo `alcanceWhere` que `findCierresByAlcance` y mismo `orderBy solicitadoAt desc`
   * (R51): esta consulta es aquella con dos anadidos, `estado NOT IN <cola>` —el espejo del
   * `else` con que el servicio parte hoy las dos listas (R44)— y el recorte `skip`/`take`.
   *
   * Devuelve pagina Y total en la MISMA llamada. El `count` es la UNICA consulta que R54
   * permite anadir, y viaja aqui dentro para que no pueda resolverse contra un `where`
   * distinto del de la pagina.
   */
  findHistoricoPaginado(
    alcance: Alcance,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CierreAdminResumenRow>>;
  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R51/R54): UNA PAGINA de la COLA de pendientes de
   * decision del alcance (`solicitado` y `vencido`) + el TOTAL del conjunto.
   *
   * COMPLEMENTO EXACTO de `findHistoricoPaginado`: mismo alcance, mismo orden y la MISMA
   * constante de estados, con `in` en vez de `notIn`. Las dos leen `ESTADOS_COLA_CIERRE_DIA`,
   * asi que la particion cola/historico no puede divergir ni dejar una fila fuera de las dos.
   */
  findColaPaginada(
    alcance: Alcance,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CierreAdminResumenRow>>;
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
   * Feature 158 (T1.12, R19/R21/R25): ids de las gestiones con `resultado = incidente`
   * vinculadas a ESE cierre, acotadas por el alcance en el WHERE (nunca en memoria). Es lo que
   * el service necesita para exigir COBERTURA EXACTA de los montos al aprobar: ni falta
   * ninguna (R19/R20) ni sobra ninguna (R21). Fuera de alcance / cierre inexistente -> lista
   * vacia, sin distinguir (R25: no se revela nada del cierre).
   */
  findGestionesIncidenteDelCierre(cierreId: string, alcance: Alcance): Promise<string[]>;
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
