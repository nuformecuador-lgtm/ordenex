import { describe, it, expect, vi } from "vitest";
import { VigenciaAvisoAgregadoService } from "@/lib/services/VigenciaAvisoAgregadoService";
import { vigenciaNoResuelta } from "@/lib/services/NotificacionService";
import type { IAvisoAgregadoRepository } from "@/lib/interfaces/repositories/IAvisoAgregadoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 409 (T5.2, R57) — LA CIFRA VIVA SE PIDE ACOTADA AL AMBITO DEL ACTOR.
//
// Es lo que hace que el numero del panel sea EL MISMO que el de su pantalla. Leerlo del
// `entidad_id` de la fila daria el numero del dia de la EMISION, que es justo lo que esta ficha
// existe para no volver a mostrar.

const AHORA = new Date("2026-09-11T13:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;
const ZONA = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

function repoEspia() {
  return {
    resumenNovedadesPorTienda: vi.fn<IAvisoAgregadoRepository["resumenNovedadesPorTienda"]>(
      async () => [],
    ),
    contarNovedadesDeTienda: vi.fn<IAvisoAgregadoRepository["contarNovedadesDeTienda"]>(
      async () => 5,
    ),
    resumenRepresadasPorZona: vi.fn<IAvisoAgregadoRepository["resumenRepresadasPorZona"]>(
      async () => [],
    ),
    resumenRepresadasGlobal: vi.fn<IAvisoAgregadoRepository["resumenRepresadasGlobal"]>(
      async () => ({ total: 0, masAntiguaAt: null }),
    ),
    contarRepresadas: vi.fn<IAvisoAgregadoRepository["contarRepresadas"]>(async () => 7),
  } satisfies IAvisoAgregadoRepository;
}

function servicio(repo: IAvisoAgregadoRepository, dias = 3) {
  return new VigenciaAvisoAgregadoService(repo, dias, () => AHORA);
}

const TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda", zonaId: null };
const SATELITE: Actor = { usuarioId: "sat-1", rol: "adminSatelite", zonaId: ZONA };
const MAESTRO: Actor = { usuarioId: "maestro-1", rol: "maestro", zonaId: null };
const ADMIN: Actor = { usuarioId: "admin-1", rol: "admin", zonaId: null };

describe("R57 — el ambito sale del ACTOR", () => {
  it("`novedades_sin_gestionar` se pide con el usuarioId de la tienda", async () => {
    const repo = repoEspia();

    const cifra = await servicio(repo).cifra("novedades_sin_gestionar", TIENDA);

    expect(cifra).toBe(5);
    expect(repo.contarNovedadesDeTienda).toHaveBeenCalledWith("tienda-1");
    expect(repo.contarRepresadas).not.toHaveBeenCalled();
  });

  it("`devoluciones_represadas` se pide con la ZONA del adminSatelite", async () => {
    const repo = repoEspia();

    await servicio(repo).cifra("devoluciones_represadas", SATELITE);

    expect(repo.contarRepresadas).toHaveBeenCalledTimes(1);
    const [cota, zonaId] = repo.contarRepresadas.mock.calls[0];
    expect(zonaId).toBe(ZONA);
    expect(cota.toISOString()).toBe(new Date(AHORA.getTime() - 3 * DIA_MS).toISOString());
  });

  it("⚠️ MUTACION: ignorar `actor.zonaId` le enseñaria al satelite el total del sistema", async () => {
    const repo = repoEspia();

    await servicio(repo).cifra("devoluciones_represadas", SATELITE);

    // Si el servicio pasara `null` aqui, el satelite veria las ordenes de OTRA bodega.
    expect(repo.contarRepresadas.mock.calls[0][1]).not.toBeNull();
  });

  it("maestro y admin lo piden GLOBAL (`null`), sin acotar por zona", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const repo = repoEspia();
      await servicio(repo).cifra("devoluciones_represadas", actor);
      expect(repo.contarRepresadas.mock.calls[0][1]).toBeNull();
    }
  });

  it("un adminSatelite SIN zona no ve el total: pide `null`, y el predicado de la 146 ya lo tapa", async () => {
    // `zonaId` es opcional en `Actor`; un satelite sin zona no ve ninguna notificacion acotada por
    // zona (146/R16), asi que la cifra ni siquiera llega a usarse.
    const repo = repoEspia();
    await servicio(repo).cifra("devoluciones_represadas", {
      usuarioId: "sat-sin-zona",
      rol: "adminSatelite",
    });
    expect(repo.contarRepresadas.mock.calls[0][1]).toBeNull();
  });
});

describe("R53 — el umbral entra inyectado, tambien aqui", () => {
  it("con 7 dias la cota se mueve siete dias atras", async () => {
    const repo = repoEspia();

    await servicio(repo, 7).cifra("devoluciones_represadas", MAESTRO);

    expect(repo.contarRepresadas.mock.calls[0][0].toISOString()).toBe(
      new Date(AHORA.getTime() - 7 * DIA_MS).toISOString(),
    );
  });
});

describe("un evento NO agregado no consulta nada", () => {
  it("lanza en vez de devolver un `0` de cortesia (un cero ocultaria un aviso vivo)", async () => {
    const repo = repoEspia();

    await expect(servicio(repo).cifra("orden_rechazada", MAESTRO)).rejects.toThrow(
      /no es un aviso agregado/,
    );
    expect(repo.contarNovedadesDeTienda).not.toHaveBeenCalled();
    expect(repo.contarRepresadas).not.toHaveBeenCalled();
  });
});

describe("el DEFAULT del service NO es un no-op: lanza", () => {
  it("`vigenciaNoResuelta` nombra lo que falta en vez de devolver un numero", async () => {
    // Un default que devolviera `0` apagaria los agregados SIEMPRE; uno que devolviera `1` no los
    // apagaria NUNCA. Los dos con la suite verde. Este lanza, y `listar` lo traduce en «mostrar»
    // (R58) dejando el error en el log.
    await expect(vigenciaNoResuelta.cifra("novedades_sin_gestionar", TIENDA)).rejects.toThrow(
      /nadie inyecto el resolutor de vigencia/,
    );
  });
});
