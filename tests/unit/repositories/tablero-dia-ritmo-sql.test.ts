import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  CONTADOR_POR_RESULTADO,
  RESULTADO_ENTREGADA,
  TableroDiaRepository,
} from "@/lib/repositories/TableroDiaRepository";
import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";

// Feature 258 (B3.2) — R51, R52, R53, R55, R58.
//
// Mide EL SQL QUE EL REPOSITORIO EMITE (espia la llamada real a `$queryRaw` y reconstruye el
// `Prisma.Sql` con sus parametros), no un SQL escrito a mano en el test: eso demostraria que
// una consulta inventada cumple los requisitos, no que los cumpla la que corre en produccion.
//
// ⚠ Lo que este archivo NO puede demostrar: que el corte horario y el `WHERE` produzcan las
// cifras correctas. Eso son hechos del motor y se prueban contra Postgres real en
// `tests/integration/tablero-dia-ritmo.test.ts`. Aqui se comprueba la FORMA.

const VENTANA = ventanaDelDiaEnCursoCR(new Date("2026-08-08T19:00:00.000Z"));
const ZONA = "11111111-1111-4111-8111-111111111111";

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

async function emitir(
  filtro: Parameters<TableroDiaRepository["contarEntregasPorHora"]>[1],
  filas: readonly unknown[] = [],
): Promise<Prisma.Sql> {
  const { prisma, consultas } = espiar(filas);
  await new TableroDiaRepository(prisma).contarEntregasPorHora(VENTANA, filtro);
  expect(consultas).toHaveLength(1);
  return consultas[0];
}

describe("TableroDiaRepository.contarEntregasPorHora — el SQL", () => {
  it("resuelve la serie del dia en UNA sola llamada a $queryRaw (R58)", async () => {
    const { prisma, consultas } = espiar();
    await new TableroDiaRepository(prisma).contarEntregasPorHora(VENTANA, { tipo: "global" });
    expect(consultas).toHaveLength(1);
  });

  it("es AGREGADA: agrupa por hora y sus filas son horas, no ordenes (R58)", async () => {
    const sql = (await emitir({ tipo: "global" })).text;
    expect(sql).toMatch(/\bGROUP BY\b/);
    expect(sql).toMatch(/\bORDER BY 1\b/);
  });

  it("la hora sale de `ventana.desde`, sin ningun identificador de zona horaria en el SQL (R53)", async () => {
    const consulta = await emitir({ tipo: "global" });

    expect(consulta.text).toMatch(/EXTRACT\(EPOCH FROM \(r\.at - \$\d+::timestamp\)\)/);
    // El divisor va como `INTERVAL '1 hour'` y NO como `3600`: el literal `3600` esta
    // prohibido en `lib/repositories/` por `tests/unit/analytics/cache-config.guardia.test.ts`
    // (ahi ese numero es el TTL de la cache de analitica y vive en una sola constante).
    expect(consulta.text).toMatch(/EXTRACT\(EPOCH FROM INTERVAL '1 hour'\)/);
    expect(consulta.text).not.toMatch(/3_?600/);
    expect(consulta.text).toMatch(/\)::int\s+AS hora/);
    // Ni `AT TIME ZONE`, ni el nombre de la zona, ni el offset escrito a mano. Una segunda
    // fuente de verdad de la zona horaria —una en `lib/utils/fecha-cr.ts` y otra dentro de una
    // cadena SQL— es el off-by-one que cerro la ficha 166.
    expect(consulta.text).not.toMatch(/AT TIME ZONE/i);
    expect(consulta.text).not.toMatch(/America\/Costa_Rica|Costa_Rica|UTC-6|-06:00/);
    expect(consulta.text).not.toMatch(/\bstartOfDayCR\b/);
    expect(consulta.values).toContain(VENTANA.desde);
  });

  it("acota las gestiones a la ventana SEMIABIERTA del dia, con los dos extremos como parametros", async () => {
    const consulta = await emitir({ tipo: "global" });

    expect(consulta.text).toMatch(/g\."created_at"\s*>=\s*\$\d+/);
    expect(consulta.text).toMatch(/g\."created_at"\s*<\s*\$\d+/);
    expect(consulta.text).not.toMatch(/g\."created_at"\s*<=\s*\$\d+/);
    expect(consulta.values).toContain(VENTANA.desde);
    expect(consulta.values).toContain(VENTANA.hasta);
  });

  it("cuenta la ULTIMA gestion vigente de cada orden: el MISMO DISTINCT ON del tablero (R51)", async () => {
    const sql = (await emitir({ tipo: "global" })).text;

    expect(sql).toMatch(/DISTINCT ON \(g\."orden_id"\)/);
    expect(sql).toMatch(/ORDER BY g\."orden_id", g\."created_at" DESC, g\."id" DESC/);
    // Las gestiones ANULADAS no cuentan: son las mismas que el tablero ya descarta.
    expect(sql).toMatch(/g\."anulada_at" IS NULL/);
  });

  it("con alcance ZONA el recorte va en el WHERE y el zonaId viaja como PARAMETRO (R55)", async () => {
    const consulta = await emitir({ tipo: "zona", zonaId: ZONA });

    expect(consulta.text).toMatch(/o\."zona_id"\s*=\s*\$\d+/);
    // Si el id apareciera en la cadena, seria inyeccion por construccion.
    expect(consulta.text).not.toContain(ZONA);
    expect(consulta.values).toContain(ZONA);
  });

  it("con alcance GLOBAL no aparece ningun fragmento de zona", async () => {
    const consulta = await emitir({ tipo: "global" });
    expect(consulta.text).not.toContain('o."zona_id"');
  });

  it("el value `entregada` viaja como PARAMETRO con su cast al enum, no como literal", async () => {
    const consulta = await emitir({ tipo: "global" });

    expect(consulta.text).toMatch(/r\.resultado = \$\d+::"gestion_resultado"/);
    expect(consulta.text).not.toContain("'entregada'");
    expect(consulta.values).toContain(RESULTADO_ENTREGADA);
  });

  it("reutiliza el universo «asignada hoy» del tablero en vez de copiarlo (R51)", async () => {
    const sql = (await emitir({ tipo: "global" })).text;

    // Los dos caminos de `cteIdsDelDia`, con su UNION de conjuntos (nunca UNION ALL).
    expect(sql).toMatch(/ids_reparto AS/);
    expect(sql).toMatch(/ids_recoleccion AS/);
    expect(sql).toMatch(/ids_del_dia AS/);
    expect(sql).toMatch(/\bUNION\b/);
    expect(sql).not.toMatch(/\bUNION\s+ALL\b/);
    // Y el mismo recorte de siempre sobre la orden: sin mensajero o borrada, no cuenta.
    expect(sql).toMatch(/o\."mensajero_asignado_id" IS NOT NULL/);
    expect(sql).toMatch(/o\."deleted_at" IS NULL/);
  });

  it("es SOLO LECTURA: ni un UPDATE, INSERT, DELETE o MERGE", async () => {
    const sql = (await emitir({ tipo: "zona", zonaId: ZONA })).text.toUpperCase();
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|MERGE)\b/);
  });

  it("convierte el COUNT (bigint) a number: un BigInt reventaria la Server Action", async () => {
    const { prisma } = espiar([
      { hora: 7, entregadas: BigInt(3) },
      { hora: 9, entregadas: BigInt(1) },
    ]);

    const filas = await new TableroDiaRepository(prisma).contarEntregasPorHora(VENTANA, {
      tipo: "global",
    });

    expect(filas).toEqual([
      { hora: 7, entregadas: 3 },
      { hora: 9, entregadas: 1 },
    ]);
    for (const fila of filas) {
      expect(typeof fila.hora).toBe("number");
      expect(typeof fila.entregadas).toBe("number");
    }
  });

  it("devuelve SOLO las horas con entregas: los huecos los rellena el servicio", async () => {
    const { prisma } = espiar([{ hora: 13, entregadas: BigInt(2) }]);
    const filas = await new TableroDiaRepository(prisma).contarEntregasPorHora(VENTANA, {
      tipo: "global",
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].hora).toBe(13);
  });
});

describe("la serie queda ATADA al contador con el que tiene que cuadrar (R52)", () => {
  it("`RESULTADO_ENTREGADA` es exactamente el value que alimenta el contador `entregadas`", () => {
    // Sin esto, el cuadre dependeria de que dos nombres se parezcan. Con esto, renombrar el
    // value del enum o mover el contador rompe aqui y no en la pantalla de un supervisor.
    expect(CONTADOR_POR_RESULTADO[RESULTADO_ENTREGADA]).toBe("entregadas");
  });
});
