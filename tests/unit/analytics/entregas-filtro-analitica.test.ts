import { describe, it, expect } from "vitest";

import {
  FILTRO_ENTREGAS_INICIAL,
  seleccionAFiltroAnalitica,
} from "@/app/(app)/_components/entregas-filtro-analitica";
import {
  CLAVE_CANTON,
  CLAVE_CREACION,
  CLAVE_DISTRITO,
  CLAVE_MENSAJERO,
  CLAVE_PROVINCIA,
  CLAVE_TIENDA,
  CLAVE_ZONA,
} from "@/app/(app)/_components/entregas-filtros-def";
import { parseFiltroConteoEntregas } from "@/lib/analytics/entregas-conteo";

/** El borde de verdad, no una copia de sus reglas: el mismo zod que valida en producción. */
function validado(raw: unknown) {
  return parseFiltroConteoEntregas(raw);
}

describe("Barra de entregas -> filtro del conteo: lo que el borde acepta", () => {
  // El esquema es `.strict()`: cualquier clave que se colara sería `validation_error`, no un
  // extra inocuo. Por eso la traducción construye el objeto entero en vez de reenviar.
  // ⚠ CAMBIÓ EL 2026-08-18. Antes el filtro inicial era `{ rango: "semana" }` y este caso lo
  // afirmaba. Ahora es VACÍO: los filtros los manda la barra y la pantalla no arranca con
  // ninguno puesto. La mutación que mata es reintroducir un preset por defecto — la primera
  // cifra de cada visita saldría recortada a una ventana que nadie eligió mientras la barra
  // dice «sin filtrar».
  it("sin nada seleccionado NO emite ningún filtro, y el borde lo acepta", () => {
    const raw = seleccionAFiltroAnalitica({});

    expect(raw).toEqual({});
    expect(raw).toEqual(FILTRO_ENTREGAS_INICIAL);
    expect(raw).not.toHaveProperty("rango");
    expect(validado(raw).status).toBe("ok");
  });

  // LAS SIETE, y en particular las TRES GEOGRÁFICAS. Este caso es el que cambió de signo el
  // 2026-08-17: antes se comprobaba que provincia/cantón/distrito NO se reenviaban (el
  // rollup no tiene esas coordenadas). Ahora la fuente es la tabla `orden`, que sí las
  // tiene, y el caso comprueba lo contrario. La mutación que mata: dejar de reenviar una de
  // las tres, con lo que el usuario filtraría por distrito y la cifra lo ignoraría en
  // silencio — exactamente el defecto que motivó retirarlas la primera vez.
  it("las siete facetas viajan con las claves del esquema, y pasan la validación", () => {
    const raw = seleccionAFiltroAnalitica({
      [CLAVE_CREACION]: ["", "2026-08-01", "2026-08-16"],
      [CLAVE_ZONA]: ["z1", "z2"],
      [CLAVE_PROVINCIA]: ["p1"],
      [CLAVE_CANTON]: ["c1"],
      [CLAVE_DISTRITO]: ["d1"],
      [CLAVE_TIENDA]: ["t1"],
      [CLAVE_MENSAJERO]: ["m1"],
    });

    expect(raw).toEqual({
      rango: "personalizado",
      desde: "2026-08-01",
      hasta: "2026-08-16",
      zona_id: ["z1", "z2"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
      tienda_id: ["t1"],
      mensajero_id: ["m1"],
    });
    expect(validado(raw).status).toBe("ok");
  });

  // La traducción construye el objeto clave por clave, así que una faceta que aparezca en la
  // barra sin declararse aquí NO llega al borde a ponerlo en error. Sigue siendo la garantía
  // que sostiene el `.strict()` del esquema desde el lado cliente.
  it("una clave ajena al esquema NO se reenvía", () => {
    const raw = seleccionAFiltroAnalitica({ estatus_id: ["e1"], reasignables: ["1"] });

    expect(raw).toEqual(FILTRO_ENTREGAS_INICIAL);
    expect(validado(raw).status).toBe("ok");
  });
});

describe("Barra de entregas -> filtro del conteo: las listas vacías", () => {
  // Una lista vacía es `validation_error` en el borde (falla cerrado a propósito). Mandarla
  // sería un error provocado por nosotros, no por el usuario.
  it("una faceta sin valores OMITE su clave en vez de mandar `[]`", () => {
    const raw = seleccionAFiltroAnalitica({
      [CLAVE_ZONA]: [],
      [CLAVE_TIENDA]: [""],
      [CLAVE_DISTRITO]: ["", ""],
    });

    expect(raw).not.toHaveProperty("zona_id");
    expect(raw).not.toHaveProperty("tienda_id");
    expect(raw).not.toHaveProperty("distrito_id");
    expect(validado(raw).status).toBe("ok");
  });
});

describe("Barra de entregas -> filtro del conteo: el rango", () => {
  // El esquema exige el par completo con `personalizado` (refine 1). Media terna no describe
  // ninguna ventana, así que NO se manda rango — y eso ahora es una respuesta legítima («no he
  // filtrado por fecha»), no un preset de relleno.
  it.each([
    ["sólo desde", ["", "2026-08-01", ""]],
    ["sólo hasta", ["", "", "2026-08-16"]],
    ["ninguna de las dos", ["", "", ""]],
  ])("con %s no manda ningún rango", (_caso, terna) => {
    const raw = seleccionAFiltroAnalitica({ [CLAVE_CREACION]: terna as string[] });

    expect(raw).toEqual(FILTRO_ENTREGAS_INICIAL);
    expect(raw).not.toHaveProperty("rango");
    expect(validado(raw).status).toBe("ok");
  });

  // Media terna tampoco arrastra la mitad que sí llegó: `desde`/`hasta` sin
  // `rango: "personalizado"` son un `validation_error` (refine 2), o sea un error provocado
  // por nosotros.
  it("no deja colgando la fecha suelta que sí venía en la terna", () => {
    const raw = seleccionAFiltroAnalitica({ [CLAVE_CREACION]: ["", "2026-08-01", ""] });

    expect(raw).not.toHaveProperty("desde");
    expect(raw).not.toHaveProperty("hasta");
  });

  // Con las DOS sí viaja, y como `personalizado`: es el único rango que la barra puede
  // producir, porque emite fechas ya resueltas y no presets.
  it("con las dos fechas manda `personalizado` y el par completo", () => {
    const raw = seleccionAFiltroAnalitica({
      [CLAVE_CREACION]: ["", "2026-08-01", "2026-08-16"],
    });

    expect(raw).toMatchObject({
      rango: "personalizado",
      desde: "2026-08-01",
      hasta: "2026-08-16",
    });
    expect(validado(raw).status).toBe("ok");
  });
});
