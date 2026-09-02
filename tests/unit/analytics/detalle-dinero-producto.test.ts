import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { consultarDetalleDineroProducto } from "@/lib/actions/detalle-dinero-producto";
import { prepararConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import { claveDeGrupoProducto, fundirDinero } from "@/lib/services/ConteoProductosService";
import { DetalleDineroProductoService } from "@/lib/services/DetalleDineroProductoService";
import {
  detalleDineroProductoSchema,
  type OrdenDineroDTO,
} from "@/lib/types/dinero-productos";
import { congelada, dineroFalso, filaDinero } from "./_dinero-falso";

// FICHA 347 / B5.4 — EL DETALLE ORDEN POR ORDEN.
// Cubre R10, R32, R35, R36, R37, R38, R39, R40, R41, R42, R43, R44, R73, R8.
//
// El CUADRE contra datos reales de Postgres vive en
// `tests/integration/repositories/dinero-productos.int.test.ts` (las cinco aserciones de
// `design.md §10`). Aqui se prueban el contrato del borde, la paginacion y el orden.

const AHORA = new Date("2026-09-01T12:00:00.000Z");
const T1 = "3f2a1c88-9b40-4d21-8e77-1c0b5a6d2e91";
const T2 = "8a1c4e77-2b90-4f31-9d55-6e0f3a2b1c04";

function consultaDe(raw: object, rol = "maestro", usuarioId = "u1"): ConsultaProductos {
  const preparada = prepararConsultaProductos(raw, { usuarioId, rol } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro invalido: ${preparada.status}`);
  return preparada.consulta;
}

/** El caso base: cuatro ordenes de `base c` en T1, con guias 3, 1, 2 y sin guia. */
function siembra() {
  return [
    filaDinero({ ordenId: "oA", tiendaId: T1, guia: "3", numGuia: 3 }),
    filaDinero({
      ordenId: "oB",
      tiendaId: T1,
      guia: "1",
      numGuia: 1,
      montoRecibido: "4000.00",
      congelada: congelada({ montoCobrar: "4000.00" }),
    }),
    filaDinero({
      ordenId: "oC",
      tiendaId: T1,
      guia: "2",
      numGuia: 2,
      cierreEstado: null,
      congelada: null,
      montoRecibido: "1500.00",
    }),
    filaDinero({
      ordenId: "oD",
      tiendaId: T1,
      guia: "rem-9",
      numGuia: null,
      resultado: "rechazada",
      montoRecibido: null,
    }),
  ];
}

async function detalleDe(
  filas: readonly ReturnType<typeof filaDinero>[],
  opts: { page?: number; pageSize?: number; clave?: string; rol?: string; usuarioId?: string } = {},
) {
  const service = new DetalleDineroProductoService(dineroFalso(filas));
  return service.consultar(
    consultaDe({ tienda_id: [T1] }, opts.rol ?? "maestro", opts.usuarioId ?? "u1"),
    {
      productoClave: opts.clave ?? "base c",
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 25,
    },
  );
}

describe("R32 / R35 / R36 / R37 · que trae cada fila del detalle", () => {
  it("una fila por ORDEN, con guia, destinatario, resultados, estado y sus cuatro cifras", async () => {
    const r = await detalleDe(siembra());
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);

    expect(r.datos.ordenes).toHaveLength(4);
    const porGuia = new Map(r.datos.ordenes.map((o) => [o.guia, o]));

    expect(porGuia.get("3")).toEqual({
      ordenId: "oA",
      guia: "3",
      destinatario: "Destinatario",
      resultados: ["entregada"],
      estado: "liquidada",
      recaudado: "10000.00",
      ordenex: "3955.00",
      tienda: "6045.00",
      retorno: "0.00",
    });
    // R37 — una pendiente lo dice, y NO trae reparto (R27/R30/R31).
    expect(porGuia.get("2")).toMatchObject({
      estado: "pendiente",
      recaudado: "1500.00",
      ordenex: null,
      tienda: null,
      retorno: null,
    });
    // R36 — sin guia, el numero visible es la REMISION.
    expect(porGuia.get("rem-9")?.estado).toBe("liquidada");
    expect(porGuia.get("rem-9")?.retorno).toBe("2260.00");
  });

  it("R35 · una orden con DOS gestiones sale UNA vez, con la suma y sus dos resultados", async () => {
    const r = await detalleDe([
      filaDinero({ ordenId: "oX", tiendaId: T1, gestionId: "g1", guia: "7", numGuia: 7 }),
      filaDinero({
        ordenId: "oX",
        tiendaId: T1,
        gestionId: "g2",
        guia: "7",
        numGuia: 7,
        resultado: "rechazada",
        montoRecibido: null,
      }),
    ]);
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);

    expect(r.datos.ordenes).toHaveLength(1);
    expect(r.datos.total).toBe(1);
    expect(r.datos.ordenes[0].resultados).toEqual(["entregada", "rechazada"]);
    expect(r.datos.ordenes[0].recaudado).toBe("10000.00");
    expect(r.datos.ordenes[0].retorno).toBe("2260.00");
  });

  it("R38 · los `totales` de la cabecera son EXACTAMENTE la fila de la tabla", async () => {
    const filas = siembra();
    const r = await detalleDe(filas);
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);

    const fila = fundirDinero(filas).get(claveDeGrupoProducto(T1, "base c"));
    expect(fila).toBeDefined();
    expect(r.datos.totales).toEqual(fila);
    // Y la suma de la pagina (que aqui es el conjunto entero) cuadra con esos totales.
    const ordenes = r.datos.ordenes;
    const suma = (f: (o: OrdenDineroDTO) => string | null): string => {
      let acc = new Prisma.Decimal(0);
      for (const o of ordenes) acc = acc.plus(new Prisma.Decimal(f(o) ?? "0"));
      return acc.toFixed(2);
    };
    expect(suma((o) => o.recaudado)).toBe(r.datos.totales.recaudado);
    expect(suma((o) => o.ordenex)).toBe(r.datos.totales.liquidado.ordenex);
    expect(suma((o) => o.tienda)).toBe(r.datos.totales.liquidado.tienda);
  });

  it("el titulo del panel sale del texto de las ordenes, NO de lo que mando el cliente", async () => {
    const r = await detalleDe([
      filaDinero({ ordenId: "o1", tiendaId: T1, producto: "1 * BASE C" }),
      filaDinero({ ordenId: "o2", tiendaId: T1, producto: "1 * BASE C" }),
      filaDinero({ ordenId: "o3", tiendaId: T1, producto: "1 * Base C." }),
    ]);
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);
    // Gana la variante de MAS ordenes; el cliente mando `base c` en minusculas y no manda.
    expect(r.datos.producto).toBe("BASE C");
    expect(r.datos.tiendaNombre).toBe("Tienda Uno");
  });
});

describe("R40 / R41 · el total lo cuenta el SERVIDOR y la paginacion sale de la config", () => {
  it("⚠ MUTACION M7 · `total` es el del CONJUNTO, no el de la pagina", async () => {
    const r = await detalleDe(siembra(), { pageSize: 2, page: 1 });
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);

    expect(r.datos.ordenes).toHaveLength(2);
    // ⚠ Con `items.length` (M7), esto valdria 2 y la pantalla diria «2 ordenes» de 4.
    expect(r.datos.total).toBe(4);
    expect(r.datos.page).toBe(1);
    expect(r.datos.pageSize).toBe(2);
  });

  it("la segunda pagina trae el resto y NINGUNA orden se repite ni se pierde", async () => {
    const p1 = await detalleDe(siembra(), { pageSize: 3, page: 1 });
    const p2 = await detalleDe(siembra(), { pageSize: 3, page: 2 });
    if (p1.status !== "ok" || p2.status !== "ok") throw new Error("salio mal");

    const ids = [...p1.datos.ordenes, ...p2.datos.ordenes].map((o) => o.ordenId);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("una pagina mas alla del final viene vacia pero con el total del conjunto", async () => {
    const r = await detalleDe(siembra(), { pageSize: 25, page: 9 });
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);
    expect(r.datos.ordenes).toEqual([]);
    expect(r.datos.total).toBe(4);
  });

  it("R41 · el tamano de pagina y su tope salen de la configuracion, no de un literal", () => {
    const sinPagina = detalleDineroProductoSchema.parse({
      filtro: { tienda_id: [T1] },
      producto_clave: "base c",
    });
    expect(sinPagina.pageSize).toBe(detalleMovimientoConfig.DEFAULT_PAGE_SIZE);
    expect(sinPagina.pageSize).toBe(25);
    expect(sinPagina.page).toBe(1);

    // El tope, en sus dos lados: justo en el maximo pasa, uno por encima es error.
    expect(
      detalleDineroProductoSchema.parse({
        filtro: { tienda_id: [T1] },
        producto_clave: "base c",
        pageSize: detalleMovimientoConfig.MAX_PAGE_SIZE,
      }).pageSize,
    ).toBe(100);
    expect(() =>
      detalleDineroProductoSchema.parse({
        filtro: { tienda_id: [T1] },
        producto_clave: "base c",
        pageSize: detalleMovimientoConfig.MAX_PAGE_SIZE + 1,
      }),
    ).toThrow();
  });
});

describe("El ORDEN es total: la paginacion no repite ni omite", () => {
  it("guia NUMERICA ascendente, con las de solo remision AL FINAL", async () => {
    const r = await detalleDe(siembra());
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);
    // 1, 2, 3 y luego la que no tiene guia. Con orden LEXICOGRAFICO sobre el texto, «rem-9»
    // podria colarse en medio y «10» iria antes que «9».
    expect(r.datos.ordenes.map((o) => o.guia)).toEqual(["1", "2", "3", "rem-9"]);
  });

  it("dos ordenes con la MISMA guia se desempatan por id, de forma estable", async () => {
    const filas = [
      filaDinero({ ordenId: "z-segunda", tiendaId: T1, guia: "5", numGuia: 5 }),
      filaDinero({ ordenId: "a-primera", tiendaId: T1, guia: "5", numGuia: 5 }),
    ];
    const r = await detalleDe(filas);
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);
    expect(r.datos.ordenes.map((o) => o.ordenId)).toEqual(["a-primera", "z-segunda"]);

    // Y con las filas en el otro orden, el resultado es EL MISMO (R25).
    const alReves = await detalleDe([...filas].reverse());
    if (alReves.status !== "ok") throw new Error("salio mal");
    expect(alReves.datos.ordenes.map((o) => o.ordenId)).toEqual(["a-primera", "z-segunda"]);
  });
});

describe("R39 / R42 · lo que NO entra y lo que se dice cuando no hay nada", () => {
  it("una orden que aporta cero en las cuatro cifras no aparece", async () => {
    const r = await detalleDe([
      filaDinero({ ordenId: "oA", tiendaId: T1, guia: "1", numGuia: 1 }),
      filaDinero({
        ordenId: "oCero",
        tiendaId: T1,
        guia: "2",
        numGuia: 2,
        montoRecibido: null,
        cierreEstado: null,
        congelada: null,
      }),
    ]);
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);

    expect(r.datos.ordenes.map((o) => o.ordenId)).toEqual(["oA"]);
    expect(r.datos.total).toBe(1);
  });

  it("R42 · un producto sin ninguna orden que aporte responde `vacio`, no una lista vacia", async () => {
    const r = await detalleDe(siembra(), { clave: "producto que no existe" });
    expect(r.status).toBe("vacio");
    expect(r).not.toHaveProperty("datos");
  });

  it("la clave se normaliza igual que la produjo el parser (espacios, mayusculas, punto final)", async () => {
    for (const clave of ["base c", "BASE C", "  Base   C  ", "Base C."]) {
      const r = await detalleDe(siembra(), { clave });
      expect(r.status, clave).toBe("ok");
    }
  });

  it("solo trae las ordenes de ESE producto, no las de sus companeros", async () => {
    const r = await detalleDe(
      [
        filaDinero({ ordenId: "o1", tiendaId: T1, producto: "1 * Base C. 1 * Dr Melaxin." }),
        filaDinero({ ordenId: "o2", tiendaId: T1, producto: "1 * Dr Melaxin" }),
      ],
      { clave: "base c" },
    );
    if (r.status !== "ok") throw new Error(`salio ${r.status}`);
    expect(r.datos.ordenes.map((o) => o.ordenId)).toEqual(["o1"]);
  });
});

describe("R43 / R44 · el alcance del detalle es el MISMO que el de la fila", () => {
  it("R44 · una tienda ajena da `forbidden`, NO un resultado vacio", async () => {
    const r = await consultarDetalleDineroProducto(
      { filtro: { tienda_id: [T2] }, producto_clave: "base c" },
      {
        getActor: async () => ({ usuarioId: T1, rol: "adminTienda" }) as never,
        logger: { logError: vi.fn() },
        now: () => AHORA,
      },
    );
    expect(r.status).toBe("forbidden");
    expect(r).not.toHaveProperty("datos");
  });

  it("su propia tienda SI, y el `tienda_id` acaba en el alcance de la consulta", async () => {
    const service = new DetalleDineroProductoService(dineroFalso(siembra()));
    const espia = vi.spyOn(service, "consultar");
    const r = await consultarDetalleDineroProducto(
      { filtro: { tienda_id: [T1] }, producto_clave: "base c" },
      {
        service,
        getActor: async () => ({ usuarioId: T1, rol: "adminTienda" }) as never,
        now: () => AHORA,
      },
    );

    expect(r.status).toBe("ok");
    const consulta = espia.mock.calls[0][0];
    expect(consulta.alcance).toEqual({ tipo: "tienda", tiendaId: T1 });
    expect(consulta.filtro.tienda_id).toEqual([T1]);
    expect(consulta.dinero).toBe("concedido");
  });

  it("R5 · un rol con el dinero denegado no recibe detalle, aunque forje la consulta", async () => {
    const service = new DetalleDineroProductoService(dineroFalso(siembra()));
    const denegada = { ...consultaDe({ tienda_id: [T1] }), dinero: "denegado" } as ConsultaProductos;

    const r = await service.consultar(denegada, {
      productoClave: "base c",
      page: 1,
      pageSize: 25,
    });
    expect(r.status).toBe("forbidden");
  });

  it("el guard del dinero corre ANTES de tocar la base", async () => {
    const repo = dineroFalso(siembra());
    const service = new DetalleDineroProductoService(repo);
    const denegada = { ...consultaDe({ tienda_id: [T1] }), dinero: "denegado" } as ConsultaProductos;

    await service.consultar(denegada, { productoClave: "base c", page: 1, pageSize: 25 });
    // Un `forbidden` evaluado DESPUES del `SELECT` ya habria leido el dinero para tirarlo.
    expect(repo.llamadas).toBe(0);
  });

  it("un rol prohibido en analitica de productos ni siquiera llega al servicio", async () => {
    const service = new DetalleDineroProductoService(dineroFalso(siembra()));
    const espia = vi.spyOn(service, "consultar");
    for (const rol of ["adminSatelite", "mensajero"]) {
      const r = await consultarDetalleDineroProducto(
        { filtro: { tienda_id: [T1] }, producto_clave: "base c" },
        {
          service,
          getActor: async () => ({ usuarioId: "u1", rol }) as never,
          logger: { logError: vi.fn() },
          now: () => AHORA,
        },
      );
      expect(r.status, rol).toBe("forbidden");
    }
    expect(espia).not.toHaveBeenCalled();
  });

  it("sin sesion responde `unauthenticated`, que es otra cosa que `forbidden`", async () => {
    const r = await consultarDetalleDineroProducto(
      { filtro: { tienda_id: [T1] }, producto_clave: "base c" },
      { getActor: async () => null, logger: { logError: vi.fn() }, now: () => AHORA },
    );
    expect(r.status).toBe("unauthenticated");
  });
});

describe("R8 / R73 · la frontera: `.strict()`, y ni base ni alcance si no valida", () => {
  it("una clave que pretenda conceder el dinero es `validation_error`", async () => {
    const getActor = vi.fn(async () => ({ usuarioId: "u1", rol: "maestro" }) as never);
    for (const raw of [
      { filtro: { tienda_id: [T1], dinero: "concedido" }, producto_clave: "base c" },
      { filtro: { tienda_id: [T1] }, producto_clave: "base c", dinero: "concedido" },
      { filtro: { tienda_id: [T1] }, producto_clave: "base c", tiendaId: T2 },
    ]) {
      const r = await consultarDetalleDineroProducto(raw, { getActor, now: () => AHORA });
      expect(r.status, JSON.stringify(raw)).toBe("validation_error");
    }
    // ⚠ R73 — no se resolvio el actor ni una vez: la validacion va PRIMERO.
    expect(getActor).not.toHaveBeenCalled();
  });

  it("sin `producto_clave`, sin filtro o con clave vacia, tambien", async () => {
    for (const raw of [
      { filtro: { tienda_id: [T1] } },
      { producto_clave: "base c" },
      { filtro: { tienda_id: [T1] }, producto_clave: "" },
      {},
      null,
      "base c",
    ]) {
      const r = await consultarDetalleDineroProducto(raw, { now: () => AHORA });
      expect(r.status, JSON.stringify(raw)).toBe("validation_error");
    }
  });

  it("EXACTAMENTE una tienda: sin ella, o con dos, es `validation_error`", async () => {
    // El panel es el de UNA fila, y una fila es `(producto, tienda)`. Sin esto, un maestro sin
    // `tienda_id` abriria un panel que mezcla tiendas y cuyos totales no serian los de NINGUNA
    // fila de la tabla — un cuadre roto que nadie veria.
    for (const filtro of [{}, { tienda_id: [T1, T2] }, { tienda_id: [] }]) {
      const r = await consultarDetalleDineroProducto(
        { filtro, producto_clave: "base c" },
        { now: () => AHORA },
      );
      expect(r.status, JSON.stringify(filtro)).toBe("validation_error");
    }
  });
});

describe("R10 · la denegacion deja rastro sin revelar el motivo", () => {
  it("registra el denegado y responde `forbidden` a secas", async () => {
    const logError = vi.fn();
    const r = await consultarDetalleDineroProducto(
      { filtro: { tienda_id: [T2] }, producto_clave: "base c" },
      {
        getActor: async () => ({ usuarioId: T1, rol: "adminTienda" }) as never,
        logger: { logError },
        now: () => AHORA,
      },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(logError).toHaveBeenCalledTimes(1);
    // El motivo esta en el LOG, no en la respuesta.
    expect(JSON.stringify(r)).not.toContain("filtro_fuera_de_alcance");
  });

  it("el rastro nombra esta puerta y no la de la tabla", async () => {
    const logError = vi.fn();
    await consultarDetalleDineroProducto(
      { filtro: { tienda_id: [T2] }, producto_clave: "base c" },
      {
        getActor: async () => ({ usuarioId: T1, rol: "adminTienda" }) as never,
        logger: { logError },
        now: () => AHORA,
      },
    );
    const linea = JSON.stringify(logError.mock.calls[0]);
    expect(linea).toContain("detalle_dinero_producto");
    expect(linea).not.toContain("conteo_productos");
  });
});

describe("R76 · el tope tambien apaga el detalle", () => {
  it("`limite_excedido` no viene con filas", async () => {
    const service = new DetalleDineroProductoService(
      dineroFalso([], { estado: "limite_excedido", limite: 5000 }),
    );
    const r = await service.consultar(consultaDe({ tienda_id: [T1] }), {
      productoClave: "base c",
      page: 1,
      pageSize: 25,
    });

    expect(r).toEqual({ status: "limite_excedido", limite: 5000 });
    expect(r).not.toHaveProperty("datos");
  });
});
