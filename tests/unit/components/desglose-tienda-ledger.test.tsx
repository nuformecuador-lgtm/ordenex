// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

// ⭑ FICHA 381 (T I.2, R32/R35) — LA TIENDA VE EL COBRO EN SU PROPIA WALLET.
//
// Es la decisión D4 del humano, dicha con sus palabras: «ojo, esos cobros deben también verlos
// las tiendas en su propia wallet». El servidor ya afirma contra Postgres que el cobro sale en
// la lectura que sirve `/mi-wallet` (`wallet-tienda-cobro.test.ts`, caso (f)); lo que falta —y
// es lo que se mide aquí— es que la TABLA lo pinte, con el nombre que el libro le da, y que se
// pueda filtrar por él.
//
// La forma de romperlo sin que nada más se entere es que la fila se caiga del render: un
// `filter` de más, una condición sobre `origenTipo`, un `switch` que no contemple la categoría
// nueva. Por eso el caso principal comprueba que la fila ESTÁ, con sus cinco columnas.

const detalleMock = vi.fn();
const detalleCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: (...a: unknown[]) => detalleMock(...a),
  verDetalleDeMiMovimientoCompletoAction: (...a: unknown[]) => detalleCompletoMock(...a),
}));

import { DesgloseTiendaLedger } from "@/app/(app)/mi-wallet/_components/DesgloseTiendaLedger";
import { MiWalletFiltros } from "@/app/(app)/mi-wallet/_components/MiWalletFiltros";

/** El cobro tal como el servidor lo devuelve en el libro de ESA tienda. */
const COBRO: WalletTiendaMovimientoDTO = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  tiendaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  tipo: "debito",
  categoria: "cobro_manual",
  monto: "15000.00",
  origenTipo: "manual",
  origenId: null,
  descripcion: "Material de despacho entregado en bodega",
  fechaMovimiento: "2026-09-08T14:30:00.000Z",
};

/** Un movimiento automático de siempre, para que el cobro no se mida solo. */
const FLETE: WalletTiendaMovimientoDTO = {
  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  tiendaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  tipo: "debito",
  categoria: "flete",
  monto: "2800.00",
  origenTipo: "cierre_dia",
  origenId: "11111111-1111-4111-8111-111111111111",
  descripcion: null,
  fechaMovimiento: "2026-09-07T10:00:00.000Z",
};

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

/** La fila del libro que contiene ese texto. */
function filaCon(texto: string): HTMLElement {
  const celda = screen.getByText(texto);
  const tr = celda.closest("tr");
  if (tr === null) throw new Error(`«${texto}» no está en ninguna fila`);
  return tr;
}

afterEach(() => {
  cleanup();
});

describe("DesgloseTiendaLedger — el cobro aparece en el libro de la tienda (381/R32)", () => {
  it("pinta la fila con su fecha, su tipo, su nombre, su importe y su origen", () => {
    envolver(<DesgloseTiendaLedger movimientos={[COBRO, FLETE]} />);

    const fila = filaCon("Cobro de Ordenex");
    expect(within(fila).getByText("2026-09-08")).toBeInTheDocument();
    // Un cobro BAJA el disponible de la tienda: es un débito, como un flete.
    expect(within(fila).getByText("Débito")).toBeInTheDocument();
    // El importe, STRING del servidor formateado tal cual.
    expect(within(fila).getByText("₡15.000")).toBeInTheDocument();
    // El origen dice que lo registró una persona, y arrastra el motivo que tecleó.
    expect(
      within(fila).getByText("Manual · Material de despacho entregado en bodega"),
    ).toBeInTheDocument();
  });

  it("y no se come las otras filas del libro: el flete sigue estando", () => {
    // Anti-vacuidad de la anterior: si la tabla pintara UNA sola fila, o ninguna, se vería.
    envolver(<DesgloseTiendaLedger movimientos={[COBRO, FLETE]} />);
    expect(screen.getByText("Cobro de Ordenex")).toBeInTheDocument();
    expect(screen.getByText("Flete")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // cabecera + dos movimientos
  });

  it("el cobro se distingue de un ajuste: son dos nombres distintos en la misma tabla", () => {
    // R33 en pantalla: la decisión D2 del humano —«sí es importante distinguir cuándo es un
    // cobro a una tienda»— tiene que sobrevivir al render, no solo al diccionario.
    envolver(
      <DesgloseTiendaLedger
        movimientos={[COBRO, { ...FLETE, id: "aj", categoria: "ajuste_debito" }]}
      />,
    );
    expect(screen.getByText("Cobro de Ordenex")).toBeInTheDocument();
    expect(screen.getByText("Ajuste (débito)")).toBeInTheDocument();
  });

  it("no se pinta el valor CRUDO del enum: la tienda lee palabras, no `cobro_manual`", () => {
    const { container } = envolver(<DesgloseTiendaLedger movimientos={[COBRO]} />);
    expect(container.textContent ?? "").not.toContain("cobro_manual");
  });

  it("la fila del cobro no ofrece abrirse: no nace de un cierre y no hay órdenes detrás", () => {
    envolver(<DesgloseTiendaLedger movimientos={[COBRO, FLETE]} />);
    // Coherencia con la ficha 344: sólo las filas de cierre despliegan sus órdenes. Y la
    // lectura del detalle no se dispara por pintar la tabla.
    expect(detalleMock).not.toHaveBeenCalled();
    expect(detalleCompletoMock).not.toHaveBeenCalled();
  });
});

describe("MiWalletFiltros — la tienda puede filtrar por el concepto del cobro (381/R35)", () => {
  it("el selector de concepto ofrece «Cobro de Ordenex»", async () => {
    const user = userEvent.setup();
    render(
      <MiWalletFiltros
        onAplicar={vi.fn()}
        onLimpiar={vi.fn()}
        cierres={{ opciones: [], hayMas: false, disponible: true }}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Filtrar por concepto" }));
    const lista = await screen.findByRole("listbox");
    const opciones = within(lista)
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());

    // La opción sale SOLA del SEED del enum: no hay ninguna lista de filtro escrita a mano, y
    // por eso el concepto nuevo es filtrable sin tocar una línea de esta pantalla.
    expect(opciones).toContain("Cobro de Ordenex");
    // Y sigue ofreciendo los de siempre, en la primera posición el «todos».
    expect(opciones[0]).toBe("Todos los conceptos");
    expect(opciones).toContain("COD recaudado");
    expect(opciones).toContain("Ajuste (débito)");
  }, 15000);
});
