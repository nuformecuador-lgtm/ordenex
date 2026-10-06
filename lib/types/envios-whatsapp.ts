import { z } from "zod";
import type {
  RolValue,
  WhatsappEjecucionEstado,
  WhatsappEntregaEstado,
  WhatsappEnvioDisparo,
} from "@prisma/client";
import type {
  EntregaDetalle,
  HistorialEjecucionItem,
} from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type { InformeResumen } from "@/lib/whatsapp-envios/informes/catalogo";

// Ficha 474 (design §7) — FRONTERA CONTRACTUAL backend ↔ frontend de «Envíos automáticos»:
// schemas zod del borde de las server actions y los DTOs que devuelven. La pantalla
// (`app/(app)/configuracion/envios-whatsapp`) no necesita ningun otro tipo del backend.

const HORA_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Roles que un envio puede tener como destinatarios (R16). `apiKey` no es una persona. */
export const ROLES_DESTINATARIO = ["maestro", "admin", "adminSatelite", "adminTienda", "mensajero"] as const;
export type RolDestinatario = (typeof ROLES_DESTINATARIO)[number];

/**
 * Mensajes PROPIOS por campo, en el lenguaje de la pantalla. Los usan el schema (borde de las
 * actions) y el service (reglas que dependen de la base), para que el mismo fallo diga lo mismo
 * venga de donde venga. Lo que no tiene uno propio cae en el genérico de `lib/validacion/zod-es`.
 */
export const MENSAJES_ENVIO = {
  nombre: "Escribe un nombre para el envío",
  nombreLargo: "El nombre no puede tener más de 120 caracteres",
  informe: "Elige un informe",
  plantilla: "Elige una plantilla",
  disparo: "Elige cuándo se manda",
  dia: "Elige días de lunes a domingo",
  dias: "Elige al menos un día",
  hora: "Escribe la hora en formato 24 h, por ejemplo 05:00",
  evento: "Elige un evento",
  rol: "Ese rol no puede recibir envíos",
  roles: "Hay demasiados roles elegidos",
  persona: "Elige una persona de la lista",
  personas: "Puedes elegir como máximo 200 personas",
  destinatarios: "Elige al menos un destinatario",
} as const;

const rolSchema = z.enum(["maestro", "admin", "mensajero", "adminTienda", "adminSatelite", "apiKey"], {
  error: MENSAJES_ENVIO.rol,
});

export const seleccionDestinatariosSchema = z
  .object({
    roles: z.array(rolSchema).max(10, MENSAJES_ENVIO.roles).default([]),
    usuarioIds: z.array(z.string().min(1, MENSAJES_ENVIO.persona)).max(200, MENSAJES_ENVIO.personas).default([]),
  })
  .strict();
export type SeleccionDestinatariosInput = z.infer<typeof seleccionDestinatariosSchema>;

/**
 * Alta y edicion (R11). La FORMA aqui; las reglas que dependen del catalogo, de la base o del
 * informe (R12-R14, R16) en el service, con un error por campo.
 */
export const guardarEnvioSchema = z
  .object({
    nombre: z.string(MENSAJES_ENVIO.nombre).trim().min(1, MENSAJES_ENVIO.nombre).max(120, MENSAJES_ENVIO.nombreLargo),
    informeClave: z.string(MENSAJES_ENVIO.informe).regex(/^[a-z0-9_]+$/, MENSAJES_ENVIO.informe),
    plantillaId: z.string(MENSAJES_ENVIO.plantilla).min(1, MENSAJES_ENVIO.plantilla),
    /** Se valida contra el esquema del informe en el service (R13). */
    parametros: z.record(z.string(), z.unknown()).default({}),
    disparo: z.enum(["hora_fija", "evento"], { error: MENSAJES_ENVIO.disparo }),
    /** ISO 1 = lunes … 7 = domingo. Solo `hora_fija`. */
    diasSemana: z
      .array(z.number(MENSAJES_ENVIO.dia).int(MENSAJES_ENVIO.dia).min(1, MENSAJES_ENVIO.dia).max(7, MENSAJES_ENVIO.dia))
      .max(7, MENSAJES_ENVIO.dia)
      .default([]),
    /** `HH:mm` de Costa Rica. Solo `hora_fija`. */
    hora: z.string(MENSAJES_ENVIO.hora).regex(HORA_RE, MENSAJES_ENVIO.hora).nullable().default(null),
    /** Un evento disponible (`listarEventosDisponibles`). Solo `evento`. */
    eventoClave: z.string(MENSAJES_ENVIO.evento).min(1, MENSAJES_ENVIO.evento).nullable().default(null),
    destinatarios: seleccionDestinatariosSchema,
  })
  .strict();
export type GuardarEnvioInput = z.infer<typeof guardarEnvioSchema>;

export const idSchema = z.string().min(1);

export const listarEjecucionesSchema = z
  .object({
    envioId: z.string().min(1).optional(),
    page: z.number().int().positive().default(1),
    pageSize: z
      .number()
      .int()
      .positive()
      .default(20)
      .transform((n) => Math.min(n, 100)),
  })
  .strict();
export type ListarEjecucionesInput = z.infer<typeof listarEjecucionesSchema>;

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

/** Un envio en la lista (`Main`, `ListaMovil`, `Vacio`). */
export interface EnvioListItemDTO {
  id: string;
  nombre: string;
  informeClave: string;
  informeNombre: string;
  plantillaId: string;
  plantillaNombre: string;
  disparo: WhatsappEnvioDisparo;
  diasSemana: number[];
  hora: string | null;
  eventoClave: string | null;
  /** Nombre del evento en español claro (R49); `null` si es a hora fija. */
  eventoNombre: string | null;
  activo: boolean;
  /**
   * R25: proximo envio programado (solo encendido + hora fija). `null` con `avisoSinProxima: true`
   * = encendido y SIN ninguna ejecucion programada: la pantalla muestra el aviso y «Reprogramar».
   */
  proximaEjecucion: Date | null;
  avisoSinProxima: boolean;
  /** Ultima ejecucion (no prueba), para «último envío con su estado». */
  ultimaEjecucion: { instante: Date; estado: WhatsappEjecucionEstado } | null;
}

/** Un envio para el formulario de edicion. */
export interface EnvioDetalleDTO extends EnvioListItemDTO {
  parametros: Record<string, unknown>;
  destinatarios: { roles: RolValue[]; usuarioIds: string[] };
}

/** R17: un destinatario resuelto, sin el telefono completo. */
export interface DestinatarioPreviewDTO {
  usuarioId: string;
  nombre: string;
  rol: RolValue;
  telefonoEnmascarado: string;
  telefonoValido: boolean;
  /** Otro destinatario de la lista tiene el MISMO telefono (cada uno recibe su mensaje). */
  telefonoCompartido: boolean;
}

export interface PreviewDestinatariosDTO {
  destinatarios: DestinatarioPreviewDTO[];
  total: number;
  /** Uno por destinatario de telefono invalido y uno por telefono compartido. No impiden guardar. */
  avisos: string[];
  /** R16: el conjunto resuelto supera el tope (50): el guardado se rechazara. */
  excedeTope: boolean;
  tope: number;
}

/** R49: un evento que la pantalla puede ofrecer en «Cuando pase algo». */
export interface EventoDisponibleDTO {
  clave: string;
  nombre: string;
  descripcion: string;
}

export type { InformeResumen as InformeDTO };
export type EjecucionItemDTO = HistorialEjecucionItem;
export type EntregaDetalleDTO = EntregaDetalle;

/** R39-R41/R52: resultado de «Probar ahora», en la MISMA respuesta. */
export type ProbarEnvioResultado =
  | {
      status: "ok";
      ejecucionId: string;
      estado: WhatsappEjecucionEstado;
      motivo: string | null;
      entrega: { estado: WhatsappEntregaEstado; motivo: string | null } | null;
    }
  /** R40: el telefono de quien pulsa no sirve. No se crea nada. */
  | { status: "telefono_invalido"; mensaje: string }
  /** R41: menos de 30 s desde la prueba anterior del mismo usuario sobre el mismo envio. */
  | { status: "demasiado_pronto"; segundosRestantes: number };

// ---------------------------------------------------------------------------------------------
// Resultados de las actions
// ---------------------------------------------------------------------------------------------

export type EnviosActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ListarEnviosResult = { status: "ok"; items: EnvioListItemDTO[] } | EnviosActionError;
export type ObtenerEnvioResult = { status: "ok"; envio: EnvioDetalleDTO } | EnviosActionError;
export type GuardarEnvioResult =
  | { status: "ok"; envio: EnvioDetalleDTO }
  | { status: "conflict"; campo: "nombre" }
  | EnviosActionError;
/** R18: rechazo del encendido con el motivo; el envio queda apagado. */
export type EncenderEnvioResult =
  | { status: "ok"; envio: EnvioDetalleDTO }
  | { status: "no_encendible"; motivos: string[] }
  | EnviosActionError;
export type ApagarEnvioResult = { status: "ok"; envio: EnvioDetalleDTO } | EnviosActionError;
export type BorrarEnvioResult = { status: "ok" } | EnviosActionError;
export type ReprogramarEnvioResult = { status: "ok"; envio: EnvioDetalleDTO } | EnviosActionError;
export type PrevisualizarDestinatariosResult =
  | { status: "ok"; preview: PreviewDestinatariosDTO }
  | EnviosActionError;
export type ListarEventosDisponiblesResult = { status: "ok"; eventos: EventoDisponibleDTO[] } | EnviosActionError;
export type ListarInformesResult = { status: "ok"; informes: InformeResumen[] } | EnviosActionError;
export type ProbarEnvioResult = ProbarEnvioResultado | EnviosActionError;
export type ListarEjecucionesResult =
  | { status: "ok"; items: EjecucionItemDTO[]; page: number; pageSize: number; total: number }
  | EnviosActionError;
export type ObtenerEjecucionResult =
  | { status: "ok"; ejecucion: EjecucionItemDTO; entregas: EntregaDetalleDTO[] }
  | EnviosActionError;
/** R43/R44: enlace firmado de 5 min, o `caducado` si el PDF ya se purgo. */
export type FirmarPdfEjecucionResult =
  | { status: "ok"; url: string }
  | { status: "caducado" }
  | { status: "sin_pdf" }
  | EnviosActionError;
