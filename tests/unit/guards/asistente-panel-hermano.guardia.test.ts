import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { RAIZ_DEL_REPO } from "../../fixtures/raices-de-codigo";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 436 · R22, R26, R29, R30 — LA FORMA DEL ÁRBOL DEL ASISTENTE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTA GUARDIA EXISTE. Las cuatro propiedades de abajo no rompen ningún test de
// comportamiento cuando alguien se las carga, y ésa es exactamente la familia de fallos que este
// repo ya conoce: el sistema no falla, aparenta.
//
//   1. **R22 — el panel es HERMANO de `{children}`, jamás envolviéndolo.** Un envoltorio PUEDE
//      dejar de pintar la página entera con un `return null`; un hermano no tiene dónde hacerlo.
//      `AsistentePanel.test.tsx` monta el panel COMO HERMANO, así que pasaría igual de verde si el
//      layout de verdad lo hubiera convertido en envoltorio. Lo que mide eso es este archivo.
//   2. **R26 — el layout monta el proveedor Y el panel.** Sin el proveedor, el «?» de las 29
//      pantallas se queda inerte: sigue pintándose, sigue teniendo su nombre accesible, y no abre
//      nada. Es el «composition root que no inyecta», y no lo caza ningún test de componente —
//      todos montan su propio proveedor—.
//   3. **R29 — no hay audio en el árbol del panel.** Ni `accept` que lo admita, ni grabación.
//   4. **R30 — el cliente no deja rastro.** Un `localStorage.setItem` de buena fe —«para que no se
//      pierda al recargar»— es la forma exacta en la que R30 se rompería, y no pondría rojo nada.
//
// ⚠️ SE MIDE SOBRE EL CÓDIGO SIN COMENTARIOS. Las cabeceras de estos archivos EXPLICAN por qué no
// hay `localStorage` y por qué no hay audio; sin quitarlas, la guardia se dispararía con su propia
// documentación.

const LAYOUT = "app/(app)/layout.tsx";
const PROVEEDOR = "providers/AsistenteProvider.tsx";
const PANEL = "components/shared/AsistentePanel.tsx";
const BOTON = "components/shared/AyudaBoton.tsx";

function leer(rel: string): string {
  return codigoSinComentarios(rel);
}

function existe(rel: string): boolean {
  return fs.existsSync(path.join(RAIZ_DEL_REPO, rel));
}

describe("436/R22 — el panel es HERMANO de `{children}`, jamás envolviéndolo", () => {
  it("los cuatro archivos siguen donde esta guardia los busca (anti-vacuidad)", () => {
    // Si alguien mueve o renombra cualquiera de ellos, esta guardia dejaría de mirar nada sin
    // decirlo — y los tres casos de abajo pasarían por no encontrar nada que censurar.
    for (const rel of [LAYOUT, PROVEEDOR, PANEL, BOTON]) {
      expect(existe(rel), `falta ${rel}`).toBe(true);
    }
  });

  it("⭑ el layout NO envuelve `{children}` con el panel", () => {
    const fuente = leer(LAYOUT);
    expect(fuente).toContain("AsistentePanel");
    // La forma prohibida: `<AsistentePanel …> … {children} … </AsistentePanel>`.
    const envuelve = /<AsistentePanel[^/>]*>[\s\S]*\{children\}/;
    expect(
      envuelve.test(fuente),
      "el panel envuelve {children}: R22 deja de ser estructural",
    ).toBe(false);
  });

  it("⭑ y se monta al lado de los dos hermanos que ya viven ahí por la misma razón", () => {
    const fuente = leer(LAYOUT);
    // `PushReactivacion` y `RevisionSinpeBodega` son el precedente literal de un componente que no
    // pinta caja, no estorba a nadie y vive en el único sitio donde existe una vez por carga.
    expect(fuente).toContain("PushReactivacion");
    expect(fuente).toContain("RevisionSinpeBodega");
    // Y el panel va DESPUÉS de `{children}` en el árbol, que es lo que «hermano» significa aquí.
    expect(fuente.indexOf("<AsistentePanel")).toBeGreaterThan(fuente.indexOf("{children}"));
  });

  it("⭑ CONTRAPRUEBA — un panel convertido en envoltorio pone la guardia roja", () => {
    // Sin esto, el caso de arriba podría estar verde porque el detector no detecta.
    const envuelve = /<AsistentePanel[^/>]*>[\s\S]*\{children\}/;
    const mutado = leer(LAYOUT).replace(
      "<AyudaProvider mapa={mapaAyuda}>{children}</AyudaProvider>",
      "<AsistentePanel><AyudaProvider mapa={mapaAyuda}>{children}</AyudaProvider></AsistentePanel>",
    );
    expect(envuelve.test(mutado)).toBe(true);
  });

  it("⭑ el PROVEEDOR pinta a sus hijos sin ninguna rama (él sí envuelve el portal)", () => {
    // El proveedor no puede ser hermano: el «?» que lo consume vive dentro de `{children}`. Como
    // envuelve, lo que hay que garantizar es lo otro — que no tenga dónde dejar de pintarlos.
    const fuente = leer(PROVEEDOR);
    expect(fuente).toContain("{children}");
    // Ningún `return null` ni `return <></>`: las dos formas de blanquear la aplicación entera.
    expect(fuente).not.toMatch(/return\s+null\s*;/);
    expect(fuente).not.toMatch(/return\s+<>\s*<\/>/);
  });
});

describe("436/R26 — el layout monta el proveedor Y el panel, o el «?» queda inerte", () => {
  it("⭑ el layout del portal monta `AsistenteProvider`", () => {
    // El «?» consume el contexto con un fallo SEGURO (sin proveedor no revienta, pero tampoco
    // abre). Que el proveedor esté montado es, por tanto, la diferencia entre un asistente y un
    // botón que no hace nada — y ningún test de componente lo mediría: todos montan el suyo.
    expect(leer(LAYOUT)).toContain("<AsistenteProvider");
  });

  it("⭑ el «?» abre el panel: ya NO es un enlace a `/ayuda/<slug>`", () => {
    const fuente = leer(BOTON);
    expect(fuente).toContain("useAsistente");
    expect(fuente).toMatch(/abrir\(\s*\{\s*slug/);
    // La forma vieja (ficha 433): `<Link href={`/ayuda/${slug}`}>`. Volver a ella dejaría el
    // asistente sin ninguna puerta, porque la opción A no le dio ninguna otra.
    expect(fuente).not.toMatch(/<Link\s+href=\{`\/ayuda\/\$\{slug\}`\}/);
    expect(fuente).not.toContain('from "next/link"');
  });
});

describe("436/R29 — no hay audio en el árbol del panel, y no es un olvido", () => {
  it("⭑ ANTI-VACUIDAD — el barrido ve de verdad la barra de entrada del panel", () => {
    // ⚠️ ESTO NACIÓ DE UN ROJO AJENO, medido el 2026-09-17, y la medida acabó siendo AL REVÉS de
    // lo que parecía. El comentario del `accept` de este panel decía «image» + barra + asterisco.
    // Esa barra-asterisco ABRE UN COMENTARIO DE BLOQUE para un barrido no ávido, y
    // `superficie-de-uso.guardia.test.ts` —que tiene su PROPIO quitador de comentarios, naíf, en
    // su línea 97— se tragó treinta líneas de JSX y denunció `alElegirArchivo` como un handler
    // «sin referencia» que sí la tenía. Un falso ROJO, no un falso verde.
    //
    // El `codigoSinComentarios` compartido (feature 283) NO se lo traga: es un recorrido con
    // estado que distingue una barra-asterisco dentro de un comentario de línea. Comprobado
    // reintroduciendo el literal: aquel se pone rojo y esta guardia sigue midiendo el JSX entero.
    //
    // Se deja el ancla igual, y por eso va la PRIMERA: cuesta tres líneas y es la diferencia
    // entre «esta guardia no encontró audio» y «esta guardia no encontró nada que mirar».
    const fuente = leer(PANEL);
    expect(fuente, "el barrido no ve el control de adjunto: algo se tragó el JSX").toContain(
      'type="file"',
    );
    expect(fuente).toContain("alElegirArchivo");
    expect(fuente).toContain("ASISTENTE_IMAGEN_MEDIOS.join");
  });

  it("⭑ ni `accept` de audio, ni grabación, ni micrófono", () => {
    const fuente = leer(PANEL);
    // El modelo que responde no transcribe voz: un control de audio sería una promesa falsa.
    expect(fuente).not.toMatch(/audio/i);
    expect(fuente).not.toMatch(/MediaRecorder|getUserMedia|mediaDevices|new Audio\(/);
    // Y el `accept` sale de la LISTA BLANCA que valida el servidor, nunca de un comodín.
    expect(fuente).not.toMatch(/accept=["'{]\s*["']?image\/\*/);
    // Un solo control de archivo en todo el panel: una imagen por mensaje (Q6).
    expect(fuente.match(/type="file"/g) ?? []).toHaveLength(1);
    expect(fuente).not.toContain("multiple");
    // `capture` abriría la cámara y se saltaría la captura de pantalla, que es lo que sirve.
    expect(fuente).not.toMatch(/capture=/);
  });

  it("⭑ y el cliente COMPRIME antes de mandar (el límite de Vercel está por debajo del schema)", () => {
    // El schema admite 5 MB de base64; el cuerpo de un Route Handler en Vercel se corta en ~4,5.
    // Sin compresión, una foto de teléfono falla SÓLO en producción — en local no hay ese límite.
    expect(leer(PANEL)).toContain("comprimirImagen");
  });
});

describe("436/R30 — la mitad de cliente: la conversación no deja rastro en el navegador", () => {
  it("⭑ ni almacenamiento, ni cookie, ni base de datos del navegador", () => {
    for (const rel of [PROVEEDOR, PANEL]) {
      const fuente = leer(rel);
      expect(fuente, rel).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });

  it("⭑ y no manda la conversación a ninguna ruta que no sea la del asistente", () => {
    // Un `fetch` a una ruta de guardado sería la otra forma de romper R30, y no la vería la
    // guardia de persistencia del backend: allí se mira lo que escribe el SERVIDOR.
    const rutas = leer(PROVEEDOR).match(/["'`]\/api\/[^"'`]*["'`]/g) ?? [];
    expect(rutas).toEqual(['"/api/asistente"']);
    expect(leer(PANEL)).not.toMatch(/\bfetch\s*\(/);
  });
});
