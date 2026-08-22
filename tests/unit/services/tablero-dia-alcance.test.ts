import { describe, expect, it } from "vitest";

import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { TableroDiaService } from "@/lib/services/TableroDiaService";

import { RepositorioDoble, fila, servicioDelTablero } from "./_doble-tablero-dia";

// Feature 192 (B3.3) — R1, R3, R4, R5, R7, R9.
//
// Esta es la FRONTERA MULTI-TENANT de la pantalla: sin RLS debajo, es la unica separacion
// entre inquilinos. Un fallo aqui no da una cifra equivocada, enseña las ordenes de una zona
// ajena. Por eso la tabla de roles se prueba entera y por eso, cuando se deniega, se comprueba
// ademas que el repositorio NO recibio ni una llamada: un denegado que consulta primero ya
// tocó los datos.

const AHORA = new Date("2026-08-08T19:00:00.000Z");
const ZONA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function servicio(): { service: TableroDiaService; repo: RepositorioDoble } {
  const repo = new RepositorioDoble(() => [fila("m1", "Juan Perez", { entregadas: 2 })]);
  return { service: servicioDelTablero(repo), repo };
}

function actor(rol: string, zonaId: string | null = null): ActorAnalitica {
  return { usuarioId: "u-1", rol, zonaId };
}

describe("TableroDiaService.obtener — alcance por rol", () => {
  it("admin y maestro obtienen el filtro GLOBAL: todas las zonas (R4)", async () => {
    for (const rol of ["admin", "maestro"]) {
      const { service, repo } = servicio();
      const resultado = await service.obtener(actor(rol), AHORA);

      expect(resultado.estado).toBe("ok");
      if (resultado.estado !== "ok") return;
      expect(resultado.tablero.alcance).toBe("global");
      expect(repo.conteos).toHaveLength(1);
      expect(repo.conteos[0].filtro).toEqual({ tipo: "global" });
    }
  });

  it("adminSatelite CON zona obtiene el filtro de ESA zona (R5)", async () => {
    const { service, repo } = servicio();
    const resultado = await service.obtener(actor("adminSatelite", ZONA_A), AHORA);

    expect(resultado.estado).toBe("ok");
    if (resultado.estado !== "ok") return;
    expect(resultado.tablero.alcance).toBe("zona");
    expect(repo.conteos[0].filtro).toEqual({ tipo: "zona", zonaId: ZONA_A });
  });

  it("adminSatelite SIN zona recibe denegado, no un alcance global ni un tablero vacio (R7)", async () => {
    const { service, repo } = servicio();
    const resultado = await service.obtener(actor("adminSatelite", null), AHORA);

    expect(resultado).toEqual({ estado: "denegado", motivo: "sin_zona_asignada" });
    expect(repo.conteos).toHaveLength(0);
  });

  it.each([
    ["adminTienda", "rol_no_autorizado"],
    ["mensajero", "rol_no_autorizado"],
    ["apiKey", "rol_sin_analitica"],
    ["superusuario_inventado", "rol_desconocido"],
    ["", "rol_desconocido"],
  ])(
    "el rol %s recibe denegado y el repositorio NO se llama (R1/R3/R9)",
    async (rol, motivo) => {
      const { service, repo } = servicio();
      const resultado = await service.obtener(actor(rol, ZONA_A), AHORA);

      expect(resultado).toEqual({ estado: "denegado", motivo });
      expect(repo.conteos).toHaveLength(0);
    },
  );

  it("sin actor (sesion invalida) recibe denegado sin filas ni conteos (R2)", async () => {
    const { service, repo } = servicio();
    const resultado = await service.obtener(null, AHORA);

    expect(resultado).toEqual({ estado: "denegado", motivo: "sin_sesion" });
    expect(repo.conteos).toHaveLength(0);
  });

  it("un denegado NUNCA degrada a un tablero recortado: no hay campo `tablero`", async () => {
    const { service } = servicio();
    const resultado = await service.obtener(actor("adminTienda"), AHORA);
    expect(resultado).not.toHaveProperty("tablero");
  });

  it("el recorte se pide por la ventana del dia CR, no por medianoche UTC (R12/R17)", async () => {
    const { service, repo } = servicio();
    await service.obtener(actor("admin"), AHORA);

    expect(repo.conteos[0].ventana.fecha).toBe("2026-08-08");
    expect(repo.conteos[0].ventana.desde.toISOString()).toBe("2026-08-08T06:00:00.000Z");
    expect(repo.conteos[0].ventana.hasta.toISOString()).toBe("2026-08-09T06:00:00.000Z");
  });
});
