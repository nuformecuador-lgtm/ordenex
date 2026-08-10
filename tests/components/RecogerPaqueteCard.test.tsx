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

/**
 * Monta la tarjeta y la ABRE. Desde el 2026-07-31 (decisión del humano) la tarjeta vive tras
 * el disparador de `EscanerModal` —en modal desde el 2026-08-10—, igual que en el resto de
 * la app:
 * montada dejaba `QrScanner` vivo —la cámara encendida— todo el tiempo que el mensajero
 * tuviera la pantalla abierta, en la calle. Cada caso abre primero, que es exactamente lo
 * que hace el mensajero cuando va a recoger.
 */
async function renderAbierta(
  user: ReturnType<typeof userEvent.setup>,
  onRecogida: () => void = vi.fn(),
) {
  render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={onRecogida} />);
  await user.click(screen.getByRole("button", { name: "Recoger paquete" }));
}

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
    await renderAbierta(user);

    await escanear(user, qrDeGuia(1002));

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-2"] }),
    );
  });

  it("robusto ante barra final en la URL del paquete", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-1"] });
    await renderAbierta(user);

    await escanear(user, `${qrDeGuia(1001)}/`);

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-1"] }),
    );
  });

  it("ok → toast de éxito (nombra la guía) y dispara onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-1"] });
    await renderAbierta(user, onRecogida);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock.mock.calls[0][0]).toMatch(/1001/);
    expect(successMock.mock.calls[0][0]).not.toMatch(/ord-1/);
    expect(onRecogida).toHaveBeenCalledTimes(1);
  });

  it("una guía que no está entre las órdenes por recoger se rechaza en cliente, sin llamar a la action", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    await renderAbierta(user, onRecogida);

    await escanear(user, qrDeGuia(9999));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(recogerMock).not.toHaveBeenCalled();
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("un QR que no es la URL del paquete se rechaza en cliente, sin llamar a la action", async () => {
    const user = userEvent.setup();
    await renderAbierta(user);

    await escanear(user, "###");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/inválido/i);
    expect(recogerMock).not.toHaveBeenCalled();
  });

  it("conflict → toast de error, sin onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "conflict", detalle: [] });
    await renderAbierta(user, onRecogida);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("forbidden → toast de error 'sin permiso', sin onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "forbidden" });
    await renderAbierta(user, onRecogida);

    await escanear(user, qrDeGuia(1001));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/permiso/i);
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("expone el botón de cámara y alterna su estado (aria-pressed)", async () => {
    const user = userEvent.setup();
    await renderAbierta(user);

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
    await renderAbierta(user);

    await tecleaYConfirma(user, "1002");

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-2"] }),
    );
  });

  it("ok → toast de éxito (nombra la guía), dispara onRecogida y LIMPIA el campo", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-1"] });
    await renderAbierta(user, onRecogida);

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
    await renderAbierta(user);

    await user.type(screen.getByLabelText("Número de guía"), "1002");
    await user.click(screen.getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-2"] }),
    );
  });

  it("una guía que NO está entre las órdenes por recoger se rechaza en cliente, sin llamar a la action", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    await renderAbierta(user, onRecogida);

    await tecleaYConfirma(user, "9999");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(recogerMock).not.toHaveBeenCalled();
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("robustez: campo VACÍO no llama a la action (botón deshabilitado y Enter inerte)", async () => {
    const user = userEvent.setup();
    await renderAbierta(user);

    expect(screen.getByRole("button", { name: "Recoger" })).toBeDisabled();
    await user.type(screen.getByLabelText("Número de guía"), "{Enter}");
    expect(recogerMock).not.toHaveBeenCalled();
  });

  it("robustez: entrada NO numérica no llama a la action y CONSERVA lo tecleado", async () => {
    const user = userEvent.setup();
    await renderAbierta(user);

    await tecleaYConfirma(user, "abc");

    expect(recogerMock).not.toHaveBeenCalled();
    // Se queda en el campo para corregirlo, en vez de borrarse sin explicacion.
    expect(screen.getByLabelText("Número de guía")).toHaveValue("abc");
  });

  it("forbidden → toast de error 'sin permiso', sin onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "forbidden" });
    await renderAbierta(user, onRecogida);

    await tecleaYConfirma(user, "1001");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/permiso/i);
    expect(onRecogida).not.toHaveBeenCalled();
  });
});

describe("RecogerPaqueteCard — la tarjeta", () => {
  it("ofrece los DOS caminos en un solo control", async () => {
    const user = userEvent.setup();
    await renderAbierta(user);

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
    await renderAbierta(user);

    await tecleaYConfirma(user, "1001");

    await vi.waitFor(() =>
      expect(screen.getByText(/recogida correctamente/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("1001")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------
// 2026-07-31 (decisión del humano): la tarjeta vive tras un desplegable, plegada de
// entrada. El motivo no es estético — dentro vive `QrScanner`, y montado significaba la
// cámara ENCENDIDA todo el rato que el mensajero tuviera abierta `/mis-asignaciones`.
// ---------------------------------------------------------------------------------------
describe("RecogerPaqueteCard — el desplegable (cámara apagada por defecto)", () => {
  it("arranca PLEGADA: se ofrece el acceso, pero la cámara no está montada", () => {
    render(<RecogerPaqueteCard porRecoger={porRecoger} onRecogida={vi.fn()} />);

    // El acceso a recoger sigue estando (nombra su propio acto, no el de otra pantalla).
    expect(
      screen.getByRole("button", { name: "Recoger paquete" }),
    ).toBeInTheDocument();
    // Pero nada del escáner está en el DOM todavía.
    expect(
      screen.queryByRole("region", { name: "Recoger por número de guía o escaneo" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Escanear con cámara" }),
    ).toBeNull();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("al cerrar, la tarjeta se DESMONTA: es lo que apaga la cámara", async () => {
    const user = userEvent.setup();
    await renderAbierta(user);

    // Cámara abierta dentro de la tarjeta, ya en el modal.
    await user.click(screen.getByRole("button", { name: "Escanear con cámara" }));
    await vi.waitFor(() => expect(decodeCallback.current).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    // Nada del escáner queda en el DOM: no es un `hidden`, es un desmontaje — que es lo
    // que dispara el cleanup de `QrScanner` y detiene html5-qrcode.
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Recoger por número de guía o escaneo" }),
      ).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Cerrar cámara" })).toBeNull();
    // Y el acceso sigue ahí: cerrar no es perder la forma de recoger.
    expect(
      screen.getByRole("button", { name: "Recoger paquete" }),
    ).toBeInTheDocument();
  });
});
