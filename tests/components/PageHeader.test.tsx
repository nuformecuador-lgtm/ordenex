// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { AyudaProvider } from "@/providers/AyudaProvider";

// El PageHeader monta el LogoutButton (client) en su topbar. Ese botón usa
// useRouter() (next/navigation) y useToast() (feature 11); ambos lanzan sin su
// contexto, por lo que se mockean para aislar el header. El comportamiento del
// logout (invocar la Server Action + navegar) se cubre en LogoutButton.test.tsx.
//
// ⭑ Ficha 433 — `usePathname` se añade al mismo doble porque el «?» de la ayuda pregunta EN QUÉ
// PANTALLA estás. Es una lectura, no una navegación: los casos de abajo la fijan con `rutaActual`.
let rutaActual = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => rutaActual,
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

// La Server Action de logout es código server; se mockea para no importar el
// backend al montar el LogoutButton.
vi.mock("@/lib/actions/auth", () => ({
  logout: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  rutaActual = "/";
});

describe("PageHeader — topbar con control de logout (feature 57)", () => {
  it("renderiza el título como encabezado nivel 1 y la descripción", () => {
    render(<PageHeader title="Órdenes" description="Listado de órdenes" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Órdenes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Listado de órdenes")).toBeInTheDocument();
  });

  it("R1/R2: muestra el control de logout 'Salir' en el topbar (presente en toda página autenticada, independiente del rol)", () => {
    render(<PageHeader title="Panel" />);

    const salir = screen.getByRole("button", { name: "Salir" });
    expect(salir).toBeInTheDocument();
    // R12: elemento nativo <button>, enfocable y operable por teclado.
    expect(salir.tagName).toBe("BUTTON");
    expect(salir).not.toBeDisabled();
  });

  it("el control de logout convive con las `actions` específicas de la página", () => {
    render(
      <PageHeader
        title="Órdenes"
        actions={<Button>Carga masiva</Button>}
      />,
    );

    // Ambos controles coexisten en el topbar.
    expect(
      screen.getByRole("button", { name: "Carga masiva" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });

  it("el control de logout aparece aunque la página no pase `actions`", () => {
    render(<PageHeader title="Perfil" />);

    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 433 · R18 — EL «?» DE LA AYUDA SE MONTA AQUÍ, Y ESO ES LO QUE HAY QUE VIGILAR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `AyudaBoton.test.tsx` monta el botón SUELTO: afirma que el componente se comporta bien, no que
// alguien lo monte. La revisión de la ficha midió el agujero: sustituir `<AyudaBoton />` por
// `{null}` en este encabezado —dejando el import— pasaba las 230 guardias y los 727 archivos de
// `tests/components` + `tests/integration` (9375 tests). El «?» habría desaparecido de las 29
// pantallas del portal con la suite entera en verde, y el «?» es, según la propia ficha, «el
// acceso que hace que el módulo se use».
//
// Es la familia conocida de este repo: el composition root que no inyecta, y la guardia que mide
// que alguien IMPORTE en vez de que alguien MONTE. `superficie-de-uso.guardia.test.ts` sólo caza
// el borrado del import; esto caza el del montaje.
//
// Por eso el encabezado se renderiza ENTERO y dentro del proveedor, como en la aplicación.
describe("433/R18 — el encabezado MONTA el «?» de la ayuda de esa pantalla", () => {
  const MAPA = {
    "/wallet": "oficina/wallet-caja",
    "/mis-asignaciones/reparto": "mensajero/reparto",
  };

  // ⭑ FICHA 436 (T17 — R26): el control pasó de `<Link>` a disparador del asistente, así que el
  // selector es `button`. Lo que este bloque afirma NO cambia —que el encabezado MONTA el «?» y
  // que es el de ESTA pantalla—; cambia la forma del control, a propósito y una sola vez.
  const ayuda = () => screen.queryByRole("button", { name: "Ayuda de esta pantalla" });

  function montarEnLaRuta(ruta: string, mapa: Record<string, string> = MAPA) {
    rutaActual = ruta;
    return render(
      <AyudaProvider mapa={mapa}>
        <PageHeader title="Wallet" description="La caja" />
      </AyudaProvider>,
    );
  }

  it("⭑ con proveedor y documento para esa ruta, el «?» está EN el encabezado", () => {
    montarEnLaRuta("/wallet");

    const control = ayuda();
    expect(control, "el «?» no está montado en el PageHeader").not.toBeNull();
    expect(control).toHaveAttribute("data-ayuda-slug", "oficina/wallet-caja");
    // Dentro del <header>, junto a los demás controles: no en cualquier sitio del árbol.
    expect(control!.closest("header")).not.toBeNull();
    // Y convive con lo que ya había: montar la ayuda no puede desplazar al resto.
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Wallet" })).toBeInTheDocument();
  });

  it("⭑ ofrece la ayuda de LA PANTALLA EN LA QUE ESTÁS, no una fija", () => {
    // El control negativo del caso de arriba: un slug constante lo pasaría igual.
    montarEnLaRuta("/mis-asignaciones/reparto");
    expect(ayuda()).toHaveAttribute("data-ayuda-slug", "mensajero/reparto");
  });

  it("en una pantalla SIN documento el encabezado queda como estaba (nunca un «?» a un vacío)", () => {
    montarEnLaRuta("/mi-bodega");
    expect(ayuda()).toBeNull();
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });

  it("y sin proveedor —el encabezado montado suelto— tampoco se pinta ni revienta", () => {
    rutaActual = "/wallet";
    render(<PageHeader title="Wallet" />);
    expect(ayuda()).toBeNull();
  });
});
