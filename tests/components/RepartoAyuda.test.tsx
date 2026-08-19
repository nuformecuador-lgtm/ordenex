// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RepartoModule } from "@/app/(app)/mis-asignaciones/_components/RepartoModule";
import {
  recuperarOrdenAyuda,
  solicitarAyudaOrden,
} from "@/lib/actions/orden-ayuda";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

// Pedido humano 2026-08-18 — SOLICITUD DE AYUDA en la pantalla de reparto del mensajero, en sus
// dos mitades: el cuarto botón del panel («Ayuda») y la SECCIÓN de abajo, que es donde van a
// parar las órdenes marcadas.
//
// Archivo aparte de `RepartoModule.test.tsx` a propósito: aquel mide la composición de la
// pantalla y ya es largo; esto mide una regla de reparto entre dos listas. El andamiaje de mocks
// es el mismo porque el módulo bajo prueba es el mismo — sin ellos, importar las Server Actions
// reales arrastraría Prisma a jsdom.

vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn(),
  gestionar: vi.fn(),
  liberarGestion: vi.fn(),
}));

vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
}));

vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi
    .fn()
    .mockResolvedValue({ status: "ok", notas: [], puedeEscribir: false }),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
}));

vi.mock("@/app/(app)/mis-asignaciones/_components/RutaMapa", () => ({
  RutaMapa: () => <div data-testid="ruta-mapa" />,
}));

vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn().mockResolvedValue({ status: "ok", omitida: false }),
}));

vi.mock("@/lib/actions/orden-mensajero-meta", () => ({
  marcarGestionarLuego: vi.fn(),
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

const solicitarMock = vi.mocked(solicitarAyudaOrden);
const recuperarMock = vi.mocked(recuperarOrdenAyuda);

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Perez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en porteria",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San Jose",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: null,
    ...over,
  };
}

const RUTA_VIGENTE: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: null,
  origenFuente: "gps",
  paradasSinOptimizar: 0,
  trazado: null,
  tramoSiguiente: null,
};

function renderModule(porGestionar: MiAsignacionDTO[]) {
  return render(
    <RepartoModule
      porGestionar={porGestionar}
      ordenEnGestionId={null}
      ruta={RUTA_VIGENTE}
      bloqueado={false}
    />,
  );
}

/** La sección de abajo, por su nombre accesible. `query` para poder afirmar que NO está. */
const seccionAyuda = () =>
  screen.queryByRole("region", { name: "Con ayuda solicitada" });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Reparto · el cuarto botón «Ayuda» del panel", () => {
  it("está junto a los otros tres gestos de la puerta y arranca sin marcar", () => {
    renderModule([makeAsignacion({ id: "g1" })]);

    const panel = screen.getByRole("region", { name: "Detalle de la orden" });
    // Los otros tres siguen ahí: este botón se AÑADE, no sustituye a ninguno.
    expect(within(panel).getByRole("link", { name: /^Llamar a / })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /^Abrir el chat con / })).toBeTruthy();

    const ayuda = within(panel).getByRole("button", {
      name: "Solicitar ayuda con la orden de Ana Perez",
    });
    expect(ayuda.textContent).toContain("Ayuda");
    expect(ayuda.textContent).not.toContain("Ayuda pedida");
  });

  it("con la solicitud ya viva se rotula «Ayuda pedida» y SIGUE pulsable (se puede añadir contexto)", () => {
    renderModule([makeAsignacion({ id: "g1", ayuda: true })]);

    const panel = screen.getByRole("region", { name: "Detalle de la orden" });
    const ayuda = within(panel).getByRole("button", {
      name: "Solicitar ayuda con la orden de Ana Perez",
    });
    expect(ayuda.textContent).toContain("Ayuda pedida");
    expect((ayuda as HTMLButtonElement).disabled).toBe(false);
  });

  it("no se puede confirmar sin motivo, y con motivo envía la orden y el texto recortado", async () => {
    const user = userEvent.setup();
    solicitarMock.mockResolvedValue({
      status: "ok",
      nota: {
        id: "n1",
        cuerpo: "Direccion no existe",
        autorNombre: "Mensajero",
        rolAutor: "mensajero",
        createdAt: "2026-08-18T10:00:00.000Z",
        esPropia: true,
        eliminada: false,
      },
    });
    renderModule([makeAsignacion({ id: "g1" })]);

    const panel = screen.getByRole("region", { name: "Detalle de la orden" });
    await user.click(
      within(panel).getByRole("button", {
        name: "Solicitar ayuda con la orden de Ana Perez",
      }),
    );

    const confirmar = screen.getByRole("button", { name: "Solicitar ayuda" });
    // El motivo es obligatorio: la regla se comunica deshabilitando, no regañando.
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText(/Motivo/), "  Direccion no existe  ");
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirmar);

    expect(solicitarMock).toHaveBeenCalledWith({
      ordenId: "g1",
      motivo: "Direccion no existe", // recortado antes de salir
    });
  });
});

describe("Reparto · las órdenes con ayuda se van abajo, a su propia sección", () => {
  it("sin ninguna marcada no aparece la sección: no se añade un encabezado vacío", () => {
    renderModule([makeAsignacion({ id: "g1" })]);
    expect(seccionAyuda()).toBeNull();
  });

  it("la marcada sale del listado principal y aparece abajo, una sola vez", () => {
    renderModule([
      makeAsignacion({ id: "g1", numRemision: "REM-001" }),
      makeAsignacion({ id: "g2", numRemision: "REM-002", ayuda: true }),
    ]);

    const principal = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    const seccion = seccionAyuda();
    expect(seccion).not.toBeNull();

    // La marcada vive DENTRO de la sección de abajo...
    expect(
      within(seccion as HTMLElement).getByRole("article", { name: /REM-002/ }),
    ).toBeTruthy();
    // ...y la otra NO: cada orden aparece en una sola de las dos listas.
    expect(
      within(seccion as HTMLElement).queryByRole("article", { name: /REM-001/ }),
    ).toBeNull();
    // El listado principal sigue mostrando la que avanza sola.
    expect(
      within(principal).getAllByRole("article", { name: /REM-001/ }).length,
    ).toBe(1);
  });

  it("con TODAS marcadas el listado principal lo dice, en vez de quedarse en blanco", () => {
    renderModule([makeAsignacion({ id: "g1", ayuda: true })]);

    expect(
      screen.getByText(
        "Todas tus órdenes en reparto tienen ayuda solicitada; están abajo.",
      ),
    ).toBeTruthy();
    expect(seccionAyuda()).not.toBeNull();
  });

  it("«Recuperar» retira la solicitud y hace releer el listado", async () => {
    const user = userEvent.setup();
    recuperarMock.mockResolvedValue({ status: "ok" });
    renderModule([
      makeAsignacion({ id: "g1", numRemision: "REM-001" }),
      makeAsignacion({ id: "g2", numRemision: "REM-002", ayuda: true }),
    ]);

    await user.click(
      screen.getByRole("button", {
        name: "Retirar la solicitud de ayuda de la orden REM-002",
      }),
    );

    expect(recuperarMock).toHaveBeenCalledWith({ ordenId: "g2" });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("un rechazo del borde NO se traga: se avisa y no se refresca por las dudas", async () => {
    const user = userEvent.setup();
    recuperarMock.mockResolvedValue({ status: "forbidden" });
    renderModule([makeAsignacion({ id: "g2", numRemision: "REM-002", ayuda: true })]);

    await user.click(
      screen.getByRole("button", {
        name: "Retirar la solicitud de ayuda de la orden REM-002",
      }),
    );

    expect(errorMock).toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // Pedido humano 2026-08-18 — «deja de ser la orden con gestión en curso y toma la siguiente».
  // El backend suelta el puntero 1-a-1; lo que se mide aquí es la otra mitad: que el panel no se
  // quede plantado en la orden que acaba de pedir ayuda, que es lo que pasaría si el default
  // siguiera siendo «la primera de la lista» a secas.
  it("el panel NO se queda en la orden marcada: toma la siguiente sin ayuda", () => {
    renderModule([
      makeAsignacion({
        id: "g1",
        numRemision: "REM-001",
        destinatario: "Ana Perez",
        ayuda: true,
      }),
      makeAsignacion({
        id: "g2",
        numRemision: "REM-002",
        destinatario: "Beto Solis",
      }),
    ]);

    const panel = screen.getByRole("region", { name: "Detalle de la orden" });
    expect(within(panel).getByText(/REM-002|Beto Solis/)).toBeTruthy();
    expect(within(panel).queryByText("Ana Perez")).toBeNull();
  });

  it("sin ninguna marcada el panel sigue tomando la PRIMERA: el default de siempre no cambió", () => {
    renderModule([
      makeAsignacion({ id: "g1", numRemision: "REM-001", destinatario: "Ana Perez" }),
      makeAsignacion({ id: "g2", numRemision: "REM-002", destinatario: "Beto Solis" }),
    ]);

    const panel = screen.getByRole("region", { name: "Detalle de la orden" });
    expect(within(panel).getByText("Ana Perez")).toBeTruthy();
  });

  it("con TODAS marcadas el panel muestra una igual: mejor una marcada que un panel vacío", () => {
    renderModule([
      makeAsignacion({ id: "g1", numRemision: "REM-001", destinatario: "Ana Perez", ayuda: true }),
    ]);

    const panel = screen.getByRole("region", { name: "Detalle de la orden" });
    expect(within(panel).getByText("Ana Perez")).toBeTruthy();
  });

  it("la orden con ayuda SIGUE siendo gestionable desde su card (no queda atrapada)", () => {
    renderModule([makeAsignacion({ id: "g2", numRemision: "REM-002", ayuda: true })]);

    const seccion = seccionAyuda() as HTMLElement;
    // Sin este botón, pedir ayuda dejaría la orden imposible de llevar al panel: desde el
    // rediseño la card ya no selecciona al tocarla.
    expect(
      within(seccion).getByRole("button", { name: /Gestionar/ }),
    ).toBeTruthy();
  });
});
