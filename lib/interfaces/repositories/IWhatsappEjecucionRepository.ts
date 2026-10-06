import type {
  WhatsappEjecucionEstado,
  WhatsappEntregaEstado,
  WhatsappEnvioOrigen,
} from "@prisma/client";
import type { DatosAviso } from "@/lib/whatsapp-envios/informes/tipos";

// Ficha 474 (design §1.4/§1.5/§4.3/§5.4, T6.2) — contrato del repositorio de EJECUCIONES y
// ENTREGAS. La idempotencia vive AQUI, en las tablas de dominio (alternativa D del design): los
// INSERT con `ON CONFLICT DO NOTHING` contra los unicos parciales y el reclamo CONDICIONAL de la
// entrega. Un re-claim por visibility timeout ejecuta el MISMO job dos veces; estas sentencias son
// las que impiden el segundo mensaje.

/** Una ejecucion tal como la necesita el motor. */
export interface EjecucionFila {
  id: string;
  envioId: string;
  origen: WhatsappEnvioOrigen;
  fechaCr: string | null;
  instanteProgramado: Date | null;
  eventoClave: string | null;
  eventoReferencia: string | null;
  eventoDatos: DatosAviso | null;
  notificacionId: string | null;
  solicitadaPor: string | null;
  estado: WhatsappEjecucionEstado;
  motivo: string | null;
  plantillaId: string | null;
  plantillaNombre: string | null;
  /** Valores FIJADOS (R35); `null` = aun sin contenido. */
  valores: Record<string, string> | null;
  pdfRuta: string | null;
  pdfNombre: string | null;
  mediaId: string | null;
  createdAt: Date;
}

/** Una entrega tal como la necesita el motor (con el telefono COMPLETO: no sale hacia la UI). */
export interface EntregaFila {
  id: string;
  ejecucionId: string;
  usuarioId: string | null;
  destinatarioNombre: string;
  telefono: string;
  estado: WhatsappEntregaEstado;
  motivo: string | null;
  intentos: number;
}

/** Resultado de un INSERT idempotente: el id de LA fila (nueva o existente) y si la creo este. */
export interface InsercionIdempotente {
  id: string;
  creada: boolean;
}

export interface FijarContenidoData {
  valores: Record<string, string>;
  plantillaId: string;
  plantillaNombre: string;
  parametros: unknown;
  pdf: { ruta: string; nombre: string; bytes: number; caducaAt: Date } | null;
}

export interface NuevaEntrega {
  usuarioId: string;
  destinatarioNombre: string;
  telefono: string;
  /**
   * `pendiente`, o `telefono_invalido` (R29) con su motivo, o `rechazo_permanente` si se excluye
   * antes de enviar (R16: informe no apto para `adminTienda`). Solo `pendiente` se envia.
   */
  estado: "pendiente" | "telefono_invalido" | "rechazo_permanente";
  motivo: string | null;
}

/** Desenlace de una entrega RECLAMADA (en_curso). */
export type DesenlaceEntrega =
  | { estado: "aceptada"; waMessageId: string; ahora: Date }
  | { estado: "rechazo_permanente"; codigoMeta: number | null; motivo: string }
  | { estado: "pendiente"; motivo: string } // transitorio: vuelve a la cola de reintento
  | { estado: "fallida"; motivo: string }; // transitorio agotado (R36)

/** Estado que llega por el webhook (R38), ya traducido. */
export type EstadoWebhookEntrega = "enviada" | "recibida" | "leida" | "fallida";

/** Fila del historial (R42). Telefono ENMASCARADO: el completo no sale de esta capa. */
export interface HistorialEjecucionItem {
  id: string;
  envioId: string;
  envioNombre: string;
  origen: WhatsappEnvioOrigen;
  instante: Date;
  estado: WhatsappEjecucionEstado;
  motivo: string | null;
  plantillaNombre: string | null;
  conteos: Partial<Record<WhatsappEntregaEstado, number>>;
  /** R43/R44: `null` = sin PDF; `caducado` = purgado. */
  pdf: { nombre: string; caducado: boolean } | null;
}

export interface EntregaDetalle {
  id: string;
  destinatarioNombre: string;
  /** `•••• 7777` (R42). */
  telefonoEnmascarado: string;
  estado: WhatsappEntregaEstado;
  motivo: string | null;
  instante: Date;
}

export interface HistorialFiltro {
  envioId?: string;
  page: number;
  pageSize: number;
}

export interface IWhatsappEjecucionRepository {
  /** R23: `ON CONFLICT (envio_id, fecha_cr) WHERE origen='programado' DO NOTHING` + relectura. */
  insertarProgramada(data: {
    envioId: string;
    fechaCr: string;
    instanteProgramado: Date;
    estado?: "pendiente" | "omitida";
    motivo?: string | null;
  }): Promise<InsercionIdempotente>;
  /** R27: `ON CONFLICT (envio_id, evento_clave, evento_referencia) WHERE origen='evento' DO NOTHING`. */
  insertarEvento(data: {
    envioId: string;
    eventoClave: string;
    eventoReferencia: string;
    eventoDatos: DatosAviso;
    notificacionId: string | null;
  }): Promise<InsercionIdempotente>;
  /** R39: una prueba siempre crea fila (no consume cupo, R23). */
  insertarPrueba(data: { envioId: string; solicitadaPor: string }): Promise<string>;

  obtener(id: string): Promise<EjecucionFila | null>;
  /** Cambia el estado (y motivo). `terminada` sella `terminada_at`. */
  cambiarEstado(
    id: string,
    estado: WhatsappEjecucionEstado,
    opts?: { motivo?: string | null; terminada?: boolean },
  ): Promise<void>;
  /** R35: fija valores + PDF UNA vez (`WHERE valores IS NULL`). `false` si ya estaban fijados. */
  fijarContenido(id: string, data: FijarContenidoData): Promise<boolean>;
  /** R33: el `media_id` de Meta del PDF; uno por ejecucion. */
  fijarMediaId(id: string, mediaId: string): Promise<void>;

  /** R23/R27/R29: `ON CONFLICT (ejecucion_id, usuario_id) DO NOTHING`. */
  insertarEntregas(ejecucionId: string, entregas: NuevaEntrega[]): Promise<void>;
  /** Las entregas `pendiente` de una ejecucion, en orden estable. */
  entregasPendientes(ejecucionId: string): Promise<EntregaFila[]>;
  obtenerEntrega(id: string): Promise<EntregaFila | null>;
  /**
   * R37: RECLAMO condicional `UPDATE … SET estado='en_curso', intentos=intentos+1 WHERE id=$1 AND
   * estado='pendiente'`. `false` = otra ejecucion la tiene o ya tuvo desenlace: NO se envia.
   */
  reclamarEntrega(id: string): Promise<boolean>;
  /** Desenlace de una entrega `en_curso`. Condicional a `en_curso`. */
  resolverEntrega(id: string, desenlace: DesenlaceEntrega): Promise<boolean>;
  /**
   * R38: aplica un estado del webhook por `wa_message_id` SIN retroceder (`aceptada` 1 < `enviada`
   * 2 < `entregada` 3 < `leida` 4; `fallida` solo pisa 1-2). Devuelve filas afectadas.
   */
  aplicarEstadoWebhook(
    waMessageId: string,
    estado: EstadoWebhookEntrega,
    motivo: string | null,
  ): Promise<number>;

  /** R41: instante de la ultima prueba de ese usuario sobre ese envio. */
  ultimaPruebaDe(solicitadaPor: string, envioId: string): Promise<Date | null>;
  /** R42: historial paginado, mas reciente primero, filtrable por envio. */
  historial(filtro: HistorialFiltro): Promise<{ items: HistorialEjecucionItem[]; total: number }>;
  /** R42: detalle de una ejecucion con sus entregas enmascaradas. */
  detalle(id: string): Promise<{ ejecucion: HistorialEjecucionItem; entregas: EntregaDetalle[] } | null>;
  /** R44: ejecuciones con PDF caducado y aun no purgado, hasta `limite`. */
  seleccionarPurga(ahora: Date, limite: number): Promise<{ id: string; pdfRuta: string }[]>;
  marcarPurgadas(ids: string[], ahora: Date): Promise<void>;
  /** Para la lista de envios: la ultima ejecucion (no prueba) de cada envio. */
  ultimaPorEnvio(envioIds: string[]): Promise<Map<string, { instante: Date; estado: WhatsappEjecucionEstado }>>;
  /** R43: ruta y estado del PDF de una ejecucion. */
  pdfDe(id: string): Promise<{ ruta: string | null; purgado: boolean } | null>;
}
