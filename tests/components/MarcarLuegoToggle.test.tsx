// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MarcarLuegoToggle } from "@/app/(app)/mis-asignaciones/_components/MarcarLuegoToggle";
import { MisAsignacionesModule } from "@/app/(app)/mis-asignaciones/_components/MisAsignacionesModule";
import { marcarGestionarLuego } from "@/lib/actions/orden-mensajero-meta";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 115 (T8) — control de "gestionar más tarde" en la card del mensajero. Se mockea la
// Server Action (`"use server"` con Prisma detrás), el toast y el router para probar el envío
// (R5/R6) sin DB ni sesión. Para R18 (badge) / R19 (orden visual) se monta el módulo real.
vi.mock("@/lib/actions/orden-mensajero-meta", () => ({
  marcarGestionarLuego: vi.fn(),
}));

// El módulo (para R18/R19) arrastra otras Server Actions y el mapa Leaflet: se mockean igual
// que en `MisAsignacionesModule.test.tsx` para poder montarlo en jsdom.
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn().mockResolvedValue({ status: "ok", ordenId: "g1" }),
  gestionar: vi.fn(),
  liberarGestion: vi.fn().mockResolvedValue({ status: "ok" }),
}));
vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn().mockResolvedValue({ status: "ok", omitida: false }),
}));
vi.mock("@/app/(app)/mis-asignaciones/_components/RutaMapa", () => ({
  RutaMapa: () => <div data-testid="ruta-mapa" />,
}));

const { successMock, errorMock, warningMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  warningMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: warningMock,
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const marcarMock = vi.mocked(marcarGestionarLuego);

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    secuenciaRuta: null,
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
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
    ...over,
  };
}

const RUTA_VIGENTE: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: null,
  origenFuente: "gps",
  paradasSinOptimizar: 0,
};

function renderModule(porGestionar: MiAsignacionDTO[]) {
  render(
    <MisAsignacionesModule
      porRecoger={[]}
      porGestionar={porGestionar}
      ordenEnGestionId={null}
      ruta={RUTA_VIGENTE}
      bloqueado={false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  marcarMock.mockResolvedValue({
    status: "ok",
    ordenId: "g1",
    marcarLuego: true,
  });
});

afterEach(() => {
  cleanup();
});

describe("MarcarLuegoToggle (feature 115 / T8)", () => {
  // ---------------- R5/R6: el toggle envía el valor NEGADO del actual ----------------

  it("R5: sobre una orden NO marcada, marca -> llama la action con marcarLuego=true y refresca", async () => {
    const user = userEvent.setup();
    render(
      <MarcarLuegoToggle ordenId="o1" marcada={false} numRemision="REM-1" />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Marcar la orden REM-1 para gestionar más tarde",
      }),
    );

    await vi.waitFor(() =>
      expect(marcarMock).toHaveBeenCalledWith({
        ordenId: "o1",
        marcarLuego: true,
      }),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // Happy path: sin toast.
    expect(errorMock).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
  });

  it("R6: sobre una orden YA marcada, quita -> llama la action con marcarLuego=false y refresca", async () => {
    const user = userEvent.setup();
    marcarMock.mockResolvedValue({
      status: "ok",
      ordenId: "o1",
      marcarLuego: false,
    });
    render(
      <MarcarLuegoToggle ordenId="o1" marcada={true} numRemision="REM-1" />,
    );

    // El control es un toggle accesible: refleja el estado con aria-pressed.
    const boton = screen.getByRole("button", {
      name: "Quitar la marca «gestionar más tarde» de la orden REM-1",
    });
    expect(boton).toHaveAttribute("aria-pressed", "true");

    await user.click(boton);

    await vi.waitFor(() =>
      expect(marcarMock).toHaveBeenCalledWith({
        ordenId: "o1",
        marcarLuego: false,
      }),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("un rechazo del server (forbidden) avisa con toast.error y NO refresca", async () => {
    const user = userEvent.setup();
    marcarMock.mockResolvedValue({ status: "forbidden" });
    render(
      <MarcarLuegoToggle ordenId="o1" marcada={false} numRemision="REM-1" />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Marcar la orden REM-1 para gestionar más tarde",
      }),
    );

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("dos clicks seguidos NO disparan dos llamadas (cerrojo anti-doble-click)", async () => {
    const user = userEvent.setup();
    let resolver: (v: { status: "ok"; ordenId: string; marcarLuego: boolean }) => void =
      () => {};
    marcarMock.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    render(
      <MarcarLuegoToggle ordenId="o1" marcada={false} numRemision="REM-1" />,
    );

    const boton = screen.getByRole("button", {
      name: "Marcar la orden REM-1 para gestionar más tarde",
    });
    await user.click(boton);
    await user.click(boton);

    expect(marcarMock).toHaveBeenCalledTimes(1);
    resolver({ status: "ok", ordenId: "o1", marcarLuego: true });
  });

  // ---------------- R18: badge en la card marcada ----------------

  it("R18: la card marcada muestra el badge 'Gestionar más tarde'; la no marcada no", () => {
    renderModule([
      makeAsignacion({ id: "g1", numRemision: "REM-G1", marcarLuego: true }),
      makeAsignacion({ id: "g2", numRemision: "REM-G2", marcarLuego: false }),
    ]);

    // El badge vive DENTRO del `<button>` de la card (el toggle "Gestionar más tarde" es un
    // hermano fuera del botón), así que `within(card)` aísla el badge sin capturar el toggle.
    const cardMarcada = screen.getByRole("button", {
      name: /Gestionar orden REM-G1/,
    });
    expect(
      within(cardMarcada).getByText("Gestionar más tarde"),
    ).toBeInTheDocument();

    const cardNoMarcada = screen.getByRole("button", {
      name: /Gestionar orden REM-G2/,
    });
    expect(
      within(cardNoMarcada).queryByText("Gestionar más tarde"),
    ).toBeNull();
  });

  // ---------------- R19: orden visual (hunde las marcadas al final) ----------------

  it("R19: las órdenes marcadas se muestran DESPUÉS de las no marcadas, sin cambiar la secuencia de ruta", () => {
    // El server ya manda el orden de ruta: g1(1), g2(2), g3(3). g1 está marcada.
    renderModule([
      makeAsignacion({
        id: "g1",
        numRemision: "REM-G1",
        secuenciaRuta: 1,
        marcarLuego: true,
      }),
      makeAsignacion({
        id: "g2",
        numRemision: "REM-G2",
        secuenciaRuta: 2,
        marcarLuego: false,
      }),
      makeAsignacion({
        id: "g3",
        numRemision: "REM-G3",
        secuenciaRuta: 3,
        marcarLuego: false,
      }),
    ]);

    const cards = screen
      .getAllByRole("button", { name: /Gestionar orden REM-G/ })
      .map((b) => b.getAttribute("aria-label"));

    // Presentación: la marcada (g1) baja al final; g2 y g3 conservan su orden de ruta.
    expect(cards).toEqual([
      "Gestionar orden REM-G2 · Ana Pérez",
      "Gestionar orden REM-G3 · Ana Pérez",
      "Gestionar orden REM-G1 · Ana Pérez",
    ]);

    // R16/R19: la secuencia de ruta NO se altera — g1 sigue siendo la parada 1.
    expect(screen.getByText("Parada 1 de la ruta")).toBeInTheDocument();
    expect(screen.getByText("Parada 2 de la ruta")).toBeInTheDocument();
    expect(screen.getByText("Parada 3 de la ruta")).toBeInTheDocument();
  });

  it("R19: sin órdenes marcadas, el orden de ruta del server se conserva intacto", () => {
    renderModule([
      makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 }),
      makeAsignacion({ id: "g2", numRemision: "REM-G2", secuenciaRuta: 2 }),
    ]);

    const cards = screen
      .getAllByRole("button", { name: /Gestionar orden REM-G/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(cards).toEqual([
      "Gestionar orden REM-G1 · Ana Pérez",
      "Gestionar orden REM-G2 · Ana Pérez",
    ]);
  });
});
