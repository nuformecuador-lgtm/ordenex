import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * ⭑ FICHA 453 · R6 — GUARDIA: EL FORMATO GUARDADO ES PROPIO, Y SIGUE SIENDO PROPIO.
 *
 * ⚠️ QUE SE ESTA PROTEGIENDO. Hay dos formatos que describen «el filtro puesto» y tienen dos dueños
 * distintos:
 *
 *   · `serializarFiltro` (`app/(app)/ordenes/_components/serializar-filtro.ts`) es la CLAVE DE
 *     CACHE del listado: existe para que dos filtros iguales compartan respuesta. Ordena los
 *     valores, no escapa el separador y serializa el TRANSPORTE, no el estado de la barra.
 *   · el payload de `lib/types/vista-filtro.ts` es lo que se PERSISTE, versionado y cerrado.
 *
 * El dia que se toquen, el precio se cobra en las dos direcciones: un cambio en la clave de cache
 * cambiaria EN SILENCIO el significado de filas ya guardadas —vistas que la gente creo hace meses—,
 * y añadir un campo al formato guardado fragmentaria la cache SWR y provocaria un refetch de todas
 * las combinaciones. Ninguna de las dos cosas rompe un test: por eso existe esta guardia.
 *
 * Mide DOS cosas:
 *   1. que ningun modulo de persistencia de vistas importe `serializar-filtro`;
 *   2. que el payload guardado NO se use como clave de SWR (la clave de la lista es
 *      `["vistas-filtro", superficie]`, que no contiene el filtro).
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** El modulo prohibido, por su ruta y por su nombre de export. */
const SERIALIZADOR = "serializar-filtro";
const EXPORT_PROHIBIDO = "serializarFiltro";

/** Todo lo que persiste o transporta vistas: si el formato se contamina, pasa por aqui. */
const MODULOS_DE_PERSISTENCIA = [
  "lib/types/vista-filtro.ts",
  "lib/services/VistaFiltroService.ts",
  "lib/repositories/VistaFiltroRepository.ts",
  "lib/interfaces/repositories/IVistaFiltroRepository.ts",
  "lib/interfaces/services/IVistaFiltroService.ts",
  "lib/actions/vistas-filtro.ts",
  "lib/utils/vista-filtro-aplicabilidad.ts",
  // Los de la tanda de frontend, cuando existan. Se listan por adelantado A PROPOSITO: la guardia
  // los recoge en cuanto aparezcan, sin que nadie tenga que acordarse de añadirlos aqui.
  "components/shared/VistasFiltro.tsx",
  "hooks/useVistasFiltro.ts",
];

const codigoDe = (archivo: string) =>
  quitarComentarios(readFileSync(path.join(RAIZ, archivo), "utf8"));

/**
 * ⭑ EL ANALIZADOR: ¿este codigo trae el serializador de la clave de cache?
 *
 * Mira el import por ruta y tambien el uso del nombre exportado, porque un re-export lo haria
 * llegar sin que la ruta aparezca. Se exporta para que el CANARIO pueda darle un fuente inventado:
 * una guardia que no se autocomprueba puede estar verde por vacio.
 */
export function usaElSerializadorDeCache(codigo: string): boolean {
  if (codigo.includes(SERIALIZADOR)) return true;
  return new RegExp(`\\b${EXPORT_PROHIBIDO}\\b`).test(codigo);
}

/**
 * ⭑ EL SEGUNDO ANALIZADOR: ¿alguien mete el filtro guardado dentro de una clave de SWR?
 *
 * Busca un `useSWR(` cuya clave nombre el payload de la vista. No pretende entender SWR: pretende
 * que nadie escriba `useSWR([..., vista.filtro], ...)` sin que se entere alguien.
 */
export function metePayloadEnClaveDeSwr(codigo: string): boolean {
  for (const uso of codigo.matchAll(/useSWR\s*(?:<[^>]*>)?\s*\(/g)) {
    const desde = uso.index + uso[0].length;
    if (/\.filtro\b|vistaFiltroPayload|payloadDeVista/.test(primerArgumento(codigo, desde))) {
      return true;
    }
  }
  return false;
}

/**
 * El PRIMER argumento de una llamada, desde el caracter siguiente al parentesis de apertura.
 *
 * Se cuentan los corchetes en vez de cortar por la primera coma: la clave de SWR es casi siempre un
 * ARRAY (`["vistas-filtro", superficie]`), asi que partir por la coma leeria `["vistas-filtro` y
 * dejaria fuera justo la parte donde se colaria el filtro. Es el modo de fallo que este analizador
 * tuvo al nacer, y por el que la autocomprobacion existe.
 */
function primerArgumento(codigo: string, desde: number): string {
  let profundidad = 0;
  for (let i = desde; i < codigo.length; i += 1) {
    const c = codigo[i];
    if (c === "(" || c === "[" || c === "{") profundidad += 1;
    else if (c === ")" && profundidad === 0) return codigo.slice(desde, i);
    else if (c === ")" || c === "]" || c === "}") profundidad -= 1;
    else if (c === "," && profundidad === 0) return codigo.slice(desde, i);
  }
  return codigo.slice(desde);
}

function existentes(rutas: string[]): string[] {
  return rutas.filter((r) => existsSync(path.join(RAIZ, r)) && statSync(path.join(RAIZ, r)).isFile());
}

describe("453/R6 · guardia: el formato persistido no se cruza con la clave de cache", () => {
  it("⭑ AUTOCOMPROBACION: los analizadores encuentran lo que buscan en un fuente conocido", () => {
    // Sin esto, un analizador roto dejaria el barrido verde y mudo. El fixture es codigo inventado
    // aqui mismo: no depende de que ningun archivo del arbol siga teniendo cierta forma.
    expect(
      usaElSerializadorDeCache(
        'import { serializarFiltro } from "@/app/(app)/ordenes/_components/serializar-filtro";',
      ),
    ).toBe(true);
    expect(usaElSerializadorDeCache("const clave = serializarFiltro(filtro);")).toBe(true);
    expect(usaElSerializadorDeCache('import { listar } from "@/lib/services/otra-cosa";')).toBe(
      false,
    );

    expect(metePayloadEnClaveDeSwr('useSWR(["vistas", vista.filtro], fetcher)')).toBe(true);
    expect(metePayloadEnClaveDeSwr('useSWR(["vistas-filtro", superficie], fetcher)')).toBe(false);
  });

  it("⭑ AUTOCOMPROBACION: el modulo prohibido existe y es el que se cree", () => {
    // Si alguien renombra o borra `serializar-filtro.ts`, esta guardia estaria vigilando un
    // fantasma y pasaria siempre. Que se ponga roja aqui es la señal de que hay que revisarla.
    const ruta = path.join(RAIZ, "app/(app)/ordenes/_components/serializar-filtro.ts");
    expect(existsSync(ruta), "el modulo de la clave de cache cambio de sitio").toBe(true);
    expect(readFileSync(ruta, "utf8")).toContain("export function serializarFiltro");
  });

  it("⭑ ningun modulo de persistencia de vistas importa el serializador de la cache", () => {
    const archivos = existentes(MODULOS_DE_PERSISTENCIA);
    // AUTOCOMPROBACION: hay modulos que mirar. Con la lista vacia, el bucle seria verde por vacio.
    expect(archivos.length, "no se encontro ningun modulo de vistas que vigilar").toBeGreaterThan(4);

    for (const archivo of archivos) {
      expect(
        usaElSerializadorDeCache(codigoDe(archivo)),
        `${archivo} trae el serializador de la clave de cache: son dos formatos con dos dueños`,
      ).toBe(false);
    }
  });

  it("⭑ nadie usa el filtro guardado como clave de SWR", () => {
    const archivos = [...existentes(MODULOS_DE_PERSISTENCIA), ...tsxQueNombranVistas()];
    expect(archivos.length).toBeGreaterThan(4);

    for (const archivo of archivos) {
      expect(
        metePayloadEnClaveDeSwr(codigoDe(archivo)),
        `${archivo} mete el filtro guardado en una clave de SWR: fragmentaria la cache`,
      ).toBe(false);
    }
  });
});

/** Los componentes/hooks del arbol que nombran las vistas de filtros: ahi viviria el SWR. */
function tsxQueNombranVistas(): string[] {
  const encontrados: string[] = [];
  for (const carpeta of ["components/shared", "hooks", "app/(app)/ordenes/_components"]) {
    const dir = path.join(RAIZ, carpeta);
    if (!existsSync(dir)) continue;
    for (const entrada of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(entrada)) continue;
      const relativo = `${carpeta}/${entrada}`;
      const texto = readFileSync(path.join(RAIZ, relativo), "utf8");
      if (texto.includes("vista-filtro") || texto.includes("VistaFiltro")) {
        encontrados.push(relativo);
      }
    }
  }
  return encontrados;
}
