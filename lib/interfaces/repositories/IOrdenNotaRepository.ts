import type { RolValue } from "@prisma/client";

// Feature 227 (T2.1, design §2.1) — contrato del repositorio del HILO (`orden_nota`). SOLO
// queries Prisma: sin logica de negocio, sin permisos y sin proyeccion. Toda la autorizacion
// (rol, pertenencia a la tienda, asignacion del mensajero, ventana de escritura) vive en
// `OrdenNotaService` (R26: la tabla lleva RLS habilitada SIN policies, asi que la unica guarda
// real es la del service).

/** Una fila de `orden_nota` tal como sale de la base, con el nombre del autor resuelto por JOIN. */
export interface OrdenNotaRow {
  id: string;
  autorId: string;
  /** R4: el rol CONGELADO en el instante de publicar, no el rol actual del usuario. */
  rolAutor: RolValue;
  cuerpo: string;
  createdAt: Date;
  /** R31: `null` = vigente; con instante = borrada LOGICAMENTE (la fila y su autoria siguen ahi). */
  deletedAt: Date | null;
  autor: { nombre: string };
}

/** Lo que el service necesita de la ORDEN para autorizar: pertenencia, asignacion y ventana. */
export interface OrdenParaHilo {
  /** FK -> `usuario`: el `usuarioId` del adminTienda ES el identificador de su tienda (R9). */
  tiendaId: string;
  /** Feature 159: unica fuente de verdad del mensajero de la orden (R11). */
  mensajeroAsignadoId: string | null;
  estatusValue: string;
  /** Borrado logico de la orden: el service lo trata como «no existe» (R10). */
  deletedAt: Date | null;
}

/** Datos de la fila a crear. El `autorId` y el `rolAutor` los fija SIEMPRE el service con el
 *  actor de la sesion (R5); el repo solo persiste lo que recibe. */
export interface CrearOrdenNotaInput {
  ordenId: string;
  autorId: string;
  rolAutor: RolValue;
  cuerpo: string;
}

export interface IOrdenNotaRepository {
  /**
   * R3/R28/R34: el hilo COMPLETO de una orden en UNA sola consulta, ordenado
   * `createdAt asc, id asc` (el `id` es el desempate determinista para instantes repetidos).
   *
   * NO filtra `deleted_at`: trae tambien las borradas, porque R34 exige pintar el hueco marcado
   * en su posicion cronologica. Quien descarta el CUERPO de una borrada es el SERVICE, en un
   * unico punto (design §2.2/A9); el repo entrega la fila entera.
   */
  listarPorOrden(ordenId: string): Promise<OrdenNotaRow[]>;

  /** R1: un solo `create`. Devuelve la fila creada con el nombre del autor ya resuelto, para
   *  que el service pueda proyectarla sin una segunda consulta. */
  crear(input: CrearOrdenNotaInput): Promise<OrdenNotaRow>;

  /**
   * R31/R32/R33: marca la nota como borrada (`deleted_at = now()`) con un `updateMany` cuyo
   * `where` incluye `{ id, ordenId, autorId, deletedAt: null }`.
   *
   * El `autorId` va EN EL `where`, no en un `if` previo: la propiedad se comprueba en el MISMO
   * statement que muta, sin ventana entre chequeo y efecto (R32). El `ordenId` va con el por el
   * mismo motivo — ata la nota al hilo sobre el que el service ya autorizo, de modo que nadie
   * pueda borrar una nota propia de OTRA orden (donde su ventana podria estar cerrada, R35).
   *
   * Devuelve el `count` para que el service distinga 0 (ajena / inexistente / de otra orden / ya
   * borrada -> todas `forbidden`, R33) de 1.
   */
  marcarBorrada(notaId: string, ordenId: string, autorId: string): Promise<number>;

  /** La lectura MINIMA para autorizar (design §2.1). `null` si la orden no existe. */
  findOrdenParaHilo(ordenId: string): Promise<OrdenParaHilo | null>;
}
