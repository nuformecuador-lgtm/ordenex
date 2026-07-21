// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DesglosePagosMensajeroProps } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

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

import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";

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

afterEach(() => {
  cleanup();
});

describe("CuentasPorPagarTable — columnas y datos (R18/R21)", () => {
  it("renderiza las columnas del resumen por mensajero", () => {
    render(<CuentasPorPagarTable mensajeros={MENSAJEROS} />);

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
    render(<CuentasPorPagarTable mensajeros={MENSAJEROS} />);

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
    render(<CuentasPorPagarTable mensajeros={[]} />);
    expect(screen.getByText("No hay cuentas por pagar")).toBeInTheDocument();
  });
});

describe("CuentasPorPagarTable — filtro por nombre (client-side)", () => {
  it("filtra la lista por nombre de mensajero sin tocar montos", async () => {
    const user = userEvent.setup();
    render(<CuentasPorPagarTable mensajeros={MENSAJEROS} />);

    await user.type(
      screen.getByPlaceholderText("Buscar por nombre"),
      "Ana",
    );

    expect(within(tabla()).getByText("Ana Mensajera")).toBeInTheDocument();
    expect(within(tabla()).queryByText("Beto Repartidor")).not.toBeInTheDocument();
  });
});

describe("CuentasPorPagarTable — expand del desglose por fila (R18)", () => {
  it("expande la fila del mensajero y monta su desglose por cierre", async () => {
    const user = userEvent.setup();
    render(<CuentasPorPagarTable mensajeros={MENSAJEROS} />);

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
