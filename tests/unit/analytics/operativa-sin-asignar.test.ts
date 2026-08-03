import { describe, it, expect } from "vitest";
import { MENSAJERO_SIN_ASIGNAR } from "@/lib/analytics/types";
import { MAESTRO, TIENDA, consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 126 / T9.4 — R8 y D10.
//
// `analytics_daily.mensajero_id` es NULLABLE CON SIGNIFICADO DE DOMINIO (`db/schema.prisma`:
// «NULL = cubo sin_asignar, NUNCA "todos los mensajeros"»). D5/R30 de la 135 le dio nombre
// propio: `MENSAJERO_SIN_ASIGNAR`, y toda metrica con grano `mensajero` declara
// `sinAsignar: "incluir"`.
//
// TRES formas de perderlo, y las tres producen un tablero creible:
//   (a) filtrar las filas con `mensajeroId === null` al proyectar — la mutacion de R8;
//   (b) dejarlo viajar como `null` serializado, que la UI pinta como hueco;
//   (c) etiquetarlo «Mensajero N», que inventa un repartidor que no existe.
//
// EL ORDEN IMPORTA (D10): `seudonimizarMensajeros` exige `string` y el rollup da
// `string | null`. La normalizacion `null -> MENSAJERO_SIN_ASIGNAR` va ANTES de seudonimizar;
// hacerla despues dejaria un `null` en el payload.

const CUBOS = [
  cubo({ fecha: "2026-08-01", mensajeroId: "m-1", entregas: 5 }),
  cubo({ fecha: "2026-08-01", mensajeroId: null, entregas: 2 }),
];

describe("R8 · el cubo sin asignar sobrevive a la proyeccion y a la seudonimizacion", () => {
  it("el cubo sin asignar sobrevive a la proyeccion y a la seudonimizacion", async () => {
    for (const actor of [MAESTRO, TIENDA]) {
      const serie = await servicioCon(rollupFalso(CUBOS)).consultar(
        consultaDe("entregas", actor),
        "mensajero",
      );
      const sinAsignar = serie.puntos.find((p) => p.dimension === MENSAJERO_SIN_ASIGNAR);
      expect(sinAsignar, `desaparecio con el rol ${actor.rol}`).toBeDefined();
      expect(sinAsignar?.valor).toBe(2);
    }
  });

  it("no viaja como `null` serializado: la UI no puede pintarlo como un hueco", async () => {
    const serie = await servicioCon(rollupFalso(CUBOS)).consultar(
      consultaDe("entregas", TIENDA),
      "mensajero",
    );
    expect(JSON.stringify(serie)).not.toContain('"dimension":null');
    expect(serie.puntos.every((p) => typeof p.dimension === "string")).toBe(true);
  });

  it("y el total NO se pierde: 5 + 2 siguen siendo 7 tras la proyeccion", async () => {
    // Es lo que hace invisible a la mutacion (a): descartar el cubo baja el total a 5 y ningun
    // otro campo de la respuesta contradice ese numero.
    const serie = await servicioCon(rollupFalso(CUBOS)).consultar(
      consultaDe("entregas", MAESTRO),
      "mensajero",
    );
    expect(serie.puntos.reduce((a, p) => a + (p.valor ?? 0), 0)).toBe(7);
  });

  it("el literal sale de la 135 y no se reescribe aqui", () => {
    expect(MENSAJERO_SIN_ASIGNAR).toBe("sin_asignar");
  });
});
