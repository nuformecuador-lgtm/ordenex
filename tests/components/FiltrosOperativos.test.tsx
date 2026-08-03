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
