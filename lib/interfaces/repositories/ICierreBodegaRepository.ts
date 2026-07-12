import type { CierreEstado } from "@/lib/types/cierre";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";

// Feature 40 — contrato del repositorio del "Cierre de bodega" (lado adminSatelite:
// consolidar + solicitar). Solo queries Prisma; sin logica de negocio (esa vive en
// CierreBodegaService). El ALCANCE (zona/estado) SIEMPRE va en el WHERE (R3/R5/R6),
// nunca filtrado en memoria. Money-safe: los Decimal se devuelven ya serializados a
// STRING; `crearCierreBodega` recibe los totales snapshot como STRING.

// Cabecera de un cierre_dia consolidable (aprobado, sin cierre de bodega): mensajero
// + totales snapshot (money-safe STRING). El detalle se deriva de sus gestiones.
export interface CierreDiaConsolidableRow {
  cierreDiaId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  totales: CierreTotales; // snapshot del cierre_dia (STRING escala 2)
}

// Fila cruda de un cierre de bodega (cabecera). Totales ya como STRING (money-safe);
// `resueltoAt`/`motivoRechazo` null mientras `solicitado`. `cantidadCierres` = # de
// cierre_dia incluidos (_count).
export interface CierreBodegaResumenRow {
  cierreBodegaId: string;
  zonaId: string;
  zonaNombre: string;
  solicitadoPorId: string;
  solicitadoPorNombre: string;
  estado: CierreEstado;
  totales: CierreTotales;
  cantidadCierres: number;
  solicitadoAt: string; // ISO
  resueltoAt: string | null; // ISO
  motivoRechazo: string | null;
}

// Datos para crear la solicitud de cierre de bodega (R9/R10). Totales snapshot
// AGREGADOS como STRING; `cierreDiaIds` = los cierre_dia consolidados a vincular.
export interface CrearCierreBodegaInput {
  zonaId: string;
  solicitadoPor: string;
  cierreDiaIds: string[];
  totales: CierreTotales;
}

export interface ICierreBodegaRepository {
  /**
   * R5: cierre_dia de la zona en `estado='aprobado'`, `destino_tipo='bodega_satelite'`,
   * `destino_zona_id=zonaId` y `cierre_bodega_id IS NULL` (aun no consolidados) +
   * mensajero + totales snapshot. Filtro por zona/estado en el WHERE.
   */
  findCierresDiaConsolidables(zonaId: string): Promise<CierreDiaConsolidableRow[]>;
  /**
   * R6: cuenta los cierre_dia de la zona (`destino_tipo='bodega_satelite'`,
   * `destino_zona_id=zonaId`) aun en estado `solicitado` (pendientes de que el
   * adminSatelite los resuelva). Precondicion para poder cerrar la bodega.
   */
  contarCierresDiaSolicitados(zonaId: string): Promise<number>;
  /** R8: `true` si ya existe un CierreBodega de la zona en estado `solicitado`. */
  existeCierreBodegaSolicitado(zonaId: string): Promise<boolean>;
  /**
   * R9/R10: bajo prisma.$transaction (todo-o-nada): (a) INSERT cierre_bodega
   * (`solicitado`, snapshot de totales agregados como Prisma.Decimal), (b) UPDATE
   * cierre_dia SET cierre_bodega_id=<nuevo> WHERE id IN (cierreDiaIds) AND
   * cierre_bodega_id IS NULL AND estado='aprobado' AND destino_zona_id=zonaId
   * (guardia concurrencia-segura). Devuelve el id del cierre de bodega. Una violacion
   * del indice unico parcial (P2002) se propaga para que el service la traduzca a
   * `conflict` (R8).
   */
  crearCierreBodega(input: CrearCierreBodegaInput): Promise<string>;
  /**
   * F1.4-h: historico propio de la zona (todos los cierres de bodega de la zona), mas
   * reciente primero, totales snapshot -> STRING, `cantidadCierres` = _count.
   */
  findCierresBodegaByZona(zonaId: string): Promise<CierreBodegaResumenRow[]>;
}
