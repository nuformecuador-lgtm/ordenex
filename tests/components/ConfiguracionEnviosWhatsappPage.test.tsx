// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

// Ficha 474 (R1) — las cuatro páginas de `/configuracion/envios-whatsapp` resuelven el rol SOLO en el
// servidor: otro rol (o sin sesión) ve «sin permiso» en vez del módulo y NO se llama a ninguna
// acción que lea envíos. El maestro sí recibe el módulo con sus datos.

vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

const resolveActorMock = vi.fn();
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));

const acciones = {
  listarEnvios: vi.fn(),
  obtenerEnvio: vi.fn(),
  listarEjecuciones: vi.fn(),
  listarInformesWhatsapp: vi.fn(),
  listarEventosDisponibles: vi.fn(),
  previsualizarDestinatarios: vi.fn(),
};
vi.mock("@/lib/actions/envios-whatsapp", () => ({
  listarEnvios: (...a: unknown[]) => acciones.listarEnvios(...a),
  obtenerEnvio: (...a: unknown[]) => acciones.obtenerEnvio(...a),
  listarEjecuciones: (...a: unknown[]) => acciones.listarEjecuciones(...a),
  listarInformesWhatsapp: (...a: unknown[]) => acciones.listarInformesWhatsapp(...a),
  listarEventosDisponibles: (...a: unknown[]) => acciones.listarEventosDisponibles(...a),
  previsualizarDestinatarios: (...a: unknown[]) => acciones.previsualizarDestinatarios(...a),
}));
const listarPlantillasMock = vi.fn();
vi.mock("@/lib/actions/plantillas", () => ({
  listarPlantillas: (...a: unknown[]) => listarPlantillasMock(...a),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const moduloProps: unknown[] = [];
vi.mock("@/app/(app)/configuracion/envios-whatsapp/_components/EnviosModule", () => ({
  EnviosModule: (p: unknown) => {
    moduloProps.push(p);
    return <div data-testid="envios-module" />;
  },
}));
vi.mock("@/app/(app)/configuracion/envios-whatsapp/_components/EnvioForm", () => ({
  EnvioForm: (p: unknown) => {
    moduloProps.push(p);
    return <div data-testid="envio-form" />;
  },
}));
vi.mock("@/app/(app)/configuracion/envios-whatsapp/_components/HistorialEnvios", () => ({
  HistorialEnvios: (p: unknown) => {
    moduloProps.push(p);
    return <div data-testid="historial" />;
  },
}));

async function paginas() {
  const lista = (await import("@/app/(app)/configuracion/envios-whatsapp/page")).default;
  const nuevo = (await import("@/app/(app)/configuracion/envios-whatsapp/nuevo/page")).default;
  const editar = (await import("@/app/(app)/configuracion/envios-whatsapp/[id]/page")).default;
  const historial = (await import("@/app/(app)/configuracion/envios-whatsapp/historial/page")).default;
  return {
    lista: () => lista(),
    nuevo: () => nuevo(),
    editar: () => editar({ params: Promise.resolve({ id: "e1" }) }),
    historial: () => historial({ searchParams: Promise.resolve({}) }),
  };
}

const ENVIO = {
  id: "e1",
  nombre: "Prueba diaria",
  informeClave: "prueba_envio",
  informeNombre: "Prueba de envío",
  plantillaId: "p1",
  plantillaNombre: "prueba_doc",
  disparo: "hora_fija",
  diasSemana: [1],
  hora: "05:00",
  eventoClave: null,
  eventoNombre: null,
  activo: false,
  proximaEjecucion: null,
  avisoSinProxima: false,
  ultimaEjecucion: null,
  parametros: {},
  destinatarios: { roles: [], usuarioIds: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  moduloProps.length = 0;
  acciones.listarEnvios.mockResolvedValue({ status: "ok", items: [ENVIO] });
  acciones.obtenerEnvio.mockResolvedValue({ status: "ok", envio: ENVIO });
  acciones.listarEjecuciones.mockResolvedValue({ status: "ok", items: [], page: 1, pageSize: 20, total: 0 });
  acciones.listarInformesWhatsapp.mockResolvedValue({ status: "ok", informes: [] });
  acciones.listarEventosDisponibles.mockResolvedValue({ status: "ok", eventos: [] });
  acciones.previsualizarDestinatarios.mockResolvedValue({
    status: "ok",
    preview: { destinatarios: [], total: 0, avisos: [], excedeTope: false, tope: 50 },
  });
  listarPlantillasMock.mockResolvedValue({ status: "ok", items: [], page: 1, pageSize: 100, total: 0 });
});

afterEach(() => cleanup());

describe("R1 — solo el maestro entra en Envíos automáticos", () => {
  const otros: (RolValue | null)[] = ["admin", "adminTienda", "adminSatelite", "mensajero", "apiKey", null];

  for (const nombre of ["lista", "nuevo", "editar", "historial"] as const) {
    it(`${nombre}: otro rol o sin sesión ve «sin permiso» y no se lee nada`, async () => {
      const p = await paginas();
      for (const rol of otros) {
        resolveActorMock.mockResolvedValue(rol ? { usuarioId: "x", rol } : null);
        render(await p[nombre]());
        expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para acceder a esta sección.");
        cleanup();
      }
      expect(moduloProps).toHaveLength(0);
      for (const f of Object.values(acciones)) expect(f).not.toHaveBeenCalled();
      expect(listarPlantillasMock).not.toHaveBeenCalled();
    });
  }

  it("el maestro ve la lista con los envíos pre-cargados", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const p = await paginas();
    render(await p.lista());
    expect(screen.getByTestId("envios-module")).toBeInTheDocument();
    expect(moduloProps[0]).toEqual({ initialItems: [ENVIO] });
    expect(screen.getByRole("link", { name: "+ Nuevo envío" })).toHaveAttribute("href", "/configuracion/envios-whatsapp/nuevo");
  });

  it("el formulario de alta recibe solo plantillas DE INFORME aprobadas (R12)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const base = { cuerpo: "Hola", variables: [], variablesNombres: {}, welcomeMessage: false, plantillaTienda: false, createdAt: new Date() };
    // Dos páginas: la aprobada está en la SEGUNDA, así que recorrer solo la primera la perdería.
    listarPlantillasMock
      .mockResolvedValueOnce({
        status: "ok",
        total: 4,
        page: 1,
        pageSize: 100,
        items: [
          { ...base, id: "orden", nombre: "de_orden", estado: "activo", templateId: "t2", informeClave: null },
          { ...base, id: "sin_meta", nombre: "sin_meta", estado: "activo", templateId: null, informeClave: "prueba_envio" },
        ],
      })
      .mockResolvedValueOnce({
        status: "ok",
        total: 4,
        page: 2,
        pageSize: 100,
        items: [
          { ...base, id: "pend", nombre: "pendiente", estado: "pending", templateId: "t3", informeClave: "prueba_envio" },
          { ...base, id: "ok", nombre: "aprobada", estado: "activo", templateId: "t1", informeClave: "prueba_envio", llevaDocumento: true },
        ],
      });
    const p = await paginas();
    render(await p.nuevo());
    expect(listarPlantillasMock.mock.calls.map((c) => c[0])).toEqual([
      { page: 1, pageSize: 100 },
      { page: 2, pageSize: 100 },
    ]);
    const props = moduloProps[0] as { envio: unknown; plantillas: { id: string; llevaDocumento: boolean }[] };
    expect(props.envio).toBeNull();
    expect(props.plantillas).toEqual([
      { id: "ok", nombre: "aprobada", cuerpo: "Hola", informeClave: "prueba_envio", llevaDocumento: true },
    ]);
  });

  it("editar un envío que no existe responde «no encontrado»", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    acciones.obtenerEnvio.mockResolvedValue({ status: "not_found" });
    const p = await paginas();
    await expect(p.editar()).rejects.toThrow("NOT_FOUND");
  });
});
