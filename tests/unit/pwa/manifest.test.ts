import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Feature 64 (PWA) + feature 164 (screenshots) — guardia del manifest.
//
// Un manifest que declara un archivo inexistente, o unas dimensiones que no son las del PNG
// real, NO rompe nada visible: simplemente el navegador degrada el diálogo de instalación (o
// deja de ofrecerlo) sin decir nada. Por eso se comprueba aquí: es un fallo silencioso.

const RAIZ = process.cwd();
const MANIFEST_PATH = path.join(RAIZ, "public/manifest.json");

interface Recurso {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
  form_factor?: "narrow" | "wide";
  label?: string;
}

interface Manifest {
  name: string;
  short_name?: string;
  description?: string;
  start_url: string;
  scope?: string;
  display: string;
  icons: Recurso[];
  screenshots?: Recurso[];
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

/** Dimensiones reales del PNG, leídas de su cabecera IHDR (bytes 16-24). */
function dimensionesPng(rutaPublica: string): { ancho: number; alto: number } {
  const buffer = readFileSync(path.join(RAIZ, "public", rutaPublica));
  expect(buffer.subarray(1, 4).toString()).toBe("PNG");
  return { ancho: buffer.readUInt32BE(16), alto: buffer.readUInt32BE(20) };
}

const iconos = manifest.icons;
const screenshots = manifest.screenshots ?? [];
const todos: Recurso[] = [...iconos, ...screenshots];

describe("manifest — criterios de instalabilidad", () => {
  it("declara los campos que el navegador exige para ofrecer instalar", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    // `standalone` (o `fullscreen`/`minimal-ui`); `browser` NO es instalable.
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(manifest.display);
  });

  it("incluye los iconos de 192 y 512, que son los exigidos", () => {
    const tamanos = iconos.map((i) => i.sizes);
    expect(tamanos).toContain("192x192");
    expect(tamanos).toContain("512x512");
  });
});

describe("manifest — coherencia con los archivos en disco", () => {
  it.each(todos.map((r) => [r.src, r] as const))(
    "%s existe en public/",
    (src) => {
      expect(existsSync(path.join(RAIZ, "public", src))).toBe(true);
    },
  );

  it.each(todos.map((r) => [r.src, r] as const))(
    "%s mide exactamente lo que declara",
    (src, recurso) => {
      const { ancho, alto } = dimensionesPng(src);
      expect(`${ancho}x${alto}`).toBe(recurso.sizes);
    },
  );

  it("todo recurso declarado como PNG lo es de verdad", () => {
    for (const recurso of todos) {
      if (recurso.type) expect(recurso.type).toBe("image/png");
      expect(recurso.src.endsWith(".png")).toBe(true);
    }
  });
});

describe("manifest — screenshots del diálogo de instalación", () => {
  it("hay al menos una para móvil y una para escritorio", () => {
    // Sin una `narrow`, Android degrada al aviso pequeño en vez de la ficha completa.
    expect(screenshots.some((s) => s.form_factor === "narrow")).toBe(true);
    expect(screenshots.some((s) => s.form_factor === "wide")).toBe(true);
  });

  it("todas las de móvil comparten proporción, como exige el navegador", () => {
    const proporciones = screenshots
      .filter((s) => s.form_factor === "narrow")
      .map((s) => {
        const [ancho, alto] = s.sizes.split("x").map(Number);
        return (ancho / alto).toFixed(3);
      });

    expect(new Set(proporciones).size).toBe(1);
  });

  it("todas llevan etiqueta descriptiva", () => {
    for (const s of screenshots) {
      expect(s.label, `falta label en ${s.src}`).toBeTruthy();
    }
  });

  it("ninguna excede el límite de 3840px del navegador", () => {
    for (const s of screenshots) {
      const [ancho, alto] = s.sizes.split("x").map(Number);
      expect(Math.max(ancho, alto)).toBeLessThanOrEqual(3840);
      expect(Math.min(ancho, alto)).toBeGreaterThanOrEqual(320);
    }
  });
});
