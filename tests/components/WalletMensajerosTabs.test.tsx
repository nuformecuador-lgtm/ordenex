// @vitest-environment jsdom
// FICHA 298 (2026-08-27, pedido del humano) — LAS DOS PESTAÑAS DE `/wallet/mensajeros`.
//
// **El desorden que cierran.** El 2026-08-27 se desplegó la 293 y su panel de premios quedó
// APILADO encima de la tabla de cuentas por pagar, dentro de la misma sección: dos bloques con su
// propio selector, su propia tabla y sus propios botones, uno detrás del otro. El humano lo dijo
// así: «al meter ese nuevo apartado en mensajeros creó desorden, sepáralo por tabs por lo menos».
//
// **Lo que este archivo mide y ningún test de servidor puede medir:**
//
//  - que cada bloque vive en SU pestaña —y que a los dos se llega con una pulsación—;
//  - que la que ABRE es la de las cuentas por pagar, que es a lo que se entra a esta pantalla;
//  - y, la que de verdad importa, que **el REFRESCO CRUZADO sobrevive a las pestañas**: registrar
//    un premio cambia lo que se le debe a ese mensajero, y el saldo de la otra pestaña tiene que
//    quedar al día sin recargar la página. Un saldo viejo tras registrar un premio sería peor que
//    el desorden que la ficha viene a arreglar.
//
// Acá se montan los DOS componentes REALES (tabla y panel), no dobles: lo único que se dobla son
// las Server Actions, porque el refresco se mide por las llamadas que provoca. La única excepción
// es `DesglosePagosMensajero`, que sólo se monta al expandir una fila y arrastraría media
// pantalla de liquidación a jsdom; acá no se expande ninguna.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import type { DesglosePagosMensajeroProps } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";
import type { PremioPodioDTO } from "@/lib/types/premio-ranking-devengo";

vi.mock(
  "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero",
  () => ({
    DesglosePagosMensajero: ({ resumen }: DesglosePagosMensajeroProps) => (
      <div data-testid={`desglose-stub-${resumen.mensajeroId}`} />
    ),
  }),
);

const { paginadoMock, conjuntoMock, listarPremiosMock, registrarMock, anularMock } =
  vi.hoisted(() => ({
    paginadoMock: vi.fn(),
    conjuntoMock: vi.fn(),
    listarPremiosMock: vi.fn(),
    registrarMock: vi.fn(),
    anularMock: vi.fn(),
  }));

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarCompletoAction: (...a: unknown[]) => conjuntoMock(...a),
  listarCuentasPorPagarPaginadoAction: (...a: unknown[]) => paginadoMock(...a),
  listarPagosDeMensajeroAction: vi.fn(),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
}));

vi.mock("@/lib/actions/premio-ranking-devengo", () => ({
  listarPremiosDelDiaAction: (...a: unknown[]) => listarPremiosMock(...a),
  registrarPremioAction: (...a: unknown[]) => registrarMock(...a),
  anularPremioAction: (...a: unknown[]) => anularMock(...a),
}));

import { ToastProvider } from "@/providers/ToastProvider";
import { WalletMensajerosTabs } from "@/app/(app)/wallet/mensajeros/_components/WalletMensajerosTabs";

// --- Datos ---------------------------------------------------------------

const FECHA = "2026-08-26";
const HOY = "2026-08-27";

/** Ana debe ₡2.000 ANTES del premio. Tras registrarlo, ₡7.000 (el premio es de ₡5.000). */
const ANTES: CuentaPorPagarResumenDTO = {
  mensajeroId: "u1",
  mensajeroNombre: "Ana Mensajera",
  devengado: "5000.00",
  pagado: "3000.00",
  cuentaPorPagar: "2000.00",
  signo: "positivo",
};
const DESPUES: CuentaPorPagarResumenDTO = {
  ...ANTES,
  devengado: "10000.00",
  cuentaPorPagar: "7000.00",
};

const PRIMERO: PremioPodioDTO = {
  filaId: "fila-1",
  posicion: 1,
  mensajeroNombre: "Ana Mensajera",
  entregadas: 12,
  asignadas: 21,
  premioMonto: "5000.00",
  premioDescripcion: "Bono por buen rendimiento",
  estado: "no_registrado",
  cierreEstado: "aprobado",
};

function pagina(items: CuentaPorPagarResumenDTO[]) {
  return {
    status: "ok" as const,
    page: 1,
    pageSize: 25,
    items,
    total: items.length,
  };
}

function podio(filas: PremioPodioDTO[]) {
  return { status: "ok" as const, fecha: FECHA, hayPodio: true, filas };
}

/**
 * Monta las pestañas con una caché de SWR propia (`provider` nuevo + sin dedup), para que una
 * lectura de otro test no se cuele en éste, y con el proveedor de avisos que la app pone encima
 * (`app/(app)/layout.tsx`): la tabla monta el control de descarga y el panel usa `useToast`.
 */
function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <WalletMensajerosTabs
          cuentas={{ initialData: { items: [ANTES], total: 1, pageSize: 25 } }}
          premios={{ fechaInicial: FECHA, fechaMaxima: HOY }}
        />
      </ToastProvider>
    </SWRConfig>,
  );
}

/** El panel ACTIVO. `getByRole` sólo ve el visible: el inactivo va `hidden` + `inert`. */
function panelActivo(): HTMLElement {
  return screen.getByRole("tabpanel");
}

beforeEach(() => {
  vi.clearAllMocks();
  paginadoMock.mockResolvedValue(pagina([ANTES]));
  conjuntoMock.mockResolvedValue(pagina([ANTES]));
  listarPremiosMock.mockResolvedValue(podio([PRIMERO]));
});

afterEach(() => {
  cleanup();
});

describe("298 — cada bloque en SU pestaña", () => {
  it("hay DOS pestañas y la de CUENTAS POR PAGAR es la que abre", async () => {
    montar();

    // El orden no es decorativo: a esta pantalla se entra a pagar lo que se debe, y registrar
    // el premio del podio es lo excepcional.
    const lista = screen.getByRole("tablist", { name: "Secciones de mensajeros" });
    const tabs = within(lista).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Cuentas por pagar",
      "Premios del ranking",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");

    // Y lo que se ve al entrar es la TABLA, no el panel de premios.
    await waitFor(() =>
      expect(
        within(panelActivo()).getByRole("table", {
          name: "Cuentas por pagar a mensajeros",
        }),
      ).toBeInTheDocument(),
    );
    expect(
      within(panelActivo()).queryByRole("region", { name: "Premios del ranking" }),
    ).toBeNull();
  });

  it("la pestaña de premios enseña el panel de premios y NO la tabla", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("tab", { name: "Premios del ranking" }));

    const enPremios = await waitFor(() => {
      const activo = panelActivo();
      if (!within(activo).queryByRole("region", { name: "Premios del ranking" })) {
        throw new Error("el panel de premios no está visible");
      }
      return activo;
    });
    // La fila del podio, con su control: el bloque llegó ENTERO a su pestaña, no un cascarón.
    expect(
      within(enPremios).getByRole("button", {
        name: "Registrar el premio de Ana Mensajera",
      }),
    ).toBeInTheDocument();

    // El espejo exacto de la ausencia del caso anterior, que es lo que convierte a las dos en
    // afirmaciones y no en «no había nada montado».
    expect(
      within(enPremios).queryByRole("table", {
        name: "Cuentas por pagar a mensajeros",
      }),
    ).toBeNull();

    // Y se vuelve: ninguno de los dos bloques queda a más de una pulsación.
    await user.click(screen.getByRole("tab", { name: "Cuentas por pagar" }));
    await waitFor(() =>
      expect(
        within(panelActivo()).getByRole("table", {
          name: "Cuentas por pagar a mensajeros",
        }),
      ).toBeInTheDocument(),
    );
  });
});

describe("298 — el refresco cruzado SOBREVIVE a las pestañas (293, design §9)", () => {
  it("registrar un premio deja la cuenta por pagar de la OTRA pestaña al día", async () => {
    const user = userEvent.setup();
    // El desenlace de la escritura y lo que el servidor devuelve DESPUÉS: la cuenta de Ana sube
    // de ₡2.000 a ₡7.000 (el premio) y su fila del podio pasa a «Registrado».
    registrarMock.mockResolvedValue({ status: "ok", monto: "5000.00", cierreId: "c-1" });
    listarPremiosMock
      .mockResolvedValueOnce(podio([PRIMERO]))
      .mockResolvedValue(podio([{ ...PRIMERO, estado: "registrado" }]));

    montar();
    await waitFor(() => expect(paginadoMock).toHaveBeenCalled());
    const lecturasPrevias = paginadoMock.mock.calls.length;

    await user.click(screen.getByRole("tab", { name: "Premios del ranking" }));
    const boton = await screen.findByRole("button", {
      name: "Registrar el premio de Ana Mensajera",
    });

    // A partir de acá el servidor ya devuelve la cuenta CON el premio dentro.
    paginadoMock.mockResolvedValue(pagina([DESPUES]));
    await user.click(boton);
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));

    // (1) El refresco ALCANZA la clave del otro bloque aunque su pestaña no esté a la vista:
    // hay una lectura NUEVA de las cuentas por pagar, provocada por el registro del premio.
    await waitFor(() =>
      expect(paginadoMock.mock.calls.length).toBeGreaterThan(lecturasPrevias),
    );

    // (2) Y lo que se ve al volver es el saldo NUEVO. Esto es lo que el humano notaría: sin el
    // refresco, la tabla seguiría diciendo ₡2.000 después de haber registrado ₡5.000.
    await user.click(screen.getByRole("tab", { name: "Cuentas por pagar" }));
    const tabla = await waitFor(() =>
      within(panelActivo()).getByRole("table", {
        name: "Cuentas por pagar a mensajeros",
      }),
    );
    await waitFor(() =>
      expect(within(tabla).getByText("₡7.000")).toBeInTheDocument(),
    );
    expect(within(tabla).queryByText("₡2.000")).toBeNull();
  });
});
