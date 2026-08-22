import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { TableroDiaRepository } from "@/lib/repositories/TableroDiaRepository";
import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";

// Feature 192 (B7.3) — R41, R55, R56, R58.
//
// El detalle es la SEGUNDA puerta a las mismas filas. Este archivo comprueba que su `WHERE`
// lleva a la vez el mensajero, la ventana del dia y el recorte por zona, y que la consulta
// esta acotada con `LIMIT`/`OFFSET`: nunca materializa el dia entero para recortarlo despues
// (la deuda de la ficha 191).

const VENTANA = ventanaDelDiaEnCursoCR(new Date("2026-08-08T19:00:00.000Z"));
const ZONA = "22222222-2222-4222-8222-222222222222";
const MENSAJERO = "33333333-3333-4333-8333-333333333333";
const PAGINA = { pagina: 3, pageSize: 25 };

interface Espia {
  readonly prisma: Pick<PrismaClient, "$queryRaw">;
  readonly consultas: Prisma.Sql[];
}

function espiar(filas: readonly unknown[] = []): Espia {
  const consultas: Prisma.Sql[] = [];
  const prisma = {
    $queryRaw: (strings: TemplateStringsArray, ...valores: unknown[]) => {
      consultas.push(Prisma.sql(strings, ...valores));
      return Promise.resolve([...filas]);
    },
  };
  return { prisma: prisma as unknown as Pick<PrismaClient, "$queryRaw">, consultas };
}

describe("TableroDiaRepository.listarOrdenesDelDia — el SQL", () => {
  it("va paginada con LIMIT y OFFSET parametrizados (R55)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );

    const sql = consultas[0].text;
    expect(sql).toMatch(/LIMIT\s+\$\d+\s+OFFSET\s+\$\d+/);
    expect(consultas[0].values).toContain(25);
    // pagina 3 con pageSize 25 => offset 50
    expect(consultas[0].values).toContain(50);
  });

  it("el mensajeroId viaja como parametro, nunca interpolado", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );

    expect(consultas[0].text).toMatch(/"mensajero_asignado_id"\s*=\s*\$\d+/);
    expect(consultas[0].text).not.toContain(MENSAJERO);
    expect(consultas[0].values).toContain(MENSAJERO);
  });

  it("con alcance ZONA el recorte esta en el WHERE, con el zonaId parametrizado (R41)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "zona", zonaId: ZONA },
      MENSAJERO,
      PAGINA,
    );

    expect(consultas[0].text).toMatch(/o\."zona_id"\s*=\s*\$\d+/);
    expect(consultas[0].text).not.toContain(ZONA);
    expect(consultas[0].values).toContain(ZONA);
  });

  it("con alcance GLOBAL no aparece el fragmento de zona", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );
    expect(consultas[0].text).not.toContain('o."zona_id"');
  });

  it("usa los MISMOS dos caminos que el tablero, con UNION y no UNION ALL (R58)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );

    const sql = consultas[0].text;
    expect(sql).toContain("ids_del_dia");
    expect(sql).toMatch(/o\."id"\s+IN\s+\(SELECT id FROM ids_del_dia\)/);
    expect(sql).not.toMatch(/\bUNION\s+ALL\b/);
  });

  it("define el resultado del dia igual que el tablero: ultima gestion vigente de la ventana", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );

    const sql = consultas[0].text;
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toMatch(/"anulada_at"\s+IS NULL/);
    expect(sql).toMatch(/ORDER BY g\."created_at" DESC, g\."id" DESC\s+LIMIT 1/);
  });

  it("es SOLO LECTURA (R59)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );
    expect(consultas[0].text.toUpperCase()).not.toMatch(/\b(UPDATE|INSERT|DELETE|MERGE)\b/);
  });

  it("mapea las filas al contrato y convierte el total (bigint) a number", async () => {
    const asignadoAt = new Date("2026-08-08T15:00:00.000Z");
    const { prisma } = espiar([
      {
        orden_id: "o1",
        resultado_del_dia: "entregada",
        asignado_at: asignadoAt,
        total: BigInt(7),
      },
    ]);

    const pagina = await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );

    expect(pagina.total).toBe(7);
    expect(typeof pagina.total).toBe("number");
    expect(pagina.filas).toEqual([
      {
        ordenId: "o1",
        resultadoDelDia: "entregada",
        asignadoAt: asignadoAt.toISOString(),
      },
    ]);
  });

  it("sin filas devuelve total 0, sin un segundo viaje a la base (R56)", async () => {
    const { prisma, consultas } = espiar([]);
    const pagina = await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );

    expect(pagina).toEqual({ filas: [], total: 0 });
    expect(consultas).toHaveLength(1);
  });
});

// FEATURE 260 (B2) — LA PROYECCION ADELGAZO, Y ESO SE AFIRMA.
//
// Esta consulta decide QUIEN entra, cuantas hay y en que orden; ya no decide que se pinta. Si
// alguien volviera a proyectar aqui `num_guia`, el estatus, el destinatario o la direccion,
// habria DOS proyecciones de fila de orden a elemento de listado y podrian divergir sin que
// nada se pusiera rojo — que es exactamente lo que R2 prohibe.
describe("TableroDiaRepository.listarOrdenesDelDia — la proyeccion de la feature 260", () => {
  async function sqlDelDetalle(): Promise<string> {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).listarOrdenesDelDia(
      VENTANA,
      { tipo: "global" },
      MENSAJERO,
      PAGINA,
    );
    return consultas[0].text;
  }

  it.each([
    ['o."num_guia"', "la guia la trae la hidratacion, con el mismo mapeo que el listado"],
    ['s."value"', "el estatus tambien, y con el se fue el JOIN a `order_status`"],
    ['o."destinatario"', "el destinatario lo pinta la columna del listado"],
    ['o."direccion"', "la direccion, igual"],
    ['JOIN "order_status"', "ese JOIN solo servia al SELECT que ya no existe"],
  ])("ya NO proyecta %s (R2)", async (fragmento) => {
    expect(await sqlDelDetalle()).not.toContain(fragmento);
  });

  it("sigue proyectando lo que SI decide: el id, el resultado del dia y el instante", async () => {
    const sql = await sqlDelDetalle();
    expect(sql).toMatch(/o\."id"\s+AS orden_id/);
    expect(sql).toMatch(/r\.resultado AS resultado_del_dia/);
    expect(sql).toContain("AS asignado_at");
    // R8 — el total sigue saliendo del MISMO SELECT que las filas, no de un segundo viaje.
    expect(sql).toContain("COUNT(*) OVER ()");
  });

  it("R38 — el adelgazamiento no toco el universo del dia ni la paginacion", async () => {
    const sql = await sqlDelDetalle();
    expect(sql).toContain("ids_del_dia");
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toMatch(/LIMIT\s+\$\d+\s+OFFSET\s+\$\d+/);
    expect(sql).toMatch(/ORDER BY COALESCE/);
  });
});
