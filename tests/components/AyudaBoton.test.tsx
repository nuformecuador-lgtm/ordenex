// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { AyudaBoton } from "@/components/shared/AyudaBoton";
import { AyudaProvider } from "@/providers/AyudaProvider";
import { leerResumenesAyuda } from "@/lib/ayuda/catalogo";
import { mapaRutaDocumento } from "@/lib/ayuda/documento";

// ⭑ FICHA 433 — EL «?» DEL ENCABEZADO.
//
// La regla que este archivo vigila es de una sola línea y es la que hace que el botón valga
// algo: **si la pantalla no tiene documento, el botón NO se monta**. Un «?» que abre un 404 es
// peor que no tener «?», porque cobra el clic y la esperanza justo a quien estaba perdido.

let rutaActual = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => rutaActual,
}));

const resumenes = await leerResumenesAyuda();

/** Monta el botón como lo monta la aplicación: con el mapa YA acotado al rol. */
function montar(ruta: string, rol: "mensajero" | "maestro" | "adminTienda") {
  rutaActual = ruta;
  return render(
    <AyudaProvider mapa={mapaRutaDocumento(resumenes, rol)}>
      <AyudaBoton />
    </AyudaProvider>,
  );
}

const boton = () => screen.queryByRole("link", { name: "Ayuda de esta pantalla" });

beforeEach(() => {
  rutaActual = "/";
});

describe("R10 — se monta donde HAY documento", () => {
  it("en /mis-asignaciones/reparto lleva al documento del mensajero", () => {
    montar("/mis-asignaciones/reparto", "mensajero");
    expect(boton()).toHaveAttribute("href", "/ayuda/mensajero/reparto");
  });

  it("en /wallet lleva a la caja, para el maestro", () => {
    montar("/wallet", "maestro");
    expect(boton()).toHaveAttribute("href", "/ayuda/oficina/wallet-caja");
  });

  it("tiene texto además del icono a partir de `sm`, y nombre accesible propio", () => {
    montar("/recoleccion", "mensajero");
    const enlace = boton();
    expect(enlace).toHaveTextContent("Ayuda");
    // Distinto del ítem «Ayuda» del menú, que lleva al índice: quien navega por lista de
    // enlaces tiene que poder diferenciarlos.
    expect(enlace).toHaveAttribute("aria-label", "Ayuda de esta pantalla");
  });
});

describe("R11 — NO se monta donde NO hay documento", () => {
  // Las seis rutas del portal sin documento, hoy. Escritas a mano contra el árbol de `app/`.
  it.each([
    ["/mi-bodega", "maestro"],
    ["/configuracion/sinpe", "maestro"],
    ["/mis-asignaciones", "mensajero"],
    ["/ranking/historico", "maestro"],
    ["/recepcion-satelite", "maestro"],
    ["/", "maestro"],
  ] as Array<[string, "mensajero" | "maestro"]>)(
    "en %s no hay «?»",
    (ruta, rol) => {
      montar(ruta, rol);
      expect(boton()).toBeNull();
    },
  );

  it("tampoco en una ruta inventada", () => {
    montar("/pantalla-que-no-existe", "maestro");
    expect(boton()).toBeNull();
  });
});

describe("R12 — el «?» respeta el rol, no sólo la ruta", () => {
  it("/wallet le da ayuda al maestro y NADA al mensajero", () => {
    const { unmount } = montar("/wallet", "maestro");
    expect(boton()).not.toBeNull();
    unmount();

    montar("/wallet", "mensajero");
    expect(boton()).toBeNull();
  });

  it("/ordenes le da el documento de SU portal a cada rol", () => {
    const { unmount } = montar("/ordenes", "maestro");
    expect(boton()).toHaveAttribute("href", "/ayuda/oficina/ordenes");
    unmount();

    montar("/ordenes", "adminTienda");
    expect(boton()).toHaveAttribute("href", "/ayuda/tienda/ordenes");
  });
});

describe("R13 — sin proveedor no se pinta nada (y no revienta)", () => {
  it("montado suelto, como en los tests de encabezado de otras features", () => {
    rutaActual = "/wallet";
    render(<AyudaBoton />);
    expect(boton()).toBeNull();
  });
});
