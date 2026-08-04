// Feature 132 (T5.2) — GUARDIA ESTATICO del tablero financiero: R3, R10, R25, R27.
//
// Censo de archivos, no de intenciones. Los cuatro fallos que este guardia vigila
// tienen en comun que NO los detecta ningun otro gate del repo:
//
//  - R3, quien ve la region financiera. El requisito NO es de comportamiento sino
//    de FUENTE UNICA: el conjunto de roles debe derivarse de `esAccesoTotal` y del
//    catalogo, no de una lista escrita de nuevo aqui. Mientras esa lista a mano
//    COINCIDA con `esAccesoTotal` —y hoy coincide— ninguna asercion de salida
//    puede separarlas: los dos codigos renderizan exactamente lo mismo para los
//    seis roles. La violacion solo se ve mirando el fuente, y por eso la caza este
//    censo y no un test de pagina.
//
//  - R10, la frontera RSC. Un `"use client"` en la pagina o en un componente de
//    la region compila, pasa los tests de jsdom y REVIENTA `next build`, porque
//    arrastra el borde de la 127 (y con el, Prisma) al bundle del navegador. Y
//    una prop cuyo VALOR sea una funcion pasada de un Server Component a un
//    Client Component falla en RENDER, no en compilacion: ningun test unitario
//    que no monte ese arbol exacto la ve. La unica prop-funcion del contrato de
//    la 130 es `avisoRecorte` (`components/private/analytics/tipos.ts`), y el
//    tablero NUNCA la pasa: `agruparCola` garantiza por construccion que no hay
//    recorte que anunciar.
//
//  - R25, la moneda. El guardia del paquete de la 130 censa literales de moneda
//    y de locale DENTRO de `components/private/analytics/`, pero no mira `app/`.
//    Con la configuracion por defecto del repo, un simbolo escrito a mano y
//    `formatearValor(...)` producen strings byte-identicos: ninguna asercion de
//    salida puede separarlos, y por eso hace falta censar el fuente.
//
//  - R27, la lista de metricas. `IDS_FINANCIERAS_SERVIDAS` es la fuente unica y
//    esta atada al catalogo por el guardia de correspondencia de la 127. Una
//    lista de ids reescrita a mano en la pantalla se desincroniza en silencio.
//
// AUTOCOMPROBACION: los cinco censos se ejercitan ademas contra texto sintetico
// que SI contiene el patron prohibido (deben detectarlo) y contra texto limpio
// (no deben detectarlo). Sin eso, un censo roto —una ruta mal calculada, un
// regex que dejo de casar— seguiria en verde para siempre por vacio. Es el mismo
// patron del bloque final de `tests/unit/analytics/modulo-puro.guardia.test.ts`.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Import de VALOR, no de tipo: el censo de R3 necesita los nombres de rol EN
// RUNTIME y escribirlos aqui cometeria el mismo pecado que persigue. Es el mismo
// import que hace `lib/auth/acceso-total.ts`, la fuente que el requisito defiende.
import { RolValue } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { IDS_FINANCIERAS_SERVIDAS } from "@/lib/types/analitica-financiera";

const RAIZ = process.cwd();
const DIR_ANALITICA = path.join(RAIZ, "app", "(app)", "analitica");
const DIR_FINANCIERO = path.join(DIR_ANALITICA, "_components", "financiero");

/**
 * Este mismo archivo queda FUERA del censo, igual que hace
 * `tests/unit/components/analytics-paquete-guard.test.ts` con el suyo: un guardia
 * contiene por fuerza los patrones que persigue, porque su trabajo es buscarlos.
 * Hoy la exclusion es redundante (el guardia vive en `tests/` y el censo mira
 * `app/`), y se deja escrita para que siga siendo cierta si alguien mueve algo.
 */
const ESTE_GUARDIA = "tests/unit/guards/tablero-financiero.guardia.test.ts";

/* -------------------------------------------------------------------------- */
/* Utilidades de censo                                                         */
/* -------------------------------------------------------------------------- */

function recorrer(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entrada) => {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) return recorrer(completo);
    return [".ts", ".tsx"].includes(path.extname(completo)) ? [completo] : [];
  });
}

function relativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/**
 * Quita comentarios de bloque y de linea antes de censar. Misma decision (y
 * mismas dos sustituciones) que `modulo-puro.guardia.test.ts` y que el guardia
 * del paquete: la documentacion de estos archivos esta OBLIGADA a nombrar lo que
 * no debe usarse —las cabeceras de `TableroFinanciero.tsx` y de `cargar.ts`
 * declaran por escrito que no pasan `avisoRecorte` ni escriben la lista de ids—
 * y censar el texto crudo convertiria el contrato escrito en una violacion.
 *
 * Los STRINGS NO se ignoran: un simbolo de moneda o un id de metrica escritos a
 * mano viven precisamente dentro de comillas.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

interface ArchivoCensado {
  readonly ruta: string;
  readonly codigo: string;
}

/**
 * Los archivos de la feature: TODA la carpeta `financiero/` (se recorre, no se
 * escribe a mano: un archivo nuevo entra solo en el censo), mas el shell y la
 * pagina, que son los otros dos archivos de servidor que esta feature toca.
 */
const CENSADOS: readonly ArchivoCensado[] = [
  ...recorrer(DIR_FINANCIERO),
  path.join(DIR_ANALITICA, "_components", "AnaliticaShell.tsx"),
  path.join(DIR_ANALITICA, "page.tsx"),
]
  .filter((archivo) => relativa(archivo) !== ESTE_GUARDIA)
  .map((archivo) => ({
    ruta: relativa(archivo),
    codigo: soloCodigo(readFileSync(archivo, "utf8")),
  }));

/* -------------------------------------------------------------------------- */
/* Los cuatro censos, como funciones puras para poder autocomprobarlos         */
/* -------------------------------------------------------------------------- */

/** (a) R10 — la directiva de cliente, ignorando su mencion en un comentario. */
function declaraUseClient(codigo: string): boolean {
  return /(^|\s)["']use client["']\s*;?/.test(soloCodigo(codigo));
}

/**
 * (b) R10 — props cuyo VALOR es una funcion, en un atributo JSX.
 *
 * Tres formas, que son las que de verdad aparecen escritas:
 *   1. `avisoRecorte=` — la unica prop-funcion del contrato de la 130, por nombre;
 *   2. `prop={(x) => …}` / `prop={async () => …}` / `prop={function () {}}`;
 *   3. `onAlgo={…}` — el manejador de evento, que por convencion de React es
 *      siempre una funcion aunque llegue como identificador suelto.
 *
 * NO se marca `prop={identificador}` en general: `paneles={paneles}` y
 * `datos={datos}` son datos planos, y prohibirlos marcaria todo el archivo.
 */
function propsFuncionEnJsx(codigo: string): string[] {
  const limpio = soloCodigo(codigo);
  const patrones: readonly RegExp[] = [
    /\bavisoRecorte\s*=/g,
    /\b[A-Za-z_$][\w$]*\s*=\s*\{\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\b[A-Za-z_$][\w$]*\s*=\s*\{\s*(?:async\s+)?function\b/g,
    /\bon[A-Z][\w$]*\s*=\s*\{/g,
  ];
  return patrones.flatMap((patron) => limpio.match(patron) ?? []);
}

/** (c) R25 — simbolo de moneda, codigo ISO o literal de locale. */
const MONEDA_Y_LOCALE: readonly { readonly patron: RegExp; readonly motivo: string }[] = [
  { patron: /[₡€£¥]/, motivo: "escribe un simbolo de moneda" },
  // `$` es legitimo dentro de `${…}` de un template literal y en ningun otro sitio.
  { patron: /\$(?!\{)/, motivo: "escribe un simbolo de moneda" },
  { patron: /\b(?:CRC|USD|EUR|GBP|JPY|MXN|COP|ARS|CLP|PEN)\b/, motivo: "escribe un codigo ISO" },
  { patron: /["'`][a-z]{2}-[A-Z]{2}["'`]/, motivo: "incrusta un literal de idioma" },
];

function literalesDeMonedaOLocale(codigo: string): string[] {
  const limpio = soloCodigo(codigo);
  return MONEDA_Y_LOCALE.filter(({ patron }) => patron.test(limpio)).map(({ motivo }) => motivo);
}

/**
 * (d) R27, primera mitad — la declaracion de dominio del catalogo.
 *
 * El regex se MONTA POR CONCATENACION a proposito. `modulo-puro.guardia.test.ts`
 * censa `app/`, `lib/`, `components/` y `scripts/` buscando ese literal; este
 * archivo vive en `tests/` y queda fuera de aquel censo, pero escribir el patron
 * entero aqui lo dejaria listo para propagarse en el primer copiar-pegar a una
 * carpeta que SI se censa. Partido en trozos, el literal prohibido no existe en
 * ningun punto de este fuente y el regex es exactamente el mismo en runtime.
 */
const CAMPO_DOMINIO = "domi" + "nio";
const VALOR_FINANCIERA = "finan" + "ciera";
const VALOR_OPERATIVA = "opera" + "tiva";
const RE_DECLARACION_DOMINIO = new RegExp(
  `\\b${CAMPO_DOMINIO}\\s*:\\s*["'](?:${VALOR_OPERATIVA}|${VALOR_FINANCIERA})["']`,
);

function declaraDominioDeCatalogo(codigo: string): boolean {
  return RE_DECLARACION_DOMINIO.test(soloCodigo(codigo));
}

/**
 * (d) R27, segunda mitad — una lista de ids financieros escrita a mano.
 *
 * Se buscan los literales de array del fuente y se cuentan cuantos de los ocho
 * ids SERVIDOS aparecen entrecomillados dentro del mismo. Con dos o mas ya es una
 * lista: es la forma en que se reescribe el catalogo sin darse cuenta. Un id
 * suelto (una comparacion, una clave de test) no cuenta.
 *
 * Los ids no se escriben aqui: se importan de `IDS_FINANCIERAS_SERVIDAS`, que es
 * la misma fuente unica que el censo defiende.
 */
function listasDeIdsAMano(codigo: string): string[] {
  const limpio = soloCodigo(codigo);
  const arrays = limpio.match(/\[[^[\]]*\]/g) ?? [];
  return arrays.filter((bloque) => {
    const presentes = IDS_FINANCIERAS_SERVIDAS.filter((id) =>
      new RegExp(`["'\`]${id}["'\`]`).test(bloque),
    );
    return presentes.length >= 2;
  });
}

/**
 * (e) R3 — una lista de roles escrita a mano.
 *
 * Misma forma que `listasDeIdsAMano`: se buscan los literales de array del fuente
 * y se cuenta cuantos valores del dominio aparecen ENTRECOMILLADOS dentro del
 * mismo bloque. Con dos o mas ya es una lista de roles, que es exactamente la
 * forma en que se redefine "quien ve el dinero" sin darse cuenta. Un rol suelto
 * (una comparacion, una clave) no cuenta.
 *
 * Los nombres de rol NO se escriben aqui: salen de `RolValue`, la misma fuente de
 * la que sale `ROLES_ACCESO_TOTAL`. Un guardia que reescribiera la lista de roles
 * cometeria el pecado que persigue y ademas quedaria ciego ante un rol nuevo.
 */
const ROLES_DEL_DOMINIO: readonly string[] = Object.values(RolValue);

function listasDeRolesAMano(codigo: string): string[] {
  const limpio = soloCodigo(codigo);
  const arrays = limpio.match(/\[[^[\]]*\]/g) ?? [];
  return arrays.filter((bloque) => {
    const presentes = ROLES_DEL_DOMINIO.filter((rol) =>
      new RegExp(`["'\`]${rol}["'\`]`).test(bloque),
    );
    return presentes.length >= 2;
  });
}

/* -------------------------------------------------------------------------- */
/* Contrapeso de cobertura                                                     */
/* -------------------------------------------------------------------------- */

describe("cobertura del censo · mira archivos de verdad", () => {
  it("censa la carpeta financiero entera, el shell y la pagina", () => {
    const rutas = CENSADOS.map(({ ruta }) => ruta);
    expect(rutas.length).toBeGreaterThan(0);

    for (const nombre of [
      "rango.ts",
      "adaptar.ts",
      "cargar.ts",
      "TableroFinanciero.tsx",
      "PanelConciliacion.tsx",
    ]) {
      expect(
        rutas.includes(`app/(app)/analitica/_components/financiero/${nombre}`),
        `el censo no esta mirando ${nombre}`,
      ).toBe(true);
    }
    expect(rutas).toContain("app/(app)/analitica/_components/AnaliticaShell.tsx");
    expect(rutas).toContain("app/(app)/analitica/page.tsx");
  });

  it("la carpeta financiero se RECORRE: un archivo nuevo entra en el censo solo", () => {
    // Si esto se rompiera, alguien sustituyo el recorrido por una lista escrita a
    // mano y el guardia dejaria de ver los archivos que se añadan despues.
    const delDirectorio = recorrer(DIR_FINANCIERO).map(relativa);
    const censadas = CENSADOS.map(({ ruta }) => ruta);
    for (const ruta of delDirectorio) {
      expect(censadas, `${ruta} esta en la carpeta pero no en el censo`).toContain(ruta);
    }
    expect(delDirectorio.length).toBeGreaterThanOrEqual(5);
  });

  it("ningun archivo censado quedo vacio al retirar comentarios", () => {
    for (const { ruta, codigo } of CENSADOS) {
      expect(codigo.trim().length, `${ruta} quedo vacio: el censo no mira nada`).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (a) y (b) — R10, la frontera RSC                                            */
/* -------------------------------------------------------------------------- */

describe("R10 · frontera RSC", () => {
  it("ningun archivo de la feature declara use client", () => {
    const infractores = CENSADOS.filter(({ codigo }) => declaraUseClient(codigo)).map(
      ({ ruta }) => ruta,
    );
    expect(infractores, "declaran use client: arrastrarian el borde financiero al navegador").toEqual(
      [],
    );
  });

  it("ningun archivo pasa avisoRecorte ni ninguna otra prop-funcion a un componente cliente", () => {
    const infractores = CENSADOS.flatMap(({ ruta, codigo }) =>
      propsFuncionEnJsx(codigo).map((coincidencia) => `${ruta}: ${coincidencia.trim()}`),
    );
    expect(
      infractores,
      "una funcion no cruza la frontera RSC: falla en render, no en compilacion",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* (c) — R25, la moneda no se escribe                                          */
/* -------------------------------------------------------------------------- */

describe("R25 · el formato de dinero lo resuelve el paquete, no la pantalla", () => {
  it("ningun archivo escribe un simbolo de moneda, un codigo ISO ni un locale", () => {
    const infractores = CENSADOS.flatMap(({ ruta, codigo }) =>
      literalesDeMonedaOLocale(codigo).map((motivo) => `${ruta}: ${motivo}`),
    );
    expect(infractores).toEqual([]);
  });

  it("los archivos que pintan importes formatean con la funcion del paquete", () => {
    // Contrapeso del caso anterior: sin esto, un tablero que no pintara NINGUNA
    // cifra tambien pasaria el censo de literales.
    const conFormato = CENSADOS.filter(({ codigo }) => /\bformatearValor\s*\(/.test(codigo));
    expect(conFormato.length, "nadie formatea: el censo de R25 estaria pasando por vacio").toBeGreaterThan(
      0,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* (d) — R27, el catalogo no se reescribe                                      */
/* -------------------------------------------------------------------------- */

describe("R27 · la lista de metricas financieras tiene una sola fuente", () => {
  it("ningun archivo declara el dominio del catalogo", () => {
    const infractores = CENSADOS.filter(({ codigo }) => declaraDominioDeCatalogo(codigo)).map(
      ({ ruta }) => ruta,
    );
    expect(
      infractores,
      "declaran el dominio a mano: ademas pondrian rojo el guardia de fuente unica de la 135",
    ).toEqual([]);
  });

  it("ningun archivo escribe una lista de ids financieros a mano", () => {
    const infractores = CENSADOS.flatMap(({ ruta, codigo }) =>
      listasDeIdsAMano(codigo).map((bloque) => `${ruta}: ${bloque.slice(0, 80)}`),
    );
    expect(infractores, "reescriben IDS_FINANCIERAS_SERVIDAS").toEqual([]);
  });

  it("alguien consume IDS_FINANCIERAS_SERVIDAS: la lista se usa, no se copia", () => {
    expect(
      CENSADOS.some(({ codigo }) => codigo.includes("IDS_FINANCIERAS_SERVIDAS")),
      "nadie consume la fuente unica: el censo de R27 estaria pasando por vacio",
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* (e) — R3, quien ve la region financiera sale de una sola fuente             */
/* -------------------------------------------------------------------------- */

describe("R3 · el conjunto de roles que ve la region financiera tiene una sola fuente", () => {
  it("la pagina decide con esAccesoTotal y no con una condicion propia", () => {
    const pagina = CENSADOS.find(({ ruta }) => ruta === "app/(app)/analitica/page.tsx");
    expect(pagina, "la pagina no esta en el censo").toBeDefined();
    expect(
      pagina?.codigo.includes("esAccesoTotal("),
      "la pagina dejo de llamar a esAccesoTotal: el censo de listas a mano pasaria por vacio",
    ).toBe(true);
  });

  it("ningun archivo escribe una lista de roles a mano", () => {
    const infractores = CENSADOS.flatMap(({ ruta, codigo }) =>
      listasDeRolesAMano(codigo).map((bloque) => `${ruta}: ${bloque.slice(0, 80)}`),
    );
    expect(
      infractores,
      "redefinen a mano quien ve el dinero, en vez de derivarlo de esAccesoTotal",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Autocomprobacion: cada censo, sobre texto prohibido y sobre texto limpio    */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion · el censo detecta lo que dice detectar", () => {
  it("(a) detecta la directiva use client y no su mencion en un comentario", () => {
    expect(declaraUseClient('"use client";\nexport function X() {}')).toBe(true);
    expect(declaraUseClient("'use client'\n")).toBe(true);
    expect(declaraUseClient('// este archivo no lleva "use client"\n')).toBe(false);
    expect(declaraUseClient('/* prohibido declarar "use client" aqui */\n')).toBe(false);
    expect(declaraUseClient('import { X } from "./x";\nexport const y = 1;\n')).toBe(false);
  });

  it("(b) detecta avisoRecorte, la arrow y el manejador en un atributo JSX", () => {
    const prohibidos = [
      "<GraficaBarras avisoRecorte={(m, r) => `${m}/${r}`} />",
      "<GraficaDonut avisoRecorte={textoDeRecorte} />",
      "<Tabla alPulsar={(fila) => abrir(fila)} />",
      "<Tabla alPulsar={async (fila) => abrir(fila)} />",
      "<Tabla alPulsar={fila => abrir(fila)} />",
      "<Tabla alPulsar={function () { return 1; }} />",
      "<Boton onClick={manejarClick} />",
    ];
    for (const caso of prohibidos) {
      expect(propsFuncionEnJsx(caso), caso).not.toEqual([]);
    }
  });

  it("(b) no marca las props de DATOS que el tablero si pasa hoy", () => {
    const legitimos = [
      "<TableroFinanciero paneles={paneles} />",
      "<KpiCard etiqueta={TEXTOS.neto} valor={aNumero(total.neto)} unidad={unidad} />",
      "<TablaResumen columnas={COLUMNAS_IMPORTE} filas={filasDeVista(vista)} vacio={TEXTO_VACIO} />",
      "<AnaliticaShell financiero={<TableroFinanciero paneles={paneles} />} />",
      "{paneles.map((panel) => seccionesDePanel(panel))}",
      "const total = { bruto: 1, neto: 2 };",
      "// <Grafica avisoRecorte={(m, r) => …} sigue prohibido",
    ];
    for (const caso of legitimos) {
      expect(propsFuncionEnJsx(caso), caso).toEqual([]);
    }
  });

  it("(c) detecta simbolo, ISO y locale, y admite el template literal", () => {
    expect(literalesDeMonedaOLocale('const t = "₡1.000";')).not.toEqual([]);
    expect(literalesDeMonedaOLocale('const t = "$1,000";')).not.toEqual([]);
    expect(literalesDeMonedaOLocale('const iso = "CRC";')).not.toEqual([]);
    expect(literalesDeMonedaOLocale('new Intl.NumberFormat("es-CR");')).not.toEqual([]);
    expect(literalesDeMonedaOLocale("const t = `${etiqueta}: ${cifra}`;")).toEqual([]);
    expect(literalesDeMonedaOLocale("const t = formatearValor(valor, unidad);")).toEqual([]);
  });

  it("(d) detecta la declaracion de dominio y no el TIPO homonimo", () => {
    // Los ejemplos se montan igual por concatenacion, para no dejar escrito el
    // literal prohibido ni siquiera dentro de un caso de prueba.
    expect(declaraDominioDeCatalogo(`{ id: "x", ${CAMPO_DOMINIO}: "${VALOR_FINANCIERA}" }`)).toBe(
      true,
    );
    expect(declaraDominioDeCatalogo(`{ ${CAMPO_DOMINIO}: '${VALOR_OPERATIVA}' }`)).toBe(true);
    expect(declaraDominioDeCatalogo(`readonly ${CAMPO_DOMINIO}: MetricaDominio;`)).toBe(false);
    expect(declaraDominioDeCatalogo(`${CAMPO_DOMINIO}?: MetricaDominio;`)).toBe(false);
    expect(
      declaraDominioDeCatalogo(`// no escribas ${CAMPO_DOMINIO}: "${VALOR_FINANCIERA}" aqui`),
    ).toBe(false);
  });

  it("(d) detecta una lista de ids a mano y no un id suelto", () => {
    const [primero, segundo] = IDS_FINANCIERAS_SERVIDAS;
    expect(listasDeIdsAMano(`const ids = ["${primero}", "${segundo}"];`)).not.toEqual([]);
    expect(listasDeIdsAMano(`const ids = ['${primero}','${segundo}'] as const;`)).not.toEqual([]);
    // Un unico id (una comparacion, una clave) no es una lista.
    expect(listasDeIdsAMano(`if (panel.id === "${primero}") return null;`)).toEqual([]);
    expect(listasDeIdsAMano(`const ids = ["${primero}"];`)).toEqual([]);
    expect(listasDeIdsAMano("const ids = IDS_FINANCIERAS_SERVIDAS;")).toEqual([]);
    expect(listasDeIdsAMano(`// ["${primero}", "${segundo}"] escrito en un comentario`)).toEqual([]);
  });

  it("(e) detecta una lista de roles a mano y no un rol suelto ni el TIPO", () => {
    // Los ejemplos se construyen A PARTIR de `RolValue`: si aqui se escribieran
    // los nombres, el caso seguiria en verde el dia que un rol se renombre.
    const [primero, segundo] = ROLES_DEL_DOMINIO;
    expect(listasDeRolesAMano(`if (!["${primero}", "${segundo}"].includes(actor.rol)) {}`)).not.toEqual(
      [],
    );
    expect(listasDeRolesAMano(`const roles = ['${primero}','${segundo}'] as const;`)).not.toEqual([]);
    // Casos LIMPIOS: los que de verdad aparecen hoy en el arbol.
    expect(listasDeRolesAMano(`if (actor.rol === "${primero}") return null;`)).toEqual([]);
    expect(listasDeRolesAMano(`const roles = ["${primero}"];`)).toEqual([]);
    expect(listasDeRolesAMano("const roles: readonly RolValue[] = ROLES_ACCESO_ANALITICA;")).toEqual(
      [],
    );
    expect(listasDeRolesAMano("if (!esAccesoTotal(actor.rol)) return <AnaliticaShell />;")).toEqual(
      [],
    );
    expect(
      listasDeRolesAMano(`// es una tupla literal (readonly ["${primero}","${segundo}"])`),
    ).toEqual([]);
  });

  it("(e) el dominio de roles se deriva de RolValue y cubre mas de un rol", () => {
    // Contrapeso: con un dominio vacio o de un solo elemento, el censo de (e) no
    // podria detectar nada y quedaria en verde para siempre.
    expect(ROLES_DEL_DOMINIO.length).toBeGreaterThanOrEqual(2);
    expect(ROLES_DEL_DOMINIO.every((rol) => rol.length > 0)).toBe(true);
  });
});
