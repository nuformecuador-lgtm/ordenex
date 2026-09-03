import { describe, it, expect } from "vitest";

import {
  CLAVE_ACCION,
  CLAVE_ACTOR,
  CLAVE_BUSQUEDA,
  CLAVE_CATEGORIA,
  CLAVE_ENTIDAD,
  CLAVE_FECHA,
} from "@/app/(app)/historico/acciones/_components/historial-acciones-filtros-def";
import {
  claveDeFiltroHistorial,
  seleccionAFiltroHistorialAcciones,
} from "@/app/(app)/historico/acciones/_components/seleccion-a-filtro";
import { filtroHistorialAccionSchema } from "@/lib/types/historial-accion";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

// FICHA 362 / T5.3 — la traducción `selección del control -> filtro del borde`.
//
// Cada caso corresponde a un RECHAZO del borde, no a una preferencia de estilo: una lista
// vacía, una clave desconocida o una fecha con hora son `validation_error`, y un
// `validation_error` deja la pantalla en blanco sin decir por qué.

const AHORA = new Date("2026-09-02T18:00:00Z");
const opts = { ahora: AHORA };

/** Lo que el módulo añade sobre el filtro antes de mandarlo, para poder validar el conjunto. */
function comoLaPantalla(filtro: Record<string, unknown>) {
  return filtroHistorialAccionSchema.safeParse({
    ...filtro,
    page: 1,
    pageSize: 25,
    sortBy: "created_at",
    sortDir: "desc",
  });
}

describe("regla 1 — una lista vacía se OMITE, nunca viaja `[]`", () => {
  it("las cinco claves con lista vacía producen un filtro vacío", () => {
    const out = seleccionAFiltroHistorialAcciones(
      {
        [CLAVE_ACTOR]: [],
        [CLAVE_ACCION]: [],
        [CLAVE_CATEGORIA]: [],
        [CLAVE_ENTIDAD]: [],
        [CLAVE_FECHA]: [],
      },
      opts,
    );
    expect(out).toEqual({});
  });

  it("y el borde rechazaría el `[]` si viajara: por eso se omite", () => {
    // La contraprueba de la regla. Sin ella, «se omite» sería una preferencia.
    expect(comoLaPantalla({ actorId: [] }).success).toBe(false);
  });
});

describe("las cuatro listas viajan con la clave del CONTRATO, no con la del control", () => {
  it("`actor_id` -> `actorId`, `entidad_tipo` -> `entidadTipo`", () => {
    const out = seleccionAFiltroHistorialAcciones(
      {
        [CLAVE_ACTOR]: ["u1", "u2"],
        [CLAVE_ACCION]: ["orden_eliminada"],
        [CLAVE_CATEGORIA]: ["mueve_dinero"],
        [CLAVE_ENTIDAD]: ["orden"],
      },
      opts,
    );

    expect(out).toEqual({
      actorId: ["u1", "u2"],
      accion: ["orden_eliminada"],
      categoria: ["mueve_dinero"],
      entidadTipo: ["orden"],
    });
    expect(comoLaPantalla(out).success).toBe(true);
  });

  it("un VALOR inventado viaja igual: lo rechaza el borde (R15), no este módulo", () => {
    // Filtrarlo aquí sería el descarte mudo que la ficha prohíbe: el usuario habría pedido
    // algo y se le devolvería un listado que no es el suyo, sin aviso.
    const out = seleccionAFiltroHistorialAcciones(
      { [CLAVE_ACCION]: ["accion_que_no_existe"] },
      opts,
    );
    expect(out.accion).toEqual(["accion_que_no_existe"]);
    expect(comoLaPantalla(out).success).toBe(false);
  });
});

describe("regla 2 y 3 — la fecha", () => {
  it("el ATAJO se resuelve aquí a sus dos fechas de calendario y no viaja como atajo", () => {
    const out = seleccionAFiltroHistorialAcciones({ [CLAVE_FECHA]: ["7d", "", ""] }, opts);
    const esperado = ultimosNDiasCalendarioCR(7, AHORA);

    expect(out).toEqual({ desde: esperado.desde, hasta: esperado.hasta });
    // El contrato no tiene clave de atajo: mandarla además del rango sería `validation_error`.
    expect(Object.keys(out)).not.toContain("fecha");
    expect(comoLaPantalla(out).success).toBe(true);
  });

  it("sin atajo, el rango escrito a mano viaja `YYYY-MM-DD`", () => {
    const out = seleccionAFiltroHistorialAcciones(
      { [CLAVE_FECHA]: ["", "2026-08-01", "2026-08-31"] },
      opts,
    );
    expect(out).toEqual({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(comoLaPantalla(out).success).toBe(true);
  });

  it("solo un extremo también vale", () => {
    expect(
      seleccionAFiltroHistorialAcciones({ [CLAVE_FECHA]: ["", "2026-08-01", ""] }, opts),
    ).toEqual({ desde: "2026-08-01" });
  });

  it("un INSTANTE no es una fecha de calendario: el borde lo rechaza", () => {
    // La razón por la que la terna del control transporta `YYYY-MM-DD` y no una fecha ISO.
    expect(comoLaPantalla({ desde: "2026-08-01T00:00:00Z" }).success).toBe(false);
  });
});

describe("regla 4 (R32) — el término por debajo del mínimo no viaja", () => {
  it(`con ${BUSQUEDA_MIN_CHARS - 1} caracteres la clave del término no aparece`, () => {
    const out = seleccionAFiltroHistorialAcciones(
      { [CLAVE_BUSQUEDA]: ["x".repeat(BUSQUEDA_MIN_CHARS - 1)] },
      opts,
    );
    expect(out.q).toBeUndefined();
  });

  it("el `trim` va ANTES de medir: los espacios no cuentan", () => {
    const out = seleccionAFiltroHistorialAcciones({ [CLAVE_BUSQUEDA]: ["  ma  "] }, opts);
    expect(out.q).toBeUndefined();
  });

  it("por encima del mínimo viaja YA RECORTADO", () => {
    const out = seleccionAFiltroHistorialAcciones({ [CLAVE_BUSQUEDA]: ["  ana  "] }, opts);
    expect(out.q).toBe("ana");
    expect(comoLaPantalla(out).success).toBe(true);
  });
});

describe("regla 5 — la clave DESCONOCIDA se descarta aquí, porque el borde es `.strict()`", () => {
  it("una clave que el contrato no conoce no llega al filtro", () => {
    const out = seleccionAFiltroHistorialAcciones(
      { [CLAVE_ACTOR]: ["u1"], zona_id: ["z1"], loteId: ["abc"] },
      opts,
    );
    expect(out).toEqual({ actorId: ["u1"] });
  });

  it("y si llegara, el borde respondería `validation_error` (la razón de la regla)", () => {
    // ⚠️ NO es un descarte mudo del servidor: es un error. Por eso la barra tiene que no
    // mandarlas, en vez de confiar en que se ignoren.
    const res = comoLaPantalla({ actorId: ["u1"], zona_id: ["z1"] });
    expect(res.success).toBe(false);
  });
});

describe("`claveDeFiltroHistorial` — la caché no puede depender de la identidad del objeto", () => {
  it("dos filtros equivalentes en distinto orden comparten clave", () => {
    const a = claveDeFiltroHistorial({ actorId: ["u2", "u1"], q: "ana" });
    const b = claveDeFiltroHistorial({ q: "ana", actorId: ["u1", "u2"] });
    expect(a).toBe(b);
  });

  it("dos filtros distintos NO comparten clave", () => {
    expect(claveDeFiltroHistorial({ actorId: ["u1"] })).not.toBe(
      claveDeFiltroHistorial({ actorId: ["u2"] }),
    );
    expect(claveDeFiltroHistorial({})).not.toBe(claveDeFiltroHistorial({ q: "ana" }));
  });
});
