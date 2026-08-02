// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import type { DesglosePagosMensajeroProps } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// Feature 44 (T14) — tabla-resumen de cuentas por pagar, ahora sobre `DataTable` (columnas +
// `renderExpanded`). Se stubbea el DESGLOSE por cierre (SWR + Server Action) para aislar el
// comportamiento de la TABLA: columnas, datos money-safe, filtro por nombre y expand por fila.
// El stub captura el `resumen` para afirmar que expande la fila correcta.
vi.mock(
  "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero",
  () => ({
    DesglosePagosMensajero: ({ resumen }: DesglosePagosMensajeroProps) => (
      <div data-testid={`desglose-stub-${resumen.mensajeroId}`}>
        Desglose de {resumen.mensajeroNombre}
      </div>
    ),
  }),
);

// Feature 170 — FASE 2 (T L.2): la tabla pinta la PÁGINA que le da el servidor y la búsqueda
// por nombre la resuelve él. El doble de la Server Action FILTRA de verdad (con el mismo
// criterio que `lib/utils/cuentas-por-pagar-listado.ts` describe: subcadena, sin distinguir
// mayúsculas), para que un cableado que ignorase la búsqueda no pasara por aquí.
const { paginadoMock, conjuntoMock } = vi.hoisted(() => ({
  paginadoMock: vi.fn(),
  conjuntoMock: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarAction: (...a: unknown[]) => conjuntoMock(...a),
  listarCuentasPorPagarPaginadoAction: (...a: unknown[]) => paginadoMock(...a),
  listarPagosDeMensajeroAction: vi.fn(),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
}));

import { ToastProvider } from "@/providers/ToastProvider";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";

/**
 * Feature 170 (T D.2): la tabla monta el control de descarga del `DataTable`, que usa
 * `useToast`. En la app el proveedor está en `app/(app)/layout.tsx`, encima de esta pantalla;
 * aquí se envuelve por la misma razón que ya hace `OrdenesDescarga.test.tsx` (151). Cambio
 * del ARNÉS: ninguna aserción se toca.
 */
function renderTabla(mensajeros: CuentaPorPagarResumenDTO[]) {
  paginadoMock.mockImplementation(
    async (input: { busqueda?: string } | undefined = {}) => {
      const q = (input.busqueda ?? "").trim().toLowerCase();
      const filtrados =
        q === ""
          ? mensajeros
          : mensajeros.filter((m) => m.mensajeroNombre.toLowerCase().includes(q));
      return { status: "ok", page: 1, pageSize: 25, items: filtrados, total: filtrados.length };
    },
  );
  conjuntoMock.mockResolvedValue({ status: "ok", mensajeros });
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <CuentasPorPagarTable initialData={paginaInicial(mensajeros)} />
      </ToastProvider>
    </SWRConfig>,
  );
}

const MENSAJEROS: CuentaPorPagarResumenDTO[] = [
  {
    mensajeroId: "u1",
    mensajeroNombre: "Ana Mensajera",
    devengado: "5000.00",
    pagado: "3000.00",
    cuentaPorPagar: "2000.00",
    signo: "positivo",
  },
  {
    mensajeroId: "u2",
    mensajeroNombre: "Beto Repartidor",
    devengado: "4000.00",
    pagado: "4000.00",
    cuentaPorPagar: "0.00",
    signo: "cero",
  },
];

function tabla() {
  return screen.getByRole("table", { name: "Cuentas por pagar a mensajeros" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("CuentasPorPagarTable — columnas y datos (R18/R21)", () => {
  it("renderiza las columnas del resumen por mensajero", () => {
    renderTabla(MENSAJEROS);

    for (const header of [
      "Mensajero",
      "Devengado",
      "Pagado",
      "Cuenta por pagar",
      "Estado",
    ]) {
      expect(
        within(tabla()).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
  });

  it("money-safe: pinta los montos TAL CUAL (STRING con símbolo) y el badge por signo", () => {
    renderTabla(MENSAJEROS);

    const filaAna = within(tabla())
      .getByText("Ana Mensajera")
      .closest("tr") as HTMLElement;
    expect(within(filaAna).getByText("₡5000.00")).toBeInTheDocument();
    expect(within(filaAna).getByText("₡3000.00")).toBeInTheDocument();
    expect(within(filaAna).getByText("₡2000.00")).toBeInTheDocument();
    // Positivo (Ordenex debe) → badge "Pendiente".
    expect(within(filaAna).getByText("Pendiente")).toBeInTheDocument();

    const filaBeto = within(tabla())
      .getByText("Beto Repartidor")
      .closest("tr") as HTMLElement;
    expect(within(filaBeto).getByText("₡0.00")).toBeInTheDocument();
    // Cero (al día) → badge "Al día".
    expect(within(filaBeto).getByText("Al día")).toBeInTheDocument();
  });

  it("estado vacío estructurado cuando no hay mensajeros", () => {
    renderTabla([]);
    expect(screen.getByText("No hay cuentas por pagar")).toBeInTheDocument();
  });
});

describe("CuentasPorPagarTable — búsqueda por nombre (servidor, T L.2)", () => {
  it("filtra la lista por nombre de mensajero sin tocar montos", async () => {
    const user = userEvent.setup();
    renderTabla(MENSAJEROS);

    await user.type(
      screen.getByPlaceholderText("Buscar por nombre"),
      "Ana",
    );

    // Feature 170 — FASE 2 (T L.2, R45): el texto se resuelve en el SERVIDOR, así que la
    // tabla ya no cambia en la misma tecla; lo que se afirma —qué queda a la vista— es
    // exactamente lo de antes.
    await waitFor(() =>
      expect(within(tabla()).queryByText("Beto Repartidor")).not.toBeInTheDocument(),
    );
    expect(within(tabla()).getByText("Ana Mensajera")).toBeInTheDocument();
  });

  it("el texto viaja TAL CUAL al servidor y una ráfaga de teclas es UNA sola lectura", async () => {
    // Dos cosas en un caso, porque son la misma decisión:
    //  (a) la búsqueda se manda sin recortar ni pasar a minúsculas (quien normaliza es
    //      `lib/utils/cuentas-por-pagar-listado.ts`, en un solo sitio: T L.1 §9.1);
    //  (b) escribir tres letras NO son tres lecturas. Cada lectura de este listado agrega el
    //      libro entero de cada mensajero, así que la espera del filtro no es cosmética.
    const user = userEvent.setup();
    renderTabla(MENSAJEROS);

    await user.type(screen.getByPlaceholderText("Buscar por nombre"), "Ana");
    await waitFor(() =>
      expect(within(tabla()).queryByText("Beto Repartidor")).not.toBeInTheDocument(),
    );

    const conBusqueda = paginadoMock.mock.calls
      .map(([input]) => input as { busqueda?: string })
      .filter((input) => (input?.busqueda ?? "") !== "");
    expect(conBusqueda).toHaveLength(1);
    expect(conBusqueda[0].busqueda).toBe("Ana");
  });
});

describe("CuentasPorPagarTable — expand del desglose por fila (R18)", () => {
  it("expande la fila del mensajero y monta su desglose por cierre", async () => {
    const user = userEvent.setup();
    renderTabla(MENSAJEROS);

    // Sin expandir: ningún desglose montado.
    expect(screen.queryByTestId("desglose-stub-u1")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Ver desglose de Ana Mensajera" }),
    );

    // Se monta el desglose de ESA fila (no el de otra).
    expect(screen.getByTestId("desglose-stub-u1")).toBeInTheDocument();
    expect(screen.queryByTestId("desglose-stub-u2")).not.toBeInTheDocument();
  });
});
