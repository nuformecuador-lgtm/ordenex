import { describe, it, expect } from "vitest";
import { crearInformeTransito, MOTIVO_SIN_ALERTAS } from "@/lib/whatsapp-envios/informes/transito/informe";
import { catalogoDeVariables, INFORMES_WHATSAPP } from "@/lib/whatsapp-envios/informes/catalogo";
import { PARAMETROS_POR_DEFECTO, type ParametrosTransito } from "@/lib/whatsapp-envios/informes/transito/parametros";
import type { IInformeTransitoRepository } from "@/lib/interfaces/repositories/IInformeTransitoRepository";
import type { FilaTransito, ZonaInforme } from "@/lib/whatsapp-envios/informes/transito/tipos";

// Ficha 475 (T5.2) — R1, R2, R18-R22, R33 sobre el informe con un doble del repositorio.

const UN_DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-10-05T11:00:00.000Z");
const GAM: ZonaInforme = { id: "z-gam", nombre: "GAM", esCentral: true };
const SUR: ZonaInforme = { id: "z-sur", nombre: "FGAM Zona Sur", esCentral: false };

function fila(over: Partial<FilaTransito>, dias: number): FilaTransito {
  return {
    ordenId: `o-${Math.random()}`,
    numRemision: "GM-1",
    numGuia: 48127,
    estado: "en_reparto",
    zonaId: GAM.id,
    destinatario: "María Jiménez",
    canton: "San José",
    distrito: "Hatillo",
    montoCobrar: "18500.00",
    hitoAt: new Date(AHORA.getTime() - dias * UN_DIA),
    ultimaTransicionAt: new Date(AHORA.getTime() - 1 * UN_DIA),
    ...over,
  };
}

function repo(filas: FilaTransito[], opts: { falla?: keyof IInformeTransitoRepository; sinHito?: number } = {}) {
  const llamadas: string[] = [];
  const r: IInformeTransitoRepository = {
    async zonas() {
      llamadas.push("zonas");
      if (opts.falla === "zonas") throw new Error("conexion caida");
      return [GAM, SUR];
    },
    async filasEnAlerta() {
      llamadas.push("filasEnAlerta");
      if (opts.falla === "filasEnAlerta") throw new Error("timeout");
      return filas;
    },
    async contarSinHito() {
      llamadas.push("contarSinHito");
      if (opts.falla === "contarSinHito") throw new Error("timeout");
      return opts.sinHito ?? 0;
    },
  };
  return { r: { repo: r }, llamadas };
}

function ctx(parametros: ParametrosTransito = PARAMETROS_POR_DEFECTO, conDocumento = true, ahora = AHORA) {
  return { parametros, ahora, conDocumento };
}

describe("475/R1 — metadatos del catalogo", () => {
  it("clave, nombre, documento, no apto para adminTienda, sin eventos", () => {
    const i = INFORMES_WHATSAPP.get("transito");
    expect(i).toBeDefined();
    expect(i!.nombre).toBe("Informe de tránsito");
    expect(i!.generaDocumento).toBe(true);
    expect(i!.aptoParaAdminTienda).toBe(false);
    expect(i!.soloPorEvento).toBe(false);
    expect(i!.eventos).toEqual([]);
  });

  it("declara el panel de tránsito (descriptor `panel`) y el booleano enviarSiVacio", () => {
    const i = INFORMES_WHATSAPP.get("transito")!;
    expect(i.descriptores).toEqual([
      expect.objectContaining({ tipo: "panel", panel: "transito", campos: ["hito", "zonas", "estados"] }),
      expect.objectContaining({ tipo: "booleano", campo: "enviarSiVacio" }),
    ]);
  });
});

describe("475/R2 — variables", () => {
  it("exactamente las 8 declaradas, con nombre, descripcion y ejemplo", () => {
    const i = crearInformeTransito(repo([]).r);
    expect(i.variables.map((v) => v.clave)).toEqual([
      "total_en_alerta",
      "vencidos",
      "por_vencer",
      "parados",
      "por_cobrar",
      "en_alerta_gam",
      "en_alerta_fuera_gam",
      "fecha",
    ]);
    for (const v of i.variables) {
      expect(v.nombre.trim()).not.toBe("");
      expect(v.descripcion.trim()).not.toBe("");
      expect(v.ejemplo.trim()).not.toBe("");
    }
  });

  it("destinatario_nombre llega por el motor (catalogo de variables), sin declararla", () => {
    const claves = catalogoDeVariables("transito").map((v) => v.clave);
    expect(claves).toContain("destinatario_nombre");
    expect(crearInformeTransito(repo([]).r).variables.map((v) => v.clave)).not.toContain("destinatario_nombre");
  });
});

describe("475/R18-R21 — resultado", () => {
  it("R18: sin alertas y sin enviarSiVacio -> vacio con motivo legible", async () => {
    const r = await crearInformeTransito(repo([]).r).generar(ctx());
    expect(r).toEqual({ tipo: "vacio", motivo: MOTIVO_SIN_ALERTAS });
  });

  it("R19: sin alertas con enviarSiVacio -> contenido a 0 y PDF", async () => {
    const r = await crearInformeTransito(repo([]).r).generar(ctx({ ...PARAMETROS_POR_DEFECTO, enviarSiVacio: true }));
    expect(r.tipo).toBe("contenido");
    if (r.tipo !== "contenido") return;
    expect(r.valores).toEqual({
      total_en_alerta: "0",
      vencidos: "0",
      por_vencer: "0",
      parados: "0",
      por_cobrar: "₡0",
      en_alerta_gam: "0",
      en_alerta_fuera_gam: "0",
      fecha: "05/10/2026",
    });
    expect(r.documento?.bytes.byteLength).toBeGreaterThan(1000);
  });

  it("R20: valores con alertas, una entrada no vacia por variable", async () => {
    const filas = [
      fila({ montoCobrar: "18500.00" }, 12),
      fila({ montoCobrar: "24900.00", estado: "reprogramado", ultimaTransicionAt: new Date(AHORA.getTime() - 4 * UN_DIA) }, 9),
      fila({ montoCobrar: null, zonaId: SUR.id }, 16),
    ];
    const r = await crearInformeTransito(repo(filas).r).generar(ctx());
    expect(r.tipo).toBe("contenido");
    if (r.tipo !== "contenido") return;
    expect(r.valores).toEqual({
      total_en_alerta: "3",
      vencidos: "1",
      por_vencer: "2",
      parados: "1",
      por_cobrar: "₡43.400",
      en_alerta_gam: "2",
      en_alerta_fuera_gam: "1",
      fecha: "05/10/2026",
    });
  });

  it("R21: plantilla sin documento -> no hay PDF", async () => {
    const r = await crearInformeTransito(repo([fila({}, 12)]).r).generar(ctx(PARAMETROS_POR_DEFECTO, false));
    expect(r.tipo).toBe("contenido");
    if (r.tipo === "contenido") expect(r.documento).toBeUndefined();
  });

  it("R33: transito-YYYY-MM-DD.pdf con la fecha CR (23:30 CR sigue siendo el 5)", async () => {
    const tarde = new Date("2026-10-06T05:30:00.000Z");
    const r = await crearInformeTransito(repo([fila({}, 12)]).r).generar(ctx(PARAMETROS_POR_DEFECTO, true, tarde));
    expect(r.tipo === "contenido" && r.documento?.nombreArchivo).toBe("transito-2026-10-05.pdf");
    const pdf = r.tipo === "contenido" ? r.documento!.bytes : new Uint8Array();
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});

describe("475/R22 — un fallo de lectura se propaga con la operacion, nunca vacio", () => {
  for (const op of ["zonas", "filasEnAlerta", "contarSinHito"] as const) {
    it(`falla ${op}`, async () => {
      const informe = crearInformeTransito(repo([], { falla: op }).r);
      const p = informe.generar(ctx({ ...PARAMETROS_POR_DEFECTO, enviarSiVacio: true }));
      await expect(p).rejects.toThrow(`informe transito: ${op} falló`);
      await expect(informe.generar(ctx())).rejects.toBeInstanceOf(Error);
    });
  }

  it("conserva la causa original", async () => {
    const err = await crearInformeTransito(repo([], { falla: "zonas" }).r)
      .generar(ctx())
      .catch((e: unknown) => e as Error);
    expect((err as Error & { cause?: Error }).cause?.message).toBe("conexion caida");
  });

  it("476/m1: el message lleva el motivo saneado (clase y codigo), nunca el message de la causa", async () => {
    const prisma = Object.assign(new Error("Invalid `prisma.orden.findMany()` invocation: secreto"), {
      name: "PrismaClientKnownRequestError",
      code: "P2028",
    });
    const r = repo([]).r;
    r.repo.zonas = async () => {
      throw prisma;
    };
    const err = await crearInformeTransito(r)
      .generar(ctx())
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe("informe transito: zonas falló (PrismaClientKnownRequestError P2028)");
    expect((err as Error).message).not.toContain("secreto");
  });
});
