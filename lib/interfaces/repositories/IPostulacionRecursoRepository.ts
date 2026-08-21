import type { RecursoTipo } from "@/lib/types/postulacion-recurso";

// Feature 253 (T3.1, design §5) — contrato de acceso a datos de la postulacion de vehiculo o
// bodega. SOLO queries Prisma en la implementacion; la autorizacion por rol, la normalizacion y
// la distincion `not_found` / `conflict` viven en el service.

/** Lo que se inserta. Ya normalizado por el service (R20): el repositorio no recorta nada. */
export interface CrearPostulacionRecursoInput {
  tipo: RecursoTipo;
  nombre: string;
  telefono: string;
  correo: string;
  mensaje: string;
}

/** Fila proyectada para el panel. `atendidaPorNombre` sale del JOIN con `usuario`. */
export interface PostulacionRecursoRow {
  id: string;
  tipo: RecursoTipo;
  nombre: string;
  telefono: string;
  correo: string;
  mensaje: string;
  createdAt: Date;
  atendidaAt: Date | null;
  atendidaPorNombre: string | null;
}

export interface ListarPostulacionesRecursoRepoInput {
  /** `false` = pendientes (`atendida_at IS NULL`); `true` = ya atendidas (R33). */
  atendidas: boolean;
  skip: number;
  take: number;
}

export interface ListarPostulacionesRecursoRepoResult {
  items: PostulacionRecursoRow[];
  total: number;
}

/** Lo minimo para distinguir `not_found` de `conflict` cuando el update condicional no aplica. */
export interface PostulacionRecursoEstado {
  id: string;
  atendidaAt: Date | null;
}

export interface IPostulacionRecursoRepository {
  /** R21/R25: inserta UNA fila. Sin unicidad por correo ni por telefono: dos postulaciones de la
   *  misma persona son dos filas distintas. */
  crear(input: CrearPostulacionRecursoInput): Promise<{ id: string; createdAt: Date }>;

  /**
   * R26/R30/R33: pagina el listado filtrando por atendidas/pendientes y ordenando por
   * `created_at DESC`. El `WHERE` (`atendida_at IS NULL` / `IS NOT NULL`) y el `ORDER BY` los sirve
   * el indice compuesto `postulacion_recurso_atendida_at_created_at_idx`.
   */
  listar(
    input: ListarPostulacionesRecursoRepoInput,
  ): Promise<ListarPostulacionesRecursoRepoResult>;

  /**
   * R31/R32 — LA ANTI-CARRERA. `updateMany` con `where: { id, atendidaAt: null }`: dos
   * administradores simultaneos, solo uno ve `count === 1`. Devuelve el numero de filas afectadas.
   *
   * ⚠️ Un test de servicio con dobles NO VE ESTE `WHERE`. Se prueba contra Postgres real.
   */
  marcarAtendida(id: string, usuarioId: string, ahora: Date): Promise<number>;

  /** Solo para distinguir `not_found` de `conflict` cuando `marcarAtendida` devuelve 0. */
  findById(id: string): Promise<PostulacionRecursoEstado | null>;

  /**
   * **P2 — la purga. Borra, y borrar es irreversible.**
   *
   * ⛔ El predicado es `atendida_at IS NOT NULL AND atendida_at < corte`, y NUNCA toca
   * `created_at`: una postulacion SIN ATENDER no se borra jamas, por antigua que sea. Devuelve
   * cuantas filas se borraron. `limite` acota la corrida; lo que no entre lo retoma la siguiente.
   */
  purgarAtendidasAnterioresA(corte: Date, limite: number): Promise<number>;
}
