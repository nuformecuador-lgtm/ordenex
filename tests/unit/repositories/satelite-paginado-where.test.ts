import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import { normalizeName } from "@/lib/utils/normalize";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 170 — FASE 2, T K.1 (R41/R44/R45/R51/R54) — el WHERE, el ORDER BY y el conteo de la
// pagina de la bodega satelite, ahi donde de verdad viven: en el SQL.
//
// Este archivo existe por una leccion MEDIDA dos veces. En la tanda I una mutacion cambio
// `notIn` por `in` en el repositorio y los tests de servicio siguieron verdes; en la tanda J
// pasaron dos mas. Los tests de servicio usan un DOBLE del repositorio: prueban que el
// servicio pase el alcance correcto, jamas que ese alcance se traduzca a SQL.
//
// Aqui eso importa mas que en ninguna tanda anterior, porque esta pagina se ordena y se recorta
// con `Prisma.sql` —Prisma no sabe ordenar por una secuencia arbitraria de valores de una
// relacion— y ese SQL no lo revisa ningun tipo. Se afirman cinco cosas:
//
//   1. el ACOTAMIENTO (zona del actor + no borradas) esta en el WHERE, siempre;
//   2. los tres filtros se emiten solo cuando hay valores, y con la comparacion correcta;
//   3. la pagina y el conteo comparten LITERALMENTE el mismo `FROM ... WHERE`;
//   4. el ORDER BY lleva el rango de grupo delante de prioridad y recencia (R51);
//   5. son DOS consultas: la que ordena y cuenta, y la que hidrata (R54).

const RANGO: RangoPagina = { skip: 4, take: 2 };

/** Fila tal como la devuelve el `select` de `WITH_RECEPCION_SATELITE`. */
function filaPrisma(id: string) {
  return {
    id,
    numGuia: 1001,
    numRemision: `REM-${id}`,
    destinatario: "Destinatario",
    telefonoDest: "88880000",
    direccion: null,
    producto: "Caja",
    montoCobrar: { toNumber: () => 1000 },
    prioridad: false,
    estatus: { value: "en_bodega_satelite" },
    tienda: { nombre: "Tienda" },
    zona: { nombre: "Zona A" },
    provincia: { nombre: "San José" },
    canton: { nombre: "Escazú" },
    distrito: { nombre: "San Rafael" },
  };
}

/**
 * Cliente Prisma falso que registra el SQL de cada `$queryRaw` y los argumentos del `findMany`
 * de hidratacion. `pagina` son los ids que devolveria la consulta que ordena; con `[]` se
 * ejercita la rama de la pagina vacia.
 */
function clienteFalso(pagina: string[], total: number) {
  const consultas: Prisma.Sql[] = [];
  const $queryRaw = vi.fn(async (sql: Prisma.Sql) => {
    consultas.push(sql);
    if (consultas.length === 1) return pagina.map((id) => ({ id, total }));
    return [{ total }];
  });
  const findMany = vi.fn(async (_args?: { where?: unknown }) => pagina.map(filaPrisma));
  const prisma = { $queryRaw, orden: { findMany } } as unknown as PrismaClient;
  return { prisma, repo: new OrdenRepository(prisma), consultas, $queryRaw, findMany };
}

/** El SQL con `?` en vez de valores, con los espacios colapsados para poder afirmarlo. */
function texto(sql: Prisma.Sql): string {
  return sql.sql.replace(/\s+/g, " ").trim();
}

describe("SQL de la página de la bodega satélite (T K.1)", () => {
  it("el acotamiento por zona del actor y las borradas van SIEMPRE en el where", async () => {
    const { repo, consultas } = clienteFalso(["o-1", "o-2"], 17);

    await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: [...ESTADOS_BODEGA_SATELITE] },
      RANGO,
    );

    const pagina = consultas[0]!;
    expect(texto(pagina)).toContain('WHERE o."zona_id" = ?');
    expect(texto(pagina)).toContain('o."deleted_at" IS NULL');
    expect(texto(pagina)).toContain('os."value" IN (?,?,?,?,?)');
    // La zona es el PRIMER parametro y es la del actor, no una constante ni un literal.
    expect(pagina.values[0]).toBe("z-a");
    expect(pagina.values.slice(1, 6)).toEqual([...ESTADOS_BODEGA_SATELITE]);
    // Sin filtros de geografia NO se emite ninguna condicion de geografia.
    expect(texto(pagina)).not.toContain('c."nombre"');
    expect(texto(pagina)).not.toContain('d."nombre"');
  });

  it("los tres filtros se cruzan en AND y comparan por el nombre que ofrece el catálogo (R45)", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 3);

    await repo.findRecepcionSatelitePaginada(
      {
        zonaId: "z-a",
        estatusValues: ["en_bodega_satelite", "devuelta"],
        cantonNombres: ["Escazú", "Barva"],
        distritoNombres: ["San Rafael"],
      },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    expect(sql).toContain('os."value" IN (?,?)');
    expect(sql).toContain('c."nombre" IN (?,?)');
    expect(sql).toContain('d."nombre" IN (?)');
    // Hermanas con AND: cruzar los tres NO puede ser un OR (mostraria mas de lo que hoy ve).
    expect(sql).toMatch(
      /o\."zona_id" = \? AND o\."deleted_at" IS NULL AND os\."value" IN \(\?,\?\) AND c\."nombre" IN \(\?,\?\) AND d\."nombre" IN \(\?\)/,
    );
    expect(consultas[0]!.values.slice(0, 6)).toEqual([
      "z-a",
      "en_bodega_satelite",
      "devuelta",
      "Escazú",
      "Barva",
      "San Rafael",
    ]);
  });

  it("el join de distrito es LEFT: sin filtro, una orden sin distrito sigue en el listado", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 1);

    await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: [...ESTADOS_BODEGA_SATELITE] },
      RANGO,
    );

    // Con un JOIN normal, las ordenes sin distrito (que existen: `distrito_id` es NULLABLE)
    // desaparecerian del listado sin que nada fallara. Con LEFT + `d."nombre" IN (...)` se
    // consigue lo otro que el cliente hace hoy: caen SOLO bajo un filtro de distrito.
    expect(texto(consultas[0]!)).toContain('LEFT JOIN "distrito" d ON d."id" = o."distrito_id"');
    expect(texto(consultas[0]!)).toContain('JOIN "canton" c ON c."id" = o."canton_id"');
    expect(texto(consultas[0]!)).toContain('JOIN "order_status" os ON os."id" = o."estatus_id"');
  });

  it("el orden lleva el rango de GRUPO delante de la prioridad y la recencia (R51)", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 9);

    await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: [...ESTADOS_BODEGA_SATELITE] },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    // `array_position` sobre la secuencia canonica: es lo que hoy produce concatenar los cinco
    // grupos en el modulo. Sin el, las filas cambian de pagina respecto a lo que se ve hoy.
    expect(sql).toContain(
      'ORDER BY array_position(ARRAY[?,?,?,?,?]::text[], os."value") ASC, o."prioridad" DESC, o."created_at" DESC, o."id" ASC',
    );
    // La secuencia que viaja al ORDER BY es la CANONICA COMPLETA, no la seleccion: filtrar por
    // un estado no puede reordenar el resto.
    const valores = consultas[0]!.values;
    expect(valores.slice(-7, -2)).toEqual([...ESTADOS_BODEGA_SATELITE]);
    // El recorte, al final y en ese orden.
    expect(sql).toContain("LIMIT ? OFFSET ?");
    expect(valores.slice(-2)).toEqual([RANGO.take, RANGO.skip]);
  });

  it("la secuencia del ORDER BY es completa aunque el filtro deje un solo estado (R51)", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 2);

    await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: ["devuelta"] },
      RANGO,
    );

    expect(consultas[0]!.values.slice(-7, -2)).toEqual([...ESTADOS_BODEGA_SATELITE]);
  });

  it("el conteo mira EXACTAMENTE el mismo conjunto que la página (R41)", async () => {
    // Pagina vacia (mas alla del final): es la unica rama con una consulta de conteo aparte.
    const { repo, consultas, findMany } = clienteFalso([], 12);

    const r = await repo.findRecepcionSatelitePaginada(
      {
        zonaId: "z-a",
        estatusValues: ["devuelta"],
        cantonNombres: ["Escazú"],
        distritoNombres: ["San Rafael"],
      },
      { skip: 100, take: 5 },
    );

    expect(consultas).toHaveLength(2);
    const [pagina, conteo] = consultas as [Prisma.Sql, Prisma.Sql];

    // El fragmento `FROM ... WHERE` del conteo es el MISMO texto que el de la pagina (lo que
    // sigue en la pagina es solo el orden y el recorte).
    const desdeDe = (sql: Prisma.Sql): string => {
      const t = texto(sql);
      const inicio = t.indexOf('FROM "orden"');
      const fin = t.indexOf(" ORDER BY");
      return fin === -1 ? t.slice(inicio) : t.slice(inicio, fin);
    };
    expect(desdeDe(conteo)).toBe(desdeDe(pagina));
    expect(conteo.values).toEqual(pagina.values.slice(0, conteo.values.length));
    // El conteo NO lleva recorte: contaria la pagina.
    expect(texto(conteo)).not.toContain("LIMIT");
    expect(texto(conteo)).not.toContain("OFFSET");
    // Y el total sale de ahi aunque la pagina no traiga ni una fila.
    expect(r).toEqual({ items: [], total: 12 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("en la página con filas el total viaja DENTRO de la misma consulta, sin un conteo aparte", async () => {
    const { repo, consultas } = clienteFalso(["o-1", "o-2"], 31);

    const r = await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: [...ESTADOS_BODEGA_SATELITE] },
      RANGO,
    );

    expect(consultas).toHaveLength(1);
    expect(texto(consultas[0]!)).toContain('SELECT o."id", (COUNT(*) OVER ())::int AS "total"');
    // 31 es el conjunto; 2 son las filas de la pagina. Nunca `items.length`.
    expect(r.total).toBe(31);
    expect(r.items).toHaveLength(2);
  });

  it("la consulta que hidrata repite el acotamiento y respeta el orden de la que ordenó", async () => {
    const { repo, findMany } = clienteFalso(["o-9", "o-1", "o-5"], 3);

    const r = await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: [...ESTADOS_BODEGA_SATELITE] },
      RANGO,
    );

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0]!.where).toEqual({
      id: { in: ["o-9", "o-1", "o-5"] },
      zonaId: "z-a", // el alcance NO se delega a «los ids vienen de una consulta acotada»
      deletedAt: null,
    });
    // El orden lo manda la consulta que ordeno, no el `findMany` (que no lo garantiza).
    expect(r.items.map((i) => i.id)).toEqual(["o-9", "o-1", "o-5"]);
  });

  it("sin estados no consulta nada: el listado se define por ellos", async () => {
    const { repo, $queryRaw, findMany } = clienteFalso(["o-1"], 1);

    const r = await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: [] },
      RANGO,
    );

    expect(r).toEqual({ items: [], total: 0 });
    expect($queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("el catálogo de opciones lee el conjunto del actor, no la página (R46)", async () => {
    const findMany = vi.fn(async (_args?: unknown) => [
      {
        provinciaId: "p1",
        cantonId: "c1",
        distritoId: "d1",
        provincia: { nombre: "San José" },
        canton: { nombre: "Escazú" },
        distrito: { nombre: "San Rafael" },
      },
      {
        provinciaId: "p1",
        cantonId: "c2",
        distritoId: null,
        provincia: { nombre: "San José" },
        canton: { nombre: "San José" },
        distrito: null,
      },
    ]);
    const repo = new OrdenRepository({ orden: { findMany } } as unknown as PrismaClient);

    const geo = await repo.findRecepcionSateliteGeoByZona("z-a", [...ESTADOS_BODEGA_SATELITE]);

    const args = findMany.mock.calls[0]![0]! as {
      where: unknown;
      distinct: unknown;
      take?: number;
      skip?: number;
    };
    expect(args.where).toEqual({
      zonaId: "z-a",
      deletedAt: null,
      estatus: { value: { in: [...ESTADOS_BODEGA_SATELITE] } },
    });
    // Ni `take` ni `skip`: recortar aqui es exactamente lo que R46 prohibe.
    expect(args.take).toBeUndefined();
    expect(args.skip).toBeUndefined();
    expect(args.distinct).toEqual(["provinciaId", "cantonId", "distritoId"]);
    expect(geo).toEqual([
      { provinciaNombre: "San José", cantonNombre: "Escazú", distritoNombre: "San Rafael" },
      { provinciaNombre: "San José", cantonNombre: "San José", distritoNombre: null },
    ]);
  });

  it("el catálogo de geografía sembrado no tiene dos nombres que colisionen al normalizar", async () => {
    // Por que este test vive aqui: el filtro de cliente compara canton y distrito con
    // `normalizeName` (sin acentos, sin caso), y el SQL de arriba compara por igualdad EXACTA
    // del nombre. Las dos comparaciones coinciden para TODO valor que el desplegable puede
    // ofrecer —porque ese valor sale de la misma columna— salvo que el catalogo contuviera dos
    // filas cuyos nombres solo se distinguen por acentos, caso o espacios. Esto lo comprueba.
    const sql = fs.readFileSync(
      path.join(process.cwd(), "db/migrations/20260713005000_seed_geografia_cr/migration.sql"),
      "utf8",
    );

    const nombresDe = (tabla: string): string[] => {
      const re = new RegExp(`INSERT INTO "${tabla}"[^\\n]*?"id", '([^']+)'`, "g");
      return [...sql.matchAll(re)].map((m) => m[1]!);
    };

    for (const [tabla, minimo] of [
      ["canton", 84],
      ["distrito", 400],
    ] as const) {
      const nombres = nombresDe(tabla);
      expect(nombres.length, `${tabla}: el seed no se leyo`).toBeGreaterThanOrEqual(minimo);

      const porClave = new Map<string, Set<string>>();
      for (const nombre of nombres) {
        const clave = normalizeName(nombre);
        const variantes = porClave.get(clave) ?? new Set<string>();
        variantes.add(nombre);
        porClave.set(clave, variantes);
      }
      const colisiones = [...porClave.entries()].filter(([, v]) => v.size > 1);
      expect(colisiones, `${tabla}: nombres que normalizan igual pero se escriben distinto`).toEqual(
        [],
      );
    }
  });
});
