import type { GestionResultado, MetodoPagoValue } from "@prisma/client";
import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";
import type { CierrePasadoDTO, CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";

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
}

// Datos para crear la solicitud de cierre (R13/R14). Totales snapshot como STRING.
export interface CrearCierreInput {
  mensajeroId: string;
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  totales: CierreTotales;
}

// Fila cruda de un cierre pasado (R18); el repo la mapea a CierrePasadoDTO.
export type CierrePasadoRow = CierrePasadoDTO & { estado: CierreEstado };

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
   * destino derivado + los totales snapshot, (b) UPDATE gestion_orden SET cierre_id
   * = <nuevo> WHERE mensajero_id = actor AND cierre_id IS NULL (guardia de
   * propiedad + no-cerradas; concurrencia-segura). Devuelve el id del cierre.
   */
  crearCierre(input: CrearCierreInput): Promise<string>;
  /** R18: cierres del mensajero (mas reciente primero) con estado + totales. */
  findCierresByMensajero(mensajeroId: string): Promise<CierrePasadoDTO[]>;
}
