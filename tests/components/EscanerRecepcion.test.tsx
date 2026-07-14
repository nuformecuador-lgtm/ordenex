// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EscanerRecepcion } from "@/app/(app)/recepcion-satelite/_components/EscanerRecepcion";
import { recibirPorQr } from "@/lib/actions/recepcion-satelite";

// Feature 33 (T13) — recepción por escaneo (keyboard-wedge). Se mockean la Server
// Action, el toast y la lib de cámara (sin hardware en CI). Se simula el lector
// físico escribiendo el orden.id en el input y pulsando Enter (submit del form).
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
}));

const { successMock, errorMock, infoMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  infoMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    info: infoMock,
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Mock de la lib de cámara: no hay hardware/media en CI. La instancia expone el
// ciclo de vida (start/stop/clear) para que abrir/cerrar la cámara no falle.
vi.mock("html5-qrcode", () => ({
  Html5Qrcode: class {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

const recibirMock = vi.mocked(recibirPorQr);

/** Escribe un código en el input de escaneo y pulsa Enter (lector keyboard-wedge). */
async function escanear(
  user: ReturnType<typeof userEvent.setup>,
  codigo: string,
) {
  const input = screen.getByRole("textbox", { name: "Código de la orden" });
  await user.click(input);
  await user.type(input, `${codigo}{Enter}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("EscanerRecepcion (keyboard-wedge)", () => {
  it("R10: al Enter llama recibirPorQr con el ordenId escaneado y limpia el input", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "ord-1",
      estado: "en_bodega_satelite",
    });
    render(<EscanerRecepcion onRecibida={onRecibida} />);

    await escanear(user, "ord-1");

    await vi.waitFor(() =>
      expect(recibirMock).toHaveBeenCalledWith({ ordenId: "ord-1" }),
    );
    const input = screen.getByRole("textbox", { name: "Código de la orden" });
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("QR con URL del paquete → extrae el ordenId del último segmento y llama recibirPorQr", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "ord-1",
      estado: "en_bodega_satelite",
    });
    render(<EscanerRecepcion onRecibida={vi.fn()} />);

    await escanear(user, "https://ordenex.app/paquete/ord-1");

    await vi.waitFor(() =>
      expect(recibirMock).toHaveBeenCalledWith({ ordenId: "ord-1" }),
    );
  });

  it("R10: resultado ok → toast de éxito y dispara onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "ord-1",
      estado: "en_bodega_satelite",
    });
    render(<EscanerRecepcion onRecibida={onRecibida} />);

    await escanear(user, "ord-1");

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock.mock.calls[0][0]).toMatch(/ord-1/);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("R14: ya_recibida → toast info y dispara onRecibida (idempotente)", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "ya_recibida" });
    render(<EscanerRecepcion onRecibida={onRecibida} />);

    await escanear(user, "ord-2");

    await vi.waitFor(() => expect(infoMock).toHaveBeenCalled());
    expect(infoMock.mock.calls[0][0]).toMatch(/ya .*recibida/i);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("R12: zona_ajena → toast de error 'otra zona', sin onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "zona_ajena" });
    render(<EscanerRecepcion onRecibida={onRecibida} />);

    await escanear(user, "ord-3");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/otra zona/i);
    expect(onRecibida).not.toHaveBeenCalled();
  });

  it("R13: estado_invalido → toast de error con el estado actual", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({
      status: "estado_invalido",
      estado: "en_fulfillment",
    });
    render(<EscanerRecepcion onRecibida={vi.fn()} />);

    await escanear(user, "ord-4");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // Estado legible derivado del value crudo.
    expect(errorMock.mock.calls[0][0]).toMatch(/En fulfillment/);
  });

  it("R15: no_encontrada → toast de error 'orden no encontrada'", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({ status: "no_encontrada" });
    render(<EscanerRecepcion onRecibida={vi.fn()} />);

    await escanear(user, "ord-5");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/no encontrada/i);
  });

  it("R16: validation_error → toast de error 'código inválido'", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({ status: "validation_error", fieldErrors: {} });
    render(<EscanerRecepcion onRecibida={vi.fn()} />);

    await escanear(user, "###");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
  });

  it("R5: sin_zona → toast de error 'no tienes una zona asignada'", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({ status: "sin_zona" });
    render(<EscanerRecepcion onRecibida={vi.fn()} />);

    await escanear(user, "ord-6");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/zona asignada/i);
  });

  it("expone el botón de cámara y alterna su estado (aria-pressed)", async () => {
    const user = userEvent.setup();
    render(<EscanerRecepcion onRecibida={vi.fn()} />);

    const boton = screen.getByRole("button", { name: "Escanear con cámara" });
    expect(boton).toHaveAttribute("aria-pressed", "false");
    await user.click(boton);
    expect(
      screen.getByRole("button", { name: "Cerrar cámara" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
