import { describe, it, expect, vi } from "vitest";
import {
  listarMovimientosDeTiendaAction,
  listarMovimientosDeTiendaCompletoAction,
} from "@/lib/actions/wallet-tienda";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletTiendaService } from "@/lib/interfaces/services/IWalletTiendaService";
import type {
  DesgloseTiendaDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

// Feature 171 / T1.5 (R25/R29/R40) — BORDE del desglose de una tienda.
//
// Aqui se cierran las dos cosas que el servicio no puede cerrar porque no conoce la sesion ni
// la peticion cruda: sin sesion -> `unauthenticated` SIN llamar al servicio (R29), y entrada
// que no identifica una tienda -> `validation_error` SIN llamar al servicio (R25). En ambos
// casos «sin consultar la base» se prueba como CERO llamadas al servicio: el servicio es lo
// unico que sabe llegar al repositorio.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const ITEM: WalletTiendaMovimientoDTO = {
  id: "w1",
  tiendaId: "tienda-A",
  tipo: "credito",
  categoria: "cod_recaudado",
  monto: "10000.00",
  origenTipo: "cierre_dia",
  origenId: "c1",
  descripcion: null,
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
};

const DESGLOSE: DesgloseTiendaDTO = {
  aFavor: "10000.00",
  cargos: "1000.00",
  pagado: "0.00",
  saldo: "9000.00",
  signo: "positivo",
};

function fakeService(resultado: unknown) {
  const listarMovimientosDeTienda = vi.fn().mockResolvedValue(resultado);
  const listarMovimientosDeTiendaCompleto = vi.fn().mockResolvedValue(resultado);
  return {
    service: {
      listarMovimientosDeTienda,
      listarMovimientosDeTiendaCompleto,
    } as unknown as IWalletTiendaService,
    listarMovimientosDeTienda,
    listarMovimientosDeTiendaCompleto,
  };
}

const OK_PAGINADO = {
  status: "ok",
  data: {
    tiendaId: "tienda-A",
    movimientos: [ITEM],
    total: 1,
    page: 1,
    pageSize: 20,
    desglose: DESGLOSE,
  },
};

describe("listarMovimientosDeTiendaAction (borde, R25/R29)", () => {
  it("R29: sin sesion -> unauthenticated, sin datos y con CERO llamadas al servicio", async () => {
    const { service, listarMovimientosDeTienda } = fakeService(OK_PAGINADO);

    const r = await listarMovimientosDeTiendaAction(
      { tiendaId: "tienda-A" },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(r).not.toHaveProperty("data");
    expect(listarMovimientosDeTienda).not.toHaveBeenCalled();
  });

  it("R29: la falta de sesion se resuelve ANTES de validar (entrada invalida y sin sesion -> unauthenticated)", async () => {
    const { service, listarMovimientosDeTienda } = fakeService(OK_PAGINADO);
    const r = await listarMovimientosDeTiendaAction({}, { service, getActor: async () => null });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(listarMovimientosDeTienda).not.toHaveBeenCalled();
  });

  it("R25: `tiendaId` ausente -> validation_error, con CERO llamadas al servicio", async () => {
    const { service, listarMovimientosDeTienda } = fakeService(OK_PAGINADO);

    const r = await listarMovimientosDeTiendaAction(
      { page: 1, pageSize: 20 },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(r).not.toHaveProperty("data");
    expect(listarMovimientosDeTienda).not.toHaveBeenCalled();
  });

  it("R25: `tiendaId` vacio -> validation_error, y el campo viene senalado", async () => {
    const { service, listarMovimientosDeTienda } = fakeService(OK_PAGINADO);

    const r = await listarMovimientosDeTiendaAction(
      { tiendaId: "" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("tiendaId");
    expect(listarMovimientosDeTienda).not.toHaveBeenCalled();
  });

  it("R25: entrada que ni siquiera es un objeto -> validation_error, sin llegar al servicio", async () => {
    for (const entrada of [undefined, null, "tienda-A", 42, []]) {
      const { service, listarMovimientosDeTienda } = fakeService(OK_PAGINADO);
      const r = await listarMovimientosDeTiendaAction(entrada, {
        service,
        getActor: async () => MAESTRO,
      });

      expect(r.status, `entrada ${JSON.stringify(entrada)}`).toBe("validation_error");
      expect(listarMovimientosDeTienda).not.toHaveBeenCalled();
    }
  });

  it("R40: propaga forbidden tal cual, sin datos", async () => {
    const { service } = fakeService({ status: "forbidden" });

    const r = await listarMovimientosDeTiendaAction(
      { tiendaId: "tienda-A" },
      { service, getActor: async () => ({ usuarioId: "t1", rol: "adminTienda" }) },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("data");
  });

  it("R22: con sesion y entrada valida, entrega el payload del servicio y le pasa el input PARSEADO", async () => {
    const { service, listarMovimientosDeTienda } = fakeService(OK_PAGINADO);

    const r = await listarMovimientosDeTiendaAction(
      { tiendaId: "tienda-A", categoria: "flete" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual(OK_PAGINADO);
    const [data, actor] = listarMovimientosDeTienda.mock.calls[0];
    expect(actor).toEqual(MAESTRO);
    expect(data).toMatchObject({ tiendaId: "tienda-A", categoria: "flete", page: 1, pageSize: 20 });
  });

  it("R23: los importes llegan al cliente como STRING, tal cual los devolvio el servidor", async () => {
    const { service } = fakeService(OK_PAGINADO);
    const r = await listarMovimientosDeTiendaAction(
      { tiendaId: "tienda-A" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    for (const clave of ["aFavor", "cargos", "pagado", "saldo"] as const) {
      expect(typeof r.data.desglose[clave], clave).toBe("string");
    }
    expect(r.data.desglose.pagado).toBe("0.00");
  });
});

describe("listarMovimientosDeTiendaCompletoAction (borde, R25/R29/R37/R40)", () => {
  it("R29: sin sesion -> unauthenticated, sin filas y con CERO llamadas al servicio", async () => {
    const { service, listarMovimientosDeTiendaCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMovimientosDeTiendaCompletoAction(
      { tiendaId: "tienda-A" },
      { service, getActor: async () => null },
    );

    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(listarMovimientosDeTiendaCompleto).not.toHaveBeenCalled();
  });

  it("R25: sin `tiendaId` -> validation_error, sin filas y sin llegar al servicio", async () => {
    const { service, listarMovimientosDeTiendaCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMovimientosDeTiendaCompletoAction(
      {},
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(r).not.toHaveProperty("items");
    expect(listarMovimientosDeTiendaCompleto).not.toHaveBeenCalled();
  });

  it("R37: `page` colada en el modo completo -> validation_error (este modo NO pagina)", async () => {
    const { service, listarMovimientosDeTiendaCompleto } = fakeService({ status: "ok", items: [], total: 0 });

    const conPage = await listarMovimientosDeTiendaCompletoAction(
      { tiendaId: "tienda-A", page: 1 },
      { service, getActor: async () => MAESTRO },
    );
    const conPageSize = await listarMovimientosDeTiendaCompletoAction(
      { tiendaId: "tienda-A", pageSize: 20 },
      { service, getActor: async () => MAESTRO },
    );

    expect(conPage.status).toBe("validation_error");
    expect(conPageSize.status).toBe("validation_error");
    expect(listarMovimientosDeTiendaCompleto).not.toHaveBeenCalled();
  });

  it("R24: una clave extra que pretenda ampliar el alcance -> validation_error en el BORDE", async () => {
    const { service, listarMovimientosDeTiendaCompleto } = fakeService({ status: "ok", items: [], total: 0 });

    const r = await listarMovimientosDeTiendaCompletoAction(
      { tiendaId: "tienda-A", todasLasTiendas: true },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(listarMovimientosDeTiendaCompleto).not.toHaveBeenCalled();
  });

  it("R39/R40: propaga limite_excedido con sus conteos y SIN filas", async () => {
    const { service } = fakeService({ status: "limite_excedido", total: 6120, limite: 5000 });

    const r = await listarMovimientosDeTiendaCompletoAction(
      { tiendaId: "tienda-A" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "limite_excedido", total: 6120, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });

  it("R40: propaga forbidden sin filas", async () => {
    const { service } = fakeService({ status: "forbidden" });

    const r = await listarMovimientosDeTiendaCompletoAction(
      { tiendaId: "tienda-A" },
      { service, getActor: async () => ({ usuarioId: "t1", rol: "adminTienda" }) },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
  });

  it("R40: NINGUNA rama de error viaja acompañada de filas", async () => {
    // Recorre las cuatro formas de fallo del borde con un servicio que SIEMPRE devolveria
    // filas: si alguna rama las dejara pasar, se veria aqui.
    const casos: { nombre: string; input: unknown; actor: Actor | null }[] = [
      { nombre: "sin sesion", input: { tiendaId: "tienda-A" }, actor: null },
      { nombre: "sin tiendaId", input: {}, actor: MAESTRO },
      { nombre: "con page", input: { tiendaId: "tienda-A", page: 2 }, actor: MAESTRO },
      { nombre: "clave extra", input: { tiendaId: "tienda-A", x: 1 }, actor: MAESTRO },
    ];

    for (const caso of casos) {
      const { service } = fakeService({ status: "ok", items: [ITEM], total: 1 });
      const r = await listarMovimientosDeTiendaCompletoAction(caso.input, {
        service,
        getActor: async () => caso.actor,
      });

      expect(r.status, caso.nombre).not.toBe("ok");
      expect(r, caso.nombre).not.toHaveProperty("items");
    }
  });

  it("R37: con entrada valida entrega los items, y el input que va al servicio NO lleva paginacion", async () => {
    const { service, listarMovimientosDeTiendaCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMovimientosDeTiendaCompletoAction(
      { tiendaId: "tienda-A", categoria: "cod_recaudado" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "ok", items: [ITEM], total: 1 });
    const [data, actor] = listarMovimientosDeTiendaCompleto.mock.calls[0];
    expect(actor).toEqual(MAESTRO);
    expect(data).toEqual({ tiendaId: "tienda-A", categoria: "cod_recaudado" });
    expect(data).not.toHaveProperty("page");
    expect(data).not.toHaveProperty("pageSize");
  });
});
