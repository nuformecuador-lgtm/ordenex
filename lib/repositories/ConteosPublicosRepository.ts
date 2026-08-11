import type { PrismaClient } from "@prisma/client";

import type { IConteosPublicosRepository } from "@/lib/interfaces/repositories/IConteosPublicosRepository";
import type { ConteosPublicos } from "@/lib/types/conteos-publicos";

// Feature 198 — los tres conteos publicos contra Postgres.

type ConteosPrismaClient = Pick<PrismaClient, "distrito" | "orden" | "$transaction">;

export class ConteosPublicosRepository implements IConteosPublicosRepository {
  constructor(private readonly prisma: ConteosPrismaClient) {}

  async contar(): Promise<ConteosPublicos> {
    // Las tres cuentas van en UNA transaccion de solo lectura para que se vean bajo el MISMO
    // snapshot. Sin eso, `ordenesGestionadas` y `ordenesSinGestionar` se leerian en instantes
    // distintos y una orden gestionada entre medias podria contarse en las dos —o en
    // ninguna—, y la suma dejaria de cuadrar con el total. Es exactamente el defecto que la
    // feature 187 tuvo que ir a arreglar despues en la analitica; aqui nace bien.
    const [distritosConCobertura, ordenesGestionadas, ordenesSinGestionar] =
      await this.prisma.$transaction([
        // Cobertura: distritos con AL MENOS UNA zona = los `distrito_id` DISTINTOS de
        // `zona_distrito`.
        //
        // Se cuenta sobre `Distrito` con `some` y no sobre las filas del puente a proposito:
        // el par (zona, distrito) es unico pero un distrito puede aparecer en VARIAS zonas, y
        // contar filas lo contaria una vez por zona. `some` produce un EXISTS, que ademas de
        // deduplicar por construccion corta en la primera coincidencia. (`count` de Prisma no
        // admite `distinct`, asi que la alternativa literal seria un `groupBy` mas caro para
        // exactamente el mismo numero.)
        //
        // ⚠️ El camino es por la tabla puente y no hay atajo: `Distrito` no tiene `zonaId`
        // —la columna escalar se elimino en `20260713000000` (feature 24)—.
        this.prisma.distrito.count({
          where: { zonas: { some: {} } },
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

    return { distritosConCobertura, ordenesGestionadas, ordenesSinGestionar };
  }
}
