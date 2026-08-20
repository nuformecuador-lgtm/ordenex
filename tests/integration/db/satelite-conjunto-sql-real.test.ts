import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

/**
 * Feature 184 — Tanda A: las dos consultas NUEVAS de la bodega satélite se EJECUTAN contra un
 * Postgres de verdad.
 *
 * QUÉ PRUEBA ESTE ARCHIVO Y QUÉ NO, que es lo que importa.
 *
 * SÍ prueba que el SQL crudo que emiten `findRecepcionSateliteCompleta` y
 * `findIdsVigentesEnBodega` es SQL válido contra el esquema real: los nombres de tabla y
 * columna (`os."value"`, `c."nombre"`, `o."prioridad"`, `o."created_at"`), los tres JOINs, el
 * `array_position(...)::text[]` y el `IN` de identificadores. Ese es el fallo que ningún test
 * de arriba puede ver: el doble de `$queryRaw` acepta cualquier texto, así que una columna mal
 * escrita pasa verde en los 23 casos de `satelite-paginado-where.test.ts` y revienta la primera
 * vez que alguien descarga o poda en producción.
 *
 * NO prueba el conjunto de filas: es una lectura de SOLO LECTURA, con un `zonaId` que no
 * existe, así que el resultado correcto es vacío. Qué filas devuelve cada filtro está probado
 * con dobles (servicio) y sobre los argumentos de la consulta (repositorio); sembrar aquí una
 * bodega entera —tienda, zona, provincia, cantón, distrito, estatus— para volver a comprobar lo
 * mismo dejaría bloat en la base de quien corre la suite sin añadir una sola afirmación nueva.
 *
 * Sin base alcanzable se SALTA (no falla): la suite tiene que seguir verde en una máquina sin
 * Postgres levantado.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** No existe ninguna zona con este id: la lectura es real pero no puede devolver filas. */
const ZONA_INEXISTENTE = "z-inexistente-184-tanda-a";

describeSiHayBase("SQL real de la bodega satélite (feature 184, T A.1/T A.2)", () => {
  let prisma: PrismaClient;
  let repo: OrdenRepository;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
    repo = new OrdenRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("el conjunto completo se ejecuta contra el esquema real, con y sin filtros de geografía", async () => {
    // Sin geografía: el `WHERE` mínimo más el `ORDER BY` con `array_position`.
    await expect(
      repo.findRecepcionSateliteCompleta({
        zonaId: ZONA_INEXISTENTE,
        estatusValues: [...ESTADOS_BODEGA_SATELITE],
      }),
    ).resolves.toEqual([]);

    // Con los dos filtros: se añaden `o."canton_id"` y `o."distrito_id"`.
    await expect(
      repo.findRecepcionSateliteCompleta({
        zonaId: ZONA_INEXISTENTE,
        estatusValues: ["devuelta"],
        cantonIds: ["c-escazu"],
        distritoIds: ["d-san-rafael"],
      }),
    ).resolves.toEqual([]);
  });

  it("los filtros heredados de `/ordenes` también son SQL válido contra el esquema real", async () => {
    // Pedido humano (2026-08-19): la barra ganó buscador y filtro de creación, y los dos
    // añaden condiciones al MISMO SQL crudo. `o."busqueda_texto"` es una columna GENERADA
    // —existe solo desde su migración— y el `LIKE` va con su patrón ya construido: si el
    // nombre o el tipo no casaran, ningún test con dobles lo vería y reventaría en la primera
    // búsqueda de la bodega.
    await expect(
      repo.findRecepcionSatelitePaginada(
        {
          zonaId: ZONA_INEXISTENTE,
          estatusValues: [...ESTADOS_BODEGA_SATELITE],
          provinciaIds: ["p-sj"],
          creadaDesde: new Date("2026-08-01T06:00:00.000Z"),
          creadaHasta: new Date("2026-08-11T06:00:00.000Z"),
          busqueda: "8888-0000",
          busquedaDigitos: "88880000",
        },
        { skip: 0, take: 5 },
      ),
    ).resolves.toEqual({ items: [], total: 0 });

    // Y el conjunto de la descarga, que comparte el fragmento: una forma sola del término
    // (sin el `OR`) tiene que ser igual de válida.
    await expect(
      repo.findRecepcionSateliteCompleta({
        zonaId: ZONA_INEXISTENTE,
        estatusValues: ["devuelta"],
        busqueda: "guapiles",
      }),
    ).resolves.toEqual([]);
  });

  it("la vigencia de identificadores se ejecuta contra el esquema real", async () => {
    await expect(
      repo.findIdsVigentesEnBodega(
        { zonaId: ZONA_INEXISTENTE, estatusValues: [...ESTADOS_BODEGA_SATELITE] },
        ["3f1c7c2e-9a1a-4f0e-9d4a-2b6a1c9e5d33", "3f1c7c2e-9a1a-4f0e-9d4a-2b6a1c9e5d34"],
      ),
    ).resolves.toEqual([]);
  });

  it("la página sigue ejecutándose igual tras compartir el criterio con las dos nuevas", async () => {
    // El refactor de T A.1 sacó el `WHERE` y el `ORDER BY` de este método a dos helpers. Si esa
    // extracción hubiera roto el SQL de la página —el único de los tres que ya estaba en
    // producción—, se vería aquí y no en la pantalla.
    await expect(
      repo.findRecepcionSatelitePaginada(
        { zonaId: ZONA_INEXISTENTE, estatusValues: [...ESTADOS_BODEGA_SATELITE] },
        { skip: 0, take: 25 },
      ),
    ).resolves.toEqual({ items: [], total: 0 });
  });
});
