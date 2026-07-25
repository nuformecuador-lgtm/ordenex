// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EscanerRecepcionBodegaCentral } from "@/app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { recibirEnBodegaCentralPorQr } from "@/lib/actions/recepcion-bodega-central";

// Feature 138 — Receptor de la BODEGA CENTRAL en `/ordenes` (maestro/admin): dos
// entradas equivalentes (escaneo por cámara + entrada manual de guía) que funelan a
// la MISMA Server Action. Se mockean la acción, el toast y la lib de cámara (sin
// hardware en CI): el doble captura el callback de decodificación que `start` recibe
// para simular un escaneo. Espejo del test de `EscanerRecepcionOrigen`.
vi.mock("@/lib/actions/recepcion-bodega-central", () => ({
  recibirEnBodegaCentralPorQr: vi.fn(),
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

const recibirMock = vi.mocked(recibirEnBodegaCentralPorQr);

/** Abre la cámara y simula que decodifica un QR con el texto dado. */
async function escanear(user: ReturnType<typeof userEvent.setup>, texto: string) {
  await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
  await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());
  await act(async () => {
    decodeCallback.current?.(texto);
  });
}

/** Entrada manual: teclea el número de guía y pulsa "Recibir". */
async function recibirManual(
  user: ReturnType<typeof userEvent.setup>,
  texto: string,
) {
  const input = screen.getByLabelText("Número de guía");
  await user.clear(input);
  if (texto) await user.type(input, texto);
  await user.click(screen.getByRole("button", { name: "Recibir" }));
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

describe("EscanerRecepcionBodegaCentral — dos entradas equivalentes (R12/R13)", () => {
  it("R13: al decodificar el QR llama a la acción con el num_guia de la URL", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "o1",
      estado: "en_bodega_central",
    });
    render(<EscanerRecepcionBodegaCentral onRecibida={vi.fn()} />);

    await escanear(user, qrDeGuia(14));

    await vi.waitFor(() =>
      expect(recibirMock).toHaveBeenCalledWith({ numGuia: 14 }),
    );
  });

  it("R12b: la entrada manual dispara la MISMA acción con el num_guia tecleado", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "o1",
      estado: "en_bodega_central",
    });
    render(<EscanerRecepcionBodegaCentral onRecibida={vi.fn()} />);

    await recibirManual(user, "27");

    await vi.waitFor(() =>
      expect(recibirMock).toHaveBeenCalledWith({ numGuia: 27 }),
    );
  });
});

describe("EscanerRecepcionBodegaCentral — toast por resultado (R15) + refresco (R14)", () => {
  it("ok -> toast con la guía (no el UUID) y dispara onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "54f84b2a-391b-4726-b8a4-358a02f2e8a6",
      estado: "en_bodega_central",
    });
    render(<EscanerRecepcionBodegaCentral onRecibida={onRecibida} />);

    await escanear(user, qrDeGuia(14));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock.mock.calls[0][0]).toMatch(/14/);
    expect(successMock.mock.calls[0][0]).toMatch(/bodega central/i);
    expect(successMock.mock.calls[0][0]).not.toMatch(/54f84b2a/);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("R17 (139): ok con estado por_devolver_a_tienda -> toast nombra ese destino, no 'bodega central'", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    // Recepción STATE-AWARE: una orden en devolviendo_a_bodega_central queda en
    // por_devolver_a_tienda; el toast debe reflejar ese destino (no "bodega central").
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "o1",
      estado: "por_devolver_a_tienda",
    });
    render(<EscanerRecepcionBodegaCentral onRecibida={onRecibida} />);

    await escanear(user, qrDeGuia(21));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock.mock.calls[0][0]).toMatch(/21/);
    expect(successMock.mock.calls[0][0]).toMatch(/por devolver a la tienda/i);
    expect(successMock.mock.calls[0][0]).not.toMatch(/bodega central/i);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("ya_recibida -> toast info y dispara onRecibida (idempotente, R14)", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "ya_recibida" });
    render(<EscanerRecepcionBodegaCentral onRecibida={onRecibida} />);

    await recibirManual(user, "14");

    await vi.waitFor(() => expect(infoMock).toHaveBeenCalled());
    expect(infoMock.mock.calls[0][0]).toMatch(/ya .*recibida/i);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("estado_invalido -> error con el estado actual en legible, sin onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({
      status: "estado_invalido",
      estado: "en_ruta",
    });
    render(<EscanerRecepcionBodegaCentral onRecibida={onRecibida} />);

    await escanear(user, qrDeGuia(14));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // Legible, no el value crudo: la etiqueta sale del mapa de presentación.
    expect(errorMock.mock.calls[0][0]).toMatch(ORDER_STATUS_LABELS.en_ruta);
    expect(errorMock.mock.calls[0][0]).not.toMatch("en_ruta");
    expect(onRecibida).not.toHaveBeenCalled();
  });

  it("no_encontrada -> error 'Orden no encontrada', sin onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "no_encontrada" });
    render(<EscanerRecepcionBodegaCentral onRecibida={onRecibida} />);

    await recibirManual(user, "14");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/no encontrada/i);
    expect(onRecibida).not.toHaveBeenCalled();
  });

  it("forbidden -> error de permiso, sin onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "forbidden" });
    render(<EscanerRecepcionBodegaCentral onRecibida={onRecibida} />);

    await recibirManual(user, "14");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/permiso/i);
    expect(onRecibida).not.toHaveBeenCalled();
  });

  it("unauthenticated -> error de sesión, sin onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "unauthenticated" });
    render(<EscanerRecepcionBodegaCentral onRecibida={onRecibida} />);

    await recibirManual(user, "14");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/sesión/i);
    expect(onRecibida).not.toHaveBeenCalled();
  });

  it("conflict -> error de cambio de estado, sin onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "conflict" });
    render(<EscanerRecepcionBodegaCentral onRecibida={onRecibida} />);

    await recibirManual(user, "14");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/cambió de estado/i);
    expect(onRecibida).not.toHaveBeenCalled();
  });

  it("validation_error del borde -> error 'Código inválido'", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { numGuia: ["inválido"] },
    });
    render(<EscanerRecepcionBodegaCentral onRecibida={vi.fn()} />);

    await recibirManual(user, "14");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
  });
});

describe("EscanerRecepcionBodegaCentral — corte en cliente del código inválido (R10)", () => {
  it("un QR que no resuelve a num_guia no llama a la acción", async () => {
    const user = userEvent.setup();
    render(<EscanerRecepcionBodegaCentral onRecibida={vi.fn()} />);

    await escanear(user, "https://ordenex.app/paquete/54f84b2a-391b-4726-b8a4");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(recibirMock).not.toHaveBeenCalled();
  });

  it("una guía manual no numérica/no positiva se corta en cliente (sin llamar a la acción)", async () => {
    const user = userEvent.setup();
    render(<EscanerRecepcionBodegaCentral onRecibida={vi.fn()} />);

    // No entero positivo: se rechaza en el borde de cliente con "Código inválido".
    await recibirManual(user, "0");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(recibirMock).not.toHaveBeenCalled();
  });

  it("una guía manual vacía se corta en cliente (sin llamar a la acción)", async () => {
    const user = userEvent.setup();
    render(<EscanerRecepcionBodegaCentral onRecibida={vi.fn()} />);

    await recibirManual(user, "");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(recibirMock).not.toHaveBeenCalled();
  });
});
