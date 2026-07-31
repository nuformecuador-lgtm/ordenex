// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecoleccionTiendaPanel } from "@/app/(app)/mis-asignaciones/_components/RecoleccionTiendaPanel";
import { recolectarEnTiendaPorQr } from "@/lib/actions/recoleccion-tienda";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 157 (R13-R24) — panel del mensajero para lo que recoge EN LA TIENDA. Lo que este
// archivo protege es tanto lo que el panel MUESTRA (agrupado por tienda, con su contacto)
// como lo que NO ofrece: aquí no hay gestión, ni cobro, ni evidencia, ni resultado que
// elegir. Un panel que empiece a parecerse al de gestión es un panel equivocado.

vi.mock("@/lib/actions/recoleccion-tienda", () => ({
  recolectarEnTiendaPorQr: vi.fn(),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastInfo = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    error: toastError,
    success: toastSuccess,
    info: toastInfo,
    warning: vi.fn(),
  }),
}));

// El escáner monta la cámara vía html5-qrcode, que jsdom no puede abrir.
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

const recolectarMock = vi.mocked(recolectarEnTiendaPorQr);

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-1",
    estatusValue: "por_recolectar_en_tienda",
    destinatario: "Ana",
    telefonoDest: "70001111",
    direccion: "Calle 1",
    producto: "Caja",
    peso: null,
    montoCobrar: 5000,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "Tienda Norte",
    tiendaTelefono: "88880000",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: null,
    secuenciaRuta: null,
    ...over,
  } as MiAsignacionDTO;
}

beforeEach(() => {
  vi.clearAllMocks();
  recolectarMock.mockResolvedValue({
    status: "ok",
    ordenId: "o1",
    estado: "en_ruta_bodega_central",
  });
});

afterEach(() => cleanup());

describe("RecoleccionTiendaPanel — qué muestra (R13/R14/R15)", () => {
  it("R14: agrupa por tienda, con una tarjeta por orden", () => {
    render(
      <RecoleccionTiendaPanel
        porRecolectar={[
          makeOrden({ id: "a", numGuia: 1, numRemision: "REM-A", tiendaNombre: "Tienda Norte" }),
          makeOrden({ id: "b", numGuia: 2, numRemision: "REM-B", tiendaNombre: "Tienda Norte" }),
          makeOrden({ id: "c", numGuia: 3, numRemision: "REM-C", tiendaNombre: "Tienda Sur" }),
        ]}
        onRecolectada={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Tienda Norte" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tienda Sur" })).toBeInTheDocument();
    expect(screen.getByText("REM-A")).toBeInTheDocument();
    expect(screen.getByText("REM-C")).toBeInTheDocument();
  });

  it("R15: llama a la TIENDA, no al destinatario", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(
      <RecoleccionTiendaPanel
        porRecolectar={[makeOrden({ tiendaTelefono: "88880000", telefonoDest: "70001111" })]}
        onRecolectada={vi.fn()}
      />,
    );

    // El interlocutor de una recolección es la tienda: el nombre del control lo dice y el
    // número marcado es el suyo, no el del destinatario final (que aquí no pinta nada).
    await user.click(screen.getByRole("button", { name: "Llamar a Tienda Norte" }));

    expect(open).toHaveBeenCalledWith("tel:88880000", "_self");
    vi.unstubAllGlobals();
  });

  it("R15: una tienda sin teléfono no pinta botones de contacto muertos", () => {
    render(
      <RecoleccionTiendaPanel
        porRecolectar={[makeOrden({ tiendaTelefono: null })]}
        onRecolectada={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Llamar a/ })).toBeNull();
  });

  it("R16: NO ofrece ningún control de gestión (ni cobro, ni evidencia, ni resultados)", () => {
    render(
      <RecoleccionTiendaPanel porRecolectar={[makeOrden()]} onRecolectada={vi.fn()} />,
    );

    // Los 4 resultados de la gestión, el método de pago y la evidencia son de OTRO flujo.
    for (const nombre of [/entregada/i, /reprogramar/i, /devolver/i, /rechazar/i]) {
      expect(screen.queryByRole("button", { name: nombre })).toBeNull();
    }
    expect(screen.queryByText(/método de pago/i)).toBeNull();
    expect(screen.queryByText(/valor a cobrar/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("sin nada que recolectar el apartado no se muestra", () => {
    const { container } = render(
      <RecoleccionTiendaPanel porRecolectar={[]} onRecolectada={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("RecoleccionTiendaPanel — confirmar la recolección (R17/R20/R21/R24)", () => {
  it("R17: la vía manual confirma la guía y avisa al padre para revalidar", async () => {
    const user = userEvent.setup();
    const onRecolectada = vi.fn();
    render(
      <RecoleccionTiendaPanel
        porRecolectar={[makeOrden({ numGuia: 1001 })]}
        onRecolectada={onRecolectada}
      />,
    );

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() => expect(recolectarMock).toHaveBeenCalledWith({ numGuia: 1001 }));
    expect(onRecolectada).toHaveBeenCalled();
  });

  it("R21: una guía que NO es suya se rechaza en cliente, sin llamar a la action", async () => {
    const user = userEvent.setup();
    render(
      <RecoleccionTiendaPanel
        porRecolectar={[makeOrden({ numGuia: 1001 })]}
        onRecolectada={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox"), "9999");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(recolectarMock).not.toHaveBeenCalled();
  });

  it("R20: un código que no son dígitos no llega a la action", async () => {
    const user = userEvent.setup();
    render(
      <RecoleccionTiendaPanel
        porRecolectar={[makeOrden({ numGuia: 1001 })]}
        onRecolectada={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox"), "abc");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    expect(recolectarMock).not.toHaveBeenCalled();
  });

  it("R24: con un cierre pendiente la lista se ve pero no hay forma de mover nada", () => {
    render(
      <RecoleccionTiendaPanel
        porRecolectar={[makeOrden({ numRemision: "REM-A" })]}
        bloqueado
        onRecolectada={vi.fn()}
      />,
    );

    expect(screen.getByText("REM-A")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Confirmar recolección" }),
    ).toBeNull();
  });

  it("R23: escanear dos veces la misma etiqueta informa, no dice que sea un error", async () => {
    const user = userEvent.setup();
    recolectarMock.mockResolvedValue({ status: "ya_recolectada" });
    const onRecolectada = vi.fn();
    render(
      <RecoleccionTiendaPanel
        porRecolectar={[makeOrden({ numGuia: 1001 })]}
        onRecolectada={onRecolectada}
      />,
    );

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
    // Idempotente: la lista se revalida igual, porque esa orden ya no va aquí.
    expect(onRecolectada).toHaveBeenCalled();
  });
});
