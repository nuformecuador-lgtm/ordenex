import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MetodoPago } from "@/lib/types/metodo-pago";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";

// Feature 36 — contrato del servicio del flujo del mensajero: listar mis
// asignaciones, recoger (una o varias), escoger una para gestionar (bloqueo
// 1-a-1) y gestionar (4 resultados). Logica de negocio pura (sin HTTP ni Prisma);
// el borde (Server Action) la traduce a resultado tipado.

// DTO de una asignacion con el detalle completo para la UI (R11). Los nombres ya
// resueltos (no IDs de catalogo); `montoCobrar` serializado a number|null.
export interface MiAsignacionDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  peso: number | null;
  montoCobrar: number | null;
  notas: string | null;
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
}

// Feature 61: KPIs del portal del mensajero, calculados SERVER-SIDE (autoritativos).
export interface MisAsignacionesKpis {
  /** # de ordenes en `en_reparto` (aceptadas/recogidas, en camino). */
  pendientes: number;
  /** # de ordenes `entregada` del mensajero. */
  entregadas: number;
  /** Suma de `montoCobrar` (COD) de las ordenes en `en_reparto`; null cuenta 0. */
  porCobrar: number;
}

// R9/R10/R20: dos grupos separados (por recoger vs por gestionar) + el puntero de
// bloqueo del actor (para que la UI marque la orden activa y bloquee las demas).
// Feature 61: + `kpis` para la fila de indicadores del portal.
export type ListarMisAsignacionesServiceResult =
  | {
      status: "ok";
      porRecoger: MiAsignacionDTO[];
      porGestionar: MiAsignacionDTO[];
      ordenEnGestionId: string | null;
      kpis: MisAsignacionesKpis;
    }
  | { status: "forbidden" };

// R16: recoger recibe un conjunto de ids (soporta "recoger todas" y de a una).
export interface RecogerInput {
  ordenIds: string[];
}

// R17/R29: motivo por orden cuando una no puede recogerse (borrada, origen
// invalido). El service ABORTA sin efectos.
export interface DetalleConflicto {
  ordenId: string;
  motivo: string;
}

export type RecogerServiceResult =
  | { status: "ok"; recogidas: string[] }
  | { status: "forbidden" } // R12 (rol) / R17 (orden ajena o inexistente)
  | { status: "conflict"; detalle: DetalleConflicto[] }; // R17 (origen invalido)

export type EscogerServiceResult =
  | { status: "ok"; ordenId: string }
  | { status: "forbidden" } // R12 / orden ajena
  | { status: "conflict"; motivo: string }; // R21: ya hay otra orden activa / origen invalido

// Evidencia ya leida del borde (binario + metadatos), lista para subir a Storage.
export interface EvidenciaArchivo {
  contentType: string;
  bytes: Uint8Array;
}

// Entrada discriminada por `resultado` (R22/R25/R27/R29). La validacion de
// obligatoriedad/MIME/tamano/fecha ya paso en el borde (zod); el service revalida
// propiedad/origen/bloqueo y la regla (h) monto == montoCobrar.
export type GestionarInput =
  | {
      ordenId: string;
      resultado: "entregada";
      montoRecibido: number;
      metodoPago: MetodoPago;
      evidencia: EvidenciaArchivo;
    }
  | { ordenId: string; resultado: "reprogramada"; fechaReprogramacion: string; motivo: string }
  // Feature 73/R10: la causa tipificada es un campo de la rama `devuelta` y SOLO de ella.
  // Feature 75: la evidencia pasa a ser obligatoria tambien en `devuelta` (espejo de rechazada).
  | {
      ordenId: string;
      resultado: "devuelta";
      causaDevolucion: CausaDevolucion;
      motivo: string;
      evidencia: EvidenciaArchivo;
    }
  | { ordenId: string; resultado: "rechazada"; motivo: string; evidencia: EvidenciaArchivo };

export type GestionarServiceResult =
  | { status: "ok"; ordenId: string; estado: string; evidenciaUrl?: string }
  | { status: "forbidden" } // R12 / orden ajena
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R22/R24 (monto != montoCobrar, etc.)
  | { status: "conflict"; motivo: string }; // R18/R21 origen invalido / otra orden activa

// R35: liberar el puntero de bloqueo. Idempotente: `ok` aunque no hubiera nada
// que limpiar; `forbidden` si el actor no es mensajero.
export type LiberarServiceResult = { status: "ok" } | { status: "forbidden" };

export interface IMisAsignacionesService {
  /** R9-R13: dos grupos + puntero de bloqueo; solo `mensajero` (sobre sus ordenes). */
  listarMisAsignaciones(actor: Actor): Promise<ListarMisAsignacionesServiceResult>;
  /** R14-R17: transiciona en_espera_aceptacion -> en_reparto (lote o de a una). */
  recogerAsignaciones(input: RecogerInput, actor: Actor): Promise<RecogerServiceResult>;
  /** R19-R21: fija la orden activa 1-a-1; conflict si ya hay otra activa. */
  escogerParaGestion(ordenId: string, actor: Actor): Promise<EscogerServiceResult>;
  /** R18/R22-R32: registra la gestion (4 resultados) con atomicidad storage<->DB. */
  gestionar(input: GestionarInput, actor: Actor): Promise<GestionarServiceResult>;
  /** R35: libera el puntero de bloqueo del propio actor si apunta a esa orden. */
  liberarGestion(ordenId: string, actor: Actor): Promise<LiberarServiceResult>;
}
