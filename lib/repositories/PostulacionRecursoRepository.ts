import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CrearPostulacionRecursoInput,
  IPostulacionRecursoRepository,
  ListarPostulacionesRecursoRepoInput,
  ListarPostulacionesRecursoRepoResult,
  PostulacionRecursoEstado,
  PostulacionRecursoRow,
} from "@/lib/interfaces/repositories/IPostulacionRecursoRepository";

// Feature 253 (T3.2, design §5) — SOLO queries Prisma. Ni una regla de negocio: no autoriza, no
// normaliza (eso ya lo hizo el service), no decide el corte de la purga (lo calcula el service a
// partir de la retencion) y no traduce errores.

type PostulacionRecursoPrismaClient = Pick<PrismaClient, "postulacionRecurso">;

/**
 * R26/R33 — el `where` del listado, en UN solo sitio para que la pagina y el `count` no puedan
 * divergir. `atendida_at IS NULL` = pendiente; `IS NOT NULL` = atendida. Postgres sirve las dos
 * ramas con `postulacion_recurso_atendida_at_created_at_idx`.
 */
function whereListado(atendidas: boolean): Prisma.PostulacionRecursoWhereInput {
  return atendidas ? { atendidaAt: { not: null } } : { atendidaAt: null };
}

/**
 * **P2 — EL PREDICADO DE LA PURGA, y vive en UN solo sitio a proposito.**
 *
 * ⛔ `atendidaAt`, NUNCA `createdAt`. En Prisma, `{ lt: corte }` sobre una columna nullable EXCLUYE
 * las filas con `NULL` (en SQL, `NULL < x` no es verdadero), asi que una postulacion PENDIENTE no
 * entra jamas, por antigua que sea. `createdAt` no aparece en esta funcion ni debe aparecer: la
 * antiguedad de la SOLICITUD no borra nada; solo la antiguedad de SU ATENCION.
 *
 * Esta en una funcion suelta, y no incrustado en la consulta, para que la condicion que decide un
 * borrado irreversible sea UNA linea que se lee entera de un vistazo — y para que una mutacion que
 * la cambie ponga rojo un test contra Postgres real, no dos consultas medio mutadas.
 */
function wherePurgables(corte: Date): Prisma.PostulacionRecursoWhereInput {
  return { atendidaAt: { lt: corte } };
}

export class PostulacionRecursoRepository implements IPostulacionRecursoRepository {
  constructor(private readonly prisma: PostulacionRecursoPrismaClient) {}

  /** R21/R25: una fila por postulacion. Sin `upsert` y sin clave natural: dos envios de la misma
   *  persona son dos filas, y eso es el requisito, no un descuido. */
  async crear(input: CrearPostulacionRecursoInput): Promise<{ id: string; createdAt: Date }> {
    const fila = await this.prisma.postulacionRecurso.create({
      data: {
        tipo: input.tipo,
        nombre: input.nombre,
        telefono: input.telefono,
        correo: input.correo,
        mensaje: input.mensaje,
      },
      select: { id: true, createdAt: true },
    });
    return { id: fila.id, createdAt: fila.createdAt };
  }

  /**
   * R26/R30/R33: pagina ordenando por `created_at DESC` (lo mas reciente primero: es una bandeja
   * de entrada, no un historial). El `count` usa el MISMO `where` que la pagina.
   */
  async listar(
    input: ListarPostulacionesRecursoRepoInput,
  ): Promise<ListarPostulacionesRecursoRepoResult> {
    const where = whereListado(input.atendidas);

    const [filas, total] = await Promise.all([
      this.prisma.postulacionRecurso.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: input.skip,
        take: input.take,
        select: {
          id: true,
          tipo: true,
          nombre: true,
          telefono: true,
          correo: true,
          mensaje: true,
          createdAt: true,
          atendidaAt: true,
          atendidaPor: { select: { nombre: true } },
        },
      }),
      this.prisma.postulacionRecurso.count({ where }),
    ]);

    const items: PostulacionRecursoRow[] = filas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      nombre: f.nombre,
      telefono: f.telefono,
      correo: f.correo,
      mensaje: f.mensaje,
      createdAt: f.createdAt,
      atendidaAt: f.atendidaAt,
      atendidaPorNombre: f.atendidaPor?.nombre ?? null,
    }));

    return { items, total };
  }

  /**
   * R31/R32 — ACTUALIZACION CONDICIONAL ATOMICA. `atendidaAt: null` en el `where` es lo que hace
   * que una segunda atencion NO sobrescriba quien ni cuando: la segunda ve `count === 0`.
   *
   * ⚠️ Quitar ese `atendidaAt: null` no rompe ningun test de servicio (los dobles no ven el SQL).
   * Lo caza `tests/integration/db/postulacion-recurso-migration.test.ts` contra Postgres real.
   */
  async marcarAtendida(id: string, usuarioId: string, ahora: Date): Promise<number> {
    const { count } = await this.prisma.postulacionRecurso.updateMany({
      where: { id, atendidaAt: null },
      data: { atendidaAt: ahora, atendidaPorId: usuarioId },
    });
    return count;
  }

  async findById(id: string): Promise<PostulacionRecursoEstado | null> {
    const fila = await this.prisma.postulacionRecurso.findUnique({
      where: { id },
      select: { id: true, atendidaAt: true },
    });
    return fila ?? null;
  }

  /**
   * **P2 — el borrado del cron.** El predicado es `wherePurgables(corte)`; leelo ahi arriba antes
   * de tocar nada de este metodo.
   *
   * El borrado va en DOS pasos —seleccionar hasta `limite` ids y borrarlos por `id IN (...)`—
   * porque `deleteMany` de Prisma no acepta `take`: sin el tope, la primera corrida sobre un
   * historico de anos borraria todo de golpe dentro de una funcion con presupuesto de tiempo.
   * Se ordena por `atendida_at ASC`: siempre lo mas viejo primero, para que la corrida siguiente
   * continue por donde quedo.
   *
   * El segundo paso borra POR ID y NO repite el predicado, y es deliberado: `atendida_at` se
   * escribe UNA vez y en un solo sentido (design §3), asi que ninguna fila puede volver a
   * `pendiente` entre las dos consultas. Repetir la condicion aqui daria una falsa sensacion de
   * red —y, peor, taparia una mutacion del predicado dejando el test en verde—.
   */
  async purgarAtendidasAnterioresA(corte: Date, limite: number): Promise<number> {
    const candidatas = await this.prisma.postulacionRecurso.findMany({
      where: wherePurgables(corte),
      orderBy: { atendidaAt: "asc" },
      take: limite,
      select: { id: true },
    });
    if (candidatas.length === 0) return 0;

    const { count } = await this.prisma.postulacionRecurso.deleteMany({
      where: { id: { in: candidatas.map((c) => c.id) } },
    });
    return count;
  }
}
