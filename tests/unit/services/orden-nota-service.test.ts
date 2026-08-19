import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { OrdenNotaService, proyectarNota } from "@/lib/services/OrdenNotaService";
import type {
  CrearOrdenNotaInput,
  IOrdenNotaRepository,
  OrdenNotaRow,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { VENTANA_ESCRITURA } from "@/lib/types/ventana-hilo-notas";

// Feature 227 (T2.7) — el SERVICE del hilo, con dobles. Sin DB, sin HTTP, sin Next.
//
// Cubre R1, R4, R5, R9, R10, R11, R12, R14, R15, R25, R28, R31, R33, R34 y R35. Los nombres de
// los `it` son LITERALMENTE los de la tabla de trazabilidad de `tasks.md`: el reviewer los cruza
// uno a uno, y un nombre "mejorado" es un requisito que parece sin test.
//
// El doble del repositorio es SEMANTICO, no una lista de `mockResolvedValue`: guarda las filas
// en memoria y se comporta como `orden_nota` (orden por `createdAt asc, id asc`, borrado logico
// con el `autorId` y el `ordenId` en el WHERE, sin filtrar las borradas al leer). Con un mock que
// solo devuelve valores fijos, tests como R1 («las previas no se tocan») o R31 («el resto del
// hilo queda intacto») no demostrarian nada: afirmarian lo que el propio mock decidio devolver.

const TIENDA = "u-tienda";
const OTRA_TIENDA = "u-otra-tienda";
const MENSAJERO = "u-mensajero";
const OTRO_MENSAJERO = "u-otro-mensajero";

const ORDEN = "11111111-1111-4111-8111-111111111111";
const ORDEN_AJENA = "22222222-2222-4222-8222-222222222222";
const ORDEN_INEXISTENTE = "33333333-3333-4333-8333-333333333333";

const actorTienda: Actor = { usuarioId: TIENDA, rol: "adminTienda" };
const actorMensajero: Actor = { usuarioId: MENSAJERO, rol: "mensajero" };

interface FilaFake {
  id: string;
  ordenId: string;
  autorId: string;
  autorNombre: string;
  rolAutor: RolValue;
  cuerpo: string;
  createdAt: Date;
  deletedAt: Date | null;
}

/** La fila de `orden`, con la nota de la TIENDA incluida: R25 se comprueba mirandola. */
interface OrdenFake extends OrdenParaHilo {
  /** `orden.notas`: la nota de la TIENDA (R14a del schema). NO es el hilo. */
  notas: string | null;
}

function fila(over: Partial<FilaFake> = {}): FilaFake {
  return {
    id: "n1",
    ordenId: ORDEN,
    autorId: TIENDA,
    autorNombre: "Tienda Uno",
    rolAutor: "adminTienda",
    cuerpo: "cuerpo",
    createdAt: new Date("2026-08-15T10:00:00.000Z"),
    deletedAt: null,
    ...over,
  };
}

function aRow(f: FilaFake): OrdenNotaRow {
  return {
    id: f.id,
    autorId: f.autorId,
    rolAutor: f.rolAutor,
    cuerpo: f.cuerpo,
    createdAt: f.createdAt,
    deletedAt: f.deletedAt,
    autor: { nombre: f.autorNombre },
  };
}

interface Escenario {
  service: OrdenNotaService;
  repo: {
    [K in keyof IOrdenNotaRepository]: ReturnType<typeof vi.fn>;
  } & IOrdenNotaRepository;
  filas: FilaFake[];
  ordenes: Map<string, OrdenFake>;
  /** Total de llamadas a CUALQUIER metodo del repo (R28 se mide con esto). */
  llamadas: () => number;
}

function escenario(opciones: { filas?: FilaFake[]; ordenes?: Record<string, Partial<OrdenFake>> } = {}): Escenario {
  const filas = opciones.filas ?? [];
  let seq = filas.length;

  const ordenes = new Map<string, OrdenFake>();
  const declaradas = opciones.ordenes ?? {
    [ORDEN]: {},
    [ORDEN_AJENA]: { tiendaId: OTRA_TIENDA, mensajeroAsignadoId: OTRO_MENSAJERO },
  };
  for (const [id, over] of Object.entries(declaradas)) {
    ordenes.set(id, {
      tiendaId: TIENDA,
      mensajeroAsignadoId: MENSAJERO,
      estatusValue: "devuelta",
      // 2026-08-18: default `false` para que los casos existentes sigan midiendo la ventana por
      // ESTATUS y nada mas. Los que ejercitan la segunda puerta lo sobreescriben.
      ayuda: false,
      deletedAt: null,
      notas: "nota de la tienda, escrita en la carga masiva",
      ...over,
    });
  }

  const repo = {
    listarPorOrden: vi.fn(async (ordenId: string): Promise<OrdenNotaRow[]> =>
      // NO filtra las borradas (R34) y desempata por `id` los instantes repetidos (R3).
      filas
        .filter((f) => f.ordenId === ordenId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map(aRow),
    ),
    crear: vi.fn(async (input: CrearOrdenNotaInput): Promise<OrdenNotaRow> => {
      const nueva = fila({
        id: `n${++seq}`,
        ordenId: input.ordenId,
        autorId: input.autorId,
        autorNombre: input.autorId === TIENDA ? "Tienda Uno" : "Mensajero Uno",
        rolAutor: input.rolAutor,
        cuerpo: input.cuerpo,
        createdAt: new Date(`2026-08-15T12:00:0${seq}.000Z`),
      });
      filas.push(nueva);
      return aRow(nueva);
    }),
    marcarBorrada: vi.fn(async (notaId: string, ordenId: string, autorId: string): Promise<number> => {
      // El WHERE completo del `updateMany` real: id + orden + autor + vigente.
      const objetivo = filas.find(
        (f) => f.id === notaId && f.ordenId === ordenId && f.autorId === autorId && f.deletedAt === null,
      );
      if (!objetivo) return 0;
      objetivo.deletedAt = new Date("2026-08-15T13:00:00.000Z");
      return 1;
    }),
    findOrdenParaHilo: vi.fn(async (ordenId: string): Promise<OrdenParaHilo | null> => {
      const o = ordenes.get(ordenId);
      return o
        ? {
            tiendaId: o.tiendaId,
            mensajeroAsignadoId: o.mensajeroAsignadoId,
            estatusValue: o.estatusValue,
            ayuda: o.ayuda,
            deletedAt: o.deletedAt,
          }
        : null;
    }),
  };

  return {
    service: new OrdenNotaService(repo as unknown as IOrdenNotaRepository),
    repo: repo as unknown as Escenario["repo"],
    filas,
    ordenes,
    llamadas: () =>
      repo.listarPorOrden.mock.calls.length +
      repo.crear.mock.calls.length +
      repo.marcarBorrada.mock.calls.length +
      repo.findOrdenParaHilo.mock.calls.length,
  };
}

// =============================================================================================
// A) Publicacion y forma de las filas
// =============================================================================================

describe("R1 — publicar no toca el hilo previo", () => {
  it("publicar añade una nota sin alterar las previas del hilo", async () => {
    const previas = [
      fila({ id: "n1", cuerpo: "primera", createdAt: new Date("2026-08-15T10:00:00.000Z") }),
      fila({
        id: "n2",
        autorId: MENSAJERO,
        autorNombre: "Mensajero Uno",
        rolAutor: "mensajero",
        cuerpo: "segunda",
        createdAt: new Date("2026-08-15T11:00:00.000Z"),
      }),
    ];
    const copiaPrevia = previas.map((f) => ({ ...f }));
    const { service, filas } = escenario({ filas: previas });

    const r = await service.publicar({ ordenId: ORDEN, cuerpo: "tercera" }, actorTienda);

    expect(r.status).toBe("ok");
    expect(filas).toHaveLength(3); // N + 1
    // Las N previas conservan cuerpo, autor e instante IDENTICOS.
    for (const [i, antes] of copiaPrevia.entries()) {
      expect(filas[i].cuerpo).toBe(antes.cuerpo);
      expect(filas[i].autorId).toBe(antes.autorId);
      expect(filas[i].createdAt.toISOString()).toBe(antes.createdAt.toISOString());
      expect(filas[i].deletedAt).toBeNull();
    }
  });
});

describe("R4 — el rol del autor queda congelado", () => {
  it("conserva el rol con el que se publicó aunque el rol del usuario cambie", async () => {
    const { service, filas } = escenario({
      ordenes: { [ORDEN]: { estatusValue: "en_reparto" } },
    });

    await service.publicar({ ordenId: ORDEN, cuerpo: "voy en camino" }, actorMensajero);
    expect(filas[0].rolAutor).toBe("mensajero");

    // El MISMO usuario, ahora con otro rol: la fila ya escrita no se reescribe, y la lectura
    // devuelve el rol CONGELADO, no el vigente. (Se lee con la contraparte para que la lectura
    // no dependa de que el actor siga teniendo acceso por su rol nuevo.)
    const ascendido: Actor = { usuarioId: MENSAJERO, rol: "adminSatelite" };
    expect(ascendido.rol).not.toBe(filas[0].rolAutor);

    const leido = await service.listar({ ordenId: ORDEN }, actorTienda);
    expect(leido.status).toBe("ok");
    if (leido.status !== "ok") return;
    expect(leido.notas[0].rolAutor).toBe("mensajero");
  });
});

describe("R5 — el autor sale del actor, nunca de la entrada", () => {
  it("ignora un autor enviado en la entrada y usa el de la sesión", async () => {
    const { service, repo, filas } = escenario();

    // Una entrada CONTAMINADA con un autor ajeno (y un rol ajeno, ya puestos).
    await service.publicar(
      { ordenId: ORDEN, cuerpo: "quien firma esto", autorId: OTRO_MENSAJERO, rolAutor: "maestro" } as never,
      actorTienda,
    );

    expect(repo.crear).toHaveBeenCalledWith({
      ordenId: ORDEN,
      autorId: TIENDA, // el de la SESION
      rolAutor: "adminTienda",
      cuerpo: "quien firma esto",
    });
    expect(filas[0].autorId).toBe(TIENDA);
    expect(filas[0].autorId).not.toBe(OTRO_MENSAJERO);
  });
});

// =============================================================================================
// B) Autorizacion, alcance y ventana
// =============================================================================================

describe("R9 — alcance del adminTienda", () => {
  it("permite al adminTienda leer y publicar en una orden de su tienda", async () => {
    const { service, repo } = escenario();

    const leido = await service.listar({ ordenId: ORDEN }, actorTienda);
    expect(leido.status).toBe("ok");

    const publicado = await service.publicar({ ordenId: ORDEN, cuerpo: "la reprogramo" }, actorTienda);
    expect(publicado.status).toBe("ok");

    // La pertenencia se resuelve con el identificador del ACTOR contra `orden.tiendaId`, y el
    // repo solo recibe el `ordenId`: no hay ningun `tiendaId` viajando en el input.
    expect(repo.findOrdenParaHilo).toHaveBeenCalledWith(ORDEN);
  });
});

describe("R10 — orden ajena y orden inexistente son indistinguibles", () => {
  it("rechaza igual una orden de otra tienda y una inexistente, sin revelar cuál es", async () => {
    const { service, repo, filas } = escenario({ filas: [fila({ ordenId: ORDEN_AJENA, cuerpo: "secreto" })] });

    const ajena = await service.listar({ ordenId: ORDEN_AJENA }, actorTienda);
    const inexistente = await service.listar({ ordenId: ORDEN_INEXISTENTE }, actorTienda);
    expect(ajena).toEqual({ status: "forbidden" });
    expect(inexistente).toEqual(ajena); // MISMO resultado, byte a byte

    const publicaAjena = await service.publicar({ ordenId: ORDEN_AJENA, cuerpo: "x" }, actorTienda);
    const publicaInexistente = await service.publicar({ ordenId: ORDEN_INEXISTENTE, cuerpo: "x" }, actorTienda);
    expect(publicaAjena).toEqual({ status: "forbidden" });
    expect(publicaInexistente).toEqual(publicaAjena);

    // El hilo ajeno no se devuelve NI se lee: el rechazo ocurre antes de tocarlo.
    expect(repo.listarPorOrden).not.toHaveBeenCalled();
    expect(repo.crear).not.toHaveBeenCalled();
    expect(filas).toHaveLength(1);
    expect(filas[0].cuerpo).toBe("secreto");
  });

  it("una orden BORRADA logicamente se trata igual que una inexistente", async () => {
    const { service } = escenario({ ordenes: { [ORDEN]: { deletedAt: new Date("2026-08-01T00:00:00.000Z") } } });
    expect(await service.listar({ ordenId: ORDEN }, actorTienda)).toEqual({ status: "forbidden" });
  });
});

describe("R11 — alcance del mensajero", () => {
  it("da acceso al mensajero asignado y rechaza al no asignado, también en lectura", async () => {
    const { service, repo } = escenario({
      filas: [fila({ cuerpo: "la tienda pregunta" })],
      ordenes: { [ORDEN]: { estatusValue: "en_reparto" } },
    });

    const asignado = await service.listar({ ordenId: ORDEN }, actorMensajero);
    expect(asignado.status).toBe("ok");
    if (asignado.status === "ok") expect(asignado.notas).toHaveLength(1);

    // Otro mensajero: rechazo TAMBIEN en lectura, no solo al escribir.
    const otro: Actor = { usuarioId: OTRO_MENSAJERO, rol: "mensajero" };
    expect(await service.listar({ ordenId: ORDEN }, otro)).toEqual({ status: "forbidden" });
    expect(await service.publicar({ ordenId: ORDEN, cuerpo: "x" }, otro)).toEqual({ status: "forbidden" });

    // Y una orden SIN mensajero asignado tampoco es de nadie.
    const { service: sinAsignar } = escenario({
      ordenes: { [ORDEN]: { mensajeroAsignadoId: null, estatusValue: "en_reparto" } },
    });
    expect(await sinAsignar.listar({ ordenId: ORDEN }, actorMensajero)).toEqual({ status: "forbidden" });

    expect(repo.crear).not.toHaveBeenCalled();
  });
});

describe("R12 — no hay vista de supervision", () => {
  it("rechaza a maestro, admin y adminSatelite en leer, publicar y eliminar", async () => {
    const { service, repo, filas } = escenario({ filas: [fila()] });

    for (const rol of ["maestro", "admin", "adminSatelite"] as const) {
      const intruso: Actor = { usuarioId: "u-intruso", rol };
      expect(await service.listar({ ordenId: ORDEN }, intruso), rol).toEqual({ status: "forbidden" });
      expect(await service.publicar({ ordenId: ORDEN, cuerpo: "x" }, intruso), rol).toEqual({
        status: "forbidden",
      });
      expect(await service.borrar({ ordenId: ORDEN, notaId: "n1" }, intruso), rol).toEqual({
        status: "forbidden",
      });
    }

    // Ni una fila creada ni marcada; ni siquiera se llego a consultar la orden.
    expect(repo.findOrdenParaHilo).not.toHaveBeenCalled();
    expect(repo.crear).not.toHaveBeenCalled();
    expect(repo.marcarBorrada).not.toHaveBeenCalled();
    expect(filas).toHaveLength(1);
    expect(filas[0].deletedAt).toBeNull();
  });
});

describe("R14 — ventana de escritura ASIMETRICA por rol", () => {
  it("la tienda publica solo en devuelta y el mensajero solo en en_reparto (matriz rol × estatus)", async () => {
    // La matriz completa, explicita. `esperado` = cuantas filas debe haber DESPUES de publicar.
    const matriz: { estatus: string; actor: Actor; permitido: boolean }[] = [
      { estatus: "devuelta", actor: actorTienda, permitido: true },
      { estatus: "devuelta", actor: actorMensajero, permitido: false },
      { estatus: "en_reparto", actor: actorTienda, permitido: false },
      { estatus: "en_reparto", actor: actorMensajero, permitido: true },
      { estatus: "entregada", actor: actorTienda, permitido: false },
      { estatus: "entregada", actor: actorMensajero, permitido: false },
      { estatus: "reprogramada", actor: actorTienda, permitido: false },
      { estatus: "reprogramada", actor: actorMensajero, permitido: false },
      { estatus: "rechazada", actor: actorTienda, permitido: false },
      { estatus: "rechazada", actor: actorMensajero, permitido: false },
    ];

    for (const caso of matriz) {
      const { service, repo, filas } = escenario({ ordenes: { [ORDEN]: { estatusValue: caso.estatus } } });
      const etiqueta = `${caso.actor.rol} @ ${caso.estatus}`;

      const r = await service.publicar({ ordenId: ORDEN, cuerpo: "mensaje" }, caso.actor);

      expect(r.status, etiqueta).toBe(caso.permitido ? "ok" : "forbidden");
      // En cada RECHAZO, cero filas nuevas.
      expect(filas.length, etiqueta).toBe(caso.permitido ? 1 : 0);
      expect(repo.crear.mock.calls.length, etiqueta).toBe(caso.permitido ? 1 : 0);
    }

    // Y la asimetria, dicha en una sola linea: la ventana de cada rol es la de SU pantalla.
    expect(VENTANA_ESCRITURA).toEqual({ adminTienda: "devuelta", mensajero: "en_reparto" });
  });

  // Pedido humano 2026-08-18 — SEGUNDA PUERTA, y solo para la tienda: una solicitud de ayuda viva
  // le abre la ventana en cualquier estatus. Sin esto, la tienda ve en `/novedades` una orden EN
  // REPARTO con ayuda pedida —la lista desde que `novedadWhere` gano su segunda rama—, lee que el
  // mensajero pide auxilio y no puede ni contestarle ni pulsar «Habilitar», porque las dos cosas
  // pasan por `publicar`. Permiso inejercitable, con la ventana quieta y la superficie creciendo.
  it("con `ayuda` viva la TIENDA publica fuera de `devuelta`; el mensajero NO gana nada", async () => {
    const conAyuda = { estatusValue: "en_reparto", ayuda: true };

    const tienda = escenario({ ordenes: { [ORDEN]: conAyuda } });
    expect(
      await tienda.service.publicar({ ordenId: ORDEN, cuerpo: "te llamo ya" }, actorTienda),
    ).toMatchObject({ status: "ok" });
    expect(tienda.filas).toHaveLength(1);

    // El mensajero ya podia publicar ahi por SU ventana (`en_reparto`): `ayuda` no le anade nada
    // y no se le ensancha a ningun otro estatus.
    const mensajeroFuera = escenario({
      ordenes: { [ORDEN]: { estatusValue: "entregada", ayuda: true } },
    });
    expect(
      await mensajeroFuera.service.publicar({ ordenId: ORDEN, cuerpo: "x" }, actorMensajero),
    ).toEqual({ status: "forbidden" });
    expect(mensajeroFuera.filas).toHaveLength(0);
  });

  it("sin `ayuda`, la ventana de la tienda sigue siendo EXACTAMENTE `devuelta`", async () => {
    // La contraprueba del caso de arriba: lo que abre la puerta es la bandera, no el estatus.
    const { service, filas } = escenario({
      ordenes: { [ORDEN]: { estatusValue: "en_reparto", ayuda: false } },
    });
    expect(await service.publicar({ ordenId: ORDEN, cuerpo: "x" }, actorTienda)).toEqual({
      status: "forbidden",
    });
    expect(filas).toHaveLength(0);
  });

  it("`por_recoger` NO abre ventana para nadie (decision deliberada del design §2.2)", async () => {
    const { service, filas } = escenario({ ordenes: { [ORDEN]: { estatusValue: "por_recoger" } } });
    expect(await service.publicar({ ordenId: ORDEN, cuerpo: "x" }, actorMensajero)).toEqual({
      status: "forbidden",
    });
    expect(await service.publicar({ ordenId: ORDEN, cuerpo: "x" }, actorTienda)).toEqual({
      status: "forbidden",
    });
    expect(filas).toHaveLength(0);
  });

  it("`puedeEscribir` de la lectura es POR ROL, no «la orden esta en devuelta»", async () => {
    const enDevuelta = escenario({ ordenes: { [ORDEN]: { estatusValue: "devuelta" } } });
    const tiendaEnDevuelta = await enDevuelta.service.listar({ ordenId: ORDEN }, actorTienda);
    const mensajeroEnDevuelta = await enDevuelta.service.listar({ ordenId: ORDEN }, actorMensajero);
    expect(tiendaEnDevuelta).toMatchObject({ status: "ok", puedeEscribir: true });
    expect(mensajeroEnDevuelta).toMatchObject({ status: "ok", puedeEscribir: false });

    const enReparto = escenario({ ordenes: { [ORDEN]: { estatusValue: "en_reparto" } } });
    expect(await enReparto.service.listar({ ordenId: ORDEN }, actorTienda)).toMatchObject({
      status: "ok",
      puedeEscribir: false,
    });
    expect(await enReparto.service.listar({ ordenId: ORDEN }, actorMensajero)).toMatchObject({
      status: "ok",
      puedeEscribir: true,
    });
  });
});

describe("R15 — leer siempre, en cualquier estatus", () => {
  it("devuelve el hilo completo con la orden ya fuera de devuelta", async () => {
    const escritas = [
      fila({ id: "n1", cuerpo: "escrita cuando estaba devuelta" }),
      fila({
        id: "n2",
        autorId: MENSAJERO,
        autorNombre: "Mensajero Uno",
        rolAutor: "mensajero",
        cuerpo: "respondida en reparto",
        createdAt: new Date("2026-08-15T11:00:00.000Z"),
      }),
    ];

    for (const estatus of ["en_reparto", "entregada", "rechazada"]) {
      const { service } = escenario({
        filas: escritas.map((f) => ({ ...f })),
        ordenes: { [ORDEN]: { estatusValue: estatus } },
      });
      const r = await service.listar({ ordenId: ORDEN }, actorTienda);
      expect(r.status, estatus).toBe("ok");
      if (r.status !== "ok") continue;
      expect(r.notas.map((n) => n.cuerpo), estatus).toEqual([
        "escrita cuando estaba devuelta",
        "respondida en reparto",
      ]);
      // La lectura no aplica ventana: en `entregada` nadie escribe, pero todos leen.
      if (estatus !== "en_reparto") expect(r.puedeEscribir, estatus).toBe(false);
    }
  });
});

describe("R25 — la nota de la TIENDA no se toca", () => {
  it("publicar en el hilo no altera la nota de la tienda", async () => {
    const { service, ordenes, repo } = escenario({ filas: [fila()] });
    const notaTiendaAntes = ordenes.get(ORDEN)!.notas;

    await service.publicar({ ordenId: ORDEN, cuerpo: "una nota del hilo" }, actorTienda);
    await service.borrar({ ordenId: ORDEN, notaId: "n1" }, actorTienda);

    // `orden.notas` (la nota de la TIENDA, escrita en la carga masiva) queda IDENTICA...
    expect(ordenes.get(ORDEN)!.notas).toBe(notaTiendaAntes);
    // ...y no por casualidad: el service ni la lee. Lo unico que consulta de la orden es la
    // proyeccion minima de autorizacion, que no incluye `notas`.
    for (const proyeccion of repo.findOrdenParaHilo.mock.results) {
      expect(Object.keys(await proyeccion.value).sort()).toEqual([
        // 2026-08-18: `ayuda` entra en la proyeccion de AUTORIZACION porque la ventana del
        // adminTienda pasa a depender tambien de ella. La lista sigue siendo cerrada a proposito:
        // es lo que impide que `notas` —la nota de la TIENDA, otra cosa— se cuele aqui algun dia.
        "ayuda",
        "deletedAt",
        "estatusValue",
        "mensajeroAsignadoId",
        "tiendaId",
      ]);
    }
    // Y no existe ninguna via de escritura sobre la orden en el contrato del repo.
    expect(Object.keys(repo).sort()).toEqual([
      "crear",
      "findOrdenParaHilo",
      "listarPorOrden",
      "marcarBorrada",
    ]);
  });
});

describe("R28 — el hilo se lee de una vez", () => {
  it("lee el hilo con una sola llamada al repositorio", async () => {
    const { service, repo, llamadas } = escenario({
      filas: [fila({ id: "n1" }), fila({ id: "n2" }), fila({ id: "n3" })],
    });

    const r = await service.listar({ ordenId: ORDEN }, actorTienda);
    expect(r.status).toBe("ok");

    // UNA lectura del hilo para TRES notas: nunca una consulta por nota (que es lo que R28
    // prohibe). El total de llamadas al repo es 2 y no puede crecer con el tamaño del hilo:
    // la otra es la de AUTORIZACION (`findOrdenParaHilo`), que el design §2.2 exige como paso 2
    // de las tres operaciones y ocurre una sola vez.
    expect(repo.listarPorOrden).toHaveBeenCalledTimes(1);
    expect(repo.findOrdenParaHilo).toHaveBeenCalledTimes(1);
    expect(llamadas()).toBe(2);
  });
});

// =============================================================================================
// A bis) Eliminar notas propias
// =============================================================================================

describe("R31 — el autor borra su nota (logico, dentro de su ventana)", () => {
  it("el autor elimina su nota dentro de su ventana y el resto del hilo queda intacto", async () => {
    const { service, filas } = escenario({
      filas: [
        fila({ id: "n1", cuerpo: "primera", createdAt: new Date("2026-08-15T10:00:00.000Z") }),
        fila({ id: "n2", cuerpo: "la del medio", createdAt: new Date("2026-08-15T11:00:00.000Z") }),
        fila({ id: "n3", cuerpo: "tercera", createdAt: new Date("2026-08-15T12:00:00.000Z") }),
      ],
    });

    expect(await service.borrar({ ordenId: ORDEN, notaId: "n2" }, actorTienda)).toEqual({ status: "ok" });

    // La fila SIGUE EXISTIENDO, con su autor y su instante de borrado: borrado LOGICO.
    expect(filas).toHaveLength(3);
    const borrada = filas.find((f) => f.id === "n2")!;
    expect(borrada.deletedAt).toBeInstanceOf(Date);
    expect(borrada.autorId).toBe(TIENDA);

    // Las otras dos, intactas y en el mismo orden.
    const r = await service.listar({ ordenId: ORDEN }, actorTienda);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.notas.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(r.notas.map((n) => n.cuerpo)).toEqual(["primera", "", "tercera"]);
    expect(r.notas.map((n) => n.eliminada)).toEqual([false, true, false]);
  });
});

describe("R32 — nadie borra notas ajenas", () => {
  it("la contraparte y un maestro no pueden eliminar una nota ajena", async () => {
    const { service, filas } = escenario({
      filas: [fila({ id: "n1", cuerpo: "la escribio la tienda" })],
      ordenes: { [ORDEN]: { estatusValue: "en_reparto" } },
    });

    // La CONTRAPARTE del hilo: tiene acceso a la orden y esta DENTRO de su ventana.
    expect(await service.borrar({ ordenId: ORDEN, notaId: "n1" }, actorMensajero)).toEqual({
      status: "forbidden",
    });
    // Un `maestro`: ni siquiera entra al hilo (P9: no hay moderacion).
    const maestro: Actor = { usuarioId: "u-maestro", rol: "maestro" };
    expect(await service.borrar({ ordenId: ORDEN, notaId: "n1" }, maestro)).toEqual({
      status: "forbidden",
    });

    // La nota sigue VIGENTE y con el mismo cuerpo.
    expect(filas[0].deletedAt).toBeNull();
    expect(filas[0].cuerpo).toBe("la escribio la tienda");
  });
});

describe("R33 — borrado inexistente / ajeno / repetido", () => {
  it("devuelve el mismo resultado tipado ante una nota inexistente, ajena o ya eliminada", async () => {
    const { service, filas } = escenario({
      filas: [
        fila({ id: "n1", cuerpo: "propia y vigente" }),
        fila({
          id: "n2",
          autorId: MENSAJERO,
          autorNombre: "Mensajero Uno",
          rolAutor: "mensajero",
          cuerpo: "ajena",
        }),
        fila({ id: "n3", ordenId: ORDEN_AJENA, cuerpo: "de otra tienda" }),
      ],
    });

    const inexistente = await service.borrar({ ordenId: ORDEN, notaId: "n-que-no-existe" }, actorTienda);
    const ajena = await service.borrar({ ordenId: ORDEN, notaId: "n2" }, actorTienda);
    const deOtraOrden = await service.borrar({ ordenId: ORDEN, notaId: "n3" }, actorTienda);

    expect(await service.borrar({ ordenId: ORDEN, notaId: "n1" }, actorTienda)).toEqual({ status: "ok" });
    const yaBorrada = await service.borrar({ ordenId: ORDEN, notaId: "n1" }, actorTienda);

    // Los cuatro casos, EL MISMO resultado: el borde no dice si la nota existe.
    expect(inexistente).toEqual({ status: "forbidden" });
    expect(ajena).toEqual(inexistente);
    expect(deOtraOrden).toEqual(inexistente);
    expect(yaBorrada).toEqual(inexistente);

    // El conteo de notas VIGENTES solo bajo por el borrado legitimo (n1).
    expect(filas.filter((f) => f.deletedAt === null).map((f) => f.id)).toEqual(["n2", "n3"]);
  });
});

describe("R34 — la nota eliminada deja marca y no filtra su cuerpo", () => {
  it("una nota eliminada viaja marcada, con autor y hora, y con el cuerpo vacío", async () => {
    const creada = new Date("2026-08-15T10:30:00.000Z");
    const { service } = escenario({
      filas: [
        fila({
          id: "n1",
          autorId: MENSAJERO,
          autorNombre: "Mensajero Uno",
          rolAutor: "mensajero",
          cuerpo: "TEXTO QUE NO DEBE CRUZAR EL BORDE",
          createdAt: creada,
          deletedAt: new Date("2026-08-15T11:00:00.000Z"),
        }),
      ],
      ordenes: { [ORDEN]: { estatusValue: "en_reparto" } },
    });

    // Los DOS lados ven exactamente el mismo hueco marcado.
    for (const actor of [actorTienda, actorMensajero]) {
      const r = await service.listar({ ordenId: ORDEN }, actor);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") continue;
      const [nota] = r.notas;
      expect(nota.eliminada, actor.rol).toBe(true);
      expect(nota.cuerpo, actor.rol).toBe(""); // el cuerpo NO viaja
      expect(nota.autorNombre, actor.rol).toBe("Mensajero Uno"); // autor conservado
      expect(nota.rolAutor, actor.rol).toBe("mensajero");
      expect(nota.createdAt, actor.rol).toBe(creada.toISOString()); // hora conservada
      expect(JSON.stringify(nota), actor.rol).not.toContain("NO DEBE CRUZAR");
    }
  });

  it("la proyeccion aislada es la unica que decide, y no publica `autorId`", () => {
    const vigente = proyectarNota(aRow(fila({ id: "n1", cuerpo: "hola" })), TIENDA);
    expect(vigente).toEqual({
      id: "n1",
      cuerpo: "hola",
      autorNombre: "Tienda Uno",
      rolAutor: "adminTienda",
      createdAt: "2026-08-15T10:00:00.000Z",
      esPropia: true,
      eliminada: false,
    });
    expect(Object.keys(vigente)).not.toContain("autorId");

    const ajenaBorrada = proyectarNota(
      aRow(fila({ id: "n2", cuerpo: "secreto", deletedAt: new Date("2026-08-15T11:00:00.000Z") })),
      MENSAJERO,
    );
    expect(ajenaBorrada.esPropia).toBe(false);
    expect(ajenaBorrada.cuerpo).toBe("");
    expect(ajenaBorrada.eliminada).toBe(true);
  });
});

describe("R35 — fuera de la ventana, las notas quedan congeladas", () => {
  it("fuera de su ventana, ningún rol puede eliminar ni siquiera sus propias notas", async () => {
    // La tienda, con la orden ya en `en_reparto` (su ventana cerrada), no borra LO SUYO.
    const tienda = escenario({
      filas: [fila({ id: "n1", cuerpo: "propia de la tienda" })],
      ordenes: { [ORDEN]: { estatusValue: "en_reparto" } },
    });
    expect(await tienda.service.borrar({ ordenId: ORDEN, notaId: "n1" }, actorTienda)).toEqual({
      status: "forbidden",
    });
    expect(tienda.filas[0].deletedAt).toBeNull();
    expect(tienda.repo.marcarBorrada).not.toHaveBeenCalled();

    // El mensajero, con la orden en `devuelta` (su ventana cerrada), tampoco borra LO SUYO.
    const mensajero = escenario({
      filas: [
        fila({
          id: "n1",
          autorId: MENSAJERO,
          autorNombre: "Mensajero Uno",
          rolAutor: "mensajero",
          cuerpo: "propia del mensajero",
        }),
      ],
      ordenes: { [ORDEN]: { estatusValue: "devuelta" } },
    });
    expect(await mensajero.service.borrar({ ordenId: ORDEN, notaId: "n1" }, actorMensajero)).toEqual({
      status: "forbidden",
    });
    expect(mensajero.filas[0].deletedAt).toBeNull();

    // Y en un estatus terminal, nadie borra nada.
    const terminal = escenario({
      filas: [fila({ id: "n1" })],
      ordenes: { [ORDEN]: { estatusValue: "entregada" } },
    });
    expect(await terminal.service.borrar({ ordenId: ORDEN, notaId: "n1" }, actorTienda)).toEqual({
      status: "forbidden",
    });
    expect(terminal.filas[0].deletedAt).toBeNull();

    // Dentro de la ventana propia, el borrado SI procede (contraprueba de R31: sin ella este
    // test pasaria igual con un service que rechazara SIEMPRE).
    const dentro = escenario({ filas: [fila({ id: "n1" })], ordenes: { [ORDEN]: { estatusValue: "devuelta" } } });
    expect(await dentro.service.borrar({ ordenId: ORDEN, notaId: "n1" }, actorTienda)).toEqual({
      status: "ok",
    });
    expect(dentro.filas[0].deletedAt).toBeInstanceOf(Date);
  });
});
