// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EscanerRecepcionOrigen } from "@/app/(app)/ordenes/_components/EscanerRecepcionOrigen";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { recibirEnOrigenPorQr } from "@/lib/actions/recepcion-origen";

// Escáner de la tienda en `/ordenes`: cierra el flujo de devolución. Se mockean la
// Server Action, el toast y la lib de cámara (sin hardware en CI): el doble captura
// el callback de decodificación que `start` recibe, para simular un escaneo.
vi.mock("@/lib/actions/recepcion-origen", () => ({
  recibirEnOrigenPorQr: vi.fn(),
}));

const { successMock, errorMock, infoMock, startMock, decodeCallback } = vi.hoisted(
  () => ({
    successMock: vi.fn(),
    errorMock: vi.fn(),
    infoMock: vi.fn(),
    startMock: vi.fn(),
    decodeCallback: { current: null as ((texto: string) => void) | null },
  }),
);

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

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: class {
    start = startMock;
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

const recibirMock = vi.mocked(recibirEnOrigenPorQr);

/** Abre la cámara y simula que decodifica un QR con el texto dado. */
async function escanear(user: ReturnType<typeof userEvent.setup>, texto: string) {
  await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
  await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());
  await act(async () => {
    decodeCallback.current?.(texto);
  });
}

/** URL del paquete tal como la codifica el QR de la etiqueta. */
function qrDeGuia(numGuia: number): string {
  return `https://ordenex.app/paquete/${numGuia}`;
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

describe("EscanerRecepcionOrigen", () => {
  it("al decodificar llama a la acción con el num_guia del QR", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "o1",
      estado: "recibido_origen",
    });
    render(<EscanerRecepcionOrigen onRecibida={vi.fn()} />);

    await escanear(user, qrDeGuia(14));

    await vi.waitFor(() =>
      expect(recibirMock).toHaveBeenCalledWith({ numGuia: 14 }),
    );
  });

  it("ok -> toast con la guía (no el UUID) y dispara onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "54f84b2a-391b-4726-b8a4-358a02f2e8a6",
      estado: "recibido_origen",
    });
    render(<EscanerRecepcionOrigen onRecibida={onRecibida} />);

    await escanear(user, qrDeGuia(14));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock.mock.calls[0][0]).toMatch(/14/);
    expect(successMock.mock.calls[0][0]).not.toMatch(/54f84b2a/);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("ya_recibida -> toast info y dispara onRecibida (idempotente)", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "ya_recibida" });
    render(<EscanerRecepcionOrigen onRecibida={onRecibida} />);

    await escanear(user, qrDeGuia(14));

    await vi.waitFor(() => expect(infoMock).toHaveBeenCalled());
    expect(infoMock.mock.calls[0][0]).toMatch(/ya .*recibida/i);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("tienda_ajena -> error 'otra tienda', sin onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "tienda_ajena" });
    render(<EscanerRecepcionOrigen onRecibida={onRecibida} />);

    await escanear(user, qrDeGuia(14));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/otra tienda/i);
    expect(onRecibida).not.toHaveBeenCalled();
  });

  it("estado_invalido -> error con el estado actual en legible", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({ status: "estado_invalido", estado: "en_reparto" });
    render(<EscanerRecepcionOrigen onRecibida={vi.fn()} />);

    await escanear(user, qrDeGuia(14));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // Legible, no el value crudo: la etiqueta sale del mapa de presentación
    // (fuente de verdad), blindado aparte en `EstatusLabel.test.ts`.
    expect(errorMock.mock.calls[0][0]).toMatch(ORDER_STATUS_LABELS.en_reparto);
    expect(errorMock.mock.calls[0][0]).not.toMatch("en_reparto");
  });

  // Un QR ajeno (o el UUID de una etiqueta vieja) se rechaza en cliente.
  it("un QR que no resuelve a num_guia no llama a la acción", async () => {
    const user = userEvent.setup();
    render(<EscanerRecepcionOrigen onRecibida={vi.fn()} />);

    await escanear(user, "https://ordenex.app/paquete/54f84b2a-391b-4726-b8a4");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(recibirMock).not.toHaveBeenCalled();
  });
});
