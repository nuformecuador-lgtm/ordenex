import { describe, it, expect } from "vitest";
import { ORDER_STATUS_SEED, ORDER_STATUS_RETIRADOS } from "@/lib/types/order-status";
import {
  CIERRE_LOGISTICO,
  ESTADOS_OFRECIDOS,
  PARAMETROS_POR_DEFECTO,
  erroresDeParametrosTransito,
  estadosIncluidos,
  parametrosTransitoSchema,
  plazoEfectivo,
  umbralDeAlerta,
  type ParametrosTransito,
} from "@/lib/whatsapp-envios/informes/transito/parametros";

// Ficha 475 (T1.2) — R3, R4, R5, R6.

const ZONA = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";

function con(cambios: Record<string, unknown>): unknown {
  return { ...PARAMETROS_POR_DEFECTO, ...cambios };
}

function errores(input: unknown): Record<string, string[]> {
  const r = parametrosTransitoSchema.safeParse(input);
  expect(r.success).toBe(false);
  if (r.success) return {};
  return erroresDeParametrosTransito(r.error);
}

describe("475/R3 — acepta los parametros declarados", () => {
  it("los valores de partida son validos", () => {
    expect(parametrosTransitoSchema.safeParse(PARAMETROS_POR_DEFECTO).success).toBe(true);
  });

  it("acepta los tres hitos, plazos por zona y umbrales nulos", () => {
    for (const hito of ["entrada_bodega_central", "creacion", "generacion_guia"]) {
      const r = parametrosTransitoSchema.safeParse(
        con({ hito, zonas: [{ zonaId: ZONA, plazoDias: 365, avisoDias: 364 }, { zonaId: OTRA, plazoDias: 1, avisoDias: 0 }] }),
      );
      expect(r.success).toBe(true);
    }
  });
});

describe("475/R4 — rechaza con un error que nombra el campo", () => {
  const casos: [string, Record<string, unknown>, string][] = [
    ["plazo 0", { zonas: [{ zonaId: ZONA, plazoDias: 0, avisoDias: 0 }] }, "parametros.zonas.0.plazoDias"],
    ["plazo 366", { zonas: [{ zonaId: ZONA, plazoDias: 366, avisoDias: 0 }] }, "parametros.zonas.0.plazoDias"],
    ["plazo decimal", { zonas: [{ zonaId: ZONA, plazoDias: 10.5, avisoDias: 0 }] }, "parametros.zonas.0.plazoDias"],
    ["aviso negativo", { zonas: [{ zonaId: ZONA, plazoDias: 10, avisoDias: -1 }] }, "parametros.zonas.0.avisoDias"],
    ["aviso = plazo", { zonas: [{ zonaId: ZONA, plazoDias: 10, avisoDias: 10 }] }, "parametros.zonas.0.avisoDias"],
    ["aviso decimal", { zonas: [{ zonaId: ZONA, plazoDias: 10, avisoDias: 1.5 }] }, "parametros.zonas.0.avisoDias"],
    [
      "zona repetida",
      { zonas: [{ zonaId: ZONA, plazoDias: 10, avisoDias: 2 }, { zonaId: ZONA, plazoDias: 9, avisoDias: 2 }] },
      "parametros.zonas.1.zonaId",
    ],
    ["hito desconocido", { hito: "ayer" }, "parametros.hito"],
    ["campo no declarado en la raiz", { extra: 1 }, "parametros.extra"],
    [
      "campo no declarado en una zona",
      { zonas: [{ zonaId: ZONA, plazoDias: 10, avisoDias: 2, color: "rojo" }] },
      "parametros.zonas.0.color",
    ],
  ];
  for (const [nombre, cambios, campo] of casos) {
    it(nombre, () => {
      const e = errores(con(cambios));
      expect(Object.keys(e)).toContain(campo);
      expect(e[campo].join(" ").length).toBeGreaterThan(0);
    });
  }

  it("umbral de parado fuera de 0..90 o decimal", () => {
    for (const v of [-1, 91, 1.5]) {
      const estados = PARAMETROS_POR_DEFECTO.estados.map((e, i) => (i === 0 ? { ...e, paradoSiMasDeDias: v } : e));
      expect(Object.keys(errores(con({ estados })))).toContain("parametros.estados.0.paradoSiMasDeDias");
    }
  });

  it("estados no ofrecidos: cierre logistico, retirados y desconocidos", () => {
    for (const estado of [...CIERRE_LOGISTICO, ...ORDER_STATUS_RETIRADOS, "no_existe"]) {
      const estados = [...PARAMETROS_POR_DEFECTO.estados, { estado, incluido: true, paradoSiMasDeDias: null }];
      const e = errores(con({ estados }));
      expect(Object.keys(e)).toContain(`parametros.estados.${estados.length - 1}.estado`);
    }
  });

  it("estado repetido", () => {
    const estados = [...PARAMETROS_POR_DEFECTO.estados, { ...PARAMETROS_POR_DEFECTO.estados[0] }];
    expect(Object.keys(errores(con({ estados })))).toContain(`parametros.estados.${estados.length - 1}.estado`);
  });

  it("ningun estado incluido", () => {
    const estados = PARAMETROS_POR_DEFECTO.estados.map((e) => ({ ...e, incluido: false }));
    expect(Object.keys(errores(con({ estados })))).toContain("parametros.estados");
    expect(Object.keys(errores(con({ estados: [] })))).toContain("parametros.estados");
  });

  it("el mensaje de un campo no declarado nombra el campo", () => {
    expect(errores(con({ misterio: true }))["parametros.misterio"].join(" ")).toContain("misterio");
  });
});

describe("475/R5 — valores de partida exactos", () => {
  it("hito, zonas, enviarSiVacio", () => {
    expect(PARAMETROS_POR_DEFECTO.hito).toBe("entrada_bodega_central");
    expect(PARAMETROS_POR_DEFECTO.zonas).toEqual([]);
    expect(PARAMETROS_POR_DEFECTO.enviarSiVacio).toBe(false);
  });

  it("estados incluidos y umbrales (contrato literal de la maqueta)", () => {
    const porEstado = Object.fromEntries(
      PARAMETROS_POR_DEFECTO.estados.map((e) => [e.estado, [e.incluido, e.paradoSiMasDeDias]]),
    );
    expect(porEstado).toEqual({
      en_ruta_bodega_central: [true, null],
      en_bodega_central: [true, 2],
      mensajero_recogiendo_en_bodega: [true, null],
      en_ruta_bodega_satelite: [true, 2],
      en_bodega_satelite: [true, 2],
      en_reparto: [true, null],
      reprogramado: [true, 3],
      novedad: [true, 1],
      novedad_interna: [true, 1],
      incidente: [true, 1],
      devolucion_a_origen_por_rechazo: [true, null],
      por_devolver_a_bodega_central: [true, null],
      devolviendo_a_bodega_central: [true, null],
      por_devolver_a_tienda: [true, null],
      devolviendo_a_tienda: [true, null],
      en_preparacion: [false, null],
      por_recolectar_en_tienda: [false, null],
      recolectando: [false, null],
    });
  });

  it("ESTADOS_OFRECIDOS = ORDER_STATUS_SEED − CIERRE_LOGISTICO (un estado nuevo rompe este test)", () => {
    const esperado = new Set<string>(ORDER_STATUS_SEED.filter((s) => !(CIERRE_LOGISTICO as readonly string[]).includes(s)));
    expect(new Set<string>(ESTADOS_OFRECIDOS)).toEqual(esperado);
    expect(ESTADOS_OFRECIDOS.length).toBe(18);
  });

  it("un estado ofrecido ausente de la lista = no incluido", () => {
    const p: ParametrosTransito = { ...PARAMETROS_POR_DEFECTO, estados: [{ estado: "novedad", incluido: true, paradoSiMasDeDias: 1 }] };
    expect(estadosIncluidos(p)).toEqual(["novedad"]);
  });
});

describe("475/R6 — plazo efectivo de una zona", () => {
  const p: ParametrosTransito = { ...PARAMETROS_POR_DEFECTO, zonas: [{ zonaId: ZONA, plazoDias: 7, avisoDias: 3 }] };

  it("con entrada propia usa la suya", () => {
    expect(plazoEfectivo({ id: ZONA, esCentral: false }, p)).toEqual({ plazoDias: 7, avisoDias: 3 });
    expect(umbralDeAlerta(plazoEfectivo({ id: ZONA, esCentral: true }, p))).toBe(4);
  });

  it("sin entrada: central 10/2, resto 20/5", () => {
    expect(plazoEfectivo({ id: OTRA, esCentral: true }, p)).toEqual({ plazoDias: 10, avisoDias: 2 });
    expect(plazoEfectivo({ id: OTRA, esCentral: false }, p)).toEqual({ plazoDias: 20, avisoDias: 5 });
  });
});
