import { describe, it, expect } from "vitest";

import { construirFiltrosHistorico } from "@/app/(app)/historico/conversaciones/_components/historico-filtros-def";
import { ATAJOS_CREACION } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

/**
 * Feature 318 — T5.1 (R32, R33, R37): la barra del historico se DECLARA como datos.
 *
 * Todas las aserciones son sobre el valor devuelto por la funcion pura, no sobre el texto
 * del archivo: ninguna se satisface reescribiendo un comentario.
 */

const CATALOGO_VACIO: CatalogoFiltrosOrdenesDTO = {
  zonas: [],
  tiendas: [],
  mensajeros: [],
  provincias: [],
  cantones: [],
  distritos: [],
};

const CATALOGO_CON_MENSAJEROS: CatalogoFiltrosOrdenesDTO = {
  ...CATALOGO_VACIO,
  mensajeros: [
    { id: "m-1", nombre: "Ana Rojas", zonaId: "z-1" },
    { id: "m-2", nombre: "Beto Mora", zonaId: null },
  ],
};

// Instante fijo para que los rangos de los atajos sean comparables.
const AHORA = new Date("2026-08-28T18:00:00.000Z");

describe("R32 — la barra del historico se declara como FilterDef[] (T5.1)", () => {
  it("declara las cuatro claves, en orden y con el `kind` que le toca a cada una", () => {
    const defs = construirFiltrosHistorico(CATALOGO_CON_MENSAJEROS, { ahora: AHORA });

    expect(defs.map((d) => d.key)).toEqual(["q", "mensajero_id", "fecha", "orden"]);
    expect(defs.map((d) => d.kind)).toEqual(["text", "multi", "dateRange", "text"]);
  });

  it("es PURA: dos llamadas con el mismo catalogo y el mismo instante dan lo mismo", () => {
    expect(construirFiltrosHistorico(CATALOGO_CON_MENSAJEROS, { ahora: AHORA })).toEqual(
      construirFiltrosHistorico(CATALOGO_CON_MENSAJEROS, { ahora: AHORA }),
    );
  });

  it("ningun filtro declara `dependsOn`: el historico no ofrece control de zona (design §5.3)", () => {
    const defs = construirFiltrosHistorico(CATALOGO_CON_MENSAJEROS, { ahora: AHORA });

    for (const def of defs) {
      expect(def.dependsOn).toBeUndefined();
    }
  });

  it("R24 — solo lectura: no declara ningun interruptor ni control de escritura", () => {
    const defs = construirFiltrosHistorico(CATALOGO_CON_MENSAJEROS, { ahora: AHORA });

    expect(defs.some((d) => d.kind === "boolean")).toBe(false);
  });
});

describe("R37 — el minimo del buscador sale de la constante del repo (T5.1)", () => {
  it("`minChars` del buscador ES `BUSQUEDA_MIN_CHARS`, no un 3 escrito a mano", () => {
    const defs = construirFiltrosHistorico(CATALOGO_VACIO, { ahora: AHORA });

    // Se compara contra la CONSTANTE IMPORTADA a proposito: si el borde subiera el minimo,
    // este caso seguiria verde y el control seguiria de acuerdo con el servidor. Escribir
    // `toBe(3)` aqui congelaria el valor y es justo la mutacion que R37 prohibe.
    expect(defs[0].minChars).toBe(BUSQUEDA_MIN_CHARS);
  });

  it("el buscador dice lo que alcanza, incluido el MENSAJERO (design §1.2)", () => {
    const defs = construirFiltrosHistorico(CATALOGO_VACIO, { ahora: AHORA });

    // `orden.busqueda_texto` NO cubre el nombre del mensajero; el placeholder lo promete y
    // el servidor lo cumple con la segunda mitad del OR. Si el texto dejara de nombrarlo,
    // el control estaria ocultando la mitad del alcance de R36.
    expect(defs[0].placeholder).toMatch(/mensajero/i);
    expect(defs[0].placeholder).toMatch(/destinatario/i);
  });

  it("el filtro por ORDEN admite un solo caracter: una guia puede tener un digito (R35)", () => {
    const defs = construirFiltrosHistorico(CATALOGO_VACIO, { ahora: AHORA });

    const orden = defs.find((d) => d.key === "orden");
    expect(orden?.minChars).toBe(1);
  });
});

describe("R33 — el filtro por mensajero se puebla del catalogo (T5.1)", () => {
  it("con dos mensajeros en el catalogo, los lista como opciones", () => {
    const defs = construirFiltrosHistorico(CATALOGO_CON_MENSAJEROS, { ahora: AHORA });

    expect(defs[1].key).toBe("mensajero_id");
    expect(defs[1].options).toEqual([
      { value: "m-1", label: "Ana Rojas" },
      { value: "m-2", label: "Beto Mora" },
    ]);
  });

  it("con catalogo VACIO la barra se declara igual, con `options: []` y sin reventar", () => {
    const defs = construirFiltrosHistorico(CATALOGO_VACIO, { ahora: AHORA });

    // La barra montada y sin opciones se lee «no hay a quien filtrar»; una barra que
    // desaparece se lee «esta pantalla no filtra», que es falso.
    expect(defs.map((d) => d.key)).toEqual(["q", "mensajero_id", "fecha", "orden"]);
    expect(defs[1].options).toEqual([]);
  });
});

describe("R34 — el filtro de fecha REUTILIZA los atajos de /ordenes (T5.1)", () => {
  it("ofrece exactamente los `ATAJOS_CREACION`, con su rango calculado desde `ahora`", () => {
    const defs = construirFiltrosHistorico(CATALOGO_VACIO, { ahora: AHORA });

    const fecha = defs.find((d) => d.key === "fecha");
    expect(fecha?.kind).toBe("dateRange");
    expect(fecha?.options).toEqual(
      ATAJOS_CREACION.map((a) => ({
        value: a.value,
        label: a.label,
        defaultRange: ultimosNDiasCalendarioCR(a.dias, AHORA),
      })),
    );
  });

  it("los rangos de los atajos son fechas calendario `YYYY-MM-DD`, sin hora", () => {
    const defs = construirFiltrosHistorico(CATALOGO_VACIO, { ahora: AHORA });

    const fecha = defs.find((d) => d.key === "fecha");
    for (const opcion of fecha?.options ?? []) {
      expect(opcion.defaultRange?.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(opcion.defaultRange?.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
