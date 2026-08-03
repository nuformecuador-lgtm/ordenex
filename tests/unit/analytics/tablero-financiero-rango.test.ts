import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { RANGO_PRESETS } from "@/lib/analytics/types";
import { FILTRO_FINANCIERO_POR_DEFECTO } from "@/app/(app)/analitica/_components/financiero/rango";

// Feature 132 (T1.2) — R26: mientras no exista la barra de filtros de la 131, el
// rango de TODAS las consultas del tablero financiero sale de una sola constante
// declarada en un solo archivo.
//
// El riesgo real que cubre este archivo no es que la constante valga otra cosa
// (eso se ve leyendo una linea), sino que aparezca un SEGUNDO origen del rango:
// un panel que escriba su propio preset "porque este KPI se ve mejor por
// semana". A partir de ahi el tablero muestra cifras de ventanas distintas una
// al lado de la otra sin decirlo. Por eso la mitad de abajo es un censo del
// directorio de la feature, no una asercion sobre el valor.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DIR_FINANCIERO = path.join(
  REPO_ROOT,
  "app",
  "(app)",
  "analitica",
  "_components",
  "financiero",
);
const RANGO_PATH = path.join(DIR_FINANCIERO, "rango.ts");

/**
 * Se censa solo el CODIGO: los comentarios de `rango.ts` estan obligados a
 * nombrar los presets que descarta y a explicar por que. Es la misma decision
 * (y la misma funcion) de `tests/unit/analytics/modulo-puro.guardia.test.ts`.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function archivosDeLaFeature(): string[] {
  if (!fs.existsSync(DIR_FINANCIERO)) return [];
  return fs
    .readdirSync(DIR_FINANCIERO, { withFileTypes: true })
    .filter((entrada) => entrada.isFile() && /\.tsx?$/.test(entrada.name))
    .map((entrada) => path.join(DIR_FINANCIERO, entrada.name));
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/** Un preset escrito a mano, en cualquiera de las cuatro formas del dominio cerrado. */
const RE_PRESET_LITERAL = /["'](dia|semana|mes|personalizado)["']/;

/** La clave del filtro con un literal pegado: `rango: "…"`. */
const RE_CLAVE_RANGO_LITERAL = /\brango\s*:\s*["'][^"']*["']/;

describe("R26 · el rango por defecto del tablero financiero es una constante y no una decision de cada panel", () => {
  it("el filtro por defecto pide la ventana movil de treinta dias", () => {
    expect(FILTRO_FINANCIERO_POR_DEFECTO).toEqual({ rango: "mes" });
  });

  it("el preset elegido pertenece al dominio cerrado de rangos del catalogo", () => {
    // Se comprueba contra `RANGO_PRESETS` y no contra un literal repetido: si
    // manana la 135 renombrara o retirara un preset, este test tiene que caer
    // en vez de seguir afirmando un string que ya no existe.
    expect(RANGO_PRESETS).toContain(FILTRO_FINANCIERO_POR_DEFECTO.rango);
  });

  it("el filtro no se puede alterar en caliente: esta congelado", () => {
    const mutable = FILTRO_FINANCIERO_POR_DEFECTO as { rango: string };
    try {
      mutable.rango = "dia";
    } catch {
      // En modulo ES el codigo corre en modo estricto y la asignacion lanza; en
      // otros entornos falla en silencio. Las dos formas son aceptables: lo que
      // se afirma es que el valor NO cambia.
    }
    expect(FILTRO_FINANCIERO_POR_DEFECTO.rango).toBe("mes");
    expect(Object.isFrozen(FILTRO_FINANCIERO_POR_DEFECTO)).toBe(true);
  });

  it("ningun otro archivo de la region financiera escribe un preset ni la clave rango", () => {
    const infractores = archivosDeLaFeature()
      .filter((archivo) => path.resolve(archivo) !== path.resolve(RANGO_PATH))
      .filter((archivo) => {
        const codigo = soloCodigo(fs.readFileSync(archivo, "utf8"));
        return RE_PRESET_LITERAL.test(codigo) || RE_CLAVE_RANGO_LITERAL.test(codigo);
      })
      .map(relativa);

    expect(
      infractores,
      "escriben un rango a mano en vez de importar FILTRO_FINANCIERO_POR_DEFECTO",
    ).toEqual([]);
  });

  it("rango.ts si contiene el preset: el censo mira donde debe", () => {
    // Contrapeso del caso anterior: sin esto, un censo roto (o un directorio
    // renombrado) haria pasar la prueba de arriba por vacio en vez de por
    // limpio.
    const codigo = soloCodigo(fs.readFileSync(RANGO_PATH, "utf8"));
    expect(RE_PRESET_LITERAL.test(codigo)).toBe(true);
    expect(RE_CLAVE_RANGO_LITERAL.test(codigo)).toBe(true);
    expect(archivosDeLaFeature().length).toBeGreaterThan(1);
  });

  it("la constante no depende del momento ni del entorno en que se importa", () => {
    // `next/headers` la ataria a una peticion, `Date` al reloj y `process.env`
    // al despliegue. Cualquiera de los tres convertiria "la constante" en un
    // valor distinto por render, que es justo lo que R26 prohibe.
    const codigo = soloCodigo(fs.readFileSync(RANGO_PATH, "utf8"));
    expect(/next\/headers/.test(codigo), "lee cabeceras de la peticion").toBe(false);
    expect(/\bnew\s+Date\b|\bDate\s*\./.test(codigo), "consulta el reloj").toBe(false);
    expect(/process\s*\.\s*env/.test(codigo), "lee el entorno").toBe(false);
    expect(/searchParams/.test(codigo), "lee la query string").toBe(false);
  });
});
