import { describe, it, expect } from "vitest";
import { whereGestionOrden, whereOrden, whereRollup } from "@/lib/analytics/alcance-columnas";
import type { AlcanceDatos } from "@/lib/analytics/alcance";

// Feature 122 / T3.1 — R23 y R24: traduccion del alcance a fragmento de `where`.
//
// R24 es el caso delicado: `gestion_orden` TIENE una columna `mensajero_id` NOT NULL a
// mano, y usarla seria lo comodo. D3 lo prohibe: la unica fuente de verdad del mensajero
// de una orden es `orden.mensajero_asignado_id`, asi que los TRES recortes de gestiones
// pasan por la relacion `orden`.

const ALCANCES: readonly AlcanceDatos[] = [
  { tipo: "global" },
  { tipo: "zona", zonaId: "z1" },
  { tipo: "tienda", tiendaId: "t1" },
  { tipo: "mensajero", mensajeroId: "m1" },
];

describe("R23 · adaptador de `orden`", () => {
  it("traduce los cuatro tipos de alcance a las tres columnas canonicas de orden", () => {
    expect(whereOrden({ tipo: "global" })).toEqual({});
    expect(whereOrden({ tipo: "zona", zonaId: "z1" })).toEqual({ zonaId: "z1" });
    expect(whereOrden({ tipo: "tienda", tiendaId: "t1" })).toEqual({ tiendaId: "t1" });
    expect(whereOrden({ tipo: "mensajero", mensajeroId: "m1" })).toEqual({
      mensajeroAsignadoId: "m1",
    });
  });

  it("el fragmento de global es vacio: no inventa condiciones", () => {
    expect(Object.keys(whereOrden({ tipo: "global" }))).toEqual([]);
  });
});

describe("R23 · adaptador del rollup analytics_daily", () => {
  it("traduce zona y tienda con el mismo vocabulario que orden", () => {
    expect(whereRollup({ tipo: "global" })).toEqual({});
    expect(whereRollup({ tipo: "zona", zonaId: "z1" })).toEqual({ zonaId: "z1" });
    expect(whereRollup({ tipo: "tienda", tiendaId: "t1" })).toEqual({ tiendaId: "t1" });
  });

  // Feature 126 / T2.2 — R21. EL caso discriminante de la correccion de D3.
  //
  // La 122 escribio `mensajeroAsignadoId` (la columna de `orden`) cuando el rollup aun no
  // existia, y el retorno tipado `Record<string, string>` impedia que el compilador lo
  // viera: el fragmento nombraba una columna INEXISTENTE en la tabla que pretende recortar.
  // Con `Prisma.AnalyticsDailyWhereInput` revertirlo ya no compila; este caso lo afirma
  // ademas en runtime, para que el rojo sea legible y no solo un error de build.
  //
  // Es tambien la asercion POSITIVA que compensa la excepcion documentada en el barrido de
  // `R24 · adaptador de gestion_orden`: alli `whereRollup` queda fuera del censo de
  // `mensajeroId` porque `analytics_daily` TIENE esa columna propia
  // (`db/schema.prisma:1863`); aqui se exige que la nombre, y que no nombre nunca la de
  // `orden` en ninguno de los cuatro alcances.
  it("whereRollup nombra la columna del rollup, no la de orden", () => {
    const fragmento = whereRollup({ tipo: "mensajero", mensajeroId: "m1" });
    expect(fragmento).toEqual({ mensajeroId: "m1" });
    expect(Object.keys(fragmento)).toContain("mensajeroId");
    expect(Object.keys(fragmento)).not.toContain("mensajeroAsignadoId");
    for (const alcance of ALCANCES) {
      expect(Object.keys(whereRollup(alcance)), JSON.stringify(alcance)).not.toContain(
        "mensajeroAsignadoId",
      );
    }
  });

  // R22 — el recorte del mensajero es un id ESCALAR: nunca `{ in: [id, null] }` ni un `OR`
  // que rescate el cubo sin asignar «para que cuadre el total». Una orden sin mensajero no
  // es propia de nadie (R28 de la 122).
  it("el recorte por mensajero no abre la puerta al cubo sin asignar", () => {
    expect(whereRollup({ tipo: "mensajero", mensajeroId: "m1" })).toEqual({ mensajeroId: "m1" });
    expect(JSON.stringify(whereRollup({ tipo: "mensajero", mensajeroId: "m1" }))).not.toContain(
      "null",
    );
  });
});

describe("R24 · adaptador de gestion_orden: SIEMPRE por la relacion orden", () => {
  it("recorta zona, tienda Y mensajero a traves de la relacion orden", () => {
    expect(whereGestionOrden({ tipo: "zona", zonaId: "z1" })).toEqual({ orden: { zonaId: "z1" } });
    expect(whereGestionOrden({ tipo: "tienda", tiendaId: "t1" })).toEqual({
      orden: { tiendaId: "t1" },
    });
    expect(whereGestionOrden({ tipo: "mensajero", mensajeroId: "m1" })).toEqual({
      orden: { mensajeroAsignadoId: "m1" },
    });
  });

  it("nunca recorta por gestion_orden.mensajeroId, aunque exista y sea NOT NULL (D3)", () => {
    for (const alcance of ALCANCES) {
      const fragmento = whereGestionOrden(alcance);
      expect(Object.keys(fragmento), JSON.stringify(alcance)).not.toContain("mensajeroId");
      expect(Object.keys(fragmento), JSON.stringify(alcance)).not.toContain("mensajero");
    }
  });

  // El barrido cubre los adaptadores de las tablas del DOMINIO (`orden` y `gestion_orden`),
  // que es lo que este describe protege: ninguna de las dos debe recortarse por una columna
  // `mensajeroId` propia. Para `orden` la columna se llama `mensajeroAsignadoId`; para
  // `gestion_orden` la columna `mensajero_id` SI existe (`db/schema.prisma:651`) y usarla
  // seria justamente el recorte equivocado que D3 prohibe.
  //
  // EXCEPCION DELIBERADA — `whereRollup` NO entra en este barrido, y el motivo es factual,
  // no una relajacion: la tabla `analytics_daily` (feature 124) tiene una columna PROPIA
  // llamada `mensajero_id` (`db/schema.prisma:1863`, indice
  // `analytics_daily_mensajero_fecha_idx`), que es la coordenada del cubo y la unica forma
  // correcta de recortarla. Cuando la 122 escribio este barrido esa tabla no existia, asi
  // que la creencia «ninguna tabla tiene columna propia con ese nombre» era cierta; hoy es
  // falsa. `whereRollup` queda cubierto por su propia asercion POSITIVA, justo debajo.
  it("ningun fragmento de las tablas de dominio nombra mensajeroId fuera de la relacion orden", () => {
    for (const alcance of ALCANCES) {
      for (const fragmento of [whereOrden(alcance), whereGestionOrden(alcance)]) {
        expect(clavesPropias(fragmento), JSON.stringify(alcance)).not.toContain("mensajeroId");
      }
    }
  });

  // La contrapartida POSITIVA de esa excepcion (whereRollup DEBE nombrar `mensajeroId` y
  // NUNCA `mensajeroAsignadoId`) vive en el caso «whereRollup nombra la columna del rollup,
  // no la de orden» del describe del rollup, mas arriba: si alguien "restaurara" el barrido
  // sobre `whereRollup`, ese caso queda rojo y explica por que.

  it("el fragmento de global es vacio tambien en gestion_orden", () => {
    expect(whereGestionOrden({ tipo: "global" })).toEqual({});
  });
});

/** Claves del primer nivel: lo que el motor aplicaria sobre la propia tabla. */
function clavesPropias(fragmento: object): string[] {
  return Object.keys(fragmento);
}
