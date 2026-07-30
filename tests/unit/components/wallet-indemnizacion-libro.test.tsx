// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/providers/ToastProvider";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import {
  CATEGORIA_LABEL,
  CATEGORIA_OPTIONS,
  esEgresoAdministrativo,
} from "@/app/(app)/wallet/_components/wallet-labels";

// Feature 158 (T2.5 — R31/R32/R30) — la indemnización en la superficie visible de la wallet:
// el LIBRO (etiqueta legible del concepto), el FILTRO por categoría y la NO-reversabilidad.
// La action de reversa se mockea: acá no se toca backend.

vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";
import { WalletFiltros } from "@/app/(app)/wallet/_components/WalletFiltros";

const EGRESO_INDEMNIZACION: WalletMovimientoDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  tipo: "egreso",
  categoria: "egreso_indemnizacion",
  monto: "12500.00",
  origenTipo: "cierre_dia",
  origenId: "cierre-1",
  descripcion: null,
  registradoPor: "maestro-1",
  fechaMovimiento: "2026-07-30T10:00:00.000Z",
};

const EGRESO_GASTO: WalletMovimientoDTO = {
  id: "22222222-2222-2222-2222-222222222222",
  tipo: "egreso",
  categoria: "egreso_gasto_variable",
  monto: "125.50",
  origenTipo: "gasto",
  origenId: null,
  descripcion: "Suministros",
  registradoPor: "maestro-1",
  fechaMovimiento: "2026-07-30T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
});

describe("R31 — el concepto tiene etiqueta legible en el libro", () => {
  it("la fila del movimiento muestra la etiqueta en español, no el slug del enum", () => {
    render(
      <ToastProvider>
        <WalletLedger movimientos={[EGRESO_INDEMNIZACION]} />
      </ToastProvider>,
    );

    const tabla = screen.getByRole("table", { name: "Libro de movimientos" });
    expect(within(tabla).getByText("Indemnización por incidente")).toBeInTheDocument();
    expect(tabla.textContent).not.toMatch(/egreso_indemnizacion/);
  });

  it("el monto se renderiza TAL CUAL (STRING), sin parseFloat ni reformateo", () => {
    render(
      <ToastProvider>
        <WalletLedger
          movimientos={[{ ...EGRESO_INDEMNIZACION, monto: "12345678901.99" }]}
        />
      </ToastProvider>,
    );

    const tabla = screen.getByRole("table", { name: "Libro de movimientos" });
    expect(within(tabla).getByText("₡12345678901.99")).toBeInTheDocument();
  });

  it("el origen se lee como 'Cierre del día' (de dónde salió la plata)", () => {
    render(
      <ToastProvider>
        <WalletLedger movimientos={[EGRESO_INDEMNIZACION]} />
      </ToastProvider>,
    );

    const tabla = screen.getByRole("table", { name: "Libro de movimientos" });
    expect(within(tabla).getByText("Cierre del día")).toBeInTheDocument();
  });
});

describe("R31 — el concepto es una opción del filtro por categoría", () => {
  it("al abrir el filtro de categoría, la indemnización está entre las opciones", async () => {
    const user = userEvent.setup();
    render(<WalletFiltros onAplicar={() => {}} onLimpiar={() => {}} />);

    await user.click(screen.getByRole("combobox", { name: "Filtrar por categoría" }));

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Indemnización por incidente" }),
    ).toBeInTheDocument();
  });

  it("las opciones salen del SEED, así que ninguna categoría queda sin ofrecer", async () => {
    const user = userEvent.setup();
    render(<WalletFiltros onAplicar={() => {}} onLimpiar={() => {}} />);

    await user.click(screen.getByRole("combobox", { name: "Filtrar por categoría" }));
    const lista = await screen.findByRole("listbox");

    // Una opción por entrada del SEED + la de "Todas las categorías".
    expect(within(lista).getAllByRole("option")).toHaveLength(CATEGORIA_OPTIONS.length);
    for (const { value, label } of CATEGORIA_OPTIONS) {
      expect(
        within(lista).getByRole("option", { name: label }),
        `sin opción para "${value}"`,
      ).toBeInTheDocument();
      // Nunca el slug crudo como texto visible.
      expect(label).not.toBe(value);
    }
    expect(CATEGORIA_LABEL.egreso_indemnizacion).toBe("Indemnización por incidente");
  });

  it("elegir la indemnización y aplicar emite ese filtro tal cual", async () => {
    const user = userEvent.setup();
    const onAplicar = vi.fn();
    render(<WalletFiltros onAplicar={onAplicar} onLimpiar={() => {}} />);

    await user.click(screen.getByRole("combobox", { name: "Filtrar por categoría" }));
    await user.click(
      await screen.findByRole("option", { name: "Indemnización por incidente" }),
    );
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(onAplicar).toHaveBeenCalledWith(
      expect.objectContaining({ categoria: "egreso_indemnizacion" }),
    );
  });
});

describe("R30 — la indemnización NO ofrece reversa en el libro", () => {
  it("su fila no trae el botón 'Reversar', y la de un gasto administrativo sí", () => {
    render(
      <ToastProvider>
        <WalletLedger movimientos={[EGRESO_INDEMNIZACION, EGRESO_GASTO]} />
      </ToastProvider>,
    );

    // Un solo botón de reversa en toda la tabla: el del gasto administrativo.
    const tabla = screen.getByRole("table", { name: "Libro de movimientos" });
    expect(within(tabla).getAllByRole("button", { name: "Reversar" })).toHaveLength(1);
    // Y el criterio que lo decide es el `origen_tipo`, no la categoría.
    expect(esEgresoAdministrativo(EGRESO_INDEMNIZACION)).toBe(false);
    expect(esEgresoAdministrativo(EGRESO_GASTO)).toBe(true);
  });
});
