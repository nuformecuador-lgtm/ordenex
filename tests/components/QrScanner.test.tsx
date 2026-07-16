// @vitest-environment jsdom
import { useState } from "react";
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

  // Regresión (bucle de escaneo): html5-qrcode entrega un frame por tick hasta
  // que `stop()` resuelve, así que el mismo QR llegaba al callback muchas veces
  // y disparaba la acción del consumidor una vez por frame.
  it("entrega un solo onDecoded aunque la cámara siga decodificando frames", async () => {
    const user = userEvent.setup();
    const onDecoded = vi.fn();
    render(<QrScanner onDecoded={onDecoded} />);

    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
    await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());

    await decodificar("https://ordenex.app/paquete/ord-1");
    await decodificar("https://ordenex.app/paquete/ord-1");
    await decodificar("https://ordenex.app/paquete/ord-1");

    expect(onDecoded).toHaveBeenCalledTimes(1);
  });

  // Regresión (bucle de escaneo): `onDecoded` y `toast` cambian de identidad en
  // cada render de los consumidores (`useQrNavigate` recrea `onDecoded` al mover
  // su flag `procesando`). Estaban en las deps del efecto, así que un re-render
  // limpiaba el efecto y RE-ARRANCABA la cámara → nuevo decode → bucle.
  it("no reinicia la cámara cuando el consumidor recrea onDecoded en cada render", async () => {
    const user = userEvent.setup();

    function Consumidor() {
      const [, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            re-render
          </button>
          {/* identidad nueva en cada render, como en useQrNavigate */}
          <QrScanner onDecoded={() => {}} />
        </>
      );
    }

    render(<Consumidor />);
    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
    await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "re-render" }));
    await user.click(screen.getByRole("button", { name: "re-render" }));

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(stopMock).not.toHaveBeenCalled();
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
