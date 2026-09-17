// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import { AyudaBoton } from "@/components/shared/AyudaBoton";
import { AsistentePanel } from "@/components/shared/AsistentePanel";
import { AyudaProvider } from "@/providers/AyudaProvider";
import { AsistenteProvider } from "@/providers/AsistenteProvider";
import { leerResumenesAyuda } from "@/lib/ayuda/catalogo";
import { mapaRutaDocumento } from "@/lib/ayuda/documento";

// ⭑ FICHA 433 — EL «?» DEL ENCABEZADO.
//
// La regla que este archivo vigila es de una sola línea y es la que hace que el botón valga
// algo: **si la pantalla no tiene documento, el botón NO se monta**. Un «?» que abre un 404 es
// peor que no tener «?», porque cobra el clic y la esperanza justo a quien estaba perdido.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 436 (T17 — R26, Q3 opción A) — EL CONTROL CAMBIÓ DE FORMA, NO DE PROMESA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
// El «?» ya no es un `<Link>` a `/ayuda/<slug>`: es un disparador que ABRE EL ASISTENTE sin salir
// de la pantalla, y le pasa ese mismo slug como contexto de partida. La ayuda escrita sigue a un
// toque —es la primera acción visible dentro del panel—, así que no se pierde nada de la 433.
//
// ⚠️ LAS OCHO ASERCIONES DE `href` DE ESTE ARCHIVO SE MOVIERON A MANO, UNA POR UNA, Y SIGUEN
// AFIRMANDO LO MISMO: que el control existe en esa pantalla y que lleva ESE slug como contexto
// (`data-ayuda-slug`). No se borraron ni se aflojaron — son la red que impide que el «?»
// desaparezca de las 29 pantallas del portal, y ya sobrevivió una mutación por no estar bien
// puesta. Lo que cambia es el selector (`link` -> `button`) y el atributo, porque el control es
// otro; lo que NO cambia es qué documento ofrece cada pantalla a cada rol.
//
// El «abre el panel» de verdad —no sólo el selector— se mide abajo, en su propio bloque.

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
    // ⚠️ LOS DOS PROVEEDORES, porque en `app/(app)/layout.tsx` salen del MISMO sitio: el mapa de
    // la 433 y el asistente de la 436 están o no están a la vez. Montar sólo el de ayuda dejaría
    // un «?» que se pinta y no abre nada — que es justo el fallo mudo que hay que poder ver.
    <AsistenteProvider>
      <AyudaProvider mapa={mapaRutaDocumento(resumenes, rol)}>
        <AyudaBoton />
      </AyudaProvider>
    </AsistenteProvider>,
  );
}

// El control es ahora un `button`. Cambiar esto de vuelta a `link` es, por sí solo, la señal de
// que alguien deshizo T17.
const boton = () => screen.queryByRole("button", { name: "Ayuda de esta pantalla" });

beforeEach(() => {
  rutaActual = "/";
});

describe("R10 — se monta donde HAY documento", () => {
  it("en /mis-asignaciones/reparto ofrece el documento del mensajero como contexto", () => {
    montar("/mis-asignaciones/reparto", "mensajero");
    expect(boton()).toHaveAttribute("data-ayuda-slug", "mensajero/reparto");
  });

  it("en /wallet ofrece la caja, para el maestro", () => {
    montar("/wallet", "maestro");
    expect(boton()).toHaveAttribute("data-ayuda-slug", "oficina/wallet-caja");
  });

  // ⭑ FICHA 434 — las tres pantallas que hasta ahora no tenían documento. Estaban escritas,
  // una por una, en la lista de «aquí no hay ?» de R11: se MUEVEN aquí, no se borran de allá,
  // porque lo que la ficha cambia es de qué lado de la raya están.
  it("en /configuracion/sinpe ofrece el documento de la oficina", () => {
    montar("/configuracion/sinpe", "maestro");
    expect(boton()).toHaveAttribute("data-ayuda-slug", "oficina/configuracion-sinpe");
  });

  it("en /mi-bodega ofrece el del satélite, que es quien la abre", () => {
    montar("/mi-bodega", "adminSatelite");
    expect(boton()).toHaveAttribute("data-ayuda-slug", "satelite/mi-bodega");
  });

  it("en /ranking/historico ofrece el MISMO documento que /ranking", () => {
    // No hay un documento nuevo: `mensajero/ranking.md` ya tenía su sección «Histórico» y lo
    // que se le añadió fue la segunda ruta en su `pantalla:`. Es el mapa de muchos a uno que
    // `rutasDeDocumento` hace posible, y el precedente vivo es
    // `publico/entrar-y-recuperar-contrasena.md` con `/login, /recuperar-contrasena`.
    const { unmount } = montar("/ranking", "maestro");
    expect(boton()).toHaveAttribute("data-ayuda-slug", "mensajero/ranking");
    unmount();

    montar("/ranking/historico", "maestro");
    expect(boton()).toHaveAttribute("data-ayuda-slug", "mensajero/ranking");
  });

  it("tiene texto además del icono a partir de `sm`, y nombre accesible propio", () => {
    montar("/recoleccion", "mensajero");
    const control = boton();
    expect(control).toHaveTextContent("Ayuda");
    // Distinto del ítem «Ayuda» del menú, que lleva al índice: quien navega por lista de
    // controles tiene que poder diferenciarlos.
    expect(control).toHaveAttribute("aria-label", "Ayuda de esta pantalla");
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
    expect(boton()).toHaveAttribute("data-ayuda-slug", "oficina/ordenes");
    unmount();

    montar("/ordenes", "adminTienda");
    expect(boton()).toHaveAttribute("data-ayuda-slug", "tienda/ordenes");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 436 · R26 — **EL «?» ABRE EL ASISTENTE**, y esto no lo mide un selector.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Los casos de arriba afirman que el control existe y con qué slug. Eso lo pasaría igual de verde
// un `<button>` que no hiciera NADA al pulsarlo — y un botón inerte es exactamente la forma en la
// que esta ficha se rompería sin ruido, porque la opción A no le dejó al asistente ninguna otra
// puerta. Por eso aquí se monta el PANEL DE VERDAD y se mira qué pasa tras el clic.
describe("436/R26 — el «?» abre el panel, en la misma pantalla", () => {
  /** El árbol de la aplicación: proveedores, el botón dentro y el panel como HERMANO. */
  function montarConPanel(ruta: string, rol: RolDePrueba) {
    rutaActual = ruta;
    return render(
      <AsistenteProvider fetchImpl={() => Promise.reject(new Error("la suite no toca la red"))}>
        <AyudaProvider mapa={mapaRutaDocumento(resumenes, rol)}>
          <AyudaBoton />
        </AyudaProvider>
        <AsistentePanel />
      </AsistenteProvider>,
    );
  }

  it("⭑ antes del clic no hay panel; después del clic, sí", async () => {
    const usuario = userEvent.setup();
    montarConPanel("/mis-asignaciones/reparto", "mensajero");

    expect(screen.queryByRole("dialog")).toBeNull();
    await usuario.click(boton()!);

    const panel = await screen.findByRole("dialog");
    expect(panel).toHaveAccessibleName("Asistente");
  });

  it("⭑ y el panel arranca con EL DOCUMENTO DE ESA PANTALLA, que es lo que el `href` daba antes", async () => {
    const usuario = userEvent.setup();
    montarConPanel("/mis-asignaciones/reparto", "mensajero");
    await usuario.click(boton()!);

    // La ayuda escrita de la 433 NO se perdió: es la primera acción visible del panel, al mismo
    // destino al que llevaba el enlace que este control era.
    const panel = await screen.findByRole("dialog");
    expect(
      within(panel).getByRole("link", { name: /Leer la ayuda de esta pantalla/ }),
    ).toHaveAttribute("href", "/ayuda/mensajero/reparto");
  });

  it("⭑ el contexto es el de LA PANTALLA EN LA QUE ESTÁS, no uno fijo", async () => {
    // El control negativo del caso de arriba: un slug constante lo pasaría igual.
    const usuario = userEvent.setup();
    montarConPanel("/ordenes", "adminTienda");
    await usuario.click(boton()!);

    const panel = await screen.findByRole("dialog");
    expect(
      within(panel).getByRole("link", { name: /Leer la ayuda de esta pantalla/ }),
    ).toHaveAttribute("href", "/ayuda/tienda/ordenes");
  });

  it("⭑ y NO se navega: el «?» ya no es un enlace a ninguna parte", async () => {
    const usuario = userEvent.setup();
    montarConPanel("/wallet", "maestro");

    // Si alguien devolviera el control a `<Link href=…>`, esto se pondría rojo por el `href` Y
    // por el panel que nunca aparece — las dos mitades de R26.
    expect(boton()).not.toHaveAttribute("href");
    await usuario.click(boton()!);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("R13 — sin proveedor no se pinta nada (y no revienta)", () => {
  it("montado suelto, como en los tests de encabezado de otras features", () => {
    rutaActual = "/wallet";
    render(<AyudaBoton />);
    expect(boton()).toBeNull();
  });
});
