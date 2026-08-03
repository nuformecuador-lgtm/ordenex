import { describe, it, expect, vi } from "vitest";
import { OrdenService } from "@/lib/services/OrdenService";
import type {
  IOrdenRepository,
  ListOrdenesParams,
  ListOrdenesResult,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { listarOrdenesCompletoSchema, listarOrdenesSchema } from "@/lib/types/orden";
import { descargaConfig } from "@/lib/config/descarga";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

// Feature 151/T6 (R11/R12/R14/R16/R17/R18/R20/R21/R22) — modo SIN paginacion.
//
// Los tests de alcance corren contra un repositorio EN MEMORIA que evalua de verdad el
// `where` (incluida la exclusion de borradas que el repositorio real hace siempre), para
// afirmar el COMPORTAMIENTO (que filas salen) y no la forma del objeto. Los tests de
// tope usan un stub que puede declarar un `total` enorme sin materializar filas: es
// justamente lo que R22 exige del servicio.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const AHORA = new Date("2026-07-15T20:00:00.000Z");

const LIMITE = descargaConfig.MAX_FILAS;

interface FilaFake extends OrdenListItemDTO {
  deletedAt: Date | null;
  mensajeroAsignadoId: string | null;
}

function orden(over: Partial<FilaFake> & { id: string }): FilaFake {
  return {
    numGuia: null,
    numRemision: `R-${over.id}`,
    estatusId: "os1",
    destinatario: "Ana",
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
    deletedAt: null,
    ...over,
  };
}

function casaColumna(valor: string | null, criterio: string | string[] | undefined): boolean {
  if (criterio === undefined) return true;
  if (valor === null) return false;
  return Array.isArray(criterio) ? criterio.includes(valor) : criterio === valor;
}

/** Repositorio en memoria: aplica el `where` y, como el real, NUNCA devuelve borradas. */
function repoEnMemoria(filas: FilaFake[]) {
  const list = vi.fn(async (params: ListOrdenesParams): Promise<ListOrdenesResult> => {
    const { where } = params;
    const casan = filas
      .filter((f) => f.deletedAt === null) // exclusion de borrado logico (repo real)
      .filter(
        (f) =>
          casaColumna(f.tiendaId, where.tiendaId) &&
          casaColumna(f.estatusId, where.estatusId) &&
          casaColumna(f.zonaId, where.zonaId) &&
          casaColumna(
            f.mensajeroAsignadoId,
            where.mensajeroAsignadoId as string | undefined,
          ),
      )
      .sort((a, b) => {
        const cmp = a.createdAt.getTime() - b.createdAt.getTime();
        return params.sortDir === "desc" ? -cmp : cmp;
      });
    return {
      items: casan.slice(params.skip, params.skip + params.take) as OrdenListItemDTO[],
      total: casan.length,
    };
  });
  return { repo: { list } as unknown as IOrdenRepository, list };
}

/** Stub que declara un `total` cualquiera sin materializar mas de `take` filas. */
function repoStub(total: number) {
  const list = vi.fn(async (params: ListOrdenesParams): Promise<ListOrdenesResult> => ({
    items: Array.from({ length: Math.min(total, params.take) }, (_, i) =>
      orden({ id: `o${i}` }),
    ) as OrdenListItemDTO[],
    total,
  }));
  return { repo: { list } as unknown as IOrdenRepository, list };
}

function servicio(repo: IOrdenRepository) {
  return new OrdenService(repo, fakeIntentosEnLote(), () => AHORA);
}

function input(extra: Record<string, unknown> = {}) {
  return listarOrdenesCompletoSchema.parse(extra);
}

function ids(items: OrdenListItemDTO[]): string[] {
  return items.map((o) => o.id);
}

describe("OrdenService.listarCompleto — dataset sin paginacion", () => {
  it("devuelve todas las filas del dataset sin recorte por pagina (R11)", async () => {
    const filas = Array.from({ length: 120 }, (_, i) =>
      orden({ id: `o${String(i).padStart(3, "0")}` }),
    );
    const { repo } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const paginado = await svc.listar(listarOrdenesSchema.parse({ pageSize: 25 }), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    if (paginado.status !== "ok") return;
    expect(paginado.items).toHaveLength(25);

    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") return;
    expect(completo.items).toHaveLength(120);
    expect(completo.total).toBe(120);
  });

  it("acota el dataset del adminTienda a sus propias ordenes (R12)", async () => {
    const { repo } = repoEnMemoria([
      orden({ id: "propia1", tiendaId: "store1" }),
      orden({ id: "propia2", tiendaId: "store1" }),
      orden({ id: "ajena", tiendaId: "store2" }),
    ]);
    const r = await servicio(repo).listarCompleto(input(), TIENDA);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.items).sort()).toEqual(["propia1", "propia2"]);
    expect(r.total).toBe(2);
  });

  it("acota el dataset del mensajero a las ordenes que tiene asignadas (R12)", async () => {
    const { repo } = repoEnMemoria([
      orden({ id: "mia", mensajeroAsignadoId: "msg1" }),
      orden({ id: "de_otro", mensajeroAsignadoId: "msg2" }),
      orden({ id: "sin_asignar", mensajeroAsignadoId: null }),
    ]);
    const r = await servicio(repo).listarCompleto(input(), MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.items)).toEqual(["mia"]);
  });

  it("devuelve forbidden y ninguna fila cuando el rol no es conocido (R14)", async () => {
    const { repo, list } = repoEnMemoria([orden({ id: "o1" })]);
    const r = await servicio(repo).listarCompleto(input(), {
      usuarioId: "x",
      rol: "otroRol" as Actor["rol"],
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
    expect(list).not.toHaveBeenCalled(); // ni siquiera se consulta el dato
  });

  it("el filtro de tienda no amplia el alcance del adminTienda (R16)", async () => {
    const { repo } = repoEnMemoria([
      orden({ id: "propia", tiendaId: "store1" }),
      orden({ id: "ajena", tiendaId: "store2" }),
    ]);
    // El actor inyecta la tienda ajena en el filtro: el acotamiento por rol lo pisa.
    const r = await servicio(repo).listarCompleto(
      input({ filter: { tienda_id: ["store2"] } }),
      TIENDA,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.items)).toEqual(["propia"]);
  });

  it("pide al repositorio el mismo criterio de orden que el listado paginado (R17)", async () => {
    const filas = [
      orden({ id: "vieja", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
      orden({ id: "nueva", createdAt: new Date("2026-06-01T00:00:00.000Z") }),
      orden({ id: "media", createdAt: new Date("2026-03-01T00:00:00.000Z") }),
    ];
    const { repo, list } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const paginado = await svc.listar(listarOrdenesSchema.parse({}), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    const paramsPaginado = list.mock.calls[0][0];
    const paramsCompleto = list.mock.calls[1][0];
    expect(paramsCompleto.sortBy).toBe(paramsPaginado.sortBy);
    expect(paramsCompleto.sortDir).toBe(paramsPaginado.sortDir);
    expect(paramsCompleto.sortBy).toBe("created_at");
    // Pedido humano: el criterio compartido pasó a ASC (lo más antiguo primero).
    expect(paramsCompleto.sortDir).toBe("asc");

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["vieja", "media", "nueva"]);
    expect(ids(completo.items)).toEqual(ids(paginado.items));
  });

  it("excluye las ordenes borradas igual que el listado (R18)", async () => {
    const { repo, list } = repoEnMemoria([
      orden({ id: "viva" }),
      orden({ id: "borrada", deletedAt: new Date("2026-05-01T00:00:00.000Z") }),
    ]);
    const svc = servicio(repo);

    const paginado = await svc.listar(listarOrdenesSchema.parse({}), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(completo.status).toBe("ok");
    expect(paginado.status).toBe("ok");
    if (completo.status !== "ok" || paginado.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["viva"]);
    expect(ids(completo.items)).toEqual(ids(paginado.items));
    // Mismo `where` en ambos caminos: la exclusion no puede divergir porque el
    // predicado que llega al repositorio es literalmente el mismo.
    expect(list.mock.calls[1][0].where).toEqual(list.mock.calls[0][0].where);
  });

  it("devuelve limite_excedido con total y limite, y sin filas, cuando el total supera el tope (R20)", async () => {
    const { repo } = repoStub(LIMITE + 1);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    expect(r).toEqual({ status: "limite_excedido", total: LIMITE + 1, limite: LIMITE });
    expect(r).not.toHaveProperty("items");
  });

  it("nunca pide al repositorio mas de N+1 filas (R22)", async () => {
    const { repo, list } = repoStub(50_000);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    const params = list.mock.calls[0][0];
    expect(params.skip).toBe(0);
    expect(params.take).toBe(LIMITE + 1);
    expect(r.status).toBe("limite_excedido");
  });

  it("no devuelve un dataset truncado: o entrega todas las filas o el error de tope (R21)", async () => {
    // Justo en el tope: entrega TODO.
    const enElTope = repoStub(LIMITE);
    const ok = await servicio(enElTope.repo).listarCompleto(input(), MAESTRO);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.items).toHaveLength(LIMITE);
    expect(ok.items.length).toBe(ok.total);

    // Un paso por encima: NINGUNA fila, error accionable.
    const pasado = repoStub(LIMITE + 1);
    const excedido = await servicio(pasado.repo).listarCompleto(input(), MAESTRO);
    expect(excedido.status).toBe("limite_excedido");
    expect(excedido).not.toHaveProperty("items");
  });
});
