// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import type { RolValue } from "@prisma/client";

import AnaliticaPage from "@/app/(app)/analitica/page";
import { cargarTableroFinanciero } from "@/app/(app)/analitica/_components/financiero/cargar";
import type { PanelFinanciero } from "@/app/(app)/analitica/_components/financiero/cargar";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import { listarUsuariosPorRol } from "@/lib/actions/usuarios-por-rol";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  ROLES_ACCESO_ANALITICA,
  ROLES_SIN_ACCESO_ANALITICA,
} from "@/lib/auth/menu-visibility";
import { listarMetricas } from "@/lib/analytics/metrics";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import type { RolAnalitica } from "@/lib/analytics/types";
import type { ResultadoFinancieroVistas } from "@/lib/types/analitica-financiera";
import { importeConNeto } from "@/tests/fixtures/importe-analitico";

// Feature 129 (R1-R6, R24) — la PÁGINA de analítica resuelve el rol SOLO
// server-side. La entrada del menú decide qué se MUESTRA; ESTA es la defensa real.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// Feature 132 (R9) — el CARGADOR financiero se sustituye por un doble. Es el
// único punto de la página que habla con el borde de la 127, y dejarlo vivo
// arrastraría el Server Action y Prisma a un test de jsdom. Mockearlo además es
// lo que permite AFIRMAR sobre las llamadas: cuántas veces se consultó el dinero
// y para qué rol (ver el bloque de R9 más abajo).
vi.mock("@/app/(app)/analitica/_components/financiero/cargar", () => ({
  cargarTableroFinanciero: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}

/**
 * Feature 133 (T6.5) — la URL del navegador, ahora MUTABLE.
 *
 * Antes el mock devolvía siempre `new URLSearchParams()`. Sigue siendo lo que ve
 * cualquier caso que no toque `estadoUrl` (el `beforeEach` global la vacía), así que
 * ningún test anterior cambia de comportamiento. Lo que se gana es poder poner un
 * filtro SELECCIONADO en la URL, que es la única vía por la que la etiqueta de una
 * opción de catálogo llega a pintarse en la barra (`MultiSelectFilter` sólo escribe el
 * `label` de lo seleccionado; las opciones no seleccionadas viven en el desplegable
 * cerrado). Sin eso, la aserción de R23 pasaría por vacío.
 *
 * `vi.hoisted` porque el factory de `vi.mock` se iza por encima de las declaraciones
 * del módulo.
 */
const estadoUrl = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  // Feature 131 (T6.2): el árbol de cliente que la 131 enchufa en los dos slots lee el
  // filtro de la URL (design §4.2). Es un mock del NAVEGADOR, no de una capa de datos.
  useSearchParams: () => estadoUrl.params,
  usePathname: () => "/analitica",
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Feature 131 (T6.2) — los mocks del nuevo árbol de CLIENTE. Ojo con lo que esto NO
// significa: la PÁGINA sigue sin importar `lib/actions` (R24 de la 129, comprobado sobre
// el código fuente más abajo). Quien invoca estas acciones son `FiltrosOperativos` y
// `PanelesOperativos`, que son componentes de cliente con su propio SWR; mockearlas aquí
// es lo que evita que jsdom intente arrancar Prisma al montarlos.
vi.mock("@/lib/actions/analitica-operativa", () => ({
  consultarAnaliticaOperativa: vi.fn(async () => ({ status: "forbidden" as const })),
}));
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(async () => ({ status: "forbidden" as const })),
}));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarUsuariosPorRol: vi.fn(async () => ({ status: "forbidden" as const })),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);
const cargarMock = vi.mocked(cargarTableroFinanciero);

/**
 * Feature 132 — el DTO que devuelve el doble del cargador.
 *
 * Lleva a propósito una etiqueta de métrica y una cifra de dinero RECONOCIBLES:
 * son exactamente los textos que R2 exige que NO aparezcan para un rol sin
 * acceso. Un doble que devolviera `[]` haría pasar el test de R2 por vacío.
 *
 * Feature 183 ⟨D12⟩ (humano, 2026-08-04) — la métrica de la fixture pasa de
 * `ingreso_flete` a `egresos`: desde esa decisión `ingreso_flete` publica **solo
 * bruto**, y con ella el panel pintaría UNA cifra. Las DOS son el punto de este
 * archivo (R2 exige que ninguna deje rastro), así que la fixture se muda a una métrica
 * que sigue publicando las dos en vez de perder la mitad de la aserción. El id, la
 * etiqueta, la fuente y la vista son los de `egresos`; las cifras no cambian.
 */
const ETIQUETA_METRICA = "Egresos del período";
const CIFRA_BRUTA = "918273.45";
const CIFRA_NETA = "817263.45";

const RANGO = { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" } as const;

/** Los cubos diarios de `RANGO`, derivados de el: los mismos que `trocear` produciria. */
const CUBOS_DEL_RANGO: readonly string[] = (() => {
  const MS_POR_DIA = 86_400_000;
  const fin = Date.parse(`${RANGO.hastaFecha}T00:00:00Z`);
  const cubos: string[] = [];
  for (let t = Date.parse(`${RANGO.desdeFecha}T00:00:00Z`); t <= fin; t += MS_POR_DIA) {
    cubos.push(new Date(t).toISOString().slice(0, 10));
  }
  return cubos;
})();

const DATOS_FINANCIEROS: ResultadoFinancieroVistas = {
  tipo: "vistas",
  metricaId: "egresos",
  etiqueta: ETIQUETA_METRICA,
  unidad: "moneda",
  rango: RANGO,
  esAcumulado: false,
  vistas: [
    {
      id: "egresos__total",
      grano: "fecha",
      fuente: "wallet_movimiento",
      sumableCon: [],
      // Feature 180 (R4): `granularidad` es REQUERIDA en toda vista. Grano `fecha` sobre un
      // rango de 30 dias: `dia`.
      //
      // HOTFIX 2026-08-06 — esta fixture declaraba `filas: []` y decia «la pagina NO la
      // consume». Las dos cosas eran falsas desde la 180: `serieDensa` emite UNA fila por
      // cubo del rango (cubos sin movimiento incluidos), y la pagina renderiza
      // `TableroFinanciero`, que decide KPI vs. tabla precisamente por `granularidad`. Se
      // pone la serie densa de verdad para que este archivo mida el DTO que el servicio
      // produce y no el que producia hace dos features. El detalle de esa decision se prueba
      // en `tests/components/TableroFinanciero.test.tsx`; aqui lo unico que importa es que el
      // DTO sea REAL, porque de el salen las cifras que R2 exige que no dejen rastro.
      granularidad: "dia",
      filas: CUBOS_DEL_RANGO.map((cubo, indice) => ({
        cubo,
        importe: importeConNeto(`${(indice + 1) * 7}.13`, `-${(indice + 1) * 3}.17`, "__sin_leer__"),
      })),
      total: importeConNeto(CIFRA_BRUTA, CIFRA_NETA, "__sin_leer__"),
    },
  ],
};

const PANELES: readonly PanelFinanciero[] = [
  { estado: "ok", id: "egresos", datos: DATOS_FINANCIEROS },
];

/** Los SEIS `RolValue` del esquema, uno a uno. Ninguno se agrupa ni se omite. */
const TODOS_LOS_ROLES = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
  "apiKey",
] as RolValue[];

/* ────────────────────────────────────────────────────────────────────────────
 * Feature 133 (T3.2) — LOS SEIS ROLES, REPARTIDOS POR LO QUE LA 133 DECIDE.
 *
 * Hasta la 132 este archivo sólo necesitaba dos listas: «los que entran» y «los que
 * reciben `notFound()`». La 133 abre la ruta a tres roles más (D1: el conjunto de
 * ACCESO pasa a DERIVARSE del conjunto del DOMINIO), y con eso aparece una tercera
 * categoría que antes no existía: el rol que ENTRA a la página pero NO ve el dinero.
 *
 * Las tres listas se escriben A MANO —no se derivan de `ROLES_ACCESO_ANALITICA` ni de
 * `esAccesoTotal`— justamente para que sigan siendo un oráculo independiente: un test
 * que derivase su expectativa de la misma constante que juzga pasaría por tautología
 * (el pecado que D7 documenta en `HomePageMaestro.test.tsx:150`). El contrapeso que
 * impide que una de las tres se quede corta está unas líneas más abajo, en el caso
 * «los seis RolValue quedan cubiertos».
 * ──────────────────────────────────────────────────────────────────────────── */

/** Entran Y ven la región financiera (`esAccesoTotal`). */
const ROLES_ACCESO_TOTAL = ["maestro", "admin"] as RolValue[];

/**
 * Entran a la ruta (133) y NO ven ni un rastro del dinero (R6, R7, R8).
 *
 * 2026-08-12 (decisión del humano): el `mensajero` SE VA de esta lista a la de abajo.
 * Los dos que quedan siguen ejerciendo el camino completo —entran, se pinta el tablero
 * operativo, no hay dinero—, así que ninguna de las mutaciones que este archivo mata
 * deja de medirse: sigue habiendo al menos un rol que ENTRA sin acceso total, que es
 * lo que la 133 hizo posible medir.
 */
const ROLES_ACOTADOS_QUE_ENTRAN = ["adminTienda", "adminSatelite"] as RolValue[];

/**
 * No entran: reciben `notFound()`. `apiKey` NUNCA consume analítica
 * (`ROLES_SIN_ANALITICA`, R11 de la 122) y la sesión ausente/inválida tampoco (R1).
 *
 * 2026-08-12: entra aquí el `mensajero`. Ojo con leerlo de más: NO pierde su alcance en
 * el catálogo de la 135 (sigue declarado métrica a métrica), pierde la PUERTA — el ítem
 * del sidebar y el gate de la ruta, que son la misma constante.
 */
const ROLES_SIN_ENTRADA = ["apiKey", "mensajero"] as RolValue[];

beforeEach(() => {
  vi.clearAllMocks();
  cargarMock.mockResolvedValue(PANELES);
  // Feature 133 (T6.5) — la URL vuelve a estar vacía para cada caso, que es lo que veía
  // todo test escrito antes de que este mock fuese mutable.
  estadoUrl.params = new URLSearchParams();
});
afterEach(cleanup);

// R5: `AnaliticaPage` no acepta argumentos. Se tipa aquí como una función que sí
// los acepta para poder invocarla "a la fuerza" con un objeto arbitrario (como si
// fuera props/searchParams) y demostrar que ni siquiera así puede colarse un rol
// autorizado por esa vía.
const invocarConArgumento = AnaliticaPage as unknown as (
  arg?: unknown,
) => Promise<ReactElement>;

async function renderPage(props?: unknown) {
  render(await invocarConArgumento(props));
}

/* ==========================================================================
 * 2026-08-19 — LA PANTALLA SE REDUJO A PROPÓSITO. Léelo antes de tocar nada.
 * ==========================================================================
 *
 * `AnaliticaShell.tsx` tiene sus TRES <section> ("Filtros", "Tablero operativo",
 * "Tablero financiero") COMENTADAS desde el commit 91ea5618. Hoy el shell pinta el slot
 * `destacado` y descarta `filtros`, `operativo` y `financiero`, que `page.tsx` le sigue
 * pasando. La reducción es una DECISIÓN HUMANA del 2026-08-19, no una avería.
 *
 * Consecuencia para este archivo: `getByRole("region", …)` dejó de tener sujeto. Los casos
 * se reparten en dos:
 *  - los que medían OTRA cosa y sólo usaban la región como prueba de que la página se
 *    pintó: se RE-ANCLAN a `afirmarCuerpoPintado()` y siguen ACTIVOS;
 *  - los que medían las regiones mismas (o el tablero financiero, que vive en una de
 *    ellas): quedan INERTES con `.skip` y su motivo al lado. NO se borran — el día que
 *    se descomenten las secciones hay que devolverlos a la vida, y sin ellos nadie se
 *    acordaría de reescribirlos.
 *
 * PARA REACTIVARLOS: descomentar las tres <section> de `AnaliticaShell.tsx` y quitar el
 * `.skip` de los bloques marcados con NOTA_SHELL_REDUCIDO.
 */
const NOTA_SHELL_REDUCIDO =
  "INERTE 2026-08-19: su sujeto son las <section> del shell, comentadas en " +
  "AnaliticaShell.tsx desde 91ea5618 por decisión humana. Reactivar al descomentarlas.";

/** El título de la sección que HOY pinta el único slot vivo (`destacado`). */
const TITULO_SECCION_ENTREGAS = "Detalle - Movimiento de las ordenes";

/**
 * ANTI-VACÍO. NO ES DECORACIÓN — no lo borres el día que estorbe.
 *
 * Media docena de casos de este archivo afirman AUSENCIAS: que no hay cifras de dinero,
 * que el cargador financiero no se llamó, que no asoma un nombre ajeno. Una ausencia
 * comprobada sobre un documento VACÍO es verde y no protege nada, así que cada uno de
 * esos casos ancla primero en algo que la pantalla SÍ pinta.
 *
 * El ancla ERA `getByRole("region", { name: "Filtros" | "Tablero operativo" })`. Se movió
 * el 2026-08-19 porque esas regiones se comentaron (ver la nota de arriba), NO porque
 * sobrara. Lo que se ancla ahora es el cuerpo que el slot `destacado` sí renderiza: la
 * barra de filtros de la sección de entregas y el título de esa sección.
 */
function afirmarCuerpoPintado() {
  expect(
    screen.getByRole("searchbox", { name: "Buscar sección" }),
  ).toBeInTheDocument();
  expect(screen.getByText(TITULO_SECCION_ENTREGAS)).toBeInTheDocument();
}

describe("Feature 129 (R1, R2) — maestro y admin ven el shell", () => {
  it.each(["maestro", "admin"] as RolValue[])(
    "el rol `%s` ve el encabezado y las dos regiones del tablero",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();

      expect(
        screen.getByRole("heading", { name: "Analítica" }),
      ).toBeInTheDocument();
      // Las dos regiones del shell ya no existen. Lo que este caso mide —que el rol
      // ENTRA y la página se pinta— sigue vivo, re-anclado al cuerpo real.
      afirmarCuerpoPintado();
    },
  );
});

// REEXPRESADO por la feature 133 (T3.2). ROJO POR DISEÑO, no relajación.
//
// QUÉ AFIRMABA: los cuatro roles restantes (`mensajero`, `adminTienda`, `adminSatelite`,
// `apiKey`) reciben `notFound()` y no se pinta nada.
//
// POR QUÉ SE PUSO ROJO: D1 de la 133 abre la ruta a los tres roles acotados. El caso no
// era falso, era VIEJO: describía un reparto de roles que la feature acaba de cambiar.
//
// QUÉ MUTACIÓN SEGUÍA MATANDO Y SIGUE MATANDO: «el gate concede a quien no está en el
// conjunto». Esa mutación no se ha tocado — sólo se ha movido la frontera. `apiKey` y la
// sesión ausente siguen midiéndola (R1 exige literalmente que se les siga denegando), y
// la mitad nueva mide la mutación SIMÉTRICA, que antes nadie medía: «el gate deniega a
// quien sí está en el conjunto». Volver `ROLES_ACCESO_ANALITICA` a `["maestro","admin"]`
// pone rojos los tres casos de abajo.
//
// NO SE RELAJA: se reparte. Ningún rol sale de la enumeración (el contrapeso de los seis
// `RolValue` lo vigila) y ningún caso pasa por vacío: los que entran afirman que el shell
// se PINTÓ, no sólo que no lanzó.
describe("Feature 129 (R3) / 133 (R1) — quién NO entra sigue sin entrar", () => {
  it.each(ROLES_SIN_ENTRADA)(
    "el rol `%s` recibe notFound y no se pinta nada",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(renderPage()).rejects.toThrow(NotFoundError);
      expect(screen.queryByRole("heading", { name: "Analítica" })).toBeNull();
    },
  );

  it.each(ROLES_ACOTADOS_QUE_ENTRAN)(
    "el rol `%s` SÍ entra: la página no lanza y el shell se pinta",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();
      expect(
        screen.getByRole("heading", { name: "Analítica" }),
      ).toBeInTheDocument();
      // Re-anclado: lo que se mide es que el gate DEJA ENTRAR a este rol y la página se
      // pinta, no la existencia de una región concreta.
      afirmarCuerpoPintado();
    },
  );
});

describe("Feature 129 (R4) — sin sesión", () => {
  it("actor nulo recibe notFound y no se pinta nada", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(screen.queryByRole("heading", { name: "Analítica" })).toBeNull();
  });
});

// REEXPRESADO por la feature 133 (T3.2). ROJO POR DISEÑO, no relajación.
//
// DESVIACIÓN DECLARADA: este bloque NO figura en la tabla de guards de `design.md §5` ni
// en el enunciado de T3.2, que preveían seis. Son SIETE. El motivo es el mismo que el de
// los otros: su segundo caso elegía `mensajero` como «rol no autorizado» de ejemplo, y la
// 133 lo autoriza. Se anota aquí como desviación en vez de arreglarse en silencio.
//
// QUÉ MUTACIÓN SIGUE MATANDO (intacta): «el rol se lee de los ARGUMENTOS de la página en
// vez de la sesión». Si `AnaliticaPage` mirase su `props`/`searchParams`, el objeto
// `{ rol: "maestro" }` que se le cuela a la fuerza convertiría un actor denegado en uno
// autorizado y el caso dejaría de lanzar. Lo único que cambia es CUÁL es el actor
// denegado del ejemplo: `apiKey`, que sigue siéndolo tras la 133.
describe("Feature 129 (R5) — el rol sale SOLO del mock de sesión", () => {
  it("AnaliticaPage no declara parámetros", () => {
    expect(AnaliticaPage.length).toBe(0);
  });

  it("pasarle un objeto con un rol autorizado como si fuera prop/searchParam no cambia nada: sigue lanzando notFound con sesión no autorizada", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "apiKey" });
    // Ni prop, ni query param, ni cabecera: nada de lo que se le "cuele" a la
    // función por sus argumentos puede sustituir a la sesión resuelta server-side.
    await expect(
      renderPage({ rol: "maestro", searchParams: { rol: "admin" } }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lo mismo sin sesión: pasar un objeto con rol autorizado no evita el notFound", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(renderPage({ rol: "admin" })).rejects.toThrow(NotFoundError);
  });
});

// REEXPRESADO por la feature 133 (T3.2). ROJO POR DISEÑO, no relajación.
//
// QUÉ AFIRMABA: con `adminTienda` —su ejemplo de rol no autorizado— la promesa rechaza y
// ninguna región llega a pintarse. La 133 autoriza a `adminTienda`, así que el EJEMPLO
// caducó; el requisito, no.
//
// QUÉ MUTACIÓN SIGUE MATANDO (intacta): «el `notFound()` va DESPUÉS de componer el
// árbol». Mover el gate detrás del `return` dejaría las regiones ya construidas cuando
// se lanza, y este caso las encontraría en el documento. Se mide con `apiKey`, que sigue
// denegado tras la 133 y por tanto sigue ejerciendo exactamente el mismo camino.
describe("Feature 129 (R6) — el gate corre ANTES de renderizar", () => {
  it.each(ROLES_SIN_ENTRADA)(
    "con el rol no autorizado `%s`, la promesa rechaza y ninguna región llega a pintarse",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(renderPage()).rejects.toThrow(NotFoundError);
      expect(
        screen.queryByRole("region", { name: "Tablero operativo" }),
      ).toBeNull();
    },
  );
});

describe("Feature 129 (R24) — la página no invoca acciones/servicios/repositorios de analítica", () => {
  // CAMBIO DECLARADO (feature 132). Este caso afirmaba que la página renderiza
  // «con SOLO resolve-actor mockeado (no hay ninguna otra dependencia de datos
  // que mockear)». Eso dejó de ser cierto: la 132 SÍ añade un pre-fetch (R9),
  // así que ahora hay exactamente UNA dependencia de datos más —el cargador
  // financiero— y hay que declararla. No se relaja lo que el caso protegía: la
  // página sigue sin tocar `lib/actions`, `lib/services` ni `lib/repositories`
  // (el import es RELATIVO al componente, `./_components/financiero/cargar`, que
  // es quien encapsula el borde), y eso lo sigue afirmando el censo del fuente
  // de abajo, intacto.
  it("sus únicas dependencias de datos son resolve-actor y el cargador financiero de la región", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    await renderPage();
    // Re-anclado: el caso mide que la página RENDERIZA con sólo esas dos dependencias de
    // datos mockeadas; la región era únicamente la prueba de que renderizó.
    afirmarCuerpoPintado();
  });

  // Refuerzo sobre el CÓDIGO FUENTE: un test que solo verifique el render no
  // detectaría un `await listarAlgoDeAnalitica()` cuyo resultado se ignore o se
  // trague en un try/catch. Leer el archivo y buscar los prefijos de import de
  // Server Actions/servicios/repositorios es la única forma de afirmar con
  // certeza que la página no toca esas capas.
  it("el código fuente de la página no importa lib/actions, lib/services ni lib/repositories", () => {
    const ruta = join(
      process.cwd(),
      "app",
      "(app)",
      "analitica",
      "page.tsx",
    );
    const fuente = readFileSync(ruta, "utf-8");
    expect(fuente).not.toContain("lib/actions");
    expect(fuente).not.toContain("lib/services");
    expect(fuente).not.toContain("lib/repositories");
  });
});

/* ========================================================================== */
/* Feature 132 — la región financiera de la página                            */
/* ========================================================================== */

describe.skip(
  `Feature 132 (R1) — los roles con acceso total ven la región financiera [${NOTA_SHELL_REDUCIDO}]`,
  () => {
  it.each(["maestro", "admin"] as RolValue[])(
    "el rol `%s` ve la región 'Tablero financiero' con la métrica y sus cifras",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();

      const region = screen.getByRole("region", { name: "Tablero financiero" });
      expect(region).toBeInTheDocument();
      // La región no está vacía: trae el panel que el cargador devolvió.
      expect(within(region).getByText(ETIQUETA_METRICA)).toBeInTheDocument();
      // Y las dos regiones de la 129 siguen ahí, sin alterarse (R8).
      expect(screen.getByRole("region", { name: "Filtros" })).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Tablero operativo" }),
      ).toBeInTheDocument();
    },
  );
});

// REEXPRESADO por la feature 133 (T3.2). ROJO POR DISEÑO, no relajación. SE PARTE EN DOS.
//
// QUÉ AFIRMABA: los otros cuatro roles reciben `notFound()` y no llegan a ver NINGUNA de
// las dos regiones. Ese enunciado fundía dos cosas que la 133 separa: «no entra» y «entra
// pero no ve el dinero».
//
// QUÉ MUTACIÓN SIGUE MATANDO: la de siempre —«la región financiera se pinta para quien no
// tiene acceso total»—, y ahora en su forma FUERTE. Antes se medía con la página lanzando:
// cualquier fallo del gate de `esAccesoTotal` quedaba tapado por el `notFound`. Ahora, para
// los tres roles acotados, la página SE PINTA y la ausencia de la región se comprueba sobre
// un documento real. Pasar la prop `financiero` a un rol acotado en `page.tsx` pone rojos
// los tres casos; antes de la 133 no habría puesto rojo ninguno.
describe("Feature 132 (R1, R8) / 133 (R6) — `apiKey` sigue con notFound; los tres roles acotados entran y no ven dinero", () => {
  it.each(ROLES_SIN_ENTRADA)(
    "el rol `%s` recibe notFound y no llega a ver ninguna región",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(renderPage()).rejects.toThrow(NotFoundError);
      expect(
        screen.queryByRole("region", { name: "Tablero financiero" }),
      ).toBeNull();
      expect(
        screen.queryByRole("region", { name: "Tablero operativo" }),
      ).toBeNull();
    },
  );

  // INERTE 2026-08-19 (NOTA_SHELL_REDUCIDO). «NO ve la región financiera» es hoy cierto
  // para TODOS los roles, porque esa <section> está comentada: dejarlo activo sería un
  // verde sin sujeto justo en la guardia del dinero. Se conserva para cuando vuelva.
  it.skip.each(ROLES_ACOTADOS_QUE_ENTRAN)(
    "el rol `%s` entra, ve el tablero operativo y NO ve la región financiera",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();
      // El anti-vacío: si esto fallara, las dos aserciones de abajo serían verdad por
      // no haber documento, que es exactamente como este caso pasaba antes de la 133.
      expect(
        screen.getByRole("region", { name: "Tablero operativo" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Filtros" })).toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Tablero financiero" }),
      ).toBeNull();
    },
  );

  it("los seis RolValue quedan cubiertos, sin agrupar ni omitir ninguno", () => {
    // Contrapeso: si mañana alguien recorta una de las listas de arriba, este caso cae
    // en vez de dejar un rol sin enumerar. La 133 lo REFUERZA: ya no basta con que la
    // enumeración de los seis exista, ahora se exige que las TRES listas por decisión
    // (acceso total / entran acotados / no entran) sean una PARTICIÓN de esos seis. Un
    // rol que se caiga de una lista sin aparecer en otra deja de estar probado y este
    // caso lo dice.
    expect([...TODOS_LOS_ROLES].sort()).toEqual(
      ["admin", "adminSatelite", "adminTienda", "apiKey", "maestro", "mensajero"],
    );
    expect(
      [
        ...ROLES_ACCESO_TOTAL,
        ...ROLES_ACOTADOS_QUE_ENTRAN,
        ...ROLES_SIN_ENTRADA,
      ].sort(),
    ).toEqual([...TODOS_LOS_ROLES].sort());
  });
});

/**
 * Feature 133 (T3.3) — el símbolo de moneda. R7 nombra explícitamente «ninguna cifra de
 * dinero»; un total puede pintarse formateado (`₡918 273,45`) y entonces ni la cifra
 * cruda ni el entero aparecen, pero el símbolo sí. Se censa aparte.
 */
const SIMBOLOS_MONEDA = ["₡", "$", "€", "CRC", "USD"];

// REEXPRESADO por la feature 133 (T3.3). ROJO POR DISEÑO — y es el que había que
// reexpresar BIEN, porque es literalmente R6 y R7 de esta feature.
//
// QUÉ AFIRMABA Y POR QUÉ ERA DÉBIL: exactamente las mismas aserciones de abajo, pero
// ejecutadas DESPUÉS de `rejects.toThrow(NotFoundError)`. Es decir: pasaba porque la
// página LANZABA y `document.body` estaba vacío. Un test que afirma que un documento
// vacío no contiene dinero no afirma nada sobre el dinero.
//
// CÓMO QUEDA: para los tres roles acotados la página SE RENDERIZA, y la ausencia de todo
// rastro del dinero se comprueba sobre el documento REAL, completo y pintado. La aserción
// sigue yendo sobre `document.body.textContent` ENTERO —no sobre un subárbol elegido— y el
// doble sigue trayendo etiqueta de métrica y cifras reconocibles (un doble que devolviera
// `[]` haría pasar esto por vacío). Se AÑADEN el censo de símbolos de moneda y la palabra
// «financiera» en femenino.
//
// QUÉ MUTACIÓN MATA: pasar la prop `financiero` a un rol acotado en `page.tsx`. Antes de la
// 133 esa misma mutación NO habría puesto rojo este bloque, porque el `notFound()` se
// disparaba primero. La reexpresión lo deja MÁS FUERTE, no más flojo.
//
// El caso de `apiKey` se conserva tal cual: para él la página sigue lanzando, y esa rama
// sigue mereciendo su aserción.
describe("Feature 132 (R2) / 133 (R6, R7) — para un rol sin acceso no queda RASTRO de la región financiera", () => {
  /** Las mismas aserciones para los dos caminos: el que renderiza y el que lanza. */
  function afirmarSinRastroDeDinero() {
    const cuerpo = document.body.textContent ?? "";
    expect(cuerpo).not.toContain("financiero");
    expect(cuerpo).not.toContain("Financiero");
    expect(cuerpo).not.toContain("financiera");
    expect(cuerpo).not.toContain(ETIQUETA_METRICA);
    // Las cifras, tanto crudas como con separador de miles: `918273.45` y
    // `918 273,45` son el mismo dinero escrito de dos formas.
    for (const cifra of [CIFRA_BRUTA, CIFRA_NETA]) {
      const [entero, decimales] = cifra.split(".");
      expect(cuerpo).not.toContain(cifra);
      expect(cuerpo).not.toContain(entero);
      expect(cuerpo.replace(/[\s., ]/g, "")).not.toContain(entero + decimales);
    }
    // Ni un estado vacío en su lugar: no hay ningún texto de "sin movimientos".
    expect(cuerpo.toLowerCase()).not.toContain("sin movimientos");
    // R7 — ni un símbolo de moneda, que es lo que sobreviviría a un formateo.
    for (const simbolo of SIMBOLOS_MONEDA) {
      expect(cuerpo).not.toContain(simbolo);
    }
  }

  // INERTE 2026-08-19 (NOTA_SHELL_REDUCIDO). Su CONTROL POSITIVO —el de abajo— está
  // inerte por la misma causa, y sin control positivo «no hay rastro de dinero» no
  // significa nada: hoy no hay tablero financiero para NINGÚN rol.
  it.skip.each(ROLES_ACOTADOS_QUE_ENTRAN)(
    "el rol `%s` renderiza la página ENTERA y aun así no hay ni región, ni etiqueta, ni cifra, ni moneda",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();

      // EL ANTI-VACÍO, y es la diferencia entera entre este test y el de la 132: hay
      // documento. Sin estas tres aserciones el bloque volvería a poder pasar por «no se
      // pintó nada».
      expect(
        screen.getByRole("heading", { name: "Analítica" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Tablero operativo" }),
      ).toBeInTheDocument();
      expect((document.body.textContent ?? "").length).toBeGreaterThan(0);

      // El censo del cuerpo va PRIMERO, a propósito. Si fuese detrás del `queryByRole`,
      // cualquier mutación que pintase la región abortaría el caso en esa línea y nadie
      // sabría nunca si las aserciones sobre el texto llegan a ejecutarse. Puestas aquí,
      // el mensaje de fallo nombra el texto que se coló.
      afirmarSinRastroDeDinero();
      expect(
        screen.queryByRole("region", { name: "Tablero financiero" }),
      ).toBeNull();
    },
  );

  it.each(ROLES_SIN_ENTRADA)(
    "el rol `%s` ni siquiera entra, y tampoco deja rastro",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(renderPage()).rejects.toThrow(NotFoundError);
      afirmarSinRastroDeDinero();
    },
  );

  // INERTE 2026-08-19 (NOTA_SHELL_REDUCIDO). El doble sigue trayendo la etiqueta, pero
  // la <section> que la pintaba está comentada, así que ya no llega al documento para
  // nadie y el control positivo no puede demostrar nada.
  it.skip("CONTROL POSITIVO: el doble SÍ trae etiqueta reconocible, y para `maestro` se pinta", async () => {
    // Sin este caso, las aserciones de arriba podrían estar comprobando la ausencia de
    // textos que el tablero financiero no pinta NUNCA, para nadie. Aquí se demuestra que
    // esos mismos textos llegan al documento cuando el rol sí tiene acceso: la ausencia
    // de arriba es una ausencia con significado.
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    await renderPage();

    expect(
      screen.getByRole("region", { name: "Tablero financiero" }),
    ).toBeInTheDocument();
    expect(document.body.textContent ?? "").toContain(ETIQUETA_METRICA);
  });
});

describe.skip(
  `Feature 132 (R3) — quién ve la región se DERIVA de esAccesoTotal [${NOTA_SHELL_REDUCIDO}]`,
  () => {
  it("el conjunto de roles que ve la región coincide exactamente con los que esAccesoTotal acepta", async () => {
    const vistos: RolValue[] = [];
    for (const rol of TODOS_LOS_ROLES) {
      cleanup();
      vi.clearAllMocks();
      cargarMock.mockResolvedValue(PANELES);
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      try {
        await renderPage();
      } catch {
        // `notFound()`: el rol ni siquiera entra a la página.
        continue;
      }
      if (screen.queryByRole("region", { name: "Tablero financiero" })) {
        vistos.push(rol);
      }
    }

    // La expectativa NO se escribe a mano: se DERIVA llamando a `esAccesoTotal`
    // sobre los seis roles. Si mañana ese helper cambia, este test cambia con él
    // en vez de congelar una pareja de nombres.
    const esperados = TODOS_LOS_ROLES.filter((rol) => esAccesoTotal(rol));
    expect([...vistos].sort()).toEqual([...esperados].sort());
    // Y no está pasando por vacío: alguien la ve.
    expect(vistos.length).toBeGreaterThan(0);
  });
});

// REEXPRESADO por la feature 133 (T3.2). ROJO POR DISEÑO, no relajación.
//
// QUÉ AFIRMABA: que la 132 NO tocaba las constantes de rol — `ROLES_ACCESO_ANALITICA` es
// «exactamente maestro y admin» y el acceso es subconjunto ESTRICTO del dominio. Su propio
// título de caso ya decía quién iba a cambiarlo: «la 133 es quien lo ensancha». Esto es lo
// que ha pasado: el conjunto de acceso pasó a DERIVARSE del del dominio (D1) y las dos
// aserciones se pusieron rojas el mismo día que estaba escrito que se pondrían.
//
// QUÉ MUTACIÓN SIGUE MATANDO: «alguien vuelve a tener DOS listas de roles de analítica».
// Antes se expresaba como «no son iguales»; ahora, como «son el MISMO objeto». Las dos
// versiones cazan lo mismo —una divergencia silenciosa entre quién entra y quién tiene
// alcance—, sólo que desde el lado en el que hoy vive el riesgo.
//
// Lo que este bloque NO hace es duplicar el guardia dedicado. El censo del FUENTE que
// obliga a que el lado derecho de la declaración sea una referencia (y que explica en el
// mensaje de fallo por qué una copia a mano o por spread es un pecado aunque su contenido
// sea idéntico) vive en `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts`,
// casos (b1) y (b2), ya reexpresados por T2.2. Aquí basta con dejar el bloque diciendo la
// verdad vigente.
describe("Feature 132 (R5) / 133 (R2, R3) — las constantes de rol de analítica, tras la 133 y la salida del mensajero", () => {
  it("ROLES_ACCESO_ANALITICA sigue sin ser una lista propia: es ROLES_ANALITICA MENOS los excluidos", () => {
    // Ya no puede afirmarse por identidad referencial (`toBe`): la resta del 2026-08-12
    // devuelve un array nuevo por necesidad. Lo que se afirma es que la resta es exacta —el
    // riesgo original (dos listas gemelas libres de divergir) se vigila igual, sólo desde el
    // otro lado—. El censo del FUENTE que prohíbe escribir los roles a mano sigue viviendo
    // en `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts`, caso (b2).
    expect([...ROLES_ACCESO_ANALITICA].sort()).toEqual(
      [...ROLES_ANALITICA]
        .filter((rol) => !(ROLES_SIN_ACCESO_ANALITICA as readonly string[]).includes(rol))
        .sort(),
    );
    expect([...ROLES_SIN_ACCESO_ANALITICA]).toEqual(["mensajero"]);
  });

  it("ROLES_ANALITICA sigue siendo los cinco lectores, sin apiKey", () => {
    expect([...ROLES_ANALITICA]).toEqual([
      "maestro",
      "admin",
      "adminSatelite",
      "adminTienda",
      "mensajero",
    ]);
  });

  it("el acceso vuelve a ser subconjunto ESTRICTO del dominio (el mensajero tiene alcance, no puerta)", () => {
    const dominio = ROLES_ANALITICA as readonly string[];
    const acceso = ROLES_ACCESO_ANALITICA as readonly string[];
    // Esta mitad se CONSERVA INTACTA desde el primer día: es el caso (a) del guard de
    // no-convergencia, sigue siendo verdad y sigue siendo la red que queda debajo si
    // alguien deshace la derivación.
    for (const rol of acceso) {
      expect(dominio).toContain(rol);
    }
    // La igualdad que decidió la 133 vuelve a ser desigualdad (2026-08-12). `apiKey` sigue
    // fuera de los DOS conjuntos, que es lo que impide leer esto como «entra todo el mundo»;
    // el `mensajero` está en el dominio y NO en el acceso, que es la decisión de hoy.
    expect(acceso.length).toBeLessThan(dominio.length);
    expect(acceso).not.toContain("apiKey");
    expect(dominio).not.toContain("apiKey");
    expect(dominio).toContain("mensajero");
    expect(acceso).not.toContain("mensajero");
  });
});

describe("Feature 132 (R9) — el dinero se pre-carga en el servidor y solo si toca", () => {
  it.each(["maestro", "admin"] as RolValue[])(
    "para el rol `%s` el cargador se invoca EXACTAMENTE una vez por render",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();
      expect(cargarMock).toHaveBeenCalledTimes(1);
      // Sin argumentos: el filtro es la constante de rango de la feature, no algo
      // que la página componga (R26).
      expect(cargarMock).toHaveBeenCalledWith();
    },
  );

  // REEXPRESADO por la feature 133 (T3.2). ROJO EN LA FORMA, VERDE EN EL FONDO.
  //
  // QUÉ AFIRMABA: para los cuatro roles restantes la promesa rechaza Y `cargarMock` no se
  // invoca. Lo que se puso rojo es el `rejects.toThrow(NotFoundError)` —tres de esos
  // cuatro roles ya entran—, NO la aserción que importa.
  //
  // QUÉ MUTACIÓN SIGUE MATANDO, y es R8 entero: «el dinero se consulta para quien no puede
  // verlo». Antes esa mutación la mataba el `notFound()`, que ni siquiera dejaba llegar al
  // `await cargarTableroFinanciero()`. Ahora la mata el gate de `esAccesoTotal`, que es un
  // mecanismo DISTINTO y hasta hoy no estaba probado para estos tres roles: si alguien
  // sacara el `cargar…()` fuera de la guarda —p. ej. para «tenerlo listo por si acaso»—,
  // la 132 no se habría enterado y estos tres casos sí.
  //
  // NO se relaja: se conserva la aserción sobre `cargarMock` para los TRES roles nuevos, se
  // conserva íntegro el camino de `apiKey` y el de la sesión ausente (que siguen lanzando),
  // y se añade el anti-vacío que impide que «no se llamó» sea cierto por no haber
  // renderizado.
  it.each(ROLES_ACOTADOS_QUE_ENTRAN)(
    "para el rol `%s`, que SÍ entra pero no tiene acceso total, el dinero NO se consulta ni una vez",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();
      // Anti-vacío: la página se pintó. «No se consultó el dinero» no es cierto por no
      // haber llegado a ejecutarse nada. Re-anclado el 2026-08-19 (ver
      // `afirmarCuerpoPintado`): la defensa se mueve, no se quita.
      afirmarCuerpoPintado();
      expect(cargarMock).not.toHaveBeenCalled();
    },
  );

  it.each(ROLES_SIN_ENTRADA)(
    "para el rol `%s`, denegado en la puerta, el dinero NO se consulta ni una vez",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(renderPage()).rejects.toThrow(NotFoundError);
      expect(cargarMock).not.toHaveBeenCalled();
    },
  );

  it("sin sesión tampoco se consulta el dinero", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(cargarMock).not.toHaveBeenCalled();
  });
});

describe("Feature 131 (T6.2, R26) — los dos slots ya están cableados", () => {
  // INERTE 2026-08-19 (NOTA_SHELL_REDUCIDO): el `EmptyState` que este caso vigila vive
  // dentro de las <section> comentadas, así que hoy no puede aparecer para nadie. El otro
  // caso de este bloque NO se toca: no mira el DOM, mira las constantes del gate.
  it.skip("las dos regiones ya NO muestran el placeholder «llega en una entrega posterior»", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    await renderPage();

    // El shell pinta ese `EmptyState` cuando su slot llega vacío
    // (`AnaliticaShell.tsx:48-63`). Verlo ahora sería una mentira en pantalla: los
    // controles y los paneles ya existen.
    expect(screen.queryByText(/llega en una entrega posterior/)).toBeNull();
    expect(
      screen.getByRole("region", { name: "Filtros" }).textContent ?? "",
    ).not.toContain("entrega posterior");
    expect(
      screen.getByRole("region", { name: "Tablero operativo" }).textContent ?? "",
    ).not.toContain("entrega posterior");
  });

  // REEXPRESADO por la feature 133 (T3.2). ROJO POR DISEÑO, no relajación.
  //
  // QUÉ AFIRMABA: «el gate sigue siendo maestro/admin y la página sigue sin parámetros».
  // La primera mitad era una afirmación sobre lo que la 131 NO hacía —«ampliar
  // `ROLES_ACCESO_ANALITICA` es de la 133, no de esta feature»— y la 133 la ha hecho.
  //
  // QUÉ MUTACIÓN SIGUE MATANDO: la segunda mitad, intacta y sin tocar un carácter —«la
  // página acepta un parámetro», que es lo que D7 decidió NO hacer—; y la primera pasa a
  // medir la mutación que hoy importa: que el gate sea el conjunto DECLARADO y no otro. Se
  // afirma por contenido y en las dos direcciones (los cinco están, `apiKey` no está), de
  // modo que tanto encoger el conjunto como abrirlo de más ponen esto rojo.
  it("R26 — el gate de la ruta son los CUATRO roles con acceso (nunca `apiKey` ni el `mensajero`) y la página sigue sin parámetros", () => {
    expect([...ROLES_ACCESO_ANALITICA].sort()).toEqual(
      [...ROLES_ACCESO_TOTAL, ...ROLES_ACOTADOS_QUE_ENTRAN].sort(),
    );
    expect([...ROLES_ACCESO_ANALITICA]).not.toContain("apiKey");
    expect(AnaliticaPage.length).toBe(0);
  });
});

/* ========================================================================== */
/* Feature 133 — el recorte de PRESENTACIÓN por rol                           */
/*                                                                            */
/* AVISO QUE ESTE ARCHIVO NO PUEDE CONTRADECIR (requirements.md §0, R20/R21):  */
/* esto es recorte de PRESENTACIÓN. El recorte de DATOS es de la 122 y ocurre  */
/* en el servidor, en el borde, antes de tocar la base. Un panel que no se     */
/* pinta NO es un dato que no se filtra: ninguna aserción de aquí abajo debe   */
/* leerse como que la UI protege un dato.                                     */
/* ========================================================================== */

/**
 * Feature 133 (T3.4, R9) — EQUIVALENCIA CON EL CATÁLOGO.
 *
 * Dos fuentes INDEPENDIENTES que deben decir lo mismo sobre los cinco roles lectores:
 *
 *   «se ofrece la región financiera»  ⟺  listarMetricas({ dominio:"financiera", rol }) ≠ ∅
 *
 * La primera la decide `esAccesoTotal` dentro de `page.tsx` (D2); la segunda es el
 * catálogo de la 135. Si alguien abriera una financiera a `adminTienda`, este test y
 * `tests/unit/analytics/financiera-alcance.guardia.test.ts:35-64` caerían A LA VEZ — y la
 * respuesta sería diseñar el recorte del dinero, no aflojar ninguno de los dos.
 *
 * OJO CON LO QUE ESTO NO ES (D2, párrafo «por qué no se usa `listarMetricas` como el
 * gate»): el catálogo se usa aquí para VERIFICAR, nunca para reemplazar al gate. El
 * guardia de la 132 (`tablero-financiero.guardia.test.ts:356-364`) exige que la página
 * siga llamando a `esAccesoTotal(`; convertir el catálogo en la condición crearía una
 * segunda autoridad sobre quién ve el dinero.
 */
describe("Feature 133 (R9) — ver la región financiera equivale a tener financieras en el catálogo", () => {
  // INERTE 2026-08-19 (NOTA_SHELL_REDUCIDO): una de las dos fuentes de la equivalencia
  // es `queryByRole("region", "Tablero financiero")`, que hoy es `null` para todos. El
  // caso de abajo («no pasa por vacío») SÍ sigue activo: sólo mira el catálogo.
  it.skip.each([...ROLES_ANALITICA])(
    "para el rol `%s` las dos fuentes coinciden",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      let veLaRegion = false;
      try {
        await renderPage();
        veLaRegion =
          screen.queryByRole("region", { name: "Tablero financiero" }) !== null;
      } catch {
        // Se registra como «no ve la región». Hasta el 2026-08-12 esto era además la
        // firma de un fallo de R1 —los cinco lectores entraban— y el bloque de R1 era
        // quien lo denunciaba. Desde que el `mensajero` perdió la puerta, este camino es
        // legítimo PARA ÉL y sólo para él: quién entra lo sigue afirmando por separado el
        // bloque de arriba, con las tres listas de roles.
        veLaRegion = false;
      }

      const elCatalogoLeSirveDinero =
        listarMetricas({ dominio: "financiera", rol: rol as RolAnalitica }).length > 0;

      expect(veLaRegion).toBe(elCatalogoLeSirveDinero);
    },
  );

  it("no pasa por vacío: hay roles a cada lado de la equivalencia", () => {
    // Sin esto, un catálogo que devolviera cero financieras para TODOS y una página que no
    // pintara la región para nadie harían pasar los cinco casos de arriba diciendo nada.
    const conDinero = [...ROLES_ANALITICA].filter(
      (rol) => listarMetricas({ dominio: "financiera", rol: rol as RolAnalitica }).length > 0,
    );
    expect(conDinero.length).toBeGreaterThan(0);
    expect(conDinero.length).toBeLessThan(ROLES_ANALITICA.length);
  });
});

/**
 * Feature 133 (T3.5, R10) — NINGÚN CONTROL ANUNCIA LA REGIÓN.
 *
 * R6/R7 dicen que la región no se pinta y que no queda rastro de su contenido. R10 cierra
 * la puerta de al lado: tampoco puede haber una pestaña, un enlace, un botón, un ancla ni
 * una entrada de navegación que ANUNCIE que existe. Un «Ver finanzas» que lleve a un 404 o
 * a un `forbidden` sigue siendo información: le dice a un rol prohibido que hay un tablero
 * de plata que no está viendo.
 *
 * Se juzga por NOMBRE ACCESIBLE (`aria-label` si lo hay, si no el texto), que es lo que
 * de verdad anuncia el control a quien navega con lector de pantalla.
 */
const TERMINOS_QUE_ANUNCIAN_LA_REGION = [
  "financ", // financiero, financiera, finanzas
  "tablero financiero",
  ETIQUETA_METRICA,
  ...listarMetricas({ dominio: "financiera" }).map((m) => m.etiqueta),
].map((t) => t.toLowerCase());

function nombreAccesible(el: Element): string {
  return (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
}

describe("Feature 133 (R10) — ningún control de navegación anuncia la región financiera", () => {
  it.each(ROLES_ACOTADOS_QUE_ENTRAN)(
    "para el rol `%s` no hay enlace, botón, pestaña ni ancla que la nombre",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();

      const controles = [
        ...screen.queryAllByRole("link"),
        ...screen.queryAllByRole("button"),
        ...screen.queryAllByRole("tab"),
        ...screen.queryAllByRole("menuitem"),
        ...Array.from(document.querySelectorAll("a[href]")),
      ];

      // ANTI-VACÍO: la pantalla TIENE controles (el «Actualizar» de la rejilla, el selector
      // de rango…). Si esta aserción cayera, el bucle de abajo estaría recorriendo una
      // lista vacía y el caso pasaría sin comprobar nada.
      expect(controles.length).toBeGreaterThan(0);

      for (const control of controles) {
        const nombre = nombreAccesible(control).toLowerCase();
        for (const termino of TERMINOS_QUE_ANUNCIAN_LA_REGION) {
          expect(nombre).not.toContain(termino);
        }
      }
    },
  );

  it("no pasa por vacío: la lista de términos vigilados no está vacía y nombra métricas reales", () => {
    expect(TERMINOS_QUE_ANUNCIAN_LA_REGION.length).toBeGreaterThan(1);
    expect(listarMetricas({ dominio: "financiera" }).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Feature 133 (T6.5, R23) — nada AJENO en el documento                       */
/* -------------------------------------------------------------------------- */

/**
 * La fixture. Nombres y uuids que NO pertenecen al alcance del actor bajo prueba, elegidos
 * para ser inconfundibles: si aparecen en el documento, aparecen porque los pintó la
 * pantalla y no por casualidad.
 */
const ZONA_AJENA = {
  id: "3f0a1c62-9b4d-4e77-8a51-0c2d6b8e4f13",
  nombre: "Zona Guanacaste Norte",
};
const TIENDA_AJENA = {
  id: "b71e5d04-2c88-4a19-9f36-7ad0e1c95b42",
  nombre: "Distribuidora Malpais SRL",
  esApiKey: false,
  activa: true,
};
const MENSAJERO_AJENO = {
  id: "c9d3f817-6e5b-42a0-b1c4-58e7f2a09d6b",
  nombre: "Rodolfo Barrantes Vega",
};

const catalogoOrdenesMock = vi.mocked(obtenerCatalogoFiltrosOrdenes);
const usuariosPorRolMock = vi.mocked(listarUsuariosPorRol);

/**
 * Feature 133 (T6.5, R23) — MIENTRAS el alcance del actor sea acotado, el documento no
 * muestra ninguna etiqueta, nombre propio ni identificador de una tienda, zona o persona
 * fuera de su alcance.
 *
 * POR QUÉ LA VÍA SON LOS CATÁLOGOS DE FILTRO, Y NO LOS DATOS DE LOS PANELES. Es la única
 * vía que esta capa decide. Si en su lugar se inyectaran nombres ajenos en la respuesta de
 * `consultarAnaliticaOperativa`, la pantalla los pintaría —y DEBE pintarlos: lo que el
 * borde devuelve es lo que se muestra (R19)—. Un test así no mediría el recorte de
 * presentación, mediría el de DATOS, que es de la 122, vive en el servidor y no se
 * comprueba desde jsdom. Escribirlo aquí sería exactamente la confusión que §0 de
 * `requirements.md` prohíbe: un panel que no se pinta no es un dato que no se filtra.
 *
 * CÓMO SE EVITA QUE PASE POR VACÍO. Dos medidas, porque una sola no basta:
 *  (1) la fixture SÍ trae los tres valores, y los dos catálogos responden `ok` con ellos;
 *  (2) el CONTROL POSITIVO de abajo demuestra que, para un actor de alcance global, esos
 *      tres nombres LLEGAN al documento. Sin él, la ausencia no significaría nada.
 *
 * Los nombres sólo se pintan si el filtro está SELECCIONADO (el desplegable cerrado no
 * lista sus opciones), de ahí que la URL traiga las tres dimensiones puestas. Eso además
 * refuerza la aserción: si a un `adminTienda` se le dibujara el selector «Tienda», su
 * resumen mostraría el nombre de la tienda ajena y este bloque caería.
 *
 * LÍMITE DECLARADO: la mitad de los UUIDs no tiene control positivo. `MultiSelectFilter`
 * nunca escribe el `value` de una opción en el DOM —sólo su `label`—, así que no hay
 * ninguna configuración de esta pantalla en la que un uuid de catálogo llegue al documento.
 * Se afirma igualmente (sobre el HTML, para cazarlo también dentro de un atributo), pero
 * quien lea esto debe saber que la aserción que de verdad muerde es la de los NOMBRES.
 */
/* ==========================================================================
 * INERTE 2026-08-19 — Y ESTE NO ES COMO LOS OTROS. LÉELO ENTERO.
 * ==========================================================================
 *
 * Los demás bloques inertes de este archivo lo están porque su sujeto (una <section> del
 * shell) está comentado. ÉSTE lo está por algo más serio, y quedó MEDIDO antes de
 * apagarlo:
 *
 * EL RECORTE DE PRESENTACIÓN DE LA 133 YA NO LLEGA A LA PANTALLA. `page.tsx` sigue
 * calculando `recorteDePresentacion(actor)` y pasándoselo a `<FiltrosOperativos
 * facetas={recorte.facetas} />`… en el slot `filtros`, que el shell descarta. La barra que
 * HOY se pinta es otra: `FiltrosEntregas`, dentro del slot `destacado`, y esa no recibe
 * facetas ni conoce el rol.
 *
 * MEDIDO EL 2026-08-19 sobre esta misma página, con el catálogo de esta fixture:
 *   - `maestro`, `adminSatelite` y `adminTienda` reciben LAS MISMAS SIETE facetas
 *     ("Fecha", "Zona", "Provincia", "Cantón", "Distrito", "Tienda", "Mensajero");
 *   - poniendo el filtro "Tienda" y abriéndolo, un `adminTienda` y un `adminSatelite`
 *     SÍ ven en el DOM el nombre de la tienda ajena de la fixture.
 *
 * Es decir: lo que estos tres casos afirman es HOY FALSO de la pantalla renderizada. No
 * se re-anclan —re-anclarlos manteniendo la aserción los deja en rojo, y aflojarla los
 * deja verdes mintiendo—, así que quedan inertes con la medición escrita arriba.
 *
 * ⚠ LO QUE ESTO NO DICE: no significa que haya una fuga de datos en producción. El
 * catálogo que alimenta a `FiltrosEntregas` lo sirve `obtenerCatalogoFiltrosOrdenes()`,
 * que acota server-side; aquí está mockeado a propósito para servir entidades ajenas. Lo
 * que se perdió es la GARANTÍA DE PRESENTACIÓN que R23 congelaba, que era la segunda
 * línea de defensa. Queda reportado al humano como ficha aparte.
 *
 * PARA REACTIVARLOS: que la barra que se pinta vuelva a recibir `recorte.facetas` (sea
 * devolviendo `FiltrosOperativos` a un slot vivo, sea pasándole las facetas a
 * `FiltrosEntregas`). Entonces estos tres casos vuelven a tener sujeto tal cual están.
 */
describe.skip("Feature 133 (T6.5, R23) — para un alcance acotado no aparece nada ajeno en el documento", () => {
  beforeAll(async () => {
    // SWR dedupe: `dedupingInterval` vale 2000 ms por defecto y los bloques anteriores ya
    // pidieron estas dos claves (con la respuesta `forbidden` por defecto de los mocks).
    // Sin esta espera, el primer render de aquí reutilizaría aquella respuesta y el control
    // positivo fallaría por una razón que no tiene nada que ver con lo que se prueba.
    await new Promise((resolve) => setTimeout(resolve, 2200));
  });

  beforeEach(() => {
    catalogoOrdenesMock.mockResolvedValue({
      status: "ok",
      catalogo: {
        zonas: [ZONA_AJENA],
        tiendas: [TIENDA_AJENA],
        provincias: [],
        cantones: [],
        distritos: [],
      },
    });
    usuariosPorRolMock.mockResolvedValue({
      status: "ok",
      usuarios: [MENSAJERO_AJENO],
    });
    // Las tres dimensiones, SELECCIONADAS en la URL.
    estadoUrl.params = new URLSearchParams({
      zona: ZONA_AJENA.id,
      tienda: TIENDA_AJENA.id,
      mensajero: MENSAJERO_AJENO.id,
    });
  });

  it("CONTROL POSITIVO: con alcance global los tres nombres de la fixture SÍ se pintan", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    await renderPage();

    await waitFor(() => {
      const cuerpo = document.body.textContent ?? "";
      expect(cuerpo).toContain(ZONA_AJENA.nombre);
      expect(cuerpo).toContain(TIENDA_AJENA.nombre);
      expect(cuerpo).toContain(MENSAJERO_AJENO.nombre);
    });
  });

  // 2026-08-12: la fila del `mensajero` SALE de aquí porque ya no renderiza esta página —el
  // caso pasaría por `notFound()` y no comprobaría nada—. Lo que se prueba (que un alcance
  // acotado no ve nombres ni uuids ajenos) sigue midiéndose con `adminSatelite` en este caso
  // y con `adminTienda` en el de abajo, que son los dos alcances acotados que quedan.
  it.each([
    ["adminSatelite", "u-satelite", "zona-propia-del-actor"],
  ] as [RolValue, string, string | undefined][])(
    "el rol `%s` no ve ni el nombre ni el id de la zona, la tienda ni la persona ajenas",
    async (rol, usuarioId, zonaId) => {
      resolveActorMock.mockResolvedValue({ usuarioId, rol, zonaId: zonaId ?? null });
      await renderPage();

      // Anti-vacío: hay documento y hay barra de filtros. La ausencia de los nombres no es
      // la ausencia de la pantalla entera.
      expect(screen.getByRole("region", { name: "Filtros" })).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Tablero operativo" }),
      ).toBeInTheDocument();

      const cuerpo = document.body.textContent ?? "";
      const html = document.body.innerHTML;
      for (const ajeno of [ZONA_AJENA, TIENDA_AJENA, MENSAJERO_AJENO]) {
        expect(cuerpo).not.toContain(ajeno.nombre);
        expect(html).not.toContain(ajeno.nombre);
        expect(html).not.toContain(ajeno.id);
      }
    },
  );

  it("el `adminTienda` no ve el nombre ni el id de la tienda ajena ni del mensajero ajeno", async () => {
    // La faceta «Zona» SÍ se le ofrece a un `adminTienda` (su catálogo le responde), así
    // que un nombre de zona en su pantalla es un control legítimo y NO se afirma aquí. Lo
    // que se afirma son las dos dimensiones que no se le dibujan:
    //  - «Tienda», porque su alcance ya la tiene fijada (R14);
    //  - «Mensajero», porque ese catálogo le serviría nombre real + uuid de cada mensajero,
    //    que es justo lo que R38/R39 de la 122 existen para impedir (R15).
    //
    // R27, y no es una nota al pie: que aquí no se dibuje el selector NO cierra el oráculo
    // residual contra R39 de la 122 (hallazgo M-4, ficha 182). El `mensajero_id` sigue
    // viajando por la URL y por el argumento de la Server Action; la prohibición efectiva
    // es del BORDE. Esta aserción habla de una pantalla, no de un permiso.
    resolveActorMock.mockResolvedValue({ usuarioId: "u-tienda", rol: "adminTienda" });
    await renderPage();

    expect(screen.getByRole("region", { name: "Filtros" })).toBeInTheDocument();

    const cuerpo = document.body.textContent ?? "";
    const html = document.body.innerHTML;
    for (const ajeno of [TIENDA_AJENA, MENSAJERO_AJENO]) {
      expect(cuerpo).not.toContain(ajeno.nombre);
      expect(html).not.toContain(ajeno.nombre);
      expect(html).not.toContain(ajeno.id);
    }
  });
});
