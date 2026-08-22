import { describe, expect, it } from "vitest";

import { TableroDiaCacheMemoria } from "@/lib/cache/tablero-dia-cache-memoria";
import type { ITableroDiaCache } from "@/lib/interfaces/external/ITableroDiaCache";
import { TableroDiaService } from "@/lib/services/TableroDiaService";

import { RepositorioDoble, fila, servicioDelTablero } from "./_doble-tablero-dia";

// Feature 192 (B9.7) — R67, R69. **ESTE ES EL TEST DE SEGURIDAD DE LA FEATURE.**
//
// Una cache mal claveada NO rompe: responde rapido y con los datos de otro inquilino. Es el
// modo de fallo mas caro de esta feature porque no deja rastro — la pantalla se ve bien, es
// veloz, y le enseña a un adminSatelite el tablero del pais entero.
//
// Por eso aqui se assertan CONTENIDOS devueltos y no "hits de cache": contar llamadas
// demostraria que la cache funciona, no que aisla. Y por eso el caso de R69 comprueba que un
// actor denegado sigue denegado CON una entrada caliente que cubriria su consulta.

const ZONA_X = "11111111-1111-4111-8111-111111111111";
const ZONA_Y = "22222222-2222-4222-8222-222222222222";
const AHORA = new Date("2026-08-08T19:00:00.000Z");

const MAESTRO = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const SATELITE_X = { usuarioId: "u-sat-x", rol: "adminSatelite", zonaId: ZONA_X };
const SATELITE_Y = { usuarioId: "u-sat-y", rol: "adminSatelite", zonaId: ZONA_Y };
const SATELITE_SIN_ZONA = { usuarioId: "u-sat-0", rol: "adminSatelite", zonaId: null };
const TIENDA = { usuarioId: "u-tienda", rol: "adminTienda", zonaId: null };

/**
 * El repositorio devuelve filas DISTINTAS por alcance, que es lo que hace observable la fuga:
 * si dos alcances compartieran entrada, el segundo recibiria las filas del primero.
 */
function montar(): { service: TableroDiaService; repo: RepositorioDoble; cache: TableroDiaCacheMemoria } {
  const repo = new RepositorioDoble((filtro) =>
    filtro.tipo === "global"
      ? [
          fila("m-x", "Mensajero X", { entregadas: 1 }),
          fila("m-y", "Mensajero Y", { entregadas: 1 }),
        ]
      : filtro.zonaId === ZONA_X
        ? [fila("m-x", "Mensajero X", { entregadas: 1 })]
        : [fila("m-y", "Mensajero Y", { entregadas: 1 })],
  );
  const cache = new TableroDiaCacheMemoria({ ahora: () => AHORA.getTime() });
  return { service: servicioDelTablero(repo, cache), repo, cache };
}

async function nombresDe(
  service: TableroDiaService,
  actor: { usuarioId: string; rol: string; zonaId: string | null },
): Promise<readonly string[]> {
  const resultado = await service.obtener(actor, AHORA);
  if (resultado.estado !== "ok") throw new Error(`se esperaba ok, llego ${resultado.motivo}`);
  return resultado.tablero.filas.map((f) => f.mensajeroNombre);
}

describe("cache del tablero — aislamiento entre alcances", () => {
  it("un maestro (global) y un adminSatelite de zona X, dentro de la MISMA ventana, reciben conjuntos de filas distintos (R67)", async () => {
    const { service } = montar();

    // El maestro produce y deja la entrada CALIENTE. El satelite entra justo despues.
    expect(await nombresDe(service, MAESTRO)).toEqual(["Mensajero X", "Mensajero Y"]);
    expect(await nombresDe(service, SATELITE_X)).toEqual(["Mensajero X"]);
    // Y al reves tampoco: el maestro sigue viendo el pais entero.
    expect(await nombresDe(service, MAESTRO)).toEqual(["Mensajero X", "Mensajero Y"]);
  });

  it("dos satelites de zonas DISTINTAS no comparten entrada (R67)", async () => {
    const { service, repo } = montar();

    expect(await nombresDe(service, SATELITE_X)).toEqual(["Mensajero X"]);
    expect(await nombresDe(service, SATELITE_Y)).toEqual(["Mensajero Y"]);

    // Y cada uno produjo lo suyo: no hubo una entrada compartida que sirviera a los dos.
    expect(repo.conteos.map((c) => c.filtro)).toEqual([
      { tipo: "zona", zonaId: ZONA_X },
      { tipo: "zona", zonaId: ZONA_Y },
    ]);
  });

  it("dos satelites de la MISMA zona si comparten entrada: el aislamiento es por alcance, no por usuario (R68)", async () => {
    const { service, repo } = montar();
    const otroSateliteX = { usuarioId: "u-sat-x2", rol: "adminSatelite", zonaId: ZONA_X };

    expect(await nombresDe(service, SATELITE_X)).toEqual(["Mensajero X"]);
    expect(await nombresDe(service, otroSateliteX)).toEqual(["Mensajero X"]);
    expect(repo.conteos).toHaveLength(1);
  });

  it("con una entrada CALIENTE de alcance global, un adminTienda recibe denegado y la cache ni se consulta (R69)", async () => {
    const { service, cache } = montar();
    await nombresDe(service, MAESTRO); // deja la entrada caliente

    const consultadas: string[] = [];
    const espia: ITableroDiaCache = {
      envolver: <T,>(clave: string, producir: () => Promise<T>): Promise<T> => {
        consultadas.push(clave);
        return cache.envolver(clave, producir);
      },
    };
    const conEspia = servicioDelTablero(
      new RepositorioDoble(() => [fila("m-x", "Mensajero X", { entregadas: 1 })]),
      espia,
    );

    expect(await conEspia.obtener(TIENDA, AHORA)).toEqual({
      estado: "denegado",
      motivo: "rol_no_autorizado",
    });
    expect(await conEspia.obtener(SATELITE_SIN_ZONA, AHORA)).toEqual({
      estado: "denegado",
      motivo: "sin_zona_asignada",
    });
    expect(await conEspia.obtener(null, AHORA)).toEqual({
      estado: "denegado",
      motivo: "sin_sesion",
    });

    // La cache es una optimizacion de lectura y NUNCA una ruta alternativa de autorizacion:
    // el denegado sale antes de que exista una clave que consultar.
    expect(consultadas).toEqual([]);
  });

  it("un denegado no recibe filas aunque la entrada caliente las tenga (R69)", async () => {
    const { service } = montar();
    await nombresDe(service, MAESTRO);

    const resultado = await service.obtener(TIENDA, AHORA);
    expect(resultado.estado).toBe("denegado");
    expect(resultado).not.toHaveProperty("tablero");
  });
});
