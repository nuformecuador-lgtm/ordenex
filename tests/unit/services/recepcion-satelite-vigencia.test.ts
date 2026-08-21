import { describe, it, expect, vi } from "vitest";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { listarOrdenesBodegaPaginadoSchema } from "@/lib/types/recepcion-satelite";
import {
  repoSateliteEnMemoria,
  ROLES_SIN_ACCESO,
  SAT_A,
  SAT_B,
  SAT_SIN_ZONA,
} from "@/tests/fixtures/satelite-bodega-almacen";

// Feature 184 — Tanda A (T A.3) — la comprobacion de VIGENCIA con la que se poda la seleccion
// de la bodega satelite: `RecepcionSateliteService.listarIdsVigentesBodega`.
//
// El defecto que cierra: la seleccion de ese listado sobrevive al cambio de pagina (a
// proposito) y se limpia al cambiar filtros (a proposito), pero NO cuando una orden marcada
// deja de estar en el listado —por ejemplo al reportarle un incidente—. El aviso «marcadas en
// otras paginas» vuelve esa discrepancia visible y contable: cuenta ordenes que ya no estan.
//
// Las dos propiedades que hacen que esto sea seguro, y que este archivo mide:
//
//  1. la pertenencia se decide sobre el CONJUNTO FILTRADO COMPLETO, no sobre la pagina visible
//     (R19). Si se decidiera sobre la pagina, podar desmarcaria justo lo que el aviso cuenta;
//  2. se devuelven los VIGENTES, nunca los caducados (R22). El cliente interseca, asi que una
//     respuesta corta —o ninguna respuesta— no puede leerse como «desmarca todo».
//
// AVISO: este archivo usa un DOBLE de repositorio y no ve el SQL. Que el `WHERE` de la vigencia
// lleve la zona del actor ADEMAS del `IN` de ids se afirma en
// `tests/unit/repositories/satelite-paginado-where.test.ts`.

function servicio(repo: IOrdenRepository) {
  const historial = {
    contarIntentosEnLote: vi.fn(async () => new Map<string, number>()),
  } as unknown as Pick<IOrdenHistorialService, "contarIntentosEnLote">;
  return new RecepcionSateliteService(repo, historial);
}

describe("RecepcionSateliteService.listarIdsVigentesBodega (feature 184, T A.3)", () => {
  it("la vigencia se decide sobre el CONJUNTO filtrado, no sobre la página visible (R19)", async () => {
    const { repo, filtros } = repoSateliteEnMemoria();
    const svc = servicio(repo);

    // `a-10` es la ULTIMA del conjunto de la zona: con paginas de 3 vive en la pagina 4. Si la
    // vigencia se decidiera sobre la pagina visible, esa orden —marcada y perfectamente viva—
    // volveria como caducada y la poda la desmarcaria sola.
    const pagina1 = await svc.listarOrdenesBodegaPaginado(
      listarOrdenesBodegaPaginadoSchema.parse({ page: 1, pageSize: 3 }),
      SAT_A,
    );
    if (pagina1.status !== "ok") throw new Error("no ok");
    expect(pagina1.items.map((i) => i.id)).not.toContain("a-10");

    const r = await svc.listarIdsVigentesBodega({ ids: ["a-10", "a-01"] }, SAT_A);
    expect(r).toEqual({ status: "ok", ids: ["a-10", "a-01"] });

    // Y al repositorio no le llega ningun recorte: la pregunta es sobre el conjunto.
    const vigencia = filtros.find((f) => f.metodo === "vigencia")!;
    // Las claves NO elegidas no viajan: el filtro que se pide es el que se aplica.
    expect(Object.keys(vigencia.filtro).sort()).toEqual(["estatusValues", "zonaId"]);
  });

  it("una orden que salió del listado vuelve como NO vigente (R18)", async () => {
    const { repo } = repoSateliteEnMemoria();

    // `a-14` esta `entregada` y `a-13` esta en «Por recibir»: las dos son de la zona del actor
    // y ninguna pertenece a este listado. Es lo que le pasa a una orden marcada a la que se le
    // reporta un incidente: sigue existiendo, pero ya no esta aqui.
    const r = await servicio(repo).listarIdsVigentesBodega(
      { ids: ["a-01", "a-13", "a-14"] },
      SAT_A,
    );

    expect(r).toEqual({ status: "ok", ids: ["a-01"] });
  });

  it("un id de OTRA zona vuelve como no vigente y no revela ningún dato de él (R21)", async () => {
    const { repo } = repoSateliteEnMemoria();

    // `b-01` existe, esta viva y esta en el listado... de la zona del vecino.
    const r = await servicio(repo).listarIdsVigentesBodega({ ids: ["a-01", "b-01"] }, SAT_A);

    expect(r).toEqual({ status: "ok", ids: ["a-01"] });
    // Y la respuesta no lleva NADA de la orden ajena: ni el id, ni un motivo, ni un conteo del
    // que deducir que existe.
    expect(JSON.stringify(r)).not.toContain("b-01");

    // CONTRAPRUEBA: para su dueño esa misma orden SI es vigente. Sin esto, un servicio que
    // devolviera siempre vacio pasaria la primera mitad.
    const delVecino = await servicio(repoSateliteEnMemoria().repo).listarIdsVigentesBodega(
      { ids: ["a-01", "b-01"] },
      SAT_B,
    );
    expect(delVecino).toEqual({ status: "ok", ids: ["b-01"] });
  });

  it("los filtros vigentes acotan la vigencia: es el conjunto que el usuario está viendo (R19)", async () => {
    const { repo, filtros } = repoSateliteEnMemoria();

    // Con el listado filtrado por «devuelta», una marcada `en_bodega_satelite` ya NO pertenece
    // al conjunto que el aviso cuenta: la poda tiene que verla como no vigente.
    const r = await servicio(repo).listarIdsVigentesBodega(
      { ids: ["a-01", "a-09"], estados: ["devuelta"] },
      SAT_A,
    );

    expect(r).toEqual({ status: "ok", ids: ["a-09"] });
    expect(filtros.find((f) => f.metodo === "vigencia")!.filtro.estatusValues).toEqual([
      "devuelta",
    ]);
  });

  it("la lista blanca de estados también rige aquí: un estado ajeno no amplía el conjunto", async () => {
    const { repo } = repoSateliteEnMemoria();
    // Saltandose el schema del borde: pedir vigencia «de las entregadas» no puede convertir
    // esta comprobacion en una ventana al resto de las ordenes de la zona.
    const r = await servicio(repo).listarIdsVigentesBodega(
      { ids: ["a-14"], estados: ["entregada"] },
      SAT_A,
    );
    expect(r).toEqual({ status: "ok", ids: [] });
  });

  it("devuelve un SUBCONJUNTO de lo preguntado, y en ningún caso algo que no se preguntó", async () => {
    const { repo } = repoSateliteEnMemoria();
    const preguntados = ["a-09", "a-01"];

    const r = await servicio(repo).listarIdsVigentesBodega({ ids: preguntados }, SAT_A);
    if (r.status !== "ok") throw new Error("no ok");

    // La forma del contrato: los VIGENTES de entre los preguntados. Una respuesta que trajera
    // ids nuevos haria que el cliente marcara ordenes que el usuario no marco.
    expect(r.ids.every((id) => preguntados.includes(id))).toBe(true);
    expect(new Set(r.ids).size).toBe(r.ids.length);
  });

  it("un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)", async () => {
    for (const actor of ROLES_SIN_ACCESO) {
      const { repo, llamadas } = repoSateliteEnMemoria();
      const r = await servicio(repo).listarIdsVigentesBodega({ ids: ["a-01"] }, actor);

      expect(r, `rol ${actor.rol}`).toEqual({ status: "forbidden" });
      expect(r, `rol ${actor.rol}`).not.toHaveProperty("ids");
      expect(llamadas, `rol ${actor.rol}`).toEqual([]);
    }
  });

  it("sin ids no se consulta NADA (R23, también en el servidor)", async () => {
    const { repo, llamadas } = repoSateliteEnMemoria();
    const r = await servicio(repo).listarIdsVigentesBodega({ ids: [] }, SAT_A);

    // Sin marcas fuera de la pagina no hay pregunta que hacer: cero consultas, ni siquiera la
    // de resolver la zona. El borde ya exige `.min(1)`, pero la regla es del dominio.
    expect(r).toEqual({ status: "ok", ids: [] });
    expect(llamadas).toEqual([]);
  });

  it("el adminSatelite SIN zona no tiene nada vigente, y no consulta el listado", async () => {
    const { repo, llamadas } = repoSateliteEnMemoria();
    const r = await servicio(repo).listarIdsVigentesBodega({ ids: ["a-01"] }, SAT_SIN_ZONA);

    expect(r).toEqual({ status: "ok", ids: [] });
    expect(llamadas).toEqual(["findUsuarioZonaId"]);
  });

  it("comprobar la vigencia no lee el listado ni cuenta intentos: UNA consulta acotada (R28)", async () => {
    const { repo, llamadas } = repoSateliteEnMemoria();
    const svc = servicio(repo);

    await svc.listarIdsVigentesBodega({ ids: ["a-01", "a-09"] }, SAT_A);

    // La zona y la vigencia. Ni la pagina, ni el conjunto de la descarga, ni el lote de
    // intentos: la poda no puede costar lo que una descarga.
    expect(llamadas).toEqual(["findUsuarioZonaId", "findIdsVigentesEnBodega"]);
  });
});
