import type { PlantillaEstado } from "@prisma/client";

// Feature 107 — contrato del repositorio de plantillas de mensaje. Solo Prisma; sin
// logica de negocio ni permisos. TODAS las lecturas filtran `deletedAt IS NULL` (R28).

/** Forma publica de una plantilla vigente. `variables` es el array persistido (R15). */
export interface PlantillaPublica {
  id: string;
  nombre: string;
  cuerpo: string;
  variables: string[];
  /**
   * Feature 282 — snapshot `clave -> nombre legible` del catalogo en el ultimo guardado.
   * REQUERIDO y nunca null: la columna es `NOT NULL DEFAULT '{}'` y `{}` significa "fila
   * anterior a la feature 282", que la UI resuelve derivando el nombre del catalogo (R21).
   */
  variablesNombres: Record<string, string>;
  estado: PlantillaEstado;
  /**
   * `true` en la plantilla marcada como MENSAJE DE BIENVENIDA (el que sale solo cuando el
   * paquete es recogido). Como mucho una vigente lo tiene; lo garantiza un UNIQUE parcial en
   * la base, no este tipo (ver `marcarWelcomeMessage`).
   */
  welcomeMessage: boolean;
  templateId: string | null; // enlace a Meta; NULL = no propagada / no sincronizada
  templateIdioma: string | null; // idioma del template en Meta (necesario para enviar)
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** R6: fila del listado (nombre, estado y cuerpo). */
export interface PlantillaListItem {
  id: string;
  nombre: string;
  cuerpo: string;
  estado: PlantillaEstado;
  variables: string[];
  /** Feature 282 — snapshot `clave -> nombre` (R21: `{}` = derivar del catalogo al pintar). */
  variablesNombres: Record<string, string>;
  /** `true` si es la plantilla de bienvenida; el listado la RESALTA (como mucho una fila). */
  welcomeMessage: boolean;
  templateId: string | null; // el admin ve si la plantilla ya esta enlazada con Meta
  createdAt: Date;
}

/**
 * Plantilla ENVIABLE por el mensajero: vigente, `activo` y ENLAZADA con Meta (templateId no
 * nulo). Lleva lo justo para construir el envio (nombre + idioma del template + variables) y
 * el `cuerpo` local para RENDERIZAR el texto que se persiste en el historial del chat.
 *
 * Feature 282: NO lleva `variablesNombres` — ni esta ni `PlantillaTextoEnviable`. El envio
 * resuelve POR CLAVE y no tiene nada que hacer con las etiquetas legibles. Mantener el
 * snapshot fuera de las formas enviables es la garantia ESTRUCTURAL de que esa columna de
 * presentacion no puede afectar al texto ni al orden de parametros que viaja a Meta
 * (design.md §4.6). Si alguien lo anade aqui, el motivo tiene que ser otro requisito.
 */
export interface PlantillaEnviable {
  id: string;
  nombre: string;
  cuerpo: string;
  variables: string[];
  templateId: string;
  templateIdioma: string;
}

/**
 * Plantilla usable en el flujo wa.me del mensajero: vigente y NO desactivada. Lleva el cuerpo
 * y las variables para RENDERIZAR el texto en el cliente (no depende de Meta ni de templateId).
 */
export interface PlantillaTextoEnviable {
  id: string;
  nombre: string;
  cuerpo: string;
  variables: string[];
}

/** Datos que la sincronizacion (create/update contra Meta) persiste tras enlazar el template. */
export interface SetTemplateData {
  templateId: string;
  idioma: string;
}

/** Datos que el cron 24h vuelca desde Meta a una plantilla local (match por nombre). */
export interface SincronizarTemplateData {
  templateId: string;
  idioma: string;
  /** Estado mapeado desde el status de revision de Meta (APPROVED/PENDING/REJECTED). */
  estado: PlantillaEstado;
}

/** Datos para IMPORTAR (crear) una plantilla local a partir de un template de Meta. */
export interface CrearDesdeMetaData {
  nombre: string;
  cuerpo: string;
  variables: string[];
  templateId: string;
  idioma: string;
  estado: PlantillaEstado;
}

/** R10: violacion de unicidad del nombre. Patron `UsuarioDuplicadoError`. */
export class PlantillaDuplicadaError extends Error {
  constructor(public readonly campo: "nombre" = "nombre") {
    super(`El nombre de la plantilla ya esta en uso`);
    this.name = "PlantillaDuplicadaError";
  }
}

export interface CreatePlantillaData {
  nombre: string;
  cuerpo: string;
  variables: string[]; // R15: derivadas por el service
  createdBy: string | null;
  /**
   * Estado inicial. EXPLICITO desde 2026-08-26 y no heredado del default de la columna: el
   * default sigue siendo `pending` porque Postgres no dejaba moverlo en la misma migracion que
   * anadio `saved_not_aprobation`, asi que si el service no lo dijera, una plantilla recien
   * creada se anunciaria como "Meta la esta revisando" sin haberla enviado a nadie.
   */
  estado: PlantillaEstado;
  /**
   * Feature 282 (R17) — snapshot `clave -> nombre` que sella el SERVICE con el catalogo
   * vigente. Opcional: si no llega, la columna se queda en su default `{}`. Ningun cliente lo
   * manda (no hay entrada zod nueva); lo calcula el servidor (design.md §4.5).
   */
  variablesNombres?: Record<string, string>;
}

/** R20/R22: solo nombre y/o cuerpo; `variables` recalculadas por el service si cambia el cuerpo. */
export interface UpdatePlantillaData {
  nombre?: string;
  cuerpo?: string;
  variables?: string[];
  /** Feature 282 (R17): se reescribe junto con `variables` cuando cambia el cuerpo. */
  variablesNombres?: Record<string, string>;
}

export interface ListPlantillasParams {
  skip: number;
  take: number;
}

export interface ListPlantillasResult {
  items: PlantillaListItem[];
  total: number;
}

export interface IPlantillaMensajeRepository {
  /** R8/R12/R15: persiste nombre, cuerpo, variables y el estado inicial que decide el service. */
  create(data: CreatePlantillaData): Promise<PlantillaPublica>;
  /** R6/R7/R28: listado paginado de vigentes (deletedAt IS NULL), orden createdAt desc. */
  list(params: ListPlantillasParams): Promise<ListPlantillasResult>;
  /** R7/R28: total de vigentes. */
  count(): Promise<number>;
  /** R28: plantilla vigente por id; `null` si no existe o esta soft-deleted. */
  findById(id: string): Promise<PlantillaPublica | null>;
  /** R10/R28: plantilla vigente por nombre (para unicidad); `null` si no existe. */
  findByNombre(nombre: string): Promise<PlantillaPublica | null>;
  /** R20/R22: aplica nombre/cuerpo/variables; `null` si no existe o esta soft-deleted. */
  update(id: string, data: UpdatePlantillaData): Promise<PlantillaPublica | null>;
  /** R24: fija el estado; `null` si no existe o esta soft-deleted. */
  updateEstado(id: string, estado: PlantillaEstado): Promise<PlantillaPublica | null>;
  /** R27: soft delete (fija deletedAt); `false` si no existe o ya estaba borrada. */
  softDelete(id: string): Promise<boolean>;
  /**
   * Marca ESTA plantilla como el mensaje de bienvenida y desmarca cualquier otra, en UNA sola
   * transaccion. Es un `set`, no un `toggle`: pasar dos veces la misma id deja el mismo
   * estado. `null` si no existe o esta soft-deleted.
   *
   * El desmarcado va PRIMERO y no es cosmetica: el UNIQUE parcial de la base solo admite una
   * fila vigente en `true`, asi que marcar antes de limpiar abortaria la transaccion entera.
   */
  marcarWelcomeMessage(id: string): Promise<PlantillaPublica | null>;

  // --- Integracion WhatsApp ---

  /** Enlaza la plantilla con su template de Meta tras crearlo/actualizarlo (propagacion local->Meta). */
  setTemplate(id: string, data: SetTemplateData): Promise<void>;
  /**
   * Cron 24h (Meta->local): actualiza por NOMBRE el templateId, idioma y estado de una
   * plantilla vigente. NO borra filas. Preserva un `inactivo` puesto por el usuario
   * (no lo reactiva). Devuelve `true` si habia una fila que actualizar.
   */
  sincronizarTemplatePorNombre(nombre: string, data: SincronizarTemplateData): Promise<boolean>;
  /**
   * Cron 24h (Meta->local): IMPORTA (crea) una plantilla local desde un template de Meta que
   * no existia. Devuelve `false` si el nombre ya esta en uso (p. ej. una plantilla borrada con
   * ese nombre): no se resucita ni se pisa, se omite.
   */
  crearDesdeMeta(data: CrearDesdeMetaData): Promise<boolean>;
  /** Envio del mensajero: plantillas vigentes, `activo` y enlazadas con Meta (templateId no nulo). */
  listarEnviables(): Promise<PlantillaEnviable[]>;
  /** Una plantilla enviable por id (vigente, `activo`, con templateId); `null` si no aplica. */
  findEnviableById(id: string): Promise<PlantillaEnviable | null>;
  /** Flujo wa.me: plantillas vigentes NO desactivadas, con cuerpo, para renderizar en cliente. */
  listarUsablesParaTexto(): Promise<PlantillaTextoEnviable[]>;
}
