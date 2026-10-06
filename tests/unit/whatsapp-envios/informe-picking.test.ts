import { describe, it, expect, vi } from "vitest";
import {
  CLAVE_INFORME_PICKING,
  crearInformePicking,
  detalleDeCausa,
  motivoSinOrdenes,
  resumenTiendasPicking,
} from "@/lib/whatsapp-envios/informes/picking/informe";
import { INFORMES_WHATSAPP, catalogoDeVariables } from "@/lib/whatsapp-envios/informes/catalogo";
import { CLAVES_VARIABLES_PICKING, type ModeloPicking } from "@/lib/whatsapp-envios/informes/picking/modelo";
import { maquetarPicking, type MedirTexto, type OpPdf } from "@/lib/whatsapp-envios/informes/picking/pdf";
import { parametrosPickingSchema, type ParametrosPicking } from "@/lib/whatsapp-envios/informes/picking/parametros";
import type { IPickingRepository } from "@/lib/interfaces/repositories/IPickingRepository";
import type { FilaPicking, TiendaPicking } from "@/lib/whatsapp-envios/informes/picking/tipos";

// Ficha 476 (T4.1) — el informe con un doble del repositorio: R1, R2 (schema), R7, R8, R24, R25,
// R27, R28. La lectura real contra Postgres: tests/integration/db/picking-*.test.ts.

const UN_DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-10-05T12:30:00.000Z");
const TIENDA: TiendaPicking = { id: "t-gameos", nombre: "Gameos", fulfillment: true, esTienda: true, activo: true };

function filas(): FilaPicking[] {
  return [
    { ordenId: "o1", numRemision: "NA-1069", numGuia: null, producto: "2 * Crema X", entrada: new Date(AHORA.getTime() - UN_DIA) },
    { ordenId: "o2", numRemision: "NA-1070", numGuia: null, producto: "1 * Base", entrada: new Date(AHORA.getTime() - 4 * UN_DIA) },
  ];
}

function repo(o: { tienda?: TiendaPicking | null; filas?: FilaPicking[]; falla?: keyof IPickingRepository } = {}) {
  const r = {
    tiendaDelPicking: vi.fn(async () => {
      if (o.falla === "tiendaDelPicking") throw new Error("conexion caida");
      return o.tienda === undefined ? TIENDA : o.tienda;
    }),
    ordenesEnPreparacion: vi.fn(async () => {
      if (o.falla === "ordenesEnPreparacion") throw new Error("timeout");
      return o.filas ?? filas();
    }),
    tiendasFulfillment: vi.fn(async () => []),
    entradasEnPreparacion: vi.fn(async () => []),
  };
  return r;
}

const P: ParametrosPicking = { tiendaId: "t-gameos", diasAtraso: 2 };
const ctx = (conDocumento = true, parametros: ParametrosPicking = P, ahora = AHORA) => ({ parametros, ahora, conDocumento });

describe("476/R1 — registro en el catalogo", () => {
  it("clave «picking», nombre «Picking», genera documento, NO apto para adminTienda, sin eventos", () => {
    const i = INFORMES_WHATSAPP.get("picking");
    expect(i).toBeDefined();
    expect(i!.clave).toBe(CLAVE_INFORME_PICKING);
    expect(i!.nombre).toBe("Picking");
    expect(i!.generaDocumento).toBe(true);
    expect(i!.aptoParaAdminTienda).toBe(false);
    expect(i!.eventos).toEqual([]);
    expect(i!.soloPorEvento).toBe(false);
  });

  it("declara el panel «picking» que edita tiendaId y diasAtraso", () => {
    expect(INFORMES_WHATSAPP.get("picking")!.descriptores).toEqual([
      expect.objectContaining({ tipo: "panel", panel: "picking", campos: ["tiendaId", "diasAtraso"] }),
    ]);
  });
});

describe("476/R2 — parametros", () => {
  it("exactamente tiendaId y diasAtraso (strict); diasAtraso por defecto 2", () => {
    expect(parametrosPickingSchema.parse({ tiendaId: "t1" })).toEqual({ tiendaId: "t1", diasAtraso: 2 });
    expect(parametrosPickingSchema.safeParse({ tiendaId: "t1", diasAtraso: 2, otro: 1 }).success).toBe(false);
  });

  it("tiendaId obligatoria: vacia o ausente se rechaza en el campo tiendaId", () => {
    for (const p of [{ diasAtraso: 2 }, { tiendaId: "", diasAtraso: 2 }, { tiendaId: "   ", diasAtraso: 2 }]) {
      const r = parametrosPickingSchema.safeParse(p);
      expect(r.success).toBe(false);
      expect(r.error!.issues.map((i) => i.path.join("."))).toEqual(["tiendaId"]);
    }
  });

  it("diasAtraso entero 1..30: 0, 31, 1.5 y texto se rechazan en el campo diasAtraso; 1 y 30 valen", () => {
    for (const d of [0, 31, 1.5, "2"]) {
      const r = parametrosPickingSchema.safeParse({ tiendaId: "t1", diasAtraso: d });
      expect(r.success, String(d)).toBe(false);
      expect(r.error!.issues.map((i) => i.path.join("."))).toEqual(["diasAtraso"]);
    }
    for (const d of [1, 30]) expect(parametrosPickingSchema.safeParse({ tiendaId: "t1", diasAtraso: d }).success).toBe(true);
  });

  it("los valores de partida NO son guardables tal cual: hay que elegir tienda (design §4.2)", () => {
    const i = INFORMES_WHATSAPP.get("picking")!;
    const r = i.parametros.safeParse(i.parametrosPorDefecto);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((x) => x.path.join("."))).toEqual(["tiendaId"]);
  });
});

describe("476/R7 — tienda que ya no sirve → error terminal, sin leer ordenes", () => {
  it.each([
    ["no existe", null, "La tienda del envío ya no existe: revisa el envío y elige otra tienda."],
    ["perdio el fulfillment", { ...TIENDA, fulfillment: false }, "La tienda «Gameos» ya no tiene fulfillment: revisa el envío."],
    ["ya no es adminTienda", { ...TIENDA, esTienda: false }, "«Gameos» ya no es una tienda con fulfillment: revisa el envío."],
    ["inactiva (estado ≠ activo)", { ...TIENDA, activo: false }, "La tienda «Gameos» no está activa: revisa el envío."],
  ])("%s", async (_caso, tienda, motivo) => {
    const r = repo({ tienda });
    const res = await crearInformePicking({ repo: r }).generar(ctx());
    expect(res).toEqual({ tipo: "error", motivo });
    expect(r.ordenesEnPreparacion).not.toHaveBeenCalled();
  });
});

describe("476/R8 — sin ordenes en preparacion → vacio", () => {
  it("motivo exacto con el nombre de la tienda", async () => {
    const res = await crearInformePicking({ repo: repo({ filas: [] }) }).generar(ctx());
    expect(res).toEqual({ tipo: "vacio", motivo: "La tienda Gameos no tiene órdenes en preparación." });
    expect(motivoSinOrdenes("Gameos")).toBe("La tienda Gameos no tiene órdenes en preparación.");
  });
});

describe("476 — fallo de lectura", () => {
  it("se PROPAGA con el nombre de la operacion (nunca un «vacio»)", async () => {
    await expect(crearInformePicking({ repo: repo({ falla: "ordenesEnPreparacion" }) }).generar(ctx())).rejects.toThrow(
      "informe picking: ordenesEnPreparacion falló",
    );
    await expect(crearInformePicking({ repo: repo({ falla: "tiendaDelPicking" }) }).generar(ctx())).rejects.toThrow(
      "informe picking: tiendaDelPicking falló",
    );
  });

  it("el mensaje lleva el motivo SANEADO de la causa (nombre y codigo), nunca su texto; la causa queda en `cause`", async () => {
    const causa = Object.assign(new Error("Invalid `prisma.usuario.findUnique()` invocation: id 'secreto'"), {
      name: "PrismaClientKnownRequestError",
      code: "P2028",
    });
    const r = repo();
    r.tiendaDelPicking.mockRejectedValueOnce(causa);
    const err = await crearInformePicking({ repo: r })
      .generar(ctx())
      .then(
        () => new Error("476: generar debia lanzar"),
        (e: unknown) => e as Error,
      );
    expect(err.message).toBe("informe picking: tiendaDelPicking falló (PrismaClientKnownRequestError P2028)");
    expect(err.message).not.toContain("secreto");
    expect(err.cause).toBe(causa);
    expect(detalleDeCausa(new Error("x"))).toBe("Error");
    expect(detalleDeCausa("texto")).toBe("error desconocido");
    expect(detalleDeCausa(Object.assign(new Error("x"), { code: "a b; DROP" }))).toBe("Error");
  });
});

describe("476/R16/R24 — documento", () => {
  it("con documento: PDF y nombre picking-<tienda>-<fecha CR>.pdf", async () => {
    const res = await crearInformePicking({ repo: repo() }).generar(ctx(true));
    if (res.tipo !== "contenido") throw new Error("debia haber contenido");
    expect(res.documento?.nombreArchivo).toBe("picking-gameos-2026-10-05.pdf");
    expect(Buffer.from(res.documento!.bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
  });

  it("R24: sin documento → solo valores, y el PDF ni se genera", async () => {
    const pdf = vi.fn(() => new Uint8Array([1]));
    const res = await crearInformePicking({ repo: repo(), pdf }).generar(ctx(false));
    if (res.tipo !== "contenido") throw new Error("debia haber contenido");
    expect(res.documento).toBeUndefined();
    expect(pdf).not.toHaveBeenCalled();
  });

  it("lee la tienda y las ordenes del parametro tiendaId", async () => {
    const r = repo();
    await crearInformePicking({ repo: r }).generar(ctx(false));
    expect(r.tiendaDelPicking).toHaveBeenCalledWith("t-gameos");
    expect(r.ordenesEnPreparacion).toHaveBeenCalledWith("t-gameos");
  });
});

describe("476/R25 — variables", () => {
  it("las 10 claves exactas, y el catalogo añade solo destinatario_nombre", () => {
    const i = INFORMES_WHATSAPP.get("picking")!;
    expect(i.variables.map((v) => v.clave)).toEqual([...CLAVES_VARIABLES_PICKING]);
    expect(catalogoDeVariables("picking").map((v) => v.clave)).toEqual([...CLAVES_VARIABLES_PICKING, "destinatario_nombre"]);
  });

  it("con contenido, cada variable tiene valor no vacio", async () => {
    const res = await crearInformePicking({ repo: repo() }).generar(ctx(false));
    if (res.tipo !== "contenido") throw new Error("debia haber contenido");
    expect(Object.keys(res.valores)).toEqual([...CLAVES_VARIABLES_PICKING]);
    for (const [k, v] of Object.entries(res.valores)) expect(v.trim(), k).not.toBe("");
    expect(res.valores).toMatchObject({ tienda: "Gameos", remision_desde: "NA-1069", remision_hasta: "NA-1070", dias_atraso: "2" });
  });
});

describe("476/R27 — las cifras del PDF son las de los valores de la MISMA llamada", () => {
  it("ordenes, unidades, productos y atrasadas de la maqueta = valores", async () => {
    let modelo: ModeloPicking | null = null;
    const pdf = (m: ModeloPicking) => {
      modelo = m;
      return new Uint8Array([37, 80, 68, 70]);
    };
    const res = await crearInformePicking({ repo: repo(), pdf }).generar(ctx(true));
    if (res.tipo !== "contenido" || modelo === null) throw new Error("debia haber contenido y PDF");
    const medir: MedirTexto = (t, tam) => [...t].length * tam * 0.18;
    const ops = maquetarPicking(modelo, medir).paginas.flat();
    const deRol = (rol: string) =>
      ops.filter((o): o is Extract<OpPdf, { tipo: "texto" }> => o.tipo === "texto" && o.rol === rol).map((o) => o.texto);
    expect(deRol("cifra-ordenes")).toEqual([res.valores.ordenes]);
    expect(deRol("cifra-unidades")).toEqual([res.valores.unidades]);
    expect(deRol("total")).toEqual([`Total · ${res.valores.productos} productos`, res.valores.unidades, `en ${res.valores.ordenes} órdenes`]);
    expect(res.valores.atrasadas).toBe("1");
    expect(deRol("atrasadas-titulo").join(" ")).toMatch(/^1 orden lleva más de 2 días/);
  });
});

describe("476/R28 — fecha y hora de Costa Rica", () => {
  it("2026-10-06T05:30Z → «05/10/2026» y «23:30»", async () => {
    const res = await crearInformePicking({ repo: repo() }).generar(ctx(false, P, new Date("2026-10-06T05:30:00.000Z")));
    if (res.tipo !== "contenido") throw new Error("debia haber contenido");
    expect(res.valores.fecha).toBe("05/10/2026");
    expect(res.valores.hora).toBe("23:30");
  });
});

describe("476/R3 — resumen de tiendas del selector", () => {
  it("ordenado por nombre (unidades de codigo), con conteos y atrasadas para N; tienda sin ordenes = 0", async () => {
    const r: IPickingRepository = {
      tiendaDelPicking: vi.fn(),
      ordenesEnPreparacion: vi.fn(),
      tiendasFulfillment: vi.fn(async () => [
        { id: "t3", nombre: "Sicommer" },
        { id: "t1", nombre: "Gameos" },
        { id: "t2", nombre: "Nuform" },
      ]),
      entradasEnPreparacion: vi.fn(async () => [
        { tiendaId: "t1", entrada: new Date(AHORA.getTime() - UN_DIA) },
        { tiendaId: "t1", entrada: new Date(AHORA.getTime() - 3 * UN_DIA) },
        { tiendaId: "t3", entrada: new Date(AHORA.getTime() - 6 * UN_DIA) },
        { tiendaId: "otra", entrada: new Date(AHORA.getTime() - 9 * UN_DIA) },
      ]),
    };
    expect(await resumenTiendasPicking(r, AHORA, 2)).toEqual([
      { tiendaId: "t1", nombre: "Gameos", ordenes: 2, atrasadas: 1 },
      { tiendaId: "t2", nombre: "Nuform", ordenes: 0, atrasadas: 0 },
      { tiendaId: "t3", nombre: "Sicommer", ordenes: 1, atrasadas: 1 },
    ]);
    expect((await resumenTiendasPicking(r, AHORA, 5)).map((t) => t.atrasadas)).toEqual([0, 0, 1]);
  });
});
