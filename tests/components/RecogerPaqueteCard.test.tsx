// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecogerPaqueteCard } from "@/app/(app)/mis-asignaciones/_components/RecogerPaqueteCard";
import { recogerAsignaciones } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Recoger paquete: la tarjeta con los DOS caminos (cámara y número tecleado), que antes
// eran dos componentes sueltos (`EscanerRecoger` + `InputRecoger`). Ambos resuelven el
// num_guia contra la lista "por recoger" y ACEPTAN la orden con la MISMA action
// `recogerAsignaciones`, así que los casos de resultado se cubren una sola vez y lo que
// se comprueba por separado es el PARSEO de cada camino (URL del paquete vs. número).
// Se mockean la Server Action, el toast y la lib de cámara (sin hardware en CI): el
// doble captura el callback de decodificación que `start` recibe.
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
}));

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

const recogerMock = vi.mocked(recogerAsignaciones);

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string; numGuia: number },
): MiAsignacionDTO {
  return {
    // Feature 92/R28: sin posicion en la ruta salvo que el test la fije.
    secuenciaRuta: null,
    numRemision: "REM-001",
    estatusValue: "por_recoger",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    // Feature 97: coords de la parada (feature 91) para el mapa de ruta.
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: null,
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    ...over,
  };
}

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

const porRecoger = [
  makeAsignacion({ id: "ord-1", numGuia: 1001 }),
  makeAsignacion({ id: "ord-2", numGuia: 1002, numRemision: "REM-002" }),
];

/** Teclea el número de guía y confirma con Enter (submit del form). */
async function tecleaYConfirma(
  user: ReturnType<typeof userEvent.setup>,
  texto: string,
) {
  await user.type(screen.getByLabelText("Número de guía"), `${texto}{Enter}`);
}

describe("RecogerPaqueteCard — camino cámara", () => {
  it("al escanear una guía por recoger, recoge esa orden por su id (misma action)", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-2"] });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await escanear(user, qrDeGuia(1002));

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-2"] }),
    );
  });

  it("robusto ante barra final en la URL del paquete", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-1"] });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await escanear(user, `${qrDeGuia(1001)}/`);

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-1"] }),
    );
  });

  it("ok → toast de éxito (nombra la guía) y dispara onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-1"] });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={onRecogida} />);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock.mock.calls[0][0]).toMatch(/1001/);
    expect(successMock.mock.calls[0][0]).not.toMatch(/ord-1/);
    expect(onRecogida).toHaveBeenCalledTimes(1);
  });

  it("una guía que no está entre las órdenes por recoger se rechaza en cliente, sin llamar a la action", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={onRecogida} />);

    await escanear(user, qrDeGuia(9999));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(recogerMock).not.toHaveBeenCalled();
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("un QR que no es la URL del paquete se rechaza en cliente, sin llamar a la action", async () => {
    const user = userEvent.setup();
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await escanear(user, "###");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(recogerMock).not.toHaveBeenCalled();
  });

  it("conflict → toast de error, sin onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "conflict", detalle: [] });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={onRecogida} />);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("forbidden → toast de error 'sin permiso', sin onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "forbidden" });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={onRecogida} />);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/permiso/i);
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("expone el botón de cámara y alterna su estado (aria-pressed)", async () => {
    const user = userEvent.setup();
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    const boton = screen.getByRole("button", { name: "Escanear con cámara" });
    expect(boton).toHaveAttribute("aria-pressed", "false");
    await user.click(boton);
    expect(
      screen.getByRole("button", { name: "Cerrar cámara" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("RecogerPaqueteCard — camino manual (número tecleado)", () => {
  it("al teclear una guía por recoger, recoge esa orden por su id (misma action)", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-2"] });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await tecleaYConfirma(user, "1002");

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-2"] }),
    );
  });

  it("ok → toast de éxito (nombra la guía), dispara onRecogida y LIMPIA el campo", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-1"] });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={onRecogida} />);

    await tecleaYConfirma(user, "1001");

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock.mock.calls[0][0]).toMatch(/1001/);
    expect(successMock.mock.calls[0][0]).not.toMatch(/ord-1/);
    expect(onRecogida).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(screen.getByLabelText("Número de guía")).toHaveValue(""),
    );
  });

  it("también recoge con el botón 'Recoger' (no solo con Enter)", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-2"] });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await user.type(screen.getByLabelText("Número de guía"), "1002");
    await user.click(screen.getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-2"] }),
    );
  });

  it("una guía que NO está entre las órdenes por recoger se rechaza en cliente, sin llamar a la action", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={onRecogida} />);

    await tecleaYConfirma(user, "9999");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(recogerMock).not.toHaveBeenCalled();
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("robustez: campo VACÍO no llama a la action (botón deshabilitado y Enter inerte)", async () => {
    const user = userEvent.setup();
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Recoger" })).toBeDisabled();
    await user.type(screen.getByLabelText("Número de guía"), "{Enter}");
    expect(recogerMock).not.toHaveBeenCalled();
  });

  it("robustez: entrada NO numérica no llama a la action y CONSERVA lo tecleado", async () => {
    const user = userEvent.setup();
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await tecleaYConfirma(user, "abc");

    expect(recogerMock).not.toHaveBeenCalled();
    // Se queda en el campo para corregirlo, en vez de borrarse sin explicacion.
    expect(screen.getByLabelText("Número de guía")).toHaveValue("abc");
  });

  it("forbidden → toast de error 'sin permiso', sin onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "forbidden" });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={onRecogida} />);

    await tecleaYConfirma(user, "1001");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/permiso/i);
    expect(onRecogida).not.toHaveBeenCalled();
  });
});

describe("RecogerPaqueteCard — la tarjeta", () => {
  it("ofrece los DOS caminos en un solo control", () => {
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    const tarjeta = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    expect(tarjeta).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Escanear con cámara" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Número de guía")).toBeInTheDocument();
  });

  it("tras recoger, la confirmación del último acierto queda a la vista", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-1"] });
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await tecleaYConfirma(user, "1001");

    await vi.waitFor(() =>
      expect(screen.getByText(/recogida correctamente/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("1001")).toBeInTheDocument();
  });
});
