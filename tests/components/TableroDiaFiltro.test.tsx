// @vitest-environment jsdom
//
// Feature 258 (F4.5) — FILTRO por nombre, DENSIDAD y TOTALES RECALCULADOS.
// Mapea: R39, R40, R41, R42, R43, R44, R45, R64, R65, R73.
//
// El punto delicado de esta parte es una decisión humana tomada EN CONTRA de lo que el diseño
// recomendaba (`design.md` §12.3): con filtro activo, los totales pasan a ser los de las
// tarjetas visibles. El riesgo —leer «26 asignadas» y creer que es el día entero— se cerró con
// TRES señales a la vez (R64), y las tres se miden aquí. La del DOM (`data-filtrado`) es la
// que hace la distinción testeable SIN leer una cadena de UI: un test sobre el rótulo se rompe
// con cualquier retoque de copy y no dice nada del estado.
//
// La URL es MUTABLE en este archivo (el doble de `next/navigation` la publica con un store):
// sin eso, «filtrar NO toca la URL» (R73) pasaría por vacío.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { CLAVES_CONTADOR } from "@/app/(app)/monitoreo/_components/contadores";
import { QUITAR_FILTRO } from "@/app/(app)/monitoreo/_components/TableroDiaEstados";
import { TableroDiaModule } from "@/app/(app)/monitoreo/_components/TableroDiaModule";
import { leerTableroDia } from "@/lib/actions/tablero-dia";
import {
  sumarTotalesTablero,
  type FilaTableroDia,
  type TableroDia,
} from "@/lib/types/tablero-dia";

vi.mock("@/lib/actions/tablero-dia", () => ({
  leerTableroDia: vi.fn(),
  leerDetalleMensajeroDia: vi.fn(),
}));

/** La URL del navegador, con suscriptores: `router.replace` la cambia y la vista se entera. */
const estadoUrl = vi.hoisted(() => ({
  params: new URLSearchParams(),
  oyentes: new Set<() => void>(),
}));

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/monitoreo",
    useRouter: () => ({
      push: vi.fn(),
      refresh: vi.fn(),
      replace: (url: string) => {
        const [, consulta = ""] = url.split("?");
        estadoUrl.params = new URLSearchParams(consulta);
        for (const oyente of estadoUrl.oyentes) oyente();
      },
    }),
    useSearchParams: () =>
      React.useSyncExternalStore(
        (oyente: () => void) => {
          estadoUrl.oyentes.add(oyente);
          return () => {
            estadoUrl.oyentes.delete(oyente);
          };
        },
        () => estadoUrl.params,
        () => estadoUrl.params,
      ),
  };
});

const leerTableroMock = vi.mocked(leerTableroDia);

const AHORA = new Date("2026-08-08T20:00:00.000Z");

const fila = (
  mensajeroId: string,
  mensajeroNombre: string,
  parcial: Partial<FilaTableroDia> = {},
): FilaTableroDia => ({
  mensajeroId,
  mensajeroNombre,
  asignadas: 8,
  entregadas: 3,
  reprogramadas: 1,
  devueltas: 1,
  rechazadas: 1,
  incidentes: 0,
  sinRecoger: 1,
  enReparto: 1,
  otros: 0,
  ...parcial,
});

/** Tres mensajeros con `asignadas` distintas, para que el orden sea comprobable. */
const FILAS: readonly FilaTableroDia[] = [
  fila("m-1", "Ángela Jiménez", { asignadas: 16, entregadas: 11 }),
  fila("m-2", "Bruno Díaz", { asignadas: 8 }),
  fila("m-3", "Ana Rojas", { asignadas: 4, entregadas: 1, sinRecoger: 0, enReparto: 1 }),
];

function tableroCon(filas: readonly FilaTableroDia[]): TableroDia {
  const totales = sumarTotalesTablero(filas);
  return {
    fecha: "2026-08-08",
    generadoAt: AHORA.toISOString(),
    alcance: "global",
    filas,
    totales,
    ritmoEntregas: [{ hora: 0, acumulado: totales.entregadas }],
  };
}

function renderModulo() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TableroDiaModule />
    </SWRConfig>,
  );
}

const tira = (): HTMLElement =>
  document.querySelector('[data-slot="tablero-dia-totales"]') as HTMLElement;

const contadorDe = (raiz: HTMLElement, clave: string): HTMLElement =>
  raiz.querySelector(`[data-contador="${clave}"]`) as HTMLElement;

const idsPintados = (): string[] =>
  [...document.querySelectorAll("[data-mensajero]")].map(
    (nodo) => nodo.getAttribute("data-mensajero") ?? "",
  );

const campoFiltro = () => screen.getByRole("searchbox", { name: /Filtrar por nombre/i });

beforeEach(() => {
  vi.clearAllMocks();
  estadoUrl.params = new URLSearchParams();
  leerTableroMock.mockResolvedValue({ estado: "ok", tablero: tableroCon(FILAS) });
});

afterEach(cleanup);

async function montarYEsperar() {
  renderModulo();
  await waitFor(() => expect(idsPintados()).toHaveLength(FILAS.length));
}

describe("Feature 258 · R39 — el filtro es un `Input` con nombre accesible", () => {
  it("existe, y con él el conmutador de densidad", async () => {
    await montarYEsperar();

    const campo = campoFiltro();
    // La primitiva del repo, no un `<input>` a mano.
    expect(campo.getAttribute("data-slot")).toBe("input");
    expect(screen.getByRole("group", { name: /Densidad del tablero/i })).toBeInTheDocument();
  });
});

describe("Feature 258 · R40/R41/R73 — filtrar recorta y NADA más", () => {
  it("«jimenez» encuentra «Ángela Jiménez»: sin acentos y sin distinguir mayúsculas", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();

    await usuario.type(campoFiltro(), "jimenez");

    await waitFor(() => expect(idsPintados()).toEqual(["m-1"]));
  });

  it("filtrar NO vuelve a llamar a `leerTableroDia`", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();
    const consultas = leerTableroMock.mock.calls.length;

    await usuario.type(campoFiltro(), "ana");
    await waitFor(() => expect(idsPintados()).toEqual(["m-3"]));

    expect(
      leerTableroMock.mock.calls.length,
      "el filtro disparó una consulta: recorta lo ya cargado, no vuelve a pedir",
    ).toBe(consultas);
  });

  it("filtrar NO cambia la URL: el único parámetro de la ruta sigue siendo `?mensajero=`", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();

    await usuario.type(campoFiltro(), "bruno");
    await waitFor(() => expect(idsPintados()).toEqual(["m-2"]));

    expect([...estadoUrl.params.keys()]).toEqual([]);
  });

  it("el orden de las que quedan no cambia (R6)", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();
    // Sin filtro: por `asignadas` descendente.
    expect(idsPintados()).toEqual(["m-1", "m-2", "m-3"]);

    // «a» las deja las tres: el orden tiene que ser el mismo.
    await usuario.type(campoFiltro(), "a");
    await waitFor(() => expect(idsPintados()).toEqual(["m-1", "m-2", "m-3"]));
  });
});

describe("Feature 258 · R42 — sin coincidencias sale el vacío PROPIO del filtro", () => {
  it("es distinto del vacío del día, y trae la salida para quitar el filtro", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();

    await usuario.type(campoFiltro(), "zzz");

    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="tablero-dia-sin-coincidencias"]'),
      ).not.toBeNull(),
    );
    // NO es el vacío del día: el día sí tiene órdenes.
    expect(document.querySelector('[data-slot="tablero-dia-vacio"]')).toBeNull();
    expect(idsPintados()).toEqual([]);

    // Y la salida funciona: vuelve el tablero entero.
    await usuario.click(screen.getByRole("button", { name: QUITAR_FILTRO }));
    await waitFor(() => expect(idsPintados()).toEqual(["m-1", "m-2", "m-3"]));
  });
});

describe("Feature 258 · R43/R64/R65 — los totales con filtro activo", () => {
  it("sin filtro NO lleva `data-filtrado` y el rótulo habla del día", async () => {
    await montarYEsperar();

    expect(tira().hasAttribute("data-filtrado")).toBe(false);
    expect(tira()).toHaveTextContent(/Totales del día/i);
    expect(contadorDe(tira(), "asignadas")).toHaveTextContent("28"); // 16 + 8 + 4
  });

  it("con filtro, los totales son EXACTAMENTE los de las tarjetas visibles", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();

    await usuario.type(campoFiltro(), "ana rojas");
    await waitFor(() => expect(idsPintados()).toEqual(["m-3"]));

    const visible = FILAS.find((f) => f.mensajeroId === "m-3")!;
    for (const clave of CLAVES_CONTADOR) {
      expect(contadorDe(tira(), clave)).toHaveTextContent(String(visible[clave]));
    }
    expect(contadorDe(tira(), "asignadas")).toHaveTextContent(String(visible.asignadas));
  });

  it("R64: con filtro cambian las TRES señales — rótulo, «N de M» y el atributo del DOM", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();

    await usuario.type(campoFiltro(), "ana rojas");
    await waitFor(() => expect(tira().hasAttribute("data-filtrado")).toBe(true));

    // (a) el rótulo ya no dice «del día».
    expect(tira()).toHaveTextContent(/Totales de lo filtrado/i);
    expect(tira()).not.toHaveTextContent(/Totales del día/i);
    // (b) cuántos coinciden de cuántos, en una región viva.
    const conteo = tira().querySelector(
      '[data-slot="tablero-dia-coincidencias"]',
    ) as HTMLElement;
    expect(conteo.getAttribute("role")).toBe("status");
    expect(conteo.getAttribute("aria-live")).toBe("polite");
    expect(conteo).toHaveTextContent("1 de 3 mensajeros");
  });

  it("R65/R3: la identidad de los ocho sumandos se cumple sobre los totales filtrados", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();

    // Dos visibles: la suma tiene que seguir siendo la de sus asignadas, sin residuo.
    await usuario.type(campoFiltro(), "n");
    await waitFor(() => expect(idsPintados()).toEqual(["m-1", "m-2", "m-3"]));
    await usuario.clear(campoFiltro());
    await usuario.type(campoFiltro(), "díaz");
    await waitFor(() => expect(idsPintados()).toEqual(["m-2"]));

    const leer = (clave: string) =>
      Number.parseInt(contadorDe(tira(), clave).textContent?.replace(/\D+/g, "") ?? "", 10);

    const suma = CLAVES_CONTADOR.reduce((total, clave) => total + leer(clave), 0);
    expect(
      suma,
      "los ocho sumandos ya no dan las asignadas: hay una segunda suma en alguna parte",
    ).toBe(leer("asignadas"));
  });
});

describe("Feature 258 · R44/R45 — la densidad es presentación PURA", () => {
  const opcion = (nombre: RegExp) => screen.getByRole("button", { name: nombre });

  it("arranca en CÓMODA", async () => {
    await montarYEsperar();

    expect(opcion(/^Cómoda$/i).getAttribute("aria-pressed")).toBe("true");
    expect(opcion(/^Compacta$/i).getAttribute("aria-pressed")).toBe("false");
  });

  it("cambiarla no consulta, no cambia cifras, ni orden, ni qué tarjetas se ven", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();

    const consultas = leerTableroMock.mock.calls.length;
    const ordenAntes = idsPintados();
    const cifrasAntes = CLAVES_CONTADOR.map(
      (clave) => contadorDe(tira(), clave).textContent,
    );

    await usuario.click(opcion(/^Compacta$/i));
    await waitFor(() => expect(opcion(/^Compacta$/i).getAttribute("aria-pressed")).toBe("true"));

    expect(leerTableroMock.mock.calls.length).toBe(consultas);
    expect(idsPintados()).toEqual(ordenAntes);
    expect(CLAVES_CONTADOR.map((clave) => contadorDe(tira(), clave).textContent)).toEqual(
      cifrasAntes,
    );
  });

  it("en compacta el nombre accesible de un contador SIGUE diciendo su etiqueta", async () => {
    const usuario = userEvent.setup();
    await montarYEsperar();
    await usuario.click(opcion(/^Compacta$/i));

    const tarjeta = document.querySelector('[data-mensajero="m-1"]') as HTMLElement;
    const chip = contadorDe(tarjeta, "entregadas");

    // Sigue en el DOM (en `sr-only`), así que quien escucha oye «Entregadas 11».
    expect(within(chip).getByText("Entregadas")).toBeInTheDocument();
    expect(chip).toHaveTextContent("11");
  });
});
