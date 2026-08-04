import { describe, it, expect, vi } from "vitest";
import { consultarAgregadoOperativo } from "@/lib/actions/analitica-operativa";
import { ETIQUETA_MENSAJERO } from "@/lib/analytics/identidad";
import { AHORA, MAESTRO, TIENDA, consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 176 / T4.8 (primera mitad) — R15.
//
// EL MODO AGREGADO NO ES UNA PUERTA TRASERA. La seudonimizacion y el oraculo de la 126 son
// del SERVIDOR y no dependen de por que lectura se entre; si el agregado los saltara, el
// agujero que R24/R36 de la 122/126 cerraron se reabriria por una puerta nueva — que es
// literalmente lo que la 126 advirtio para el CSV de la 134.
//
// Dos capas independientes y por eso dos casos:
//   (a) los cubos por mensajero salen con etiquetas ordinales, sin un solo id real;
//   (b) un filtro que NOMBRA `mensajero_id` bajo politica seudonima se deniega y se audita.
//       Lo que el `adminTienda` pierde es el FILTRO, no la VISTA.

const UUID_SONDEADO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("R15 · bajo politica seudonima no salen ids de mensajero", () => {
  it("bajo politica seudonima los cubos por mensajero no llevan ids reales y el filtro por mensajero se deniega", async () => {
    const cubos = [
      cubo({ fecha: "2026-08-01", mensajeroId: "m-uno", entregas: 4, devoluciones: 1 }),
      cubo({ fecha: "2026-08-02", mensajeroId: "m-dos", entregas: 6, devoluciones: 3 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", TIENDA, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-02",
      }),
      { desagregacion: "mensajero" },
    );

    expect(agregado.cubos).toHaveLength(2);
    for (const c of agregado.cubos) {
      expect(c.dimension).toMatch(new RegExp(`^${ETIQUETA_MENSAJERO} \\d+$`));
    }
    // R39 de la 122 — se afirma sobre la CADENA SERIALIZADA COMPLETA: en el App Router, lo
    // que la UI «no pinta» igualmente VIAJA y es inspeccionable en la pestana Network.
    const payload = JSON.stringify(agregado);
    expect(payload).not.toContain("m-uno");
    expect(payload).not.toContain("m-dos");

    // Y la vista sigue COMPLETA: los dos mensajeros con sus componentes.
    expect(agregado.cubos.map((c) => c.numerador).sort((a, b) => a - b)).toEqual([4, 6]);

    // (b) — el FILTRO por mensajero, en cambio, se deniega y se audita.
    const logError = vi.fn();
    const r = await consultarAgregadoOperativo(
      { metricaId: "tasa_entrega", raw: { rango: "dia", mensajero_id: [UUID_SONDEADO] } },
      {
        service: servicioCon(rollupFalso(cubos)),
        logger: { logError },
        now: () => AHORA,
        getActor: async () => TIENDA,
      },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(logError).toHaveBeenCalledTimes(1);
    expect((logError.mock.calls[0][0] as Record<string, unknown>).motivo).toBe(
      "filtro_fuera_de_alcance",
    );
  });

  it("un rol de politica REAL sigue viendo ids y sigue pudiendo filtrar por mensajero", async () => {
    // Frontera del cierre: si el agregado seudonimizara siempre —o denegara siempre— romperia
    // a `maestro`, `admin`, `adminSatelite` y al propio `mensajero`.
    const cubos = [cubo({ fecha: "2026-08-01", mensajeroId: "m-uno", entregas: 4, devoluciones: 1 })];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", MAESTRO, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-02",
      }),
      { desagregacion: "mensajero" },
    );
    expect(agregado.cubos[0].dimension).toBe("m-uno");

    const logError = vi.fn();
    const r = await consultarAgregadoOperativo(
      { metricaId: "tasa_entrega", raw: { rango: "dia", mensajero_id: [UUID_SONDEADO] } },
      {
        service: servicioCon(rollupFalso(cubos)),
        logger: { logError },
        now: () => AHORA,
        getActor: async () => MAESTRO,
      },
    );
    expect(r.status).toBe("ok");
    expect(logError).not.toHaveBeenCalled();
  });

  it("el cubo sin mensajero asignado se conserva y NO se disfraza de persona", async () => {
    // No es un repartidor: es «ordenes sin mensajero asignado». Etiquetarlo «Mensajero N»
    // inventaria a alguien que no existe.
    const cubos = [
      cubo({ fecha: "2026-08-01", mensajeroId: null, entregas: 2, devoluciones: 2 }),
      cubo({ fecha: "2026-08-01", mensajeroId: "m-uno", entregas: 4, devoluciones: 1 }),
    ];
    const agregado = await servicioCon(rollupFalso(cubos)).consultarAgregado(
      consultaDe("tasa_entrega", TIENDA, {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-02",
      }),
      { desagregacion: "mensajero" },
    );
    const dimensiones = agregado.cubos.map((c) => c.dimension);
    expect(dimensiones).toContain("sin_asignar");
    expect(JSON.stringify(agregado)).not.toContain("m-uno");
  });
});
