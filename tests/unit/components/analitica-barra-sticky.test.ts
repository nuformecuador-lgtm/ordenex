import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// La barra de filtros de /analítica se queda pegada arriba al hacer scroll (pedido humano del
// 2026-08-18). La sección tiene cuatro gráficas y crece: sin esto hay que volver arriba para
// cambiar un filtro y volver a bajar para ver el efecto.
//
// Se comprueba sobre el CÓDIGO y no renderizando: `position: sticky` depende de la cadena de
// ancestros y de la altura real del documento, y jsdom no calcula layout — un test de render
// pasaría con o sin la clase. Lo que sí es verificable es dónde vive la decisión y que sus
// piezas siguen puestas.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const PAGINA = path.join(REPO_ROOT, "app", "(app)", "analitica", "page.tsx");
const BARRA = path.join(REPO_ROOT, "app", "(app)", "_components", "FiltrosEntregas.tsx");
const LAYOUT = path.join(REPO_ROOT, "app", "(app)", "layout.tsx");

const pagina = fs.readFileSync(PAGINA, "utf8");

describe("La barra de filtros de analítica es pegajosa", () => {
  it("la página envuelve la barra en un contenedor `sticky top-0`", () => {
    expect(pagina).toMatch(/sticky top-0/);
    // Y envuelve A LA BARRA, no a otra cosa: el `<FiltrosEntregas />` va dentro del div.
    expect(pagina).toMatch(/sticky top-0[^"]*"[^]{0,80}?<FiltrosEntregas \/>/);
  });

  // ⚠ EL PECADO QUE ESTE CASO PERSIGUE. `FiltrosEntregas` la monta TAMBIÉN el panel maestro de
  // `/dashboard`, donde nadie ha pedido esto y donde el alto de la página es otro. Pegarla
  // dentro del componente la pegaría en las dos pantallas de una vez, y el segundo sitio no se
  // vería en ninguna revisión de este cambio.
  it("el `sticky` NO vive dentro del componente compartido", () => {
    expect(fs.readFileSync(BARRA, "utf8")).not.toMatch(/\bsticky\b/);
  });

  // Sin fondo, las gráficas se ven POR DEBAJO de los controles al hacer scroll. Se usa el mismo
  // tratamiento que la barra pegajosa de `Pagination` en vez de inventar otro.
  it("lleva fondo y desenfoque, como la otra barra pegajosa del repo", () => {
    expect(pagina).toMatch(/bg-background\/70/);
    expect(pagina).toMatch(/backdrop-blur-md/);

    const paginacion = fs.readFileSync(
      path.join(REPO_ROOT, "components", "shared", "Pagination.tsx"),
      "utf8",
    );
    expect(paginacion, "el patrón que se dice reusar ya no existe").toMatch(/bg-background\/70/);
  });

  // `Container` mete `p-6`; sin compensarlo, el fondo difuminado acaba antes que el borde y
  // quedan dos franjas nítidas a los lados por las que se ve pasar el contenido.
  it("compensa el padding del `Container` para cubrir todo el ancho", () => {
    expect(pagina).toMatch(/-mx-6/);
    expect(pagina).toMatch(/px-6/);

    const container = fs.readFileSync(
      path.join(REPO_ROOT, "components", "shared", "Container.tsx"),
      "utf8",
    );
    expect(container, "`Container` ya no usa `p-6`: revisar la compensación").toMatch(/\bp-6\b/);
  });

  // La pieza de la que depende todo y que NO está en esta página: si alguien cambiase el
  // `overflow-x-clip` del layout por `overflow-hidden`, el `main` pasaría a ser contenedor de
  // scroll vertical y el `sticky` dejaría de tener contra qué pegarse — sin que nada fallara.
  it("el layout NO convierte el main en contenedor de scroll vertical", () => {
    const layout = fs.readFileSync(LAYOUT, "utf8");

    expect(layout).toMatch(/overflow-x-clip/);
    expect(layout, "un `overflow-hidden` aquí rompe el sticky en silencio").not.toMatch(
      /SidebarInset[^]{0,200}overflow-hidden/,
    );
  });
});
