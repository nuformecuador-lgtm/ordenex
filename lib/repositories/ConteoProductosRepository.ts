// FICHA 345 — EL SQL del analisis de productos.
//
// ─── LA AGREGACION VA EN DOS MITADES, Y ESA ES LA DECISION ───────────────────────────────
//
// La base hace lo que sabe hacer barato con los indices que YA tiene: contar ordenes por
// `(tienda, texto crudo de producto, desenlace)`. Node hace lo que la base no debe hacer:
// interpretar el texto libre. Consecuencia buscada (R57): lo que cruza la frontera esta acotado
// por `textos distintos x tiendas x desenlaces` —un numero que crece con el CATALOGO— y no por
// el numero de ordenes. N ordenes con el mismo texto son UNA fila.
//
// ─── EL `WHERE` NO SE VUELVE A ESCRIBIR (R56) ─────────────────────────────────────────────
//
// `condicionesDeConsulta` de `ConteoPorStatusRepository` ya es una funcion PURA y exportada que
// devuelve el array de fragmentos: alcance primero, `deleted_at IS NULL`, las cinco facetas por
// `IN`, el `EXISTS` del mensajero y la ventana semiabierta sobre `COALESCE(u.created_at,
// o.created_at)`. Se importa y se usa TAL CUAL. Su cabecera ya declara que hay DOS
// implementaciones del mismo recorte y que pueden divergir; una TERCERA seria peor.
//
// ─── Y EL `LATERAL` TAMPOCO (R27) ─────────────────────────────────────────────────────────
//
// El `LEFT JOIN LATERAL … LIMIT 1` con su desempate `created_at DESC, id DESC` es copia LITERAL
// del desglose por estado. Es lo que garantiza que el desenlace de una orden sea el MISMO en las
// dos pantallas: si aqui se escribiera «la ultima gestion» de otra manera, un producto podria
// aparecer como rechazado en esta tabla y entregado en la de al lado, sobre la misma orden.
// `LEFT` y no `INNER`: las ordenes sin gestion entran por `s."value"`.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import type {
  FilaProductoCruda,
  IConteoProductosRepository,
} from "@/lib/interfaces/repositories/IConteoProductosRepository";
import { condicionesDeConsulta } from "@/lib/repositories/ConteoPorStatusRepository";

/** Cliente MINIMO consumido (patron `ConteoPorStatusRepository`): una sola consulta cruda. */
type ConteoProductosPrismaClient = Pick<PrismaClient, "$queryRaw">;

/** La fila tal como la devuelve Postgres, antes de normalizar `n`. */
interface FilaCruda {
  readonly tienda_id: string;
  readonly tienda_nombre: string;
  readonly producto: string;
  readonly status: string;
  readonly n: number;
}

export class ConteoProductosRepository implements IConteoProductosRepository {
  constructor(private readonly prisma: ConteoProductosPrismaClient) {}

  async contarProductos(consulta: ConsultaProductos): Promise<readonly FilaProductoCruda[]> {
    const where = Prisma.join(condicionesDeConsulta(consulta), " AND ");

    // `JOIN "usuario"` es INNER y sin riesgo: `orden.tienda_id` es NOT NULL con FK
    // (`db/schema.prisma:573`). Se une aqui —y no se resuelve en Node con una segunda
    // consulta— para que la fila salga ya con el nombre de su tienda: R39 exige que dos
    // tiendas distintas NUNCA compartan fila, y la unica forma barata de garantizarlo es que
    // la tienda sea parte de la clave de agrupacion en la BASE.
    //
    // `GROUP BY` sobre el texto CRUDO (R57), no sobre nada parseado: la base no interpreta.
    // El `ORDER BY` es determinista y sirve al test, no a la pantalla: el orden de presentacion
    // lo fija el servicio sobre las filas ya fundidas.
    const filas = await this.prisma.$queryRaw<FilaCruda[]>`
      SELECT o."tienda_id"                            AS tienda_id,
             t."nombre"                               AS tienda_nombre,
             o."producto"                             AS producto,
             COALESCE(u."resultado"::text, s."value") AS status,
             COUNT(*)::int                            AS n
      FROM "orden" o
      JOIN "order_status" s ON s."id" = o."estatus_id"
      JOIN "usuario"      t ON t."id" = o."tienda_id"
      LEFT JOIN LATERAL (
        SELECT g."resultado", g."created_at"
        FROM "gestion_orden" g
        WHERE g."orden_id" = o."id"
          AND g."anulada_at" IS NULL
        ORDER BY g."created_at" DESC, g."id" DESC
        LIMIT 1
      ) u ON TRUE
      WHERE ${where}
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 3, 4`;

    // `n` es un CONTEO —un entero— y no un importe: esta lectura no emite ninguna cifra de
    // dinero por producto (limite innegociable de la ficha). `COUNT(*)::int` ya llega como
    // numero; el `Number()` es el mismo saneo defensivo que hace el desglose por estado.
    return filas.map((f) => ({
      tiendaId: f.tienda_id,
      tiendaNombre: f.tienda_nombre,
      producto: f.producto,
      status: f.status,
      n: Number(f.n),
    }));
  }
}
