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

  // ⚠️ FICHA 417 (T2.1) — AQUI VIVIA UN CASO DEROGADO, y el motivo se queda escrito para quien lo
  // lea dentro de seis meses y no se encuentre «otro caso» sin explicacion.
  //
  // Se llamaba «un adminSatelite SIN zona no ve el total: pide `null`, y el predicado de la 146 ya
  // lo tapa» y su cuerpo entero era:
  //
  //     await servicio(repo).cifra("devoluciones_represadas", { usuarioId: "sat-sin-zona", rol: "adminSatelite" });
  //     expect(repo.contarRepresadas.mock.calls[0][1]).toBeNull();
  //
  // El titular prometia una proteccion y el aserto certificaba LO CONTRARIO: `null` **es** el total
  // del sistema (`AvisoAgregadoRepository.contarRepresadas`: `zonaId === null ? filas.length :
  // filas.filter(...)`). Ese `toBeNull()` no era el contrato de nada —era el defecto escrito como
  // expectativa—, asi que con el comportamiento de la 417 pasa a ser directamente falso. Lo
  // sustituyen los casos de abajo, que afirman lo que aquel nombre prometia.
  //
  // Lo unico cierto que decia —que el predicado de la 146 ya lo tapa— sigue siendolo y NO se ha
  // tocado (417/R8). Y es exactamente por eso que hacen falta estos casos: la proteccion vivia
  // ENTERA en otro archivo, y nada de aqui se ponia rojo si alguien la quitaba alli.
  describe("417/R1-R2 — un adminSatelite SIN zona no obtiene NINGUNA cifra, tampoco la global", () => {
    // `Actor.zonaId` es opcional (`IOrdenService.ts`), asi que el estado «sin zona» tiene TRES
    // formas representables y las tres son el mismo defecto.
    const SIN_ZONA: Array<[string, Actor]> = [
      ["zonaId: null", { usuarioId: "sat-sin-zona", rol: "adminSatelite", zonaId: null }],
      ["zonaId ausente", { usuarioId: "sat-sin-zona", rol: "adminSatelite" }],
      ["zonaId vacio", { usuarioId: "sat-sin-zona", rol: "adminSatelite", zonaId: "" }],
    ];

    // R1 y R2 van SEPARADOS a proposito: este afirma solo el «no se consulta» y el de abajo solo el
    // «falla con nombre». Sustituir el lanzamiento por un `return 0` deja este VERDE y pone rojo el
    // otro, y asi se ve exactamente que se perdio (mutacion M2). Juntos, los dos rojos taparian
    // cual de las dos mitades se rompio.
    it.each(SIN_ZONA)("R1 — con %s no se consulta NINGUN ambito", async (_forma, actor) => {
      const repo = repoEspia();

      await servicio(repo)
        .cifra("devoluciones_represadas", actor)
        .catch(() => undefined);

      expect(repo.contarRepresadas).not.toHaveBeenCalled();
      expect(repo.contarNovedadesDeTienda).not.toHaveBeenCalled();
    });

    it.each(SIN_ZONA)("R2 — con %s falla NOMBRANDO la causa", async (_forma, actor) => {
      // Literal ESCRITO A MANO, nunca importado de produccion: comparar el mensaje contra la
      // funcion que lo genera estaria siempre verde diga lo que diga.
      await expect(servicio(repoEspia()).cifra("devoluciones_represadas", actor)).rejects.toThrow(
        /no tiene zona asignada/i,
      );
    });
  });
});

// ⚠️ FICHA 417 (T2.2, R3/R4) — EL CASO ESPEJO, en la misma funcion y a seis lineas del anterior.
// `novedades_sin_gestionar` se acota por TIENDA, y en este esquema la tienda ES el `adminTienda`
// (`orden.tienda_id` es FK a `usuario`). Hasta la 417 la rama no comprobaba el rol: para cualquier
// otro actor ese `usuarioId` no identifica ninguna tienda, el conteo daba `0` y la 409/R55 apagaba
// el aviso SIN QUE NADIE LO LEYERA. El modo de fallo es el inverso del de arriba y es el peor de
// encontrar: un numero de mas se nota al mirarlo, un aviso que no sale no se nota nunca.
describe("417/R3-R4 — `novedades_sin_gestionar` solo lo cuenta un adminTienda", () => {
  const NO_ES_TIENDA: Array<[string, Actor]> = [
    ["maestro", MAESTRO],
    ["adminSatelite", SATELITE],
  ];

  it.each(NO_ES_TIENDA)("R3 — con un %s no se cuenta nada con su usuarioId", async (_rol, actor) => {
    const repo = repoEspia();

    await servicio(repo)
      .cifra("novedades_sin_gestionar", actor)
      .catch(() => undefined);

    expect(repo.contarNovedadesDeTienda).not.toHaveBeenCalled();
    expect(repo.contarRepresadas).not.toHaveBeenCalled();
  });

  it.each(NO_ES_TIENDA)("R4 — con un %s falla NOMBRANDO la causa", async (_rol, actor) => {
    // Literal escrito a mano, igual que arriba.
    await expect(servicio(repoEspia()).cifra("novedades_sin_gestionar", actor)).rejects.toThrow(
      /no es una tienda/i,
    );
  });

  it("R4 — ni siquiera devuelve el `0` que el repositorio daria: el `0` ES el modo de fallo", async () => {
    // Lo que pasaria de verdad sin guarda: `contarNovedadesDeTienda(<id que no es una tienda>)`
    // devuelve `0`, y un `0` apaga el aviso (409/R55) sin que nadie lo lea, lo marque ni lo
    // descarte. Este caso fija que ese `0` NO es un resultado aceptable, ni aunque sea el numero
    // que la consulta daria.
    const repo = repoEspia();
    repo.contarNovedadesDeTienda.mockResolvedValue(0);

    await expect(servicio(repo).cifra("novedades_sin_gestionar", MAESTRO)).rejects.toThrow(
      /no es una tienda/i,
    );
    expect(repo.contarNovedadesDeTienda).not.toHaveBeenCalled();
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
