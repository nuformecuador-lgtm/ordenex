import { describe, it, expect } from "vitest";
import {
  filtrosCierresSchema,
  filtrosDescargaGestionesSchema,
  MAX_IDS_POR_FILTRO,
} from "@/lib/types/filtros-cierres";

// Feature 230 — Tanda 1 (T1.2, R19/R31/R32/R39) — la LISTA BLANCA de la descarga detallada.
//
// Este schema es la unica barrera entre lo que un cliente escribe y lo que el servicio ve. Los
// casos de abajo no prueban zod: prueban las tres decisiones que se tomaron al declararlo, y
// cada una tiene un modo de fallo concreto detras.
//
//  - `.strict()` (R19). Sin el, una clave ajena viajaria hasta un servicio que HOY la ignora en
//    silencio. `destinoZonaIds` es la que importa: el alcance de estas pantallas es rol + zona
//    DESTINO, asi que una clave de alcance que alguien llegara a leer algun dia abriria el dinero
//    de la bodega vecina. `page`/`pageSize` estan por otro motivo: demuestran que esta entrada NO
//    es la de ningun listado, que es exactamente lo que D11 decidio.
//  - `mensajeroIds` obligatorio y NO VACIO (R39). La lista vacia no es «todos»: si el repositorio
//    la descartara, «no elegi a nadie» se leeria como «dame el alcance entero». Falla cerrado.
//  - El rango no invertido (R32), rechazado ANTES de tocar la base.

// Ids UUID porque la primitiva compartida del modulo (`listaDeIdsRequerida`) exige uuid: un id
// que no lo es no casaria nada, pero viajaria hasta la base.
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";

const OK = { mensajeroIds: [M1] };

/** Las claves que devuelve zod, para poder afirmar CUAL fallo y no solo que algo fallo. */
function camposConError(input: unknown): string[] {
  const r = filtrosDescargaGestionesSchema.safeParse(input);
  if (r.success) return [];
  return Object.keys(r.error.flatten().fieldErrors);
}

describe("lista blanca de la descarga detallada de gestiones (feature 230, T1.2)", () => {
  it("acepta la forma minima: un mensajero y ninguna fecha", () => {
    const r = filtrosDescargaGestionesSchema.safeParse(OK);
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ mensajeroIds: [M1] });
  });

  it("acepta varios mensajeros y el rango completo (R30/R31)", () => {
    const r = filtrosDescargaGestionesSchema.safeParse({
      mensajeroIds: [M1, M2, M3],
      desde: "2026-01-01",
      hasta: "2026-01-31",
    });
    expect(r.success).toBe(true);
  });

  it.each(["destinoZonaIds", "destinoTipo", "page", "pageSize", "estado", "q"])(
    "una clave fuera de la lista blanca produce validation_error y ninguna fila: %s (R19)",
    (clave) => {
      const r = filtrosDescargaGestionesSchema.safeParse({ ...OK, [clave]: "lo-que-sea" });
      expect(r.success).toBe(false);
      // La forma del fallo importa tanto como el fallo: `unrecognized_keys` es lo que `.strict()`
      // produce. Un `invalid_type` aqui significaria que la clave ENTRO en el schema.
      expect(r.success === false && r.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(
        true,
      );
    },
  );

  it("mensajeroIds es obligatorio: sin el, no hay conjunto que pedir (R39)", () => {
    expect(camposConError({})).toContain("mensajeroIds");
  });

  it("una lista vacia de mensajeros se rechaza y NO degrada a «todo el alcance» (R39)", () => {
    expect(camposConError({ mensajeroIds: [] })).toContain("mensajeroIds");
  });

  it("un id que no es uuid se rechaza: no casaria nada, pero viajaria a la base", () => {
    expect(camposConError({ mensajeroIds: [""] })).toContain("mensajeroIds");
    expect(camposConError({ mensajeroIds: ["../../etc"] })).toContain("mensajeroIds");
  });

  it("hereda el tope de ids del modulo: un filtro recorta, no transporta un dataset", () => {
    // La misma primitiva que los cuatro filtros de los listados. Si esta descarga declarara la
    // suya, el tope se podria mover en un sitio y no en el otro.
    const demasiados = Array.from({ length: MAX_IDS_POR_FILTRO + 1 }, () => M1);
    expect(camposConError({ mensajeroIds: demasiados })).toContain("mensajeroIds");
  });

  it.each(["2026-1-1", "01/01/2026", "2026-01-01T00:00:00.000Z", "ayer"])(
    "una fecha que no es un dia calendario YYYY-MM-DD se rechaza: %s",
    (fecha) => {
      expect(camposConError({ ...OK, desde: fecha })).toContain("desde");
    },
  );

  it("un rango invertido produce validation_error (R32)", () => {
    const r = filtrosDescargaGestionesSchema.safeParse({
      ...OK,
      desde: "2026-02-10",
      hasta: "2026-02-01",
    });
    expect(r.success).toBe(false);

    // Y es EXACTAMENTE el mismo mensaje que dan los filtros de los listados, porque las dos
    // reglas salen de la misma constante del modulo. Se compara contra el otro schema y no
    // contra un literal: un literal aqui seria la segunda copia del texto, que es justo lo que
    // este modulo existe para evitar.
    const delListado = filtrosCierresSchema.safeParse({ desde: "2026-02-10", hasta: "2026-02-01" });
    expect(delListado.success).toBe(false);
    expect(r.success === false && r.error.flatten().fieldErrors.hasta).toEqual(
      delListado.success === false ? delListado.error.flatten().fieldErrors.hasta : null,
    );
  });

  it("un rango de UN SOLO dia (desde === hasta) es valido, no invertido", () => {
    const r = filtrosDescargaGestionesSchema.safeParse({
      ...OK,
      desde: "2026-02-01",
      hasta: "2026-02-01",
    });
    expect(r.success).toBe(true);
  });

  it("cada borde del rango es independiente del otro (R31)", () => {
    expect(filtrosDescargaGestionesSchema.safeParse({ ...OK, desde: "2026-02-01" }).success).toBe(
      true,
    );
    expect(filtrosDescargaGestionesSchema.safeParse({ ...OK, hasta: "2026-02-01" }).success).toBe(
      true,
    );
  });
});
