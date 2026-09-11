// @vitest-environment jsdom
// ⚠️ FICHA 409 (T6.5 — R6/R7/R66) — EL ATAJO ATERRIZA EN LA PESTAÑA DE LA QUE HABLA.
//
// El aviso «N novedades esperan tu decisión» declara su atajo a `/novedades?superficie=devolucion`.
// Sin esta lectura, el botón dejaría a la tienda en «Ayuda solicitada» —la primera pestaña, D6 de
// la 236— hablándole de la de al lado: el aviso quedaría desacreditado el primer día y la ficha
// entera perdería su sentido.
//
// SE MONTA LA PANTALLA DE VERDAD, con su `NovedadesTabs` y su `TabsGroup` reales, y se afirma
// `aria-selected` sobre las pestañas. Mockear el módulo de pestañas y comprobar la prop que le
// llega mediría que la página PASA un valor, no que la pestaña QUEDA abierta — y son dos cosas
// distintas: la prop podría llegar y `TabsGroup` ignorarla.
//
// Sin JSX a propósito (archivo `.ts`): la página devuelve un elemento ya construido y `render` lo
// acepta tal cual.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import NovedadesPage from "@/app/(app)/novedades/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarAyudaTiendaAction,
  listarNovedadesAction,
} from "@/lib/actions/novedades";
import { listarRechazosSlaTiendaAction } from "@/lib/actions/rechazos-sla-tienda";

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
  listarNovedadesCompletoAction: vi.fn(),
  listarAyudaTiendaAction: vi.fn(),
  listarAyudaTiendaCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/rechazos-sla-tienda", () => ({
  listarRechazosSlaTiendaAction: vi.fn(),
}));
vi.mock("@/lib/actions/resolver-novedad", () => ({ reprogramarNovedad: vi.fn() }));
vi.mock("@/lib/actions/habilitar-novedad", () => ({ habilitarNovedad: vi.fn() }));
vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
}));
vi.mock("@/lib/actions/gestion-desde-ayuda", () => ({
  gestionarDesdeAyuda: vi.fn(),
}));
// La cabecera de la pantalla monta la campana, que sondea por Server Action. Se corta aquí para
// que este archivo mida la PESTAÑA y no la campana.
vi.mock("@/lib/actions/notificaciones", () => ({
  listarNotificaciones: vi.fn().mockResolvedValue({ status: "unauthenticated" }),
  marcarTodasLeidas: vi.fn(),
  descartarNotificacion: vi.fn(),
  notificarCargaMasivaTerminada: vi.fn(),
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

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarNovedadesAction);
const listarAyudaMock = vi.mocked(listarAyudaTiendaAction);
const listarRechazosSlaMock = vi.mocked(listarRechazosSlaTiendaAction);

const VACIO = { status: "ok" as const, items: [], total: 0, page: 1, pageSize: 10 };

/** Monta `/novedades` con la query indicada y devuelve el rótulo de la pestaña activa. */
async function pestanaActivaCon(
  query: Record<string, string | string[] | undefined> | undefined,
): Promise<string> {
  const page = await NovedadesPage(
    query === undefined ? {} : { searchParams: Promise.resolve(query) },
  );
  render(page);
  const lista = screen.getByRole("tablist", { name: "Vistas de novedades" });
  const activa = within(lista)
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true");
  return activa?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });
  listarMock.mockResolvedValue(VACIO);
  listarAyudaMock.mockResolvedValue(VACIO);
  listarRechazosSlaMock.mockResolvedValue(VACIO);
});

afterEach(() => {
  cleanup();
});

describe("R7 — `/novedades?superficie=` deja abierta ESA superficie", () => {
  it("R7: con `?superficie=devolucion` la pestaña activa es «En devolución»", async () => {
    // El literal se escribe A MANO, no se compara contra `TEXTOS_POR_GRUPO`: un texto comparado
    // con su propia fuente está siempre verde y seguiría pasando con el rótulo mal escrito.
    expect(await pestanaActivaCon({ superficie: "devolucion" })).toBe(
      "En devolución",
    );
  });

  it("R7: con `?superficie=ayuda` la pestaña activa es «Ayuda solicitada»", async () => {
    // El par positivo del caso de arriba: sin él, «devolución» podría estar saliendo por cualquier
    // otra razón y no por el parámetro.
    expect(await pestanaActivaCon({ superficie: "ayuda" })).toBe(
      "Ayuda solicitada",
    );
  });

  it("R7: el destino declarado del aviso de novedades ES el que abre «En devolución»", async () => {
    // Cierra el círculo de R6: se toma el `href` TAL Y COMO lo emite el catálogo, se le extrae el
    // parámetro con `URLSearchParams` y se monta la página con él. Si alguien cambiara el destino
    // del catálogo a un valor que la página no entiende, esto se pondría rojo aquí y no en
    // producción.
    const { accionDeAviso } = await import("@/lib/notificaciones/catalogo-avisos");
    const accion = accionDeAviso("novedades_sin_gestionar", "adminTienda");
    if (accion.clase !== "accionable" || accion.atajo === null) {
      throw new Error("el aviso de novedades dejó de declarar atajo");
    }
    expect(accion.atajo.href).toBe("/novedades?superficie=devolucion");

    const query = new URL(accion.atajo.href, "https://ordenex.co").searchParams;
    expect(await pestanaActivaCon({ superficie: query.get("superficie") ?? undefined })).toBe(
      "En devolución",
    );
  });
});

describe("R66 — lo desconocido cae al defecto y la página responde 200", () => {
  it("R66: `?superficie=chorizo` abre «Ayuda solicitada» y la página no falla", async () => {
    // Sin lista blanca, ese valor llegaría a `TabsGroup`, activaría una pestaña que no existe,
    // base-ui desmontaría su panel y la pantalla quedaría EN BLANCO con un 200 — un fallo mudo,
    // que es la familia de defectos más cara de este repo.
    expect(await pestanaActivaCon({ superficie: "chorizo" })).toBe(
      "Ayuda solicitada",
    );
    // «Responde 200» en una page de App Router = no hay `notFound()`: el encabezado está pintado.
    expect(
      screen.getByRole("heading", { level: 1, name: "Novedades" }),
    ).toBeInTheDocument();
    // Y hay panel montado: el vacío en blanco se vería como una pantalla rota, no como un 200.
    expect(screen.getAllByRole("tabpanel").length).toBeGreaterThan(0);
  });

  it("R66: sin parámetro el comportamiento por defecto NO cambia — abre «Ayuda solicitada»", async () => {
    expect(await pestanaActivaCon(undefined)).toBe("Ayuda solicitada");
  });

  it("R66: un `?superficie` repetido o vacío tampoco rompe: cae al defecto", async () => {
    expect(await pestanaActivaCon({ superficie: "" })).toBe("Ayuda solicitada");
    cleanup();
    // Un array llega cuando la URL repite el parámetro (`?superficie=a&superficie=b`).
    expect(await pestanaActivaCon({ superficie: ["chorizo", "devolucion"] })).toBe(
      "Ayuda solicitada",
    );
  });

  it("R66: el array cuyo PRIMER valor es válido sí abre esa superficie", async () => {
    // Control positivo del caso de arriba: la lectura del array no es «ignorar siempre».
    expect(await pestanaActivaCon({ superficie: ["devolucion", "chorizo"] })).toBe(
      "En devolución",
    );
  });
});
