import { describe, it, expect, vi } from "vitest";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import type {
  IPlantillaMensajeRepository,
  ListPlantillasParams,
  ListPlantillasResult,
  PlantillaListItem,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { Actor } from "@/lib/interfaces/services/IPlantillaMensajeService";
import {
  listarPlantillasCompletoSchema,
  listarPlantillasSchema,
} from "@/lib/types/plantilla-mensaje";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 170 / T B.1 (R9/R11/R17/R19/R27/R29) — dataset COMPLETO del listado de plantillas.
//
// R19 se puede probar DE VERDAD aquí (a diferencia de usuarios y API keys): el repositorio
// real excluye siempre las borradas (`deletedAt: null`, `VIGENTE`), así que el repositorio en
// memoria de este archivo hace lo mismo y el test comprueba que el archivo tampoco las trae.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

/** Contraprueba de R17: ninguno de éstos ve el listado; `MAESTRO` sí (test aparte). */
const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "a1", rol: "admin" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

const LIMITE = descargaConfig.MAX_FILAS;

interface FilaFake extends PlantillaListItem {
  deletedAt: Date | null;
}

function plantilla(over: Partial<FilaFake> & { id: string }): FilaFake {
  return {
    nombre: `Plantilla ${over.id}`,
    cuerpo: "Hola {{destinatario}}",
    estado: "activo",
    variables: ["destinatario"],
    templateId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...over,
  };
}

/**
 * Repositorio en memoria: como el real, NUNCA devuelve borradas y ordena `createdAt desc`.
 */
function repoEnMemoria(filas: FilaFake[]) {
  const list = vi.fn(async (params: ListPlantillasParams): Promise<ListPlantillasResult> => {
    const vigentes = filas
      .filter((p) => p.deletedAt === null) // exclusión de borrado lógico (repo real)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: vigentes.slice(params.skip, params.skip + params.take) as PlantillaListItem[],
      total: vigentes.length,
    };
  });
  return { repo: { list } as unknown as IPlantillaMensajeRepository, list };
}

/** Stub que declara un `total` cualquiera sin materializar más de `take` filas. */
function repoStub(total: number) {
  const list = vi.fn(async (params: ListPlantillasParams): Promise<ListPlantillasResult> => ({
    items: Array.from({ length: Math.min(total, params.take) }, (_, i) =>
      plantilla({ id: `p${i}` }),
    ) as PlantillaListItem[],
    total,
  }));
  return { repo: { list } as unknown as IPlantillaMensajeRepository, list };
}

function servicio(repo: IPlantillaMensajeRepository) {
  return new PlantillaMensajeService(repo);
}

function input() {
  return listarPlantillasCompletoSchema.parse({});
}

function ids(items: PlantillaListItem[]): string[] {
  return items.map((p) => p.id);
}

describe("PlantillaMensajeService.listarCompleto — dataset sin paginacion", () => {
  it("devuelve todas las filas del dataset, sin recorte por pagina (R9)", async () => {
    const filas = Array.from({ length: 90 }, (_, i) =>
      plantilla({
        id: `p${String(i).padStart(3, "0")}`,
        createdAt: new Date(2026, 0, 1 + i),
      }),
    );
    const svc = servicio(repoEnMemoria(filas).repo);

    const paginado = await svc.listar(listarPlantillasSchema.parse({ pageSize: 20 }), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    if (paginado.status !== "ok") return;
    expect(paginado.items).toHaveLength(20);

    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") return;
    expect(completo.items).toHaveLength(90);
    expect(completo.total).toBe(90);
  });

  it("devuelve forbidden y ninguna fila a todo rol que no sea maestro (R17)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, list } = repoEnMemoria([plantilla({ id: "p1" })]);
      const r = await servicio(repo).listarCompleto(input(), actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(list, `rol ${actor.rol}`).not.toHaveBeenCalled();
    }
  });

  it("CONTRAPRUEBA de R17: el maestro SI recibe las filas", async () => {
    const { repo, list } = repoEnMemoria([plantilla({ id: "p1" }), plantilla({ id: "p2" })]);
    const r = await servicio(repo).listarCompleto(input(), MAESTRO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(ids(r.items).sort()).toEqual(["p1", "p2"]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("excluye las plantillas borradas igual que el listado (R19)", async () => {
    const { repo } = repoEnMemoria([
      plantilla({ id: "viva", createdAt: new Date("2026-05-02T00:00:00.000Z") }),
      plantilla({
        id: "borrada",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        deletedAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ]);
    const svc = servicio(repo);

    const paginado = await svc.listar(listarPlantillasSchema.parse({}), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["viva"]);
    expect(ids(completo.items)).toEqual(ids(paginado.items));
    expect(completo.total).toBe(1);
  });

  it("mantiene el mismo criterio de orden que el listado, mas reciente primero (R11)", async () => {
    const filas = [
      plantilla({ id: "vieja", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
      plantilla({ id: "nueva", createdAt: new Date("2026-06-01T00:00:00.000Z") }),
      plantilla({ id: "media", createdAt: new Date("2026-03-01T00:00:00.000Z") }),
    ];
    const { repo } = repoEnMemoria(filas);
    const svc = servicio(repo);

    const paginado = await svc.listar(listarPlantillasSchema.parse({}), MAESTRO);
    const completo = await svc.listarCompleto(input(), MAESTRO);

    expect(paginado.status).toBe("ok");
    expect(completo.status).toBe("ok");
    if (paginado.status !== "ok" || completo.status !== "ok") return;
    expect(ids(completo.items)).toEqual(["nueva", "media", "vieja"]);
    expect(ids(completo.items)).toEqual(ids(paginado.items));
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
    const ok = await servicio(repoStub(LIMITE).repo).listarCompleto(input(), MAESTRO);
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    expect(ok.items).toHaveLength(LIMITE);
    expect(ok.items.length).toBe(ok.total);

    const excedido = await servicio(repoStub(LIMITE + 1).repo).listarCompleto(input(), MAESTRO);
    expect(excedido.status).toBe("limite_excedido");
    expect(excedido).not.toHaveProperty("items");
  });
});
