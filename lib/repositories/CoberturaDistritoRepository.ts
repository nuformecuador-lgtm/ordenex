import type { PrismaClient } from "@prisma/client";

import type {
  CantonCoberturaRow,
  DistritoCoberturaRow,
  ICoberturaDistritoRepository,
  ProvinciaCoberturaRow,
} from "@/lib/interfaces/repositories/ICoberturaDistritoRepository";
import type { ArbolGeograficoPublico } from "@/lib/types/cotizador";

// Feature 248 (design §4.3) — las lecturas del catalogo geografico del cotizador contra Postgres.
//
// SOLO consultas: ninguna decision de negocio vive aqui (docs/architecture.md, principio 1). El
// distrito sale con TODAS sus zonas de la N:M `zona_distrito` sin colapsar; quien decide si eso
// es "cubierto", "sin cobertura" o "no determinado" es `zonaDeDistrito`, en el util compartido.
//
// ⛔ INVARIANTE R10, VERIFICABLE POR UNA GUARDIA: este modulo no importa
// `TarifaVigentePorTiendaRepository`, no toca `prisma.tarifa` y ningun `select` de aqui nombra
// `tarifasTienda`. Los tres `select` son EXPLICITOS por eso mismo: la ausencia del dinero tiene
// que ser medible, no prometida.

type CoberturaPrismaClient = Pick<PrismaClient, "provincia" | "canton" | "distrito">;

export class CoberturaDistritoRepository implements ICoberturaDistritoRepository {
  constructor(private readonly prisma: CoberturaPrismaClient) {}

  async listarProvincias(): Promise<readonly ProvinciaCoberturaRow[]> {
    // Sin filtro por nombre: el match lo hace `resolveGeo` normalizando AMBOS lados (acentos,
    // mayusculas, espacios). Filtrar en SQL descartaria "Limón" ante "Limon".
    return this.prisma.provincia.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  async listarCantonesPorProvincias(
    provinciaIds: readonly string[],
  ): Promise<readonly CantonCoberturaRow[]> {
    if (provinciaIds.length === 0) return [];
    return this.prisma.canton.findMany({
      where: { provinciaId: { in: [...provinciaIds] } },
      select: { id: true, nombre: true, provinciaId: true },
      orderBy: { nombre: "asc" },
    });
  }

  async listarDistritosPorCantones(
    cantonIds: readonly string[],
  ): Promise<readonly DistritoCoberturaRow[]> {
    if (cantonIds.length === 0) return [];
    const filas = await this.prisma.distrito.findMany({
      where: { cantonId: { in: [...cantonIds] } },
      select: {
        id: true,
        nombre: true,
        cantonId: true,
        // La cobertura ES esta relacion. Se traen TODAS las zonas del distrito (0, 1 o varias)
        // porque el cotizador tiene que distinguir "ninguna" de "ambigua"; colapsarlas aqui
        // seria decidir negocio en la capa de datos.
        zonas: { select: { zonaId: true, zona: { select: { nombre: true, esCentral: true } } } },
      },
      orderBy: { nombre: "asc" },
    });
    return filas.map((fila) => ({
      id: fila.id,
      nombre: fila.nombre,
      cantonId: fila.cantonId,
      zonas: fila.zonas.map((z) => ({
        zonaId: z.zonaId,
        nombre: z.zona.nombre,
        esCentral: z.zona.esCentral,
      })),
    }));
  }

  /**
   * D13/R7 — el arbol de la cascada publica. UNA consulta anidada, y el `select` NO nombra
   * `zonas` ni `esCentral`: lo que el publico ve del catalogo es geografia y nada mas.
   */
  async listarArbolGeograficoPublico(): Promise<ArbolGeograficoPublico> {
    return this.prisma.provincia.findMany({
      select: {
        id: true,
        nombre: true,
        cantones: {
          select: {
            id: true,
            nombre: true,
            distritos: { select: { id: true, nombre: true }, orderBy: { nombre: "asc" } },
          },
          orderBy: { nombre: "asc" },
        },
      },
      orderBy: { nombre: "asc" },
    });
  }
}
