// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import { renderizarMarkdown } from "@/lib/ayuda/markdown";

// ⭑ FICHA 433 — el renderizador de Markdown: que lo que dice el `.md` sea lo que se ve.

const pintar = (md: string) => render(<div>{renderizarMarkdown(md)}</div>);

describe("R6 — los bloques que los 31 documentos usan de verdad", () => {
  it("los títulos BAJAN un nivel: el <h1> de la página es el del PageHeader", () => {
    pintar("# Reparto\n\n## Qué vas a ver\n");
    expect(screen.getByRole("heading", { level: 2, name: "Reparto" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Qué vas a ver" })).toBeInTheDocument();
    // Y NINGUNO es un h1: duplicar el de la página rompe el esquema de encabezados.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("une las líneas de un párrafo partido (el Markdown de la carpeta corta a ~100 columnas)", () => {
    pintar("Aquí están los paquetes que\nya llevás encima.\n");
    expect(
      screen.getByText("Aquí están los paquetes que ya llevás encima."),
    ).toBeInTheDocument();
  });

  it("las negritas salen en <strong> y no como asteriscos", () => {
    const { container } = pintar("Los que **ya llevás encima** cuentan.\n");
    expect(container.querySelector("strong")?.textContent).toBe("ya llevás encima");
    expect(container.textContent).not.toContain("**");
  });

  it("cursiva y código en línea", () => {
    const { container } = pintar("salen de *tus propias órdenes*, con `{{guia}}` dentro.\n");
    expect(container.querySelector("em")?.textContent).toBe("tus propias órdenes");
    expect(container.querySelector("code")?.textContent).toBe("{{guia}}");
  });

  it("las listas son <ul>/<ol> con un <li> por ítem, y la continuación sangrada se pega al suyo", () => {
    const { container } = pintar(
      "- **El buscador**: escribí el número de guía.\n- Filtro por cantón: las opciones salen\n  de tus órdenes.\n",
    );
    const items = container.querySelectorAll("ul li");
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toBe("Filtro por cantón: las opciones salen de tus órdenes.");
  });

  it("la lista numerada es <ol>", () => {
    const { container } = pintar("1. Primero\n2. Después\n");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("la tabla se pinta como tabla, con cabeceras de columna", () => {
    pintar(
      "| Grupo | Qué hay ahí |\n| --- | --- |\n| **En reparto** | Lo que llevás |\n| Para recoger | En bodega |\n",
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Grupo",
      "Qué hay ahí",
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    // La fila separadora `| --- |` NO es una fila de datos.
    expect(screen.queryByText("---")).toBeNull();
  });

  it("la cita es un <blockquote> (es donde el README pone los avisos de riesgo)", () => {
    const { container } = pintar(
      "> **Sobre tu ubicación:** la app no te pide el GPS al entrar.\n> Solo lo usa cuando tocás Sincronizar.\n",
    );
    const cita = container.querySelector("blockquote");
    expect(cita).not.toBeNull();
    expect(cita?.textContent).toContain("Solo lo usa cuando tocás Sincronizar.");
    expect(container.textContent).not.toContain(">");
  });

  it("el bloque de código se copia TAL CUAL, sin interpretar lo de dentro", () => {
    const { container } = pintar("```\nefectividad = entregadas / asignadas\n```\n");
    expect(container.querySelector("pre code")?.textContent).toBe(
      "efectividad = entregadas / asignadas",
    );
  });

  it("y con etiqueta de lenguaje tampoco pinta la etiqueta", () => {
    const { container } = pintar("```yaml\ntitulo: Reparto\n```\n");
    expect(container.querySelector("pre code")?.textContent).toBe("titulo: Reparto");
    expect(container.textContent).not.toContain("yaml");
  });
});

describe("R7 — el texto de un documento NO puede convertirse en marcado", () => {
  it("un <script> escrito en un .md se pinta como las letras que es", () => {
    const { container } = pintar("Cuidado con <script>alert(1)</script> en el texto.\n");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("R8 — los 31 documentos reales se renderizan enteros", () => {
  it("ninguno revienta, y ninguno deja sintaxis de Markdown a la vista", () => {
    return leerCatalogoAyuda().then((docs) => {
      expect(docs.length).toBeGreaterThanOrEqual(30);
      for (const doc of docs) {
        const { container } = render(<div>{renderizarMarkdown(doc.cuerpo)}</div>);
        const texto = container.textContent ?? "";
        expect(texto.length, `${doc.slug} se renderizó vacío`).toBeGreaterThan(100);
        // Los marcadores que el renderizador tiene que haber consumido.
        expect(texto, `${doc.slug} dejó negritas sin renderizar`).not.toContain("**");
        expect(texto, `${doc.slug} dejó un título sin renderizar`).not.toMatch(/(^|\n)#{1,6} /);
      }
    });
  });

  it("el frontmatter NO acaba en el cuerpo: `fuentes` no se ve nunca", () => {
    return leerCatalogoAyuda().then((docs) => {
      for (const doc of docs) {
        expect(doc.cuerpo, `${doc.slug} arrastró su frontmatter`).not.toContain("fuentes:");
        expect(doc.cuerpo).not.toContain("actualizado:");
      }
    });
  });
});

describe("R9 — el frontmatter se lee tal como lo declara el README de la carpeta", () => {
  it("lee escalares, lista en línea y lista en bloque, y separa el cuerpo", () => {
    const { datos, cuerpo } = partirFrontmatter(
      [
        "---",
        "titulo: Reparto",
        "pantalla: /mis-asignaciones/reparto",
        "roles: [mensajero]",
        "actualizado: 2026-09-15",
        "fuentes:",
        "  - lib/services/MisAsignacionesService.ts",
        "  - app/(app)/mis-asignaciones/_components/RepartoModule.tsx",
        "---",
        "",
        "# Reparto",
        "",
      ].join("\n"),
    );
    expect(datos.titulo).toBe("Reparto");
    expect(datos.pantalla).toBe("/mis-asignaciones/reparto");
    expect(datos.roles).toEqual(["mensajero"]);
    expect(datos.actualizado).toBe("2026-09-15");
    expect(datos.fuentes).toHaveLength(2);
    expect(cuerpo.trimStart()).toBe("# Reparto\n");
  });

  it("un archivo con CRLF se lee igual (si no, `pantalla` no casaría con ninguna ruta)", () => {
    const { datos } = partirFrontmatter(
      "---\r\ntitulo: X\r\npantalla: /ordenes\r\nroles: [admin]\r\n---\r\n\r\n# X\r\n",
    );
    expect(datos.pantalla).toBe("/ordenes");
    expect(datos.roles).toEqual(["admin"]);
  });

  it("un archivo SIN frontmatter no revienta: devuelve el texto entero como cuerpo", () => {
    const { datos, cuerpo } = partirFrontmatter("# Suelto\n\nTexto.\n");
    expect(datos.titulo).toBeUndefined();
    expect(cuerpo).toBe("# Suelto\n\nTexto.\n");
  });
});
