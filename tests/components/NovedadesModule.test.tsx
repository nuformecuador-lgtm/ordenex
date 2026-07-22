// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NovedadesModule } from "@/app/(app)/novedades/_components/NovedadesModule";
import { reprogramarNovedad } from "@/lib/actions/resolver-novedad";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 87 (T14) — modulo cliente de `/novedades`. Cubre R9 (fila con guia/destinatario/
// causa/contacto + placeholder si numGuia null), R10 (estado vacio), R11 (label ES, no slug)
// y R22 (Pagination con total/page). Se mockea la Server Action (re-fetch) y el toast.
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
}));

// Feature 100 (T3.1/T3.2) — la acción "Reprogramar" ejecuta la reprogramación vía
// esta Server Action; se mockea para verificar la invocación con la fecha elegida.
vi.mock("@/lib/actions/resolver-novedad", () => ({
  reprogramarNovedad: vi.fn(),
}));

const reprogramarMock = vi.mocked(reprogramarNovedad);

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
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

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({
  id: "o1",
  numGuia: 12345,
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("NovedadesModule", () => {
  it("R10: lista vacia -> estado vacio, sin filas", () => {
    render(<NovedadesModule items={[]} total={0} page={1} pageSize={10} />);

    expect(screen.getByText(/No tenés órdenes en devolución/i)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Órdenes en devolución" })).toBeNull();
  });

  it("R9: por cada orden muestra guia, destinatario y botones de contacto", () => {
    render(
      <NovedadesModule
        items={[novedad({ id: "o1", numGuia: 12345, destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText(/12345/)).toBeInTheDocument();
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Llamar a Ana Cliente" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "WhatsApp a Ana Cliente" }),
    ).toBeInTheDocument();
  });

  it("R9: numGuia null -> placeholder legible, no rompe la fila", () => {
    render(
      <NovedadesModule
        items={[novedad({ numGuia: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText(/sin asignar/i)).toBeInTheDocument();
  });

  it("R11: muestra la etiqueta ES de la causa, nunca el slug crudo del enum", () => {
    render(
      <NovedadesModule
        items={[novedad({ causa: "not_found" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Cliente no localizado")).toBeInTheDocument();
    expect(screen.queryByText("not_found")).toBeNull();
  });

  it("R7: causa null -> 'Sin causa registrada'", () => {
    render(
      <NovedadesModule
        items={[novedad({ causa: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Sin causa registrada")).toBeInTheDocument();
  });

  it("R22: renderiza la Pagination con el total y la pagina recibidos", () => {
    render(
      <NovedadesModule
        items={[novedad()]}
        total={25}
        page={2}
        pageSize={10}
      />,
    );

    // total 25 / pageSize 10 = 3 paginas; page 2 de 3.
    expect(
      screen.getByRole("navigation", { name: "Paginación de novedades" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
  });

  // ---------- Feature 100 (T3.1/T3.2) — Reprogramar ----------

  it("R1: cada orden ofrece la acción 'Reprogramar' junto a los botones de contacto", () => {
    render(
      <NovedadesModule
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    ).toBeInTheDocument();
  });

  it("T3.1: al confirmar llama reprogramarNovedad con el ordenId y la fecha (mañana por default); en ok quita la fila", async () => {
    const user = userEvent.setup();
    reprogramarMock.mockResolvedValue({ status: "ok" });
    render(
      <NovedadesModule
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );

    // El modal abre con el input de fecha (default = mañana CR).
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Nueva fecha")).toHaveValue(
      mananaCalendarioCR(),
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Reprogramar" }),
    );

    expect(reprogramarMock).toHaveBeenCalledTimes(1);
    expect(reprogramarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ordenId: "o1",
        fechaReprogramacion: mananaCalendarioCR(),
      }),
    );

    // En ok: la fila sale de la lista (queda el estado vacío) + toast de éxito.
    await waitFor(() =>
      expect(
        screen.getByText(/No tenés órdenes en devolución/i),
      ).toBeInTheDocument(),
    );
    expect(successMock).toHaveBeenCalledWith("Orden reprogramada.");
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("T3.1: el motivo escrito (opcional) viaja en el payload", async () => {
    const user = userEvent.setup();
    reprogramarMock.mockResolvedValue({ status: "ok" });
    render(
      <NovedadesModule
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo/i), "Cliente pidió otro día");
    await user.click(within(dialog).getByRole("button", { name: "Reprogramar" }));

    expect(reprogramarMock).toHaveBeenCalledWith(
      expect.objectContaining({ ordenId: "o1", motivo: "Cliente pidió otro día" }),
    );
  });

  it("T3.2: status conflict -> toast de error con su mensaje y la fila NO se quita", async () => {
    const user = userEvent.setup();
    reprogramarMock.mockResolvedValue({ status: "conflict", motivo: "estado" });
    render(
      <NovedadesModule
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reprogramar" }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "La orden ya salió de devolución. Actualizá la lista.",
      ),
    );
    // La fila sigue presente (no hubo éxito).
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
    expect(successMock).not.toHaveBeenCalled();
  });

  it("T3.2: status forbidden -> toast de error con su propio mensaje (no genérico)", async () => {
    const user = userEvent.setup();
    reprogramarMock.mockResolvedValue({ status: "forbidden" });
    render(
      <NovedadesModule
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reprogramar" }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "No tenés permiso para reprogramar esta orden.",
      ),
    );
  });
});
