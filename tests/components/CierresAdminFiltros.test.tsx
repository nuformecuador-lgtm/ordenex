// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import {
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
  listarPendientesCierresAdminCompleto,
} from "@/lib/actions/cierres-admin";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import type { CatalogoFiltrosCierresDTO } from "@/lib/types/filtros-cierres";

// Pedido humano del 2026-08-16 — «filtros por fechas, bodegas, mensajeros» en el listado de
// cierres, por el lado de la PANTALLA.
//
// Lo que el borde y el repositorio ya tienen cubierto no se repite aquí: la lista blanca vive en
// `tests/unit/guards/filtros-cierres-alcance.guardia.test.ts` y la traducción a SQL —incluida la
// intersección que impide que un `adminSatelite` vea la bodega vecina— en
// `tests/unit/repositories/cierres-filtros-where.test.ts`.
//
// Aquí se afirma lo que SOLO se ve montando la pantalla, que son cuatro cosas y las cuatro se
// rompen en silencio:
//   1. el filtro VIAJA al servidor en las dos lecturas (cola e histórico), no se aplica en el
//      cliente sobre la página ya recibida —que filtraría 25 filas y llamaría a eso «filtrar»—;
//   2. cambiar un filtro devuelve las dos a la PÁGINA 1: sin eso, quien esté en la página 7 pide
//      la 7 de un conjunto recién recortado y ve un listado vacío con un contador que dice que
//      hay filas;
//   3. el filtro se lleva a la DESCARGA: «descargar» tiene que seguir significando «esto que
//      estoy viendo, entero»;
//   4. con un filtro puesto se AVISA de que la cola también está recortada — es el coste de
//      compartir una barra entre los dos listados, y callarlo deja trabajo sin hacer.

vi.mock("@/lib/actions/cierres-admin", () => ({
  // Feature 230 (T2.3): el borde de la descarga DETALLADA de esta pantalla. Se añade al doble
  // porque el módulo la importa; ninguna aserción de este archivo cambia.
  listarGestionesCierresAdminCompleto: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
  listarPendientesCierresAdminPaginado: vi.fn(),
  listarHistoricoCierresAdminCompleto: vi.fn(),
  listarPendientesCierresAdminCompleto: vi.fn(),
  obtenerCatalogoFiltrosCierres: vi.fn(),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));

const historicoMock = vi.mocked(listarHistoricoCierresAdminPaginado);
const pendientesMock = vi.mocked(listarPendientesCierresAdminPaginado);
const pendientesCompletoMock = vi.mocked(listarPendientesCierresAdminCompleto);

const TOTALES: CierreTotales = {
  efectivo: "100.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "100.00",
};

const ZONA_A = "11111111-1111-4111-8111-111111111111";
const MENSAJERO_DIANA = "33333333-3333-4333-8333-333333333333";

const ZONA_B = "44444444-4444-4444-8444-444444444444";
const MENSAJERO_BETO = "55555555-5555-4555-8555-555555555555";

const CATALOGO: CatalogoFiltrosCierresDTO = {
  // Dos zonas y dos mensajeros, uno en cada una: sin la segunda, el encadenado no tendría nada
  // que podar y el caso pasaría sin vigilar nada.
  zonas: [
    { id: ZONA_A, nombre: "Bodega Heredia" },
    { id: ZONA_B, nombre: "Bodega Limón" },
  ],
  mensajeros: [
    { id: MENSAJERO_DIANA, nombre: "Diana Mora", zonaId: ZONA_A },
    { id: MENSAJERO_BETO, nombre: "Beto de Otra Zona", zonaId: ZONA_B },
  ],
};

function cierre(cierreId: string, mensajeroNombre: string): CierreAdminResumen {
  return {
    cierreId,
    mensajeroId: `m-${cierreId}`,
    mensajeroNombre,
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    destinoZonaNombre: "Central",
    totales: TOTALES,
    totalPagoMensajero: "10.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-08-10T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  };
}

/**
 * La página que devuelven los dobles. `total` se pasa aparte porque el caso de la paginación
 * necesita un conjunto MAYOR que la página: con `total === items.length` sólo hay una página y
 * el botón «Página siguiente» viene deshabilitado, así que el caso pasaría sin haber paginado.
 */
function pagina(items: CierreAdminResumen[], total = items.length) {
  return { status: "ok" as const, items, page: 1, pageSize: 25, total };
}

function montar(items: CierreAdminResumen[] = [cierre("c1", "Diana Mora")], total?: number) {
  const inicial = { items, total: total ?? items.length, pageSize: 25 };
  pendientesMock.mockResolvedValue(pagina(items, total));
  historicoMock.mockResolvedValue(pagina([]));
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierresAdminModule
        pendientes={inicial}
        historico={{ items: [], total: 0, pageSize: 25 }}
        sinZona={false}
        catalogoFiltros={CATALOGO}
      />
    </SWRConfig>,
  );
}

/**
 * PIDE un filtro en el selector de la barra. Es el gesto que `/ordenes` ya tenía y que esta
 * pantalla heredó al montar `BuscadorFiltros` (pedido humano del 2026-08-16): los filtros no
 * están puestos de entrada, se piden uno a uno. Sin este paso el control no existe.
 */
async function pedirFiltro(user: ReturnType<typeof userEvent.setup>, label: string) {
  // El selector se queda ABIERTO tras marcar una opción (se pueden pedir varios de una vez),
  // así que pulsar el disparador otra vez lo cerraría. Se abre solo si hace falta.
  if (screen.queryByRole("listbox", { name: "Filtros" }) === null) {
    const barra = screen.getByRole("region", { name: "Filtros de los cierres del día" });
    await user.click(within(barra).getByRole("button", { name: /^Filtros/ }));
  }
  await user.click(
    within(await screen.findByRole("listbox", { name: "Filtros" })).getByRole("option", {
      name: label,
    }),
  );
}

/** Pide el filtro `label` y marca en él la opción `opcion`. */
async function elegir(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  opcion: string,
) {
  await pedirFiltro(user, label);
  const barra = screen.getByRole("region", { name: "Filtros de los cierres del día" });
  await user.click(within(barra).getByRole("button", { name: new RegExp(label) }));
  await user.click(await screen.findByRole("option", { name: opcion }));
}

beforeEach(() => {
  vi.clearAllMocks();
  pendientesCompletoMock.mockResolvedValue({
    status: "ok",
    items: [],
    total: 0,
  } as never);
});

afterEach(() => {
  cleanup();
});

describe("Filtros del listado de cierres del día", () => {
  it("la barra ofrece los tres filtros del pedido: fecha, bodega y mensajero", async () => {
    // Es la MISMA barra de `/ordenes`: los filtros se piden en el selector, no están puestos de
    // entrada. Lo que este caso fija es QUÉ se ofrece —los tres del pedido humano, y solo esos—.
    const user = userEvent.setup();
    montar();
    const barra = await screen.findByRole("region", {
      name: "Filtros de los cierres del día",
    });

    await user.click(within(barra).getByRole("button", { name: /^Filtros/ }));
    const opciones = within(screen.getByRole("listbox", { name: "Filtros" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opciones).toEqual(["Fecha de solicitud", "Bodega", "Mensajero"]);
  });

  it("elegir una bodega recorta los mensajeros a los de esa zona (encadenado)", async () => {
    // La tercera regla del humano: «si ahí filtro de una zona, filtra los mensajeros de dicha
    // zona». Se apoya en el `dependsOn`/`parentValue` de `FilterComponent` —el mismo mecanismo
    // con el que `/ordenes` encadena provincia → cantón—, así que lo que hay que comprobar aquí
    // es el CABLEADO: que cada mensajero viaja con su zona y que el filtro declara su padre.
    const user = userEvent.setup();
    montar();
    await screen.findByRole("region", { name: "Filtros de los cierres del día" });

    await pedirFiltro(user, "Bodega");
    await pedirFiltro(user, "Mensajero");
    const barra = screen.getByRole("region", { name: "Filtros de los cierres del día" });

    // Sin bodega elegida se ofrecen TODOS los mensajeros (regla 2 del humano).
    await user.click(within(barra).getByRole("button", { name: /Mensajero/ }));
    expect(await screen.findByRole("option", { name: "Diana Mora" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beto de Otra Zona" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // Con la bodega de Diana elegida, el de la otra zona desaparece de la lista.
    await user.click(within(barra).getByRole("button", { name: /Bodega/ }));
    await user.click(await screen.findByRole("option", { name: "Bodega Heredia" }));
    await user.keyboard("{Escape}");

    await user.click(within(barra).getByRole("button", { name: /Mensajero/ }));
    expect(await screen.findByRole("option", { name: "Diana Mora" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Beto de Otra Zona" })).not.toBeInTheDocument();
  });

  it("(1) el filtro VIAJA al servidor, en las DOS lecturas", async () => {
    // La afirmación que separa «filtrar» de «esconder filas de la página que ya tengo». Si el
    // recorte se hiciera en el cliente, estas llamadas seguirían llegando sin `filtros` y el
    // usuario vería 3 de 25 filas creyendo que son 3 de 300.
    const user = userEvent.setup();
    montar();
    await screen.findByRole("region", { name: "Filtros de los cierres del día" });

    await elegir(user, "Mensajero", "Diana Mora");

    await waitFor(() => {
      expect(pendientesMock).toHaveBeenCalledWith(
        expect.objectContaining({ filtros: { mensajeroIds: [MENSAJERO_DIANA] } }),
      );
    });
    expect(historicoMock).toHaveBeenCalledWith(
      expect.objectContaining({ filtros: { mensajeroIds: [MENSAJERO_DIANA] } }),
    );
  });

  it("(2) cambiar un filtro devuelve los dos listados a la página 1", async () => {
    const user = userEvent.setup();
    // 60 cierres en el conjunto y 25 por página: hay páginas a las que ir.
    montar([cierre("c1", "Diana Mora")], 60);
    await screen.findByRole("region", { name: "Filtros de los cierres del día" });

    // A la página 2 de la cola, y desde allí se filtra.
    const nav = screen.getByRole("navigation", {
      name: "Paginación de los cierres del día pendientes",
    });
    await user.click(within(nav).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() =>
      expect(pendientesMock).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })),
    );

    await elegir(user, "Bodega", "Bodega Heredia");

    await waitFor(() => {
      // La lectura CON filtro vuelve a pedir la página 1: pedir la 2 de un conjunto recién
      // recortado devolvería vacío junto a un contador que dice que hay filas.
      expect(pendientesMock).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, filtros: { destinoZonaIds: [ZONA_A] } }),
      );
    });
  });

  it("(3) el filtro se lleva a la descarga: el archivo es lo que se está viendo, entero", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole("region", { name: "Filtros de los cierres del día" });

    await elegir(user, "Mensajero", "Diana Mora");
    await waitFor(() =>
      expect(pendientesMock).toHaveBeenCalledWith(
        expect.objectContaining({ filtros: { mensajeroIds: [MENSAJERO_DIANA] } }),
      ),
    );

    // El control de descarga vive en la FILA DE LAS PESTAÑAS desde el 2026-08-16 (pedido
    // humano: alineado con «Pendientes/Resueltos»), así que ya no está dentro de la sección del
    // listado. Es el de la pestaña ACTIVA, y al entrar la activa es «Pendientes».
    //
    // Feature 230 (T5.1): el nombre pasa de la regex `/Descargar/` al nombre accesible EXACTO
    // del control general. Desde esta feature la fila tiene DOS controles —el general y el
    // detallado (R1)—, así que la regex encontraba dos y el caso ya no podía decir cuál pulsaba.
    // Lo que este caso afirma no cambia: es el GENERAL el que se lleva el filtro de la pantalla;
    // el detallado, por decisión del humano (D11), no lo hereda.
    await user.click(
      screen.getByRole("button", { name: "Descargar Cierres pendientes de decisión" }),
    );

    await waitFor(() =>
      expect(pendientesCompletoMock).toHaveBeenCalledWith({
        filtros: { mensajeroIds: [MENSAJERO_DIANA] },
      }),
    );
  });

  it("(4) con un filtro puesto se avisa de que la COLA también está recortada, y se puede limpiar", async () => {
    // El coste de compartir una barra entre los dos listados, dicho en voz alta. Sin el aviso,
    // «no hay cierres pendientes» y «no hay pendientes que casen con el filtro» se leen igual, y
    // el segundo deja trabajo sin hacer.
    const user = userEvent.setup();
    montar();
    const barra = await screen.findByRole("region", {
      name: "Filtros de los cierres del día",
    });
    expect(within(barra).queryByRole("note")).not.toBeInTheDocument();
    // «Limpiar todo» lo pone la propia barra de `/ordenes`, y solo cuando hay algo que limpiar.
    expect(
      within(barra).queryByRole("button", { name: /Limpiar todo/ }),
    ).not.toBeInTheDocument();

    await elegir(user, "Mensajero", "Diana Mora");
    await user.keyboard("{Escape}");

    // El aviso dice que los DOS listados están recortados —no solo el que se está mirando—,
    // que es el coste de compartir una barra entre las dos pestañas.
    expect(await within(barra).findByRole("note")).toHaveTextContent(/los dos listados/i);

    // Y limpiar devuelve la pantalla al estado sin recorte: la lectura vuelve a ir sin filtros.
    await user.click(within(barra).getByRole("button", { name: /Limpiar todo/ }));
    await waitFor(() =>
      expect(pendientesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, filtros: {} }),
      ),
    );
    expect(within(barra).queryByRole("note")).not.toBeInTheDocument();
  });

  it("sin catálogo la pantalla sigue viva: se puede listar aunque no se pueda filtrar", () => {
    // El Server Component NO tumba la página si el catálogo falla (`page.tsx`): un listado de
    // cierres que no se puede abrir es peor que uno que no se puede filtrar. Esto fija esa
    // decisión desde el lado del cliente, que es donde se notaría el descuido.
    pendientesMock.mockResolvedValue(pagina([cierre("c1", "Diana Mora")]));
    historicoMock.mockResolvedValue(pagina([]));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <CierresAdminModule
          pendientes={{ items: [cierre("c1", "Diana Mora")], total: 1, pageSize: 25 }}
          historico={{ items: [], total: 0, pageSize: 25 }}
          sinZona={false}
        />
      </SWRConfig>,
    );

    expect(screen.getByRole("region", { name: "Pendientes de decisión" })).toBeInTheDocument();
    expect(screen.getByText("Diana Mora")).toBeInTheDocument();
  });
});
