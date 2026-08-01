// Feature 170 (T0.4) — GUARDIA de datos sensibles en las descargas. Cubre R21, R22, R23 y R25.
//
// Por qué es una guardia y no una revisión: el rollout declara ~25 módulos de columnas y
// cada tabla nueva de los próximos años añadirá el suyo. Una lista de comprobación humana
// se cumple las tres primeras veces. Esto, en cambio, falla solo.
//
// Cómo funciona, en dos pasadas:
//
//  1. DECLARACIÓN. Descubre por CONVENCIÓN DE NOMBRE (`*-descarga-columnas.ts`) todos los
//     módulos del árbol —no hay lista fija (R25)— y revisa la clave y el encabezado de
//     cada columna contra la lista negra.
//  2. PROYECCIÓN. Ejecuta cada `fila*()` con una SONDA: un objeto que responde a
//     cualquier lectura con un marcador que recuerda QUÉ CAMPO se leyó. Así la guardia no
//     necesita un fixture por módulo (que sería otra lista fija): sea cual sea el DTO, el
//     valor emitido delata su origen. Si una fila emite `passwordHash`, `id` o una URL
//     firmada, el marcador lo dice y el test falla.
//
// La sonda además detecta lo que NO viene de un campo: un literal con forma de uuid o de
// URL escrito a mano en la proyección.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

const RAIZ = path.resolve(__dirname, "../../..");

/** Sufijo que declara un módulo de columnas de export (design §3). */
const SUFIJO_MODULO = "-descarga-columnas.ts";

/** Carpetas del árbol donde puede vivir código de producción con columnas de export. */
const CARPETAS_PRODUCCION = ["app", "components", "lib"];

// ---------------------------------------------------------------------------
// Lista negra (design §7 · R21/R22/R23)
// ---------------------------------------------------------------------------

/**
 * Nombres prohibidos en una clave de columna, en un encabezado o en el CAMPO DE ORIGEN
 * que la proyección lee. Cubre credenciales, secretos, tokens de un solo uso, rutas de
 * almacenamiento y URL firmadas.
 */
const NOMBRES_PROHIBIDOS =
  /(pass(word)?|contrase|hash|secret|token|\botp\b|credential|credencial|apikey|api_key|bearer|\bjwt\b|signed|firmad|storage|bucket|\burl\b|\bpath\b|\bruta\b)/i;

/** Campos de identificador interno: `id` a secas o cualquier `xxxId` / `xxx_id`. */
const IDENTIFICADOR_INTERNO = /^(id|_id)$|(?<![a-z])id$|_id$/i;

/** Banderas internas de borrado lógico: nunca son columna de export. */
const BANDERA_INTERNA = /^(deleted_?at|deleted|is_?deleted|activo_?interno)$/i;

/** Forma de uuid v4 (y de cualquier uuid canónico) en el VALOR de una celda. */
const FORMA_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** URL absoluta en el valor de una celda (firmada o no) y rutas de almacenamiento. */
const FORMA_URL = /https?:\/\//i;
const FORMA_RUTA_ALMACEN = /(^|\/)(storage|buckets?|evidencias?|uploads?)\//i;

// ---------------------------------------------------------------------------
// Descubrimiento de módulos (R25: por convención, no por lista)
// ---------------------------------------------------------------------------

function listarArchivos(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarArchivos(completo, acc);
    else acc.push(completo);
  }
  return acc;
}

/** Rutas (relativas a la raíz, con `/`) de los módulos de columnas del árbol. */
function modulosEnElArbol(): string[] {
  return CARPETAS_PRODUCCION.flatMap((carpeta) => listarArchivos(path.join(RAIZ, carpeta)))
    .filter((archivo) => archivo.endsWith(SUFIJO_MODULO))
    .map((archivo) => path.relative(RAIZ, archivo).split(path.sep).join("/"))
    .sort();
}

// `import.meta.glob` es de Vite (lo resuelve al transformar este archivo), no de Node, y
// el `tsconfig` del proyecto no incluye `vite/client`. Se declara aquí su firma —solo lo
// que se usa— en vez de tocar la configuración global de tipos por un test.
declare global {
  interface ImportMeta {
    glob<T = unknown>(
      patrones: string | string[],
      opciones?: { eager?: boolean },
    ): Record<string, T>;
  }
}

// Descubre los módulos que HAY, sin que este archivo los enumere: si mañana aparece uno
// nuevo, entra solo (R25).
const MODULOS_IMPORTADOS = import.meta.glob<Record<string, unknown>>(
  ["../../../app/**/*-descarga-columnas.ts", "../../../components/**/*-descarga-columnas.ts"],
  { eager: true },
);

/** Ruta relativa a la raíz del repo de una clave de `import.meta.glob`. */
function rutaDesdeClave(clave: string): string {
  return clave.replace(/^(\.\.\/)+/, "");
}

// ---------------------------------------------------------------------------
// Sonda: un DTO que recuerda qué campo se leyó
// ---------------------------------------------------------------------------

const MARCA_INICIO = "«sonda:";
const MARCA_FIN = "»";
const CLAVE_RUTA = "__sondaRuta__";

/** Extrae de un texto todas las rutas de campo que la sonda dejó marcadas. */
function rutasMarcadas(texto: string): string[] {
  return [...texto.matchAll(/«sonda:([^»]*)»/g)].map((m) => m[1]);
}

/**
 * Objeto que responde a CUALQUIER lectura de propiedad con otra sonda, encadenando la
 * ruta leída (`relaciones.tienda.nombre`). Al coaccionarse a texto devuelve
 * `«sonda:relaciones.tienda.nombre»`, así que el rastro sobrevive a un `String(x)`, a un
 * `new Date(x)` o a un uso como clave de un mapa de etiquetas.
 */
function sonda(ruta = ""): Record<string, unknown> {
  const marcador = `${MARCA_INICIO}${ruta}${MARCA_FIN}`;
  return new Proxy({} as Record<string, unknown>, {
    get(_destino, propiedad) {
      if (propiedad === Symbol.toPrimitive) return () => marcador;
      if (propiedad === "toString" || propiedad === "valueOf") return () => marcador;
      if (propiedad === CLAVE_RUTA) return ruta;
      // Símbolos internos (React, iterables, `then` de las promesas): la sonda no los
      // simula; devolver una sonda ahí rompería el `await` y el renderizado.
      if (typeof propiedad === "symbol" || propiedad === "then") return undefined;
      return sonda(ruta === "" ? String(propiedad) : `${ruta}.${String(propiedad)}`);
    },
  });
}

function esSonda(valor: unknown): valor is Record<string, unknown> {
  return (
    typeof valor === "object" &&
    valor !== null &&
    typeof (valor as Record<string, unknown>)[CLAVE_RUTA] === "string"
  );
}

/** Campos de origen que una celda leyó, o `[]` si la celda es un literal. */
function origenesDe(celda: unknown): string[] {
  if (esSonda(celda)) return [String(celda[CLAVE_RUTA])];
  if (typeof celda === "string") return rutasMarcadas(celda);
  return [];
}

/** Último segmento de una ruta de campo (`relaciones.tienda.id` → `id`). */
function segmentos(ruta: string): string[] {
  return ruta.split(".").filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Ejecución de las proyecciones
// ---------------------------------------------------------------------------

interface ModuloCargado {
  ruta: string;
  columnas: Array<{ nombreExport: string; columnas: DescargaColumna[] }>;
  filas: Array<{ nombreExport: string; fila: DescargaFila }>;
}

function esDeclaracionDeColumnas(valor: unknown): valor is DescargaColumna[] {
  return (
    Array.isArray(valor) &&
    valor.length > 0 &&
    valor.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as DescargaColumna).clave === "string" &&
        typeof (c as DescargaColumna).encabezado === "string",
    )
  );
}

/** Proyecta con la sonda; una factoría (`fila(x)(dto)`) se invoca una segunda vez. */
function proyectarConSonda(fn: (...args: unknown[]) => unknown): DescargaFila {
  let salida = fn(sonda());
  if (typeof salida === "function") {
    salida = (salida as (...args: unknown[]) => unknown)(sonda());
  }
  if (typeof salida !== "object" || salida === null) {
    throw new Error(
      "una función exportada por un módulo *-descarga-columnas debe proyectar un DTO a una fila de export",
    );
  }
  return salida as DescargaFila;
}

const MODULOS: ModuloCargado[] = Object.entries(MODULOS_IMPORTADOS)
  .map(([clave, modulo]) => {
    const columnas: ModuloCargado["columnas"] = [];
    const filas: ModuloCargado["filas"] = [];
    for (const [nombreExport, valor] of Object.entries(modulo)) {
      if (esDeclaracionDeColumnas(valor)) {
        columnas.push({ nombreExport, columnas: valor });
      } else if (typeof valor === "function") {
        filas.push({
          nombreExport,
          fila: proyectarConSonda(valor as (...args: unknown[]) => unknown),
        });
      }
    }
    return { ruta: rutaDesdeClave(clave), columnas, filas };
  })
  .sort((a, b) => a.ruta.localeCompare(b.ruta));

// ---------------------------------------------------------------------------

describe("guardia de datos sensibles en las columnas de export", () => {
  it("la guardia cubre TODAS las declaraciones del árbol, no una lista fija", () => {
    // R25. Dos comprobaciones independientes, y las dos tienen que coincidir:
    //  (a) lo que la guardia cargó == lo que hay en el disco con ese nombre;
    //  (b) ningún archivo del árbol declara columnas de export escondido bajo otro nombre.
    const enDisco = modulosEnElArbol();
    const cargados = MODULOS.map((m) => m.ruta).sort();

    expect(cargados).toEqual(enDisco);
    expect(cargados.length).toBeGreaterThan(0);

    const declaracionesFueraDeConvencion = CARPETAS_PRODUCCION.flatMap((carpeta) =>
      listarArchivos(path.join(RAIZ, carpeta)),
    )
      .filter((archivo) => /\.tsx?$/.test(archivo) && !archivo.endsWith(SUFIJO_MODULO))
      .filter((archivo) => /:\s*DescargaColumna\[\]\s*=/.test(readFileSync(archivo, "utf8")))
      .map((archivo) => path.relative(RAIZ, archivo).split(path.sep).join("/"));

    expect(declaracionesFueraDeConvencion).toEqual([]);

    // Cada módulo declara al menos unas columnas y al menos una proyección: si no, la
    // guardia estaría revisando el vacío.
    for (const modulo of MODULOS) {
      expect(modulo.columnas.length, `${modulo.ruta} sin columnas declaradas`).toBeGreaterThan(0);
      expect(modulo.filas.length, `${modulo.ruta} sin proyección`).toBeGreaterThan(0);
    }
  });

  it("ninguna declaración de columnas contiene claves de credencial, token o secreto", () => {
    // R21. Se revisan la clave y el encabezado: el archivo lleva las dos a la vista.
    for (const modulo of MODULOS) {
      for (const declaracion of modulo.columnas) {
        for (const columna of declaracion.columnas) {
          const donde = `${modulo.ruta} :: ${declaracion.nombreExport} :: ${columna.clave}`;
          expect(columna.clave, donde).not.toMatch(NOMBRES_PROHIBIDOS);
          expect(columna.encabezado, donde).not.toMatch(NOMBRES_PROHIBIDOS);
          expect(columna.clave, donde).not.toMatch(IDENTIFICADOR_INTERNO);
          expect(columna.clave, donde).not.toMatch(BANDERA_INTERNA);
        }
      }
    }
  });

  it("ninguna fila de export emite una ruta de almacenamiento ni una URL firmada", () => {
    // R22. Dos vías por las que podría colarse: leer un campo que YA es una URL
    // (`evidenciaUrl`, `storagePath`) o escribir la ruta a mano en la proyección.
    for (const modulo of MODULOS) {
      for (const proyeccion of modulo.filas) {
        for (const [clave, celda] of Object.entries(proyeccion.fila)) {
          const donde = `${modulo.ruta} :: ${proyeccion.nombreExport} :: ${clave}`;
          for (const origen of origenesDe(celda)) {
            expect(origen, `${donde} lee ${origen}`).not.toMatch(NOMBRES_PROHIBIDOS);
          }
          if (typeof celda === "string" && origenesDe(celda).length === 0) {
            expect(celda, donde).not.toMatch(FORMA_URL);
            expect(celda, donde).not.toMatch(FORMA_RUTA_ALMACEN);
          }
        }
      }
    }
  });

  it("ninguna fila de export emite un identificador interno con forma de uuid", () => {
    // R23. El identificador que se exporta es el de NEGOCIO (`numGuia`, `numRemision`,
    // `identificador` de la API key); el `id` de la fila y las FK, nunca.
    for (const modulo of MODULOS) {
      for (const proyeccion of modulo.filas) {
        for (const [clave, celda] of Object.entries(proyeccion.fila)) {
          const donde = `${modulo.ruta} :: ${proyeccion.nombreExport} :: ${clave}`;
          for (const origen of origenesDe(celda)) {
            for (const segmento of segmentos(origen)) {
              expect(segmento, `${donde} lee ${origen}`).not.toMatch(IDENTIFICADOR_INTERNO);
              expect(segmento, `${donde} lee ${origen}`).not.toMatch(BANDERA_INTERNA);
            }
          }
          if (typeof celda === "string" && origenesDe(celda).length === 0) {
            expect(celda, donde).not.toMatch(FORMA_UUID);
          }
        }
      }
    }
  });
});
