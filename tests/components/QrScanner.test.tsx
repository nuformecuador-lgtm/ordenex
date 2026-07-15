// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QrScanner } from "@/components/shared/QrScanner";

// Sin hardware/media en CI: se mockea la lib de cámara. El doble captura el
// callback de decodificación que `start` recibe, para poder simular un escaneo.
const { errorMock, startMock, stopMock, clearMock, decodeCallback } = vi.hoisted(
  () => ({
    errorMock: vi.fn(),
    startMock: vi.fn(),
    stopMock: vi.fn(),
    clearMock: vi.fn(),
    decodeCallback: { current: null as ((texto: string) => void) | null },
  }),
);

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorMock,
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: class {
    start = startMock;
    stop = stopMock;
    clear = clearMock;
  },
}));

/** Simula que la cámara decodifica un QR con el texto dado (fuera de React). */
async function decodificar(texto: string) {
  await act(async () => {
    decodeCallback.current?.(texto);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  decodeCallback.current = null;
  startMock.mockImplementation(
    async (
      _config: unknown,
      _opciones: unknown,
      onDecode: (texto: string) => void,
    ) => {
      decodeCallback.current = onDecode;
    },
  );
  stopMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("QrScanner", () => {
  it("alterna la cámara con el botón y refleja el estado en aria-pressed", async () => {
    const user = userEvent.setup();
    render(<QrScanner onDecoded={vi.fn()} />);

    const boton = screen.getByRole("button", { name: "Escanear con cámara" });
    expect(boton).toHaveAttribute("aria-pressed", "false");

    await user.click(boton);

    expect(
      screen.getByRole("button", { name: "Cerrar cámara" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("muestra el visor accesible solo cuando la cámara está abierta", async () => {
    const user = userEvent.setup();
    render(<QrScanner onDecoded={vi.fn()} />);

    expect(
      screen.queryByRole("region", { name: "Visor de cámara QR" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));

    expect(
      screen.getByRole("region", { name: "Visor de cámara QR" }),
    ).toBeInTheDocument();
  });

  it("al decodificar cierra la cámara y llama onDecoded con el texto", async () => {
    const user = userEvent.setup();
    const onDecoded = vi.fn();
    render(<QrScanner onDecoded={onDecoded} />);

    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
    await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());

    await decodificar("https://ordenex.app/paquete/ord-1");

    await vi.waitFor(() =>
      expect(onDecoded).toHaveBeenCalledWith("https://ordenex.app/paquete/ord-1"),
    );
    expect(
      screen.getByRole("button", { name: "Escanear con cámara" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("si la cámara falla muestra el mensaje de error por defecto y la cierra", async () => {
    const user = userEvent.setup();
    startMock.mockRejectedValue(new Error("NotAllowedError"));
    render(<QrScanner onDecoded={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/habilitar los permisos/i);
    expect(
      screen.getByRole("button", { name: "Escanear con cámara" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("usa mensajeErrorCamara cuando el consumidor lo provee", async () => {
    const user = userEvent.setup();
    startMock.mockRejectedValue(new Error("NotAllowedError"));
    render(<QrScanner onDecoded={vi.fn()} mensajeErrorCamara="Camara caida." />);

    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Camara caida."),
    );
  });

  it("disabled bloquea el botón de cámara", () => {
    render(<QrScanner onDecoded={vi.fn()} disabled />);

    expect(
      screen.getByRole("button", { name: "Escanear con cámara" }),
    ).toBeDisabled();
  });

  it("al cerrar la cámara detiene y limpia el scanner (sin fuga)", async () => {
    const user = userEvent.setup();
    render(<QrScanner onDecoded={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
    await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Cerrar cámara" }));

    await vi.waitFor(() => expect(stopMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(clearMock).toHaveBeenCalled());
  });
});
