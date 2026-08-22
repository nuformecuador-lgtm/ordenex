import { describe, expect, it } from "vitest";

import { TableroDiaCacheMemoria } from "@/lib/cache/tablero-dia-cache-memoria";
import { TableroDiaService } from "@/lib/services/TableroDiaService";

import { RepositorioDoble, fila, servicioDelTablero } from "./_doble-tablero-dia";

// Feature 192 (B7.5) — R40, R42, R73.
//
// El detalle es una SEGUNDA puerta a las mismas filas y no hereda la frontera por
// implicacion: la vuelve a atravesar entera. Un detalle que se fiara de que la tarjeta pulsada
// ya venia recortada seria un IDOR de manual.

const ZONA_X = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-08-08T19:00:00.000Z");
const MENSAJERO = "33333333-3333-4333-8333-333333333333";

const MAESTRO = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const SATELITE_X = { usuarioId: "u-sat", rol: "adminSatelite", zonaId: ZONA_X };

function montar(): { service: TableroDiaService; repo: RepositorioDoble } {
  const repo = new RepositorioDoble(
    () => [fila("m1", "Ana", { entregadas: 1 })],
    () => ({ filas: [], total: 0 }),
  );
  return { service: servicioDelTablero(repo), repo };
}

describe("TableroDiaService.detalle — la frontera, otra vez", () => {
  it("resuelve el alcance de nuevo y empuja el recorte de zona al repositorio (R40/R41)", async () => {
    const { service, repo } = montar();
    await service.detalle(SATELITE_X, AHORA, MENSAJERO);

    expect(repo.detalles).toHaveLength(1);
    expect(repo.detalles[0].filtro).toEqual({ tipo: "zona", zonaId: ZONA_X });
    expect(repo.detalles[0].mensajeroId).toBe(MENSAJERO);
  });

  it("no acepta ningun filtro del cliente: la firma solo recibe actor, reloj, mensajero y pagina", async () => {
    const { service, repo } = montar();
    await service.detalle(MAESTRO, AHORA, MENSAJERO);
    expect(repo.detalles[0].filtro).toEqual({ tipo: "global" });
  });

  it.each([
    ["adminTienda", "rol_no_autorizado"],
    ["mensajero", "rol_no_autorizado"],
    ["apiKey", "rol_sin_analitica"],
    ["rol_inventado", "rol_desconocido"],
  ])("deniega para el rol %s, igual que el tablero, sin consultar (R40)", async (rol, motivo) => {
    const { service, repo } = montar();
    const resultado = await service.detalle({ usuarioId: "u", rol, zonaId: ZONA_X }, AHORA, MENSAJERO);

    expect(resultado).toEqual({ estado: "denegado", motivo });
    expect(repo.detalles).toHaveLength(0);
  });

  it("un adminSatelite sin zona recibe denegado tambien en el detalle (R7/R40)", async () => {
    const { service, repo } = montar();
    const resultado = await service.detalle(
      { usuarioId: "u", rol: "adminSatelite", zonaId: null },
      AHORA,
      MENSAJERO,
    );

    expect(resultado).toEqual({ estado: "denegado", motivo: "sin_zona_asignada" });
    expect(repo.detalles).toHaveLength(0);
  });

  it("sin sesion recibe denegado (R2)", async () => {
    const { service, repo } = montar();
    expect(await service.detalle(null, AHORA, MENSAJERO)).toEqual({
      estado: "denegado",
      motivo: "sin_sesion",
    });
    expect(repo.detalles).toHaveLength(0);
  });

  it("un mensajero sin ordenes hoy devuelve un detalle VACIO en ok, sin distinguirse de nada (R42/R33)", async () => {
    const { service } = montar();
    const resultado = await service.detalle(MAESTRO, AHORA, MENSAJERO);

    expect(resultado).toEqual({
      estado: "ok",
      detalle: {
        mensajeroId: MENSAJERO,
        fecha: "2026-08-08",
        ordenes: [],
        total: 0,
        pagina: 1,
        pageSize: 25,
        // FEATURE 260 (R12) — el alcance con el que se resolvio viaja tambien en el detalle
        // VACIO: la pantalla decide con el que columnas monta, y un vacio sin alcance la
        // dejaria sin saber cual pintar en cuanto lleguen filas.
        alcance: "global",
      },
    });
  });

  it("llama SIEMPRE al repositorio: el detalle no pasa por la cache (R73)", async () => {
    const repo = new RepositorioDoble(
      () => [],
      () => ({ filas: [], total: 0 }),
    );
    const cache = new TableroDiaCacheMemoria({ ahora: () => AHORA.getTime() });
    const service = servicioDelTablero(repo, cache);

    await service.detalle(MAESTRO, AHORA, MENSAJERO);
    await service.detalle(MAESTRO, AHORA, MENSAJERO);
    await service.detalle(MAESTRO, AHORA, MENSAJERO);

    expect(repo.detalles).toHaveLength(3);
    expect(cache.claves()).toEqual([]);
  });

  it("la pagina pedida viaja al repositorio con el tamaño del listado de ordenes (R55)", async () => {
    const { service, repo } = montar();
    await service.detalle(MAESTRO, AHORA, MENSAJERO, 4);
    expect(repo.detalles[0].pagina).toEqual({ pagina: 4, pageSize: 25 });
  });
});
