import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.16, design §4.3 / U11; R22, R26) — EL PREDICADO DE `/novedades` DE LA TIENDA, contra
 * Postgres real y por el repositorio real (`findNovedadesByTienda` + `countNovedadesByTienda`, los dos
 * con el mismo `novedadWhere`).
 *
 * El grupo `ayuda` deja de ser `estatus = ayuda_tienda` y pasa a ser la DERIVACION «ayuda abierta»
 * acotada a la tienda; `devolucion` sigue siendo `estatus = devuelta`. Una fila por salida:
 *   A1 ayuda abierta de la tienda                 -> en `ayuda`
 *   A2 ayuda rescatada («Recuperar»)              -> fuera
 *   A3 la tienda ya gestiono desde la ayuda       -> fuera (gestion pendiente)
 *   A4 la orden transiciono tras la solicitud     -> fuera (R26)
 *   A5 ayuda abierta de OTRA tienda               -> fuera (acotacion R10)
 *   A6 ayuda abierta de una orden BORRADA         -> fuera
 *   D1 `devuelta`                                 -> en `devolucion`, no en `ayuda`
 * El conteo coincide con la lista en los dos grupos (la paginacion y el badge no pueden divergir).
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.16).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.16 — predicado de /novedades de la tienda (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const nueva = () => e.sembrarOrden({ estatus: "en_reparto" });
      const [a1, a2, a3, a4, a5, a6] = [await nueva(), await nueva(), await nueva(), await nueva(), await nueva(), await nueva()];
      const d1 = await e.sembrarOrden({ estatus: "novedad" });
      const pedidas = [];
      for (const o of [a1, a2, a3, a4, a5, a6]) pedidas.push((await e.pedirAyuda(o.ordenId)).status);

      const recuperada = (await e.recuperar(a2.ordenId)).status;
      const gestionada = (await e.gestionarDesdeAyuda(a3.ordenId, "devolucion_a_origen_por_rechazo")).status;
      // A4: transiciona DESPUES de la solicitud (p. ej. el corte la barre).
      await e.tx.orden.update({ where: { id: a4.ordenId }, data: { estatusId: e.id("novedad_interna") } });
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: a4.ordenId,
          estatusOrigenId: e.id("en_reparto"),
          estatusDestinoId: e.id("novedad_interna"),
          origenTipo: "corte_sin_gestionar",
          createdAt: new Date(Date.now() + 60_000),
        },
      });
      const otraTienda = await e.crearUsuario("adminTienda", null);
      await e.tx.orden.update({ where: { id: a5.ordenId }, data: { tiendaId: otraTienda } });
      await e.tx.orden.update({ where: { id: a6.ordenId }, data: { deletedAt: new Date() } });

      const repo = e.s.ordenRepo;
      const ids = async (grupo: "ayuda" | "devolucion", tiendaId = e.tiendaId) =>
        (await repo.findNovedadesByTienda(tiendaId, grupo, { skip: 0, take: 100 })).map((f) => f.id).sort();
      const nombre = new Map([
        [a1.ordenId, "A1"],
        [a2.ordenId, "A2"],
        [a3.ordenId, "A3"],
        [a4.ordenId, "A4"],
        [a5.ordenId, "A5"],
        [a6.ordenId, "A6"],
        [d1.ordenId, "D1"],
      ]);
      const leer = (xs: string[]) => xs.map((x) => nombre.get(x) ?? "ajena").sort();
      return {
        pedidas,
        recuperada,
        gestionada,
        ayuda: leer(await ids("ayuda")),
        devolucion: leer(await ids("devolucion")),
        ayudaOtra: leer(await ids("ayuda", otraTienda)),
        cuentaAyuda: await repo.countNovedadesByTienda(e.tiendaId, "ayuda"),
        cuentaDevolucion: await repo.countNovedadesByTienda(e.tiendaId, "devolucion"),
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("anti-vacuidad: las seis ayudas se piden, A2 se recupera y la tienda gestiona A3", () => {
    expect(r.pedidas).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(r.recuperada).toBe("ok");
    expect(r.gestionada).toBe("ok");
  });

  it("R22/R26: el grupo `ayuda` de la tienda es EXACTAMENTE la ayuda abierta suya y viva (A1)", () => {
    expect(r.ayuda).toEqual(["A1"]);
  });

  it("R10: la ayuda abierta de otra tienda la ve esa tienda, no esta", () => {
    expect(r.ayudaOtra).toEqual(["A5"]);
  });

  it("el grupo `devolucion` sigue siendo `estatus = devuelta`", () => {
    expect(r.devolucion).toEqual(["D1"]);
  });

  it("el conteo coincide con la lista en los dos grupos", () => {
    expect(r.cuentaAyuda).toBe(r.ayuda.length);
    expect(r.cuentaDevolucion).toBe(r.devolucion.length);
  });
});
