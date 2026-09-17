// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import AyudaLayout from "@/app/(app)/ayuda/layout";
import { ROLES_AYUDA } from "@/lib/ayuda/documento";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

// ⭑ FICHA 433 · R17 — LA PUERTA DE `/ayuda`, que es el layout del módulo.
//
// La revisión midió que neutralizar el gate de `ROLES_AYUDA` (`layout.tsx:29`) dejaba el set
// relacionado en verde: una cuenta de máquina —o cualquiera sin sesión— podía entrar al módulo
// sin que nada se pusiera rojo. Es la misma constante que el ítem del menú y que el acotamiento
// de los documentos, y ese es justo el riesgo que la 335 dejó escrito: dos listas de roles que
// divergen en silencio y dejan un menú que ofrece una pantalla que da 404, o al revés.
//
// Aquí se afirman las dos mitades:
//   · NEGATIVA — sin sesión y con `apiKey`, el módulo entero da 404.
//   · POSITIVA — los cinco roles de persona entran, y CADA UNO ve su índice (no el de todos).
//     Sin esta mitad, un layout que lanzara siempre pasaría la negativa con nota.

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
  usePathname: () => "/ayuda",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// El `PageHeader` del `AppPage` monta el botón de salir, que usa el router y el toast, y cuya
// Server Action es código de servidor. Se doblan igual que en `PageHeader.test.tsx`.
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
vi.mock("@/lib/actions/auth", () => ({ logout: vi.fn() }));

const resolveActorMock = vi.mocked(resolveActorFromSession);

function entra(rol: RolValue) {
  resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol, zonaId: null });
}

async function montar() {
  return render(await AyudaLayout({ children: <div data-testid="hijo">Documento</div> }));
}

const indice = () => screen.getByRole("navigation", { name: "Índice de la ayuda" });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("R17 — a `/ayuda` sólo entran las cuentas de PERSONA", () => {
  it("⭑ sin sesión, el módulo entero da 404", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(AyudaLayout({ children: <div /> })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("⭑ la cuenta de máquina (`apiKey`) tampoco entra: no navega la UI", async () => {
    // No está en `ROLES_AYUDA` a propósito (ver el comentario de la constante). Si el gate
    // dejara de mirar la lista y sólo comprobara «hay sesión», este caso lo dice.
    entra("apiKey");
    await expect(AyudaLayout({ children: <div /> })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("y los cinco roles de `ROLES_AYUDA` SÍ entran (la lista no es decorativa)", async () => {
    // Se recorre LA CONSTANTE, no una copia escrita a mano: si mañana alguien añade un rol
    // al menú y no al módulo, este caso se entera.
    expect(ROLES_AYUDA.length).toBe(5);
    for (const rol of ROLES_AYUDA) {
      entra(rol);
      await expect(AyudaLayout({ children: <div /> }), rol).resolves.toBeTruthy();
    }
  });
});

describe("R17 (mitad positiva) — el armazón pinta el índice YA ACOTADO y el documento", () => {
  it("⭑ el maestro ve el encabezado «Ayuda», su índice y el documento de la derecha", async () => {
    entra("maestro");
    await montar();

    // El `<h1>` de la página lo pone el `PageHeader` del `AppPage`.
    expect(screen.getByRole("heading", { level: 1, name: "Ayuda" })).toBeInTheDocument();
    expect(within(indice()).getByRole("link", { name: "Wallet · Caja" })).toHaveAttribute(
      "href",
      "/ayuda/oficina/wallet-caja",
    );
    expect(screen.getByTestId("hijo")).toBeInTheDocument();
  });

  it("⭑ el índice que cruza al cliente está RECORTADO por rol, no filtrado al pintar", async () => {
    // El mensajero no recibe ni el enlace de la caja de la empresa: el acotamiento de
    // `documentosQuePuedeLeer` ocurriendo en el SERVIDOR, que es lo que este layout decide.
    //
    // ⭑ FICHA 435 — LA CONTRAPRUEBA CAMBIÓ DE SIGNO, Y ES EL CAMBIO. Hasta hoy este caso
    // afirmaba que el maestro NO recibía «Reparto»; ahora afirma que SÍ, porque la oficina es
    // quien atiende las dudas de los 18 mensajeros. Lo que NO cambió es la otra dirección, que
    // es la que protege dinero y gente ajena a la empresa: sigue siendo la línea de abajo.
    entra("mensajero");
    const { unmount } = await montar();
    expect(within(indice()).getByRole("link", { name: "Reparto" })).toBeInTheDocument();
    expect(within(indice()).queryByRole("link", { name: "Wallet · Caja" })).toBeNull();
    unmount();

    // Y la tienda tampoco se mueve: ni la caja, ni la ayuda del reparto del mensajero.
    entra("adminTienda");
    const tienda = await montar();
    expect(within(indice()).queryByRole("link", { name: "Wallet · Caja" })).toBeNull();
    expect(within(indice()).queryByRole("link", { name: "Reparto" })).toBeNull();
    tienda.unmount();

    entra("maestro");
    await montar();
    expect(within(indice()).getByRole("link", { name: "Wallet · Caja" })).toBeInTheDocument();
    expect(within(indice()).getByRole("link", { name: "Reparto" })).toHaveAttribute(
      "href",
      "/ayuda/mensajero/reparto",
    );
  });

  it("cada rol recibe una cantidad distinta de documentos, y ninguno cero", async () => {
    // Medición del 2026-09-16 sobre `docs/ayuda/**`, escrita a mano: si un cambio en el
    // frontmatter mueve estos números, se ve aquí y se decide, en vez de enterarse en la
    // pantalla de alguien. El `> 0` solo no bastaría: un acotamiento roto hacia «enseñar
    // todo» daría 33 para todos y pasaría.
    //
    // ⚠️ ESTOS NÚMEROS SE MUEVEN A MANO Y SE QUEDAN LITERALES. Calcularlos desde el propio
    // catálogo los dejaría verdes para siempre: el caso compara el índice YA ACOTADO contra
    // una cuenta hecha fuera, y ése es justo el acotamiento que vigila.
    //
    // ⭑ FICHA 434 — +1 a `maestro`, `admin` y `adminSatelite` por los dos documentos nuevos:
    // `oficina/configuracion-sinpe.md` (maestro, admin) y `satelite/mi-bodega.md`
    // (adminSatelite). `mensajero` y `adminTienda` no los declaran y no se mueven. La tercera
    // pantalla de la ficha, `/ranking/historico`, NO añade documento: se sumó a la `pantalla:`
    // de `mensajero/ranking.md`, que ya la explicaba, así que no cambia ninguna cuenta.
    //
    // ⭑ FICHA 435 — MAESTRO Y ADMIN PASAN A LOS 33, que es el catálogo entero: 23→33 y 22→33.
    // **Y LOS OTROS TRES NO SE MUEVEN**, que es la otra mitad de la decisión y la que este caso
    // vigila de verdad: si `adminSatelite`, `mensajero` o `adminTienda` cambiaran un solo
    // número, el ensanche se fue por donde no debía y son cuentas de gente ajena a la empresa.
    // Medido a mano el 2026-09-16 sobre el `roles:` de los 33 archivos.
    const esperado: Record<string, number> = {
      maestro: 33,
      admin: 33,
      adminSatelite: 10,
      mensajero: 8,
      adminTienda: 7,
    };
    for (const rol of ROLES_AYUDA) {
      entra(rol);
      const { unmount } = await montar();
      expect(within(indice()).getAllByRole("link").length, rol).toBe(esperado[rol]);
      unmount();
    }
  });
});
