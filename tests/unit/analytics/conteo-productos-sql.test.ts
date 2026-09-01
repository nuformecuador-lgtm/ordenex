import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import { prepararConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { condicionesDeConsulta } from "@/lib/repositories/ConteoPorStatusRepository";
import { ConteoProductosRepository } from "@/lib/repositories/ConteoProductosRepository";

// Ficha 345 / T3.2 — EL `WHERE` Y LA FORMA DEL SQL (R55, R56, R27).
//
// ⚠ QUE PRUEBA ESTE ARCHIVO Y QUE NO. Prueba que el recorte que el repositorio de productos manda
// a la base es EXACTAMENTE el mismo array de fragmentos que el desglose por estado —o sea, que no
// hay una TERCERA implementacion del `where` (R56)— y que la forma del SQL es la que fija el
// desenlace de cada orden (R27). NO prueba que ese `WHERE` recorte de verdad: eso solo lo dice
// Postgres, y vive en `tests/integration/repositories/conteo-productos.int.test.ts`. En este repo
// esta medido que una mutacion del `WHERE` pasa en verde con dobles.

const AHORA = new Date("2026-09-01T12:00:00.000Z");

function consultaDe(raw: object, rol = "maestro", usuarioId = "u1"): ConsultaProductos {
  const preparada = prepararConsultaProductos(raw, { usuarioId, rol } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba invalido: ${preparada.status}`);
  return preparada.consulta;
}

/**
 * Doble del cliente Prisma que RECONSTRUYE la consulta entera.
 *
 * `$queryRaw` recibe el `TemplateStringsArray` como primer argumento y los valores interpolados
 * detras; `Prisma.sql` los vuelve a unir aplanando los `Prisma.Sql` anidados —que es lo que hace
 * el cliente real—, asi que lo capturado es el SQL que de verdad se manda, con sus parametros.
 */
function prismaFalso(filas: unknown[] = []) {
  const capturado = { sql: "", valores: [] as unknown[] };
  const prisma = {
    $queryRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) => {
      const consulta = Prisma.sql(plantilla, ...valores);
      capturado.sql = consulta.sql;
      capturado.valores = consulta.values;
      return Promise.resolve(filas);
    },
  };
  return { prisma, capturado };
}

async function sqlDe(consulta: ConsultaProductos) {
  const { prisma, capturado } = prismaFalso();
  await new ConteoProductosRepository(prisma as never).contarProductos(consulta);
  return capturado;
}

describe("R56 · el `where` NO se vuelve a escribir: es el de `condicionesDeConsulta`", () => {
  // Los seis recortes que la pantalla puede pedir, mas el alcance. Si alguien tocara el `where`
  // de una de las dos lecturas y no el de la otra, esto es lo unico que lo diria.
  const CASOS: [string, object, string][] = [
    ["sin filtro, maestro", {}, "maestro"],
    ["zona", { zona_id: ["z1", "z2"] }, "maestro"],
    ["provincia", { provincia_id: ["p1"] }, "maestro"],
    ["canton", { canton_id: ["c1"] }, "maestro"],
    ["distrito", { distrito_id: ["d1"] }, "maestro"],
    ["tienda", { tienda_id: ["u1"] }, "maestro"],
    ["mensajero", { mensajero_id: ["m1", "m2"] }, "maestro"],
    ["rango", { rango: "semana" }, "maestro"],
    ["alcance de tienda", {}, "adminTienda"],
    ["todo a la vez", { zona_id: ["z1"], tienda_id: ["u1"], rango: "dia" }, "adminTienda"],
  ];

  it.each(CASOS)("«%s»: el SQL del `where` es identico, fragmento a fragmento", async (_n, raw, rol) => {
    const consulta = consultaDe(raw, rol);
    const esperadas = condicionesDeConsulta(consulta);
    const { sql, valores } = await sqlDe(consulta);

    // El `where` completo, tal como lo compone el repositorio.
    const dondeEsperado = Prisma.join(esperadas, " AND ");
    expect(sql).toContain(dondeEsperado.sql);
    expect(valores).toEqual(dondeEsperado.values);
  });

  it("el ALCANCE es la PRIMERA condicion, antes que cualquier faceta del cliente", () => {
    // FRONTERA MULTI-TENANT: que se lea de un vistazo que la consulta esta recortada por rol
    // antes que por nada que haya pedido el cliente.
    const primera = condicionesDeConsulta(
      consultaDe({ zona_id: ["z1"], tienda_id: ["u1"] }, "adminTienda", "u1"),
    )[0];

    expect(primera?.sql).toContain('o."tienda_id"');
    expect(primera?.values).toEqual(["u1"]);
  });

  it("una PERMUTACION del `where` deja este test rojo (autocomprobacion)", async () => {
    // El detector tiene que distinguir orden: si comparase conjuntos, mover el alcance al final
    // pasaria, y con el se perderia la garantia de arriba.
    const consulta = consultaDe({ zona_id: ["z1"] }, "adminTienda", "u1");
    const original = Prisma.join(condicionesDeConsulta(consulta), " AND ");
    const permutado = Prisma.join([...condicionesDeConsulta(consulta)].reverse(), " AND ");
    const { sql } = await sqlDe(consulta);

    expect(sql).toContain(original.sql);
    expect(sql).not.toContain(permutado.sql);
  });

  it("el repositorio no interpola ningun id: todos viajan como parametros", async () => {
    const { sql, valores } = await sqlDe(
      consultaDe({ tienda_id: ["t-con'comilla"] }, "maestro"),
    );

    expect(sql).not.toContain("t-con");
    expect(valores).toContain("t-con'comilla");
  });
});

describe("R55 · lo que NUNCA cuenta", () => {
  it("excluye las ordenes borradas", async () => {
    const { sql } = await sqlDe(consultaDe({}));
    expect(sql).toContain('o."deleted_at" IS NULL');
  });

  it("y lo hace tambien con el alcance de tienda", async () => {
    const { sql } = await sqlDe(consultaDe({}, "adminTienda"));
    expect(sql).toContain('o."deleted_at" IS NULL');
    expect(sql).toContain('o."tienda_id"');
  });
});

describe("R27 · el desenlace de cada orden sale del MISMO LATERAL que el desglose por estado", () => {
  it("el `LEFT JOIN LATERAL` con su `LIMIT 1` y su desempate", async () => {
    const { sql } = await sqlDe(consultaDe({}));

    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain('g."anulada_at" IS NULL');
    // El desempate NO sobra: dos gestiones de la misma orden pueden compartir `created_at`, y
    // sin el segundo criterio la misma consulta daria dos desgloses distintos.
    expect(sql).toContain('ORDER BY g."created_at" DESC, g."id" DESC');
    expect(sql).toContain("LIMIT 1");
  });

  it("el `COALESCE` cae del lado del estatus cuando la orden nunca se gestiono", async () => {
    const { sql } = await sqlDe(consultaDe({}));
    expect(sql).toContain('COALESCE(u."resultado"::text, s."value")');
    // `LEFT` y no `INNER`: las ordenes sin gestion tienen que entrar igual.
    expect(sql).not.toContain("INNER JOIN LATERAL");
  });
});

describe("R57 · la base agrupa por texto CRUDO: N ordenes iguales son UNA fila", () => {
  it("el `GROUP BY` es por los cuatro campos", async () => {
    const { sql } = await sqlDe(consultaDe({}));
    expect(sql).toContain("GROUP BY 1, 2, 3, 4");
  });

  it("agrupa por `o.\"producto\"` sin interpretarlo: el repositorio NO parsea", async () => {
    const { sql } = await sqlDe(consultaDe({}));
    expect(sql).toContain('o."producto"');
    // Nada de regexp en SQL: el parser vive en Node y se prueba sin base de datos.
    expect(sql).not.toContain("regexp_");
    expect(sql).not.toContain("split_part");
  });

  it("la tienda entra en la clave de agrupacion, con su nombre por JOIN", async () => {
    const { sql } = await sqlDe(consultaDe({}));
    expect(sql).toContain('o."tienda_id"');
    expect(sql).toContain('t."nombre"');
    expect(sql).toContain('JOIN "usuario"');
  });
});

describe("La fila que devuelve el repositorio", () => {
  it("mapea las cinco columnas y deja el texto de producto TAL CUAL", async () => {
    const { prisma } = prismaFalso([
      {
        tienda_id: "t1",
        tienda_nombre: "Tienda Uno",
        producto: "1 * Base Dr. 1 * BASE C.",
        status: "entregada",
        n: 4,
      },
    ]);

    const filas = await new ConteoProductosRepository(prisma as never).contarProductos(
      consultaDe({}),
    );

    expect(filas).toEqual([
      {
        tiendaId: "t1",
        tiendaNombre: "Tienda Uno",
        // SIN parsear: el repositorio no interpreta el texto libre.
        producto: "1 * Base Dr. 1 * BASE C.",
        status: "entregada",
        n: 4,
      },
    ]);
  });

  it("el universo vacio es una lista vacia, no un error", async () => {
    const { prisma } = prismaFalso([]);
    await expect(
      new ConteoProductosRepository(prisma as never).contarProductos(consultaDe({})),
    ).resolves.toEqual([]);
  });

  it("no inventa filas que la base no devolvio", async () => {
    const { prisma } = prismaFalso([
      { tienda_id: "t1", tienda_nombre: "T", producto: "1 * A", status: "entregada", n: 1 },
    ]);
    const filas = await new ConteoProductosRepository(prisma as never).contarProductos(
      consultaDe({}),
    );
    expect(filas).toHaveLength(1);
  });
});
