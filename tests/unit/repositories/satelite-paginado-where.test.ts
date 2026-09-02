import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import {
  ESTADOS_BODEGA_SATELITE,
  ESTADOS_CUSTODIA_SATELITE,
} from "@/lib/utils/estados-bodega-satelite";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

/**
 * FICHA 357 — el ACOTAMIENTO pasa de UNA condicion (zona) a DOS (zona ∧ paso por una bodega
 * satelite), y eso mueve TODOS los indices de parametros de este archivo. Se declara aqui la
 * aritmetica en vez de repartir numeros magicos por los `slice`:
 *
 *   1 (`zona_id`) + 2 (`os."value" IN (custodia)`) + 2 (el `IN` de dentro del `EXISTS`)
 *
 * Los DOS `IN` de custodia llevan los mismos valores a proposito: uno mira el estado ACTUAL
 * —el paquete que esta en el estante ahora mismo— y el otro el HISTORIAL. Ver
 * `condicionPasoPorBodegaSatelite`.
 */
const PARAMS_ALCANCE = 1 + ESTADOS_CUSTODIA_SATELITE.length * 2;
/** Cuantos `?` ocupa el `IN` de la lista blanca de estados, que va justo despues del alcance. */
const PARAMS_ESTADOS = ESTADOS_BODEGA_SATELITE.length;
/** El primer parametro que NO es alcance ni lista blanca (geografia, tiempo, buscador…). */
const PRIMER_PARAM_DE_FILTRO = PARAMS_ALCANCE + PARAMS_ESTADOS;

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

/**
 * Fila tal como la devuelve el `include` de la hidratacion.
 *
 * FICHA 349: ese `include` es ahora el COMPARTIDO con `/ordenes` (`WITH_ESTATUS_Y_TIENDA`), no
 * el `select` propio de quince campos que este modulo tenia. La fila del doble crece con el —es
 * andamiaje: lo que este archivo afirma es el SQL, no la proyeccion—, y `montoCobrar` pasa a ser
 * un `Prisma.Decimal` de verdad porque la serializacion compartida opera con `toFixed(2)` sobre
 * el, que es lo que hace que el dinero no pierda un centimo por el camino.
 */
function filaPrisma(id: string) {
  return {
    id,
    numGuia: 1001,
    numRemision: `REM-${id}`,
    estatusId: "st-1",
    destinatario: "Destinatario",
    telefonoDest: "88880000",
    tiendaId: "t-1",
    zonaId: "z-1",
    provinciaId: "p-1",
    cantonId: "c-1",
    distritoId: "d-1",
    direccion: null,
    producto: "Caja",
    peso: null,
    notas: null,
    montoCobrar: new Prisma.Decimal(1000),
    cobraComision: false,
    mensajeroAsignadoId: null,
    fechaReparto: null,
    prioridad: false,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    estatus: { id: "st-1", value: "en_bodega_satelite" },
    tienda: { id: "t-1", nombre: "Tienda", email: "t@x.test", telefono: "88887777" },
    zona: { id: "z-1", nombre: "Zona A", esCentral: false },
    provincia: { id: "p-1", nombre: "San José" },
    canton: { id: "c-1", nombre: "Escazú" },
    distrito: { id: "d-1", nombre: "San Rafael", zonaEspecial: false },
    mensajeroAsignado: null,
    gestiones: [],
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

/** El `FROM ... WHERE ...` de una consulta: todo lo que hay entre el `FROM` y el `ORDER BY`. */
function desdeDe(sql: Prisma.Sql): string {
  const t = texto(sql);
  const inicio = t.indexOf('FROM "orden"');
  const fin = t.indexOf(" ORDER BY");
  return fin === -1 ? t.slice(inicio) : t.slice(inicio, fin);
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
    expect(texto(pagina)).toContain(`os."value" IN (${"?,".repeat(PARAMS_ESTADOS - 1)}?)`);
    // La zona es el PRIMER parametro y es la del actor, no una constante ni un literal.
    expect(pagina.values[0]).toBe("z-a");
    // FICHA 357 — LA SEGUNDA MITAD DEL ALCANCE. Va SIEMPRE, sin depender de ningun filtro, y
    // por eso se afirma aqui, en el test del acotamiento y no en el de los filtros.
    expect(texto(pagina)).toContain(
      'EXISTS ( SELECT 1 FROM "orden_historial_estado" h JOIN "order_status" hos ON hos."id" = h."estatus_destino_id" WHERE h."orden_id" = o."id" AND hos."value" IN (?,?) )',
    );
    // Los cuatro parametros de la evidencia: el estado ACTUAL y el HISTORIAL, la misma pareja.
    expect(pagina.values.slice(1, PARAMS_ALCANCE)).toEqual([
      ...ESTADOS_CUSTODIA_SATELITE,
      ...ESTADOS_CUSTODIA_SATELITE,
    ]);
    expect(pagina.values.slice(PARAMS_ALCANCE, PRIMER_PARAM_DE_FILTRO)).toEqual([
      ...ESTADOS_BODEGA_SATELITE,
    ]);
    // Sin filtros de geografia NO se emite ninguna condicion de geografia.
    expect(texto(pagina)).not.toContain('o."canton_id"');
    expect(texto(pagina)).not.toContain('o."distrito_id"');
    // Ni de tiempo, ni de busqueda: lo que no se filtra no se escribe.
    expect(texto(pagina)).not.toContain('o."created_at" >=');
    expect(texto(pagina)).not.toContain('o."busqueda_texto"');
  });

  it("la geografía se cruza en AND y compara por los IDs que ofrece el catálogo (R45)", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 3);

    await repo.findRecepcionSatelitePaginada(
      {
        zonaId: "z-a",
        estatusValues: ["en_bodega_satelite", "devuelta"],
        cantonIds: ["c-escazu", "c-barva"],
        distritoIds: ["d-san-rafael"],
      },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    expect(sql).toContain('o."canton_id" IN (?,?)');
    expect(sql).toContain('o."distrito_id" IN (?)');
    // Hermanas con AND: cruzarlas NO puede ser un OR (mostraria mas de lo que hoy ve).
    // FICHA 357: la clausula de alcance queda EN MEDIO y ENTRE PARENTESIS. Que su `OR` interno
    // este cerrado es lo que impide que se coma el `AND` de la zona — el modo exacto en que
    // este cambio podria haber ensanchado el alcance de todos a la vez.
    expect(sql).toMatch(
      /o\."zona_id" = \? AND o\."deleted_at" IS NULL AND \( os\."value" IN \(\?,\?\) OR EXISTS \([^)]*\)[^)]*\) \) AND os\."value" IN \(\?,\?\) AND o\."canton_id" IN \(\?,\?\) AND o\."distrito_id" IN \(\?\)/,
    );
    expect(consultas[0]!.values.slice(0, PARAMS_ALCANCE + 5)).toEqual([
      "z-a",
      ...ESTADOS_CUSTODIA_SATELITE,
      ...ESTADOS_CUSTODIA_SATELITE,
      "en_bodega_satelite",
      "devuelta",
      "c-escazu",
      "c-barva",
      "d-san-rafael",
    ]);
  });

  it("FICHA 357 · el criterio «paso por MI bodega» no se puede apagar desde el filtro", async () => {
    // El alcance NO es un campo de `RecepcionSateliteFiltro`: se emite SIEMPRE. Este caso lo
    // afirma con el filtro MAS PEQUENO posible —solo zona y un estado— porque es ahi donde un
    // `if` mal puesto lo dejaria fuera sin que ningun otro test lo notara.
    const { repo, consultas } = clienteFalso(["o-1"], 1);

    await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: ["entregada"] },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    expect(sql).toContain('FROM "orden_historial_estado" h');
    expect(sql).toContain('hos."value" IN (?,?)');
    // Y la ZONA sigue ahi: la evidencia dice SI estuvo en una bodega satelite, la zona dice en
    // CUAL. Sin la segunda, «mi bodega» seria «cualquier bodega».
    expect(sql).toContain('WHERE o."zona_id" = ?');
    expect(consultas[0]!.values[0]).toBe("z-a");
  });

  it("FICHA 357 · las tres consultas del dominio comparten el criterio, no solo la pagina", async () => {
    // El conjunto de la descarga y la comprobacion de vigencia leen el MISMO
    // `condicionesSatelite`. Si una de las tres se quedara sin la clausula, el archivo (o la
    // seleccion) mostraria filas que la pantalla no enseña y ningun test de pantalla lo veria.
    const conjunto = clienteFalso(["o-1"], 1);
    await conjunto.repo.findRecepcionSateliteCompleta({
      zonaId: "z-a",
      estatusValues: ["entregada"],
    });
    expect(texto(conjunto.consultas[0]!)).toContain('FROM "orden_historial_estado" h');

    const vigencia = clienteFalso(["o-1"], 1);
    await vigencia.repo.findIdsVigentesEnBodega(
      { zonaId: "z-a", estatusValues: ["entregada"] },
      ["o-1"],
    );
    expect(texto(vigencia.consultas[0]!)).toContain('FROM "orden_historial_estado" h');
    expect(texto(vigencia.consultas[0]!)).toContain('o."id" IN (?)');
  });

  it("la provincia filtra por id y se cruza en AND con el cantón", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 2);

    await repo.findRecepcionSatelitePaginada(
      {
        zonaId: "z-a",
        estatusValues: ["en_bodega_satelite"],
        provinciaIds: ["p-sj"],
        cantonIds: ["c-central-sj"],
      },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    // Pedido humano (2026-08-19): por ID y contra las columnas de `orden`. Comparando NOMBRES
    // —como hasta hoy— «Central» casaba en cuatro provincias y la cadena provincia -> canton
    // no podia declararse; con ids, el desplegable encadenado dice la verdad.
    expect(sql).toContain('o."provincia_id" IN (?) AND o."canton_id" IN (?)');
    expect(consultas[0]!.values.slice(0, PARAMS_ALCANCE + 3)).toEqual([
      "z-a",
      ...ESTADOS_CUSTODIA_SATELITE,
      ...ESTADOS_CUSTODIA_SATELITE,
      "en_bodega_satelite",
      "p-sj",
      "c-central-sj",
    ]);
  });

  it("la geografía ya no necesita JOINs: se compara contra las columnas de `orden`", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 1);

    await repo.findRecepcionSatelitePaginada(
      {
        zonaId: "z-a",
        estatusValues: [...ESTADOS_BODEGA_SATELITE],
        provinciaIds: ["p-sj"],
      },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    // Tres uniones por consulta que no leian ni una columna suya: se retiraron con el paso a
    // ids. La de estado se queda (la usan el filtro y el rango de grupo del ORDER BY).
    expect(sql).not.toContain('JOIN "provincia"');
    expect(sql).not.toContain('JOIN "canton"');
    expect(sql).not.toContain('JOIN "distrito"');
    expect(sql).toContain('JOIN "order_status" os ON os."id" = o."estatus_id"');
  });

  it("una orden SIN distrito cae solo bajo un filtro de distrito", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 1);

    await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: [...ESTADOS_BODEGA_SATELITE] },
      RANGO,
    );

    // Sin filtro no se emite la condicion, asi que las ordenes con `distrito_id` NULL —que
    // existen: la columna es NULLABLE— siguen en el listado. Con filtro, `NULL IN (...)` no es
    // cierto y caen, que es el mismo trato que les da `/ordenes`.
    expect(texto(consultas[0]!)).not.toContain('o."distrito_id"');
  });

  it("el rango de creación se emite con el borde superior ABIERTO", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 1);
    const desde = new Date("2026-08-01T06:00:00.000Z");
    const hasta = new Date("2026-08-11T06:00:00.000Z");

    await repo.findRecepcionSatelitePaginada(
      {
        zonaId: "z-a",
        estatusValues: ["en_bodega_satelite"],
        creadaDesde: desde,
        creadaHasta: hasta,
      },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    // `>= desde` y `< hasta`, la MISMA semantica que el `gte`/`lt` de `/ordenes`: el dia
    // «hasta» es inclusivo porque el servicio manda el inicio del dia SIGUIENTE.
    expect(sql).toContain('o."created_at" >= ? AND o."created_at" < ?');
    expect(consultas[0]!.values.slice(PARAMS_ALCANCE + 1, PARAMS_ALCANCE + 3)).toEqual([
      desde,
      hasta,
    ]);
  });

  it("el término del buscador compara la columna generada, y las dos formas van entre paréntesis", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 1);

    await repo.findRecepcionSatelitePaginada(
      {
        zonaId: "z-a",
        estatusValues: ["en_bodega_satelite"],
        busqueda: "8888-0000",
        busquedaDigitos: "88880000",
      },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    // El OR compara LA MISMA columna y va entre parentesis: el acotamiento por zona queda
    // FUERA y sigue mandando. Sin los parentesis, el `AND ... OR ...` de SQL soltaria el
    // alcance del actor, que es la unica forma en que este filtro podria mostrar de mas.
    expect(sql).toContain(
      '(o."busqueda_texto" LIKE ? OR o."busqueda_texto" LIKE ?)',
    );
    expect(consultas[0]!.values.slice(PARAMS_ALCANCE + 1, PARAMS_ALCANCE + 3)).toEqual([
      "%8888-0000%",
      "%88880000%",
    ]);
  });

  it("un término sin separadores emite UNA sola condición, sin OR", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 1);

    await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: ["en_bodega_satelite"], busqueda: "carmen" },
      RANGO,
    );

    const sql = texto(consultas[0]!);
    expect(sql).toContain('o."busqueda_texto" LIKE ?');
    // Sin `OR` EN EL BUSCADOR — y la comprobacion se acota a el, no al SQL entero: desde la
    // ficha 357 la clausula de alcance lleva su propio `OR` (estado actual O historial), que es
    // otra cosa y va entre parentesis. Un `not.toContain(" OR ")` global pasaria a medir el
    // alcance en vez del buscador, y se pondria rojo por la razon equivocada.
    // (`LIKE ? OR` a secas seria un falso positivo: casa con el `LIKE ? ORDER BY` del final.)
    expect(sql).not.toContain('o."busqueda_texto" LIKE ? OR o.');
    expect(sql.match(/o\."busqueda_texto"/g)).toHaveLength(1);
  });

  it("los comodines de LIKE se escapan: `%` no puede devolver el listado entero", async () => {
    const { repo, consultas } = clienteFalso(["o-1"], 1);

    await repo.findRecepcionSatelitePaginada(
      { zonaId: "z-a", estatusValues: ["en_bodega_satelite"], busqueda: "100%_x" },
      RANGO,
    );

    // Sin escapar, `%` casaria con todo y `_` con cualquier caracter: no es precision, es una
    // fuga del filtro. El escape es el mismo (`\\`) que aplica `/ordenes`.
    expect(consultas[0]!.values[PARAMS_ALCANCE + 1]).toBe("%100\\%\\_x%");
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
      `ORDER BY array_position(ARRAY[${"?,".repeat(PARAMS_ESTADOS - 1)}?]::text[], os."value") ASC, o."prioridad" DESC, o."created_at" DESC, o."id" ASC`,
    );
    // La secuencia que viaja al ORDER BY es la CANONICA COMPLETA, no la seleccion: filtrar por
    // un estado no puede reordenar el resto.
    const valores = consultas[0]!.values;
    expect(valores.slice(-PARAMS_ESTADOS - 2, -2)).toEqual([...ESTADOS_BODEGA_SATELITE]);
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

    expect(consultas[0]!.values.slice(-PARAMS_ESTADOS - 2, -2)).toEqual([
      ...ESTADOS_BODEGA_SATELITE,
    ]);
  });

  it("el conteo mira EXACTAMENTE el mismo conjunto que la página (R41)", async () => {
    // Pagina vacia (mas alla del final): es la unica rama con una consulta de conteo aparte.
    const { repo, consultas, findMany } = clienteFalso([], 12);

    const r = await repo.findRecepcionSatelitePaginada(
      {
        zonaId: "z-a",
        estatusValues: ["devuelta"],
        cantonIds: ["c-escazu"],
        distritoIds: ["d-san-rafael"],
      },
      { skip: 100, take: 5 },
    );

    expect(consultas).toHaveLength(2);
    const [pagina, conteo] = consultas as [Prisma.Sql, Prisma.Sql];

    // El fragmento `FROM ... WHERE` del conteo es el MISMO texto que el de la pagina (lo que
    // sigue en la pagina es solo el orden y el recorte).
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

});
