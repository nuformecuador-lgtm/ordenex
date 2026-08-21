import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// GUARDIA DE LA FEATURE 238 (T3.6, R21) — LA MARCA NACE SIN LECTORES, Y SIGUE SIN ELLOS.
//
// R21 dice que de `confirmada_fisica_at` NO se deriva ningun plazo, vencimiento, importe ni orden
// de prelacion: su unico significado es «el paquete se confirmo». Sin una guardia, eso es una
// intencion escrita en un comentario que la primera pantalla que necesite «cuanto tardo bodega en
// confirmar» se salta sin que nada falle.
//
// Y NO ES CELO. Esta columna es una FECHA dentro de una feature —la 239— cuyo fallo original fue
// exactamente ese: derivar un reloj de una fecha que no significaba lo que parecia
// (`cierre_dia.resuelto_at` se escribe IGUAL al rechazar, y `forzarSolicitudVencido` reabre sin
// limpiarla). `confirmada_fisica_at` coincide con `resuelto_at` de la misma transaccion, asi que
// cualquier resta de fechas sobre ella produciria un numero plausible y sin significado. Un
// numero plausible es peor que ninguno.
//
// Mismo idioma que `gestion-ubicacion-solo-escritura.guardia.test.ts` (193): registro explicito
// contrastado contra el arbol en los DOS sentidos —ni menciones sin registrar, ni registros que
// sobren—, mas un frente propio contra la ARITMETICA DE FECHAS.
//
// AUTOCOMPROBACION (obligatoria, `docs/verification.md`): el ultimo bloque demuestra que los dos
// detectores se ponen rojos ante una lectura y ante una resta plantadas.

const RAIZ = path.resolve(__dirname, "../../..");

/** Los dos nombres de la columna: camelCase (Prisma) y snake_case (SQL). */
const NOMBRES = ["confirmadaFisicaAt", "confirmada_fisica_at"];

/**
 * Donde SI puede aparecer, con el motivo. Cualquier archivo de produccion fuera de esta lista que
 * la nombre es un hallazgo: o es una LECTURA nueva —y R21 dice que en este ciclo no se deriva
 * nada de ella, asi que se abre como decision y no como cambio de paso—, o es un sitio nuevo de
 * escritura que merece revisarse.
 */
const PERMITIDOS: Record<string, string> = {
  "db/schema.prisma": "declaracion del modelo",
  "lib/repositories/CierresAdminRepository.ts":
    "LA UNICA escritura: el bloque dentro de la transaccion de aprobacion",
};

/** Arboles de PRODUCCION que se recorren. `tests/` queda fuera: un test PUEDE nombrarla. */
const ARBOLES = ["lib", "app", "components", "hooks", "db"];

function* archivos(dir: string): Generator<string> {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "migrations") continue;
      yield* archivos(completo);
    } else if (/\.(ts|tsx|prisma)$/.test(e.name)) {
      yield completo;
    }
  }
}

function relativo(absoluto: string): string {
  return path.relative(RAIZ, absoluto).split(path.sep).join("/");
}

/**
 * ¿Este codigo hace ARITMETICA DE FECHAS con la marca? Se busca la columna a menos de una linea
 * de una resta, un `getTime`, un `diff`, un `Date.now`, un `add`/`sub` de fecha o una comparacion
 * de orden (`<`, `>`), que es la forma que tendria un plazo derivado de aqui.
 *
 * Se escribe EN UN ARCHIVO DE TEST y nunca por `node -e`: alli el `\b` de un regex llega como
 * backspace y el censo miente en verde.
 */
export function derivaTiempoDeLaMarca(fuente: string): boolean {
  const lineas = fuente.split("\n");
  const RELOJ = /getTime\(\)|Date\.now\(\)|differenceIn|\bdiff\b|addDays|addHours|subDays|[-<>]=?\s*$|^\s*[-<>]/;
  for (let i = 0; i < lineas.length; i += 1) {
    if (!NOMBRES.some((n) => lineas[i].includes(n))) continue;
    // La propia linea y la siguiente: una resta partida por el formateador cabe en dos.
    const ventana = `${lineas[i]}\n${lineas[i + 1] ?? ""}`;
    const sinComentario = ventana.replace(/\/\/.*$/gm, "");
    if (!NOMBRES.some((n) => sinComentario.includes(n))) continue;
    for (const nombre of NOMBRES) {
      const idx = sinComentario.indexOf(nombre);
      if (idx === -1) continue;
      const cola = sinComentario.slice(idx + nombre.length, idx + nombre.length + 80);
      if (RELOJ.test(cola)) return true;
    }
  }
  return false;
}

const mencionan = new Set<string>();
for (const arbol of ARBOLES) {
  for (const archivo of archivos(path.join(RAIZ, arbol))) {
    const contenido = readFileSync(archivo, "utf8");
    if (NOMBRES.some((n) => contenido.includes(n))) mencionan.add(relativo(archivo));
  }
}

describe("Feature 238 (R21) — `confirmada_fisica_at` no tiene lectores", () => {
  it("AUTOCOMPROBACION del censo: encuentra al menos el modelo y la escritura", () => {
    // Sin esto, un recorrido roto daria cero hallazgos y la guardia pasaria en verde sin haber
    // mirado un solo archivo.
    expect(mencionan.has("db/schema.prisma")).toBe(true);
    expect(mencionan.has("lib/repositories/CierresAdminRepository.ts")).toBe(true);
  });

  it("ningun archivo de produccion fuera del registro la nombra", () => {
    const intrusos = [...mencionan].filter((r) => !(r in PERMITIDOS)).sort();
    expect(
      intrusos,
      "Estos archivos nombran `confirmada_fisica_at` y no estan en el registro.\n" +
        "Si es una LECTURA nueva: R21 dice que de esta marca no se deriva ningun plazo,\n" +
        "vencimiento ni importe —abrila como decision, no como cambio de paso—. Si es una\n" +
        "escritura legitima, anadila arriba con su motivo.",
    ).toEqual([]);
  });

  it("el registro no tiene entradas muertas", () => {
    const muertas = Object.keys(PERMITIDOS)
      .filter((r) => !mencionan.has(r))
      .sort();
    expect(muertas).toEqual([]);
  });

  it("ningun repositorio la PROYECTA en un select", () => {
    // La escritura vive en `resolverCierre`. Un `select` que la nombre en cualquier repositorio
    // seria el primer paso para que acabe en un DTO, de ahi en una respuesta y de ahi en una
    // derivacion. Ese camino no se recorre por accidente: se decide.
    const repos = [...archivos(path.join(RAIZ, "lib", "repositories"))].map(relativo);
    const conProyeccion = repos.filter((r) => {
      const fuente = readFileSync(path.join(RAIZ, r), "utf8");
      return /confirmadaFisicaAt:\s*true/.test(fuente);
    });
    expect(conProyeccion).toEqual([]);
  });

  it("nadie hace ARITMETICA DE FECHAS con ella", () => {
    const conReloj = [...mencionan].filter((r) =>
      derivaTiempoDeLaMarca(readFileSync(path.join(RAIZ, r), "utf8")),
    );
    expect(
      conReloj,
      "R21: esta marca NO es un reloj. Coincide con `cierre_dia.resuelto_at` de la misma\n" +
        "transaccion, asi que cualquier resta sobre ella da un numero plausible y sin significado.",
    ).toEqual([]);
  });
});

describe("Feature 238 — AUTOCOMPROBACION: los detectores se saben romper", () => {
  it("el detector de reloj se pone ROJO ante una resta plantada", () => {
    expect(
      derivaTiempoDeLaMarca(`const horas = gestion.confirmadaFisicaAt.getTime() - inicio;`),
    ).toBe(true);
    expect(
      derivaTiempoDeLaMarca(`const vencida = fila.confirmada_fisica_at < limite;`),
    ).toBe(true);
    // Tambien si el formateador parte la expresion en dos lineas.
    expect(
      derivaTiempoDeLaMarca(`
        const atraso =
          Date.now() - gestion.confirmadaFisicaAt.getTime();
      `),
    ).toBe(true);
  });

  it("NO ladra ante la ESCRITURA, que es lo unico permitido", () => {
    expect(derivaTiempoDeLaMarca(`data: { confirmadaFisicaAt: new Date() },`)).toBe(false);
    expect(
      derivaTiempoDeLaMarca(`confirmadaFisicaAt   DateTime? @map("confirmada_fisica_at")`),
    ).toBe(false);
  });

  it("NO ladra ante un comentario que EXPLIQUE por que no se resta", () => {
    // Nombrar lo prohibido es lo que deja el motivo escrito junto al codigo, y no puede costar
    // la guardia.
    expect(
      derivaTiempoDeLaMarca(
        `// R21: nada deriva de confirmadaFisicaAt - resueltoAt; no es un reloj.`,
      ),
    ).toBe(false);
  });
});
