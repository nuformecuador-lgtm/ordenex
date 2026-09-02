// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import RecepcionSatelitePage from "@/app/(app)/recepcion-satelite/page";
import PorRecibirPage from "@/app/(app)/recepcion-satelite/por-recibir/page";
import EnBodegaPage from "@/app/(app)/recepcion-satelite/en-bodega/page";
import {
  itemsVisibles,
  primerDestino,
  SIDEBAR_ITEMS,
} from "@/lib/auth/menu-visibility";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarRecepcionSatelite,
  listarMensajerosSatelite,
  estadoBloqueoBodegaSatelite,
  listarOrdenesBodegaPaginado,
} from "@/lib/actions/recepcion-satelite";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import { PAGE_SIZE_SATELITE } from "@/tests/fixtures/satelite-bodega";
import { CAMPOS_BASE_ORDEN } from "@/tests/fixtures/fila-bodega-satelite";

// Feature 33 (T11) — la página resuelve el rol SOLO server-side; rol ≠
// adminSatelite (o sin sesión) → `notFound`. Se mockean el resolver, la action de
// listado, la lib de cámara y next/navigation (notFound y redirect lanzan; useRouter lo
// consume el módulo cliente).
//
// FEATURE 279 (T4.4, 2026-08-24) — este archivo pasa a cubrir TRES rutas, en tres bloques:
//   (1) `/recepcion-satelite`               → redirige, sin renderizar ni consultar nada;
//   (2) `/recepcion-satelite/por-recibir`   → escáner + tarjetas;
//   (3) `/recepcion-satelite/en-bodega`     → el listado y los avisos de bodega.
// Ningún caso de acceso por rol se pierde: los cuatro que tenía la pantalla única se
// ejecutan AHORA CONTRA LAS DOS páginas, con la misma tabla de roles.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  listarRecepcionSatelite: vi.fn(),
  listarMensajerosSatelite: vi.fn(),
  estadoBloqueoBodegaSatelite: vi.fn(),
  recibirPorQr: vi.fn(),
  // Feature 170 — FASE 2 (T K.3): la página pre-carga la PÁGINA 1 del listado y el catálogo
  // de cantón/distrito, y los baja por props al módulo.
  listarOrdenesBodegaPaginado: vi.fn(),
}));
// Pedido humano (2026-08-19): el catálogo de los filtros es el de `/ordenes` — la misma
// acción, acotada por el servicio a la zona del actor.
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(),
}));
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
/** `redirect()` de Next también lanza; se distingue por el destino que arrastra. */
class RedirectError extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT:${destino}`);
    this.name = "RedirectError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  redirect: (destino: string) => {
    throw new RedirectError(destino);
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarRecepcionSatelite);
const listarMensajerosMock = vi.mocked(listarMensajerosSatelite);
const bloqueoMock = vi.mocked(estadoBloqueoBodegaSatelite);
const paginaMock = vi.mocked(listarOrdenesBodegaPaginado);
const catalogoMock = vi.mocked(obtenerCatalogoFiltrosOrdenes);

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({
    status: "ok",
    porRecibir: [],
    recibidas: [],
    porDevolver: [], // Feature 139/T3.3: grupo `por_devolver` por enviar a central
    enTransitoACentral: [], // Feature 139/T3.3: grupo `devolviendo_a_bodega_central` (informativo)
    devueltas: [], // Feature 100/T4.1: grupo `devuelta` por recuperar a bodega
    asignadas: [], // Feature 149/T6.3: grupo `por_recoger` de la zona (deshacer asignacion)
    zonaNombre: "Limón",
    sinZona: false,
  });
  listarMensajerosMock.mockResolvedValue({
    status: "ok",
    mensajeros: [{ id: "m1", nombre: "Ana Mensajera" }],
  });
  bloqueoMock.mockResolvedValue({
    status: "ok",
    bloqueo: { bloqueada: false, porMensajeros: false, porCierreBodega: false },
  });
  paginaMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: PAGE_SIZE_SATELITE,
    total: 0,
  });
  catalogoMock.mockResolvedValue({
    status: "ok",
    // Lo que este rol recibe: geografía de SU zona, ni zonas ni cuentas tienda.
    catalogo: { zonas: [], tiendas: [], mensajeros: [], provincias: [], cantones: [], distritos: [] },
  });
});

afterEach(() => {
  cleanup();
});

// ===================== (1) La ruta vieja: redirige y nada más =====================
describe("/recepcion-satelite — redirect a «Por recibir» (R13/R14)", () => {
  it("R13: redirige a /recepcion-satelite/por-recibir", () => {
    // No se borra la ruta: vive en enlaces viejos, en el historial de los navegadores de
    // la calle y en la PWA ya instalada. Borrarla daría 404 a quien la tuviera guardada.
    expect(() => RecepcionSatelitePage()).toThrow(
      "NEXT_REDIRECT:/recepcion-satelite/por-recibir",
    );
  });

  it("R13: no renderiza contenido, no resuelve la sesión y no consulta NINGÚN dato", () => {
    expect(() => RecepcionSatelitePage()).toThrow();
    // El gate de rol lo aplica la página de destino; repetirlo aquí sería una segunda
    // fuente de verdad que puede divergir — y una consulta por cada enlace viejo.
    expect(resolveActorMock).not.toHaveBeenCalled();
    expect(listarMock).not.toHaveBeenCalled();
    expect(listarMensajerosMock).not.toHaveBeenCalled();
    expect(bloqueoMock).not.toHaveBeenCalled();
    expect(paginaMock).not.toHaveBeenCalled();
    expect(catalogoMock).not.toHaveBeenCalled();
  });

  // R14 — LA PUERTA ÚNICA. El destino del redirect y el aterrizaje post-login del
  // `adminSatelite` tienen que ser LA MISMA pantalla; si divergen, el rol entra en un
  // sitio al iniciar sesión y en otro desde un enlace guardado, y nada se pone rojo.
  it("R14: el destino del redirect coincide con el aterrizaje post-login del adminSatelite", () => {
    const aterrizaje = primerDestino(
      itemsVisibles(SIDEBAR_ITEMS, { usuarioId: "u1", rol: "adminSatelite" }),
    );
    // Positivo: el aterrizaje existe y es el literal firmado (no se deriva del redirect).
    expect(aterrizaje).toBe("/recepcion-satelite/por-recibir");
    expect(() => RecepcionSatelitePage()).toThrow(`NEXT_REDIRECT:${aterrizaje}`);
  });
});

// ===================== (2) «Por recibir» =====================
describe("PorRecibirPage — acceso, título y contenido (R15/R19/R20/R44)", () => {
  it("R15/R20: el adminSatelite ve el H1 «Por recibir», su descripción, el escáner y las tarjetas", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    listarMock.mockResolvedValue({
      status: "ok",
      porRecibir: [
        {
          // FICHA 349: los escalares de `OrdenDTO` que la fila comparte con `/ordenes`, en un solo sitio.
          ...CAMPOS_BASE_ORDEN,
          id: "r1",
          numGuia: 1001,
          numRemision: "REM-R1",
          estatusValue: "en_ruta_bodega_satelite",
          destinatario: "Ana Pérez",
          telefonoDest: "88880000",
          direccion: "Calle 1, casa 2",
          producto: "Caja mediana",
          montoCobrar: 150,
          tiendaNombre: "Tienda X",
          zonaNombre: "Limón",
          provinciaNombre: "Limón",
          cantonNombre: "Central",
          distritoNombre: "Limón",
        },
      ],
      recibidas: [],
      porDevolver: [],
      enTransitoACentral: [],
      devueltas: [],
      asignadas: [],
      zonaNombre: "Limón",
      sinZona: false,
    });

    render(await PorRecibirPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Por recibir" }),
    ).toBeInTheDocument();
    // R44: descripción PROPIA, la que dice cómo se recibe ahora que no hay botón.
    expect(
      screen.getByText(/Órdenes en camino a tu bodega satélite/i),
    ).toBeInTheDocument();
    // R44: y NADA de «Mis asignaciones», que era el nombre del portal del MENSAJERO.
    expect(screen.queryByText(/Mis asignaciones/i)).toBeNull();

    // El contenido de SU pantalla: el escáner y la región de las tarjetas.
    expect(
      screen.getByRole("button", { name: "Recibir paquete" }),
    ).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Por recibir" });
    expect(within(region).getAllByText(/REM-R1/).length).toBeGreaterThan(0);
  });

  it("R16: NO monta el listado de la bodega ni su paginación (y sólo hace UNA lectura)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });

    render(await PorRecibirPage());

    // Positivo: la lectura que SÍ le toca se hizo.
    expect(listarMock).toHaveBeenCalledTimes(1);
    // Las cinco que son de la otra pantalla, ninguna.
    expect(listarMensajerosMock).not.toHaveBeenCalled();
    expect(bloqueoMock).not.toHaveBeenCalled();
    expect(paginaMock).not.toHaveBeenCalled();
    expect(catalogoMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Órdenes de la bodega" })).toBeNull();
  });

  it("R19: cualquier rol distinto de adminSatelite NO ve la pantalla (notFound, sin consultar datos)", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminTienda", "mensajero"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(PorRecibirPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R19: sin actor autenticado NO ve la pantalla (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(PorRecibirPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R19: si el listado responde forbidden, tampoco renderiza", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(PorRecibirPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

// ===================== (3) «En bodega» =====================
describe("EnBodegaPage — acceso, título y contenido (R17/R19/R20/R44)", () => {
  it("R17/R20: el adminSatelite ve el H1 «En bodega», su descripción y el listado", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });

    render(await EnBodegaPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "En bodega" }),
    ).toBeInTheDocument();
    // R44: descripción propia, la que enumera lo que se PUEDE hacer aquí.
    expect(
      screen.getByText(/Órdenes que ya están en tu bodega satélite/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Mis asignaciones/i)).toBeNull();

    expect(
      screen.getByRole("region", { name: "Órdenes de la bodega" }),
    ).toBeInTheDocument();
  });

  it("R18: no monta la región «Por recibir» (y sí la del listado)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });

    render(await EnBodegaPage());

    expect(
      screen.getByRole("region", { name: "Órdenes de la bodega" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Por recibir" })).toBeNull();
  });

  it("R19: cualquier rol distinto de adminSatelite NO ve la pantalla (notFound)", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminTienda", "mensajero"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(EnBodegaPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // No debe consultar el listado si el rol no está autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R19: sin actor autenticado NO ve la pantalla (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(EnBodegaPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R19: si el listado responde forbidden, tampoco renderiza", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(EnBodegaPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

// R24: los avisos de bodega son de «En bodega» y de ninguna otra pantalla.
describe("EnBodegaPage — aviso de cierres (ajuste admin_satelite)", () => {
  it("cierres abiertos (no todos los mensajeros) → aviso INFORMATIVO, no bloqueante", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    bloqueoMock.mockResolvedValue({
      status: "ok",
      bloqueo: {
        bloqueada: false,
        porMensajeros: false,
        porCierreBodega: false,
        cierresAbiertos: 2,
        totalMensajeros: 3,
        mensajerosConCierreIds: ["m2", "m3"],
      },
    });

    render(await EnBodegaPage());

    expect(
      screen.getByText(/2 cierres abiertos de tus mensajeros/i),
    ).toBeInTheDocument();
    // No es el aviso de bloqueo duro.
    expect(
      screen.queryByText(/cierres pendientes de resolver/i),
    ).toBeNull();
  });

  it("TODOS los mensajeros con cierre → bloqueo duro (aviso destructivo)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    bloqueoMock.mockResolvedValue({
      status: "ok",
      bloqueo: {
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: false,
        cierresAbiertos: 2,
        totalMensajeros: 2,
        mensajerosConCierreIds: ["m1", "m2"],
      },
    });

    render(await EnBodegaPage());

    expect(screen.getByRole("alert")).toHaveTextContent(
      /cierres pendientes de resolver/i,
    );
  });
});
