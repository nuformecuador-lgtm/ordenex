// @vitest-environment jsdom
//
// ⭑ FICHA 438 — LAS DOS PANTALLAS DE «NO ENCONTRADO», SOBRE LOS ARCHIVOS REALES.
//
// No se prueba un componente de mentira: se monta el `export default` de `app/(app)/not-found.tsx`
// y el de `app/not-found.tsx`, que es exactamente lo que Next monta cuando una ruta no se puede
// abrir. Lo único doblado es el borde (sesión y Server Actions del encabezado).
//
// Lo que cada bloque ancla, y por qué:
//   1. EL ARMAZÓN — la del portal lo CONSERVA (sidebar y encabezado) y la de fuera NO. Es el
//      síntoma que reportó el humano: «deja el sidebar y el contenido en blanco».
//   2. EL TEXTO NO DISTINGUE LOS DOS CASOS — requisito de SEGURIDAD (ficha 433), no cosmética.
//   3. LA SALIDA LLEVA AL INICIO DE ESE ROL — y sale del menú compartido, no de una lista nueva.
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/wallet/caja",
  useSearchParams: () => new URLSearchParams(),
}));

// Bordes del encabezado (`AppPage` -> `PageHeader`): son Server Actions, no esta pantalla.
vi.mock("@/lib/actions/notificaciones", () => ({
  listarNotificaciones: vi.fn(async () => ({ status: "ok", items: [], noLeidas: 0 })),
  descartarNotificacion: vi.fn(async () => ({ status: "ok" })),
  marcarTodasLeidas: vi.fn(async () => ({ status: "ok" })),
}));
vi.mock("@/lib/actions/auth", () => ({
  logout: vi.fn(async () => ({ status: "ok" })),
}));

// La sesión es el ÚNICO dato que esta pantalla lee del servidor. Se dobla aquí para poder
// entrar como cada rol; el cálculo del destino NO se dobla: corre el real.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

import { ToastProvider } from "@/providers/ToastProvider";
import { TemaProvider } from "@/providers/TemaProvider";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import NoEncontradoEnElPortal from "@/app/(app)/not-found";
import NoEncontradoFueraDelPortal from "@/app/not-found";

const resolveActorMock = vi.mocked(resolveActorFromSession);

/**
 * Los MISMOS proveedores que monta `app/(app)/layout.tsx`, y no un doble: la pantalla del
 * portal usa `AppPage` -> `PageHeader` -> `LogoutButton`, que llama a `useToast()` y LANZA
 * fuera de un `ToastProvider`. En la app eso no puede pasar —se renderiza DENTRO del layout
 * del portal, que ya trae los dos proveedores—, y montarlos aquí reproduce esa condición.
 */
function montar(elemento: ReactElement) {
  return render(
    <TemaProvider temaInicial={null}>
      <ToastProvider>{elemento}</ToastProvider>
    </TemaProvider>,
  );
}

const actor = (rol: RolValue) => ({ usuarioId: "u1", rol, zonaId: null });

/** Monta la pantalla del portal con la sesión de ese rol. */
async function montarPortal(rol: RolValue | null) {
  resolveActorMock.mockResolvedValue(rol === null ? null : actor(rol));
  return montar(await NoEncontradoEnElPortal());
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/* ── 1. EL ARMAZÓN ────────────────────────────────────────────────────────────────────────── */

describe("el armazón: la del portal lo conserva, la de fuera no", () => {
  it("la del portal trae el encabezado del portal (no deja a nadie flotando)", async () => {
    const { container } = await montarPortal("mensajero");

    // `PageHeader` es la mitad visible del armazón que esta pantalla conserva; la otra —el
    // sidebar— la pone `app/(app)/layout.tsx`, que envuelve a este `not-found` por estar el
    // archivo en la raíz del grupo.
    const encabezado = container.querySelector("header");
    expect(encabezado).not.toBeNull();
    // Y con él los controles del portal: desde un 404 se puede seguir usando la app.
    expect(
      within(encabezado as HTMLElement).getByRole("button", { name: /salir/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "No encontramos esta página" }),
    ).toBeInTheDocument();
  });

  it("la de fuera NO monta el encabezado del portal (no hay sesión que lo alimente)", () => {
    const { container } = montar(<NoEncontradoFueraDelPortal />);

    expect(container.querySelector("header")).toBeNull();
    expect(screen.queryByRole("button", { name: /salir/i })).toBeNull();
    // Pero sigue teniendo su propio título de nivel 1: no es una pantalla decapitada.
    expect(
      screen.getByRole("heading", { level: 1, name: "No encontramos esta página" }),
    ).toBeInTheDocument();
  });

  it("la del portal se monta AUNQUE no haya sesión: nunca revienta encima del 404", async () => {
    await montarPortal(null);

    expect(
      screen.getByRole("heading", { level: 1, name: "No encontramos esta página" }),
    ).toBeInTheDocument();
  });
});

/* ── 2. EL TEXTO NO DISTINGUE LOS DOS CASOS (SEGURIDAD, FICHA 433) ────────────────────────── */

describe("el texto no delata si la página existe o si no es para esta cuenta", () => {
  // ⚠️ LITERAL A PROPÓSITO, y PROHIBIDO derivarlo del componente que lo pinta: una aserción
  // contra su propia fuente está siempre verde. Este es EL CONTRATO de la ficha, así que si
  // alguien cambia la frase, este caso tiene que obligarle a decidirlo a mano.
  const FRASE = "Esta página no existe, o no es para tu cuenta.";

  it("el portal dice la frase que es verdad en los dos casos", async () => {
    await montarPortal("mensajero");
    expect(screen.getByText(FRASE)).toBeInTheDocument();
  });

  it("la de fuera dice EXACTAMENTE la misma frase", () => {
    montar(<NoEncontradoFueraDelPortal />);
    expect(screen.getByText(FRASE)).toBeInTheDocument();
  });

  it("NINGUNA de las dos nombra el motivo: ni «no tenés acceso», ni «permiso», ni 403", async () => {
    // El vocabulario que convertiría la negativa en un dato: quien lea «no tenés acceso»
    // sabe que la página EXISTE, y los slugs de la ayuda son adivinables.
    const DELATORES = [
      /no ten[eé]s acceso/i,
      /no tienes acceso/i,
      /sin acceso/i,
      /acceso denegado/i,
      /no ten[eé]s permiso/i,
      /sin permiso/i,
      /no autorizad/i,
      /no est[aá]s autorizad/i,
      /prohibid/i,
      /\b403\b/,
      /forbidden/i,
      /unauthorized/i,
    ];

    const { container: delPortal } = await montarPortal("mensajero");
    const textoPortal = delPortal.textContent ?? "";
    cleanup();
    const { container: deFuera } = montar(<NoEncontradoFueraDelPortal />);
    const textoFuera = deFuera.textContent ?? "";

    expect(textoPortal).not.toBe("");
    expect(textoFuera).not.toBe("");
    for (const delator of DELATORES) {
      expect(textoPortal).not.toMatch(delator);
      expect(textoFuera).not.toMatch(delator);
    }
  });

  it("y tampoco afirma que la página NO existe a secas: dice las dos mitades", async () => {
    await montarPortal("mensajero");

    // Las dos mitades, y unidas: si alguien recorta la frase a una sola rama —cualquiera de
    // las dos—, este caso se pone rojo. Es la otra cara del caso de arriba.
    const frase = screen.getByText(FRASE).textContent ?? "";
    expect(frase).toMatch(/no existe/i);
    expect(frase).toMatch(/no es para tu cuenta/i);
    expect(frase).toMatch(/no existe,? o /i);
  });

  it("las DOS pantallas pintan el mismo mensaje: una no puede decir más que la otra", async () => {
    const { container: delPortal } = await montarPortal("mensajero");
    const mensajePortal = within(delPortal).getByRole("status").textContent;
    cleanup();
    const { container: deFuera } = montar(<NoEncontradoFueraDelPortal />);
    const mensajeFuera = within(deFuera).getByRole("status").textContent;

    expect(mensajePortal).toBe(mensajeFuera);
  });
});

/* ── 3. LA SALIDA, Y QUE ES LA DEL MENÚ COMPARTIDO ────────────────────────────────────────── */

describe("la salida lleva al inicio de ese rol", () => {
  // ⚠️ VALORES ESCRITOS A MANO, verificados contra `SIDEBAR_ITEMS`, y por la MISMA razón que
  // los de `tests/unit/auth/destino-post-login.test.ts`: derivarlos de `primerDestino` sería
  // juzgar la función con la función, un verde que pasa igual si el destino cambia. PROHIBIDO
  // sustituirlos por una llamada a `primerDestino`, `itemsVisibles` o `SIDEBAR_ITEMS`.
  const DESTINO_ESPERADO: ReadonlyArray<readonly [RolValue, string]> = [
    ["maestro", "/dashboard"],
    ["admin", "/dashboard"],
    ["adminTienda", "/ordenes"],
    ["adminSatelite", "/recepcion-satelite/por-recibir"],
    ["mensajero", "/mis-asignaciones/reparto"],
  ];

  for (const [rol, destino] of DESTINO_ESPERADO) {
    it(`${rol} vuelve a ${destino}`, async () => {
      await montarPortal(rol);
      expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute(
        "href",
        destino,
      );
    });
  }

  it("el destino NO es el mismo para todos: es el del rol, no una salida única", async () => {
    await montarPortal("mensajero");
    const delMensajero = screen
      .getByRole("link", { name: "Ir al inicio" })
      .getAttribute("href");
    cleanup();
    await montarPortal("maestro");
    const delMaestro = screen
      .getByRole("link", { name: "Ir al inicio" })
      .getAttribute("href");

    expect(delMensajero).not.toBe(delMaestro);
  });

  it("sin sesión (o rol que no navega la UI) cae a la raíz, no a un destino inventado", async () => {
    await montarPortal(null);
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
    cleanup();
    // `apiKey` no ve ningún ítem del menú: tampoco tiene «su inicio».
    await montarPortal("apiKey");
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
  });

  it("la de fuera del portal sale a la raíz (ahí no hay sesión garantizada)", () => {
    montar(<NoEncontradoFueraDelPortal />);
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
  });

  it("SIEMPRE hay salida: ninguna de las dos es un callejón", async () => {
    await montarPortal("mensajero");
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toBeInTheDocument();
    cleanup();
    montar(<NoEncontradoFueraDelPortal />);
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toBeInTheDocument();
  });

  it("no hay buscador ni sugerencias: es una pantalla de error, no un sitio donde quedarse", async () => {
    const { container } = await montarPortal("mensajero");
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/quiz[aá]s|sugerenc|buscar/i);
  });
});
