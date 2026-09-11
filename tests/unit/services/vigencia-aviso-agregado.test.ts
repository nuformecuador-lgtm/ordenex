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
