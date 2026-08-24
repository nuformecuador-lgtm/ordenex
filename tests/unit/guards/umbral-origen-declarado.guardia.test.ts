import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

// Feature 265 (R46, R47) — GUARDIA DEL NUMERO QUE NADIE MIDIO.
//
// `RUTA_ORIGEN_MAX_KM = 200` es un valor PROPUESTO: M1 no se pudo medir el 2026-08-22
// (`ruta_optimizada_parada` vacia, 0 ordenes en `en_reparto`) y el caso de ~1.040 km que
// inspiro la guarda resulto ser una prueba del propio humano, no evidencia de campo.
//
// POR QUE UNA GUARDIA Y NO «CONFIAR EN EL COMENTARIO»: el precedente exacto es
// `RUTA_MAX_PARADAS = 100`, declarado sin base documental por la 92 con la nota «fijar y
// revisar con datos reales». Nadie lo reviso, y hoy sigue ahi sin que nada lo recuerde. La
// diferencia entre un numero provisional y un numero de verdad es QUE ALGUIEN LO PUEDA SABER
// AL LEERLO.
//
// Dos clausulas:
//  (a) la declaracion de «no calibrado» esta completa, con sus CUATRO piezas, y el fallo dice
//      cual falta;
//  (b) el umbral vive en UN SOLO SITIO: ningun otro modulo de produccion lo define ni lo
//      repite. Un segundo `200` suelto en otro archivo es una bifurcacion silenciosa —dos
//      umbrales que divergen en cuanto alguien cambie uno—.
//
// Los detectores son funciones PURAS sobre (ruta -> contenido), asi que la autocomprobacion
// puede pasarles un ARBOL SIMULADO con el literal duplicado y exigir que se ponga roja.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const CONFIG = "lib/config/route-optimization.ts";
const DIRECTORIOS_DE_PRODUCCION = ["lib", "app", "components"];

function leer(rel: string): string {
  return fs.readFileSync(path.join(RAIZ, rel), "utf8");
}

function normalizar(texto: string): string {
  return texto
    .replace(/^\s*(\/\/|\*|\/\*\*?)/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* (a) La declaracion de «no calibrado», con sus CUATRO piezas                 */
/* -------------------------------------------------------------------------- */

const PIEZAS_DE_LA_DECLARACION: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "el marcador 🧭 o la palabra PROPUESTO", patron: /🧭|PROPUEST/i },
  {
    nombre: "que NO esta calibrado con datos de produccion",
    patron: /no\s+(esta\s+)?calibrad\w*\s+con\s+datos\s+de\s+produccion/i,
  },
  {
    nombre: "la fecha (2026-08-22) y el motivo (M1 no se pudo medir)",
    patron: /2026-08-22[\s\S]{0,600}M1\s+NO\s+SE\s+PUDO\s+MEDIR|M1\s+NO\s+SE\s+PUDO\s+MEDIR[\s\S]{0,600}2026-08-22/i,
  },
  {
    nombre: "el puntero a la ficha (`specs/265-optimizador-lee-al-proveedor`)",
    patron: /specs\/265-optimizador-lee-al-proveedor/,
  },
];

/** El bloque de contrato del umbral: desde su marcador de feature hasta su declaracion. */
function declaracionDelUmbral(textoConfig: string): string {
  const i = textoConfig.indexOf("RUTA_ORIGEN_MAX_KM");
  if (i === -1) return "";
  // Se mira la ventana que rodea a la PRIMERA aparicion (el campo del contrato y su comentario).
  return normalizar(textoConfig.slice(Math.max(0, i - 2500), i + 500));
}

const piezasQueFaltan = (textoConfig: string): string[] => {
  const bloque = declaracionDelUmbral(textoConfig);
  return PIEZAS_DE_LA_DECLARACION.filter(({ patron }) => !patron.test(bloque)).map((p) => p.nombre);
};

/* -------------------------------------------------------------------------- */
/* (b) Un solo sitio                                                           */
/* -------------------------------------------------------------------------- */

/** Una DEFINICION del umbral: le asigna un numero o lo lee del entorno con su default. */
const DEFINE_EL_UMBRAL =
  /RUTA_ORIGEN_MAX_KM\s*[:=]\s*\d|readPositiveInt\(\s*["']RUTA_ORIGEN_MAX_KM["']/;

/** Un umbral de kilometros HARDCODEADO con otro nombre: la bifurcacion silenciosa. */
const UMBRAL_DUPLICADO = /(max|maximo|umbral|limite|tope)[_A-Za-z]*km\s*[:=]\s*\d+/i;

/**
 * Devuelve los modulos de produccion que definen el umbral o lo repiten con otro nombre.
 * Puro: recibe el arbol como (ruta -> contenido), asi que se puede autocomprobar con uno
 * simulado que SI infringe.
 */
function modulosQueDefinenElUmbral(arbol: ReadonlyMap<string, string>): string[] {
  const culpables: string[] = [];
  for (const [ruta, contenido] of arbol) {
    if (DEFINE_EL_UMBRAL.test(contenido) || UMBRAL_DUPLICADO.test(contenido)) culpables.push(ruta);
  }
  return culpables.sort();
}

/** El arbol real de produccion, leido del disco (no del diff: un diff caduca al mergear). */
function arbolDeProduccion(): Map<string, string> {
  const arbol = new Map<string, string>();
  const recorrer = (dir: string) => {
    for (const entrada of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) {
        if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
        recorrer(rel);
      } else if (/\.(ts|tsx)$/.test(entrada.name)) {
        arbol.set(rel, fs.readFileSync(path.join(RAIZ, rel), "utf8"));
      }
    }
  };
  for (const dir of DIRECTORIOS_DE_PRODUCCION) recorrer(dir);
  return arbol;
}

/* -------------------------------------------------------------------------- */
/* El censo                                                                    */
/* -------------------------------------------------------------------------- */

describe("265/R47 — el umbral se declara SIN CALIBRAR, por escrito", () => {
  it("el modulo de configuracion existe y define el umbral", () => {
    expect(fs.existsSync(path.join(RAIZ, CONFIG))).toBe(true);
    expect(DEFINE_EL_UMBRAL.test(leer(CONFIG))).toBe(true);
  });

  it("la declaracion esta completa, y el fallo dice CUAL pieza falta", () => {
    expect(
      piezasQueFaltan(leer(CONFIG)),
      "R47: un numero provisional sin nota se lee como un numero medido. Hacen falta el " +
        "marcador, la frase de «no calibrado con datos de produccion», la fecha con su motivo " +
        "(M1 no se pudo medir) y el puntero al spec.",
    ).toEqual([]);
  });
});

describe("265/R46 — el umbral vive en UN SOLO SITIO", () => {
  it("ningun otro modulo de lib/, app/ o components/ lo define ni lo repite", () => {
    const arbol = arbolDeProduccion();
    // El censo mira algo, no un directorio vacio: si esto cayera a cero, la clausula (b) seria
    // decorado.
    expect(arbol.size).toBeGreaterThan(500);

    expect(
      modulosQueDefinenElUmbral(arbol),
      "R46: dos definiciones del mismo umbral es una bifurcacion silenciosa — divergen en " +
        "cuanto alguien cambie una. El servicio lo lee de `this.config`, y los tests lo " +
        "inyectan por config; nadie mas puede escribir el numero.",
    ).toEqual([CONFIG]);
  });
});

describe("autocomprobacion: los detectores marcan y NO marcan lo que dicen", () => {
  it("(a) quitar una pieza de la declaracion la delata", () => {
    const original = leer(CONFIG);
    expect(piezasQueFaltan(original)).toEqual([]);

    const sinPuntero = original.replace("specs/265-optimizador-lee-al-proveedor", "el spec");
    expect(sinPuntero).not.toBe(original);
    expect(piezasQueFaltan(sinPuntero)).toEqual([
      "el puntero a la ficha (`specs/265-optimizador-lee-al-proveedor`)",
    ]);

    const sinDeclaracion = original.replace(
      /NO CALIBRADO CON DATOS DE PRODUCCION/i,
      "ES EL VALOR BUENO",
    );
    expect(sinDeclaracion).not.toBe(original);
    expect(piezasQueFaltan(sinDeclaracion)).toContain(
      "que NO esta calibrado con datos de produccion",
    );
  });

  it("(a bis) un contrato sin ninguna nota falla las CUATRO piezas", () => {
    expect(piezasQueFaltan("  RUTA_ORIGEN_MAX_KM: number;")).toHaveLength(
      PIEZAS_DE_LA_DECLARACION.length,
    );
  });

  it("(b) un ARBOL SIMULADO con el literal duplicado pone la clausula ROJA", () => {
    const limpio = new Map([
      [CONFIG, 'RUTA_ORIGEN_MAX_KM: readPositiveInt("RUTA_ORIGEN_MAX_KM", 200),'],
      ["lib/services/OptimizacionRutaService.ts", "if (km > this.config.RUTA_ORIGEN_MAX_KM) {"],
      ["components/ui/alert.tsx", "const alto = 200;"],
    ]);
    expect(modulosQueDefinenElUmbral(limpio)).toEqual([CONFIG]);

    // Alguien «se ahorra» leer la config y escribe el numero otra vez.
    const duplicado = new Map(limpio).set(
      "lib/services/OtroServicio.ts",
      "const RUTA_ORIGEN_MAX_KM = 200;",
    );
    expect(modulosQueDefinenElUmbral(duplicado)).toEqual([
      CONFIG,
      "lib/services/OtroServicio.ts",
    ]);

    // O lo repite con otro nombre, que es la forma en que esto pasa de verdad.
    const conAlias = new Map(limpio).set(
      "lib/services/OtroServicio.ts",
      "const MAX_ORIGEN_KM = 200; // igual que en la config",
    );
    expect(modulosQueDefinenElUmbral(conAlias)).toEqual([CONFIG, "lib/services/OtroServicio.ts"]);
  });

  it("(b bis) leer el umbral de la config NO cuenta como definirlo", () => {
    const soloLectura = new Map([
      ["lib/services/OptimizacionRutaService.ts", "km > this.config.RUTA_ORIGEN_MAX_KM"],
    ]);
    expect(modulosQueDefinenElUmbral(soloLectura)).toEqual([]);
  });
});
