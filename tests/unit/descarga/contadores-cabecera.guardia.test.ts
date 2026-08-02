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
  /**
   * Cola del Anexo III: su pantalla aun no pagina; al paginarla, este contador DEBE morir.
   *
   * Feature 170 — FASE 2 (T J.2): hoy NO queda ninguno. Las cuatro colas de riesgo MEDIO
   * pasaron a mostrar el `total` del servidor y sus entradas salieron del registro; el
   * tercer test de abajo comprueba que asi sigue. El estado se conserva en el vocabulario
   * porque es el que hay que usar si una tanda futura introduce una cola con contador antes
   * de paginarla — declararlo es lo que obliga a decidir en vez de dejarlo pasar.
   */
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
 * Los contadores `({X.length})` que quedan en el arbol, verificados contra el codigo.
 *
 * Eran SEIS cuando T H.3 escribio esta guardia: cuatro colas de riesgo MEDIO
 * (`design.md §11.3`) y dos vistas agrupadas del Anexo IV. Feature 170 — FASE 2 (T J.2)
 * pagino las cuatro colas y sus contadores pasaron a leer el `total` del servidor (R42), asi
 * que **desaparecieron del arbol y de este registro**. Quedan los DOS del Anexo IV, que no se
 * paginan a proposito y cuyo conteo por grupo sigue siendo correcto.
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
];

/**
 * Las cuatro colas de riesgo MEDIO, con el archivo donde vive su contador. Estaban en el
 * registro de arriba como `pendiente` hasta T J.2; ahora que muestran el `total` del servidor
 * la lista se conserva AQUI para que el tercer test pueda comprobar, una por una, que el
 * contador no volvio a salir de un array y que la pantalla se reconoce como paginada.
 */
const COLAS_TANDA_J: { ruta: string; listado: string }[] = [
  {
    ruta: "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
    listado: "Cierres del dia pendientes de decision",
  },
  {
    ruta: "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx",
    listado: "Cierres de bodega pendientes",
  },
  {
    ruta: "app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx",
    listado: "Cierres del dia a consolidar",
  },
  {
    ruta: "app/(app)/incidentes/_components/IncidentesAdminModule.tsx",
    listado: "Incidentes pendientes de decision",
  },
];

/** `({pagina.total})` — el contador de cabecera escrito como R42 lo exige. */
const CONTADOR_POR_TOTAL = /\(\{\s*[^{}]*?\.total\s*\}\)/;

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

    // Anti-vacuidad: hoy son 28 = 24 archivos que montan `<Pagination>` + 4 componentes de
    // tabla que esos archivos importan (el control vive a menudo en el modulo y el
    // `<DataTable>` en un hijo). Si el detector deja de reconocerlos, la guardia pasaria
    // verde sin mirar nada; este numero lo impide y solo puede SUBIR conforme las tandas K-L
    // paginen lo que queda del Anexo III.
    //
    // T H.3 lo dejo en 17 y la tanda I lo llevo a 24; T J.2 suma los CUATRO modulos de las
    // colas de riesgo MEDIO, que montan su control en el propio archivo (Q-I6) justo para
    // que esta guardia los vea.
    expect(paginadas.size, "no se reconocio ninguna pantalla paginada").toBeGreaterThanOrEqual(
      28,
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

    // Eran 6 hasta T J.2; las 4 colas de riesgo MEDIO dejaron de contar su array.
    expect(enArbol).toHaveLength(2);
  });

  it("las cuatro colas de la tanda J muestran el total del servidor, y su pantalla se vigila", () => {
    // El cierre de la deuda que T H.3 dejo escrita. Tres afirmaciones, y ninguna sobra:
    //
    //  (a) ya no queda ningun contador `pendiente` en el registro — o sea, ninguna cola del
    //      Anexo III sigue contando su array a la espera de una tanda futura;
    //  (b) cada uno de los cuatro modulos es una PANTALLA PAGINADA a ojos de esta guardia.
    //      Es la respuesta a Q-I6: la guardia mira del archivo que monta `<Pagination>` hacia
    //      los componentes que importa, nunca hacia arriba. Con el control en un hijo, el
    //      contador del padre quedaria fuera de su vista y podria volver a `.length` sin que
    //      el primer test lo notara. Por eso el control de estas cuatro vive EN el modulo;
    //  (c) y el contador de cada uno sale de un `.total`, no de un `.length` — el primer test
    //      prohibe el patron viejo, este exige el nuevo.
    expect(CENSO_CONTADORES.filter((c) => c.estado === "pendiente")).toEqual([]);

    const paginadas = pantallasPaginadas();
    for (const cola of COLAS_TANDA_J) {
      expect(
        paginadas.has(cola.ruta),
        `${cola.listado}: su modulo no monta el control, la guardia deja de mirarlo (Q-I6)`,
      ).toBe(true);
      const fuente = readFileSync(path.join(RAIZ, cola.ruta), "utf8");
      expect(
        CONTADOR_POR_TOTAL.test(fuente),
        `${cola.listado}: su contador no sale del total del servidor (R42)`,
      ).toBe(true);
    }
  });
});
