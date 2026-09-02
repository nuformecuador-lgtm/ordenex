import { describe, it, expect, vi } from "vitest";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { descargaConfig } from "@/lib/config/descarga";
import { listarOrdenesBodegaPaginadoSchema } from "@/lib/types/recepcion-satelite";
import {
  ALMACEN_SATELITE,
  filaSatelite,
  repoSateliteEnMemoria,
  ROLES_SIN_ACCESO,
  SAT_A,
  SAT_B,
  SAT_SIN_ZONA,
  type FilaAlmacen,
} from "@/tests/fixtures/satelite-bodega-almacen";

// Feature 184 — Tanda A (T A.3) — el CONJUNTO del listado «Órdenes de la bodega» para la
// descarga: `RecepcionSateliteService.listarOrdenesBodegaCompleto`.
//
// Lo que cierra este metodo, y por que se prueba asi. Hasta hoy el archivo se producia
// releyendo `listar()` —los CINCO grupos de la zona ENTERA, sin filtrar— y volviendo a cruzar
// estado ∧ canton ∧ distrito en el navegador. O sea: el criterio escrito dos veces, en dos
// capas, y el conjunto sin filtrar cruzando a la pantalla para acabar en un archivo filtrado.
// Es el unico de los doce listados con esa duplicacion (Q-K4).
//
// Por eso el caso central de este archivo no es «devuelve filas»: es que el conjunto que sale
// coincide, fila a fila y en el mismo orden, con recorrer las paginas de la pantalla con el
// MISMO filtro. Si el servicio filtrara distinto, ordenara distinto o recortara, ahi se ve.
//
// AVISO vigente en todo el repo: este archivo usa un DOBLE de repositorio y NO ve la traduccion
// a SQL. El `WHERE`, el `ORDER BY`, cuantas consultas se emiten y que NO llevan viven en
// `tests/unit/repositories/satelite-paginado-where.test.ts`.

/**
 * Los intentos se derivan POR ID y no por posicion: si dependieran de la posicion, la misma
 * orden traeria un numero distinto segun la pagina en que cayera. Las de sufijo IMPAR se omiten
 * del mapa a proposito: ese es el caso de `?? 0` (feature 160/R14).
 */
function servicio(repo: IOrdenRepository, lotes?: string[][]) {
  const historial = {
    contarIntentosEnLote: vi.fn(async (ids: string[]) => {
      lotes?.push([...ids]);
      const pares = ids
        .map((id) => [id, Number(id.slice(-2))] as const)
        .filter(([, n]) => n % 2 === 0);
      return new Map(pares);
    }),
  } as unknown as Pick<IOrdenHistorialService, "contarIntentosEnLote">;
  return new RecepcionSateliteService(repo, historial);
}

function ids(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((i) => i.id);
}

/** Recorre TODAS las paginas del listado y devuelve los ids en el orden en que llegan. */
async function recorrerPaginas(
  svc: RecepcionSateliteService,
  actor: Actor,
  filtros: Record<string, unknown> = {},
  pageSize = 3,
): Promise<string[]> {
  const recorrido: string[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const p = await svc.listarOrdenesBodegaPaginado(
      listarOrdenesBodegaPaginadoSchema.parse({ ...filtros, page, pageSize }),
      actor,
    );
    if (p.status !== "ok") throw new Error(`pagina ${page} devolvio ${p.status}`);
    if (p.items.length === 0) break;
    recorrido.push(...ids(p.items));
  }
  return recorrido;
}

describe("RecepcionSateliteService.listarOrdenesBodegaCompleto (feature 184, T A.3)", () => {
  it("el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)", async () => {
    // La propiedad que hace que el archivo y la pantalla no puedan discrepar. Se comprueba
    // sobre varias combinaciones de la barra de filtros, no solo sin filtros.
    const combinaciones: Record<string, unknown>[] = [
      {},
      { estados: ["devuelta"] },
      { estados: ["en_bodega_satelite", "por_recoger"] },
      { canton_id: ["Escazú"] },
      { canton_id: ["Escazú", "Barva"], distrito_id: ["San Rafael"] },
      { estados: ["devuelta"], canton_id: ["Barva"] },
    ];

    let conFilas = 0;
    for (const filtros of combinaciones) {
      const svc = servicio(repoSateliteEnMemoria().repo);
      const etiqueta = JSON.stringify(filtros);

      const completo = await svc.listarOrdenesBodegaCompleto(filtros, SAT_A);
      if (completo.status !== "ok") throw new Error(`${etiqueta}: ${completo.status}`);
      const paginado = await recorrerPaginas(svc, SAT_A, filtros);

      expect(ids(completo.items), etiqueta).toEqual(paginado);
      // Y el total del conjunto es el numero de filas que trae, no el de una pagina.
      expect(completo.total, etiqueta).toBe(completo.items.length);
      if (completo.items.length > 0) conFilas += 1;
    }
    // Anti-vacuidad: si el conjunto y las paginas devolvieran siempre vacio, el bucle entero
    // seria comparar [] con [].
    expect(conFilas).toBe(combinaciones.length);
  });

  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoSateliteEnMemoria();
      const r = await servicio(repo).listarOrdenesBodegaCompleto({}, actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("items");
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("total");
      // Ni la zona se resuelve: el guard va delante de todo.
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }
  });

  it("el alcance sale del ACTOR, no de la entrada (R4)", async () => {
    const a = repoSateliteEnMemoria();
    const conjuntoDeA = await servicio(a.repo).listarOrdenesBodegaCompleto(
      { canton_id: ["Escazú"] },
      SAT_A,
    );
    const b = repoSateliteEnMemoria();
    const conjuntoDeB = await servicio(b.repo).listarOrdenesBodegaCompleto(
      { canton_id: ["Escazú"] },
      SAT_B,
    );
    if (conjuntoDeA.status !== "ok" || conjuntoDeB.status !== "ok") throw new Error("no ok");

    // «Escazú» existe en las dos zonas: cada actor descarga LO SUYO con el mismo filtro.
    // FICHA 357: a-15 (`entregada` de Escazu que SI paso por la bodega) entra; a-14, su gemela
    // salvo por no haber pasado nunca, NO. Comparten zona, canton y distrito: lo unico que puede
    // separarlas es el criterio nuevo.
    expect(ids(conjuntoDeA.items)).toEqual([
      "a-02",
      "a-01",
      "a-04",
      "a-15",
      "a-07",
      "a-09",
    ]);
    expect(ids(conjuntoDeA.items)).not.toContain("a-14");
    expect(ids(conjuntoDeA.items).some((id) => id.startsWith("b-"))).toBe(false);
    // CONTRAPRUEBA: el vecino SI ve la suya. Sin esto, un servicio que devolviera vacio ante
    // cualquier canton pasaria la primera mitad.
    expect(ids(conjuntoDeB.items)).toEqual(["b-01"]);

    // Y la zona que llega al repositorio es la del usuario, resuelta server-side.
    expect(a.filtros[0]!.filtro.zonaId).toBe("z-a");
    expect(b.filtros[0]!.filtro.zonaId).toBe("z-b");
  });

  it("con un filtro de cantón el conjunto excluye las demás filas EN LA BASE (R11)", async () => {
    const { repo, filtros, findRecepcionSateliteCompleta } = repoSateliteEnMemoria();
    const r = await servicio(repo).listarOrdenesBodegaCompleto(
      { canton_id: ["Barva"], distrito_id: ["San Pedro"] },
      SAT_A,
    );
    if (r.status !== "ok") throw new Error("no ok");

    // El filtro VIAJA al repositorio: no se aplica despues, en memoria, sobre un conjunto que
    // ya cruzo entero. Eso es lo que R11 exige y lo que la pantalla hacia hasta hoy.
    expect(filtros[0]!.filtro.cantonIds).toEqual(["Barva"]);
    expect(filtros[0]!.filtro.distritoIds).toEqual(["San Pedro"]);
    // Y el servicio devuelve EXACTAMENTE lo que el repositorio le dio, sin volver a filtrar.
    const delRepo = await findRecepcionSateliteCompleta.mock.results[0]!.value;
    expect(ids(r.items)).toEqual(ids(delRepo));
    expect(ids(r.items)).toEqual(["a-06", "a-11"]);
  });

  it("el filtro por MENSAJERO viaja al repositorio (pedido humano 2026-08-25)", async () => {
    const { repo, filtros } = repoSateliteEnMemoria();
    const r = await servicio(repo).listarOrdenesBodegaCompleto(
      { mensajero_id: ["m1", "m2"] },
      SAT_A,
    );
    if (r.status !== "ok") throw new Error("no ok");
    expect(filtros[0]!.filtro.mensajeroIds).toEqual(["m1", "m2"]);
    // Y el alcance sigue saliendo del ACTOR: el filtro acota dentro de su zona, no la cambia.
    expect(filtros[0]!.filtro.zonaId).toBe("z-a");
  });

  it("la lista blanca de estados sigue siendo la de la página: un estado ajeno no amplía nada", async () => {
    const svc = servicio(repoSateliteEnMemoria().repo);

    // Saltandose el schema del borde a proposito: la lista blanca del servicio tiene que
    // sostenerse sola, no solo detras de zod.
    // FICHA 357: el ejemplo de estado ajeno pasa a ser uno de la CENTRAL. `entregada` ya no
    // sirve para esto —hoy SI se lista, y ese es el arreglo de la cara (A)—.
    const inventado = await svc.listarOrdenesBodegaCompleto(
      { estados: ["en_bodega_central"] },
      SAT_A,
    );
    if (inventado.status !== "ok") throw new Error("no ok");
    // Ni las de la central NI —lo que seria peor— «todas», por caer al caso «sin seleccion».
    expect(inventado.items).toEqual([]);
    expect(inventado.total).toBe(0);

    const mezcla = await svc.listarOrdenesBodegaCompleto(
      { estados: ["en_bodega_central", "devuelta"] },
      SAT_A,
    );
    if (mezcla.status !== "ok") throw new Error("no ok");
    expect(ids(mezcla.items)).toEqual(["a-09", "a-11", "a-10"]);
  });

  it("las órdenes que nunca estuvieron en el listado no aparecen en el archivo", async () => {
    const r = await servicio(repoSateliteEnMemoria().repo).listarOrdenesBodegaCompleto({}, SAT_A);
    if (r.status !== "ok") throw new Error("no ok");
    // FICHA 357 — las dos quedan fuera por motivos DISTINTOS, y por eso se afirman aparte:
    // a-13 por el ESTADO («Por recibir» tiene su propia seccion) y a-14 por el ALCANCE
    // (`entregada` SI se lista, pero esa orden nunca paso por esta bodega). a-15 es el control:
    // misma zona, mismo estado y misma geografia que a-14, y SI esta en el archivo.
    expect(ids(r.items)).not.toContain("a-13");
    expect(ids(r.items)).not.toContain("a-14");
    expect(ids(r.items)).toContain("a-15");
    expect(r.total).toBe(13);
  });

  it("con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const almacenDe = (n: number): FilaAlmacen[] =>
      Array.from({ length: n }, (_, i) =>
        filaSatelite(`z-${String(i).padStart(5, "0")}`, "z-a", "en_bodega_satelite", "Escazú", "San Rafael", 1),
      );

    // El borde EXACTO por abajo: `MAX_FILAS` cabe entero.
    const justo = repoSateliteEnMemoria(almacenDe(limite));
    const ok = await servicio(justo.repo).listarOrdenesBodegaCompleto({}, SAT_A);
    if (ok.status !== "ok") throw new Error(`esperaba ok, vino ${ok.status}`);
    expect(ok.items).toHaveLength(limite);
    expect(ok.total).toBe(limite);

    // Y por arriba: con UNA mas no hay archivo, ni truncado ni parcial. Solo los conteos.
    const pasado = repoSateliteEnMemoria(almacenDe(limite + 1));
    const lotes: string[][] = [];
    const excedido = await servicio(pasado.repo, lotes).listarOrdenesBodegaCompleto({}, SAT_A);
    expect(excedido).toEqual({ status: "limite_excedido", total: limite + 1, limite });
    expect(excedido).not.toHaveProperty("items");
    // Y no se paga el lote de intentos de un conjunto que no se va a entregar.
    expect(lotes).toEqual([]);
  });

  it("cada fila del archivo lleva su número de intentos, el 0 incluido (mismo mapper que la página)", async () => {
    const svc = servicio(repoSateliteEnMemoria().repo);

    const r = await svc.listarOrdenesBodegaCompleto({ estados: ["devuelta"] }, SAT_A);
    if (r.status !== "ok") throw new Error("no ok");

    // La columna «Intentos» del archivo sale de aqui. Si el conjunto dejara de pedir el lote,
    // el archivo publicaria un 0 para todas y nadie lo notaria: el xlsx saldria igual de bien.
    expect(r.items.map((i) => i.intentosEntrega)).toEqual([0, 0, 10]);

    // Y el resto del DTO es IDENTICO al que entrega la pagina para la misma fila: dos mappers
    // distintos son dos archivos distintos del mismo listado.
    const pagina = await svc.listarOrdenesBodegaPaginado(
      listarOrdenesBodegaPaginadoSchema.parse({ estados: ["devuelta"], page: 1, pageSize: 3 }),
      SAT_A,
    );
    if (pagina.status !== "ok") throw new Error("no ok");
    expect(r.items).toEqual(pagina.items);
  });

  it("el lote de intentos es UNO SOLO y con los ids del conjunto (feature 160/R12)", async () => {
    const lotes: string[][] = [];
    const { repo, llamadas } = repoSateliteEnMemoria();
    await servicio(repo, lotes).listarOrdenesBodegaCompleto({}, SAT_A);

    // Dos lecturas del repositorio —la zona y el conjunto— y UN lote de intentos. Ni una
    // consulta por fila, ni un lote por grupo.
    expect(llamadas).toEqual(["findUsuarioZonaId", "findRecepcionSateliteCompleta"]);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]).toHaveLength(13);
  });

  it("el adminSatelite SIN zona recibe un conjunto vacío y no consulta el listado", async () => {
    const { repo, llamadas } = repoSateliteEnMemoria();
    const r = await servicio(repo).listarOrdenesBodegaCompleto({}, SAT_SIN_ZONA);

    // Vacio y `ok`, no `forbidden`: el rol tiene acceso al modulo, lo que no tiene es alcance.
    expect(r).toEqual({ status: "ok", items: [], total: 0 });
    expect(llamadas).toEqual(["findUsuarioZonaId"]);
  });

  it("al repositorio le llega el filtro y NADA de recorte, ni la página lo contamina", async () => {
    const { repo, filtros, findRecepcionSateliteCompleta } =
      repoSateliteEnMemoria(ALMACEN_SATELITE);
    await servicio(repo).listarOrdenesBodegaCompleto({ canton_id: ["Escazú"] }, SAT_A);

    // Lo que viaja al repositorio son las claves del filtro elegido y nada mas: ni `skip`, ni
    // `take`, ni un `page` heredado del schema de la pagina. Las claves NO elegidas tampoco
    // aparecen: el filtro que se pide es el que se aplica.
    expect(Object.keys(filtros[0]!.filtro).sort()).toEqual([
      "cantonIds",
      "estatusValues",
      "zonaId",
    ]);
    // Un solo argumento: la firma no lleva rango y la llamada tampoco.
    expect(findRecepcionSateliteCompleta.mock.calls[0]).toHaveLength(1);
  });
});
