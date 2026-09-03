import type { Prisma, RolValue } from "@prisma/client";

import type {
  CategoriaAccion,
  HistorialAccionEntidad,
  HistorialAccionTipo,
  HistorialSortField,
} from "@/lib/types/historial-accion";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";

// FICHA 362 — CONTRATOS de la capa de datos del historial de acciones.
//
// Este archivo declara DOS cosas que no se parecen y por eso conviene decir cual es cual:
//   - la ESCRITURA (`HistorialAccionTxClient`, `EntradaAccion`), que consume el punto UNICO
//     `appendAccion` (`lib/repositories/registrar-accion.ts`);
//   - la LECTURA (`IHistorialAccionRepository`), que consume `HistorialAccionService`.
//
// No hay contrato de MODIFICACION ni de BORRADO, y esa ausencia es el requisito R2: la fila es
// inmutable. Si mañana aparece aqui un `update`/`delete`, la guardia de forma de la tabla
// (`tests/unit/guards/historial-accion-forma-tabla.guardia.test.ts`) se pone roja.

/**
 * El cliente que `appendAccion` acepta: SOLO el delegado de la tabla, recortado de
 * `Prisma.TransactionClient`.
 *
 * Es un `Pick` y no el cliente entero A PROPOSITO. `appendAccion` recibe LA TRANSACCION EN CURSO
 * de quien hace la accion; no puede abrir la suya, y con este tipo tampoco puede hacer nada mas
 * que insertar. Eso es lo que convierte R10 y R11 en garantias estructurales en vez de promesas.
 */
export type HistorialAccionTxClient = Pick<Prisma.TransactionClient, "historialAccion">;

/** El cliente que necesita el resolvedor del actor congelado: solo la tabla `usuario`. */
export type ActorCongeladoTxClient = Pick<Prisma.TransactionClient, "usuario">;

/**
 * Los tres campos del actor, CONGELADOS en el instante de la accion (R3). Van los tres a `null`
 * a la vez cuando quien actua es el sistema o un cron (R36).
 */
export interface ActorCongelado {
  actorUsuarioId: string | null;
  actorNombre: string | null;
  actorRol: RolValue | null;
}

/**
 * UNA fila del registro: una entidad afectada por la accion.
 *
 * NO hay campo `motivo` y no lo va a haber (R5): es texto libre tecleado por una persona, el unico
 * vector real de datos de cliente en esta tabla, y ya vive en su propia fila.
 *
 * NO hay campo `categoria` (R17): se deriva del tipo con `CATEGORIA_POR_ACCION`.
 *
 * NO hay campo `loteId`: lo pone `appendAccion`, UNA vez por llamada, para que todas las filas del
 * mismo acto lo compartan (R7). Si estuviera aqui, cada entrada podria traer el suyo y el lote
 * dejaria de significar nada.
 */
export interface EntradaAccion {
  accion: HistorialAccionTipo;
  entidadTipo: HistorialAccionEntidad;
  /** Opaco, sin FK: la fila tiene que sobrevivir a su sujeto (design §1.3-a). */
  entidadId: string;
  /** CONGELADA. Sale SIEMPRE de `etiquetaDeEntidad`, nunca de una interpolacion a mano. */
  entidadEtiqueta: string;
  actorUsuarioId: string | null;
  actorNombre: string | null;
  actorRol: RolValue | null;
  /** `Prisma.Decimal`, NUNCA `number`: money-safe (R6). `null` si la accion no mueve un importe. */
  monto?: Prisma.Decimal | null;
  /** Vocabulario CERRADO (valores de un enum del dominio). `null` en la mayoria de los tipos. */
  valorAnterior?: string | null;
  valorNuevo?: string | null;
}

// -------------------------------------------------------------------------------------------
// LECTURA
// -------------------------------------------------------------------------------------------

/**
 * El filtro que llega al repositorio, YA validado y YA normalizado por el borde: la `categoria`
 * se tradujo a tipos de accion y las fechas calendario CR a instantes.
 */
export interface FiltroHistorialAccionResuelto {
  /** Termino libre ya recortado. `null` = sin busqueda. */
  q: string | null;
  actorId: readonly string[] | null;
  /** Interseccion YA hecha de `accion` y `categoria` (design §4.2). `null` = sin filtro. */
  accion: readonly HistorialAccionTipo[] | null;
  entidadTipo: readonly HistorialAccionEntidad[] | null;
  /** Instantes UTC que delimitan el dia calendario CR pedido. */
  desde: Date | null;
  hasta: Date | null;
}

/** El ordenamiento vigente, ya validado. */
export interface OrdenHistorialAccion {
  sortBy: HistorialSortField;
  sortDir: DireccionOrden;
}

/** Fila cruda tal como sale de la base. `monto` sigue siendo `Decimal`: el DTO lo pasa a string. */
export interface FilaHistorialAccion {
  id: string;
  createdAt: Date;
  accion: HistorialAccionTipo;
  entidadTipo: HistorialAccionEntidad;
  entidadEtiqueta: string;
  actorUsuarioId: string | null;
  actorNombre: string | null;
  actorRol: RolValue | null;
  monto: Prisma.Decimal | null;
  valorAnterior: string | null;
  valorNuevo: string | null;
  loteId: string;
}

export interface PaginaHistorialAccion {
  items: FilaHistorialAccion[];
  total: number;
}

/** Un actor que ha actuado alguna vez, para el selector de filtros. */
export interface ActorDelHistorial {
  id: string;
  nombre: string;
}

/**
 * LECTURA del registro. NO declara `update`, `delete`, `updateMany` ni `deleteMany`, y esa
 * ausencia es R2 expresado en el tipo: no hay forma de pedirle a este repositorio que altere una
 * fila ya escrita.
 */
export interface IHistorialAccionRepository {
  /** Una pagina del listado. `total` es el conteo del MISMO conjunto filtrado. */
  list(params: {
    filtro: FiltroHistorialAccionResuelto;
    orden: OrdenHistorialAccion;
    page: number;
    pageSize: number;
  }): Promise<PaginaHistorialAccion>;

  /**
   * El conjunto ENTERO para la descarga. Comparte constructor de `where` y `orderBy` con `list`,
   * asi que pantalla y archivo no pueden divergir (R30).
   */
  listAll(params: {
    filtro: FiltroHistorialAccionResuelto;
    orden: OrdenHistorialAccion;
    limite: number;
  }): Promise<FilaHistorialAccion[]>;

  /** Catalogo de actores que aparecen en el registro, para el selector de filtros. */
  listarActores(): Promise<ActorDelHistorial[]>;
}

/** Categoria de una accion, reexportada para que el service no importe dos modulos por lo mismo. */
export type { CategoriaAccion };
