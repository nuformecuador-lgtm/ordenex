// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotaPrivadaMensajero } from "@/app/(app)/mis-asignaciones/_components/NotaPrivadaMensajero";
import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import { MisAsignacionesModule } from "@/app/(app)/mis-asignaciones/_components/MisAsignacionesModule";
import {
  guardarNotaPrivada,
  limpiarNotaPrivada,
} from "@/lib/actions/notas-privadas-mensajero";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 116 (Bloque F) — editor de la NOTA PRIVADA del mensajero (F1), su inserción en el
// detalle como HERMANO de `AsignacionDetalle` (F2) y el indicador en la card (F3). Se mockean
// las Server Actions (`"use server"` con Prisma), el toast y el router para probar la UI sin DB
// ni sesión. Para R7 se monta el panel real; para R12, el módulo real.
vi.mock("@/lib/actions/notas-privadas-mensajero", () => ({
  guardarNotaPrivada: vi.fn(),
  limpiarNotaPrivada: vi.fn(),
}));

// El panel/módulo arrastran otras Server Actions (`"use server"`) y el mapa Leaflet; se mockean
// igual que en `MisAsignacionesModule.test.tsx` para poder montarlos en jsdom.
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn().mockResolvedValue({ status: "ok", ordenId: "g1" }),
  gestionar: vi.fn(),
  liberarGestion: vi.fn().mockResolvedValue({ status: "ok" }),
}));
vi.mock("@/lib/actions/orden-mensajero-meta", () => ({
  marcarGestionarLuego: vi
    .fn()
    .mockResolvedValue({ status: "ok", ordenId: "g1", marcarLuego: true }),
}));
vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn().mockResolvedValue({ status: "ok", omitida: false }),
}));
vi.mock("@/app/(app)/mis-asignaciones/_components/RutaMapa", () => ({
  RutaMapa: () => <div data-testid="ruta-mapa" />,
}));

const { successMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const guardarMock = vi.mocked(guardarNotaPrivada);
const limpiarMock = vi.mocked(limpiarNotaPrivada);

/**
 * Card (`<article>` de `PosOrderCard`) de una remisión. El rediseño POS dejó el
 * `<article>` sin nombre accesible, así que se llega a él desde su CTA interno.
 */
function cardDe(numRemision: string): HTMLElement {
  const cta = screen.getByRole("button", {
    name: new RegExp(`Gestionar orden ${numRemision}`),
  });
  const card = cta.closest("article");
  if (card === null) throw new Error(`sin <article> para ${numRemision}`);
  return card;
}

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    secuenciaRuta: null,
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_ruta",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: null,
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    marcarLuego: false,
    notaPrivada: null,
    ...over,
  };
}

const RUTA_VIGENTE: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: null,
  origenFuente: "gps",
  paradasSinOptimizar: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  guardarMock.mockResolvedValue({ status: "ok", nota: "texto" });
  limpiarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  cleanup();
});

describe("NotaPrivadaMensajero — editor (F1 / R11)", () => {
  it("R11: con notaInicial muestra el texto y ofrece Guardar y Limpiar (habilitado)", () => {
    render(
      <NotaPrivadaMensajero ordenId="o1" notaInicial="Recordar timbre azul" />,
    );

    // El editor es un textbox etiquetado "Mi nota" (distinto de la "Notas" de tienda).
    const editor = screen.getByRole("textbox", { name: "Mi nota" });
    expect(editor).toHaveValue("Recordar timbre azul");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeEnabled();
  });

  it("R11: con notaInicial=null muestra el editor VACÍO y Limpiar deshabilitado", () => {
    render(<NotaPrivadaMensajero ordenId="o1" notaInicial={null} />);

    expect(screen.getByRole("textbox", { name: "Mi nota" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeDisabled();
  });
});

describe("NotaPrivadaMensajero — persistencia server-driven (F1 / R14)", () => {
  it("R14: Guardar llama guardarNotaPrivada, avisa con toast y refresca (relee del server)", async () => {
    const user = userEvent.setup();
    guardarMock.mockResolvedValue({ status: "ok", nota: "Nota nueva" });
    render(<NotaPrivadaMensajero ordenId="o1" notaInicial={null} />);

    await user.type(
      screen.getByRole("textbox", { name: "Mi nota" }),
      "Nota nueva",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() =>
      expect(guardarMock).toHaveBeenCalledWith({
        ordenId: "o1",
        nota: "Nota nueva",
      }),
    );
    // R14: el refresh relee el DTO del server (persistente ante recarga), no solo memoria.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(successMock).toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("R14: Limpiar llama limpiarNotaPrivada, refresca y vacía el editor (Limpiar queda deshabilitado)", async () => {
    const user = userEvent.setup();
    limpiarMock.mockResolvedValue({ status: "ok" });
    render(<NotaPrivadaMensajero ordenId="o9" notaInicial="Algo escrito" />);

    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    await vi.waitFor(() =>
      expect(limpiarMock).toHaveBeenCalledWith({ ordenId: "o9" }),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Mi nota" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeDisabled();
    expect(successMock).toHaveBeenCalled();
  });

  it("R14/R5 (UI): Guardar en blanco → el server responde nota=null y el editor queda vacío", async () => {
    const user = userEvent.setup();
    // notaInicial con solo espacios: el server (R5) lo trata como limpiar y devuelve nota=null.
    guardarMock.mockResolvedValue({ status: "ok", nota: null });
    render(<NotaPrivadaMensajero ordenId="o1" notaInicial="   " />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() =>
      expect(guardarMock).toHaveBeenCalledWith({ ordenId: "o1", nota: "   " }),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Mi nota" })).toHaveValue("");
  });

  it("un rechazo (forbidden) avisa con toast.error y NO refresca", async () => {
    const user = userEvent.setup();
    guardarMock.mockResolvedValue({ status: "forbidden" });
    render(<NotaPrivadaMensajero ordenId="o1" notaInicial="x" />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sin sesión (unauthenticated) avisa de sesión expirada y NO refresca", async () => {
    const user = userEvent.setup();
    guardarMock.mockResolvedValue({ status: "unauthenticated" });
    render(<NotaPrivadaMensajero ordenId="o1" notaInicial="x" />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringMatching(/sesión expiró/i),
      ),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R17 (UI): el toast de error NO filtra el contenido de la nota (sin PII)", async () => {
    const user = userEvent.setup();
    const secreto = "telefono-privado-88887777";
    guardarMock.mockResolvedValue({ status: "forbidden" });
    render(<NotaPrivadaMensajero ordenId="o1" notaInicial={secreto} />);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0]?.[0]).not.toContain(secreto);
  });

  it("dos clicks seguidos en Guardar NO disparan dos llamadas (cerrojo anti-doble-click)", async () => {
    const user = userEvent.setup();
    let resolver: (v: { status: "ok"; nota: string | null }) => void = () => {};
    guardarMock.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    render(<NotaPrivadaMensajero ordenId="o1" notaInicial="x" />);

    const boton = screen.getByRole("button", { name: "Guardar" });
    await user.click(boton);
    await user.click(boton);

    expect(guardarMock).toHaveBeenCalledTimes(1);
    resolver({ status: "ok", nota: "x" });
  });
});

describe("Inserción en el detalle: 'Notas' (tienda) vs 'Mi nota' (privada) (F2 / R7)", () => {
  it("R7: el panel muestra DOS campos DISTINTOS y etiquetados: 'Notas' (tienda) y 'Mi nota' (privada)", () => {
    // `yaActiva` arranca el panel en los 4 botones y omite el paso "detalle" (chat/plantilla),
    // pero `AsignacionDetalle` y el editor de nota se renderizan SIEMPRE. Aquí se prueba que
    // conviven separados: la nota de tienda como presentación, la privada como editor.
    render(
      <GestionarOrdenPanel
        orden={makeAsignacion({
          id: "g1",
          notas: "Dejar en portería",
          notaPrivada: "Timbre no sirve, tocar el portón",
        })}
        yaActiva
        onGestionarPedido={vi.fn().mockResolvedValue(true)}
        onCancelarGestion={vi.fn()}
        onSuccess={vi.fn()}
        // Total de órdenes en reparto ("N de total" de la cabecera): una sola aquí.
        count={1}
      />,
    );

    // Nota de TIENDA: etiqueta "Notas" + su valor, dentro del detalle de presentación pura.
    expect(screen.getByText("Notas")).toBeInTheDocument();
    expect(screen.getByText("Dejar en portería")).toBeInTheDocument();

    // Nota PRIVADA: editor etiquetado "Mi nota" (un textbox), separado y editable.
    const editor = screen.getByRole("textbox", { name: "Mi nota" });
    expect(editor).toHaveValue("Timbre no sirve, tocar el portón");

    // Son campos DISTINTOS: la nota de tienda NO vive dentro del editor y "Notas" no es editable.
    expect(editor).not.toHaveValue("Dejar en portería");
    expect(screen.queryByRole("textbox", { name: "Notas" })).toBeNull();
  });
});

describe("Indicador de nota privada en la card (F3 / R12)", () => {
  it("R12: la card con notaPrivada muestra el indicador con preview; sin nota, no", () => {
    // `bloqueado` mantiene la VISTA COMPLETA con las cards (deshabilitadas, feature 113/R3) pero
    // SIN montar el panel de detalle: aísla el indicador de la card del editor del panel.
    render(
      <MisAsignacionesModule
        porRecoger={[]}
        porGestionar={[
          makeAsignacion({
            id: "g1",
            numRemision: "REM-CON",
            notaPrivada: "Cliente pidió llamar antes",
          }),
          makeAsignacion({
            id: "g2",
            numRemision: "REM-SIN",
            notaPrivada: null,
          }),
        ]}
        ordenEnGestionId={null}
        ruta={RUTA_VIGENTE}
        bloqueado
      />,
    );

    // Card CON nota: badge "Mi nota" + preview truncado (1 línea) con el texto.
    // Rediseño POS: la card es el `<article>` de `PosOrderCard` y el botón
    // "Gestionar orden" es su CTA interno, así que se acota al article.
    const cardCon = cardDe("REM-CON");
    expect(within(cardCon).getByText("Mi nota")).toBeInTheDocument();
    expect(
      within(cardCon).getByText("Cliente pidió llamar antes"),
    ).toBeInTheDocument();

    // Card SIN nota: no aparece el indicador.
    expect(within(cardDe("REM-SIN")).queryByText("Mi nota")).toBeNull();
  });
});
