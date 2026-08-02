import { describe, it, expect, vi } from "vitest";
import { UsuarioService } from "@/lib/services/UsuarioService";
import type {
  IUserRepository,
  ListUsuariosParams,
  ListUsuariosResult,
  UsuarioListItem,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";
import { listarUsuariosCompletoSchema, listarUsuariosSchema } from "@/lib/types/usuario";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 170 / T B.1 (R9/R11/R17/R19/R27/R29) — dataset COMPLETO del listado de usuarios.
//
// Los tests de alcance corren contra un repositorio EN MEMORIA que ordena y recorta de
// verdad, para afirmar el COMPORTAMIENTO (qué filas salen) y no la forma del objeto. Los de
// tope usan un stub que puede declarar un `total` enorme sin materializar filas: es
// justamente lo que R29 exige del servicio.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

/**
 * Los roles que NO son `maestro`. Es la lista de contraprueba de R17: cada uno debe recibir
 * `forbidden` sin filas, y `maestro` (arriba) debe recibir las filas — sin ese segundo lado,
 * el test de acotamiento pasaría con un servicio que no devolviera nada a nadie.
 */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "a1", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

const LIMITE = descargaConfig.MAX_FILAS;

function usuario(over: Partial<UsuarioListItem> & { id: string }): UsuarioListItem {
  return {
    nombre: `Usuario ${over.id}`,
    email: `${over.id}@example.com`,
    rolValue: "mensajero",
    estado: "activo",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

/** Repositorio en memoria: ordena por la columna pedida y recorta con skip/take. */
function repoEnMemoria(filas: UsuarioListItem[]) {
  const list = vi.fn(async (params: ListUsuariosParams): Promise<ListUsuariosResult> => {
    const campo = params.sortBy ?? "createdAt";
    const ordenadas = [...filas].sort((a, b) => {
      const va = campo === "createdAt" ? a.createdAt.getTime() : String(a[campo as "nombre"]);
      const vb = campo === "createdAt" ? b.createdAt.getTime() : String(b[campo as "nombre"]);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return (params.sortDir ?? "desc") === "desc" ? -cmp : cmp;
    });
    return {
      items: ordenadas.slice(params.skip, params.skip + params.take),
      total: ordenadas.length,
    };
  });
  return { repo: { list } as unknown as IUserRepository, list };
}

/** Stub que declara un `total` cualquiera sin materializar más de `take` filas. */
function repoStub(total: number) {
  const list = vi.fn(async (params: ListUsuariosParams): Promise<ListUsuariosResult> => ({
    items: Array.from({ length: Math.min(total, params.take) }, (_, i) => usuario({ id: `u${i}` })),
    total,
  }));
  return { repo: { list } as unknown as IUserRepository, list };
}

function servicio(repo: IUserRepository) {
  return new UsuarioService(repo);
}

function input(extra: Record<string, unknown> = {}) {
  return listarUsuariosCompletoSchema.parse(extra);
}

function ids(items: UsuarioListItem[]): string[] {
  return items.map((u) => u.id);
}

describe("UsuarioService.listarCompleto — dataset sin paginacion", () => {
  it("devuelve todas las filas del dataset, sin recorte por pagina (R9)", async () => {
    const filas = Array.from({ length: 120 }, (_, i) =>
      usuario({ id: `u${String(i).padStart(3, "0")}` }),
    );
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listar(listarUsuariosSchema.parse({ pageSize: 25 }), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    if (paginado.status !== "ok") return;
    expect(paginado.items).toHaveLength(25);

    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") return;
    expect(completo.items).toHaveLength(120);
    expect(completo.total).toBe(120);
  });

  it("devuelve forbidden y ninguna fila a todo rol que no sea maestro (R17)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, list } = repoEnMemoria([usuario({ id: "u1" })]);
      const r = await servicio(repo).listarCompleto(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      // Ni siquiera se consulta el dato: el guard va ANTES de tocar la base.
      expect(list, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("CONTRAPRUEBA de R17: el maestro SI recibe las filas", async () => {
    // Sin esto, el test de arriba pasaría igual con un servicio que no devolviera nada a
    // NADIE: la ausencia de filas dejaría de significar «acotado» para significar «roto».
    const { repo, list } = repoEnMemoria([usuario({ id: "u1" }), usuario({ id: "u2" })]);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.items).sort()).toEqual(["u1", "u2"]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("pide al repositorio el mismo criterio de orden que el listado paginado (R11)", async () => {
    const filas = [
      usuario({ id: "vieja", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
      usuario({ id: "nueva", createdAt: new Date("2026-06-01T00:00:00.000Z") }),
      usuario({ id: "media", createdAt: new Date("2026-03-01T00:00:00.000Z") }),
    ];
    const { repo, list } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const paginado = await svc.listar(listarUsuariosSchema.parse({}), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    const paramsPaginado = list.mock.calls[0][0];
    const paramsCompleto = list.mock.calls[1][0];
    expect(paramsCompleto.sortBy).toBe(paramsPaginado.sortBy);
    expect(paramsCompleto.sortDir).toBe(paramsPaginado.sortDir);
    expect(paramsCompleto.sortBy).toBe("createdAt");
    expect(paramsCompleto.sortDir).toBe("desc");

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["nueva", "media", "vieja"]);
    expect(ids(completo.items)).toEqual(ids(paginado.items));
  });

  it("respeta el criterio de orden elegido, igual que el listado (R11)", async () => {
    const filas = [usuario({ id: "c" }), usuario({ id: "a" }), usuario({ id: "b" })];
    const { repo } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const paginado = await svc.listar(
      listarUsuariosSchema.parse({ sortBy: "nombre", sortDir: "asc" }),
      MAESTRO,
    );
    const completo = await svc.listarCompleto(
      input({ sortBy: "nombre", sortDir: "asc" }),
      MAESTRO,
    );

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["a", "b", "c"]);
    expect(ids(completo.items)).toEqual(ids(paginado.items));
  });

  it("entrega EXACTAMENTE el mismo conjunto que el listado recorriendo sus paginas (R9/R19)", async () => {
    // Así se verifica R19 aquí: el listado de usuarios NO excluye ninguna fila (no hay
    // borrado lógico en esta superficie; el estado `inactivo` SIGUE listándose). Lo que hay
    // que demostrar es la PARIDAD: lo que el archivo trae es lo mismo que la pantalla
    // muestra, ni una fila más ni una menos, sea cual sea el criterio del repositorio.
    const filas = [
      usuario({ id: "u1", estado: "activo" }),
      usuario({ id: "u2", estado: "inactivo" }),
      usuario({ id: "u3", estado: "bloqueado" }),
      usuario({ id: "u4", estado: "pendiente" }),
    ];
    const { repo, list } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const pagina1 = await svc.listar(listarUsuariosSchema.parse({ pageSize: 2, page: 1 }), MAESTRO);
    const pagina2 = await svc.listar(listarUsuariosSchema.parse({ pageSize: 2, page: 2 }), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(pagina1.status).toBe("ok");
    expect(pagina2.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (pagina1.status !== "ok" || pagina2.status !== "ok" || completo.status !== "ok") return;

    expect(ids(completo.items)).toEqual([...ids(pagina1.items), ...ids(pagina2.items)]);
    expect(completo.total).toBe(pagina1.total);

    // Y es el MISMO método del repositorio: cualquier exclusión que aquél aplique —hoy o
    // dentro de un año— la aplica idéntica en los dos caminos, porque es el mismo camino.
    expect(list.mock.calls.every(([params]) => "skip" in params && "take" in params)).toBe(true);
  });

  it("devuelve limite_excedido con total y limite, y sin filas, cuando el total supera el tope (R27)", async () => {
    const { repo } = repoStub(LIMITE + 1);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    expect(r).toEqual({ status: "limite_excedido", total: LIMITE + 1, limite: LIMITE });
    expect(r).not.toHaveProperty("items");
  });

  it("nunca pide al repositorio mas de N+1 filas (R29)", async () => {
    const { repo, list } = repoStub(50_000);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    const params = list.mock.calls[0][0];
    expect(params.skip).toBe(0);
    expect(params.take).toBe(LIMITE + 1);
    expect(r.status).toBe("limite_excedido");
  });

  it("no devuelve un dataset truncado: o entrega todas las filas o el error de tope (R28)", async () => {
    // Justo en el tope: entrega TODO.
    const ok = await servicio(repoStub(LIMITE).repo).listarCompleto(input(), MAESTRO);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.items).toHaveLength(LIMITE);
    expect(ok.items.length).toBe(ok.total);

    // Un paso por encima: NINGUNA fila, error accionable.
    const excedido = await servicio(repoStub(LIMITE + 1).repo).listarCompleto(input(), MAESTRO);
    expect(excedido.status).toBe("limite_excedido");
    expect(excedido).not.toHaveProperty("items");
  });
});
