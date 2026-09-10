import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * FICHA 401 (T14, R1/R33/R35) — GUARDIA DE ALCANCE SOBRE EL ÁRBOL REAL.
 *
 * Tres cosas que ningún test de comportamiento puede afirmar, y que si se rompieran lo harían EN
 * SILENCIO:
 *
 *  1. **R1 — un solo mecanismo de detección.** La tentación reaparece en SQL: un
 *     `LIKE '%REQUEST_DENIED%'` es más corto que importar el marcador de la 400. Ata el predicado
 *     a la redacción de un mensaje escrito para humanos, y el primer cambio de copy lo rompe sin
 *     un solo test rojo. Además duplicaría el mecanismo que R1 exige que sea único.
 *  2. **R33 — esta ficha LEE el marcador, nunca lo escribe.** Producirlo es de la 400. Si un
 *     archivo de la 401 llamara a `marcarFalloConfigGeocode`, habría dos productores y el que
 *     manda dejaría de estar claro.
 *  3. **R35 — el contrato genérico de la cola no crece.** `IJobRepository` sirve a las features
 *     90/91/92/99; esta ficha abrió su propio repositorio estrecho precisamente para no tocarlo.
 *
 * Lee el ÁRBOL, no una copia de su texto, y cada afirmación trae su CONTRAPRUEBA: un detector que
 * no sabe ponerse rojo no protege nada.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** Los archivos de PRODUCCIÓN que esta ficha crea o toca. */
const ARCHIVOS_DE_LA_FICHA = [
  "lib/config/geocode-salud.ts",
  "lib/interfaces/repositories/IGeocodeSaludRepository.ts",
  "lib/interfaces/services/IGeocodeSaludService.ts",
  "lib/repositories/GeocodeSaludRepository.ts",
  "lib/services/GeocodeSaludService.ts",
  "lib/services/jobs/geocodificacion-handler.ts",
];

const CONTRATO_JOBS = "lib/interfaces/repositories/IJobRepository.ts";
const MODULO_DEL_MARCADOR = "lib/geo/fallo-config-geocode.ts";

function leer(rutaRelativa: string): string {
  return readFileSync(path.join(RAIZ, rutaRelativa), "utf8");
}

/** El código EJECUTABLE: sin comentarios de línea ni de bloque. Los predicados viven aquí. */
function ejecutableDe(fuente: string): string {
  const salida: string[] = [];
  let dentroDeBloque = false;
  for (const linea of fuente.split("\n")) {
    const t = linea.trim();
    if (dentroDeBloque) {
      if (t.includes("*/")) dentroDeBloque = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) dentroDeBloque = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) continue;
    salida.push(linea);
  }
  return salida.join("\n");
}

describe("401/T14 — R1: ningún predicado de esta ficha lee la PROSA del error", () => {
  it.each(ARCHIVOS_DE_LA_FICHA)("⭑ %s no contiene `REQUEST_DENIED` ni `config_invalida`", (ruta) => {
    const ejecutable = ejecutableDe(leer(ruta));
    expect(ejecutable).not.toContain("REQUEST_DENIED");
    expect(ejecutable).not.toContain("config_invalida");
  });

  it("⭑ y tampoco un `LIKE` sobre `last_error`: la tentación que reaparece en SQL", () => {
    const repo = ejecutableDe(leer("lib/repositories/GeocodeSaludRepository.ts"));
    expect(repo).not.toMatch(/LIKE/i);
    expect(repo).not.toMatch(/ILIKE/i);
    expect(repo).not.toMatch(/similar to/i);
    // Lo que SÍ tiene que haber: el `left(...)`, que es la traducción exacta del `startsWith`.
    expect(repo).toMatch(/left\("last_error"/);
  });

  it("⭑ el repositorio IMPORTA el marcador del módulo de la 400; no lo declara ni lo copia", () => {
    const fuente = leer("lib/repositories/GeocodeSaludRepository.ts");
    expect(fuente).toMatch(
      /import\s*\{[^}]*\bMARCADOR_FALLO_CONFIG_GEOCODE\b[^}]*\}\s*from\s*["']@\/lib\/geo\/fallo-config-geocode["']/,
    );
    // Y la LONGITUD también se deriva del literal importado, no se escribe a mano: un `16` suelto
    // se desincronizaría en silencio el día que el prefijo cambie.
    expect(ejecutableDe(fuente)).toMatch(/MARCADOR_FALLO_CONFIG_GEOCODE\.length/);
  });

  it("⭑ CONTRAPRUEBA: el detector SÍ caza un literal de prosa introducido a propósito", () => {
    const mutado = ejecutableDe(
      `// un comentario que menciona REQUEST_DENIED no cuenta\nconst malo = "REQUEST_DENIED";`,
    );
    expect(mutado).toContain("REQUEST_DENIED");
    // Y la otra mitad: no caza cualquier cosa.
    expect(ejecutableDe(`const bueno = esFalloConfigGeocode(job.lastError);`)).not.toContain(
      "REQUEST_DENIED",
    );
  });

  it("⭑ CONTRAPRUEBA: el quitador de comentarios no se come el código", () => {
    // Si `ejecutableDe` midiera de menos, todas las afirmaciones de arriba pasarían por vacío —el
    // modo de fallo que este repo ya midió (1.387 líneas invisibles en 64 archivos, feature 283).
    const conCodigo = ejecutableDe("// comentario\nconst x = 1;\n/* bloque\n sigue */\nconst y = 2;");
    expect(conCodigo).toContain("const x = 1;");
    expect(conCodigo).toContain("const y = 2;");
    expect(conCodigo).not.toContain("comentario");
    expect(conCodigo).not.toContain("bloque");
    // Y sobre el árbol real: los archivos de la ficha no quedan vacíos al quitar comentarios.
    for (const ruta of ARCHIVOS_DE_LA_FICHA) {
      expect(ejecutableDe(leer(ruta)).trim().length).toBeGreaterThan(100);
    }
  });
});

describe("401/T14 — R33: esta ficha LEE el marcador; el único que lo ESCRIBE sigue siendo la 400", () => {
  it("⭑ ningún archivo de la 401 llama a `marcarFalloConfigGeocode`", () => {
    for (const ruta of ARCHIVOS_DE_LA_FICHA) {
      expect(ejecutableDe(leer(ruta))).not.toContain("marcarFalloConfigGeocode(");
    }
  });

  it("⭑ el productor sigue siendo el módulo de la 400, y sigue vivo", () => {
    const modulo = leer(MODULO_DEL_MARCADOR);
    expect(modulo).toMatch(/export function marcarFalloConfigGeocode/);
    expect(modulo).toMatch(/export function esFalloConfigGeocode/);
    expect(modulo).toMatch(/export const MARCADOR_FALLO_CONFIG_GEOCODE/);
  });

  it("⭑ ningún archivo de la 401 ESCRIBE en `last_error`: sólo lo lee o lo LIMPIA a NULL", () => {
    // La recuperación pone `last_error = NULL` (R15) — eso es limpiar, no producir el marcador.
    // Lo que no puede haber es una asignación de un texto a `last_error`.
    const repo = ejecutableDe(leer("lib/repositories/GeocodeSaludRepository.ts"));
    expect(repo).toMatch(/"last_error"\s*=\s*NULL/);
    expect(repo).not.toMatch(/"last_error"\s*=\s*(?!NULL)\S/);
  });

  it("⭑ CONTRAPRUEBA: el detector caza una escritura del marcador introducida a propósito", () => {
    const mutado = ejecutableDe(`const x = marcarFalloConfigGeocode("lo que sea");`);
    expect(mutado).toContain("marcarFalloConfigGeocode(");
  });
});

describe("401/T14 — R35: el contrato GENÉRICO de la cola no gana miembros por esta ficha", () => {
  /** Nombres de método declarados en una interfaz TS, por su firma `nombre(` a nivel de miembro. */
  function miembrosDe(fuente: string, interfaz: string): string[] {
    const inicio = fuente.indexOf(`export interface ${interfaz} {`);
    expect(inicio).toBeGreaterThan(-1); // no-vacuidad del recorte
    const bloque = fuente.slice(inicio);
    const fin = bloque.indexOf("\n}");
    expect(fin).toBeGreaterThan(-1);
    return [...ejecutableDe(bloque.slice(0, fin)).matchAll(/^\s{2}(\w+)[<(]/gm)].map((m) => m[1]);
  }

  it("⭑ `IJobRepository` tiene EXACTAMENTE los métodos de siempre", () => {
    // Lista LITERAL a propósito: es el contrato que sirve a las features 90/91/92/99, y su propia
    // documentación se niega a crecer (la 92 rechazó añadirle `cancel`/`reschedule`). Si esta
    // ficha le hubiera colgado un `contarFallosConfig` o un `revivir`, esto se pone rojo.
    expect(miembrosDe(leer(CONTRATO_JOBS), "IJobRepository")).toEqual([
      "enqueue",
      "claimBatch",
      "complete",
      "fail",
      "findByDedupeKeys",
    ]);
  });

  it("⭑ y no conoce el vocabulario de esta ficha", () => {
    const fuente = leer(CONTRATO_JOBS);
    expect(fuente).not.toContain("GeocodeSalud");
    expect(fuente).not.toContain("revivirFallosConfig");
    expect(fuente).not.toContain("contarFallosConfigDesde");
  });

  it("⭑ los dos métodos nuevos viven en el repositorio PROPIO y estrecho", () => {
    const propio = leer("lib/interfaces/repositories/IGeocodeSaludRepository.ts");
    expect(miembrosDe(propio, "IGeocodeSaludRepository")).toEqual([
      "contarFallosConfigDesde",
      "revivirFallosConfig",
    ]);
  });

  it("⭑ CONTRAPRUEBA: el extractor de miembros SÍ ve un método añadido", () => {
    const conExtra = `export interface IJobRepository {\n  enqueue(): void;\n  revivir(): void;\n}\n`;
    expect(miembrosDe(conExtra, "IJobRepository")).toEqual(["enqueue", "revivir"]);
  });
});

describe("401/T14 — R32/R34: el alcance de NO-hacer, afirmado sobre el árbol", () => {
  it("⭑ el drenador genérico no conoce esta ficha", () => {
    // R32: el reparto de turnos entre tipos es la ficha 402, independiente. R35: el backoff y el
    // dead-letter sirven a nueve tipos de job.
    const cola = leer("lib/services/JobQueueService.ts");
    expect(cola).not.toContain("GeocodeSalud");
    expect(cola).not.toContain("geocodificacion_caida");
  });

  it("⭑ el gate de asignabilidad y sus mensajes al operador siguen siendo de la 400", () => {
    // R34: esta ficha no cambia el árbol de decisión ni el texto que ve el operador.
    const gate = leer("lib/services/AsignabilidadCoordenadasService.ts");
    expect(gate).not.toContain("GeocodeSalud");
    expect(gate).not.toContain("geocodificacion_caida");
  });

  it("⭑ el cliente HTTP del proveedor y su config no los toca nadie de esta ficha (R28)", () => {
    const cliente = leer("lib/clients/google-geocode.ts");
    const config = leer("lib/config/geocode.ts");
    expect(cliente).not.toContain("GeocodeSalud");
    expect(config).not.toContain("GEOCODE_CAIDA");
    expect(config).not.toContain("GEOCODE_RECUPERACION");
  });
});
