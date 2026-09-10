import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { MARCADOR_FALLO_CONFIG_GEOCODE } from "@/lib/geo/fallo-config-geocode";

/**
 * FICHA 400 (T5, R13/R27/R30) — GUARDIA: EL MARCADOR SE DECLARA UNA SOLA VEZ, Y LAS DOS
 * PUNTAS LO IMPORTAN DE AHI.
 *
 * POR QUE ESTE GUARDIA EXISTE. El marcador tiene dos puntas: `GeocodificacionService` lo
 * ESCRIBE (en el `message` del error, que la cola persiste en `jobs.last_error`) y
 * `AsignabilidadCoordenadasService` lo LEE. Si alguien copiara el literal en una de las dos
 * en vez de importarlo, el dia que el prefijo cambie las dos se desincronizarian y el fallo
 * seria MUDO: el gate simplemente dejaria de reconocer el caso, volveriamos al bug del
 * 2026-09-08 (42 ordenes bloqueadas 19 horas) y NINGUN test se pondria rojo — porque cada
 * punta seguiria siendo coherente consigo misma.
 *
 * Lee el ARBOL REAL, no una copia de su texto: un `grep` de este mismo archivo citando el
 * literal pasaria por casualidad; recorrer los archivos no. Y este guardia NO escribe el
 * literal: lo IMPORTA, para no ser el mismo el primer infractor.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** El unico archivo que puede DECLARAR el literal. */
const MODULO_DEL_MARCADOR = "lib/geo/fallo-config-geocode.ts";

/**
 * El unico TEST que puede escribirlo a mano: el de R14 lo afirma como literal escrito a
 * mano a proposito (comparar la constante consigo misma estaria verde para siempre).
 */
const TEST_QUE_LO_AFIRMA_A_MANO = "tests/unit/geo/fallo-config-geocode.test.ts";

const GATE = "lib/services/AsignabilidadCoordenadasService.ts";
const EMISOR = "lib/services/GeocodificacionService.ts";
const CONTRATO_JOBS = "lib/interfaces/repositories/IJobRepository.ts";
const MODULO_IMPORTABLE = "@/lib/geo/fallo-config-geocode";

const EXTENSIONES = [".ts", ".tsx"];

function archivosDe(relativo: string): string[] {
  const absoluto = path.join(RAIZ, relativo);
  const salida: string[] = [];
  const pila = [absoluto];
  while (pila.length > 0) {
    const actual = pila.pop() as string;
    for (const entrada of readdirSync(actual)) {
      if (entrada === "node_modules" || entrada === ".next") continue;
      const completo = path.join(actual, entrada);
      if (statSync(completo).isDirectory()) {
        pila.push(completo);
        continue;
      }
      if (EXTENSIONES.includes(path.extname(entrada))) {
        salida.push(path.relative(RAIZ, completo).split(path.sep).join("/"));
      }
    }
  }
  return salida;
}

function leer(rutaRelativa: string): string {
  return readFileSync(path.join(RAIZ, rutaRelativa), "utf8");
}

/** Archivos (de los dados) cuyo texto contiene el literal del marcador. */
function losQueCitanElLiteral(rutas: string[]): string[] {
  return rutas.filter((r) => leer(r).includes(MARCADOR_FALLO_CONFIG_GEOCODE)).sort();
}

/**
 * El modulo del que un archivo importa un nombre, o `null`. Exige que el nombre viaje
 * DENTRO de las llaves de un `import { ... } from "...";` — una mencion en un comentario no
 * cuenta como import real. (Mismo detector que el guardia de la 368.)
 */
function moduloDeImport(codigo: string, nombreImportado: string): string | null {
  const patron = new RegExp(
    `import\\s*(?:type\\s*)?\\{[^}]*\\b${nombreImportado}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`,
  );
  const match = codigo.match(patron);
  return match ? match[1]! : null;
}

describe("400/T5 — el literal del marcador se declara en UN solo archivo", () => {
  it("en `lib/`, `app/` y `scripts/` el literal aparece SOLO en su modulo", () => {
    const fuentes = [...archivosDe("lib"), ...archivosDe("app"), ...archivosDe("scripts")];
    // No-vacuidad: si el barrido no encontrara archivos, todo lo de abajo pasaria por vacio.
    expect(fuentes.length).toBeGreaterThan(100);

    expect(losQueCitanElLiteral(fuentes)).toEqual([MODULO_DEL_MARCADOR]);
  });

  it("y en `tests/` solo lo escribe a mano el test de R14", () => {
    const enTests = losQueCitanElLiteral(archivosDe("tests"));
    expect(enTests).toEqual([TEST_QUE_LO_AFIRMA_A_MANO]);
  });

  it("CONTRAPRUEBA: el detector SI caza un literal copiado en otro archivo", () => {
    const copiado = `const MARCADOR_LOCAL = "${MARCADOR_FALLO_CONFIG_GEOCODE}";`;
    expect(copiado.includes(MARCADOR_FALLO_CONFIG_GEOCODE)).toBe(true);

    // Y la mitad que demuestra que no caza cualquier cosa:
    const inocente = `const OTRO = "[geocode:otra-cosa]";`;
    expect(inocente.includes(MARCADOR_FALLO_CONFIG_GEOCODE)).toBe(false);
  });
});

describe("400/T5 — las dos puntas IMPORTAN el marcador de ese modulo", () => {
  it("`GeocodificacionService` (quien lo escribe) importa `marcarFalloConfigGeocode` de ahi", () => {
    expect(moduloDeImport(leer(EMISOR), "marcarFalloConfigGeocode")).toBe(MODULO_IMPORTABLE);
  });

  it("`AsignabilidadCoordenadasService` (quien lo lee) importa `esFalloConfigGeocode` de ahi", () => {
    expect(moduloDeImport(leer(GATE), "esFalloConfigGeocode")).toBe(MODULO_IMPORTABLE);
  });

  it("los dos lo traen del MISMO modulo — ninguno de una copia local", () => {
    const deEmisor = moduloDeImport(leer(EMISOR), "marcarFalloConfigGeocode");
    const deGate = moduloDeImport(leer(GATE), "esFalloConfigGeocode");
    expect(deEmisor).not.toBeNull();
    expect(deGate).not.toBeNull();
    expect(deEmisor).toBe(deGate);
  });

  it("CONTRAPRUEBA: el detector caza un import desde OTRO modulo", () => {
    const ajeno = `import { esFalloConfigGeocode } from "./copia-local";`;
    expect(moduloDeImport(ajeno, "esFalloConfigGeocode")).toBe("./copia-local");
    expect(moduloDeImport(ajeno, "esFalloConfigGeocode")).not.toBe(MODULO_IMPORTABLE);
  });

  it("CONTRAPRUEBA: devuelve `null` cuando la funcion no se importa en absoluto", () => {
    const sinImport = `const x = 1;\n// esFalloConfigGeocode se menciona pero no se importa`;
    expect(moduloDeImport(sinImport, "esFalloConfigGeocode")).toBeNull();
  });
});

describe("400/T5 — R27: la ficha NO cambia el contrato de la cola", () => {
  it("`JobDTO` sigue exponiendo `lastError` (el dato del que vive todo el arreglo)", () => {
    expect(leer(CONTRATO_JOBS)).toMatch(/lastError:\s*string\s*\|\s*null;/);
  });

  it("`JobDTO` tiene EXACTAMENTE los campos de siempre: la 400 no anadio ninguno", () => {
    const fuente = leer(CONTRATO_JOBS);
    const bloque = fuente.slice(
      fuente.indexOf("export interface JobDTO {"),
      fuente.indexOf("/** Opciones del encolado"),
    );
    expect(bloque.length).toBeGreaterThan(0); // no-vacuidad del recorte

    const campos = [...bloque.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]!);
    // Lista literal a proposito: es el contrato. Si la 400 hubiera anadido un
    // `errorCodigo`/`causa`, esto se pone rojo (que es justo lo que R27 prohibe).
    expect(campos).toEqual([
      "id",
      "tipo",
      "payload",
      "estado",
      "intentos",
      "maxIntentos",
      "runAfter",
      "lockedAt",
      "lastError",
      "dedupeKey",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("el contrato de la cola NO conoce el vocabulario de la geocodificacion", () => {
    // La cola es generica: si empezara a importar el marcador, el acoplamiento iria en la
    // direccion equivocada (design §3).
    const fuente = leer(CONTRATO_JOBS);
    expect(fuente).not.toContain("fallo-config-geocode");
    expect(fuente).not.toContain(MARCADOR_FALLO_CONFIG_GEOCODE);
  });
});

describe("400/T5 — R30: la cabecera NORMATIVA del gate declara la regla vigente, con su fecha", () => {
  it("el arbol de decision documentado incluye el paso nuevo y su desenlace", () => {
    const cabecera = leer(GATE).slice(0, leer(GATE).indexOf("import "));
    expect(cabecera).toContain("asignable_sin_ubicacion");
    expect(cabecera).toContain("FEATURE 400");
    expect(cabecera).toContain("2026-09-09");
  });

  it("ningun comentario del gate sigue afirmando que `failed` basta para clasificar `geocodificacion_agotada`", () => {
    // R30: el parrafo historico sobre «intentos agotados ⇔ failed» puede quedarse —sigue
    // siendo cierto sobre el ESTADO— pero tiene que llevar el matiz de esta ficha al lado.
    const cabecera = leer(GATE).slice(0, leer(GATE).indexOf("import "));
    expect(cabecera).toContain("YA NO es suficiente para clasificar");
  });

  it("el docstring de `esAsignable` ya no dice que `asignable` es el UNICO que deja pasar", () => {
    const fuente = leer(GATE);
    const bloque = fuente.slice(fuente.indexOf("export function esAsignable") - 1400);
    expect(bloque).toContain("asignable_sin_ubicacion");
    expect(bloque).toContain("FEATURE 400");
    // La contraprueba de la afirmacion caducada: el texto viejo, tal cual, ya no puede
    // aparecer como afirmacion vigente sin el «Hasta esta ficha» que lo fecha.
    const indiceViejo = bloque.indexOf("es el UNICO estado que deja pasar");
    if (indiceViejo !== -1) {
      expect(bloque.slice(0, indiceViejo)).toContain("Hasta esta ficha");
    }
  });
});
