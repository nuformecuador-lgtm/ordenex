import type { PrismaClient } from "@prisma/client";

import type { IOrdenDiaRepartoCambioRepository } from "@/lib/interfaces/repositories/IOrdenDiaRepartoCambioRepository";
import type { OrdenHistorialCorreccionDiaDTO } from "@/lib/types/orden-historial";
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";

// FEATURE 262 (B25, design §14.2) — la LECTURA del rastro de correcciones del dia de reparto.
//
// Solo consultas: ninguna decision de negocio vive aqui. La fusion con las transiciones y el orden
// entre las dos fuentes son del SERVICIO (§14.3, R41), no de este repositorio.
//
// Cliente acotado a la tabla que necesita, patron `OrdenHistorialPrismaClient`: el `Pick` deja
// escrito que este repo no alcanza nada mas, y hace que un doble de test no tenga que fingir un
// `PrismaClient` entero.
type CambioDiaPrismaClient = Pick<PrismaClient, "ordenDiaRepartoCambio">;

// El `nombre` del actor por `include`, igual que `WITH_LABELS` en el repo hermano: el DTO sale
// legible y el servicio recibe algo que solo tiene que MEZCLAR. La columna `actor_usuario_id` es
// NOT NULL (§5.1) y la FK es RESTRICT, asi que la relacion SIEMPRE resuelve: no hay `?? null` que
// escribir, y por eso `actorNombre` es `string` en el DTO.
const CON_ACTOR = {
  select: {
    fechaAnterior: true,
    fechaNueva: true,
    motivo: true,
    createdAt: true,
    actor: { select: { nombre: true } },
  },
} as const;

export class OrdenDiaRepartoCambioRepository implements IOrdenDiaRepartoCambioRepository {
  constructor(private readonly prisma: CambioDiaPrismaClient) {}

  /**
   * R37/R40 — el rastro de esta orden, en orden y ya serializado.
   *
   * EL `ORDER BY` LLEVA DOS COLUMNAS Y LAS DOS IMPORTAN. `created_at ASC` es el orden que la
   * linea de tiempo necesita; `id ASC` es el DESEMPATE, y sin el dos filas escritas en la misma
   * transaccion —un lote corregido de golpe escribe N filas con el MISMO `CURRENT_TIMESTAMP`—
   * saldrian en orden indefinido.
   *
   * SE RESUELVE POR EL INDICE `(orden_id, created_at)` que §5.1 declaro como «la unica consulta
   * prevista»; `tests/integration/db/correccion-dia-reparto-historial.int.test.ts` lo comprueba
   * con un `EXPLAIN` sobre el SQL que ESTE metodo emite, en vez de suponerlo.
   *
   * LAS DOS FECHAS SALEN COMO TEXTO `YYYY-MM-DD` Y NO COMO `Date`, y la conversion vive AQUI (en
   * el repositorio, como `toEntradaDTO` en el repo hermano) por lo mismo que
   * `MisAsignacionesService` la hace en su capa: un `@db.Date` leido por Prisma es la medianoche
   * UTC de esa fecha, y formatearlo mas arriba —o peor, en el navegador— devuelve el dia anterior
   * en cualquier zona al oeste de Greenwich.
   */
  async findCorreccionesByOrden(ordenId: string): Promise<OrdenHistorialCorreccionDiaDTO[]> {
    const filas = await this.prisma.ordenDiaRepartoCambio.findMany({
      where: { ordenId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...CON_ACTOR,
    });

    return filas.map((fila) => ({
      clase: "correccion_dia" as const,
      fechaAnteriorISO: fechaRepartoComoTexto(fila.fechaAnterior),
      fechaNuevaISO: fechaRepartoComoTexto(fila.fechaNueva),
      actorNombre: fila.actor.nombre,
      motivo: fila.motivo,
      createdAt: fila.createdAt,
    }));
  }
}
