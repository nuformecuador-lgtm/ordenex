import type { PrismaClient } from "@prisma/client";

import type {
  DistritoCoberturaRow,
  ICoberturaRepository,
} from "@/lib/interfaces/repositories/ICoberturaRepository";
import {
  SELECT_FLAG_PROPIO,
  disponibleDesdeCadena,
} from "@/lib/repositories/_shared/geografia-activa";

// Ficha 465 (design §3.2) — las dos lecturas del Excel de cobertura. Solo queries Prisma; la
// regla (cobertura, motivo, colapso de zonas) vive en `lib/utils/cobertura-distrito.ts`.
//
// Repositorio DEDICADO y no un metodo mas de `GeoRepository`: mezclaria tarifas en el repositorio
// del catalogo y creceria una interfaz con un composition root ya sensible (design §6.2).

type CoberturaPrismaClient = Pick<PrismaClient, "distrito" | "tarifa">;

export class CoberturaRepository implements ICoberturaRepository {
  constructor(private readonly prisma: CoberturaPrismaClient) {}

  async listDistritos(): Promise<DistritoCoberturaRow[]> {
    // SIN `where`: activos e inactivos (R4). La disponibilidad se PROYECTA, no se recorta.
    const rows = await this.prisma.distrito.findMany({
      // Los flags se proyectan con `SELECT_FLAG_PROPIO` (guardia 374/R11: el literal del flag
      // solo vive en `_shared/geografia-activa.ts`).
      select: {
        nombre: true,
        ...SELECT_FLAG_PROPIO,
        zonaEspecial: true,
        canton: {
          select: {
            nombre: true,
            ...SELECT_FLAG_PROPIO,
            provincia: { select: { nombre: true, ...SELECT_FLAG_PROPIO } },
          },
        },
        zonas: { select: { zona: { select: { id: true, nombre: true, esCentral: true } } } },
      },
    });

    return rows.map(
      (d): DistritoCoberturaRow => ({
        provincia: { nombre: d.canton.provincia.nombre, activo: d.canton.provincia.activo },
        canton: { nombre: d.canton.nombre, activo: d.canton.activo },
        distrito: { nombre: d.nombre, activo: d.activo, zonaEspecial: d.zonaEspecial },
        disponible: disponibleDesdeCadena(d),
        zonas: d.zonas.map((zd) => zd.zona),
      }),
    );
  }

  async listZonaIdsConTarifaGeneral(): Promise<string[]> {
    // Nivel 3 de la cascada (`lib/utils/cascada-tarifa.ts`): tienda NULL y zona con valor. La
    // fila global (NULL, NULL) NO es una tarifa general de ninguna zona (R14).
    const rows = await this.prisma.tarifa.findMany({
      where: { tiendaId: null, zonaId: { not: null } },
      select: { zonaId: true },
      distinct: ["zonaId"],
    });
    // El `where` es el UNICO filtro, a proposito: un segundo filtro en JS dejaria el
    // `zonaId: { not: null }` sin ningun test capaz de verlo. La integracion
    // (`tests/integration/db/cobertura-repository.test.ts`) exige que no salga ningun `null`.
    return rows.map((r) => r.zonaId as string);
  }
}
