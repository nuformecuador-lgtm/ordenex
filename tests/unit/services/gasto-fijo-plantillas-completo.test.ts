import { describe, it, expect, vi } from "vitest";
import { GastoFijoPlantillaService } from "@/lib/services/GastoFijoPlantillaService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RangoPagina } from "@/lib/utils/rango-pagina";
import { descargaConfig } from "@/lib/config/descarga";

// Feature 184 — Tanda G (R1/R4/R5/R6) — el CONJUNTO del que sale el archivo del listado 11,
// «Plantillas de gasto fijo».
//
// **Lo que esta tanda NO gana, y conviene decirlo antes que nada:** nada de coste. La lectura
// del conjunto es literalmente la que la pantalla ya releia (`repo.listar()`), un `findMany`
// sin `where` sobre una tabla de configuracion con un punado de filas. No hay firma de URL que
// evitar (tanda C) ni agregados de dinero que dejar de calcular (tanda B). Lo que si hay, y es
// lo unico que estos casos pueden afirmar sin mentir:
//
//   1. el TOPE se evalua en el servidor (R6) y por encima de el no cruza ni una fila;
//   2. el alcance sigue siendo el del rol, evaluado ANTES de tocar el repositorio (R4);
//   3. el conjunto y la pagina son el mismo conjunto en el mismo orden (R5).
//
// El tercero es el que hace de esto algo mas que fontaneria: si el conjunto y la pagina se
// separaran, la fila 26 del archivo dejaria de ser la primera de la pagina 2 y no habria
// ninguna pantalla que lo dijera.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };

const ROLES_SIN_ACCESO: Actor[] = [
  { usuarioId: "s1", rol: "adminSatelite" },
  { usuarioId: "t1", rol: "adminTienda" },
  { usuarioId: "g1", rol: "mensajero" },
  { usuarioId: "k1", rol: "apiKey" },
  { usuarioId: "x1", rol: "otroRolInventado" as Actor["rol"] },
];

function plantilla(id: string, dia: number, activa = true): GastoFijoPlantillaDTO {
  return {
    id,
    concepto: `Concepto ${id}`,
    monto: "1000.00",
    activa,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-06-01",
    createdAt: `2026-06-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: `2026-06-${String(dia).padStart(2, "0")}T00:00:00.000Z`,
  };
}

/**
 * Cinco filas que DIFIEREN en `createdAt` —el campo por el que ordena este listado— y en
 * `activa`. Que difieran no es decorado: una mutacion que reordene el conjunto sobre un
 * almacen con la misma fecha en todas las filas sobrevive sin que nadie lo note.
 */
const ALMACEN: GastoFijoPlantillaDTO[] = [
  plantilla("p-1", 1),
  plantilla("p-2", 2, false),
  plantilla("p-3", 3),
  plantilla("p-4", 4, false),
  plantilla("p-5", 5),
];

function porCreadoDesc(a: GastoFijoPlantillaDTO, b: GastoFijoPlantillaDTO): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Doble de repositorio que ordena como ordena el repositorio de verdad (`createdAt desc`, una
 * sola declaracion en `GastoFijoPlantillaRepository`) y anota QUE metodo se llamo. Lo que este
 * doble NO ve es la traduccion a SQL: eso vive en `historicos-paginados-where.test.ts`.
 */
function repoEnMemoria(filas: GastoFijoPlantillaDTO[] = ALMACEN) {
  const llamadas: string[] = [];

  const listar = vi.fn(async () => {
    llamadas.push("listar");
    return [...filas].sort(porCreadoDesc);
  });

  const listarPaginado = vi.fn(async (rango: RangoPagina) => {
    llamadas.push("listarPaginado");
    const conjunto = [...filas].sort(porCreadoDesc);
    return { items: conjunto.slice(rango.skip, rango.skip + rango.take), total: conjunto.length };
  });

  const listarActivas = vi.fn(async () => {
    llamadas.push("listarActivas");
    return filas.filter((p) => p.activa);
  });

  const repo = {
    listar,
    listarPaginado,
    listarActivas,
    obtenerPorId: vi.fn(async () => null),
    crear: vi.fn(),
    actualizar: vi.fn(),
    setActiva: vi.fn(),
  } as unknown as IGastoFijoPlantillaRepository;

  return { repo, llamadas };
}

function servicio(repo: IGastoFijoPlantillaRepository) {
  return new GastoFijoPlantillaService(repo);
}

function ids(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((p) => p.id);
}

/** N plantillas distinguibles entre si, para los dos bordes del tope. */
function nPlantillas(n: number): GastoFijoPlantillaDTO[] {
  return Array.from({ length: n }, (_, i) => ({
    ...plantilla(`p-${i}`, 1),
    createdAt: `2026-06-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(4, "0")}Z`,
  }));
}

describe("GastoFijoPlantillaService.listarPlantillasCompleto (feature 184, T G.1)", () => {
  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarPlantillasCompleto(actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total"); // un conteo tambien es informacion
      // El guard va ANTES del repositorio: las plantillas no salen de la base.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }

    // El otro lado, sin el cual lo de arriba pasaria con un servicio mudo.
    for (const actor of [MAESTRO, ADMIN]) {
      const { repo, llamadas } = repoEnMemoria();
      const r = await servicio(repo).listarPlantillasCompleto(actor);
      if (r.status !== "ok") throw new Error("no ok");
      expect(ids(r.items), `rol ${actor.rol}`).toEqual(["p-5", "p-4", "p-3", "p-2", "p-1"]);
      expect(llamadas, `rol ${actor.rol}`).toEqual(["listar"]);
    }
  });

  it("el alcance sale del ACTOR: el metodo no tiene parametro por el que pedir otro (R4)", async () => {
    // Este listado no acota por dato del actor —lo ve el acceso total entero— pero SI acota por
    // rol, y la aridad es la barrera estructural: no hay entrada por la que colar un alcance.
    const { repo } = repoEnMemoria();
    expect(servicio(repo).listarPlantillasCompleto).toHaveLength(1); // solo el actor
  });

  it("el conjunto del archivo es el mismo que recorrer las paginas, en el mismo orden (R5)", async () => {
    const svc = servicio(repoEnMemoria().repo);

    const completo = await svc.listarPlantillasCompleto(MAESTRO);
    if (completo.status !== "ok") throw new Error("no ok");

    const recorrido: string[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const p = await svc.listarPlantillasPaginado({ page, pageSize: 2 }, MAESTRO);
      if (p.status !== "ok") throw new Error("no ok");
      if (p.items.length === 0) break;
      recorrido.push(...ids(p.items));
    }

    // `toEqual` sobre el ARRAY, no sobre un `Set` ni sobre una copia ordenada: el orden ES lo
    // que se afirma. La pagina N tiene que ser el segmento N de este conjunto.
    expect(ids(completo.items)).toEqual(recorrido);
    expect(completo.total).toBe(recorrido.length);
    // R26: el archivo trae las INACTIVAS, igual que la tabla. El conjunto del archivo no puede
    // convertirse en el del cron (`listarActivas`), que es otro conjunto.
    expect(ids(completo.items)).toContain("p-2");
    expect(ids(completo.items)).toContain("p-4");
  });

  it("las filas del archivo son las MISMAS que las de la pagina: un solo mapper", async () => {
    const svc = servicio(repoEnMemoria().repo);
    const completo = await svc.listarPlantillasCompleto(MAESTRO);
    const pagina = await svc.listarPlantillasPaginado({ page: 1, pageSize: 5 }, MAESTRO);
    if (completo.status !== "ok" || pagina.status !== "ok") throw new Error("no ok");

    // Fila a fila, campo a campo: incluido `monto`, que es STRING y viene del mismo `toDTO`.
    expect(completo.items).toEqual(pagina.items);
    expect(completo.items.map((p) => p.monto)).toEqual(["1000.00", "1000.00", "1000.00", "1000.00", "1000.00"]);
  });

  it("con MAX_FILAS entrega TODAS; con una mas devuelve limite_excedido y ni una fila (R6)", async () => {
    const limite = descargaConfig.MAX_FILAS;

    const justo = await servicio(repoEnMemoria(nPlantillas(limite)).repo).listarPlantillasCompleto(
      MAESTRO,
    );
    if (justo.status !== "ok") throw new Error("en el tope EXACTO el archivo sale");
    expect(justo.items).toHaveLength(limite);
    expect(justo.total).toBe(limite);

    const unaMas = await servicio(
      repoEnMemoria(nPlantillas(limite + 1)).repo,
    ).listarPlantillasCompleto(MAESTRO);

    expect(unaMas).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    // R6: ni una fila. Un archivo truncado sin avisar es peor que ningun archivo.
    expect(unaMas).not.toHaveProperty("items");
  });

  it("el conjunto cuesta UNA llamada al repositorio, la misma que el listado de la tabla", async () => {
    // Anti-vacuidad de la afirmacion «no cuesta mas»: el listado que esta tanda sustituye
    // (`listarPlantillas`) hace exactamente esta misma llamada. Aqui no hay ahorro que medir, y
    // lo que este caso vigila es que tampoco haya SOBRECOSTE: si manana alguien anadiera un
    // `count` «para el total», el total del archivo saldria de otro sitio que sus filas.
    const viejo = repoEnMemoria();
    await servicio(viejo.repo).listarPlantillas(MAESTRO);
    expect(viejo.llamadas).toEqual(["listar"]);

    const nuevo = repoEnMemoria();
    await servicio(nuevo.repo).listarPlantillasCompleto(MAESTRO);
    expect(nuevo.llamadas).toEqual(["listar"]);
    expect(nuevo.llamadas).toEqual(viejo.llamadas);

    // Y no se sirve del PAGINADO: el conjunto no puede salir de un recorte.
    expect(nuevo.llamadas).not.toContain("listarPaginado");
  });
});
