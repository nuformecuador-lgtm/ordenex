// Feature 211 — el tema como dato puro: ciclo, clases y textos.
// Sin DOM y sin React: lo que estas funciones digan es lo que hace el control.

import { describe, expect, it } from "vitest";

import {
  claseDeTema,
  ETIQUETAS_TEMA,
  TEMA_POR_DEFECTO,
  TEMAS,
  anuncioTema,
  esTema,
  etiquetaAccesibleTema,
  normalizarTema,
  siguienteTema,
  type Tema,
} from "@/lib/tema/tema";

describe("tema — los tres estados", () => {
  it("son tres y el de por defecto es «sistema»", () => {
    expect([...TEMAS]).toEqual(["sistema", "claro", "oscuro"]);
    expect(TEMA_POR_DEFECTO).toBe("sistema");
  });

  it("el ciclo pasa por los TRES y VUELVE a «sistema»: nadie queda atrapado fuera de su preferencia", () => {
    const recorrido: Tema[] = ["sistema"];
    for (let i = 0; i < 3; i += 1) recorrido.push(siguienteTema(recorrido[i]!));

    expect(recorrido).toEqual(["sistema", "claro", "oscuro", "sistema"]);
    // Y dicho de la otra forma, por si alguien reordena: el ciclo visita los tres.
    expect(new Set(recorrido)).toEqual(new Set(TEMAS));
  });

  it("desde CUALQUIER estado se llega a «sistema» en como mucho tres pulsaciones", () => {
    for (const inicio of TEMAS) {
      let actual: Tema = inicio;
      let pulsaciones = 0;
      while (actual !== "sistema" && pulsaciones < 3) {
        actual = siguienteTema(actual);
        pulsaciones += 1;
      }
      expect(actual, `desde ${inicio} no se vuelve a «sistema»`).toBe("sistema");
    }
  });

  it("cada estado tiene su clase en globals.css y las tres son distintas", () => {
    expect(claseDeTema("oscuro")).toBe("dark");
    expect(claseDeTema("claro")).toBe("tema-claro");
    expect(claseDeTema("sistema")).toBe("tema-sistema");
    expect(new Set(TEMAS.map(claseDeTema)).size).toBe(3);
  });

  it("un valor ausente o manipulado a mano cae en «sistema», no rompe el render", () => {
    expect(normalizarTema(undefined)).toBe("sistema");
    expect(normalizarTema("")).toBe("sistema");
    expect(normalizarTema("Oscuro")).toBe("sistema");
    expect(normalizarTema("<script>")).toBe("sistema");
    expect(normalizarTema("oscuro")).toBe("oscuro");
    expect(esTema("claro")).toBe(true);
    expect(esTema("azul")).toBe(false);
  });
});

describe("tema — lo que se anuncia", () => {
  it("el nombre accesible dice en cual estas Y a cual vas", () => {
    for (const tema of TEMAS) {
      const nombre = etiquetaAccesibleTema(tema);
      expect(nombre, `${tema}: no nombra el estado actual`).toContain(ETIQUETAS_TEMA[tema]);
      expect(nombre, `${tema}: no nombra el estado siguiente`).toContain(
        ETIQUETAS_TEMA[siguienteTema(tema)],
      );
      // WCAG 2.5.3: el nombre accesible empieza por la etiqueta VISIBLE del control.
      expect(nombre.indexOf(ETIQUETAS_TEMA[tema])).toBeLessThan(
        nombre.indexOf(ETIQUETAS_TEMA[siguienteTema(tema)]),
      );
    }
  });

  it("el anuncio nombra el estado YA aplicado y es distinto para cada uno", () => {
    const anuncios = TEMAS.map(anuncioTema);
    expect(new Set(anuncios).size).toBe(3);
    for (const tema of TEMAS) {
      expect(anuncioTema(tema).toLowerCase()).toContain(ETIQUETAS_TEMA[tema].toLowerCase());
    }
  });
});
