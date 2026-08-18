import { describe, it, expect } from "vitest";
import {
  filtrosDescargaGestionesSchema,
  MENSAJE_RANGO_DESCARGA_GESTIONES,
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

const OK = { mensajeroIds: ["m-1"] };

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
    expect(r.success && r.data).toEqual({ mensajeroIds: ["m-1"] });
  });

  it("acepta varios mensajeros y el rango completo (R30/R31)", () => {
    const r = filtrosDescargaGestionesSchema.safeParse({
      mensajeroIds: ["m-1", "m-2", "m-3"],
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

  it("un id vacio se rechaza: una cadena en blanco no identifica a nadie", () => {
    expect(camposConError({ mensajeroIds: [""] })).toContain("mensajeroIds");
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
    expect(r.success === false && r.error.flatten().fieldErrors.hasta).toEqual([
      MENSAJE_RANGO_DESCARGA_GESTIONES,
    ]);
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
