// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VerificarGuiaGate } from "@/app/(app)/mis-asignaciones/_components/VerificarGuiaGate";

// Feature 98: gate que confirma que el paquete en mano coincide con la orden del
// panel ANTES de habilitar la gestión (escaneo del QR o tecleo del num_guia, y
// debe COINCIDIR). Se mockean el toast y la lib de cámara (sin hardware en CI):
// el doble captura el callback de decodificación que `start` recibe para simular
// un escaneo, igual que en EscanerRecoger.test. El resto del gate (input, branch
// null) usa el componente REAL + `extractNumGuiaFromScan` real.
const { successMock, errorMock, startMock, decodeCallback } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  startMock: vi.fn(),
  decodeCallback: { current: null as ((texto: string) => void) | null },
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
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
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

/** URL del paquete tal como la codifica el QR de la etiqueta: `/paquete/<numGuia>`. */
function qrDeGuia(numGuia: number): string {
  return `https://ordenex.app/paquete/${numGuia}`;
}

/** Abre la cámara y simula que decodifica un QR con el texto dado. */
async function escanear(
  user: ReturnType<typeof userEvent.setup>,
  texto: string,
) {
  await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
  await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());
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
});

afterEach(() => {
  cleanup();
});

describe("VerificarGuiaGate (feature 98)", () => {
  it("guía tecleada CORRECTA → llama onVerificado, sin toast de error", async () => {
    const user = userEvent.setup();
    const onVerificado = vi.fn();
    render(<VerificarGuiaGate numGuiaEsperado={1001} onVerificado={onVerificado} />);

    await user.type(screen.getByLabelText("Número de guía"), "1001");
    await user.click(screen.getByRole("button", { name: "Gestionar" }));

    expect(onVerificado).toHaveBeenCalledTimes(1);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("guía tecleada DISTINTA → NO llama onVerificado y avisa nombrando la guía tecleada", async () => {
    const user = userEvent.setup();
    const onVerificado = vi.fn();
    render(<VerificarGuiaGate numGuiaEsperado={1001} onVerificado={onVerificado} />);

    await user.type(screen.getByLabelText("Número de guía"), "2002");
    await user.click(screen.getByRole("button", { name: "Gestionar" }));

    expect(onVerificado).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalled();
    expect(errorMock.mock.calls[0][0]).toMatch(/2002/);
  });

  it("texto NO numérico en el input NO llama onVerificado ni avisa", async () => {
    const user = userEvent.setup();
    const onVerificado = vi.fn();
    render(<VerificarGuiaGate numGuiaEsperado={1001} onVerificado={onVerificado} />);

    await user.type(screen.getByLabelText("Número de guía"), "abc");
    await user.click(screen.getByRole("button", { name: "Gestionar" }));

    expect(onVerificado).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("numGuiaEsperado null → muestra el aviso de bloqueo y NO hay input ni escáner", () => {
    const onVerificado = vi.fn();
    render(<VerificarGuiaGate numGuiaEsperado={null} onVerificado={onVerificado} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/no tiene guía asignada/i);
    // Sin guía no hay contra qué verificar: nada de input ni botón de cámara.
    expect(screen.queryByLabelText("Número de guía")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Escanear con cámara" }),
    ).toBeNull();
    expect(onVerificado).not.toHaveBeenCalled();
  });

  it("escaneo del QR con la guía CORRECTA → llama onVerificado", async () => {
    const user = userEvent.setup();
    const onVerificado = vi.fn();
    render(<VerificarGuiaGate numGuiaEsperado={1001} onVerificado={onVerificado} />);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() => expect(onVerificado).toHaveBeenCalledTimes(1));
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("escaneo del QR con una guía DISTINTA → NO llama onVerificado y avisa", async () => {
    const user = userEvent.setup();
    const onVerificado = vi.fn();
    render(<VerificarGuiaGate numGuiaEsperado={1001} onVerificado={onVerificado} />);

    await escanear(user, qrDeGuia(9999));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(onVerificado).not.toHaveBeenCalled();
  });

  it("escaneo de un QR que NO es del paquete → toast 'Código inválido.' y sin onVerificado", async () => {
    const user = userEvent.setup();
    const onVerificado = vi.fn();
    render(<VerificarGuiaGate numGuiaEsperado={1001} onVerificado={onVerificado} />);

    await escanear(user, "###");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(onVerificado).not.toHaveBeenCalled();
  });
});
