import { describe, it, expect } from "vitest";

import {
  CLAVE_ELIMINADOS,
  CLAVE_REASIGNABLES,
  CLAVE_SALIO_A_REPARTO,
  ETIQUETA_SALIO_A_REPARTO,
  ETIQUETA_SALIO_A_REPARTO_TODAS,
  SALIO_A_REPARTO_TODAS,
  construirFiltrosOrdenes,
} from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { seleccionAFilter } from "@/app/(app)/ordenes/_components/seleccion-a-filter";
import {
  construirFiltrosSatelite,
  seleccionAFiltroSatelite,
} from "@/app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros";
import { CATALOGO_FILTROS_VACIO } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { SALIO_A_REPARTO_VALORES } from "@/lib/types/orden";
import { listarOrdenesSchema } from "@/lib/types/orden";
import { seleccionDesdeUrl } from "@/lib/utils/filtros-url";
import type { FilterDef } from "@/components/shared/FilterComponent";

// FICHA 370 — el control «Salida a reparto» de la barra de ordenes (y de la del satelite).
//
// Lo que este archivo vigila, y por que cada caso existe:
//   1. que el control se le OFREZCA a quien despacha y NO al `adminTienda`;
//   2. que las opciones se deriven de `SALIO_A_REPARTO_VALORES` y no de literales sueltos
//      —un valor que el borde no admita es un `validation_error` y una pantalla en blanco—;
//   3. que el valor viaje ESCALAR (mandarlo como lista tambien es `validation_error`);
//   4. que «Todas» sea un centinela de UI que NO llega al servidor: la clave desaparece;
//   5. que la ida y vuelta por la URL siembre el control, incluido el centinela.

/** El `FilterDef` del control, tal como lo declara la barra de la central. */
function defSalidaAReparto(): FilterDef {
  const def = construirFiltrosOrdenes(CATALOGO_FILTROS_VACIO, {
    incluirTienda: true,
    incluirSalioAReparto: true,
  }).find((f) => f.key === CLAVE_SALIO_A_REPARTO);
  if (!def) throw new Error("no se declaro el filtro salio_a_reparto");
  return def;
}

/** Claves de la barra con las opciones que le monta la pagina a cada rol. */
function claves(opts: Parameters<typeof construirFiltrosOrdenes>[1]): string[] {
  return construirFiltrosOrdenes(CATALOGO_FILTROS_VACIO, opts).map((f) => f.key);
}

/** Un `URLSearchParams` con el param del control, para la siembra. */
function params(valor: string): URLSearchParams {
  return new URLSearchParams(`${CLAVE_SALIO_A_REPARTO}=${valor}`);
}

describe("FICHA 370 — a quien se le ofrece el control", () => {
  it("NO se declara si no se pide: ninguna superficie lo gana por descuido", () => {
    expect(claves({ incluirTienda: true })).not.toContain(CLAVE_SALIO_A_REPARTO);
    expect(
      claves({ incluirTienda: true, incluirSalioAReparto: false }),
    ).not.toContain(CLAVE_SALIO_A_REPARTO);
  });

  it("pedido (maestro/admin, y el satelite) se declara", () => {
    expect(
      claves({ incluirTienda: true, incluirSalioAReparto: true }),
    ).toContain(CLAVE_SALIO_A_REPARTO);
  });

  it("el `adminTienda` —que no despacha— no lo recibe: misma puerta que «Reasignables»", () => {
    // La pagina calcula las dos con `rol !== adminTienda`; esto es esa barra ya montada.
    const declaradas = claves({
      incluirTienda: false,
      incluirReasignables: false,
      incluirMensajero: false,
      incluirSalioAReparto: false,
    });
    expect(declaradas).not.toContain(CLAVE_SALIO_A_REPARTO);
    expect(declaradas).not.toContain(CLAVE_REASIGNABLES);
  });

  it("va ENTRE «Reasignables» y «Eliminadas», no al final de la barra", () => {
    const orden = claves({
      incluirTienda: true,
      incluirSalioAReparto: true,
      incluirEliminados: true,
    });
    expect(orden.indexOf(CLAVE_SALIO_A_REPARTO)).toBe(
      orden.indexOf(CLAVE_REASIGNABLES) + 1,
    );
    expect(orden.indexOf(CLAVE_ELIMINADOS)).toBe(orden.length - 1);
  });

  it("la barra del SATELITE lo trae encendido (ahi estan casi todas las que no han salido)", () => {
    expect(
      construirFiltrosSatelite(CATALOGO_FILTROS_VACIO).map((f) => f.key),
    ).toContain(CLAVE_SALIO_A_REPARTO);
  });
});

describe("FICHA 370 — la declaracion del control", () => {
  it("es un `single`: los dos grupos son EXCLUYENTES, no un conjunto que se acumule", () => {
    expect(defSalidaAReparto().kind).toBe("single");
  });

  it("ofrece el centinela «Todas» MAS los valores del contrato, en ese orden", () => {
    // Los `value` salen de `SALIO_A_REPARTO_VALORES`, la constante que cierra el `z.enum`
    // del borde: si un dia el contrato ganara o perdiera un valor, este caso lo exige aqui
    // en vez de dejar que la UI ofrezca algo que el servidor rechaza.
    expect((defSalidaAReparto().options ?? []).map((o) => o.value)).toEqual([
      SALIO_A_REPARTO_TODAS,
      ...SALIO_A_REPARTO_VALORES,
    ]);
  });

  it("el centinela NO es uno de los valores del contrato (no se colaria en la consulta)", () => {
    expect(SALIO_A_REPARTO_VALORES as readonly string[]).not.toContain(
      SALIO_A_REPARTO_TODAS,
    );
  });

  it("los TEXTOS son los pedidos, y NINGUNO dice «intento»", () => {
    // Literales a proposito: ESTE es el contrato con el humano. La columna «Intentos» de la
    // misma tabla cuenta otra cosa (76 ordenes en produccion salieron a reparto y la tienen
    // en 0), asi que nombrar el control por los intentos pondria a la fila y al filtro a
    // decir cosas distintas sobre la misma orden.
    const def = defSalidaAReparto();
    expect(def.label).toBe("Salida a reparto");
    expect((def.options ?? []).map((o) => o.label)).toEqual([
      "Todas",
      "Ya salió",
      "Nunca ha salido",
    ]);
    // Sin nada elegido el disparador dice «Todas», que es lo que de verdad esta pasando.
    expect(def.placeholder).toBe(ETIQUETA_SALIO_A_REPARTO_TODAS);

    const textos = [def.label, ...(def.options ?? []).map((o) => o.label)];
    for (const texto of textos) {
      expect(texto.toLowerCase()).not.toContain("intento");
    }
  });

  it("no se encadena a ningun otro filtro (no se poda ni se acota)", () => {
    expect(defSalidaAReparto().dependsOn).toBeUndefined();
  });
});

describe("FICHA 370 — la traduccion al `filter` de `listarOrdenes`", () => {
  it("cada valor del contrato viaja ESCALAR, nunca como lista", () => {
    for (const valor of SALIO_A_REPARTO_VALORES) {
      const filtro = seleccionAFilter({ [CLAVE_SALIO_A_REPARTO]: [valor] });
      expect(filtro).toEqual({ salio_a_reparto: valor });
      expect(Array.isArray(filtro.salio_a_reparto)).toBe(false);
      // Y el borde lo acepta tal cual: la traduccion se mide contra el schema de verdad,
      // no contra otra copia de las reglas. Una lista aqui seria `validation_error`.
      expect(
        listarOrdenesSchema.parse({ filter: filtro }).filter?.salio_a_reparto,
      ).toBe(valor);
    }
  });

  it("«Todas» NO viaja: la clave DESAPARECE del filtro", () => {
    const filtro = seleccionAFilter({
      [CLAVE_SALIO_A_REPARTO]: [SALIO_A_REPARTO_TODAS],
    });
    expect(Object.hasOwn(filtro, "salio_a_reparto")).toBe(false);
    expect(filtro).toEqual({});
  });

  it("«Todas» no arrastra a los demas filtros: sigue siendo la clave la que cae", () => {
    expect(
      seleccionAFilter({
        [CLAVE_SALIO_A_REPARTO]: [SALIO_A_REPARTO_TODAS],
        zona_id: ["z1"],
      }),
    ).toEqual({ zona_id: ["z1"] });
  });

  it("seleccion vacia o valor desconocido: la clave tampoco aparece", () => {
    expect(seleccionAFilter({ [CLAVE_SALIO_A_REPARTO]: [] })).toEqual({});
    expect(seleccionAFilter({ [CLAVE_SALIO_A_REPARTO]: ["con_intentos"] })).toEqual(
      {},
    );
    expect(seleccionAFilter({})).toEqual({});
  });

  it("el SATELITE emite el mismo escalar (reusa la traduccion, no una copia)", () => {
    const filtro = seleccionAFiltroSatelite({
      [CLAVE_SALIO_A_REPARTO]: ["ya_salio"],
    });
    expect(filtro.salio_a_reparto).toBe("ya_salio");
    expect(Array.isArray(filtro.salio_a_reparto)).toBe(false);
    expect(
      Object.hasOwn(
        seleccionAFiltroSatelite({
          [CLAVE_SALIO_A_REPARTO]: [SALIO_A_REPARTO_TODAS],
        }),
        "salio_a_reparto",
      ),
    ).toBe(false);
  });
});

describe("FICHA 370 — la ida y vuelta por la URL", () => {
  const FILTROS = [defSalidaAReparto()];

  it("`?salio_a_reparto=ya_salio` siembra el control y acaba en el filtro", () => {
    const seleccion = seleccionDesdeUrl(params("ya_salio"), FILTROS);
    expect(seleccion[CLAVE_SALIO_A_REPARTO]).toEqual(["ya_salio"]);
    expect(seleccionAFilter(seleccion)).toEqual({ salio_a_reparto: "ya_salio" });
  });

  it("`?salio_a_reparto=todas` siembra el control en «Todas» y NO filtra", () => {
    // Las dos mitades importan: sin la opcion declarada, `valoresValidos` descartaria el
    // valor y el control no se podria sembrar; sin la traduccion, «todas» llegaria al borde.
    const seleccion = seleccionDesdeUrl(params(SALIO_A_REPARTO_TODAS), FILTROS);
    expect(seleccion[CLAVE_SALIO_A_REPARTO]).toEqual([SALIO_A_REPARTO_TODAS]);
    expect(seleccionAFilter(seleccion)).toEqual({});
  });

  it("un valor que el contrato no conoce no siembra nada", () => {
    expect(seleccionDesdeUrl(params("con_intentos"), FILTROS)).toEqual({});
  });

  it("la etiqueta exportada es la que se ofrece en el selector de filtros", () => {
    expect(defSalidaAReparto().label).toBe(ETIQUETA_SALIO_A_REPARTO);
  });
});
