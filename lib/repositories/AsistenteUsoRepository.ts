import type { PrismaClient } from "@prisma/client";

import type { IAsistenteUsoRepository } from "@/lib/interfaces/repositories/IAsistenteUsoRepository";

/**
 * ⭑ FICHA 436 (design §4.2, T9) — el CONTADOR del tope. SOLO queries (`docs/architecture.md`):
 * ni una regla de negocio, ni un reloj, ni un mensaje para nadie.
 *
 * ⚠️ El tope entra como PARÁMETRO y sólo para meterlo en el `WHERE` (ver abajo): quién lo decide y
 * qué se le cuenta a la persona sigue siendo del servicio. Aquí no se lee ninguna configuración.
 */

/** Lo mínimo del cliente Prisma que este repositorio consume. Es también la costura de los tests. */
type AsistenteUsoPrismaClient = Pick<PrismaClient, "$queryRaw">;

export class AsistenteUsoRepository implements IAsistenteUsoRepository {
  constructor(private readonly prisma: AsistenteUsoPrismaClient) {}

  /**
   * ⭑ R17 — EL INCREMENTO ATÓMICO **Y CONDICIONADO AL TOPE**, EN UNA SOLA SENTENCIA.
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
   * ⭑⭑ EL `WHERE` DEL `DO UPDATE` ES EL TOPE, y por eso está aquí y no en un `if` (revisión de la
   * ficha, `m2`). Sumar siempre y comparar después hacía que un rechazo TAMBIÉN incrementara: la
   * columna dejaba de medir «consultas atendidas» (R17) y pasaba a medir intentos, justo en el
   * único número que esta pieza deja para T27. Comprobar y sumar en la MISMA sentencia es lo único
   * que no abre una ventana entre las dos cosas.
   *
   * Qué devuelve Postgres en cada caso, que es de donde sale el `null`:
   *  - no había fila               -> el `INSERT` entra con `consultas = 1` y devuelve 1;
   *  - había fila y cabe una más   -> el `DO UPDATE` suma y devuelve el valor nuevo;
   *  - había fila y está en el tope -> el `WHERE` no casa, **no se escribe nada** y la sentencia
   *    devuelve CERO FILAS. Eso es el `null`.
   *
   * El `WHERE` está en el `ON CONFLICT`, así que se prueba donde vive: en la base, no contra un
   * doble que no tiene índice (`tests/integration/db/asistente-uso-diario.int.test.ts`).
   */
  async consumirUnaConsulta(
    usuarioId: string,
    fecha: string,
    tope: number,
  ): Promise<number | null> {
    const filas = await this.prisma.$queryRaw<{ consultas: number }[]>`
      INSERT INTO "asistente_uso_diario"
        ("id", "usuario_id", "fecha", "consultas", "no_lo_se", "created_at", "updated_at")
      VALUES
        (gen_random_uuid()::text, ${usuarioId}, ${fecha}::date, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("usuario_id", "fecha") DO UPDATE
        SET "consultas" = "asistente_uso_diario"."consultas" + 1,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "asistente_uso_diario"."consultas" < ${tope}
      RETURNING "consultas"
    `;
    // Cero filas NO es un fallo: es «esta persona ya está en el tope» (ver arriba). Se devuelve
    // `null` y quien llama rechaza — el fallo seguro es no atender, nunca atender de más.
    const consultas = filas[0]?.consultas;
    return consultas === undefined ? null : Number(consultas);
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
