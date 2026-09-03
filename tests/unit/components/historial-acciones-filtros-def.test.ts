import { describe, it, expect } from "vitest";

import { codigoSinComentarios } from "@/tests/fixtures/sin-comentarios";

import {
  CLAVES_OFRECIDAS,
  CLAVE_ACCION,
  CLAVE_ACTOR,
  CLAVE_BUSQUEDA,
  CLAVE_CATEGORIA,
  CLAVE_ENTIDAD,
  CLAVE_FECHA,
  PLACEHOLDER_BUSQUEDA,
  construirFiltrosHistorialAcciones,
} from "@/app/(app)/historico/acciones/_components/historial-acciones-filtros-def";
import { ATAJOS_CREACION } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import {
  ACCION_LABELS,
  CATEGORIAS_ACCION,
  ENTIDAD_LABELS,
  HISTORIAL_ACCION_ENTIDADES,
  HISTORIAL_ACCION_TIPOS,
  filtroHistorialAccionSchema,
} from "@/lib/types/historial-accion";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";

// FICHA 362 / T5.3 (R28/R29/R32) — la barra del historial DECLARA lo que dice declarar.
//
// Los dos casos que importan y que no se pueden deducir leyendo:
//   · R29 — los CINCO filtros y su orden. Retirar uno del selector deja el `toEqual` rojo.
//   · R32 — el `minChars` del control ES la constante del borde, no un `3` escrito a mano.

const AHORA = new Date("2026-09-02T18:00:00Z");

const ACTORES = [
  { id: "u1", nombre: "Ana Mora" },
  { id: "u2", nombre: "Beto Cruz" },
];

describe("R29 — la barra ofrece los cinco filtros, en su orden", () => {
  it("las claves declaradas son las seis: el campo de búsqueda y los cinco filtros", () => {
    const claves = construirFiltrosHistorialAcciones(ACTORES, { ahora: AHORA }).map(
      (f) => f.key,
    );

    expect(claves).toEqual([
      CLAVE_BUSQUEDA,
      CLAVE_CATEGORIA,
      CLAVE_ACCION,
      CLAVE_ACTOR,
      CLAVE_ENTIDAD,
      CLAVE_FECHA,
    ]);
  });

  it("las que el SELECTOR ofrece son exactamente las cinco de R29, sin `q`", () => {
    // `q` es el CAMPO de la barra, no un filtro que se pide (lección de la 321): si apareciera
    // en el selector, su `minChars` dejaría de venir de un solo sitio.
    const ofrecidas = construirFiltrosHistorialAcciones(ACTORES, { ahora: AHORA })
      .map((f) => f.key)
      .filter((k) => k !== CLAVE_BUSQUEDA);

    expect(ofrecidas).toEqual([...CLAVES_OFRECIDAS]);
    expect(ofrecidas).toHaveLength(5);
    expect(ofrecidas).not.toContain(CLAVE_BUSQUEDA);
  });

  it("cada filtro tiene etiqueta visible: un control sin nombre no es accesible", () => {
    for (const f of construirFiltrosHistorialAcciones(ACTORES, { ahora: AHORA })) {
      expect(f.label.trim(), `el filtro ${f.key} no declara etiqueta`).not.toBe("");
    }
  });
});

describe("R32 — el mínimo de caracteres sale de la constante del borde", () => {
  it("el `minChars` del control ES `BUSQUEDA_MIN_CHARS`", () => {
    const busqueda = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (f) => f.key === CLAVE_BUSQUEDA,
    );

    expect(busqueda?.minChars).toBe(BUSQUEDA_MIN_CHARS);
  });

  it("y el borde rechaza EXACTAMENTE por debajo de ese mismo mínimo", () => {
    // La prueba que hace que la de arriba signifique algo: control y borde se comparan contra
    // la misma fuente. Escribir un `3` a mano en el control pasaría el caso anterior el día
    // que el borde subiera el mínimo, y el usuario mandaría términos que el servidor rechaza.
    const corto = "x".repeat(BUSQUEDA_MIN_CHARS - 1);
    const justo = "x".repeat(BUSQUEDA_MIN_CHARS);

    expect(filtroHistorialAccionSchema.safeParse({ q: corto }).success).toBe(false);
    expect(filtroHistorialAccionSchema.safeParse({ q: justo }).success).toBe(true);
  });

  it("⭑ el fuente NOMBRA la constante y NO escribe el número a mano", () => {
    /**
     * ⚠️ ESTE CASO EXISTE PORQUE LA MUTACIÓN DE ARRIBA SOBREVIVIÓ EN VERDE (medido el
     * 2026-09-02): cambiar `minChars: BUSQUEDA_MIN_CHARS` por `minChars: 3` pasaba los trece
     * casos de este archivo, porque `toBe(BUSQUEDA_MIN_CHARS)` compara el VALOR —3 contra 3—
     * y no la PROCEDENCIA. Es la familia «aserción contra su propia fuente» que este repo ya
     * tiene documentada: mientras la constante valga 3, el literal y la constante son
     * indistinguibles por comportamiento.
     *
     * No hay forma de distinguirlos en tiempo de ejecución, así que se mira el FUENTE, igual
     * que hacen las guardias de roles. Lo que R32 prohíbe es el `3` escrito a mano: el día que
     * el borde suba el mínimo, el control seguiría mandando términos que el servidor ya
     * rechaza, y nadie se enteraría.
     */
    const fuente = codigoSinComentarios(
      "app/(app)/historico/acciones/_components/historial-acciones-filtros-def.ts",
    );

    expect(fuente).toContain("minChars: BUSQUEDA_MIN_CHARS");
    // Ningún `minChars` con un número literal, en ninguna de sus formas.
    expect(fuente).not.toMatch(/minChars:\s*\d/);
    // Anti-vacuidad: el quitador no dejó el archivo vacío ni la ruta apunta a un fichero que
    // ya no existe.
    expect(fuente.length).toBeGreaterThan(500);
    expect(fuente).toContain("CLAVE_BUSQUEDA");
  });

  it("CONTRAPRUEBA: un fuente con el número escrito a mano se caza", () => {
    // Sin esto, las dos aserciones de arriba podrían estar pasando por vacío.
    const mutado = "key: CLAVE_BUSQUEDA, kind: \"text\", minChars: 3,";
    expect(mutado).not.toContain("minChars: BUSQUEDA_MIN_CHARS");
    expect(mutado).toMatch(/minChars:\s*\d/);
  });

  it("el placeholder documenta el campo y no promete lo que la búsqueda no alcanza (R31)", () => {
    expect(PLACEHOLDER_BUSQUEDA).toBe("Persona, guía, remisión o nombre de lo afectado");
    // R5: en esta tabla no hay ni un dato de cliente, así que el campo no puede ofrecerlos.
    expect(PLACEHOLDER_BUSQUEDA.toLowerCase()).not.toContain("destinatario");
    expect(PLACEHOLDER_BUSQUEDA.toLowerCase()).not.toContain("teléfono");
    expect(PLACEHOLDER_BUSQUEDA.toLowerCase()).not.toContain("dirección");
  });
});

describe("las opciones salen del CONTRATO, no de una copia local", () => {
  it("categoría: las tres, con las etiquetas del contrato", () => {
    const cat = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (f) => f.key === CLAVE_CATEGORIA,
    );
    expect(cat?.options).toHaveLength(CATEGORIAS_ACCION.length);
    expect(cat?.options?.map((o) => o.value)).toEqual([...CATEGORIAS_ACCION]);
  });

  it("acción: los 43 tipos, etiquetados con `ACCION_LABELS`", () => {
    const acc = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (f) => f.key === CLAVE_ACCION,
    );
    expect(acc?.options).toHaveLength(HISTORIAL_ACCION_TIPOS.length);
    // Copiar las etiquetas aquí produciría el peor fallo posible en un registro: el filtro
    // diciendo una cosa y la fila que devuelve, otra. Se afirma contra la MISMA fuente que
    // congela `accionLabel` en el servidor.
    for (const o of acc?.options ?? []) {
      expect(o.label).toBe(ACCION_LABELS[o.value as keyof typeof ACCION_LABELS]);
    }
  });

  it("entidad: las 17, etiquetadas con `ENTIDAD_LABELS`", () => {
    const ent = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (f) => f.key === CLAVE_ENTIDAD,
    );
    expect(ent?.options).toHaveLength(HISTORIAL_ACCION_ENTIDADES.length);
    for (const o of ent?.options ?? []) {
      expect(o.label).toBe(ENTIDAD_LABELS[o.value as keyof typeof ENTIDAD_LABELS]);
    }
  });

  it("persona: las opciones son el catálogo recibido, tal cual", () => {
    const actor = construirFiltrosHistorialAcciones(ACTORES, { ahora: AHORA }).find(
      (f) => f.key === CLAVE_ACTOR,
    );
    expect(actor?.options).toEqual([
      { value: "u1", label: "Ana Mora" },
      { value: "u2", label: "Beto Cruz" },
    ]);
  });

  it("un catálogo VACÍO declara el filtro igual, sin opciones (R64 de la 144)", () => {
    // Una barra que desaparece se lee como «esta pantalla no filtra»; una barra montada y sin
    // opciones se lee como «no hay a quién filtrar», que es lo cierto.
    const actor = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (f) => f.key === CLAVE_ACTOR,
    );
    expect(actor).toBeDefined();
    expect(actor?.options).toEqual([]);
  });

  it("fecha: los atajos son los IMPORTADOS de `/ordenes`, no una tabla gemela", () => {
    const fecha = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (f) => f.key === CLAVE_FECHA,
    );
    expect(fecha?.kind).toBe("dateRange");
    expect(fecha?.options?.map((o) => o.value)).toEqual(ATAJOS_CREACION.map((a) => a.value));
    // Y cada atajo trae su rango resuelto: sin `defaultRange` el control no lo ofrece.
    for (const o of fecha?.options ?? []) {
      expect(o.defaultRange).toBeDefined();
    }
  });

  it("ningún filtro declara `dependsOn`: categoría y acción se INTERSECAN, no se encadenan", () => {
    // Encadenar la acción a la categoría escondería las acciones al elegir una categoría y
    // volvería imposible pedir «cualquier acción de estas dos categorías» (R17).
    for (const f of construirFiltrosHistorialAcciones(ACTORES, { ahora: AHORA })) {
      expect(f.dependsOn, `${f.key} declara dependsOn`).toBeUndefined();
    }
  });
});
