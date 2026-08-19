import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { quitarComentarios, quitarComentariosSql } from "@/tests/fixtures/sin-comentarios";

// GUARDIA DE LA FEATURE 239 (T3.2, R20) — `orden.gestion_aprobada` NO VUELVE.
//
// QUE ERA. Una bandera persistida, viva del 2026-08-18 al 2026-08-19, que decidia si una
// devolucion se le mostraba a su tienda en `/novedades`. El cron del SLA no la miro NUNCA: anclaba
// el reloj en la fecha de la gestion. Con el retraso medido entre gestionar y aprobar (mediana
// 8,2 h, p90 22,1 h) y la ventana `not_found` de 24 h, habia ordenes que se escalaban a
// `rechazada` y se COBRABAN sin haber sido visibles ni un minuto. Antes de esa columna la tienda
// las veia: el saldo neto fue peor que no haber hecho nada.
//
// POR QUE UNA GUARDIA Y NO SOLO EL `DROP COLUMN`. Porque el problema de esa columna no era el
// dato, era su CLASE: una marca mutable hay que apagarla a mano en cada salida del estado, y de
// las SIETE salidas de `devuelta` solo DOS lo hacian. Cualquiera puede reintroducir «un booleano
// pequeno» con la mejor intencion —y el fallo que produce es un ancla vieja sobre una devolucion
// nueva, o sea dinero cobrado antes de tiempo, en silencio—. R20 lo prohibe: la visibilidad no
// puede depender de ninguna marca persistida distinta del estado de la orden.
//
// COMO CENSA, y por que asi:
//
//  1. **En un ARCHIVO, nunca por `node -e`.** Ahi el shell se come una capa de escapado y un `\\b`
//     llega como backspace: el censo miente EN VERDE. Es un fallo ya vivido en este repo.
//  2. **Sobre el fuente SIN COMENTARIOS** (`quitarComentarios`, el quitador unico de la 209). Los
//     comentarios de este arbol NOMBRAN la columna a proposito para explicar por que se retiro;
//     censar prosa como si fuera codigo obligaria a borrar la explicacion para pasar la guardia,
//     que es exactamente al reves de lo que se quiere.
//  3. **Con frontera de palabra**, para que un identificador que la contenga como prefijo no
//     pase desapercibido ni dispare un falso positivo.
//
// QUE QUEDA FUERA DEL CENSO, y por que cada cosa:
//  - `db/migrations/`: son FOTOS HISTORICAS. La migracion que creo la columna y la que la retira
//    tienen que nombrarla; reescribirlas seria falsificar el historial de la base.
//  - `progress/` y `specs/`: bitacoras y contratos escritos en su momento. Reescribir una
//    bitacora para que no mencione lo que paso es falsificar el registro.
//  - este mismo archivo y `aprobacion-escrituras-cubiertas.guardia.test.ts`: contienen los
//    patrones de busqueda. Una allowlist sin justificacion es un agujero; esta la lleva.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "lib", "components", "hooks", "scripts", "tests", "e2e", "db"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".prisma"]);

/** Rutas (relativas al repo, con `/`) exentas del censo, cada una con su motivo. */
const EXENTOS: ReadonlyArray<{ prefijo: string; motivo: string }> = [
  {
    prefijo: "db/migrations/",
    motivo: "fotos historicas: la migracion que creo la columna y la que la retira la nombran",
  },
  {
    prefijo: "tests/unit/guards/gestion-aprobada-retirada.guardia.test.ts",
    motivo: "este archivo: contiene los patrones de busqueda",
  },
  {
    prefijo: "tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts",
    motivo: "guardia hermana: afirma que la escritura de la columna ya no existe en el repo",
  },
];

/** Las dos formas del nombre: la de TypeScript y la de la base. */
const PATRONES = [/\bgestionAprobada\b/, /\bgestion_aprobada\b/];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(full));
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function relativo(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function estaExento(rel: string): boolean {
  return EXENTOS.some((e) => rel.startsWith(e.prefijo));
}

/** Ficheros del arbol (fuera de las exenciones) cuyo CODIGO menciona la columna. */
function censar(): string[] {
  const encontrados: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(REPO_ROOT, dir))) {
      const rel = relativo(file);
      if (estaExento(rel)) continue;
      const codigo = quitarComentarios(fs.readFileSync(file, "utf8"));
      if (PATRONES.some((re) => re.test(codigo))) encontrados.push(rel);
    }
  }
  return encontrados.sort();
}

describe("239/R20 — `orden.gestion_aprobada` esta RETIRADA del arbol", () => {
  it("ningun modulo de codigo la menciona (censo sobre fuente sin comentarios)", () => {
    expect(
      censar(),
      "la visibilidad de una devolucion NO puede depender de ninguna marca persistida distinta " +
        "del estado (R20). Si hace falta una marca nueva, es una decision de producto: pasa por " +
        "la puerta, no por un booleano.",
    ).toEqual([]);
  });

  it("el censo mira de verdad: encuentra ficheros y sabe reconocer las dos formas del nombre", () => {
    // ANTI-VACUIDAD. Un censo que no recorre nada devuelve [] y pasa en verde para siempre; ya
    // paso en este repo. Se exige que el barrido vea un arbol de verdad.
    const totales = SCAN_DIRS.flatMap((d) => walk(path.join(REPO_ROOT, d)));
    expect(totales.length).toBeGreaterThan(500);
    expect(PATRONES[0].test("data: { gestionAprobada: true }")).toBe(true);
    expect(PATRONES[1].test('ALTER TABLE "orden" DROP COLUMN "gestion_aprobada"')).toBe(true);
    // Frontera de palabra: un identificador que solo la contenga como fragmento no cuenta.
    expect(PATRONES[0].test("gestionAprobadaLegacyFlag")).toBe(false);
  });

  it("el schema de Prisma no declara la columna", () => {
    const schema = fs.readFileSync(path.join(REPO_ROOT, "db", "schema.prisma"), "utf8");
    expect(quitarComentarios(schema)).not.toMatch(/\bgestionAprobada\b/);
  });

  it("la migracion que la retira existe y lleva su down (R32)", () => {
    const dir = fs
      .readdirSync(path.join(REPO_ROOT, "db", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((n) => n.endsWith("_orden_retiro_gestion_aprobada"));
    expect(dir, "falta la migracion `<ts>_orden_retiro_gestion_aprobada`").toBeDefined();
    const base = path.join(REPO_ROOT, "db", "migrations", dir as string);
    const up = fs.readFileSync(path.join(base, "migration.sql"), "utf8");
    const down = fs.readFileSync(path.join(base, "down.sql"), "utf8");
    expect(up).toMatch(/ALTER TABLE "orden" DROP COLUMN "gestion_aprobada";/);
    // El down la repone con el MISMO default con el que el codigo anterior la leia (R32).
    expect(down).toMatch(
      /ALTER TABLE "orden" ADD COLUMN IF NOT EXISTS "gestion_aprobada" boolean NOT NULL DEFAULT false;/,
    );
    // R31: ni el up ni el down mueven ordenes de estado desde SQL. Se mira el SQL SIN
    // COMENTARIOS: los dos explican por que NO hacen ese `UPDATE`, y censar la explicacion
    // obligaria a borrarla para pasar la guardia.
    for (const sql of [up, down]) {
      const sentencias = quitarComentariosSql(sql);
      expect(sentencias).not.toMatch(/UPDATE\s+"orden"/i);
      expect(sentencias).not.toMatch(/SET\s+"?estatus_id"?/i);
    }
  });
});

describe("239/R20 — AUTOCOMPROBACION: la guardia se sabe poner roja", () => {
  // Sin esto, un regex mal escrito o una allowlist demasiado ancha dejarian esta guardia en verde
  // para siempre. Este repo ya tuvo un arnes de mutaciones que reporto 9/9 supervivientes DOS
  // VECES sin haber ejecutado un test: una guardia que no se sabe romper no protege nada.
  //
  // Se prueba la MISMA funcion de deteccion que usa el censo, sobre el texto exacto que tendria
  // el arbol si alguien reintrodujera la columna.
  function detecta(fuente: string): boolean {
    const codigo = quitarComentarios(fuente);
    return PATRONES.some((re) => re.test(codigo));
  }

  it("detecta la columna reintroducida en `schema.prisma`", () => {
    const comoEnElSchema =
      '  gestionAprobada        Boolean   @default(false) @map("gestion_aprobada")';
    expect(detecta(comoEnElSchema)).toBe(true);
  });

  it("detecta el encendedor reintroducido en el repositorio de cierres", () => {
    const comoEnResolverCierre = `
      await tx.orden.updateMany({
        where: { gestiones: { some: { cierreId, resultado: "devuelta" } } },
        data: { gestionAprobada: true },
      });`;
    expect(detecta(comoEnResolverCierre)).toBe(true);
  });

  it("detecta la columna reintroducida en el predicado de novedades", () => {
    const comoEnNovedadWhere = '{ estatus: { value: ESTATUS_DEVUELTA }, gestionAprobada: true },';
    expect(detecta(comoEnNovedadWhere)).toBe(true);
  });

  it("NO ladra ante la EXPLICACION de por que se retiro (comentarios)", () => {
    // Es el falso positivo que importa: si ladrara, la unica forma de pasar la guardia seria
    // borrar el motivo — y el motivo es lo que impide que alguien la reintroduzca manana.
    const soloProsa = `
      // Feature 239 (T3.1): aqui se apagaba \`gestion_aprobada\`. La columna se retiro porque
      // recortaba la visibilidad sin mover el reloj: \`gestionAprobada\` era la mitad del fallo.
      data: { ayuda: false },`;
    expect(detecta(soloProsa)).toBe(false);
  });
});
