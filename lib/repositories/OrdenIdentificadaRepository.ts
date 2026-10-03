import { Prisma, type PrismaClient } from "@prisma/client";

import type { IOrdenIdentificadaRepository } from "@/lib/interfaces/repositories/IOrdenIdentificadaRepository";
import type { OrdenIdentificada } from "@/lib/types/busqueda-por-guia";

// Cliente Prisma acotado a lo que este repo necesita (patron CierreAporteRepository).
type OrdenIdentificadaPrismaClient = Pick<PrismaClient, "$queryRaw" | "cierreDetail" | "rechazoTiendaCobro" | "ordenIncidente">;

/**
 * FICHA 469 (design §2.1–§2.3) — las lecturas de la busqueda por guia que no son el criterio de aporte.
 * SOLO queries.
 *
 * POR QUE `$queryRaw` EN `identificar` Y NO `findMany`. La remision se compara SIN mayusculas (R4) y
 * COMPLETA (R3). El `mode: "insensitive"` de Prisma en Postgres se traduce a `ILIKE`, donde `%` y `_` del
 * termino son comodines: «NA-1_» identificaria «NA-10». `lower(a) = lower(b)` es igualdad de verdad.
 */
export class OrdenIdentificadaRepository implements IOrdenIdentificadaRepository {
  constructor(private readonly prisma: OrdenIdentificadaPrismaClient) {}

  async identificar(f: { termino: string; guia?: number; tiendaId?: string }): Promise<OrdenIdentificada[]> {
    const porGuia = f.guia === undefined ? Prisma.empty : Prisma.sql`o."num_guia" = ${f.guia} OR `;
    // `tiendaId` AL FINAL y en `AND` con el `OR` entero (entre parentesis): una guia de otra tienda no
    // puede colarse por la rama de la guia (R5).
    const deLaTienda = f.tiendaId === undefined ? Prisma.empty : Prisma.sql` AND o."tienda_id" = ${f.tiendaId}`;
    return this.prisma.$queryRaw<OrdenIdentificada[]>(Prisma.sql`
      SELECT o."id" AS "ordenId", o."num_guia" AS "numGuia", o."num_remision" AS "numRemision"
      FROM "orden" o
      WHERE (${porGuia}lower(o."num_remision") = lower(${f.termino}))${deLaTienda}
      ORDER BY o."id"`);
  }

  async cierresDeOrdenes(f: { ordenIds: readonly string[]; tiendaId?: string }): Promise<Array<{ cierreId: string; ordenId: string }>> {
    if (f.ordenIds.length === 0) return [];
    return this.prisma.cierreDetail.findMany({
      where: { ordenId: { in: [...f.ordenIds] }, ...(f.tiendaId !== undefined ? { tiendaId: f.tiendaId } : {}) },
      select: { cierreId: true, ordenId: true },
      orderBy: [{ cierreId: "asc" }, { ordenId: "asc" }],
    });
  }

  async gestionesConCobroPorRechazo(f: { ordenIds: readonly string[]; tiendaId?: string }): Promise<string[]> {
    if (f.ordenIds.length === 0) return [];
    const filas = await this.prisma.rechazoTiendaCobro.findMany({
      where: { ordenId: { in: [...f.ordenIds] }, ...(f.tiendaId !== undefined ? { tiendaId: f.tiendaId } : {}) },
      select: { gestionId: true },
      orderBy: { gestionId: "asc" },
    });
    return filas.map((r) => r.gestionId);
  }

  async incidentesDeOrdenes(ordenIds: readonly string[]): Promise<string[]> {
    if (ordenIds.length === 0) return [];
    const filas = await this.prisma.ordenIncidente.findMany({
      where: { ordenId: { in: [...ordenIds] } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return filas.map((i) => i.id);
  }
}
