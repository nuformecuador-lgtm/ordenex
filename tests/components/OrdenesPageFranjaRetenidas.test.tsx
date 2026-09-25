// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { RolValue } from "@prisma/client";

import OrdenesPage from "@/app/(app)/ordenes/page";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { resumenReprogramadasRetenidasCentral } from "@/lib/actions/reprogramadas-retenidas";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { ResumenRetenidas } from "@/lib/interfaces/services/IReprogramadasRetenidasService";

/**
 * FICHA 462 (T3.5, S4, R32, R35, R36, R37, R39) — EL CABLEADO DE `page.tsx`, que es donde vive la
 * decisión de ROL y la degradación.
 *
 * `FranjaReprogramadasRetenidas` ya se prueba con props; lo que NADIE probaría sin este archivo es que
 * la PÁGINA (a) no dispare la lectura para el `adminTienda` ni sin sesión (R36), (b) la monte ANTES del
 * listado para `maestro`/`admin` (R32), y (c) si la lectura falla, la página siga intacta y el fallo
 * quede REGISTRADO (R37), nunca tragado.
 *
 * MUTACIÓN OBLIGATORIA (design §8.2-13, una por superficie): quitar `esAccesoTotal` del cableado de
 * `page.tsx` pone ROJO «adminTienda: la lectura NO se dispara».
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/ordenes", () => ({ listarOrdenes: vi.fn() }));
vi.mock("@/lib/auth/resolve-actor", () => ({ resolveActorFromSession: vi.fn(async () => null) }));
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(async () => ({
    status: "ok" as const,
    catalogo: {
      zonas: [],
      tiendas: [],
      mensajeros: [],
      provincias: [],
      cantones: [],
      distritos: [],
    } satisfies CatalogoFiltrosOrdenesDTO,
  })),
}));
// LA LECTURA DE ESTA FICHA, doblada: los casos deciden qué devuelve (ok / forbidden / error).
vi.mock("@/lib/actions/reprogramadas-retenidas", () => ({
  resumenReprogramadasRetenidasCentral: vi.fn(),
}));
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const resolveActorMock = vi.mocked(resolveActorFromSession);
const retenidasMock = vi.mocked(resumenReprogramadasRetenidasCentral);

const UUID_A = "6f1c2b6e-1111-4a2b-9c3d-000000000001";
const UUID_B = "6f1c2b6e-2222-4a2b-9c3d-000000000002";

/** El resumen YA recortado al ámbito central, como lo devuelve la acción: 4 retenidos, 2 cierres, 1 sin cierre. */
function resumenCentral(): ResumenRetenidas {
  return {
    diaCR: "2026-09-25",
    total: 4,
    porForma: { reprogramado: 2, enReparto: 2 },
    cierres: [
      { cierreId: UUID_A, mensajeroId: "m1", mensajeroNombre: "Ana Pérez", estado: "solicitado", jornadaCR: "2026-09-24", ambito: { tipo: "central" }, cuantas: 2 },
      { cierreId: UUID_B, mensajeroId: "m2", mensajeroNombre: "Beto Mora", estado: "rechazado", jornadaCR: "2026-09-23", ambito: { tipo: "central" }, cuantas: 1 },
    ],
    sinCierre: [{ mensajeroId: "m3", mensajeroNombre: "Dani Soto", ambito: { tipo: "central" }, cuantas: 1 }],
  };
}

const REGION = "Paquetes reprogramados para hoy que esperan un cierre";

async function renderPage() {
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{await OrdenesPage()}</SWRConfig>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrdenesMock.mockResolvedValue({ status: "ok", items: [], page: 1, pageSize: 25, total: 0 });
  retenidasMock.mockResolvedValue({ status: "ok", resumen: resumenCentral() });
});

afterEach(cleanup);

describe("462/R36 — a quién NO se le lee ni se le muestra", () => {
  it("⭑ adminTienda: la lectura NO se dispara (ni una consulta) y no hay franja", async () => {
    resolveActorMock.mockResolvedValueOnce({ usuarioId: "t1", rol: RolValue.adminTienda });
    await renderPage();
    expect(retenidasMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: REGION })).toBeNull();
    // El listado de la tienda está intacto.
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("sin sesión: tampoco se lee", async () => {
    resolveActorMock.mockResolvedValueOnce(null);
    await renderPage();
    expect(retenidasMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: REGION })).toBeNull();
  });
});

describe("462/R32 — maestro y admin la ven ANTES del listado, con los números del servidor", () => {
  for (const rol of [RolValue.maestro, RolValue.admin]) {
    it(`${rol}: una lectura, la franja delante de la tabla y la frase con N=4, M=2, K=1`, async () => {
      resolveActorMock.mockResolvedValueOnce({ usuarioId: "u", rol });
      await renderPage();

      expect(retenidasMock).toHaveBeenCalledTimes(1);
      const region = screen.getByRole("region", { name: REGION });
      expect(region).toHaveTextContent(
        "Hay 4 paquetes reprogramados para hoy que todavía no puedes asignar: faltan 2 cierres por aprobar.",
      );
      expect(region).toHaveTextContent("1 de ellos es de un mensajero que todavía no envió su cierre.");
      expect(screen.getByRole("link", { name: "Ana Pérez · 24 de septiembre · Solicitado · retiene 2 paquetes" })).toHaveAttribute(
        "href",
        `/cierres-admin?cierre=${UUID_A}`,
      );
      // ANTES del listado: la región precede a la tabla en el documento.
      const tabla = await screen.findByRole("table");
      expect(region.compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      cleanup();
    });
  }

  it("con 0 retenidas en el ámbito central no hay franja (R35)", async () => {
    resolveActorMock.mockResolvedValueOnce({ usuarioId: "u", rol: RolValue.admin });
    retenidasMock.mockResolvedValueOnce({
      status: "ok",
      resumen: { diaCR: "2026-09-25", total: 0, porForma: { reprogramado: 0, enReparto: 0 }, cierres: [], sinCierre: [] },
    });
    await renderPage();
    expect(retenidasMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: REGION })).toBeNull();
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("462/R37 — si la lectura falla, la página sigue y el fallo queda registrado", () => {
  it("⭑ la acción REVIENTA: sin franja, listado intacto, y el error registrado con su causa", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveActorMock.mockResolvedValueOnce({ usuarioId: "u", rol: RolValue.maestro });
    retenidasMock.mockRejectedValueOnce(new Error("conexion perdida"));

    await renderPage();

    expect(screen.queryByRole("region", { name: REGION })).toBeNull();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    // Registrado, no tragado: el logger del repo escribe por `console.error` con la causa dentro.
    const registrado = consola.mock.calls.find((c) => String(c[1]).includes("franja de reprogramados retenidos"));
    expect(registrado, "el fallo de la franja tiene que quedar registrado").toBeDefined();
    const err = registrado?.[1] as string;
    expect(err).toContain("ordenes/page");
    consola.mockRestore();
  });

  it("`forbidden` de la acción: sin franja y sin registrar nada (no es un fallo)", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveActorMock.mockResolvedValueOnce({ usuarioId: "u", rol: RolValue.admin });
    retenidasMock.mockResolvedValueOnce({ status: "forbidden" });

    await renderPage();

    expect(screen.queryByRole("region", { name: REGION })).toBeNull();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(consola).not.toHaveBeenCalled();
    consola.mockRestore();
  });
});
