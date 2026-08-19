// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RechazosSlaModule } from "@/app/(app)/novedades/_components/RechazosSlaModule";
import { listarRechazosSlaTiendaAction } from "@/lib/actions/rechazos-sla-tienda";
import type { RechazoSlaTiendaDTO } from "@/lib/types/rechazo-sla-tienda";

// Feature 102 (T12) — modulo cliente PRIVADO de la pestaña "Rechazadas por SLA" de `/novedades`.
// Cubre la superficie de la tienda (R12/R14): por cada orden rechazada por SLA muestra la guia
// (placeholder si null), la remision, el destinatario y su MONTO (56); `monto === null` ->
// "pendiente de cierre" (Q2). Estado vacio legible. Re-fetch por Server Action (mock) al paginar.
// Money-safe: el monto llega como STRING y se renderiza tal cual (sin parseFloat/Number).
vi.mock("@/lib/actions/rechazos-sla-tienda", () => ({
  listarRechazosSlaTiendaAction: vi.fn(),
}));

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const listarMock = vi.mocked(listarRechazosSlaTiendaAction);

const rechazo = (over: Partial<RechazoSlaTiendaDTO> = {}): RechazoSlaTiendaDTO => ({
  id: "o1",
  numGuia: 12345,
  numRemision: "REM-001",
  destinatario: "Ana Cliente",
  monto: "3500.00",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RechazosSlaModule", () => {
  it("lista vacia -> estado vacio legible, sin filas", () => {
    render(<RechazosSlaModule items={[]} total={0} page={1} pageSize={10} />);

    expect(
      screen.getByText(/No tenés órdenes rechazadas por plazo vencido/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Órdenes rechazadas por plazo vencido" }),
    ).toBeNull();
  });

  it("R14: por cada orden muestra guia, remision, destinatario y monto (STRING money-safe)", () => {
    render(
      <RechazosSlaModule
        items={[
          rechazo({
            numGuia: 12345,
            numRemision: "REM-777",
            destinatario: "Ana Cliente",
            monto: "3500.00",
          }),
        ]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const lista = screen.getByRole("list", { name: "Órdenes rechazadas por plazo vencido" });
    expect(within(lista).getByText(/12345/)).toBeInTheDocument();
    expect(within(lista).getByText(/REM-777/)).toBeInTheDocument();
    expect(within(lista).getByText("Ana Cliente")).toBeInTheDocument();
    // El monto entra por el formateador compartido: simbolo delante, miles
    // agrupados y sin cola decimal (feature 230). No se reparsea en el camino.
    expect(within(lista).getByText("₡3.500")).toBeInTheDocument();
  });

  it("R14: numGuia null -> placeholder legible, no rompe la fila", () => {
    render(
      <RechazosSlaModule
        items={[rechazo({ numGuia: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText(/sin asignar/i)).toBeInTheDocument();
  });

  it("Q2: monto null -> 'Pendiente de cierre' (la gestion SLA aun no esta snapshoteada)", () => {
    render(
      <RechazosSlaModule
        items={[rechazo({ monto: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Pendiente de cierre")).toBeInTheDocument();
    // No inventa un ₡0 cuando el monto aun no existe.
    expect(screen.queryByText(/₡/)).toBeNull();
  });

  it("R22: renderiza la Pagination con el total y la pagina recibidos", () => {
    render(
      <RechazosSlaModule items={[rechazo()]} total={25} page={2} pageSize={10} />,
    );

    // total 25 / pageSize 10: la pagina 2 cubre los elementos 11 al 20.
    expect(
      screen.getByRole("navigation", { name: "Paginación de rechazos por plazo vencido" }),
    ).toBeInTheDocument();
    expect(screen.getByText("11-20 de 25")).toBeInTheDocument();
  });

  it("al paginar re-fetch por Server Action y actualiza la lista con la nueva pagina", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({
      status: "ok",
      items: [
        rechazo({ id: "o2", numRemision: "REM-PAG2", destinatario: "Beto Pagina2" }),
      ],
      total: 15,
      page: 2,
      pageSize: 10,
    });
    render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", numRemision: "REM-PAG1" })]}
        total={15}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Página siguiente" }),
    );

    await vi.waitFor(() =>
      expect(listarMock).toHaveBeenCalledWith({ page: 2 }),
    );
    expect(await screen.findByText("Beto Pagina2")).toBeInTheDocument();
  });

  it("al paginar con error muestra toast y NO rompe la vista actual", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({ status: "forbidden" });
    render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", destinatario: "Ana Cliente" })]}
        total={15}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Página siguiente" }),
    );

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // La fila original sigue presente (no se limpió por el error).
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
  });
});

// Feature 160 (T20, R18/R19/R26) — la pestaña de rechazadas por plazo vencido también
// es una lista de cards, no un `DataTable`: dato etiquetado, no columna.
describe("RechazosSlaModule — intentos de entrega (feature 160)", () => {
  it("R18: cada rechazo muestra el dato etiquetado junto a sus otros campos", () => {
    render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", numRemision: "REM-777", intentosEntrega: 3 })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("REM-777");
    const dato = within(item).getByText("Intentos: 3");
    expect(dato.closest("p")).not.toBeNull();
  });

  it("R19: con 0 intentos el dato SE MUESTRA igual", () => {
    render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", intentosEntrega: 0 })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: sin el campo (DTO viejo) muestra 0", () => {
    render(
      <RechazosSlaModule items={[rechazo({ id: "o1" })]} total={1} page={1} pageSize={10} />,
    );
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R26/R32: cada rechazo lleva SU número y el monto sigue intacto", () => {
    render(
      <RechazosSlaModule
        items={[
          rechazo({ id: "o1", monto: "3500.00", intentosEntrega: 2 }),
          rechazo({ id: "o2", monto: null, intentosEntrega: 0 }),
        ]}
        total={2}
        page={1}
        pageSize={10}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 2")).toBeInTheDocument();
    expect(within(items[0]).getByText("₡3.500")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
    expect(within(items[1]).getByText("Pendiente de cierre")).toBeInTheDocument();
  });
});
