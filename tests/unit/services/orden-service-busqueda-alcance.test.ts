import { describe, it, expect, vi } from "vitest";
import { OrdenService } from "@/lib/services/OrdenService";
import { listarOrdenes, listarOrdenesCompleto } from "@/lib/actions/ordenes";
import type {
  IOrdenRepository,
  ListOrdenesParams,
  ListOrdenesResult,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor, IOrdenService } from "@/lib/interfaces/services/IOrdenService";
import {
  listarOrdenesCompletoSchema,
  listarOrdenesSchema,
  type OrdenListItemDTO,
} from "@/lib/types/orden";
import { normalizarTerminoBusqueda } from "@/lib/utils/busqueda-orden";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

// Feature 169 / T2.7 — ALCANCE POR ROL del buscador (R21, R22, R23, R24, R25).
//
// Es el test que impide la fuga. Un buscador es la forma mas comoda de sacar datos de un
// sistema: si el termino se compusiera con un `OR` en vez de con un `AND`, un adminTienda
// encontraria ordenes de sus competidores tecleando un nombre. Aqui se busca a proposito
// por datos EXACTOS de ordenes ajenas y se exige cero filas Y `total: 0` — el conteo
// tambien filtra, porque "hay 1 resultado que no puedes ver" ya es informacion.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "sat1", rol: "adminSatelite" };
const AHORA = new Date("2026-07-15T20:00:00.000Z");

interface FilaFake extends OrdenListItemDTO {
  mensajeroAsignadoId: string | null;
}

function orden(over: Partial<FilaFake> & { id: string }): FilaFake {
  return {
    numGuia: null,
    numRemision: `R-${over.id}`,
    estatusId: "os1",
    destinatario: "Ana Rojas",
    telefonoDest: "88880000",
    tiendaId: "store1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "caja",
    peso: null,
    notas: null,
    mensajeroAsignadoId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    tiendaNombre: "Tienda",
    ...over,
  };
}

/**
 * El texto que la columna generada contendria para esa fila, calculado con el MISMO
 * normalizador que usa el service. No es una segunda implementacion del SQL: la paridad
 * con Postgres la demuestra `tests/integration/db/busqueda-normalizacion-paridad.test.ts`;
 * aqui solo hace falta un repositorio que se comporte como el real para poder afirmar QUE
 * FILAS salen, en vez de la forma de un objeto.
 */
function textoBuscable(f: FilaFake): string {
  return normalizarTerminoBusqueda(
    [
      f.numGuia === null ? "" : String(f.numGuia),
      f.numRemision,
      f.telefonoDest,
      f.telefonoDest.replace(/[^0-9]/g, ""),
      f.destinatario,
    ].join(" "),
  );
}

/** Repositorio en memoria que aplica el acotamiento por rol Y el termino, como el real. */
function repoEnMemoria(filas: FilaFake[]) {
  const list = vi.fn(async (params: ListOrdenesParams): Promise<ListOrdenesResult> => {
    const { where } = params;
    const casan = filas.filter((f) => {
      if (where.tiendaId !== undefined && f.tiendaId !== where.tiendaId) return false;
      if (
        where.mensajeroAsignadoId !== undefined &&
        f.mensajeroAsignadoId !== where.mensajeroAsignadoId
      ) {
        return false;
      }
      if (where.numGuia !== undefined && f.numGuia !== where.numGuia) return false;
      if (where.busqueda !== undefined) {
        // M1 del review: el termino puede viajar en DOS formas (tal cual y solo digitos) y
        // el repositorio real las une con un OR sobre la MISMA columna. Este doble hace lo
        // mismo: si no, los casos de abajo pasarian por una razon distinta a la real.
        const texto = textoBuscable(f);
        const formas = [where.busqueda, where.busquedaDigitos].filter(
          (t): t is string => t !== undefined,
        );
        if (!formas.some((t) => texto.includes(t))) return false;
      }
      return true;
    });
    return {
      items: casan.slice(params.skip, params.skip + params.take) as OrdenListItemDTO[],
      total: casan.length,
    };
  });
  return { repo: { list } as unknown as IOrdenRepository, list };
}

function servicio(repo: IOrdenRepository) {
  return new OrdenService(repo, fakeIntentosEnLote(), () => AHORA);
}

const CATALOGO: FilaFake[] = [
  orden({ id: "propia", tiendaId: "store1", destinatario: "Ana Rojas", numGuia: 111 }),
  orden({
    id: "ajena",
    tiendaId: "store2",
    destinatario: "Bernarda Quesada",
    telefonoDest: "60005555",
    numGuia: 222,
  }),
  orden({
    id: "mia",
    tiendaId: "store2",
    mensajeroAsignadoId: "msg1",
    destinatario: "Carlos Vega",
    numGuia: 333,
  }),
];

async function buscar(termino: string, actor: Actor) {
  const { repo } = repoEnMemoria(CATALOGO);
  return servicio(repo).listar(
    listarOrdenesSchema.parse({ filter: { q: termino } }),
    actor,
  );
}

describe("adminTienda (R22)", () => {
  it("busca el NOMBRE EXACTO de un destinatario de otra tienda y no obtiene nada", async () => {
    const r = await buscar("bernarda quesada", TIENDA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items).toEqual([]);
    // El total tambien: "hay 1 resultado que no puedes ver" ya seria una fuga.
    expect(r.total).toBe(0);
  });

  it("busca el TELEFONO EXACTO de una orden ajena y no obtiene nada", async () => {
    const r = await buscar("60005555", TIENDA);
    expect(r.status === "ok" && r.total).toBe(0);
  });

  it("busca el TELEFONO ajeno CON separadores y sigue sin obtener nada (M1: las dos formas acotan)", async () => {
    // El termino de M1 viaja en dos formas y las dos van dentro del mismo OR, hermano del
    // acotamiento por rol. Si alguna de las dos se hubiera colado FUERA de ese AND, este
    // caso devolveria la orden de la otra tienda. La contraprueba de maestro esta al final
    // del archivo: con el mismo termino, el maestro SI la encuentra.
    const r = await buscar("6000-5555", TIENDA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("busca la GUIA EXACTA de una orden ajena y no obtiene nada (la ruta rapida tambien acota)", async () => {
    const r = await buscar("222", TIENDA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("si busca lo suyo, si lo encuentra (el acotamiento no rompe el caso de uso)", async () => {
    const r = await buscar("ana rojas", TIENDA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items.map((o) => o.id)).toEqual(["propia"]);
    expect(r.total).toBe(1);
  });

  it("R21: el termino solo ESTRECHA — con el, el adminTienda nunca ve mas que sin el", async () => {
    const { repo } = repoEnMemoria(CATALOGO);
    const svc = servicio(repo);
    const sinTermino = await svc.listar(listarOrdenesSchema.parse({}), TIENDA);
    const conTermino = await svc.listar(
      listarOrdenesSchema.parse({ filter: { q: "quesada" } }),
      TIENDA,
    );
    expect(sinTermino.status === "ok" && sinTermino.total).toBe(1);
    expect(conTermino.status === "ok" && conTermino.total).toBe(0);
  });
});

describe("mensajero (R23)", () => {
  it("busca una guia que no le fue asignada y no obtiene nada", async () => {
    const r = await buscar("111", MENSAJERO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("busca el nombre de un destinatario de una orden ajena y no obtiene nada", async () => {
    const r = await buscar("bernarda", MENSAJERO);
    expect(r.status === "ok" && r.total).toBe(0);
  });

  it("encuentra las suyas", async () => {
    const r = await buscar("carlos", MENSAJERO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items.map((o) => o.id)).toEqual(["mia"]);
  });
});

describe("rol no reconocido y sin sesion (R24/R25)", () => {
  it("R24: un adminSatelite recibe `forbidden` y NI SIQUIERA se consulta la base", async () => {
    const { repo, list } = repoEnMemoria(CATALOGO);
    const r = await servicio(repo).listar(
      listarOrdenesSchema.parse({ filter: { q: "ana rojas" } }),
      SATELITE,
    );
    expect(r.status).toBe("forbidden");
    expect(r).not.toHaveProperty("items");
    expect(r).not.toHaveProperty("total");
    expect(list).not.toHaveBeenCalled();
  });

  it("R24: tampoco en la descarga completa", async () => {
    const { repo, list } = repoEnMemoria(CATALOGO);
    const r = await servicio(repo).listarCompleto(
      listarOrdenesCompletoSchema.parse({ filter: { q: "ana rojas" } }),
      SATELITE,
    );
    expect(r.status).toBe("forbidden");
    expect(list).not.toHaveBeenCalled();
  });

  it("R25: sin sesion, `unauthenticated` y el servicio ni se instancia", async () => {
    const listar = vi.fn();
    const r = await listarOrdenes(
      { filter: { q: "ana rojas" } },
      { ordenService: { listar } as unknown as IOrdenService, getActor: async () => null },
    );
    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(r).not.toHaveProperty("total");
    expect(listar).not.toHaveBeenCalled();
  });

  it("R25: lo mismo en la descarga completa", async () => {
    const listarCompleto = vi.fn();
    const r = await listarOrdenesCompleto(
      { filter: { q: "ana rojas" } },
      {
        ordenService: { listarCompleto } as unknown as IOrdenService,
        getActor: async () => null,
      },
    );
    expect(r.status).toBe("unauthenticated");
    expect(listarCompleto).not.toHaveBeenCalled();
  });
});

describe("maestro (contraprueba: el catalogo si contiene lo que los demas no ven)", () => {
  it("el maestro SI encuentra las tres ordenes por sus datos", async () => {
    // Sin esta contraprueba, los casos de arriba podrian estar pasando "por vacio": un
    // termino que no encuentra nada en ninguna parte no demuestra ningun acotamiento.
    expect((await buscar("bernarda quesada", MAESTRO)).status).toBe("ok");
    for (const [termino, id] of [
      ["ana rojas", "propia"],
      ["bernarda quesada", "ajena"],
      ["carlos vega", "mia"],
      ["60005555", "ajena"],
      // M1: el mismo telefono tecleado CON separadores. Es la contraprueba del caso de
      // adminTienda de arriba: el termino encuentra la orden, y lo que la esconde es el rol.
      ["6000-5555", "ajena"],
    ] as const) {
      const r = await buscar(termino, MAESTRO);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") continue;
      expect(r.items.map((o) => o.id)).toEqual([id]);
    }
  });
});
