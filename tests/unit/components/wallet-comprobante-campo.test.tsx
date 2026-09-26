// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { SWRConfig } from "swr";

// =================================================================================================
// FICHA 458-C (T C.3, design §4.1) — EL COMPROBANTE EN PANTALLA (R74–R76, R79, R80)
// =================================================================================================
//
//  - R74/R75: el campo avisa ANTES de enviar el tipo y el tamaño con `problemaDeComprobante` (la misma
//    pieza que el borde) y el archivo que no pasa NO queda elegido;
//  - R79: «Adjuntar comprobante» solo donde la fila lo admite, sin comprobante y sin anular (m6 de la
//    458-B); manda `FormData { destino (JSON), comprobante }`; `ya_tiene` y `no_admite` (con sus tres
//    motivos, incluido `anulado`) se dicen en palabras;
//  - R80 / TC.3 heredado: «Ver comprobante» va SIEMPRE al servidor (`verComprobanteAction({ destino })`,
//    también para la corrección, el egreso y el cobro, que antes respondían «sin comprobante» sin
//    preguntar) y se nombra por un rótulo legible, nunca por su ruta.

const comoQuedoMock = vi.fn();
const verMock = vi.fn();
const adjuntarMock = vi.fn();
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: (...a: unknown[]) => comoQuedoMock(...a) }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({
  verComprobanteAction: (...a: unknown[]) => verMock(...a),
  adjuntarComprobanteAction: (...a: unknown[]) => adjuntarMock(...a),
}));
const successMock = vi.fn();
const errorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: successMock, error: errorMock, info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

import { ComprobanteCampo } from "@/components/shared/wallet/ComprobanteCampo";
import { DetalleMovimientoPanel, type DetalleMovimiento } from "@/components/shared/wallet/DetalleMovimientoPanel";

const ID = "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d";

function Campo() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <>
      <ComprobanteCampo id="c" archivo={archivo} onCambiar={setArchivo} error={error} onError={setError} />
      <p data-testid="elegido">{archivo?.name ?? "ninguno"}</p>
    </>
  );
}

function elegir(archivo: File) {
  fireEvent.change(screen.getByLabelText(/^Comprobante \(opcional\)/), { target: { files: [archivo] } });
}

function movimiento(over: Partial<DetalleMovimiento> = {}): DetalleMovimiento {
  return {
    destino: { libro: "caja", movimientoId: ID },
    concepto: "Corrección de caja (resta)",
    fecha: "2026-09-12",
    monto: "500.00",
    direccion: "sale",
    motivo: "Faltante",
    estado: { anulado: false },
    anulable: true,
    nombreParaAnular: "la corrección de caja",
    tieneComprobante: false,
    admiteAdjuntar: true,
    ...over,
  };
}

function Envoltura({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

function pintarPanel(m: DetalleMovimiento, onCambio = vi.fn()) {
  render(
    <Envoltura>
      <DetalleMovimientoPanel abierto onAbiertoChange={vi.fn()} movimiento={m} autoria={null} onCambio={onCambio} />
    </Envoltura>,
  );
  return { onCambio, user: userEvent.setup() };
}

const PNG = () => new File(["\x89PNG"], "recibo.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  comoQuedoMock.mockResolvedValue({ status: "ok", comoQuedo: { caja: null, cuenta: null } });
});
afterEach(() => cleanup());

describe("458-C R74/R75 — el campo avisa antes de enviar", () => {
  it("un PDF o una imagen admitida queda elegida, sin aviso", () => {
    render(<Campo />);
    elegir(new File(["%PDF"], "f.pdf", { type: "application/pdf" }));
    expect(screen.getByTestId("elegido").textContent).toBe("f.pdf");
    expect(screen.queryByText(/El comprobante debe ser/)).toBeNull();
  });

  it("R75: un tipo no admitido se explica bajo el campo y NO queda elegido", () => {
    render(<Campo />);
    elegir(new File(["hola"], "nota.txt", { type: "text/plain" }));
    expect(screen.getByText("El comprobante debe ser una imagen JPEG, PNG o WebP, o un PDF.")).toBeTruthy();
    expect(screen.getByTestId("elegido").textContent).toBe("ninguno");
    expect(screen.getByLabelText(/^Comprobante \(opcional\)/).getAttribute("aria-invalid")).toBe("true");
  });

  it("R75: uno de más de 4 MB se explica y NO queda elegido", () => {
    render(<Campo />);
    const grande = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.pdf", { type: "application/pdf" });
    elegir(grande);
    expect(screen.getByText("El comprobante no puede pesar mas de 4 MB.")).toBeTruthy();
    expect(screen.getByTestId("elegido").textContent).toBe("ninguno");
  });

  it("se puede quitar el elegido", async () => {
    const user = userEvent.setup();
    render(<Campo />);
    elegir(PNG());
    await user.click(screen.getByRole("button", { name: "Quitar el comprobante" }));
    expect(screen.getByTestId("elegido").textContent).toBe("ninguno");
  });
});

describe("458-C R79 — adjuntar después, una sola vez, donde se admite", () => {
  it("sin comprobante y admitido: «Adjuntar» manda FormData { destino JSON, comprobante } y relee", async () => {
    adjuntarMock.mockResolvedValue({ status: "ok" });
    const { user, onCambio } = pintarPanel(movimiento());
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Sin comprobante.")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Adjuntar comprobante" }));
    fireEvent.change(within(panel).getByLabelText(/^Comprobante \(opcional\)/), { target: { files: [PNG()] } });
    await user.click(within(panel).getByRole("button", { name: "Adjuntar" }));
    await waitFor(() => expect(adjuntarMock).toHaveBeenCalledTimes(1));
    const fd = adjuntarMock.mock.calls[0][0] as FormData;
    expect([...fd.keys()].sort()).toEqual(["comprobante", "destino"]);
    expect(JSON.parse(fd.get("destino") as string)).toEqual({ libro: "caja", movimientoId: ID });
    expect((fd.get("comprobante") as File).name).toBe("recibo.png");
    expect(successMock).toHaveBeenCalledWith("Comprobante adjuntado.");
    expect(onCambio).toHaveBeenCalledTimes(1);
  });

  it("sin archivo no llama al servidor", async () => {
    const { user } = pintarPanel(movimiento());
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Adjuntar comprobante" }));
    await user.click(within(panel).getByRole("button", { name: "Adjuntar" }));
    expect(await within(panel).findByText("Elegí el archivo del comprobante.")).toBeTruthy();
    expect(adjuntarMock).not.toHaveBeenCalled();
  });

  for (const [respuesta, texto] of [
    [{ status: "ya_tiene" }, "Este movimiento ya tiene un comprobante: no se reemplaza ni se suma otro."],
    [{ status: "no_admite", motivo: "anulado" }, "Este movimiento está anulado: ya no se le adjunta un comprobante."],
    [{ status: "no_admite", motivo: "en_su_documento" }, "El comprobante de este movimiento se adjunta al registrarlo, en su propio documento."],
    [{ status: "no_admite", motivo: "no_admite" }, "Este movimiento no lleva comprobante."],
    [{ status: "comprobante_no_guardado" }, "No se pudo guardar el comprobante. Probá de nuevo."],
  ] as const) {
    it(`\`${respuesta.status}${"motivo" in respuesta ? `: ${respuesta.motivo}` : ""}\` se dice en palabras y no relee`, async () => {
      adjuntarMock.mockResolvedValue(respuesta);
      const { user, onCambio } = pintarPanel(movimiento());
      const panel = await screen.findByRole("dialog");
      await user.click(within(panel).getByRole("button", { name: "Adjuntar comprobante" }));
      fireEvent.change(within(panel).getByLabelText(/^Comprobante \(opcional\)/), { target: { files: [PNG()] } });
      await user.click(within(panel).getByRole("button", { name: "Adjuntar" }));
      expect(await within(panel).findByText(texto)).toBeTruthy();
      expect(onCambio).not.toHaveBeenCalled();
    });
  }

  it("R79: NO se ofrece si ya tiene comprobante, si está anulado o si la fila no lo admite", async () => {
    for (const m of [
      movimiento({ tieneComprobante: true }),
      movimiento({ estado: { anulado: true }, anulable: false }),
      movimiento({ admiteAdjuntar: false }),
    ]) {
      pintarPanel(m);
      const panel = await screen.findByRole("dialog");
      expect(within(panel).queryByRole("button", { name: "Adjuntar comprobante" })).toBeNull();
      cleanup();
    }
  });
});

describe("458-C R80 — ver el comprobante: por el servidor y con rótulo legible", () => {
  it("la corrección de caja CON comprobante lo pide al servidor por su destino y lo abre en otra pestaña", async () => {
    verMock.mockResolvedValue({
      status: "ok",
      url: "https://firmada.example/obj",
      contentType: "image/png",
      rotulo: { fuente: "caja", categoria: "egreso_ajuste", fecha: "2026-09-12" },
    });
    const pestana = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(pestana as unknown as Window);
    const { user } = pintarPanel(movimiento({ tieneComprobante: true }));
    const panel = await screen.findByRole("dialog");
    // El rótulo legible, nunca la ruta del objeto.
    expect(within(panel).getByText("Comprobante de «Corrección de caja (resta)» del 2026-09-12")).toBeTruthy();
    await user.click(
      within(panel).getByRole("button", { name: "Ver comprobante: Comprobante de «Corrección de caja (resta)» del 2026-09-12" }),
    );
    await waitFor(() => expect(verMock).toHaveBeenCalledWith({ destino: { libro: "caja", movimientoId: ID } }));
    await waitFor(() => expect(pestana.location.href).toBe("https://firmada.example/obj"));
    expect(pestana.opener).toBeNull();
    expect(panel.textContent).not.toContain("firmada.example");
    open.mockRestore();
  });

  it("si el servidor dice que no tiene, lo avisa y cierra la pestaña vacía", async () => {
    verMock.mockResolvedValue({ status: "sin_comprobante" });
    const pestana = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(pestana as unknown as Window);
    const { user } = pintarPanel(movimiento({ tieneComprobante: true }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: /^Ver comprobante/ }));
    await waitFor(() => expect(errorMock).toHaveBeenCalledWith("Este registro no tiene comprobante."));
    expect(pestana.close).toHaveBeenCalled();
    open.mockRestore();
  });
});
