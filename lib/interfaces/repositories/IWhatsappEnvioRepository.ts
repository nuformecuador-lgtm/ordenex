import type { RolValue, WhatsappEnvioDisparo } from "@prisma/client";

// Ficha 474 (design §1.2/§1.3/§4) — contrato del repositorio de ENVIOS configurados. Solo Prisma:
// las reglas (R11-R21) viven en `WhatsappEnvioService`. Toda lectura «vigente» filtra
// `deleted_at IS NULL`; las que dicen «encendido» filtran ademas `activo`.

/** Destinatarios elegidos: por rol y/o por usuario (R16). */
export interface SeleccionDestinatarios {
  roles: RolValue[];
  usuarioIds: string[];
}

/** Un envio con su configuracion completa. */
export interface EnvioDetalle {
  id: string;
  nombre: string;
  informeClave: string;
  plantillaId: string;
  /** Nombre ACTUAL de la plantilla (la lista lo muestra). */
  plantillaNombre: string;
  parametros: unknown;
  disparo: WhatsappEnvioDisparo;
  diasSemana: number[];
  hora: string | null;
  eventoClave: string | null;
  /** Columna `activo`: encendido / apagado (R15/R19). */
  encendido: boolean;
  destinatarios: SeleccionDestinatarios;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Datos de alta/edicion. `encendido` NO viaja: nace apagado (R15) y se cambia con `cambiarEncendido`. */
export interface GuardarEnvioData {
  nombre: string;
  informeClave: string;
  plantillaId: string;
  parametros: unknown;
  disparo: WhatsappEnvioDisparo;
  diasSemana: number[];
  hora: string | null;
  eventoClave: string | null;
  destinatarios: SeleccionDestinatarios;
  actorId: string | null;
}

/** Un destinatario RESUELTO (R28): usuario `activo` con rol permitido. */
export interface DestinatarioResuelto {
  usuarioId: string;
  nombre: string;
  /** Crudo de `usuario.telefono`. Solo la capa de envio lo usa completo. */
  telefono: string;
  rol: RolValue;
}

/** Un envio encendido a hora fija, lo minimo para re-sembrar su cadena (R25). */
export interface EnvioProgramable {
  id: string;
  diasSemana: number[];
  hora: string;
}

/** Nombre unico entre vigentes (R11) violado. */
export class EnvioNombreDuplicadoError extends Error {
  constructor() {
    super("Ya existe un envio con ese nombre");
    this.name = "EnvioNombreDuplicadoError";
  }
}

export interface IWhatsappEnvioRepository {
  /** Crea el envio APAGADO (R15) con sus destinatarios. Lanza `EnvioNombreDuplicadoError`. */
  crear(data: GuardarEnvioData): Promise<EnvioDetalle>;
  /** Reemplaza configuracion y destinatarios de un envio vigente. `null` si no existe o esta borrado. */
  actualizar(id: string, data: GuardarEnvioData): Promise<EnvioDetalle | null>;
  /** Vigente por id; con `incluirBorrados` tambien uno borrado (el handler lo necesita, R21). */
  obtener(id: string, opts?: { incluirBorrados?: boolean }): Promise<EnvioDetalle | null>;
  /** Todos los vigentes, por nombre. */
  listar(): Promise<EnvioDetalle[]>;
  /** Enciende/apaga un vigente. `false` si no existe o esta borrado. */
  cambiarEncendido(id: string, encendido: boolean, actorId: string | null): Promise<boolean>;
  /** Soft delete (R21): fija `deleted_at` y apaga. `false` si no existia o ya estaba borrado. */
  borrar(id: string, actorId: string | null): Promise<boolean>;

  /** R28: union de los usuarios de los roles y de los usuarios elegidos, `activo`, dedup, por nombre. */
  resolverDestinatariosDe(sel: SeleccionDestinatarios, rolesPermitidos: readonly RolValue[]): Promise<DestinatarioResuelto[]>;
  /** R28 sobre los destinatarios GUARDADOS de un envio. */
  resolverDestinatarios(envioId: string, rolesPermitidos: readonly RolValue[]): Promise<DestinatarioResuelto[]>;
  /** R16: rol de cada usuario pedido (exista o no su estado activo). */
  rolesDeUsuarios(usuarioIds: string[]): Promise<{ id: string; rol: RolValue }[]>;
  /** R39/R40: nombre y telefono de quien pulsa «Probar ahora». `null` si no existe. */
  contactoDeUsuario(usuarioId: string): Promise<{ id: string; nombre: string; telefono: string } | null>;

  /** R10: nombres de los envios ENCENDIDOS y vigentes que usan esa plantilla. */
  nombresEncendidosConPlantilla(plantillaId: string): Promise<string[]>;
  /** R26: ¿hay algun envio encendido y vigente con ese evento? `SELECT 1 … LIMIT 1` sobre el indice parcial. */
  hayEncendidosConEvento(evento: string): Promise<boolean>;
  /** R26/R19: los ids de los envios encendidos y vigentes con ese evento, EN ESTE MOMENTO. */
  encendidosConEvento(evento: string): Promise<string[]>;
  /** R25: encendidos a hora fija SIN job `whatsapp_envio_programado` pendiente para su id. */
  encendidosHoraFijaSinJobPendiente(): Promise<EnvioProgramable[]>;
  /**
   * R25: los jobs `whatsapp_envio_programado` PENDIENTES de esos envios, con su (fecha, hora). El
   * service descarta los obsoletos (hora editada) antes de mostrar el proximo.
   */
  jobsProgramadosPendientes(envioIds: string[]): Promise<JobProgramadoPendiente[]>;
}

export interface JobProgramadoPendiente {
  envioId: string;
  fechaCr: string;
  hora: string;
  runAfter: Date;
}
