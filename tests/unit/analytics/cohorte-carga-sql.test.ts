import { describe, it, expect } from "vitest";

import {
  prepararConteoEntregas,
  type ConsultaConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import { condicionesDeCohorte } from "@/lib/repositories/CohorteCargaRepository";

// Ficha 411 / T2.3 — el `where` de la cohorte, sobre los fragmentos que produce
// `condicionesDeCohorte`: su TEXTO y sus PARAMETROS. Sin base de datos.
//
// ⚠ QUE DEMUESTRA ESTE ARCHIVO Y QUE NO. Demuestra que el RECORTE se construye bien: el alcance
// primero, el soft delete, la ventana siempre, y ningun `EXISTS` de mensajero. NO demuestra que
// la consulta sea correcta —los dobles no ven el SQL, y en este repo una mutacion del `WHERE`
// los pasa en verde, medido cuatro veces—. Eso es `tests/integration/db/cohorte-carga-*.int.test.ts`,
// contra Postgres real.
//
// Es la CUARTA escritura del mismo recorte en esta vertical. Las preguntas de abajo son, faceta
// por faceta, las mismas que hace `conteo-por-status-sql.test.ts`: si alguien toca una lectura y
// no la otra, esto y el test de equivalencia son lo unico que lo dicen.

const AHORA = new Date("2026-08-17T12:00:00.000Z");
/** Un rango cualquiera, pero SIEMPRE presente: esta lectura lo exige. */
const RANGO = { rango: "personalizado" as const, desde: "2026-08-10", hasta: "2026-08-16" };

function consultaDe(raw: object = {}, rol = "maestro", extra: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(
    { ...RANGO, ...raw },
    { usuarioId: "u1", rol, ...extra } as never,
    AHORA,
  );
  if (preparada.status !== "ok") throw new Error(`filtro de prueba invalido: ${preparada.status}`);
  return preparada.consulta;
}

/** El SQL de todas las condiciones unidas, tal como llega al `WHERE`. */
function sqlDe(consulta: ConsultaConteoEntregas): string {
  return condicionesDeCohorte(consulta)
    .map((c) => c.sql)
    .join(" AND ");
}

/** Los parametros, en orden. Lo que de verdad viaja: nada de esto se interpola. */
function parametrosDe(consulta: ConsultaConteoEntregas): unknown[] {
  return condicionesDeCohorte(consulta).flatMap((c) => c.values);
}

describe("R19 · el recorte por ROL es la PRIMERA condicion, siempre", () => {
  // FRONTERA MULTI-TENANT. Sin policies RLS debajo, esta condicion es la unica separacion entre
  // inquilinos: un fallo aqui no da una cifra equivocada, filtra las cohortes de una tienda a
  // otra.
  it("va en la POSICION 0, antes que cualquier faceta del cliente y antes que la ventana", () => {
    const primera = condicionesDeCohorte(
      consultaDe({ zona_id: ["z1"], tienda_id: ["u1"] }, "adminTienda"),
    )[0];

    expect(primera?.sql).toContain('o."tienda_id"');
    expect(primera?.values).toEqual(["u1"]);
  });

  // P2 de la ficha: el `adminSatelite` VE la seccion, con su alcance por zona. No se declara una
  // excepcion de permisos propia de esta tabla.
  it("adminSatelite se recorta por `zona_id` de la ORDEN, y ve la seccion", () => {
    const primera = condicionesDeCohorte(
      consultaDe({}, "adminSatelite", { zonaId: "z7" }),
    )[0];

    expect(primera?.sql).toContain('o."zona_id"');
    expect(primera?.values).toEqual(["z7"]);
  });

  it("`global` produce `TRUE`, no un hueco que rompa el AND", () => {
    expect(sqlDe(consultaDe({}, "maestro"))).toMatch(/^TRUE AND /);
  });

  it("el id del alcance viaja como parametro, no incrustado en el texto", () => {
    const consulta = consultaDe({}, "adminTienda", { usuarioId: "t-con'comilla" });

    expect(sqlDe(consulta)).not.toContain("t-con");
    expect(parametrosDe(consulta)).toContain("t-con'comilla");
  });
});

describe("R4 · universo: lo que nunca entra en una cohorte", () => {
  it("excluye las ordenes borradas", () => {
    expect(sqlDe(consultaDe())).toContain('o."deleted_at" IS NULL');
  });
});

describe("R3 · la ventana cae sobre la CARGA, y esta SIEMPRE", () => {
  // El corazon de la ficha en su mitad sin base de datos: dos condiciones sobre
  // `o."created_at"`, una con `>=` y otra con `<`. Semiabierta `[desde, hasta)`.
  it("hay exactamente dos condiciones sobre `o.created_at`, con `>=` y con `<`", () => {
    const fragmentos = condicionesDeCohorte(consultaDe()).filter((c) =>
      c.sql.includes('o."created_at"'),
    );

    expect(fragmentos).toHaveLength(2);
    expect(fragmentos[0].sql).toContain(">=");
    expect(fragmentos[1].sql).toContain("<");
    expect(fragmentos[1].sql).not.toContain("<=");
  });

  // Las COTAS son las de `resolverRango`: 00:00 hora de pared CR = `...T06:00:00.000Z`, y el
  // `hasta` es el dia SIGUIENTE al `hastaFecha` para que este sea inclusivo. Si alguien
  // cambiara las cotas por `startOfDayCR` (la medianoche UTC de la fecha CR), estos dos
  // instantes se desplazarian seis horas y este caso se pondria rojo.
  it("las cotas son las 06:00Z, y el `hasta` es el dia siguiente al pedido", () => {
    const valores = parametrosDe(consultaDe()).filter((v) => v instanceof Date) as Date[];

    expect(valores).toHaveLength(2);
    expect(valores[0].toISOString()).toBe("2026-08-10T06:00:00.000Z");
    expect(valores[1].toISOString()).toBe("2026-08-17T06:00:00.000Z");
  });

  // La ventana NO es opcional aqui, a diferencia de las otras siete lecturas de la seccion. Un
  // `rango: null` es un fallo del borde (que debe responder `sin_rango`), y dejar caer la
  // condicion en silencio volcaria la historia entera.
  it("sin rango la consulta no se construye: se dice en voz alta", () => {
    const sinRango = { ...consultaDe(), rango: null } as ConsultaConteoEntregas;

    expect(() => condicionesDeCohorte(sinRango)).toThrow(/sin_rango|EXIGE rango/);
  });
});

describe("R24 · la faceta de mensajero NO recorta esta lectura", () => {
  // Una orden no la carga un mensajero. Misma decision que la serie de cargadas por dia, y la
  // misma consecuencia declarada: con un mensajero seleccionado esta seccion NO se recorta y
  // otras si, asi que la pantalla tiene que advertirlo.
  it("con `mensajero_id` no aparece ningun `EXISTS` sobre `gestion_orden`", () => {
    const sql = sqlDe(consultaDe({ mensajero_id: ["m1"] }));

    expect(sql).not.toContain("gestion_orden");
    expect(sql).not.toContain("EXISTS");
    expect(parametrosDe(consultaDe({ mensajero_id: ["m1"] }))).not.toContain("m1");
  });

  // Anti-vacio: el caso de arriba no esta verde porque la faceta se ignore SIEMPRE. Las otras
  // cinco facetas si recortan, y se comprueba una por una.
  it("las otras cinco facetas SI recortan", () => {
    const facetas: [string, string][] = [
      ["zona_id", 'o."zona_id"'],
      ["provincia_id", 'o."provincia_id"'],
      ["canton_id", 'o."canton_id"'],
      ["distrito_id", 'o."distrito_id"'],
      ["tienda_id", 'o."tienda_id"'],
    ];

    for (const [faceta, columna] of facetas) {
      const consulta = consultaDe({ [faceta]: ["x1"] });
      expect(sqlDe(consulta), `la faceta ${faceta} no recorta`).toContain(columna);
      expect(parametrosDe(consulta)).toContain("x1");
    }
  });
});
