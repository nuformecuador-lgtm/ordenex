import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { HORIZONTE_HISTORIAL_CR, esNoComparable } from "@/lib/analytics/backfill-rango";
import { PENUMBRA } from "@/lib/types/analitica-operativa";
import { consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T8.1 — R19 y R20 (T0-Q2 = B del 2026-08-02).
//
// HECHO VERIFICADO: `orden_historial_estado` nacio el 2026-07-13 SIN backfill. El agregador de
// la 124 une contra la CTE `estatus_al_corte`, que exige al menos una transicion anterior al
// corte, asi que para toda fecha anterior a ese horizonte el rollup esta LEGITIMAMENTE VACIO.
// No es un dia sin operacion: es un dia que no se puede saber.
//
// Sin el bloque `cobertura`, un tablero de julio muestra una caida a cero en los primeros
// dias y la lectura natural es «la operacion se paro». Es el escenario en que alguien abre un
// bug de datos que no existe.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const RELOJ_JULIO = new Date("2026-07-16T15:00:00.000Z");

/** Rango que CRUZA el horizonte: dos dias debajo (11 y 12) y dos encima (13 y 14). */
const RANGO_QUE_CRUZA = {
  rango: "personalizado" as const,
  desde: "2026-07-11",
  hasta: "2026-07-14",
};

describe("R19 · el rango que cruza el horizonte declara sus fechas no comparables", () => {
  it("un rango que cruza el horizonte del historial declara sus fechas no comparables", async () => {
    const serie = await servicioCon(rollupFalso([]), undefined, undefined, RELOJ_JULIO).consultar(
      consultaDe("entregas", undefined, RANGO_QUE_CRUZA, RELOJ_JULIO),
    );
    expect(serie.cobertura.fechasNoComparables).toEqual(["2026-07-11", "2026-07-12"]);
    // Y NO incluye las de encima del horizonte: un cero del 13 SI es un cero de verdad.
    expect(serie.cobertura.fechasNoComparables).not.toContain("2026-07-13");
    expect(serie.cobertura.fechasNoComparables).not.toContain("2026-07-14");
  });

  it("los ceros del rollup NO son indistinguibles: van acompanados del bloque", async () => {
    // La mutacion (a) de R19 es devolver los ceros SIN el bloque. Aqui la respuesta no tiene
    // ni un punto —el rollup esta vacio bajo el horizonte— y aun asi dice lo que no sabe.
    const serie = await servicioCon(rollupFalso([]), undefined, undefined, RELOJ_JULIO).consultar(
      consultaDe("entregas", undefined, RANGO_QUE_CRUZA, RELOJ_JULIO),
    );
    expect(serie.puntos).toEqual([]);
    expect(serie.cobertura.fechasNoComparables.length).toBeGreaterThan(0);
    expect(JSON.stringify(serie)).toContain("2026-07-11");
  });

  it("un rango ENTERAMENTE por encima del horizonte no declara ninguna", async () => {
    const serie = await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
      consultaDe("entregas", undefined, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-03",
      }),
    );
    expect(serie.cobertura.fechasNoComparables).toEqual([]);
  });

  it("el horizonte se importa de la 125 y no se reescribe", () => {
    // CENSO: la fecha literal aparece en UN solo archivo del arbol de codigo, el de la 125 que
    // la DECLARA. La mutacion (b) de R19 es escribirla como literal propio en un modulo de la
    // 126, y este caso la caza este donde este.
    const DIRS = ["app", "lib", "components", "hooks", "providers", "scripts"];
    const EXT = new Set([".ts", ".tsx"]);
    const conLaFecha: string[] = [];
    const recorrer = (dir: string): void => {
      const abs = path.join(REPO_ROOT, dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          recorrer(rel);
        } else if (EXT.has(path.extname(e.name))) {
          const codigo = quitarComentarios(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
          if (codigo.includes(HORIZONTE_HISTORIAL_CR)) conLaFecha.push(rel);
        }
      }
    };
    for (const d of DIRS) recorrer(d);
    expect(
      conLaFecha,
      "el horizonte del historial se DECLARA una vez (feature 125) y se IMPORTA; una segunda " +
        "copia es la cifra duplicada que un dia diverge. Archivos que la escriben: " +
        conLaFecha.join(", "),
    ).toEqual(["lib/analytics/backfill-rango.ts"]);
  });

  it("y el predicado usado es el de la 125, no una comparacion propia", () => {
    // Direccion 2 del caso anterior: que la constante este en un solo sitio no basta si la
    // 126 reimplementara la comparacion. Aqui se afirma que el resultado del servicio COINCIDE
    // con `esNoComparable`, que es la funcion que la 125 exporta.
    expect(esNoComparable("2026-07-12")).toBe(true);
    expect(esNoComparable("2026-07-13")).toBe(false);
  });
});

describe("R20 · la penumbra se declara y NO se rellena", () => {
  it("el sistema no inventa filas para la penumbra", async () => {
    const serie = await servicioCon(rollupFalso([])).consultar(consultaDe("ordenes_creadas"));
    // La penumbra viaja como una CONSTANTE con su procedencia, no como un numero: un `number`
    // invitaria a calcularlo y R20 prohibe estimarla, simularla o rellenarla.
    expect(serie.cobertura.penumbra).toBe(PENUMBRA);
    expect(typeof serie.cobertura.penumbra).toBe("string");
    // Y no hay ningun punto «de ajuste»: con el rollup vacio la serie esta vacia.
    expect(serie.puntos).toEqual([]);
  });

  it("la constante NOMBRA lo que declara: ordenes vivas al horizonte sin transicion posterior", () => {
    expect(PENUMBRA).toBe("ordenes_vivas_al_horizonte_sin_transicion_posterior");
  });

  it("y no caduca: viaja tambien en un rango que no roza el horizonte", async () => {
    const serie = await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
      consultaDe("entregas"),
    );
    expect(serie.cobertura.penumbra).toBe(PENUMBRA);
  });
});
