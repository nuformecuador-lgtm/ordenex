import { describe, expect, it, vi } from "vitest";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import {
  listarIdsVigentesBodegaSchema,
  listarOrdenesBodegaCompletoSchema,
  listarOrdenesBodegaPaginadoSchema,
} from "@/lib/types/recepcion-satelite";
import { repoSateliteEnMemoria, SAT_A } from "@/tests/fixtures/satelite-bodega-almacen";

/**
 * FICHA 370 — «salida a reparto» llega a LAS TRES consultas de la bodega satelite.
 *
 * QUE MIDE ESTE ARCHIVO Y QUE NO. El repositorio es un DOBLE: aqui nadie ve el SQL, y en este
 * repo esta medido cuatro veces que una mutacion del `WHERE` pasa en verde con dobles. Lo que
 * se mide aqui es ESTRUCTURAL y no lo cubre el otro archivo tan barato: que el criterio viaja a
 * las TRES —pagina, conjunto de la descarga y vigencia de la seleccion— y no a una o dos. Que
 * el `WHERE` seleccione las filas correctas se prueba contra Postgres en
 * `tests/integration/db/salida-a-reparto-sql-real.test.ts`.
 *
 * POR QUE LAS TRES IMPORTAN. La pagina es lo que se VE; el conjunto es lo que se DESCARGA (si
 * divergen, el archivo lleva filas que la pantalla no enseña y ningun test de pantalla lo ve);
 * y la vigencia decide sobre que filas se puede ACTUAR — si esa se quedara fuera, la barra
 * ofreceria acciones sobre ordenes que el filtro ya saco del listado.
 */
/**
 * Un id marcado cualquiera. Es UUID porque el borde lo exige (`orden.id` lo es) y NO tiene que
 * existir en el almacen: lo que este archivo mira es el FILTRO con el que se pregunta, no la
 * respuesta. La pertenencia real se mide contra Postgres en el archivo de integracion.
 */
const ID_MARCADO = "11111111-1111-4111-8111-111111111111";

function servicio(repo: IOrdenRepository): RecepcionSateliteService {
  const historial = {
    contarIntentosEnLote: vi.fn(async () => new Map<string, number>()),
  } as unknown as Pick<IOrdenHistorialService, "contarIntentosEnLote">;
  return new RecepcionSateliteService(repo, historial);
}

describe("FICHA 370 — la bodega satelite pasa «salida a reparto» a sus tres consultas", () => {
  it.each([
    ["ya_salio", "ya"],
    ["nunca_salio", "nunca"],
  ])("`%s` viaja como `%s` a la pagina, al conjunto y a la vigencia", async (publico, interno) => {
    const { repo, filtros } = repoSateliteEnMemoria();
    const svc = servicio(repo);

    await svc.listarOrdenesBodegaPaginado(
      listarOrdenesBodegaPaginadoSchema.parse({ page: 1, pageSize: 3, salio_a_reparto: publico }),
      SAT_A,
    );
    await svc.listarOrdenesBodegaCompleto(
      listarOrdenesBodegaCompletoSchema.parse({ salio_a_reparto: publico }),
      SAT_A,
    );
    await svc.listarIdsVigentesBodega(
      listarIdsVigentesBodegaSchema.parse({ salio_a_reparto: publico, ids: [ID_MARCADO] }),
      SAT_A,
    );

    // Las TRES, por nombre: si una se quedara fuera, el conjunto de metodos delataria cual.
    expect(filtros.map((f) => f.metodo)).toEqual(["paginada", "completa", "vigencia"]);
    for (const registro of filtros) {
      expect(registro.filtro.salioAReparto).toBe(interno);
    }
  });

  it("sin la clave, NINGUNA de las tres recibe el criterio (ausente = los dos grupos)", async () => {
    const { repo, filtros } = repoSateliteEnMemoria();
    const svc = servicio(repo);

    await svc.listarOrdenesBodegaPaginado(
      listarOrdenesBodegaPaginadoSchema.parse({ page: 1, pageSize: 3 }),
      SAT_A,
    );
    await svc.listarOrdenesBodegaCompleto(listarOrdenesBodegaCompletoSchema.parse({}), SAT_A);
    await svc.listarIdsVigentesBodega(
      listarIdsVigentesBodegaSchema.parse({ ids: [ID_MARCADO] }),
      SAT_A,
    );

    // No-vacuidad: las tres se llamaron de verdad, asi que los `undefined` de abajo son de la
    // ausencia de la clave y no de que nadie haya consultado.
    expect(filtros).toHaveLength(3);
    for (const registro of filtros) {
      expect(Object.hasOwn(registro.filtro, "salioAReparto")).toBe(false);
    }
  });

  it("el borde de la bodega rechaza un valor que no sea uno de los dos", () => {
    expect(() =>
      listarOrdenesBodegaPaginadoSchema.parse({
        page: 1,
        pageSize: 3,
        salio_a_reparto: "con_intentos",
      }),
    ).toThrow();
    // Y el booleano de la trampa: `false` no es «no filtrar», es un valor invalido.
    expect(() =>
      listarOrdenesBodegaCompletoSchema.parse({ salio_a_reparto: false }),
    ).toThrow();
  });
});
