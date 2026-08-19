import { describe, it, expect } from "vitest";

import { prepararConteoEntregas, type ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import {
  condicionDeAlcance,
  condicionesDeConsulta,
  ConteoPorStatusRepository,
} from "@/lib/repositories/ConteoPorStatusRepository";

// El `where` del desglose por status va en SQL, así que se comprueba sobre los fragmentos que
// `condicionesDeConsulta` produce: su texto y sus PARÁMETROS. Sin base de datos.
//
// ⚠ ESTE ARCHIVO ES LA RED CONTRA UNA DERIVA CONCRETA Y DECLARADA. Hay dos implementaciones
// del mismo recorte —la de objetos Prisma en `ConteoEntregasRepository.whereDeConsulta` y la
// de SQL de aquí— porque «la última gestión vigente» no se expresa con el query builder. Los
// casos de este archivo hacen faceta por faceta las MISMAS preguntas que
// `conteo-entregas-where.test.ts`: si alguien toca un endpoint y no el otro, esto es lo único
// que lo va a decir.

const AHORA = new Date("2026-08-17T12:00:00.000Z");

function consultaDe(raw: object, rol = "maestro", extra: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol, ...extra } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba inválido: ${preparada.status}`);
  return preparada.consulta;
}

/** El SQL de todas las condiciones unidas, tal como llega al `WHERE`. */
function sqlDe(consulta: ConsultaConteoEntregas): string {
  return condicionesDeConsulta(consulta)
    .map((c) => c.sql)
    .join(" AND ");
}

/** Los parámetros, en orden. Lo que de verdad viaja: nada de esto se interpola. */
function parametrosDe(consulta: ConsultaConteoEntregas): unknown[] {
  return condicionesDeConsulta(consulta).flatMap((c) => c.values);
}

describe("El recorte por ROL es la primera condición, siempre", () => {
  // FRONTERA MULTI-TENANT. Sin policies RLS debajo, esta condición es la única separación
  // entre inquilinos de esta consulta: un fallo aquí no da una cifra equivocada, filtra las
  // órdenes de una tienda a otra.
  it("va en la POSICIÓN 0, antes que cualquier faceta del cliente", () => {
    const primera = condicionesDeConsulta(
      consultaDe({ zona_id: ["z1"], tienda_id: ["u1"] }, "adminTienda"),
    )[0];

    expect(primera?.sql).toContain('o."tienda_id"');
    expect(primera?.values).toEqual(["u1"]);
  });

  it("adminSatelite se recorta por `zona_id` de la ORDEN", () => {
    const alcance = condicionDeAlcance({ tipo: "zona", zonaId: "z7" });

    expect(alcance.sql).toContain('o."zona_id"');
    expect(alcance.values).toEqual(["z7"]);
  });

  // `TRUE` y no un fragmento vacío: las condiciones se unen con `AND` y un hueco rompería el
  // SQL entero. La mutación que este caso mata es devolver `Prisma.empty` para el caso global.
  it("`global` produce `TRUE`, no un hueco que rompa el AND", () => {
    expect(condicionDeAlcance({ tipo: "global" }).sql.trim()).toBe("TRUE");
    expect(sqlDe(consultaDe({}, "maestro"))).toMatch(/^TRUE AND /);
  });

  // El id del alcance NUNCA se interpola: viaja como parámetro. Un id que llegue de una cookie
  // y acabe concatenado en el SQL es una inyección con nombre y apellidos.
  it("el id del alcance viaja como parámetro, no incrustado en el texto", () => {
    const alcance = condicionDeAlcance({ tipo: "tienda", tiendaId: "t-con'comilla" });

    expect(alcance.sql).not.toContain("t-con");
    expect(alcance.values).toEqual(["t-con'comilla"]);
  });
});

describe("Universo — lo que NUNCA cuenta", () => {
  it("excluye las órdenes borradas", () => {
    expect(sqlDe(consultaDe({}))).toContain('o."deleted_at" IS NULL');
  });

  // Una gestión anulada (feature 67) no es actividad: es actividad deshecha. Aparece en el
  // LATERAL de la consulta y en el `EXISTS` del filtro de mensajero, y las dos veces vigente.
  it("el filtro de mensajero sólo mira gestiones vigentes", () => {
    const sql = sqlDe(consultaDe({ mensajero_id: ["m1"] }));

    expect(sql).toContain('gm."anulada_at" IS NULL');
  });
});

describe("Las seis dimensiones de recorte", () => {
  it("cada faceta se traduce a su columna de `orden` con `IN (...)`", () => {
    const sql = sqlDe(
      consultaDe({
        zona_id: ["z1", "z2"],
        provincia_id: ["p1"],
        canton_id: ["c1"],
        distrito_id: ["d1"],
        tienda_id: ["t1"],
      }),
    );

    for (const columna of ["zona_id", "provincia_id", "canton_id", "distrito_id", "tienda_id"]) {
      expect(sql, columna).toContain(`o."${columna}" IN (`);
    }
  });

  it("todos los ids viajan como parámetros, en orden", () => {
    expect(parametrosDe(consultaDe({ zona_id: ["z1", "z2"], canton_id: ["c1"] }))).toEqual([
      "z1",
      "z2",
      "c1",
    ]);
  });

  it("una faceta no pedida NO escribe su condición", () => {
    const sql = sqlDe(consultaDe({}));

    for (const columna of ["zona_id", "provincia_id", "canton_id", "distrito_id"]) {
      expect(sql, columna).not.toContain(`o."${columna}" IN (`);
    }
  });

  // Mismo criterio que el otro endpoint: quien REGISTRÓ la gestión, no el asignado actual de
  // la orden (que pudo cambiar después de la entrega).
  it("mensajero filtra por `gestion_orden.mensajero_id`, no por el asignado", () => {
    const sql = sqlDe(consultaDe({ mensajero_id: ["m1"] }));

    expect(sql).toContain('gm."mensajero_id" IN (');
    expect(sql).not.toContain("mensajero_asignado_id");
  });
});

describe("La ventana temporal", () => {
  // La fecha efectiva es la MISMA regla que el otro endpoint: COALESCE(última gestión vigente,
  // orden.created_at). Aquí se lee directa porque el LATERAL ya trajo esa gestión.
  it("compara `COALESCE(gestión, orden)` y no una sola de las dos", () => {
    const sql = sqlDe(consultaDe({ rango: "dia" }));

    expect(sql).toContain('COALESCE(u."created_at", o."created_at")');
    // La mutación que mata: comparar sólo `o.created_at`. Entonces una orden creada en enero y
    // gestionada hoy no entraría en el rango de hoy.
    expect(sql).not.toMatch(/(?<!COALESCE\(u\."created_at", )o\."created_at" >=/);
  });

  // Ventana SEMIABIERTA `[desde, hasta)`: `resolverRango` devuelve `hasta` como las 00:00 CR
  // del día SIGUIENTE, para que `hastaFecha` sea inclusiva. Un `<=` metería un día de más.
  it("es semiabierta: `>=` abajo y `<` arriba, nunca `<=`", () => {
    const sql = sqlDe(consultaDe({ rango: "dia" }));

    expect(sql).toContain(">=");
    expect(sql).toContain("<");
    expect(sql).not.toContain("<=");
  });

  it("los bordes son los que resolvió el rango, no unos propios", () => {
    const consulta = consultaDe({ rango: "dia" });

    expect(parametrosDe(consulta)).toEqual([consulta.rango?.desde, consulta.rango?.hasta]);
  });

  // La pantalla no arranca con ninguna ventana puesta. Sin rango NO se escribe condición de
  // fecha: «sin filtrar» tiene que contar todas las órdenes, no las de una semana.
  it("SIN rango no escribe ninguna condición de fecha", () => {
    const sql = sqlDe(consultaDe({}));

    expect(sql).not.toContain("created_at");
    // Y el resto sigue entero: sin fecha no es sin recorte.
    expect(sql).toContain('o."deleted_at" IS NULL');
  });
});

describe("La consulta que se ejecuta", () => {
  /** Doble del cliente Prisma: guarda el SQL y devuelve filas fijas. */
  function prismaFalso(filas: { status: string; n: number }[]) {
    const capturado: { sql: string[]; valores: unknown[] } = { sql: [], valores: [] };
    const prisma = {
      $queryRaw: (plantilla: { sql?: string; strings?: string[]; values?: unknown[] }) => {
        capturado.sql = plantilla.strings ?? [plantilla.sql ?? ""];
        capturado.valores = plantilla.values ?? [];
        return Promise.resolve(filas);
      },
    };
    return { prisma, capturado };
  }

  it("devuelve un bucket por fila, con el conteo como número", async () => {
    const { prisma } = prismaFalso([
      { status: "entregada", n: 20 },
      { status: "en_reparto", n: 8 },
    ]);

    const filas = await new ConteoPorStatusRepository(prisma as never).contarPorStatus(
      consultaDe({}),
    );

    expect(filas).toEqual([
      { status: "entregada", conteo: 20 },
      { status: "en_reparto", conteo: 8 },
    ]);
  });

  // Los status sin órdenes no vienen: `GROUP BY` no emite filas vacías. Es lo pedido, y por eso
  // el repositorio no filtra nada — este caso fija que tampoco INVENTE buckets en cero.
  it("no añade buckets que la base no devolvió", async () => {
    const { prisma } = prismaFalso([{ status: "entregada", n: 3 }]);

    const filas = await new ConteoPorStatusRepository(prisma as never).contarPorStatus(
      consultaDe({}),
    );

    expect(filas).toHaveLength(1);
  });

  it("el universo vacío es una lista vacía, no un error", async () => {
    const { prisma } = prismaFalso([]);

    await expect(
      new ConteoPorStatusRepository(prisma as never).contarPorStatus(consultaDe({})),
    ).resolves.toEqual([]);
  });
});
