// @vitest-environment jsdom
//
// EL GLOBO DE WHATSAPP DE `/novedades` YA NO ABRE UN CHAT VACIO (pedido humano 2026-08-27).
// Lista las plantillas, ENSENA como queda cada una con los datos de ESTA orden, y al elegir
// abre WhatsApp con el texto ya escrito: quien atiende la novedad solo tiene que darle enviar.
//
// Lo que se mide aqui, y que ningun test del modulo cubria:
//
//   1. El boton no cambia de identidad. Mismo `aria-label` («WhatsApp a <nombre>») que cuando
//      era un enlace wa.me pelado, porque para quien mira la fila es el MISMO boton. Que los
//      censos de `NovedadAcciones.test.tsx` sigan verdes no es casualidad: es el requisito.
//   2. La vista previa esta RESUELTA con los datos de la orden. Ver `{{destinatario}}` crudo
//      seria peor que no ver nada: el usuario elegiria a ciegas y descubriria el texto real ya
//      dentro de WhatsApp, que es justo donde no se puede corregir.
//   3. La URL lleva el telefono NORMALIZADO (prefijo 506) y el texto en `?text=`. Sin el
//      prefijo, wa.me abre un chat con un numero que no existe.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NovedadAcciones } from "@/app/(app)/novedades/_components/NovedadAcciones";
import type { NovedadDTO } from "@/lib/types/novedad";

const listarPlantillasParaEnvioMock = vi.fn();
const listarPlantillasParaEnvioTiendaMock = vi.fn();
vi.mock("@/lib/actions/whatsapp-envio", () => ({
  listarPlantillasParaEnvio: (...a: unknown[]) => listarPlantillasParaEnvioMock(...a),
  listarPlantillasParaEnvioTienda: (...a: unknown[]) =>
    listarPlantillasParaEnvioTiendaMock(...a),
}));

vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const DESTINATARIO = "Ana Cliente";

function novedad(over: Partial<NovedadDTO> = {}): NovedadDTO {
  return {
    id: "o1",
    numGuia: 12345,
    numRemision: "REM-001",
    estatusValue: "devuelta",
    intentosContacto: 0,
    mensajeroNombre: "Marta Mensajera",
    destinatario: DESTINATARIO,
    telefonoDest: "88887777",
    direccion: "Av. Central 120",
    producto: "Zapatos",
    peso: 1.5,
    montoCobrar: 24500,
    latitud: 9.9281,
    longitud: -84.0907,
    notas: null,
    tiendaNombre: "Tienda Demo",
    zonaNombre: "GAM Oeste",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    secuenciaRuta: null,
    causa: "not_found",
    intentosEntrega: 2,
    ...over,
  };
}

const handlers = {
  onReprogramar: vi.fn(),
  onHabilitar: vi.fn(),
  onRechazar: vi.fn(),
  onConversacion: vi.fn(),
  onGestionarDesdeAyuda: vi.fn(),
  // Ficha 312 (F2): el panel gana la celda «Corregir datos» en los dos grupos. Este archivo no la
  // ejerce —mide el globo de WhatsApp—, pero la prop es obligatoria: un handler que falte deja de
  // compilar, que es justo lo que se quiere de una acción de la fila.
  onCorregirDatos: vi.fn(),
};

function renderAcciones(over: Partial<NovedadDTO> = {}) {
  return render(<NovedadAcciones novedad={novedad(over)} {...handlers} />);
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  const respuesta = {
    status: "ok",
    items: [
      {
        id: "pl-1",
        nombre: "Aviso de entrega",
        cuerpo: "Hola {{destinatario}}, tu pedido {{producto}} llega hoy.",
        variables: ["destinatario", "producto"],
      },
      {
        id: "pl-2",
        nombre: "Reprogramación",
        cuerpo: "Hola {{destinatario}}, no pudimos entregarte.",
        variables: ["destinatario"],
      },
    ],
  };
  // Las DOS resuelven igual: lo que este archivo mide sobre la eleccion de accion es CUAL se
  // llama (ver el caso de abajo), no que devuelvan cosas distintas.
  listarPlantillasParaEnvioMock.mockResolvedValue(respuesta);
  listarPlantillasParaEnvioTiendaMock.mockResolvedValue(respuesta);
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  openSpy.mockRestore();
});

describe("/novedades — el globo de WhatsApp abre las plantillas", () => {
  it("lista las plantillas con el mensaje YA RESUELTO para esta orden", async () => {
    const user = userEvent.setup();
    renderAcciones();

    await user.click(screen.getByRole("button", { name: `WhatsApp a ${DESTINATARIO}` }));

    const hoja = await screen.findByRole("dialog");
    expect(await within(hoja).findByText("Aviso de entrega")).toBeInTheDocument();
    expect(within(hoja).getByText("Reprogramación")).toBeInTheDocument();
    // Resuelta, no cruda: ni `{{destinatario}}` ni `{{producto}}` llegan a pantalla.
    expect(
      within(hoja).getByText("Hola Ana Cliente, tu pedido Zapatos llega hoy."),
    ).toBeInTheDocument();
  });

  it("al elegir una abre wa.me con el teléfono normalizado y el texto puesto", async () => {
    const user = userEvent.setup();
    renderAcciones();

    await user.click(screen.getByRole("button", { name: `WhatsApp a ${DESTINATARIO}` }));
    const hoja = await screen.findByRole("dialog");
    await user.click(await within(hoja).findByText("Aviso de entrega"));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, destino] = openSpy.mock.calls[0];
    expect(destino).toBe("_blank");
    expect(url).toBe(
      `https://wa.me/50688887777?text=${encodeURIComponent(
        "Hola Ana Cliente, tu pedido Zapatos llega hoy.",
      )}`,
    );
  });

  // La regresión que más duele si vuelve: que el globo se quede abriendo el chat vacío. Antes
  // llamaba a `window.open` NADA MÁS pulsarlo; ahora pulsar solo abre la hoja.
  it("pulsar el globo ya no abre WhatsApp por sí solo", async () => {
    const user = userEvent.setup();
    renderAcciones();

    await user.click(screen.getByRole("button", { name: `WhatsApp a ${DESTINATARIO}` }));
    await screen.findByRole("dialog");

    expect(openSpy).not.toHaveBeenCalled();
  });

  // LA SUPERFICIE DECIDE EL ALCANCE. `/novedades` es la unica pantalla donde se pueden usar
  // las plantillas para envio de la tienda, asi que pide la accion que las incluye. Si algun
  // dia alguien cablea aqui la del mensajero, las de tienda desaparecen sin que falle nada
  // mas: por eso se afirma la accion concreta y no solo el resultado.
  it("pide la lista que INCLUYE las plantillas de tienda, no la del mensajero", async () => {
    const user = userEvent.setup();
    renderAcciones();

    await user.click(screen.getByRole("button", { name: `WhatsApp a ${DESTINATARIO}` }));
    await screen.findByRole("dialog");

    expect(listarPlantillasParaEnvioTiendaMock).toHaveBeenCalledTimes(1);
    expect(listarPlantillasParaEnvioMock).not.toHaveBeenCalled();
  });

  // «Llamar» no se toca: sigue marcando, y sigue siendo un botón distinto del globo.
  it("«Llamar» conserva su comportamiento", async () => {
    const user = userEvent.setup();
    renderAcciones();

    await user.click(screen.getByRole("button", { name: `Llamar a ${DESTINATARIO}` }));

    expect(openSpy).toHaveBeenCalledWith("tel:88887777", "_self");
  });
});
