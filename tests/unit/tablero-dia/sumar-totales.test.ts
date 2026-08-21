import { describe, expect, it } from "vitest";

import type { FilaTableroDia, TotalesTableroDia } from "@/lib/types/tablero-dia";
import { sumarTotalesTablero } from "@/lib/types/tablero-dia";

import { arbolDeLaFeature, type ArchivoDeLaFeature } from "./_arbol-de-la-feature";

// Feature 258 (B4.4) — R3, R43, R65.
//
// `sumarTotalesTablero` es LA UNICA suma de los ocho contadores del arbol. Vivia dentro de
// `TableroDiaService` y se movio a `lib/types/tablero-dia.ts` porque ahora la consumen DOS
// sitios: el servicio (totales del dia) y el modulo de cliente (totales de lo filtrado, R43).
//
// Lo que hay que demostrar no es que sume bien un caso: es que la IDENTIDAD de los ocho
// sumandos se cumpla sobre CUALQUIER SUBCONJUNTO de filas. Es exactamente eso lo que hace
// legitimo recalcular los totales sobre las tarjetas visibles cuando hay filtro: si la
// identidad solo valiera para el conjunto completo, el bloque filtrado mentiria.

const CLAVES = [
  "entregadas",
  "reprogramadas",
  "devueltas",
  "rechazadas",
  "incidentes",
  "sinRecoger",
  "enReparto",
  "otros",
] as const satisfies readonly (keyof TotalesTableroDia)[];

function sumaDeLosOcho(t: TotalesTableroDia): number {
  return CLAVES.reduce((acc, clave) => acc + t[clave], 0);
}

/** Una fila coherente: `asignadas` es la suma de sus ocho, como la produce el repositorio. */
function fila(mensajeroId: string, parciales: Partial<TotalesTableroDia> = {}): FilaTableroDia {
  const ocho = {
    entregadas: 0,
    reprogramadas: 0,
    devueltas: 0,
    rechazadas: 0,
    incidentes: 0,
    sinRecoger: 0,
    enReparto: 0,
    otros: 0,
    ...parciales,
  };
  return {
    mensajeroId,
    mensajeroNombre: `Mensajero ${mensajeroId}`,
    asignadas: sumaDeLosOcho({ ...ocho, asignadas: 0 }),
    ...ocho,
  };
}

const POBLACION: readonly FilaTableroDia[] = [
  fila("m1", { entregadas: 7, sinRecoger: 2, otros: 1 }),
  fila("m2", { reprogramadas: 3, devueltas: 1, enReparto: 5 }),
  fila("m3", { rechazadas: 2, incidentes: 4 }),
  fila("m4", { entregadas: 11, reprogramadas: 1, incidentes: 1, enReparto: 2, otros: 3 }),
  fila("m5"),
];

/** Los 32 subconjuntos de las cinco filas, incluido el vacio y el completo. */
function subconjuntos(filas: readonly FilaTableroDia[]): (readonly FilaTableroDia[])[] {
  const salida: FilaTableroDia[][] = [];
  for (let mascara = 0; mascara < 1 << filas.length; mascara += 1) {
    salida.push(filas.filter((_, i) => (mascara & (1 << i)) !== 0));
  }
  return salida;
}

describe("sumarTotalesTablero — la identidad de los ocho sumandos (R3/R65)", () => {
  it("se cumple sobre TODOS los subconjuntos de filas, no solo sobre el conjunto completo", () => {
    const todos = subconjuntos(POBLACION);
    // Si esto fuera 1 o 2, el test seria verde por vacio.
    expect(todos).toHaveLength(32);

    for (const subconjunto of todos) {
      const totales = sumarTotalesTablero(subconjunto);
      expect(
        totales.asignadas,
        `la identidad se rompe con [${subconjunto.map((f) => f.mensajeroId).join(", ")}]`,
      ).toBe(sumaDeLosOcho(totales));
    }
  });

  it("cada contador del total es la suma de ese contador en las filas que entran", () => {
    const subconjunto = [POBLACION[0], POBLACION[3]];
    const totales = sumarTotalesTablero(subconjunto);

    for (const clave of CLAVES) {
      expect(totales[clave], clave).toBe(subconjunto.reduce((acc, f) => acc + f[clave], 0));
    }
    expect(totales.asignadas).toBe(POBLACION[0].asignadas + POBLACION[3].asignadas);
  });

  it("el conjunto VACIO da los nueve campos a cero, no un objeto incompleto", () => {
    const totales = sumarTotalesTablero([]);

    expect(totales).toEqual({
      asignadas: 0,
      entregadas: 0,
      reprogramadas: 0,
      devueltas: 0,
      rechazadas: 0,
      incidentes: 0,
      sinRecoger: 0,
      enReparto: 0,
      otros: 0,
    });
  });

  it("no muta las filas que recibe: recalcular con filtro no puede tocar el dato original", () => {
    const antes = JSON.stringify(POBLACION);
    sumarTotalesTablero(POBLACION);
    expect(JSON.stringify(POBLACION)).toBe(antes);
  });

  it("sumar el todo es sumar las partes: el filtro nunca puede inventar ni perder ordenes", () => {
    const izquierda = POBLACION.slice(0, 2);
    const derecha = POBLACION.slice(2);
    const total = sumarTotalesTablero(POBLACION);
    const porPartes = sumarTotalesTablero([...izquierda, ...derecha]);

    expect(porPartes).toEqual(total);
    for (const clave of CLAVES) {
      expect(sumarTotalesTablero(izquierda)[clave] + sumarTotalesTablero(derecha)[clave]).toBe(
        total[clave],
      );
    }
  });
});

describe("R65 · hay UNA sola implementacion de la suma en el arbol", () => {
  const ARBOL: readonly ArchivoDeLaFeature[] = arbolDeLaFeature();

  it("`sumarTotalesTablero` se DECLARA exactamente una vez, y en el modulo de contrato", () => {
    const declaradores = ARBOL.filter(({ codigo }) =>
      /export function sumarTotalesTablero\b/.test(codigo),
    ).map(({ ruta }) => ruta);

    expect(
      declaradores,
      "R65: dos implementaciones de esta suma son dos identidades de ocho sumandos distintas, " +
        "y pueden divergir sin que ningun test lo note. Vive en `lib/types/tablero-dia.ts` " +
        "porque el modulo de cliente que recalcula los totales filtrados no puede importar el " +
        "servicio sin arrastrarse `lib/analytics/alcance` y el adaptador de cache al navegador.",
    ).toEqual(["lib/types/tablero-dia.ts"]);
  });

  it("`TableroDiaService` ya no declara su propia suma: la CONSUME del contrato", () => {
    const servicio = ARBOL.find(({ ruta }) => ruta === "lib/services/TableroDiaService.ts");
    if (servicio === undefined) throw new Error("falta el servicio en el arbol censado");

    expect(servicio.codigo).not.toMatch(/function sumarTotales\b/);
    expect(servicio.codigo).not.toMatch(/reduce<\s*TotalesTableroDia\s*>/);
    expect(servicio.codigo).toMatch(/sumarTotalesTablero/);
    expect(servicio.codigo).toMatch(
      /import\s*\{\s*sumarTotalesTablero\s*\}\s*from\s*"@\/lib\/types\/tablero-dia"/,
    );
  });

  it("el modulo de contrato sigue siendo importable desde un Client Component", () => {
    const tipos = ARBOL.find(({ ruta }) => ruta === "lib/types/tablero-dia.ts");
    if (tipos === undefined) throw new Error("falta el modulo de tipos en el arbol censado");

    // Si ganara cualquiera de estos imports, el recalculo de los totales filtrados (R43)
    // dejaria de ser posible en el navegador y la unica salida seria duplicar la suma.
    expect(tipos.codigo).not.toMatch(/from\s*["'][^"']*\/repositories\//);
    expect(tipos.codigo).not.toMatch(/from\s*["'][^"']*\/services\//);
    expect(tipos.codigo).not.toMatch(/from\s*["']@\/lib\/db/);
    expect(tipos.codigo).not.toMatch(/from\s*["']next\/headers["']/);
  });

  it("el censo NO es vacio: el detector marca la declaracion REAL", () => {
    expect(ARBOL.length).toBeGreaterThan(10);
    expect(/export function sumarTotalesTablero\b/.test("export function sumarTotalesTablero(")).toBe(
      true,
    );
    expect(/function sumarTotales\b/.test("function sumarTotales(filas) {")).toBe(true);
    expect(/function sumarTotales\b/.test("sumarTotalesTablero(filas)")).toBe(false);
  });
});
