import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Feature 170 — FASE 2, T H.3 (R42): GUARDIA de los contadores de cabecera.
//
// El riesgo, verificado en el codigo: cuatro pantallas muestran hoy `({array.length})` junto
// al titulo de una cola (design §11.3). Mientras el array ES el conjunto entero, ese numero
// es correcto. En cuanto la pantalla pagine, el mismo codigo pasa a mostrar el tamano de la
// PAGINA —«Cierres pendientes (25)» con 300 cierres esperando— sin que nada falle: compila,
// renderiza y miente. R42 existe por eso, y una guardia estatica es la unica forma de que la
// prohibicion siga viva dentro de un ano.
//
// Como funciona, y por que no basta con «prohibir `.length` en la pantalla»:
//
//  - PANTALLA PAGINADA = un archivo de `app/` que monta `<Pagination>`, mas los componentes
//    de tabla que ese archivo importa (en este repo el control vive a menudo en el modulo y
//    el `<DataTable>` en un hijo: WalletModule/WalletLedger, MisPagosModule/DesglosePagos).
//  - En una pantalla paginada, NINGUN `({X.length})` vale... salvo los que el Anexo IV
//    declara: las vistas AGRUPADAS de gestiones no se paginan a proposito, y su contador por
//    grupo sigue siendo correcto. Sin esa distincion la guardia se pondria roja en la tanda I
//    en cuanto `CierreDiaModule` —que tiene las DOS cosas: una tabla que se pagina y un grupo
//    que no— reciba su control. Un test que hay que desactivar en la tanda siguiente no es
//    una guardia.
//  - Por eso el registro de abajo, mismo idioma que `censo-tablas.ts`: cada contador del
//    arbol figura con su decision escrita, y el registro se contrasta contra el codigo en los
//    dos sentidos (ni contadores sin registrar, ni registros que ya no existan).

const RAIZ = path.resolve(__dirname, "../../..");
const ARBOL_UI = "app";

/**
 * `({pendientes.length})` — el contador de cabecera, con la EXPRESION capturada.
 *
 * No se exige un identificador simple a proposito: `({(data?.items ?? []).length})` y
 * `({data.items.length})` son la misma mentira escrita distinto, y una guardia que solo
 * reconociera la forma bonita se esquivaria sin querer. Se captura todo lo que precede a
 * `.length` dentro del contenedor JSX.
 */
const CONTADOR_JSX = /\(\{\s*([^{}]*?)\.length\s*\}\)/g;

type EstadoContador =
  /** Listado del Anexo IV: NO se pagina, y su contador por grupo seguira siendo correcto. */
  | "sin_paginar"
  /** Cola del Anexo III: su pantalla aun no pagina; al paginarla, este contador DEBE morir. */
  | "pendiente";

interface ContadorCensado {
  /** Ruta relativa a la raiz del repo, con separador `/`. */
  ruta: string;
  /** Identificador del array del que sale el numero (`({pendientes.length})` -> `pendientes`). */
  identificador: string;
  /** Listado al que pertenece el contador, con el nombre del Anexo I. */
  listado: string;
  estado: EstadoContador;
  /** Motivo (si `sin_paginar`) o tanda que lo mata (si `pendiente`). Obligatorio siempre. */
  nota: string;
}

/**
 * Los SEIS contadores `({X.length})` del arbol, verificados contra el codigo. Cuatro son las
 * colas de riesgo MEDIO de `design.md §11.3` (la tabla de la tanda J) y dos son las vistas
 * agrupadas que el Anexo IV deja fuera de la paginacion.
 */
const CENSO_CONTADORES: ContadorCensado[] = [
  {
    ruta: "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
    identificador: "filas",
    listado: "Gestiones del cierre del dia por resultado (mensajero)",
    estado: "sin_paginar",
    nota:
      "Anexo IV: vista AGRUPADA en 4 listas; la seccion se OCULTA si su grupo esta vacio y el " +
      "encabezado lleva el conteo del grupo. El conjunto esta acotado por la jornada de UN " +
      "mensajero. Este contador sigue siendo correcto aunque el modulo pagine su OTRA tabla " +
      "(«Cierres solicitados», tanda I).",
  },
  {
    ruta: "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx",
    identificador: "filas",
    listado: "Gestiones de un cierre por resultado (detalle del admin)",
    estado: "sin_paginar",
    nota:
      "Anexo IV: mismo problema agrupado, dentro de un MODAL de detalle de UN cierre. " +
      "Acotado por la jornada de UN mensajero.",
  },
  {
    ruta: "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
    identificador: "pendientes",
    listado: "Cierres del dia pendientes de decision",
    estado: "pendiente",
    nota: "tanda J: pasa a mostrar el `total` del servidor (R42)",
  },
  {
    ruta: "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx",
    identificador: "pendientes",
    listado: "Cierres de bodega pendientes",
    estado: "pendiente",
    nota: "tanda J: pasa a mostrar el `total` del servidor (R42)",
  },
  {
    ruta: "app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx",
    identificador: "consolidables",
    listado: "Cierres del dia a consolidar",
    estado: "pendiente",
    nota: "tanda J: pasa a mostrar el `total` del servidor (R42)",
  },
  {
    ruta: "app/(app)/incidentes/_components/IncidentesAdminModule.tsx",
    identificador: "pendientes",
    listado: "Incidentes pendientes de decision",
    estado: "pendiente",
    nota: "tanda J: pasa a mostrar el `total` del servidor (R42)",
  },
];

function listarTsx(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarTsx(completo, acc);
    else if (entrada.name.endsWith(".tsx")) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

interface ContadorEnArbol {
  ruta: string;
  identificador: string;
}

/** Todos los `({X.length})` del arbol de UI, con el archivo donde viven. */
function contadoresDelArbol(): ContadorEnArbol[] {
  return listarTsx(path.join(RAIZ, ARBOL_UI))
    .sort()
    .flatMap((archivo) => {
      const fuente = readFileSync(archivo, "utf8");
      return [...fuente.matchAll(CONTADOR_JSX)].map((encontrado) => ({
        ruta: rutaRelativa(archivo),
        identificador: encontrado[1],
      }));
    });
}

/**
 * Resuelve los imports LOCALES de un archivo (`./Foo`, `../x/Foo`, `@/app/...`) a rutas de
 * `.tsx` existentes. Solo hace falta un nivel: el control de paginacion y la tabla estan a
 * un import de distancia en las tres pantallas del repo donde no comparten archivo.
 */
function importsLocales(archivo: string): string[] {
  const fuente = readFileSync(archivo, "utf8");
  const rutas: string[] = [];
  for (const encontrado of fuente.matchAll(/from\s+"((?:\.{1,2}\/|@\/)[^"]+)"/g)) {
    const especificador = encontrado[1];
    const base = especificador.startsWith("@/")
      ? path.join(RAIZ, especificador.slice(2))
      : path.resolve(path.dirname(archivo), especificador);
    const candidato = `${base}.tsx`;
    if (existsSync(candidato)) rutas.push(candidato);
  }
  return rutas;
}

/**
 * Pantallas con listado paginado: las que montan `<Pagination>` mas los componentes que
 * importan y montan un `<DataTable>` (donde viviria el contador de esa tabla).
 */
function pantallasPaginadas(): Set<string> {
  const paginadas = new Set<string>();
  for (const archivo of listarTsx(path.join(RAIZ, ARBOL_UI)).sort()) {
    const fuente = readFileSync(archivo, "utf8");
    if (!/<Pagination[\s/>]/.test(fuente)) continue;
    paginadas.add(rutaRelativa(archivo));
    for (const hijo of importsLocales(archivo)) {
      if (/<DataTable[\s<>]/.test(readFileSync(hijo, "utf8"))) paginadas.add(rutaRelativa(hijo));
    }
  }
  return paginadas;
}

function claveDe(contador: { ruta: string; identificador: string }): string {
  return `${contador.ruta} :: ({${contador.identificador}.length})`;
}

describe("guardia de contadores de cabecera (T H.3, R42)", () => {
  it("ninguna pantalla con listado paginado deriva su contador de la longitud del array", () => {
    const paginadas = pantallasPaginadas();

    // Anti-vacuidad: hoy son 17 = 13 archivos que montan `<Pagination>` + 4 componentes de
    // tabla que esos archivos importan (WalletLedger, GastosFijosPlantillasPanel,
    // DesgloseTiendaLedger y DesglosePagos). Si el detector deja de reconocerlos, la guardia
    // pasaria verde sin mirar nada; este numero lo impide y solo puede SUBIR conforme las
    // tandas I-L paginen las 13 pantallas del Anexo III.
    expect(paginadas.size, "no se reconocio ninguna pantalla paginada").toBeGreaterThanOrEqual(
      17,
    );

    const excluidos = new Set(
      CENSO_CONTADORES.filter((c) => c.estado === "sin_paginar").map(claveDe),
    );

    const infractores = contadoresDelArbol()
      .filter((c) => paginadas.has(c.ruta))
      .filter((c) => !excluidos.has(claveDe(c)))
      .map(claveDe);

    expect(
      infractores,
      "una pantalla paginada muestra el TOTAL del servidor, nunca el tamano de la pagina (R42)",
    ).toEqual([]);
  });

  it("el registro de contadores no se despega del codigo", () => {
    // En los dos sentidos, como `cobertura-tablas.guardia`:
    //  (a) todo contador del arbol figura en el registro -> uno nuevo obliga a DECIDIR si su
    //      pantalla pagina o no, en vez de aparecer en silencio;
    //  (b) todo registro existe en el arbol con su identificador -> una exclusion que ya no
    //      corresponde a nada deja de ser una excusa valida para el test de arriba.
    const enArbol = contadoresDelArbol();
    const claves = new Set(CENSO_CONTADORES.map(claveDe));

    const sinRegistrar = enArbol.filter((c) => !claves.has(claveDe(c))).map(claveDe);
    expect(
      sinRegistrar,
      "hay contadores sin registrar en tests/unit/descarga/contadores-cabecera.guardia.test.ts",
    ).toEqual([]);

    const clavesArbol = new Set(enArbol.map(claveDe));
    for (const censado of CENSO_CONTADORES) {
      expect(existsSync(path.join(RAIZ, censado.ruta)), `${censado.ruta} no existe`).toBe(true);
      expect(clavesArbol.has(claveDe(censado)), `${claveDe(censado)}: ya no esta en el codigo`).toBe(
        true,
      );
      expect(censado.nota, `${claveDe(censado)}: sin motivo/tanda declarados`).not.toBe("");
    }

    expect(enArbol).toHaveLength(6);
  });

  it("las cuatro colas de la tanda J siguen contando el array, y por eso siguen pendientes", () => {
    // La lista de trabajo de T J.2, tomada de `design.md §11.3`, verificada contra el codigo
    // en el test anterior. Cuando la tanda J las cablee, estas cuatro entradas desaparecen
    // del registro y el primer test pasa a vigilarlas de verdad.
    expect(
      CENSO_CONTADORES.filter((c) => c.estado === "pendiente").map((c) => c.listado),
    ).toEqual([
      "Cierres del dia pendientes de decision",
      "Cierres de bodega pendientes",
      "Cierres del dia a consolidar",
      "Incidentes pendientes de decision",
    ]);
  });
});
