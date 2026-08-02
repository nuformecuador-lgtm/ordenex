// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EscanerRecepcion } from "@/app/(app)/recepcion-satelite/_components/EscanerRecepcion";
import { recibirPorQr } from "@/lib/actions/recepcion-satelite";

// Feature 33 (T13) — recepción por escaneo con la CÁMARA (única entrada: el input
// keyboard-wedge se retiró por pedido humano). Se mockean la Server Action, el
// toast y la lib de cámara (sin hardware en CI): el doble captura el callback de
// decodificación que `start` recibe, para poder simular un escaneo.
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
}));

const { successMock, errorMock, infoMock, startMock, decodeCallback } =
  vi.hoisted(() => ({
    successMock: vi.fn(),
    errorMock: vi.fn(),
    infoMock: vi.fn(),
    startMock: vi.fn(),
    decodeCallback: { current: null as ((texto: string) => void) | null },
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
    start = startMock;
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

const recibirMock = vi.mocked(recibirPorQr);

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

/** URL del paquete tal como la codifica el QR de la etiqueta: `/paquete/<numGuia>`. */
function qrDeGuia(numGuia: number): string {
  return `https://ordenex.app/paquete/${numGuia}`;
}

/**
 * Monta el receptor y DESPLIEGA la tarjeta. Desde el 2026-07-31 (decisión del humano) vive
 * plegada tras el disparador de `EscanerDesplegable`, como en el resto de la app: montada
 * dejaba `QrScanner` vivo —la cámara encendida— todo el tiempo que la bodega tuviera la
 * pantalla abierta. Cada caso abre primero, que es lo que hace quien va a recibir.
 */
async function renderAbierto(
  user: ReturnType<typeof userEvent.setup>,
  onRecibida: () => void = vi.fn(),
) {
  render(<EscanerRecepcion onRecibida={onRecibida} />);
  await user.click(screen.getByRole("button", { name: "Recibir paquete" }));
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

describe("EscanerRecepcion (cámara)", () => {
  it("al decodificar llama recibirPorQr con el código escaneado", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "ord-1",
      estado: "en_bodega_satelite",
    });
    await renderAbierto(user, onRecibida);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() =>
      expect(recibirMock).toHaveBeenCalledWith({ numGuia: 1001 }),
    );
  });

  // La entrada por teclado se retiró: solo queda la cámara.
  // El rediseño de la UI (PR #212) devolvió la entrada MANUAL al receptor: la cámara no
  // siempre está disponible (permiso denegado, teléfono sin cámara, etiqueta ilegible), y sin
  // ella el paquete no se puede recibir. Este caso afirmaba lo contrario y se quedó obsoleto;
  // lo que hay que fijar ahora es que las DOS vías existan y lleven a la misma acción.
  it("expone la entrada manual por número de guía, equivalente al escaneo", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "ord-1",
      estado: "en_bodega_satelite",
    });
    await renderAbierto(user);

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Recibir" }));

    // Mismo contrato que el camino de la cámara: el número tecleado ES el `num_guia`.
    await vi.waitFor(() => expect(recibirMock).toHaveBeenCalledWith({ numGuia: 1001 }));
  });

  it("QR con URL del paquete → extrae el código del último segmento y llama recibirPorQr", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "ord-1",
      estado: "en_bodega_satelite",
    });
    await renderAbierto(user);

    await escanear(user, `${qrDeGuia(1001)}/`); // robusto ante barra final

    await vi.waitFor(() =>
      expect(recibirMock).toHaveBeenCalledWith({ numGuia: 1001 }),
    );
  });

  it("resultado ok → toast de éxito y dispara onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({
      status: "ok",
      ordenId: "ord-1",
      estado: "en_bodega_satelite",
    });
    await renderAbierto(user, onRecibida);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    // El toast nombra la guía (lo impreso en la etiqueta), NO el UUID interno.
    expect(successMock.mock.calls[0][0]).toMatch(/1001/);
    expect(successMock.mock.calls[0][0]).not.toMatch(/ord-1/);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("R14: ya_recibida → toast info y dispara onRecibida (idempotente)", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "ya_recibida" });
    await renderAbierto(user, onRecibida);

    await escanear(user, qrDeGuia(1002));

    await vi.waitFor(() => expect(infoMock).toHaveBeenCalled());
    expect(infoMock.mock.calls[0][0]).toMatch(/guía 1002 ya .*recibida/i);
    expect(onRecibida).toHaveBeenCalledTimes(1);
  });

  it("R12: zona_ajena → toast de error 'otra zona', sin onRecibida", async () => {
    const user = userEvent.setup();
    const onRecibida = vi.fn();
    recibirMock.mockResolvedValue({ status: "zona_ajena" });
    await renderAbierto(user, onRecibida);

    await escanear(user, qrDeGuia(1003));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/otra zona/i);
    expect(onRecibida).not.toHaveBeenCalled();
  });

  it("R13: estado_invalido → toast de error con el estado actual", async () => {
    const user = userEvent.setup();
    // Feature 155/R28: el estado de este caso era el de fulfillment en bodega, que salio
    // del catalogo. Se sustituye por otro estado VIGENTE que tampoco es recibible en una
    // bodega satelite (una orden aun en la tienda), para que el caso siga afirmando lo que
    // le importa: que el toast muestra la etiqueta LEGIBLE y no el value crudo.
    recibirMock.mockResolvedValue({
      status: "estado_invalido",
      estado: "en_preparacion",
    });
    await renderAbierto(user);

    await escanear(user, qrDeGuia(1004));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // Estado legible derivado del value crudo.
    expect(errorMock.mock.calls[0][0]).toMatch(/En preparación/);
  });

  it("R15: no_encontrada → toast de error 'orden no encontrada'", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({ status: "no_encontrada" });
    await renderAbierto(user);

    await escanear(user, qrDeGuia(1005));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/no encontrada/i);
  });

  it("R16: validation_error del servidor → toast de error 'código inválido'", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({ status: "validation_error", fieldErrors: {} });
    await renderAbierto(user);

    await escanear(user, qrDeGuia(1007));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
  });

  // Un QR que no es la URL del paquete (o cuyo último segmento no es un num_guia)
  // lo rechaza `extractNumGuiaFromScan` en cliente: mismo mensaje que el
  // `validation_error` del borde, pero sin llamar a la acción.
  it("R16: un QR ajeno se rechaza en cliente, sin llamar a recibirPorQr", async () => {
    const user = userEvent.setup();
    await renderAbierto(user);

    await escanear(user, "###");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(recibirMock).not.toHaveBeenCalled();
  });

  // CORTE LIMPIO (decisión humana): una etiqueta VIEJA codificaba el UUID de la
  // orden en la URL. Ese QR ya no resuelve a num_guia y NO se intenta resolver por
  // otra vía: da error de validación y la etiqueta se reimprime.
  it("R16: el QR de una etiqueta vieja (UUID) NO se resuelve: error de validación sin llamar a la acción", async () => {
    const user = userEvent.setup();
    await renderAbierto(user);

    await escanear(
      user,
      "https://ordenex.app/paquete/3f1c9a2e-7b41-4d6a-9c15-8e2d0b6f4a77",
    );

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(recibirMock).not.toHaveBeenCalled();
  });

  it("R5: sin_zona → toast de error 'no tienes una zona asignada'", async () => {
    const user = userEvent.setup();
    recibirMock.mockResolvedValue({ status: "sin_zona" });
    await renderAbierto(user);

    await escanear(user, qrDeGuia(1006));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/zona asignada/i);
  });

  it("expone el botón de cámara y alterna su estado (aria-pressed)", async () => {
    const user = userEvent.setup();
    await renderAbierto(user);

    const boton = screen.getByRole("button", { name: "Escanear con cámara" });
    expect(boton).toHaveAttribute("aria-pressed", "false");
    await user.click(boton);
    expect(
      screen.getByRole("button", { name: "Cerrar cámara" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

// ---------------------------------------------------------------------------------------
// 2026-07-31 (decisión del humano): el receptor vive tras un desplegable, plegado de
// entrada. Dentro vive `QrScanner`: montado dejaba la cámara ENCENDIDA todo el rato que la
// bodega satélite tuviera abierta su pantalla.
// ---------------------------------------------------------------------------------------
describe("EscanerRecepcion — el desplegable (cámara apagada por defecto)", () => {
  it("arranca PLEGADO: se ofrece el acceso, pero la cámara no está montada", () => {
    render(<EscanerRecepcion onRecibida={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Recibir paquete" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Recibir por número de guía o escaneo" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Escanear con cámara" })).toBeNull();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("al cerrar, la tarjeta se DESMONTA: es lo que apaga la cámara", async () => {
    const user = userEvent.setup();
    await renderAbierto(user);

    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
    await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Ocultar escáner" }));

    // Desmontaje, no `hidden`: es lo que dispara el cleanup de `QrScanner`.
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Recibir por número de guía o escaneo" }),
      ).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Cerrar cámara" })).toBeNull();
    // Y el acceso sigue ahí para volver a abrirlo.
    expect(
      screen.getByRole("button", { name: "Recibir paquete" }),
    ).toBeInTheDocument();
  });
});
