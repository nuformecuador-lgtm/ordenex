// FICHA 422 (design §6.2, T1.4) — repositorio de LA DECISION DE LA PERSONA. SOLO queries Prisma
// (docs/architecture.md): ni una regla de negocio, ni un reloj, ni una decision de elegibilidad.
import type { PrismaClient } from "@prisma/client";
import type { IUsuarioPreferenciaRepository } from "@/lib/interfaces/repositories/IUsuarioPreferenciaRepository";

/** Lo minimo del cliente Prisma que este repositorio consume (patron `PushSuscripcionRepository`). */
type UsuarioPreferenciaPrismaClient = Pick<PrismaClient, "usuarioPreferencia">;

export class UsuarioPreferenciaRepository implements IUsuarioPreferenciaRepository {
  constructor(private readonly prisma: UsuarioPreferenciaPrismaClient) {}

  /**
   * R2 — sin fila, `false`. Y NO SE CREA NADA AL LEER: esto lo llama el layout del portal en cada
   * carga, asi que una lectura que escribiera convertiria abrir una pantalla en una escritura.
   *
   * `select` acotado a la unica columna que decide algo: la fila no tiene nada mas que interese
   * aqui, y traer menos es lo que hace de esto una lectura por indice unico y nada mas.
   */
  async avisosPushDe(usuarioId: string): Promise<boolean> {
    const fila = await this.prisma.usuarioPreferencia.findUnique({
      where: { usuarioId },
      select: { avisosPush: true },
    });
    return fila?.avisosPush ?? false;
  }

  /**
   * R3/R7 — UPSERT POR `usuario_id`, en UNA sentencia.
   *
   * ⚠️ NO CONSULTA ANTES, Y ESO ES EL DISENO. Quien decide es el indice unico
   * `usuario_preferencia_usuario_id_key`: dos escrituras concurrentes de la misma persona —dos
   * pestanas activando a la vez, o una reactivacion silenciosa cruzandose con un registro— chocan
   * en la base y dejan UNA fila. Un `findFirst` + `create` deja abierta la rendija entre la lectura
   * y la escritura, por la que caben dos `INSERT`; y ese fallo no rompe ningun test: deja dos filas
   * y la lectura empieza a depender de cual salga primero.
   *
   * `update` escribe SOLO `avisos_push`: `updated_at` lo mueve Prisma (`@updatedAt`) y `created_at`
   * no se toca nunca. De eso depende la comprobacion del backfill (`updated_at = created_at`
   * demuestra que nada mas toco esas filas), asi que escribir aqui otra columna la invalidaria.
   */
  async fijarAvisosPush(usuarioId: string, quiere: boolean): Promise<void> {
    await this.prisma.usuarioPreferencia.upsert({
      where: { usuarioId },
      create: { usuarioId, avisosPush: quiere },
      update: { avisosPush: quiere },
      select: { id: true },
    });
  }
}
