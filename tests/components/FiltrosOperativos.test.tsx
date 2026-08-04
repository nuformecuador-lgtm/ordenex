// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, useReducer, useEffect } from "react";
import { SWRConfig } from "swr";

import { FiltrosOperativos } from "@/app/(app)/analitica/_components/operativo/FiltrosOperativos";
import { PanelesOperativos } from "@/app/(app)/analitica/_components/operativo/PanelesOperativos";
import { TEXTO_FILTROS_DEGRADADOS } from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import { listarUsuariosPorRol } from "@/lib/actions/usuarios-por-rol";
import { PENUMBRA, type ResultadoOperativo } from "@/lib/types/analitica-operativa";

// Feature 131 (T2.1, T2.2) — R12 y R22.
//
// Se renderizan LOS DOS SLOTS a la vez porque eso es justo lo que la feature promete: la
// barra escribe el filtro en la URL y la rejilla lo lee de ahi (design §4.2). Un test que
// solo montase la barra no podria ver que el cambio llega a la consulta.

vi.mock("@/lib/actions/analitica-operativa", () => ({
  consultarAnaliticaOperativa: vi.fn(),
}));
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(),
}));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarUsuariosPorRol: vi.fn(),
}));

/**
 * URL compartida por los dos slots, con notificacion a los suscriptores. Es la pieza que
 * el navegador aporta de verdad: `router.replace` cambia la query y los dos componentes
 * que llaman a `useSearchParams` se vuelven a renderizar.
 */
let searchParams = new URLSearchParams();
const suscriptores = new Set<() => void>();

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const [, forzar] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
      suscriptores.add(forzar);
      return () => {
        suscriptores.delete(forzar);
      };
    }, []);
    return searchParams;
  },
  useRouter: () => ({
    replace: (url: string) => {
      searchParams = new URLSearchParams(url.split("?")[1] ?? "");
      act(() => {
        suscriptores.forEach((f) => f());
      });
    },
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/analitica",
}));

const accion = vi.mocked(consultarAnaliticaOperativa);
const catalogo = vi.mocked(obtenerCatalogoFiltrosOrdenes);
const mensajeros = vi.mocked(listarUsuariosPorRol);

function ok(metricaId: string): ResultadoOperativo {
  return {
    status: "ok",
    datos: {
      metricaId,
      unidad: "conteo",
      unidadDeConteo: "gestion",
      rango: {
        preset: "semana",
        desde: new Date("2026-08-03T06:00:00.000Z"),
        hasta: new Date("2026-08-04T06:00:00.000Z"),
        desdeFecha: "2026-08-03",
        hastaFecha: "2026-08-03",
      },
      puntos: [{ fecha: "2026-08-03", valor: 3 }],
      cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
    },
  };
}

function renderPantalla() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FiltrosOperativos />
      <PanelesOperativos />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
  suscriptores.clear();
  accion.mockImplementation(async ({ metricaId }) => ok(metricaId));
  catalogo.mockResolvedValue({
    status: "ok",
    catalogo: {
      zonas: [
        { id: "z1", nombre: "Zona Central" },
        { id: "z2", nombre: "Zona Norte" },
      ],
      tiendas: [{ id: "t1", nombre: "Tienda Uno", esApiKey: false, activa: true }],
      provincias: [],
      cantones: [],
      distritos: [],
    },
  });
  mensajeros.mockResolvedValue({
    status: "ok",
    usuarios: [{ id: "m1", nombre: "Beto Repartidor" }],
  });
});
afterEach(cleanup);

/* ========================================================================== */
/* R12 — cambiar el filtro vuelve a consultar CON EL FILTRO NUEVO             */
/* ========================================================================== */

describe("Feature 131 (R12) — el cambio de filtro llega a la consulta", () => {
  it("al cambiar de zona se vuelve a consultar con la zona nueva", async () => {
    renderPantalla();
    await waitFor(() => expect(accion.mock.calls.length).toBeGreaterThan(0));

    // Nadie consulto todavia con la zona: es lo que este caso va a provocar.
    expect(accion.mock.calls.some(([e]) => JSON.stringify(e.raw).includes("z1"))).toBe(false);
    const antes = accion.mock.calls.length;

    const disparador = await screen.findByRole("button", { name: /^Zona:/ });
    await userEvent.click(disparador);
    const listbox = await screen.findByRole("listbox", { name: "Zona" });
    await userEvent.click(within(listbox).getByRole("option", { name: /Zona Central/ }));

    // El filtro NUEVO viaja a la accion...
    await waitFor(() => {
      const nuevas = accion.mock.calls.slice(antes).map(([e]) => JSON.stringify(e.raw));
      expect(nuevas.length).toBeGreaterThan(0);
      expect(nuevas.every((raw) => raw.includes('"zona_id":["z1"]'))).toBe(true);
    });

    // ...y TODOS los paneles se rehacen con el, no solo el primero: el resultado del
    // filtro anterior no puede quedarse en pantalla como si correspondiera al nuevo.
    const rehechas = new Set(accion.mock.calls.slice(antes).map(([e]) => e.metricaId));
    expect(rehechas.size).toBeGreaterThan(1);
  });

  it("cambiar el preset de rango tambien vuelve a consultar", async () => {
    renderPantalla();
    await waitFor(() => expect(accion.mock.calls.length).toBeGreaterThan(0));
    const antes = accion.mock.calls.length;

    await userEvent.click(screen.getByRole("combobox", { name: "Rango" }));
    await userEvent.click(await screen.findByRole("option", { name: "Hoy" }));

    await waitFor(() => {
      const nuevas = accion.mock.calls.slice(antes).map(([e]) => JSON.stringify(e.raw));
      expect(nuevas.length).toBeGreaterThan(0);
      expect(nuevas.every((raw) => raw.includes('"rango":"dia"'))).toBe(true);
    });
  });
});

/* ========================================================================== */
/* R22 — el catalogo se degrada, no tumba la pantalla                         */
/* ========================================================================== */

describe("Feature 131 (R22) — el catalogo de opciones falla en blando", () => {
  it("si el catalogo de filtros falla, los selectores quedan deshabilitados y los paneles siguen vivos", async () => {
    // La accion LANZA: es el caso peor, y el que la mutacion revive propagandolo.
    catalogo.mockRejectedValue(new Error("catalogo caido"));
    renderPantalla();

    // El tablero sigue consultando y pintando: no depende de que la lista de zonas
    // conteste para poder dar sus cifras.
    await waitFor(() => expect(accion.mock.calls.length).toBeGreaterThan(0));
    expect(await screen.findByRole("region", { name: "Ordenes creadas" })).toBeInTheDocument();

    // Y el selector afectado esta APAGADO, no ausente ni mintiendo con una lista vacia...
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Zona:/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Tienda:/ })).toBeDisabled();
    });

    // ...y la pantalla DICE por que esta apagado. Sin esta frase, «el catalogo dijo que
    // no» y «todavia no ha contestado» son el mismo control muerto y mudo: es lo unico
    // que distingue el degradado de dejar que la excepcion suba y la absorba SWR.
    expect(await screen.findByText(TEXTO_FILTROS_DEGRADADOS)).toBeInTheDocument();
    // El que SI contesto sigue usable: el degradado es por filtro, no por pantalla.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Mensajero:/ })).not.toBeDisabled(),
    );
  });

  it("un `forbidden` del catalogo tampoco rompe nada: mismo degradado", async () => {
    catalogo.mockResolvedValue({ status: "forbidden" });
    mensajeros.mockResolvedValue({ status: "forbidden" });
    renderPantalla();

    expect(await screen.findByRole("region", { name: "Ordenes creadas" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Zona:/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Mensajero:/ })).toBeDisabled();
    });
    expect(await screen.findByText(TEXTO_FILTROS_DEGRADADOS)).toBeInTheDocument();
  });

  it("con el catalogo sano, las opciones salen de las acciones existentes del repo", async () => {
    renderPantalla();
    await userEvent.click(await screen.findByRole("button", { name: /^Zona:/ }));
    expect(
      within(await screen.findByRole("listbox", { name: "Zona" })).getByRole("option", {
        name: /Zona Norte/,
      }),
    ).toBeInTheDocument();
    // Ningun catalogo propio: son las acciones que ya existian.
    expect(catalogo).toHaveBeenCalled();
    expect(mensajeros).toHaveBeenCalledWith("mensajero");
    // Y con todo sano no se avisa de nada: el aviso habla de un fallo real, no de la carga.
    expect(screen.queryByText(TEXTO_FILTROS_DEGRADADOS)).toBeNull();
  });
});

/* ========================================================================== */
/* R11 / R13 — lo que se emite en la primera carga                            */
/* ========================================================================== */

describe("Feature 131 (R13) — la primera consulta usa el filtro inicial declarado", () => {
  it("sin nada en la URL se consulta con `rango: semana` y sin dimensiones", async () => {
    renderPantalla();
    await waitFor(() => expect(accion.mock.calls.length).toBeGreaterThan(0));
    for (const [entrada] of accion.mock.calls) {
      expect(entrada.raw).toEqual({ rango: "semana" });
    }
  });
});

/* ========================================================================== */
/* Feature 133 (T4.1/T4.3) — R14, R15, R16, R17: QUE FACETAS SE DIBUJAN       */
/* ========================================================================== */

// Las facetas de cada rol se escriben POR VALOR, no se derivan de
// `recorteDePresentacion`: derivarlas de la funcion que produce la prop convertiria estos
// casos en una tautologia que pasaria incluso con «ofrecer siempre las tres». La
// correspondencia rol -> facetas la afirma, tambien por valor, el test del modulo
// (`tests/unit/analytics/presentacion.test.ts:38-49`); aqui se afirma lo que se DIBUJA
// dada esa lista. Los dos juntos cierran R14/R18 sin que ninguno se juzgue a si mismo.
//
// Y ese modulo no se importa aqui a proposito: arrastraria el catalogo de servidor
// (`lib/analytics/metrics`, y con el `@prisma/client`) a un test de jsdom, que es
// exactamente lo que el guardia de frontera impide que ocurra en la pantalla.

const FACETAS_POR_ROL = {
  // alcance global: las tres.
  maestro: ["zona", "tienda", "mensajero"],
  admin: ["zona", "tienda", "mensajero"],
  // alcance tienda: pierde «Tienda» por alcance (R14) y «Mensajero» por R15.
  adminTienda: ["zona"],
  // alcance zona: pierde «Zona» por alcance y las otras dos porque sus catalogos le
  // responden `forbidden` (Q4) — dibujarlas seria el control muerto que R16 prohibe.
  adminSatelite: [],
  // alcance mensajero: mismo motivo.
  mensajero: [],
} as const;

type RolDePrueba = keyof typeof FACETAS_POR_ROL;

const ROLES: readonly RolDePrueba[] = [
  "maestro",
  "admin",
  "adminTienda",
  "adminSatelite",
  "mensajero",
];

/** Los tres selectores de dimension, con el prefijo de su nombre accesible. */
const SELECTORES = [
  { faceta: "zona", nombre: /^Zona:/ },
  { faceta: "tienda", nombre: /^Tienda:/ },
  { faceta: "mensajero", nombre: /^Mensajero:/ },
] as const;

function renderBarra(facetas: readonly ("zona" | "tienda" | "mensajero")[]) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FiltrosOperativos facetas={facetas} />
    </SWRConfig>,
  );
}

describe("Feature 133 (R14/R16/R17) — la barra dibuja exactamente las facetas ofrecidas", () => {
  for (const rol of ROLES) {
    const facetas = FACETAS_POR_ROL[rol];

    it(`${rol}: dibuja [${facetas.join(", ") || "ninguna"}] y NINGUNA otra`, async () => {
      renderBarra(facetas);

      for (const { faceta, nombre } of SELECTORES) {
        const ofrecida = (facetas as readonly string[]).includes(faceta);
        if (ofrecida) {
          expect(await screen.findByRole("button", { name: nombre })).toBeInTheDocument();
        } else {
          // R16 — «no ofrecer es no dibujar»: ni presente, ni deshabilitado, ni vacio.
          expect(screen.queryByRole("button", { name: nombre })).toBeNull();
          expect(screen.queryByLabelText(nombre)).toBeNull();
          // Tampoco un control muerto agazapado sin rol accesible.
          expect(screen.queryByText(nombre)).toBeNull();
        }
      }
    });

    it(`${rol}: SIEMPRE ve el selector de Rango (R17)`, () => {
      renderBarra(facetas);
      expect(screen.getByRole("combobox", { name: "Rango" })).toBeInTheDocument();
    });
  }

  it("adminSatelite: sin «Zona» — su alcance ya la tiene fijada (R14)", () => {
    renderBarra(FACETAS_POR_ROL.adminSatelite);
    expect(screen.queryByRole("button", { name: /^Zona:/ })).toBeNull();
  });

  it("mensajero: sin «Mensajero» — su alcance ya lo tiene fijado (R14)", () => {
    renderBarra(FACETAS_POR_ROL.mensajero);
    expect(screen.queryByRole("button", { name: /^Mensajero:/ })).toBeNull();
  });

  it("adminTienda: sin «Tienda» (R14) y sin «Mensajero» (R15), con «Zona» y «Rango»", async () => {
    renderBarra(FACETAS_POR_ROL.adminTienda);
    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rango" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Tienda:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Mensajero:/ })).toBeNull();
  });
});

describe("Feature 133 (R16) — un selector ausente no reaparece apagado ni como nota", () => {
  it("con los dos catalogos caidos, el que NO se ofrece sigue sin existir y no se anuncia su degradado", async () => {
    // El caso peor: los dos catalogos responden `forbidden`, que es justo lo que le
    // responden a un `adminSatelite` (`FiltrosOrdenesService.ts:28`,
    // `UsuariosPorRolService.ts:15`).
    catalogo.mockResolvedValue({ status: "forbidden" });
    mensajeros.mockResolvedValue({ status: "forbidden" });

    renderBarra(FACETAS_POR_ROL.adminSatelite);
    // El Rango, que no es una faceta, sigue ahi: la barra esta viva.
    expect(screen.getByRole("combobox", { name: "Rango" })).toBeInTheDocument();

    // Ni un selector deshabilitado...
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /^(Zona|Tienda|Mensajero):/ })).toEqual([]));
    expect(document.querySelectorAll("button[disabled]")).toHaveLength(0);

    // ...ni la nota de degradado en su lugar. Un aviso de que «algun filtro no esta
    // disponible» sobre un control que NO EXISTE en la pantalla es el mismo control
    // muerto que R16 prohibe, servido como texto en vez de como selector.
    expect(screen.queryByText(TEXTO_FILTROS_DEGRADADOS)).toBeNull();
  });

  it("y no se pide un catalogo cuyo selector no se dibuja", async () => {
    renderBarra(FACETAS_POR_ROL.mensajero);
    expect(screen.getByRole("combobox", { name: "Rango" })).toBeInTheDocument();
    // Ninguna de las dos acciones se invoca: seria un `forbidden` auditado por pantalla
    // cargada cuyo resultado nadie podria mirar.
    await waitFor(() => expect(screen.queryByRole("button", { name: /:/ })).toBeNull());
    expect(catalogo).not.toHaveBeenCalled();
    expect(mensajeros).not.toHaveBeenCalled();
  });

  it("adminTienda pide el catalogo de zonas/tiendas pero NO el directorio de mensajeros", async () => {
    renderBarra(FACETAS_POR_ROL.adminTienda);
    await screen.findByRole("button", { name: /^Zona:/ });
    expect(catalogo).toHaveBeenCalled();
    expect(mensajeros).not.toHaveBeenCalled();
  });
});

describe("Feature 133 (R15) — a un adminTienda no se le publica el directorio de mensajeros", () => {
  /**
   * Por que este caso y no solo «no esta el selector»: `UsuariosPorRolService.ts:15` SI
   * autoriza a `adminTienda`, de modo que ese desplegable le serviria el directorio de
   * mensajeros con NOMBRE REAL y UUID — justo lo que R38/R39 de la 122 (identidad
   * seudonima) existen para impedir a quien ve el grano mensajero seudonimizado. La
   * fixture trae nombres y uuids reconocibles a proposito: si el selector volviera, o si
   * alguien lo dejara oculto pero siguiera cargando las opciones en el DOM, esto cae.
   *
   * R27 — Y HAY QUE DECIRLO EN VOZ ALTA: ocultar el selector NO CIERRA el oraculo
   * residual contra R39 de la 122 (hallazgo M-4 de `progress/review_122.md`, ficha
   * propuesta 182). El `mensajero_id` sigue viajando por la URL y por el argumento de la
   * Server Action, asi que un `adminTienda` que conozca un uuid puede seguir
   * preguntando por el y leer la respuesta en el conteo. Lo que se quita aqui es la
   * COMODIDAD, no el canal: la prohibicion efectiva es del BORDE (`recortarFiltro`,
   * zona backend). Nada de este archivo debe leerse como que ese agujero quedo cerrado.
   */
  const DIRECTORIO = [
    { id: "3f2b6c1e-0d4a-4f6b-9c2d-8e7a1b5c3d90", nombre: "Beto Repartidor" },
    { id: "7c9e4a2d-11b8-4c3e-8a5f-2d6b9e0f1a34", nombre: "Karla Mensajera" },
  ];

  it("ni un nombre ni un uuid del directorio aparece en el documento", async () => {
    mensajeros.mockResolvedValue({ status: "ok", usuarios: DIRECTORIO });

    renderBarra(FACETAS_POR_ROL.adminTienda);
    await screen.findByRole("button", { name: /^Zona:/ });
    // Se deja respirar por si alguna carga tardia intentara poblar algo.
    await waitFor(() => expect(catalogo).toHaveBeenCalled());

    const cuerpo = document.body.textContent ?? "";
    const html = document.body.innerHTML;
    for (const { id, nombre } of DIRECTORIO) {
      expect(cuerpo).not.toContain(nombre);
      expect(cuerpo).not.toContain(id);
      expect(html).not.toContain(nombre);
      expect(html).not.toContain(id);
    }
  });
});
