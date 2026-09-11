import { describe, it, expect, vi } from "vitest";
// FICHA 418 (T2.5) — `RolValue` entra como VALOR, no solo como tipo: es el catalogo REAL de roles
// del dominio y es lo que hace posible el caso exhaustivo de R5. Mismo patron que
// `tests/unit/services/alcance-borrado-orden.test.ts` y `lib/auth/acceso-total.ts`.
import { RolValue } from "@prisma/client";
import { VigenciaAvisoAgregadoService } from "@/lib/services/VigenciaAvisoAgregadoService";
import { vigenciaNoResuelta } from "@/lib/services/NotificacionService";
// FICHA 418 (T5.1, R7) — el CATALOGO se importa para compararlo con la lista blanca escrita a mano
// aqui. La lista blanca de PRODUCCION no lo importa, y por eso este aserto no es vacuo.
import { CATALOGO_AVISOS } from "@/lib/notificaciones/catalogo-avisos";
import type { IAvisoAgregadoRepository } from "@/lib/interfaces/repositories/IAvisoAgregadoRepository";
import type { IRepartoMananaRepository } from "@/lib/interfaces/repositories/IRepartoMananaRepository";
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

// ---------------------------------------------------------------------------------------------
// FICHA 413 (T6.1) - la tercera rama: la cifra viva del REPARTO DE MAÑANA.
// ---------------------------------------------------------------------------------------------

/**
 * Doble del repositorio de reparto. `contarReservadasParaOtroDia` devuelve 4 por defecto.
 *
 * ⚠️ `resumenPorMensajero` LANZA a proposito: ese metodo es del CRON, no de la lectura. Si el
 * resolutor lo llamara, este doble lo delata en vez de devolver un mudo `[]` que dejaria pasar el
 * cambio en silencio - mismo criterio que el doble de tarifas de la 412.
 */
function repartoEspia(total = 4) {
  return {
    resumenPorMensajero: vi.fn<IRepartoMananaRepository["resumenPorMensajero"]>(async () => {
      throw new Error("la cifra VIVA no usa el resumen del cron: eso es de la emision");
    }),
    contarReservadasParaOtroDia: vi.fn<IRepartoMananaRepository["contarReservadasParaOtroDia"]>(
      async () => total,
    ),
  } satisfies IRepartoMananaRepository;
}

function servicioConReparto(
  reparto: IRepartoMananaRepository,
  ahora: Date = AHORA,
  repo: IAvisoAgregadoRepository = repoEspia(),
) {
  return new VigenciaAvisoAgregadoService(repo, 3, () => ahora, reparto);
}

const MENSAJERO: Actor = { usuarioId: "u-mensajero-413", rol: "mensajero", zonaId: null };

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

// ⚠️ FICHA 418 (T2, R3-R7) — LA LISTA BLANCA DE `devoluciones_represadas`, Y POR QUE HACE FALTA.
//
// Hasta la 418 esta rama decidia por EXCLUSION: `rol !== "adminSatelite"` => ambito global, o sea
// `contarRepresadas(cota, null)`, que en `AvisoAgregadoRepository` es EL TOTAL DEL SISTEMA. El enum
// tiene SEIS roles y la condicion nombraba UNO, asi que `mensajero`, `adminTienda` y `apiKey` caian
// en el total por omision —y el septimo valor que alguien añadiera al enum entraria con ellos—.
//
// NOTA DE HONESTIDAD: hoy ese estado NO ES ALCANZABLE, y lo impiden dos capas AJENAS a este seam
// (quien recibe el aviso en `lib/notificaciones/emitir.ts`, y el predicado de visibilidad de la 146
// en `lib/repositories/NotificacionRepository.ts`). Estos casos se las saltan A PROPOSITO: lo que
// se prueba es una defensa en profundidad, no un camino vivo. El punto entero de la ficha es que
// ANTES DE ELLA nada de aqui se ponia rojo si alguien metia a esos tres roles en el ambito global,
// porque ningun aserto lo afirmaba.
describe("418/R3-R7 — el ambito de `devoluciones_represadas` se decide por INCLUSION", () => {
  // La lista blanca, ESCRITA A MANO aqui. No se importa de produccion a proposito: comparar la
  // lista contra la constante que la genera estaria siempre verde diga lo que diga.
  const LISTA_BLANCA_A_MANO: readonly RolValue[] = ["maestro", "admin", "adminSatelite"];

  // Los tres roles de HOY que quedan fuera. Con zona util a proposito: asi el fallo no puede venir
  // de la guarda de zona de la 417, solo de no tener ambito en este aviso.
  const SIN_AMBITO: Array<[string, Actor]> = [
    ["mensajero", { usuarioId: "men-9", rol: "mensajero", zonaId: ZONA }],
    ["adminTienda", { usuarioId: "tienda-9", rol: "adminTienda", zonaId: ZONA }],
    ["apiKey", { usuarioId: "key-9", rol: "apiKey", zonaId: ZONA }],
  ];

  // R3 y R4 van SEPARADOS a proposito, igual que en la 417: sustituir el lanzamiento por un
  // `return 0` deja el de R3 VERDE (el repositorio sigue sin llamarse) y pone rojo solo el de R4,
  // y asi el rojo dice QUE se perdio. Juntos, dos rojos taparian cual de las dos mitades se rompio.
  it.each(SIN_AMBITO)("R3 — con un %s no se consulta NINGUN ambito", async (_rol, actor) => {
    const repo = repoEspia();

    await servicio(repo)
      .cifra("devoluciones_represadas", actor)
      .catch(() => undefined);

    expect(repo.contarRepresadas).not.toHaveBeenCalled();
    expect(repo.contarNovedadesDeTienda).not.toHaveBeenCalled();
  });

  it.each(SIN_AMBITO)("R4 — con un %s falla NOMBRANDO la causa", async (_rol, actor) => {
    // Literal ESCRITO A MANO, nunca importado de produccion.
    await expect(servicio(repoEspia()).cifra("devoluciones_represadas", actor)).rejects.toThrow(
      /no define ambito para el rol/i,
    );
  });

  it("R4 — ni siquiera devuelve el `7` que el repositorio daria: ese 7 ES el total del sistema", async () => {
    // El espia devuelve 7 para `contarRepresadas`, y con ambito `null` ese 7 es EL TOTAL DEL
    // SISTEMA (`AvisoAgregadoRepository`: `zonaId === null ? filas.length : filas.filter(...)`).
    // Este caso fija que ese numero no es un resultado aceptable para quien no tiene ambito: ni el
    // total, ni un `0` de cortesia que apagaria la fila en silencio (409/R55).
    const repo = repoEspia();

    await expect(
      servicio(repo).cifra("devoluciones_represadas", SIN_AMBITO[0][1]),
    ).rejects.toThrow(/no define ambito para el rol/i);

    expect(repo.contarRepresadas).not.toHaveBeenCalled();
  });

  it("R6 — el error NO es el de las otras dos guardas del mismo metodo, y no lleva el usuarioId", async () => {
    // Sin esto, el `rejects.toThrow` de R4 podria estar pasando POR EL ERROR EQUIVOCADO: los tres
    // fallos de ambito de este metodo aterrizan en el mismo `catch` de `cifrasVivas`.
    const actor = SIN_AMBITO[0][1];
    const error = await servicio(repoEspia())
      .cifra("devoluciones_represadas", actor)
      .then(() => null)
      .catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/no define ambito para el rol/i);
    // Los dos literales hermanos, escritos a mano: el del adminSatelite sin zona y el del rol que
    // no es tienda. El mensaje nuevo no puede ser ninguno de los dos.
    expect(error!.message).not.toMatch(/no tiene zona asignada/i);
    expect(error!.message).not.toMatch(/no es una tienda/i);
    // Y NO lleva PII: el id del usuario no viaja en el mensaje (design §4). El rol si, y a
    // proposito: no es dato personal y es lo que hace el error accionable.
    expect(error!.message).not.toContain("men-9");
    expect(error!.message).toContain("mensajero");
  });

  it("R5 — el catalogo ENTERO de roles queda clasificado: lo que no esta enumerado NO obtiene cifra", async () => {
    // Autocomprobacion sobre el enum REAL de Prisma, no sobre una lista de excepciones sueltas. Si
    // mañana nace un `RolValue`, cae aqui y por defecto FALLA CERRADO —nunca en el ambito global,
    // que es exactamente lo que la lista negra hacia—.
    const roles = Object.values(RolValue);
    expect(roles.length).toBeGreaterThanOrEqual(6);

    const fuera = roles.filter((rol) => !LISTA_BLANCA_A_MANO.includes(rol));
    // El escenario no puede estar vacio: un `for` sobre cero roles reportaria `passed` sin haber
    // comprobado nada.
    expect(fuera.length).toBe(roles.length - LISTA_BLANCA_A_MANO.length);
    expect(fuera.length).toBeGreaterThan(0);

    for (const rol of fuera) {
      const repo = repoEspia();
      const actor: Actor = { usuarioId: `u-${rol}`, rol, zonaId: ZONA };

      await expect(servicio(repo).cifra("devoluciones_represadas", actor)).rejects.toThrow(
        /no define ambito para el rol/i,
      );
      expect(repo.contarRepresadas).not.toHaveBeenCalled();
      expect(repo.contarNovedadesDeTienda).not.toHaveBeenCalled();
    }
  });

  it("R7 — la lista blanca no diverge de los destinatarios declarados del aviso en el catalogo", () => {
    // Lo que convierte la lista blanca de «escrita a mano» en «derivada de una fuente». Sin este
    // aserto, el dia que alguien añada un rol a `destinatarios` la lista blanca se queda corta y
    // NADA se pone rojo — el mismo fallo mudo que esta ficha existe para no repetir.
    //
    // El servicio NO lee el catalogo en tiempo de ejecucion (design §7-B): si lo leyera, esto seria
    // una asercion contra su propia fuente y estaria siempre verde.
    const delCatalogo = [...CATALOGO_AVISOS.devoluciones_represadas.destinatarios];

    expect([...LISTA_BLANCA_A_MANO].sort()).toEqual(delCatalogo.sort());
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
// =============================================================================================
// FICHA 413 - LA CIFRA VIVA DEL REPARTO DE MAÑANA (R13, R17, R21, R41, R43)
// =============================================================================================

describe("413/R13 - el ambito sale del ACTOR, y aqui el actor ES el mensajero", () => {
  it("⭑ se pide con `actor.usuarioId` y con la cota de HOY, y devuelve esa cifra", async () => {
    const reparto = repartoEspia(4);

    const cifra = await servicioConReparto(reparto).cifra("reparto_manana", MENSAJERO);

    expect(cifra).toBe(4);
    expect(reparto.contarReservadasParaOtroDia).toHaveBeenCalledTimes(1);
    const [mensajeroId, cota] = reparto.contarReservadasParaOtroDia.mock.calls[0];
    expect(mensajeroId).toBe("u-mensajero-413");
    // ⚠️ `startOfDayCR(2026-09-11T13:00Z)` = `2026-09-11T00:00:00Z`: la convencion de `@db.Date`.
    // Con `inicioDelDiaCREnUtc` saldria `...T06:00:00Z`, seis horas mas tarde, y el aviso contaria
    // otra poblacion que la pantalla.
    expect(cota.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("⭑ NO lee nada del `entidad_id` de la fila: la firma ni siquiera lo recibe", async () => {
    // `cifra(evento, actor)` - no hay por donde entrar la entidad. Leerla de ahi daria el numero
    // del INSTANTE DE LA EMISION, que es justo lo que esta cifra existe para no mostrar.
    const reparto = repartoEspia(9);

    await servicioConReparto(reparto).cifra("reparto_manana", MENSAJERO);

    expect(reparto.contarReservadasParaOtroDia.mock.calls[0]).toHaveLength(2);
  });

  it("⭑ y no toca el repositorio de los DOS agregados de la 409 (R41: una consulta, no tres)", async () => {
    const agregados = repoEspia();
    const reparto = repartoEspia();

    await servicioConReparto(reparto, AHORA, agregados).cifra("reparto_manana", MENSAJERO);

    expect(agregados.contarNovedadesDeTienda).not.toHaveBeenCalled();
    expect(agregados.contarRepresadas).not.toHaveBeenCalled();
    expect(reparto.contarReservadasParaOtroDia).toHaveBeenCalledTimes(1);
  });
});

describe("413/R17 - el rol que NO puede tener reparto asignado hace FALLAR la resolucion", () => {
  it("⭑⭑ un `adminTienda` pidiendo este evento LANZA, y no consulta nada", async () => {
    // ⚠️ ES LA REGLA QUE CERRO LA 417: *si el ambito del actor no existe, se falla; no se inventa
    // uno.* Para quien no es mensajero, su `usuarioId` no identifica a ningun mensajero asignado:
    // el conteo solo podria dar `0`, y la 409/R55 apagaria el aviso SIN QUE NADIE LO LEA, LO
    // MARQUE NI LO DESCARTE. Ese es el PEOR de los dos modos de fallo: un numero de mas se nota al
    // mirarlo, un aviso que no sale no se nota nunca.
    //
    // MUTACION OBLIGATORIA (design 13.5): devolver `0` en vez de lanzar => ESTO SE PONE ROJO.
    const reparto = repartoEspia();

    await expect(servicioConReparto(reparto).cifra("reparto_manana", TIENDA)).rejects.toThrow(
      /es de un mensajero y el rol "adminTienda" no lo es/,
    );

    expect(reparto.contarReservadasParaOtroDia).not.toHaveBeenCalled();
  });

  it("⭑ y TODOS los roles que no son `mensajero` fallan igual - no solo el `adminTienda`", async () => {
    // Decide por INCLUSION, como las dos ramas hermanas desde la 418: lo que no es `mensajero` no
    // tiene ambito y lanza. Un rol NUEVO del enum entra por aqui y falla CERRADO.
    const roles = Object.values(RolValue).filter((r) => r !== "mensajero");
    // El escenario no puede estar vacio.
    expect(roles.length).toBeGreaterThanOrEqual(5);

    for (const rol of roles) {
      const reparto = repartoEspia();
      const actor: Actor = { usuarioId: `u-${rol}`, rol, zonaId: ZONA };

      await expect(servicioConReparto(reparto).cifra("reparto_manana", actor)).rejects.toThrow(
        /es de un mensajero/,
      );
      expect(reparto.contarReservadasParaOtroDia).not.toHaveBeenCalled();
    }
  });

  it("⭑ ANTI-VACUIDAD: el `mensajero` SI obtiene su cifra - el bucle de arriba no es vacuo", async () => {
    const reparto = repartoEspia(6);

    await expect(servicioConReparto(reparto).cifra("reparto_manana", MENSAJERO)).resolves.toBe(6);
  });

  it("⭑ si NADIE inyecto el repositorio, LANZA en vez de devolver un numero (R36)", async () => {
    // La familia «el composition root que no inyecta»: sin esta rama, un `buildService` que se
    // olvidara del repositorio dejaria el aviso apagado para TODOS los mensajeros, en silencio.
    const servicioSinCablear = new VigenciaAvisoAgregadoService(repoEspia(), 3, () => AHORA);

    await expect(servicioSinCablear.cifra("reparto_manana", MENSAJERO)).rejects.toThrow(
      /necesita el repositorio de reparto y nadie lo inyecto/,
    );
  });
});

describe("413/R21 - cuando llega el dia anunciado, la cifra cae a cero SOLA", () => {
  it("⭑⭑ con el reloj en las 00:01 CR del 12, la cota AVANZA sola", async () => {
    // ⚠️ ES EL TEST QUE PROTEGE LA PALABRA «MAÑANA» DEL TITULO. No hay ningun proceso que caduque
    // el aviso: al pasar la medianoche CR, `startOfDayCR(now)` AVANZA y las ordenes del dia
    // anunciado dejan de ser «posteriores». La cifra cae a 0, `presentacionDe` devuelve `null` y
    // el aviso desaparece del panel y del distintivo, SIN que nadie lo lea, lo marque ni lo
    // descarte.
    //
    // Aqui se mide la MITAD que es de este servicio: que la cota que pide AVANZA con el reloj. La
    // otra mitad -que con esa cota el conteo da 0- vive contra Postgres (R21 en
    // `reparto-manana-repository.test.ts`), porque es el `WHERE`.
    //
    // MUTACION OBLIGATORIA (design 13.4): un resolutor que devolviera siempre `1` => el aviso no
    // se apagaria nunca y sobreviviria a su dia.
    const antes = repartoEspia();
    const despues = repartoEspia();

    // 23:50 CR del 11 (= 05:50Z del 12): la cota sigue siendo el dia 11.
    await servicioConReparto(antes, new Date("2026-09-12T05:50:00.000Z")).cifra(
      "reparto_manana",
      MENSAJERO,
    );
    // 00:01 CR del 12 (= 06:01Z del 12): la cota ya es el dia 12.
    await servicioConReparto(despues, new Date("2026-09-12T06:01:00.000Z")).cifra(
      "reparto_manana",
      MENSAJERO,
    );

    expect(antes.contarReservadasParaOtroDia.mock.calls[0][1].toISOString()).toBe(
      "2026-09-11T00:00:00.000Z",
    );
    // ⭑ LA COTA AVANZO SOLA, sin que nadie ejecutara nada ni escribiera nada.
    expect(despues.contarReservadasParaOtroDia.mock.calls[0][1].toISOString()).toBe(
      "2026-09-12T00:00:00.000Z",
    );
  });
});

describe("413/R43 - la cifra viva NO consulta cierres, y es una DECISION", () => {
  it("⭑⭑ con un doble que FALLA si alguien le pide el bloqueo, la cifra sale igual", async () => {
    // ⚠️ EL FILTRO DEL BLOQUEADO ES DE **EMISION**, NO DE LECTURA (design 6.1). Esta ruta corre en
    // CADA SONDEO de 60 s: meterle una consulta de cierres romperia R41 -una consulta de mas en la
    // ruta caliente- y ataria el apagado de este aviso a un estado que YA TIENE SU PROPIO AVISO.
    //
    // Lo que se acepta a cambio, dicho: quien reciba su aviso a las 19:00 y se bloquee a las 21:00
    // convivira esa noche con los dos, hasta que este se apague solo a medianoche. Un aviso de mas
    // es la direccion segura, y el de bloqueo es accionable.
    //
    // MUTACION OBLIGATORIA (design 13.11): meter la comprobacion del bloqueo aqui => el servicio
    // necesitaria un repositorio de cierres que NO TIENE (no compila), o llamaria a este doble y
    // ESTE CASO SE PONE ROJO.
    const reparto = repartoEspia(5);
    const cierresQueExplotan = {
      findMensajerosBloqueadosPorCierres: vi.fn(async () => {
        throw new Error("la cifra VIVA no consulta cierres: el filtro del bloqueo es de EMISION");
      }),
    };

    // El servicio NO recibe este repositorio por constructor -no hay parametro para el-, asi que
    // la comprobacion de verdad es la de abajo: la cifra sale y el doble NO se toco.
    const cifra = await servicioConReparto(reparto).cifra("reparto_manana", MENSAJERO);

    expect(cifra).toBe(5);
    expect(cierresQueExplotan.findMensajerosBloqueadosPorCierres).not.toHaveBeenCalled();
  });

  it("⭑ R41: UNA sola consulta por resolucion, ni una mas", async () => {
    // El coste declarado de la ficha: «1 `count` por sondeo de 60 s Y SOLO para el mensajero que
    // tiene el aviso vivo». Si alguien metiera aqui la consulta de cierres, serian dos.
    const reparto = repartoEspia();

    await servicioConReparto(reparto).cifra("reparto_manana", MENSAJERO);

    expect(reparto.contarReservadasParaOtroDia).toHaveBeenCalledTimes(1);
    expect(reparto.resumenPorMensajero).not.toHaveBeenCalled();
  });
});
