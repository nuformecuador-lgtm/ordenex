import type { PrismaClient } from "@prisma/client";

import type { IAsistenteUsoRepository } from "@/lib/interfaces/repositories/IAsistenteUsoRepository";

/**
 * ⭑ FICHA 436 (design §4.2, T9) — el CONTADOR del tope. SOLO queries (`docs/architecture.md`):
 * ni una regla de negocio, ni un reloj, ni una comparación con el tope.
 */

/** Lo mínimo del cliente Prisma que este repositorio consume. Es también la costura de los tests. */
type AsistenteUsoPrismaClient = Pick<PrismaClient, "$queryRaw">;

export class AsistenteUsoRepository implements IAsistenteUsoRepository {
  constructor(private readonly prisma: AsistenteUsoPrismaClient) {}

  /**
   * ⭑ R17 — EL INCREMENTO ATÓMICO, EN UNA SOLA SENTENCIA.
   *
   * ⚠️ SQL CRUDO Y NO `prisma.asistenteUsoDiario.upsert(...)`, a propósito. El `upsert` de Prisma
   * sólo se traduce a un `INSERT … ON CONFLICT` nativo si se cumplen varias condiciones que no
   * están escritas en ningún sitio del repo y que pueden cambiar al actualizar Prisma; cuando no
   * se cumplen, degrada a leer-y-luego-escribir **en silencio**. Aquí la atomicidad no es una
   * optimización: es el requisito. Escribiéndola a mano, lo que corre en producción es
   * exactamente lo que se lee aquí y lo que el test mide contra Postgres.
   *
   * ⚠️ `${fecha}::date` SOBRE LA CADENA `YYYY-MM-DD`, y no un `Date`. Un `Date` de JavaScript lo
   * serializa el driver con el huso de la máquina, y Postgres lo convierte a `date` con la zona de
   * la sesión: después de las 18:00 de Costa Rica eso cae en el día SIGUIENTE, y el tope se
   * reiniciaría seis horas antes de tiempo, todos los días, para todo el mundo. Con el `::date`
   * explícito sobre el texto no hay ninguna conversión de huso en el camino.
   *
   * El `WHERE` está en el `ON CONFLICT`, así que se prueba donde vive: en la base, no contra un
   * doble que no tiene índice.
   */
  async consumirUnaConsulta(usuarioId: string, fecha: string): Promise<number> {
    const filas = await this.prisma.$queryRaw<{ consultas: number }[]>`
      INSERT INTO "asistente_uso_diario"
        ("id", "usuario_id", "fecha", "consultas", "no_lo_se", "created_at", "updated_at")
      VALUES
        (gen_random_uuid()::text, ${usuarioId}, ${fecha}::date, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("usuario_id", "fecha") DO UPDATE
        SET "consultas" = "asistente_uso_diario"."consultas" + 1,
            "updated_at" = CURRENT_TIMESTAMP
      RETURNING "consultas"
    `;
    // Un `INSERT … ON CONFLICT DO UPDATE … RETURNING` devuelve SIEMPRE una fila: o la que insertó
    // o la que actualizó. Si no la devolviera, callar y responder 0 dejaría el tope desactivado
    // sin que nadie se enterara, así que se rompe ruidosamente.
    const consultas = filas[0]?.consultas;
    if (consultas === undefined) {
      throw new Error("asistente_uso_diario: el upsert no devolvio ninguna fila");
    }
    return Number(consultas);
  }

  /**
   * Q5 — el contador de «no lo sé». Un `UPDATE` sobre la fila que `consumirUnaConsulta` acaba de
   * dejar escrita. Si no casa ninguna fila no pasa nada: esto es una señal de diagnóstico, no
   * puede tumbar una respuesta que la persona ya tiene delante.
   */
  async contarNoLoSe(usuarioId: string, fecha: string): Promise<void> {
    await this.prisma.$queryRaw`
      UPDATE "asistente_uso_diario"
         SET "no_lo_se" = "asistente_uso_diario"."no_lo_se" + 1,
             "updated_at" = CURRENT_TIMESTAMP
       WHERE "usuario_id" = ${usuarioId} AND "fecha" = ${fecha}::date
    `;
  }
}
