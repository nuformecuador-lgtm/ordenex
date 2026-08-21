import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

import {
  ARCHIVOS_BACKEND,
  REPO_ROOT,
  arbolDeLaFeature,
  sinComentarios,
  type ArchivoDeLaFeature,
} from "./_arbol-de-la-feature";

// Feature 192 (B5.1) — LAS SEIS FRONTERAS DE LA FEATURE, censadas sobre EL ARBOL.
//
// R8, R17, R36, R38, R39, R48 y R55. Cada clausula de este archivo protege una decision que
// ya se tomo y que no se ve al leer un diff pequeño: la trampa horaria de `startOfDayCR`, la
// separacion respecto de la analitica de cierre, que el recorte por rol tenga UNA sola
// fuente, que ninguna capa traiga el dia entero a memoria, y que el vocabulario visual del
// estatus no se escriba dos veces.
//
// ─── Por que se censa EL ARBOL y no el diff ────────────────────────────────────────────────
// Un guardia que mirase `git diff origin/dev` deja de proteger nada en cuanto la rama se
// mergea y, peor, pasa a juzgar cualquier rama posterior (ya paso en este repo). El censo por
// RUTA sobrevive al merge. El inventario vive en `_arbol-de-la-feature.ts` y es UNO solo: los
// demas guardias de la feature leen el mismo, para que no puedan divergir.
//
// ─── Por que cada clausula demuestra que NO es vacia ───────────────────────────────────────
// Un guardia que no puede fallar es decorado. Cada detector de aqui es una funcion pura, y de
// cada uno hay un test que se lo aplica a codigo REAL del repositorio que SI infringe la
// clausula (el `startOfDayCR` de `liberacion-reprogramada.ts`, el mapa de etiquetas de
// `EstatusBadge.tsx`, el `findMany` de un repositorio existente...). Si un detector dejara de
// detectar —por un rename, por un cambio de forma del codigo— esos tests se ponen rojos.

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function codigoDe(rel: string): string {
  return sinComentarios(leer(rel));
}

function archivosTs(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const entrada of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosTs(rel));
    else if (/\.tsx?$/.test(entrada.name)) salida.push(rel);
  }
  return salida;
}

/** El arbol, leido UNA vez: son ~20 archivos y todas las clausulas miran los mismos. */
const ARBOL: readonly ArchivoDeLaFeature[] = arbolDeLaFeature();

/** El gate de PANTALLA (R11) es el unico sitio de la feature que puede nombrar roles. */
const GATE_DE_PANTALLA = "app/(app)/monitoreo/page.tsx";

function infractores(
  detector: (codigo: string) => boolean,
  arbol: readonly ArchivoDeLaFeature[] = ARBOL,
): string[] {
  return arbol.filter(({ codigo }) => detector(codigo)).map(({ ruta }) => ruta);
}

/* -------------------------------------------------------------------------- */
/* Los detectores (funciones puras: se prueban contra codigo real, abajo)      */
/* -------------------------------------------------------------------------- */

/** (a) R17 — la trampa horaria: `startOfDayCR` devuelve la MEDIANOCHE UTC, no la de CR. */
const usaStartOfDayCR = (codigo: string): boolean => /\bstartOfDayCR\b/.test(codigo);

/**
 * (b) R38 — la analitica de CIERRE. Se prohiben el escritor del rollup, la tabla
 * `analytics_daily` y la CACHE de analitica (adaptador, config y tags).
 *
 * ⚠️ `lib/analytics/cache-clave.ts` NO esta aqui a proposito: es un codec PURO y el design
 * (§5.quater, alternativa 18) manda reutilizar `claveDeAlcance` de ahi precisamente para no
 * escribir dos codificaciones del alcance que puedan divergir en silencio. Lo que R38 separa
 * son los DATOS y el espacio de cache, no una funcion pura de formato.
 */
const IMPORTA = String.raw`(?:from\s*|require\(\s*|import\(\s*)["'][^"']*`;
const ANALITICA_PROHIBIDA = new RegExp(
  IMPORTA +
    "(?:analytics/rollup-dia|cache/next-analitica-cache|config/analitica-cache|" +
    "config/analitica-rollup|analytics/cache-tags|IAnaliticaCache|IAnaliticaRollup)",
);
const TABLA_DE_ROLLUP = /\banalytics_daily\b|\bAnalyticsDaily\b|\banalyticsDaily\b/;
const leeLaAnalitica = (codigo: string): boolean =>
  ANALITICA_PROHIBIDA.test(codigo) || TABLA_DE_ROLLUP.test(codigo);

/**
 * (c) R8 — el recorte por rol. La feature NO lee el rol del actor en ninguna capa de datos:
 * se lo entrega a `resolverAlcance` y consume su respuesta. Dos formas de infringirlo:
 * mirar `actor.rol`, o declarar una lista/mapa con roles del catalogo.
 */
const LEE_EL_ROL = /\.rol\b|\brol\s*(?:===|!==|==|!=)/;
/** El catalogo de roles se PARSEA del esquema: declararlo aqui seria la segunda lista. */
const ROLES = (() => {
  const enumBloque = /enum RolValue \{([\s\S]*?)\n\}/.exec(leer("db/schema.prisma"));
  if (!enumBloque) throw new Error("no se encontro `enum RolValue` en db/schema.prisma");
  return sinComentarios(enumBloque[1])
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((v) => /^[a-zA-Z]+$/.test(v));
})();
/**
 * Un rol se "nombra" tanto como literal (`"adminSatelite"`, un `case`, un `includes`) como en
 * forma de CLAVE de un mapa (`{ adminSatelite: "zona" }`), que es justo la forma que tendria
 * una segunda tabla rol -> alcance.
 */
function rolesNombrados(codigo: string): string[] {
  return ROLES.filter((rol) =>
    new RegExp(`["']${rol}["']|(?:^|[{,\\s[])${rol}\\s*:`, "m").test(codigo),
  );
}
/**
 * Umbral 2 y no 1: el `switch` exhaustivo de `TableroDiaService` tiene un `case "mensajero"`
 * que es un TIPO DE ALCANCE (`AlcanceDatos.tipo`), no un rol, y colisiona de nombre. Una
 * segunda tabla de roles, en cambio, nombra por definicion varios (`maestro` y `admin` van
 * juntos a global, `adminSatelite` a zona): con uno solo no se recorta nada.
 */
const declaraRoles = (codigo: string): boolean => rolesNombrados(codigo).length >= 2;
const resuelveAlcancePorSuCuenta = (codigo: string): boolean =>
  LEE_EL_ROL.test(codigo) || declaraRoles(codigo);

/** (d) R36/R39/R55 — nada de traer el dia a memoria. */
const USA_FIND_MANY = /\.findMany\s*\(/;
const usaFindMany = (codigo: string): boolean => USA_FIND_MANY.test(codigo);
const SQL_CRUDO = /\$(?:queryRaw|executeRaw)(?:Unsafe)?\b/;
const usaSqlCrudo = (codigo: string): boolean => SQL_CRUDO.test(codigo);
/** Las plantillas `$queryRaw\`...\`` de un archivo, ya sin comentarios. */
function consultasCrudas(codigo: string): string[] {
  return [...codigo.matchAll(/\$queryRaw(?:<[^>]*>)?`([\s\S]*?)`/g)].map((m) => m[1]);
}
const esAgregada = (sql: string): boolean => /\bGROUP BY\b/.test(sql);
const esPaginada = (sql: string): boolean => /\bLIMIT\s*\$\{/.test(sql) && /\bOFFSET\b/.test(sql);

/**
 * (f) R48 — el vocabulario visual del estatus. Se busca la forma concreta que R48 prohibe:
 * una clave que ES un value del catalogo de estatus con un valor de texto que parece una
 * ETIQUETA humana ("Entregada", "En reparto") o un COLOR (`success`, `bg-...`, `#f26419`).
 *
 * No se prohibe cualquier mapa clavado por estatus, y es deliberado: `BUCKET_POR_ESTATUS`
 * (estatus -> bucket) y el mapa `GestionResultado -> contador` del repositorio son legitimos
 * y no son ni etiquetas ni colores. Sus valores (`"sinRecoger"`, `"entregadas"`) no pasan por
 * estos dos filtros, asi que el guardia no obliga a reescribirlos.
 */
const VALUES_DE_ESTATUS = ORDER_STATUS_SEED as readonly string[];
const PARECE_ETIQUETA = /^[A-ZÁÉÍÓÚÑ]|\s/;
const PARECE_COLOR =
  /^#[0-9a-fA-F]{3,8}$|^(?:success|warning|danger|info|secondary|destructive|outline)$|\b(?:bg|text|border|ring|fill)-/;
function paresEstatusTexto(codigo: string): { estatus: string; valor: string }[] {
  const salida: { estatus: string; valor: string }[] = [];
  for (const m of codigo.matchAll(/(?:^|[{,\s])([a-z_]+)\s*:\s*["'`]([^"'`]*)["'`]/gm)) {
    if (VALUES_DE_ESTATUS.includes(m[1])) salida.push({ estatus: m[1], valor: m[2] });
  }
  return salida;
}
const declaraEtiquetasDeEstatus = (codigo: string): boolean =>
  paresEstatusTexto(codigo).some(({ valor }) => PARECE_ETIQUETA.test(valor));
const declaraColoresDeEstatus = (codigo: string): boolean =>
  paresEstatusTexto(codigo).some(({ valor }) => PARECE_COLOR.test(valor)) ||
  /\bbadgeVariants\b/.test(codigo);

/* -------------------------------------------------------------------------- */
/* El censo                                                                    */
/* -------------------------------------------------------------------------- */

describe("frontera de la feature 192 — el censo mira algo", () => {
  it("los archivos de backend declarados existen todos", () => {
    for (const ruta of ARCHIVOS_BACKEND) {
      expect(fs.existsSync(path.join(REPO_ROOT, ruta)), `falta ${ruta}`).toBe(true);
    }
  });

  it("el arbol censado incluye backend y, si ya aterrizo, el frontend", () => {
    // Si esto se pusiera a 0 o a 1, todas las clausulas de abajo serian verdes por vacio.
    expect(ARBOL.length).toBeGreaterThanOrEqual(ARCHIVOS_BACKEND.length);
    // Los archivos de `app/(app)/monitoreo/` los escribe el bloque FRONTEND en paralelo: se
    // censan EN CUANTO existen, sin tocar este guardia.
    expect(ARBOL.map((a) => a.ruta)).toEqual(
      expect.arrayContaining([...ARCHIVOS_BACKEND, ...archivosTs("app/(app)/monitoreo")]),
    );
  });
});

describe("(a) R17 · la feature no usa `startOfDayCR`", () => {
  it("ningun archivo de la feature lo nombra", () => {
    expect(
      infractores(usaStartOfDayCR),
      "`startOfDayCR` devuelve la MEDIANOCHE UTC de la fecha calendario, no la de Costa " +
        "Rica: usarla como inicio del dia convierte la ventana en 18:00-18:00 CR y una orden " +
        "asignada a las 00:30 CR (R15) se contaria en el dia anterior. La ventana de esta " +
        "feature la calcula `lib/utils/ventana-dia-cr.ts`.",
    ).toEqual([]);
  });

  it("el detector NO es vacio: `startOfDayCR` existe y hay codigo real del repo que lo usa", () => {
    expect(codigoDe("lib/utils/fecha-cr.ts")).toContain("export function startOfDayCR");
    // Si mañana este archivo dejara de usarla, hay que buscar otro consumidor real, no
    // borrar la comprobacion: sin ella el detector podria ser un patron que ya no matchea.
    expect(usaStartOfDayCR(codigoDe("lib/actions/liberacion-reprogramada.ts"))).toBe(true);
  });

  it("la ventana propia SI existe y es la que se usa (si no, la clausula seria trivial)", () => {
    expect(codigoDe("lib/utils/ventana-dia-cr.ts")).toContain("export function ventanaDelDiaEnCursoCR");
    expect(codigoDe("lib/services/TableroDiaService.ts")).toContain("ventanaDelDiaEnCursoCR");
  });
});

describe("(b) R38 · la feature no toca la analitica de cierre", () => {
  it("ningun archivo importa el rollup, su config, su cache ni nombra `analytics_daily`", () => {
    expect(
      infractores(leeLaAnalitica),
      "R38: los datos del tablero salen de las tablas VIVAS de ordenes y gestiones. " +
        "`analytics_daily` es el cierre del dia anterior (el dia en curso no tiene rollup) y " +
        "su cache tiene invalidacion por evento, que R71 prohibe aqui.",
    ).toEqual([]);
  });

  it("el detector NO es vacio: los modulos prohibidos existen y hay codigo real que los usa", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "lib/analytics/rollup-dia.ts"))).toBe(true);
    expect(leer("db/schema.prisma")).toContain('@@map("analytics_daily")');
    expect(leeLaAnalitica(codigoDe("lib/services/AnaliticaRollupService.ts"))).toBe(true);
    expect(leeLaAnalitica(codigoDe("lib/repositories/AnaliticaRollupRepository.ts"))).toBe(true);
  });

  it("la cache del tablero es un puerto PROPIO, no el de analitica", () => {
    const adaptador = codigoDe("lib/cache/next-tablero-dia-cache.ts");
    expect(adaptador).toContain("ITableroDiaCache");
    expect(adaptador).not.toContain("IAnaliticaCache");
  });
});

describe("(c) R8 · el recorte por rol viene de `resolverAlcance`, y de un solo sitio", () => {
  it("`resolverAlcance` se importa en EXACTAMENTE un archivo de la feature, y se llama", () => {
    const importadores = infractores((codigo) =>
      new RegExp(IMPORTA + 'analytics/alcance["\']').test(codigo) && /resolverAlcance/.test(codigo),
    );
    expect(importadores).toEqual(["lib/services/TableroDiaService.ts"]);
    expect(codigoDe("lib/services/TableroDiaService.ts")).toMatch(/resolverAlcance\(\s*actor/);
  });

  it("ninguna capa de la feature lee el rol ni declara una segunda lista de roles", () => {
    // El gate de PANTALLA (R11) queda fuera: nombra roles para decidir si la pagina existe
    // (`notFound()`), no para recortar filas. Que no pueda recortar nada se comprueba abajo.
    const censo = ARBOL.filter(({ ruta }) => ruta !== GATE_DE_PANTALLA);
    expect(
      infractores(resuelveAlcancePorSuCuenta, censo),
      "R8: el alcance sale de `resolverAlcance(actor, METRICA_ALCANCE_TABLERO)` y la lista " +
        "blanca `global|zona` traduce su RESPUESTA. Una segunda tabla de roles es una " +
        "frontera multi-tenant duplicada que puede divergir de la original en silencio.",
    ).toEqual([]);
  });

  it("el gate de pantalla, si ya existe, no puede recortar datos: no toca alcance ni zona", () => {
    const gate = ARBOL.find(({ ruta }) => ruta === GATE_DE_PANTALLA);
    if (!gate) return; // lo escribe el bloque FRONTEND (F1.1); cuando llegue, esto lo mide.
    expect(gate.codigo).not.toMatch(/\bzonaId\b|\balcance\b|\bfiltro\b/);
    expect(gate.codigo).not.toMatch(new RegExp(IMPORTA + "(?:repositories|services)/"));
  });

  it("el detector NO es vacio: marca al resolutor real, que SI mapea roles a alcance", () => {
    expect(resuelveAlcancePorSuCuenta(codigoDe("lib/analytics/alcance.ts"))).toBe(true);
    expect(declaraRoles(codigoDe("lib/analytics/types.ts"))).toBe(true);
    // Y el catalogo parseado del esquema es el de verdad, no una lista vacia que no marca nada.
    expect(ROLES).toEqual(
      expect.arrayContaining(["maestro", "admin", "mensajero", "adminTienda", "adminSatelite"]),
    );
  });
});

describe("(d) R36/R39/R55 · ninguna capa trae las ordenes del dia a memoria", () => {
  it("ningun archivo de la feature usa `findMany`", () => {
    expect(
      infractores(usaFindMany),
      "R36/R39: el tablero se resuelve con UNA consulta agregada y devuelve una fila por " +
        "mensajero, no por orden. Un `findMany` sobre `orden` o `gestionOrden` materializa " +
        "el dia entero en el proceso y crece con el volumen (la deuda de la ficha 191).",
    ).toEqual([]);
  });

  it("el SQL crudo vive SOLO en el repositorio", () => {
    expect(infractores(usaSqlCrudo)).toEqual(["lib/repositories/TableroDiaRepository.ts"]);
  });

  it("cada consulta del repositorio es agregada (R36/R39) o paginada (R55): ninguna suelta", () => {
    const codigo = codigoDe("lib/repositories/TableroDiaRepository.ts");
    const consultas = consultasCrudas(codigo);
    // TRES, en el orden en que aparecen en el archivo:
    //   1. `contarPorMensajero`   — el tablero, una fila por mensajero      -> AGREGADA
    //   2. `listarOrdenesDelDia`  — el detalle, una fila por orden          -> PAGINADA
    //   3. `contarEntregasPorHora` — FEATURE 258: entregas por hora de pared CR -> AGREGADA
    //
    // La tercera la añadio la feature 258 (B3.1) y pasar por aqui fue una TAREA con nombre, no
    // un daño colateral: es el sitio donde alguien se justifica. Es agregada porque agrupa por
    // HORA (`GROUP BY 1`) y devuelve como mucho 24 filas — nunca una fila por orden. Si
    // perdiera su `GROUP BY`, el problema seria la consulta, no este guardia.
    //
    // ⛔ Una CUARTA obliga a volver aqui. Y esta clausula NO se afloja: bajar el
    // `toHaveLength` a `toBeGreaterThan` o quitar la clasificacion la convierte en decorado.
    expect(consultas).toHaveLength(3);

    const clasificacion = consultas.map((sql) =>
      esAgregada(sql) ? "agregada" : esPaginada(sql) ? "paginada" : "SIN LIMITE",
    );
    expect(
      clasificacion,
      "El unico acceso por ORDEN admisible es el detalle, y va paginado con LIMIT/OFFSET " +
        "como el listado de ordenes. El tablero agrupa por mensajero y la serie de entregas " +
        "agrupa por hora: sus filas son mensajeros y horas, no ordenes.",
    ).toEqual(["agregada", "paginada", "agregada"]);

    // Y CUAL es cual, para que la clasificacion posicional de arriba no se pueda satisfacer
    // con tres consultas cualesquiera: cada posicion lleva la marca de SU consulta.
    expect(consultas[0]).toContain("GROUP BY a.mensajero_id");
    expect(consultas[1]).toContain("OFFSET");
    expect(consultas[2]).toMatch(/EXTRACT\(EPOCH FROM/);
    expect(consultas[2]).toContain("GROUP BY 1");
    // R53 — la hora sale de `ventana.desde`, jamas de una zona horaria escrita en el SQL.
    expect(consultas[2]).not.toMatch(/AT TIME ZONE|America\/Costa_Rica/);

    // `queryRawUnsafe` acepta una cadena montada a mano: ni interpolacion segura ni forma
    // analizable. Aqui no hay ninguna, y este assert impide que aparezca.
    expect(/Unsafe/.test(codigo)).toBe(false);
  });

  it("los detectores NO son vacios: marcan un `findMany` y un SQL sin limite reales", () => {
    expect(usaFindMany(codigoDe("lib/repositories/ApiKeyRepository.ts"))).toBe(true);
    expect(esAgregada("SELECT x FROM t")).toBe(false);
    expect(esPaginada("SELECT x FROM t")).toBe(false);
    expect(esAgregada("SELECT count(*) FROM t GROUP BY a")).toBe(true);
    expect(esPaginada("SELECT x FROM t LIMIT ${n} OFFSET ${o}")).toBe(true);
    expect(consultasCrudas("const f = await p.$queryRaw<Row[]>`SELECT 1`;")).toEqual(["SELECT 1"]);
  });
});

describe("los detectores marcan la INFRACCION con la forma que tendria aqui", () => {
  // Los tests de arriba prueban cada detector contra codigo REAL del repo. Estos lo prueban
  // contra la linea exacta que alguien escribiria dentro de esta feature: es la diferencia
  // entre "el patron matchea algo" y "el patron matchea lo que va a pasar".
  it.each([
    ['import { startOfDayCR } from "@/lib/utils/fecha-cr";', usaStartOfDayCR],
    ['import { ventanaDelDia } from "@/lib/analytics/rollup-dia";', leeLaAnalitica],
    ['import { crearAnaliticaCacheDeNext } from "@/lib/cache/next-analitica-cache";', leeLaAnalitica],
    ['import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";', leeLaAnalitica],
    ['import { TTL } from "@/lib/config/analitica-cache";', leeLaAnalitica],
    ['await this.prisma.$queryRaw`SELECT * FROM analytics_daily`;', leeLaAnalitica],
    ["if (actor.rol === \"adminSatelite\") return { zonaId: actor.zonaId };", resuelveAlcancePorSuCuenta],
    ['const CON_ALCANCE = { maestro: "global", adminSatelite: "zona" };', resuelveAlcancePorSuCuenta],
    ["const ordenes = await this.prisma.orden.findMany({ where });", usaFindMany],
    ["const g = await this.prisma.gestionOrden.findMany({ where });", usaFindMany],
  ])("%s", (muestra, detector) => {
    expect(detector(muestra)).toBe(true);
  });

  it("y NO marcan lo que la feature SI puede hacer", () => {
    expect(leeLaAnalitica('import { claveDeAlcance } from "@/lib/analytics/cache-clave";')).toBe(false);
    expect(leeLaAnalitica('import { resolverAlcance } from "@/lib/analytics/alcance";')).toBe(false);
    expect(usaStartOfDayCR('import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";')).toBe(
      false,
    );
    expect(resuelveAlcancePorSuCuenta('case "mensajero": return denegado;')).toBe(false);
    expect(usaFindMany("await this.prisma.$queryRaw`SELECT 1`;")).toBe(false);
  });
});

describe("(e) la feature no modifica `lib/analytics/`", () => {
  it("ningun archivo de la feature vive bajo `lib/analytics/`", () => {
    expect(ARBOL.filter(({ ruta }) => ruta.startsWith("lib/analytics/")).map((a) => a.ruta)).toEqual(
      [],
    );
  });

  it("`lib/analytics/` no sabe que esta feature existe: ni un modulo la nombra en codigo", () => {
    // La direccion permitida es servicio -> analytics (lo fija `modulo-puro.guardia`). Si
    // algun modulo de analitica nombrara el tablero del dia, es que se toco para acomodarlo:
    // eso es exactamente lo que (e) prohibe, y se ve sin mirar el diff.
    const contaminados = archivosTs("lib/analytics").filter((rel) =>
      /TableroDia|tablero-dia|tablero_dia/.test(codigoDe(rel)),
    );
    expect(contaminados, "un modulo de analitica se adapto al tablero del dia").toEqual([]);
  });

  it("el censo de `lib/analytics/` NO es vacio y el detector marca de verdad", () => {
    expect(archivosTs("lib/analytics").length).toBeGreaterThan(10);
    expect(/TableroDia|tablero-dia/.test(codigoDe("lib/services/TableroDiaService.ts"))).toBe(true);
  });
});

describe("(f) R48 · el vocabulario visual del estatus se importa, no se reescribe", () => {
  it("ningun archivo de la feature declara un segundo mapa de estatus -> etiqueta", () => {
    expect(
      infractores(declaraEtiquetasDeEstatus),
      "R48: las etiquetas legibles viven en `ORDER_STATUS_LABELS` " +
        "(`app/(app)/ordenes/_components/EstatusBadge.tsx`) y se consumen via `EstatusBadge` " +
        "o `estatusLabel`. Un segundo mapa se queda atras en el siguiente cambio de catalogo " +
        "y el detalle acaba llamando a un estatus por un nombre que el listado ya no usa.",
    ).toEqual([]);
  });

  it("ningun archivo de la feature declara un segundo juego de colores de estatus", () => {
    expect(
      infractores(declaraColoresDeEstatus),
      "R48: la variante y el refuerzo de color por estatus los pone `EstatusBadge`. Un " +
        "segundo juego hace que el mismo estatus se vea de dos colores segun la pantalla.",
    ).toEqual([]);
  });

  it("la clausula NO es vacia: la feature SI consume el vocabulario del listado", () => {
    const consumidores = infractores((codigo) =>
      new RegExp(IMPORTA + "ordenes/_components/(?:EstatusBadge|estatus-label)").test(codigo),
    );
    expect(
      consumidores.length,
      "si nadie importara `EstatusBadge`/`estatusLabel`, las dos clausulas de arriba serian " +
        "verdes por vacio: no habria estatus que pintar en ningun sitio.",
    ).toBeGreaterThan(0);
  });

  it("los detectores NO son vacios: marcan el mapa y los colores REALES del listado", () => {
    const badge = codigoDe("app/(app)/ordenes/_components/EstatusBadge.tsx");
    expect(declaraEtiquetasDeEstatus(badge)).toBe(true); // ORDER_STATUS_LABELS
    expect(declaraColoresDeEstatus(badge)).toBe(true); // ORDER_STATUS_VARIANT + _CLASS
    // Y no marcan lo que NO es ni etiqueta ni color: el mapa estatus -> bucket (R43) y el
    // mapa resultado -> contador del repositorio siguen siendo legitimos.
    expect(declaraEtiquetasDeEstatus('{ por_recoger: "sinRecoger" }')).toBe(false);
    expect(declaraColoresDeEstatus('{ por_recoger: "sinRecoger" }')).toBe(false);
    expect(declaraEtiquetasDeEstatus('{ en_reparto: "En reparto" }')).toBe(true);
    expect(declaraColoresDeEstatus('{ entregada: "bg-green-500" }')).toBe(true);
    expect(declaraColoresDeEstatus('{ entregada: "success" }')).toBe(true);
    expect(VALUES_DE_ESTATUS.length).toBeGreaterThan(10);
  });
});
