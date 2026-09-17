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
type RolDePrueba = "mensajero" | "maestro" | "adminTienda" | "adminSatelite";

function montar(ruta: string, rol: RolDePrueba) {
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

  // ⭑ FICHA 434 — las tres pantallas que hasta ahora no tenían documento. Estaban escritas,
  // una por una, en la lista de «aquí no hay ?» de R11: se MUEVEN aquí, no se borran de allá,
  // porque lo que la ficha cambia es de qué lado de la raya están.
  it("en /configuracion/sinpe lleva al documento de la oficina", () => {
    montar("/configuracion/sinpe", "maestro");
    expect(boton()).toHaveAttribute("href", "/ayuda/oficina/configuracion-sinpe");
  });

  it("en /mi-bodega lleva al del satélite, que es quien la abre", () => {
    montar("/mi-bodega", "adminSatelite");
    expect(boton()).toHaveAttribute("href", "/ayuda/satelite/mi-bodega");
  });

  it("en /ranking/historico lleva al MISMO documento que /ranking", () => {
    // No hay un documento nuevo: `mensajero/ranking.md` ya tenía su sección «Histórico» y lo
    // que se le añadió fue la segunda ruta en su `pantalla:`. Es el mapa de muchos a uno que
    // `rutasDeDocumento` hace posible, y el precedente vivo es
    // `publico/entrar-y-recuperar-contrasena.md` con `/login, /recuperar-contrasena`.
    const { unmount } = montar("/ranking", "maestro");
    expect(boton()).toHaveAttribute("href", "/ayuda/mensajero/ranking");
    unmount();

    montar("/ranking/historico", "maestro");
    expect(boton()).toHaveAttribute("href", "/ayuda/mensajero/ranking");
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
  // Las rutas sin «?», escritas a mano contra el árbol de `app/` (medido el 2026-09-16).
  //
  // ⭑ FICHA 434 — YA NO QUEDA NINGUNA PANTALLA DEL PORTAL EN ESTA LISTA, y eso es el cierre de
  // la ficha. Las tres que había —`/mi-bodega`, `/configuracion/sinpe` y `/ranking/historico`—
  // pasaron a R10. Lo que sobrevive son las dos redirecciones puras —que ni siquiera pintan
  // encabezado— y la landing `/`, que vive fuera de `app/(app)`: no son «ayuda que falta», son
  // sitios donde no hay encabezado que llevarla.
  it.each([
    ["/mis-asignaciones", "mensajero"],
    ["/recepcion-satelite", "maestro"],
    ["/", "maestro"],
  ] as Array<[string, RolDePrueba]>)(
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

  // ⭑ FICHA 434 — el caso de `/mi-bodega` + `maestro` estaba en R11 («no hay documento») y
  // ahora vive aquí: el documento EXISTE, y lo que deja al maestro sin «?» es el rol.
  it("/mi-bodega le da ayuda al adminSatelite y NADA al maestro", () => {
    const { unmount } = montar("/mi-bodega", "adminSatelite");
    expect(boton()).not.toBeNull();
    unmount();

    montar("/mi-bodega", "maestro");
    expect(boton()).toBeNull();
  });

  it("/configuracion/sinpe le da ayuda al maestro y NADA al adminSatelite", () => {
    // ⚠️ AQUÍ EL DOCUMENTO ES MÁS ESTRECHO QUE EL GATE DE LA PANTALLA, A PROPÓSITO.
    // `puedeEditarAlgunSinpe` deja entrar TAMBIÉN al `adminSatelite` (`lib/types/sinpe-bodega.ts`),
    // pero lo que ese rol ve ahí es UNA fila, la suya, mientras el documento describe la tabla de
    // todas las bodegas y el distintivo «Central». Enseñárselo sería documentación que le miente,
    // que es lo que el README de `docs/ayuda/` prohíbe antes que nada. Su pantalla es
    // `/mi-bodega`, y ahí sí tiene la suya.
    const { unmount } = montar("/configuracion/sinpe", "maestro");
    expect(boton()).not.toBeNull();
    unmount();

    montar("/configuracion/sinpe", "adminSatelite");
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
