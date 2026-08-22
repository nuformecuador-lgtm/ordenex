import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { TableroDiaRepository } from "@/lib/repositories/TableroDiaRepository";
import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";

// Feature 259 (T2.1) — R1, R8, R9, R13. EL CRITERIO DEL DÍA, MEDIDO SOBRE EL SQL QUE SE EMITE.
//
// Este archivo espía la llamada real a `$queryRaw` y reconstruye el `Prisma.Sql` con sus
// parámetros (patrón de `tablero-dia-sql.test.ts`): nunca compara contra un SQL escrito a mano
// en el test, que demostraría que una consulta inventada cumple los requisitos.
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** PUEDE DEMOSTRAR, dicho aquí para que nadie lo cite de más: que
// las CIFRAS sean correctas. Un test de forma ve la cadena, no el conjunto de filas que devuelve
// Postgres. Eso lo deciden `tests/integration/tablero-dia-dia-reparto.test.ts` y las mutaciones
// de T5. En este repo una mutación del `WHERE` ya dejó once tests de servicio en verde.

const VENTANA = ventanaDelDiaEnCursoCR(new Date("2026-08-08T19:00:00.000Z"));
const ZONA = "11111111-1111-4111-8111-111111111111";
const MENSAJERO = "22222222-2222-4222-8222-222222222222";

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

/**
 * LAS TRES LECTURAS DEL TABLERO, cada una emitida por su método real. R13 exige que las tres
 * resuelvan el universo del día con la MISMA definición: si alguna se emancipara, la tarjeta, el
 * detalle y la línea de entregas podrían contradecirse en la misma pantalla.
 */
async function lasTresConsultas(): Promise<{ nombre: string; sql: Prisma.Sql }[]> {
  const salida: { nombre: string; sql: Prisma.Sql }[] = [];

  const tablero = espiar();
  await new TableroDiaRepository(tablero.prisma).contarPorMensajero(VENTANA, { tipo: "global" });
  salida.push({ nombre: "contarPorMensajero", sql: tablero.consultas[0] });

  const detalle = espiar();
  await new TableroDiaRepository(detalle.prisma).listarOrdenesDelDia(
    VENTANA,
    { tipo: "zona", zonaId: ZONA },
    MENSAJERO,
    { pagina: 1, pageSize: 25 },
  );
  salida.push({ nombre: "listarOrdenesDelDia", sql: detalle.consultas[0] });

  const ritmo = espiar();
  await new TableroDiaRepository(ritmo.prisma).contarEntregasPorHora(VENTANA, { tipo: "global" });
  salida.push({ nombre: "contarEntregasPorHora", sql: ritmo.consultas[0] });

  return salida;
}

/** El fragmento del universo del día: desde la primera rama hasta la unión final. */
function fragmentoDelUniverso(sql: Prisma.Sql): string {
  const desde = sql.text.indexOf("ids_reparto AS");
  const hasta = sql.text.indexOf("ids_del_dia AS");
  expect(desde, "la consulta no declara `ids_reparto`").toBeGreaterThanOrEqual(0);
  expect(hasta, "la consulta no declara `ids_del_dia`").toBeGreaterThan(desde);
  return sql.text.slice(desde, hasta);
}

/**
 * ⚠️ SOLO `ids_reparto`, y esto NO es una comodidad de lectura: es el arreglo de un fallo real
 * que encontró la mutación M6 de T5. La primera versión de este archivo afirmaba la rama (a)
 * contra el fragmento ENTERO, y ahí también vive la cláusula de la recolección
 * (`o2."fecha_reparto" = $N::date`). Con eso, quitarle a la rama (a) su `::date` y pasarle un
 * `Date` dejaba el test VERDE: la aserción la satisfacía la OTRA cláusula.
 */
function ramasDeReparto(sql: Prisma.Sql): string {
  const universo = fragmentoDelUniverso(sql);
  const corte = universo.indexOf("ids_recoleccion AS");
  expect(corte, "la consulta no declara `ids_recoleccion`").toBeGreaterThan(0);
  return universo.slice(0, corte);
}

describe("el universo del día — las DOS RAMAS del día de reparto (R1)", () => {
  it("cada una de las tres consultas lleva la rama (a): `fecha_reparto` = el día, como parámetro", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      // Sobre `o.` y con `::date`: es la rama (a) y no la cláusula de la recolección.
      expect(ramasDeReparto(sql), nombre).toMatch(/o\."fecha_reparto"\s*=\s*\$\d+::date/);
    }
  });

  it("cada una lleva la rama (b): `fecha_reparto IS NULL` MÁS el rango de `asignado_at`", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      // Las tres cláusulas van JUNTAS en la misma rama: es lo que la hace disjunta de (a).
      expect(ramasDeReparto(sql), nombre).toMatch(
        /"mensajero_asignado_id"\s+IS NOT NULL\s+AND o\."fecha_reparto"\s+IS NULL\s+AND o\."asignado_at"\s*>=\s*\$\d+\s+AND o\."asignado_at"\s*<\s*\$\d+/,
      );
    }
  });

  it("las dos ramas se unen con UNION (de conjuntos) y NUNCA con UNION ALL (R7)", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      const ramas = ramasDeReparto(sql);
      expect(ramas, nombre).toMatch(/\bUNION\b/);
      expect(ramas, nombre).not.toMatch(/\bUNION\s+ALL\b/);
      // Y tampoco después de la unión de los dos caminos.
      expect(fragmentoDelUniverso(sql), nombre).not.toMatch(/\bUNION\s+ALL\b/);
    }
  });

  it("la rama de recolección se acota al día representado o a las órdenes sin día (R11)", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      const universo = fragmentoDelUniverso(sql);
      const recoleccion = universo.slice(universo.indexOf("ids_recoleccion AS"));
      expect(recoleccion, nombre).toMatch(/JOIN "orden" o2 ON o2\."id" = h\."orden_id"/);
      expect(recoleccion, nombre).toMatch(
        /o2\."fecha_reparto"\s+IS NULL\s+OR\s+o2\."fecha_reparto"\s*=\s*\$\d+::date/,
      );
    }
  });
});

describe("cómo viaja el día al SQL (R9)", () => {
  it("el parámetro que usa la rama (a) ES `ventana.fecha`, y lleva `::date`", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      expect(sql.values, nombre).toContain(VENTANA.fecha);
      expect(ramasDeReparto(sql), nombre).toContain("::date");
      // No basta con que la fecha esté "en algún values": se sigue el NÚMERO del placeholder
      // de la rama (a) hasta el valor que le corresponde. Sin esto, la rama (a) podría estar
      // recibiendo cualquier otra cosa mientras la fecha viaja en otra cláusula (lo que dejó
      // pasar la mutación M6 de T5).
      const enlace = /o\."fecha_reparto"\s*=\s*\$(\d+)::date/.exec(ramasDeReparto(sql));
      expect(enlace, `${nombre}: la rama (a) no compara contra un parámetro con ::date`).not.toBe(
        null,
      );
      const indice = Number.parseInt((enlace as RegExpExecArray)[1], 10);
      expect(sql.values[indice - 1], `${nombre}: la rama (a) recibe otro valor`).toBe(
        VENTANA.fecha,
      );
    }
  });

  it("la fecha NUNCA aparece interpolada como literal en la cadena", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      // Si apareciera, sería una cadena montada a mano: ni parametrizada ni analizable.
      expect(sql.text, nombre).not.toContain(VENTANA.fecha);
      expect(sql.text, nombre).not.toContain(`'${VENTANA.fecha}'`);
    }
  });

  it("el día NUNCA viaja como `Date`: ningún parámetro es la medianoche UTC de esa fecha", async () => {
    // `lib/utils/dia-reparto.ts` documenta la trampa: contra una columna `DATE`, el driver
    // serializa un `Date` con el offset local del proceso y Postgres lo convierte con la zona
    // DE LA SESIÓN. Con la sesión en Costa Rica sale el día ANTERIOR.
    //
    // ⚠️ ESTE CASO SE REESCRIBIÓ EL 2026-08-21 PORQUE NO PODÍA FALLAR. Comparaba una lista de
    // `Date` contra un `string` (`expect(fechas).not.toContain(VENTANA.fecha)`): eso es siempre
    // verde, dijera el SQL lo que dijera. Ahora compara instantes contra instantes, que es lo
    // único que puede delatar a un `Date` colado como día — la forma que devuelven
    // `startOfDayCR(fecha)` y `new Date("YYYY-MM-DD")`, las dos la medianoche UTC.
    const [anio, mes, dia] = VENTANA.fecha.split("-").map((n) => Number.parseInt(n, 10));
    const medianocheUtc = Date.UTC(anio, mes - 1, dia);

    for (const { nombre, sql } of await lasTresConsultas()) {
      const instantes = sql.values
        .filter((v): v is Date => v instanceof Date)
        .map((d) => d.getTime());

      expect(instantes, `${nombre}: el día se coló como Date (medianoche UTC)`).not.toContain(
        medianocheUtc,
      );
      // Y la cláusula NO es vacía: los `Date` que SÍ viajan son las cotas de la ventana. Sin
      // esto, una consulta sin ningún parámetro `Date` pasaría el assert de arriba por vacío.
      expect(instantes, nombre).toContain(VENTANA.desde.getTime());
      expect(instantes, nombre).toContain(VENTANA.hasta.getTime());
    }
  });
});

describe("UNA sola definición del día: ni segunda convención ni columnas mezcladas (R8)", () => {
  it("ninguna consulta deriva el día con un `COALESCE` sobre `fecha_reparto`", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      // El `COALESCE` legítimo del detalle (`asignado_at`, `rec.at`, `ventana.desde`) ordena
      // filas; NO deriva ningún día. Lo que se prohíbe es mezclar las dos columnas del criterio.
      for (const bloque of sql.text.match(/COALESCE\([^)]*\)/g) ?? []) {
        expect(bloque, `${nombre}: un COALESCE mezcla las dos convenciones del día`).not.toContain(
          "fecha_reparto",
        );
      }
      expect(fragmentoDelUniverso(sql), nombre).not.toContain("COALESCE");
    }
  });

  it("ninguna consulta escribe un desplazamiento horario ni un nombre de zona en el SQL", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      expect(sql.text, nombre).not.toMatch(/AT TIME ZONE/i);
      expect(sql.text, nombre).not.toMatch(/America\/Costa_Rica|Costa_Rica/);
      expect(sql.text, nombre).not.toMatch(/interval\s+'6 hours'/i);
      expect(sql.text, nombre).not.toMatch(/\bstartOfDayCR\b/);
    }
  });
});

describe("las TRES lecturas comparten el MISMO universo, declarado en un solo sitio (R13)", () => {
  it("el fragmento del día es literalmente idéntico en las tres consultas", async () => {
    const consultas = await lasTresConsultas();
    expect(consultas).toHaveLength(3);

    const [primera, ...resto] = consultas;
    const referencia = fragmentoDelUniverso(primera.sql);
    // Idéntico incluso en la NUMERACIÓN de los parámetros: el CTE es la primera interpolación
    // de las tres. Si alguien copiara el fragmento en vez de reusar `cteIdsDelDia`, un cambio
    // de criterio alcanzaría a unas consultas y a otras no — y la tarjeta contradiría al
    // detalle sin que nada se pusiera rojo.
    for (const { nombre, sql } of resto) {
      expect(fragmentoDelUniverso(sql), `${nombre} no comparte el universo del día`).toBe(
        referencia,
      );
    }
    // Y el fragmento no es trivial: si fuera "" las tres serían iguales por vacío.
    expect(referencia.length).toBeGreaterThan(200);
  });

  it("las tres siguen siendo de SOLO LECTURA (R17)", async () => {
    for (const { nombre, sql } of await lasTresConsultas()) {
      expect(sql.text.toUpperCase(), nombre).not.toMatch(/\b(UPDATE|INSERT|DELETE|MERGE)\b/);
    }
  });
});
