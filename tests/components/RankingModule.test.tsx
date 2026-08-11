// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RankingModule } from "@/app/(app)/ranking/_components/RankingModule";
import { editarPremioAction } from "@/lib/actions/ranking";
import type { PremioRankingDTO, RankingRowDTO } from "@/lib/types/ranking";

// Feature 76 (T9) — módulo cliente del ranking. Se mockean la Server Action de edición,
// el toast y el router (refresh) para afirmar la composición (tabla + inputs) sin DB ni
// sesión. Trazabilidad: R9, R13, R14, R15, R16, R17, R25.
vi.mock("@/lib/actions/ranking", () => ({
  editarPremioAction: vi.fn(),
  obtenerRankingAction: vi.fn(),
}));

const { successMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const editarMock = vi.mocked(editarPremioAction);

// Podio con SOLO 2 ocupantes elegibles (posición 3 vacía → R15) + una fila fuera de podio.
const RANKING: RankingRowDTO[] = [
  {
    posicion: 1,
    mensajeroId: "m1",
    nombre: "Ana",
    entregadasHoy: 5,
    asignadasHoy: 5,
    pct: "100.0",
    premio: "5000",
  },
  {
    posicion: 2,
    mensajeroId: "m2",
    nombre: "Beto",
    entregadasHoy: 4,
    asignadasHoy: 5,
    pct: "80.0",
    premio: null,
  },
  {
    posicion: null,
    mensajeroId: "m3",
    nombre: "Caro",
    entregadasHoy: 0,
    asignadasHoy: 0,
    pct: null,
    premio: null,
  },
];

const PREMIOS: PremioRankingDTO[] = [
  { posicion: 1, monto: "5000", descripcion: "Bono oro" },
  { posicion: 2, monto: null, descripcion: null },
  { posicion: 3, monto: "1000", descripcion: "Consuelo" },
];

function tablaPremios() {
  return screen.getByRole("table", { name: "Premios del podio" });
}

beforeEach(() => {
  vi.clearAllMocks();
  editarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  cleanup();
});

// La presentación del ranking (R13/R6/R3) se mudó a `RankingPodio`: su cobertura vive
// ahora en tests/components/RankingPodio.test.tsx. Aquí queda solo la tabla de premios.

describe("RankingModule — premios ↔ ocupante del podio (R14/R15)", () => {
  it("R14: asocia el premio (monto + descripción) al mensajero elegible de esa posición", () => {
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={false} />);
    const filaPos1 = within(tablaPremios())
      .getByRole("rowheader", { name: "1" })
      .closest("tr") as HTMLElement;
    expect(within(filaPos1).getByText("Ana")).toBeInTheDocument();
    expect(within(filaPos1).getByText("₡5.000")).toBeInTheDocument();
    expect(within(filaPos1).getByText("Bono oro")).toBeInTheDocument();
  });

  it("R15: una posición sin ocupante elegible NO inventa mensajero", () => {
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={false} />);
    const filaPos3 = within(tablaPremios())
      .getByRole("rowheader", { name: "3" })
      .closest("tr") as HTMLElement;
    expect(
      within(filaPos3).getByText("Sin ocupante elegible hoy"),
    ).toBeInTheDocument();
    // El premio se muestra igualmente, pero sin ocupante inventado.
    expect(within(filaPos3).getByText("₡1.000")).toBeInTheDocument();
    expect(within(filaPos3).queryByText("Ana")).not.toBeInTheDocument();
    expect(within(filaPos3).queryByText("Beto")).not.toBeInTheDocument();
    expect(within(filaPos3).queryByText("Caro")).not.toBeInTheDocument();
  });
});

describe("RankingModule — solo-lectura del mensajero (R9/R17/R25)", () => {
  it("R17: sin `esEditable` no hay inputs de edición ni botón guardar", () => {
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={false} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar" }),
    ).not.toBeInTheDocument();
  });

  it("R9: monto vacío se muestra como 'Sin premio asignado', nunca como cero", () => {
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={false} />);
    const filaPos2 = within(tablaPremios())
      .getByRole("rowheader", { name: "2" })
      .closest("tr") as HTMLElement;
    expect(within(filaPos2).getByText("Sin premio asignado")).toBeInTheDocument();
    expect(within(filaPos2).queryByText("₡0")).not.toBeInTheDocument();
  });

  it("R25: descripción vacía se muestra como 'Sin descripción'; con texto se muestra tal cual", () => {
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={false} />);
    const filaPos2 = within(tablaPremios())
      .getByRole("rowheader", { name: "2" })
      .closest("tr") as HTMLElement;
    expect(within(filaPos2).getByText("Sin descripción")).toBeInTheDocument();
    const filaPos1 = within(tablaPremios())
      .getByRole("rowheader", { name: "1" })
      .closest("tr") as HTMLElement;
    expect(within(filaPos1).getByText("Bono oro")).toBeInTheDocument();
  });
});

describe("RankingModule — edición del maestro (R16/R10/R25)", () => {
  it("R16: con `esEditable` muestra inputs de monto y descripción por posición y botón guardar", () => {
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={true} />);
    expect(
      screen.getByRole("textbox", { name: "Monto del premio — posición 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Descripción — posición 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Guardar" }),
    ).toHaveLength(3);
  });

  it("R10/R25: guardar envía monto + descripción a editarPremioAction y refresca", async () => {
    const user = userEvent.setup();
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={true} />);

    const filaPos2 = within(tablaPremios())
      .getByRole("rowheader", { name: "2" })
      .closest("tr") as HTMLElement;
    const monto = within(filaPos2).getByRole("textbox", {
      name: "Monto del premio — posición 2",
    });
    const desc = within(filaPos2).getByRole("textbox", {
      name: "Descripción — posición 2",
    });

    await user.type(monto, "2500");
    await user.type(desc, "Plata");
    await user.click(within(filaPos2).getByRole("button", { name: "Guardar" }));

    expect(editarMock).toHaveBeenCalledWith({
      posicion: 2,
      monto: "2500",
      descripcion: "Plata",
    });
    expect(successMock).toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("R9/R25: vaciar monto y descripción envía null en ambos", async () => {
    const user = userEvent.setup();
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={true} />);

    const filaPos1 = within(tablaPremios())
      .getByRole("rowheader", { name: "1" })
      .closest("tr") as HTMLElement;
    await user.clear(
      within(filaPos1).getByRole("textbox", {
        name: "Monto del premio — posición 1",
      }),
    );
    await user.clear(
      within(filaPos1).getByRole("textbox", { name: "Descripción — posición 1" }),
    );
    await user.click(within(filaPos1).getByRole("button", { name: "Guardar" }));

    expect(editarMock).toHaveBeenCalledWith({
      posicion: 1,
      monto: null,
      descripcion: null,
    });
  });

  it("R11: si la action responde `invalid`, muestra el mensaje de error y no refresca", async () => {
    editarMock.mockResolvedValue({ status: "invalid", message: "Monto inválido" });
    const user = userEvent.setup();
    render(<RankingModule ranking={RANKING} premios={PREMIOS} esEditable={true} />);

    const filaPos1 = within(tablaPremios())
      .getByRole("rowheader", { name: "1" })
      .closest("tr") as HTMLElement;
    await user.click(within(filaPos1).getByRole("button", { name: "Guardar" }));

    expect(errorMock).toHaveBeenCalledWith("Monto inválido");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
