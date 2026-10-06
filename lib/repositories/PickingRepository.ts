// Ficha 476 (design §4.3, R3, R6, R14, R26, R29) — SELECCION del informe de picking en Postgres.
//
// SOLO LECTURA (R9): el cliente que recibe no tiene `$executeRaw` ni metodos de escritura de
// modelo en su tipo. SQL crudo con `Prisma.sql` (todo valor viaja como parametro `$n`).
//
// LA SELECCION ES UNA SOLA (`seleccionEnPreparacion`) y la comparten el informe (una tienda) y el
// selector de tienda (todas las de fulfillment): los tres predicados de estado, fulfillment y
// borrado viven en UN sitio. Los cuatro predicados del `WHERE` (los tres + `tienda_id`) los mata uno
// a uno `tests/integration/db/picking-ordenes-en-preparacion.test.ts`.
//
// EL DIA NO SE CALCULA AQUI (misma convencion que la 475): se devuelve el INSTANTE de entrada y los
// dias en preparacion los cuenta `diasEnPreparacion` en TS, asi el PDF y el selector no pueden
// divergir en que es «atrasada».
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { IPickingRepository } from "@/lib/interfaces/repositories/IPickingRepository";
import type {
  EntradaPorTienda,
  FilaPicking,
  TiendaFulfillment,
  TiendaPicking,
} from "@/lib/whatsapp-envios/informes/picking/tipos";

/** Cliente minimo: lectura cruda y la lectura de `usuario`. */
export type PickingPrismaClient = Pick<PrismaClient, "$queryRaw"> & {
  usuario: Pick<PrismaClient["usuario"], "findUnique" | "findMany">;
};

interface FilaCruda {
  orden_id: string;
  tienda_id: string;
  num_remision: string;
  num_guia: number | bigint | null;
  producto: string;
  entrada: Date;
}

/**
 * Ordenes en preparacion de tiendas con fulfillment. `filtroTienda` es `Prisma.empty` (todas) o el
 * predicado de UNA tienda. La entrada al estado (D5/R14): la ULTIMA transicion del historial cuyo
 * DESTINO es `en_preparacion` (el `LATERAL` usa el indice `(orden_id, estatus_destino_id)`, sin una
 * consulta por orden — R29) y, sin ninguna, `orden.created_at`.
 */
function seleccionEnPreparacion(filtroTienda: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT o."id" AS "orden_id", o."tienda_id", o."num_remision", o."num_guia", o."producto",
           COALESCE(h."entrada", o."created_at") AS "entrada"
      FROM "orden" o
      JOIN "order_status" s ON s."id" = o."estatus_id"
      JOIN "usuario" t ON t."id" = o."tienda_id"
      LEFT JOIN LATERAL (
        SELECT MAX(hh."created_at") AS "entrada"
          FROM "orden_historial_estado" hh
         WHERE hh."orden_id" = o."id"
           AND hh."estatus_destino_id" = s."id"
      ) h ON true
     WHERE o."deleted_at" IS NULL
       AND s."value" = 'en_preparacion'
       AND t."fulfillment" = true
       ${filtroTienda}
     ORDER BY o."clave_remision" ASC, o."id" ASC`;
}

export class PickingRepository implements IPickingRepository {
  constructor(private readonly prisma: PickingPrismaClient) {}

  async tiendaDelPicking(tiendaId: string): Promise<TiendaPicking | null> {
    const u = await this.prisma.usuario.findUnique({
      where: { id: tiendaId },
      select: { id: true, nombre: true, fulfillment: true, estado: true, rol: { select: { value: true } } },
    });
    if (u === null) return null;
    return {
      id: u.id,
      nombre: u.nombre,
      fulfillment: u.fulfillment,
      esTienda: u.rol.value === "adminTienda",
      activo: u.estado === "activo",
    };
  }

  async ordenesEnPreparacion(tiendaId: string): Promise<FilaPicking[]> {
    const filas = await this.prisma.$queryRaw<FilaCruda[]>(
      seleccionEnPreparacion(Prisma.sql`AND o."tienda_id" = ${tiendaId}`),
    );
    return filas.map((f) => ({
      ordenId: f.orden_id,
      numRemision: f.num_remision,
      numGuia: f.num_guia === null ? null : Number(f.num_guia),
      producto: f.producto,
      entrada: f.entrada,
    }));
  }

  async tiendasFulfillment(): Promise<TiendaFulfillment[]> {
    return this.prisma.usuario.findMany({
      // Decision del leader (2026-10-05): una tienda con `estado` distinto de `activo` no se ofrece.
      where: { fulfillment: true, estado: "activo", rol: { value: "adminTienda" } },
      select: { id: true, nombre: true },
    });
  }

  async entradasEnPreparacion(): Promise<EntradaPorTienda[]> {
    const filas = await this.prisma.$queryRaw<FilaCruda[]>(seleccionEnPreparacion(Prisma.empty));
    return filas.map((f) => ({ tiendaId: f.tienda_id, entrada: f.entrada }));
  }
}
