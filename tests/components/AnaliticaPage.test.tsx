// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import type { RolValue } from "@prisma/client";

import AnaliticaPage from "@/app/(app)/analitica/page";
import { cargarTableroFinanciero } from "@/app/(app)/analitica/_components/financiero/cargar";
import type { PanelFinanciero } from "@/app/(app)/analitica/_components/financiero/cargar";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
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
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  // Feature 131 (T6.2): el árbol de cliente que la 131 enchufa en los dos slots lee el
  // filtro de la URL (design §4.2). Es un mock del NAVEGADOR, no de una capa de datos.
  useSearchParams: () => new URLSearchParams(),
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

const DATOS_FINANCIEROS: ResultadoFinancieroVistas = {
  tipo: "vistas",
  metricaId: "egresos",
  etiqueta: ETIQUETA_METRICA,
  unidad: "moneda",
  rango: { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" },
  esAcumulado: false,
  vistas: [
    {
      id: "egresos__total",
      grano: "fecha",
      fuente: "wallet_movimiento",
      sumableCon: [],
      filas: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  cargarMock.mockResolvedValue(PANELES);
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

describe("Feature 129 (R1, R2) — maestro y admin ven el shell", () => {
  it.each(["maestro", "admin"] as RolValue[])(
    "el rol `%s` ve el encabezado y las dos regiones del tablero",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();

      expect(
        screen.getByRole("heading", { name: "Analítica" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Filtros" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Tablero operativo" }),
      ).toBeInTheDocument();
    },
  );
});

describe("Feature 129 (R3) — el resto de roles recibe notFound", () => {
  it.each([
    "mensajero",
    "adminTienda",
    "adminSatelite",
    "apiKey",
  ] as RolValue[])("el rol `%s` recibe notFound y no se pinta nada", async (rol) => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(screen.queryByRole("heading", { name: "Analítica" })).toBeNull();
  });
});

describe("Feature 129 (R4) — sin sesión", () => {
  it("actor nulo recibe notFound y no se pinta nada", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(screen.queryByRole("heading", { name: "Analítica" })).toBeNull();
  });
});

describe("Feature 129 (R5) — el rol sale SOLO del mock de sesión", () => {
  it("AnaliticaPage no declara parámetros", () => {
    expect(AnaliticaPage.length).toBe(0);
  });

  it("pasarle un objeto con un rol autorizado como si fuera prop/searchParam no cambia nada: sigue lanzando notFound con sesión no autorizada", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
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

describe("Feature 129 (R6) — el gate corre ANTES de renderizar", () => {
  it("con rol no autorizado, la promesa rechaza y ninguna región llega a pintarse", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(
      screen.queryByRole("region", { name: "Tablero operativo" }),
    ).toBeNull();
  });
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
    expect(
      screen.getByRole("region", { name: "Tablero operativo" }),
    ).toBeInTheDocument();
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

describe("Feature 132 (R1) — los roles con acceso total ven la región financiera", () => {
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

describe("Feature 132 (R1, R8) — los otros cuatro roles siguen recibiendo notFound", () => {
  it.each([
    "mensajero",
    "adminTienda",
    "adminSatelite",
    "apiKey",
  ] as RolValue[])(
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

  it("los seis RolValue quedan cubiertos, sin agrupar ni omitir ninguno", () => {
    // Contrapeso: si mañana alguien recorta una de las dos listas de arriba, este
    // caso cae en vez de dejar un rol sin enumerar.
    expect([...TODOS_LOS_ROLES].sort()).toEqual(
      ["admin", "adminSatelite", "adminTienda", "apiKey", "maestro", "mensajero"],
    );
  });
});

describe("Feature 132 (R2) — para un rol sin acceso no queda RASTRO de la región financiera", () => {
  // El test que de verdad muerde. No basta con que la región no exista: no debe
  // aparecer la palabra de la región, ni la etiqueta de la métrica, ni una cifra
  // de dinero, ni un estado vacío puesto en su lugar. Se comprueba sobre TODO el
  // `document.body`, después del rechazo, y no sobre un subárbol elegido.
  it.each([
    "mensajero",
    "adminTienda",
    "adminSatelite",
    "apiKey",
  ] as RolValue[])("el rol `%s` no ve ni la región, ni la métrica, ni una cifra", async (rol) => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
    await expect(renderPage()).rejects.toThrow(NotFoundError);

    const cuerpo = document.body.textContent ?? "";
    expect(cuerpo).not.toContain("financiero");
    expect(cuerpo).not.toContain("Financiero");
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
  });
});

describe("Feature 132 (R3) — quién ve la región se DERIVA de esAccesoTotal", () => {
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

describe("Feature 132 (R5) — esta feature no toca las constantes de rol de analítica", () => {
  // El diff real contra `origin/dev` lo comprueba el implementer; aquí se afirma
  // el CONTENIDO, que es lo que un diff vacío significa en la práctica.
  it("ROLES_ACCESO_ANALITICA sigue siendo exactamente maestro y admin", () => {
    expect([...ROLES_ACCESO_ANALITICA]).toEqual(["maestro", "admin"]);
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

  it("el acceso sigue siendo subconjunto ESTRICTO del dominio (la 133 es quien lo ensancha)", () => {
    const dominio = ROLES_ANALITICA as readonly string[];
    const acceso = ROLES_ACCESO_ANALITICA as readonly string[];
    for (const rol of acceso) {
      expect(dominio).toContain(rol);
    }
    expect(acceso.length).toBeLessThan(dominio.length);
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

  it.each([
    "mensajero",
    "adminTienda",
    "adminSatelite",
    "apiKey",
  ] as RolValue[])(
    "para el rol `%s`, denegado, el dinero NO se consulta ni una vez",
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
  it("las dos regiones ya NO muestran el placeholder «llega en una entrega posterior»", async () => {
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

  it("R26 — el gate de la ruta sigue siendo `maestro`/`admin` y la página sigue sin parámetros", () => {
    // Ampliar `ROLES_ACCESO_ANALITICA` es de la 133, no de esta feature; y darle un
    // parámetro a la página es lo que D7 decidió NO hacer.
    expect([...ROLES_ACCESO_ANALITICA]).toEqual(["maestro", "admin"]);
    expect(AnaliticaPage.length).toBe(0);
  });
});
