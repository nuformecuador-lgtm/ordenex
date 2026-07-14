// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PorAceptarSection,
  type PorAceptarOrdenBase,
} from "@/app/(app)/_components/PorAceptarSection";

// Feature 63 — sección REUTILIZABLE "por aceptar" (extraída de "Por recoger" del
// mensajero): banner con contador de nuevas + acción en lote + acción por-orden +
// render de detalle opcional. Componente puro; se afirma la composición y los
// callbacks sin Server Actions ni router.

interface Orden extends PorAceptarOrdenBase {
  extra?: string;
}

function make(id: string, numRemision = `REM-${id}`): Orden {
  return { id, numRemision, destinatario: `Dest ${id}`, extra: `X-${id}` };
}

function renderSection(props?: Partial<Parameters<typeof PorAceptarSection<Orden>>[0]>) {
  const onAceptarTodas = props?.onAceptarTodas ?? vi.fn();
  const onAceptarUna = props?.onAceptarUna ?? vi.fn();
  render(
    <PorAceptarSection<Orden>
      titulo={props?.titulo ?? "Por recibir"}
      nuevasLabel={props?.nuevasLabel ?? ((n) => `${n} nuevas`)}
      ordenes={props?.ordenes ?? []}
      onAceptarTodas={onAceptarTodas}
      onAceptarUna={onAceptarUna}
      textoBotonTodas={props?.textoBotonTodas ?? "Aceptar todas"}
      textoBotonUna={props?.textoBotonUna ?? "Aceptar"}
      vacio={props?.vacio ?? "No hay órdenes."}
      renderDetalle={props?.renderDetalle}
      mostrarAcciones={props?.mostrarAcciones}
    />,
  );
  return { onAceptarTodas, onAceptarUna };
}

afterEach(() => cleanup());

describe("PorAceptarSection", () => {
  it("es una región accesible con el título dado", () => {
    renderSection({ titulo: "Por recoger" });
    expect(screen.getByRole("region", { name: "Por recoger" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Por recoger" })).toBeInTheDocument();
  });

  it("muestra el vacío y deshabilita 'aceptar todas' cuando no hay órdenes", () => {
    renderSection({ ordenes: [], vacio: "Nada por recibir." });
    expect(screen.getByText("Nada por recibir.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceptar todas" })).toBeDisabled();
    // Sin órdenes no hay banner.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("muestra el banner con el contador de nuevas cuando hay órdenes", () => {
    renderSection({
      ordenes: [make("1"), make("2"), make("3")],
      nuevasLabel: (n) => `${n} Órdenes nuevas por recibir`,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "3 Órdenes nuevas por recibir",
    );
  });

  it("'aceptar todas' invoca onAceptarTodas con TODOS los ids", async () => {
    const user = userEvent.setup();
    const { onAceptarTodas } = renderSection({
      ordenes: [make("a"), make("b")],
    });
    await user.click(screen.getByRole("button", { name: "Aceptar todas" }));
    expect(onAceptarTodas).toHaveBeenCalledWith(["a", "b"]);
  });

  it("'aceptar' por-orden invoca onAceptarUna con ese id", async () => {
    const user = userEvent.setup();
    const { onAceptarUna } = renderSection({
      ordenes: [make("a"), make("b")],
    });
    await user.click(screen.getAllByRole("button", { name: "Aceptar" })[1]);
    expect(onAceptarUna).toHaveBeenCalledWith("b");
  });

  it("renderiza el detalle de cada orden con renderDetalle", () => {
    renderSection({
      ordenes: [make("a")],
      renderDetalle: (orden) => <span>detalle-{orden.extra}</span>,
    });
    expect(screen.getByText("detalle-X-a")).toBeInTheDocument();
  });

  it("con mostrarAcciones=false lista sin botones (p. ej. sin zona)", () => {
    renderSection({ ordenes: [make("a")], mostrarAcciones: false });
    const region = screen.getByRole("region", { name: "Por recibir" });
    expect(within(region).queryByRole("button")).toBeNull();
    // Sigue mostrando la orden.
    expect(within(region).getByText(/REM-a/)).toBeInTheDocument();
  });
});
