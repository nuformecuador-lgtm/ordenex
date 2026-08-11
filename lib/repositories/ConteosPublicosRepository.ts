import type { PrismaClient } from "@prisma/client";

import type { IConteosPublicosRepository } from "@/lib/interfaces/repositories/IConteosPublicosRepository";
import type { ConteosPublicos } from "@/lib/types/conteos-publicos";

// Feature 198 — los tres conteos publicos contra Postgres.

type ConteosPrismaClient = Pick<PrismaClient, "canton" | "orden" | "$transaction">;

export class ConteosPublicosRepository implements IConteosPublicosRepository {
  constructor(private readonly prisma: ConteosPrismaClient) {}

  async contar(): Promise<ConteosPublicos> {
    // Las tres cuentas van en UNA transaccion de solo lectura para que se vean bajo el MISMO
    // snapshot. Sin eso, `ordenesGestionadas` y `ordenesSinGestionar` se leerian en instantes
    // distintos y una orden gestionada entre medias podria contarse en las dos —o en
    // ninguna—, y la suma dejaria de cuadrar con el total. Es exactamente el defecto que la
    // feature 187 tuvo que ir a arreglar despues en la analitica; aqui nace bien.
    const [cantonesConCobertura, ordenesGestionadas, ordenesSinGestionar] =
      await this.prisma.$transaction([
        // Cobertura: cantones con AL MENOS UN distrito que tenga zona.
        //
        // ⚠️ El camino es por la tabla puente y no hay atajo: `Canton` no tiene `zonaId` y
        // `Distrito` tampoco —la columna escalar se elimino en `20260713000000` (feature 24)—.
        // `some` sobre la relacion anidada produce un EXISTS, que corta en cuanto encuentra
        // el primer distrito con zona en vez de materializar todos.
        this.prisma.canton.count({
          where: { distritos: { some: { zonas: { some: {} } } } },
        }),

        // Gestionadas: ordenes con al menos UNA gestion vigente.
        //
        // Se cuentan ORDENES, no gestiones: `gestion_orden` no tiene `@@unique(ordenId)`, asi
        // que una orden reintentada acumula varias filas y contarlas daria un numero mayor
        // que el total de ordenes (trampa documentada por la feature 192). `some` con
        // `anuladaAt: null` respeta el criterio de "gestion VIGENTE" del resto del repo.
        this.prisma.orden.count({
          where: {
            deletedAt: null,
            gestiones: { some: { anuladaAt: null } },
          },
        }),

        // Sin gestionar: el complementario EXACTO sobre el mismo universo (`deletedAt: null`).
        // `none` en vez de restar del total: una resta obligaria a una tercera consulta del
        // total y a confiar en que ambas vieron lo mismo. Asi las dos cuentas se derivan del
        // mismo predicado, negado, y su suma cuadra por construccion.
        this.prisma.orden.count({
          where: {
            deletedAt: null,
            gestiones: { none: { anuladaAt: null } },
          },
        }),
      ]);

    return { cantonesConCobertura, ordenesGestionadas, ordenesSinGestionar };
  }
}
