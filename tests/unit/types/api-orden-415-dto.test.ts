import { describe, it, expect } from "vitest";
import type {
  ApiOrdenCostoDTO,
  ApiOrdenDetalleDTO,
  ApiOrdenListItemDTO,
  ApiZonaDTO,
} from "@/lib/types/api-orden";

// ⏳ 2026-09-10 — Feature 415 (T1): la FORMA de los tres campos nuevos del canal publico.
//
// Mismo molde que `api-mensajero-dto.test.ts` (feature 404), y por el mismo motivo: cada regla de
// forma se afirma por los DOS lados que puede fallar.
//   · en TIEMPO DE EJECUCION, sobre las claves reales de un valor del tipo;
//   · en TIEMPO DE COMPILACION, con `@ts-expect-error`, porque una clave de mas no llega a
//     ejecutarse nunca. Un `@ts-expect-error` que dejara de ser un error PONE ROJO `pnpm
//     typecheck`, asi que estos asertos tampoco pueden quedarse verdes por vacio.

const ZONA: ApiZonaDTO = {
  id: "018f2c31-0000-4000-8000-00000000za01",
  nombre: "FGAM Zona Sur",
};

const COSTO: ApiOrdenCostoDTO = {
  flete: "2500.00",
  iva: "325.00",
  comision: "906.50",
  ivaComision: "117.85",
  fulfillment: "696.00",
};

/** Los diez campos que el item ya publicaba antes de esta ficha, intactos. */
const ITEM_BASE = {
  numGuia: 10234,
  numRemision: "REM-1",
  estado: "en_reparto",
  destinatario: "Ana Solis",
  telefonoDest: "0991234567",
  producto: "Caja",
  direccion: "Calle 1",
  montoCobrar: 25900,
  createdAt: new Date("2026-09-10T10:00:00.000Z"),
  mensajero: null,
} as const;

describe("415/R1 — `ApiZonaDTO` tiene exactamente `id` y `nombre`", () => {
  it("un valor del tipo tiene EXACTAMENTE las claves ['id','nombre']", () => {
    expect(Object.keys(ZONA)).toEqual(["id", "nombre"]);
    expect(typeof ZONA.id).toBe("string");
    expect(typeof ZONA.nombre).toBe("string");
  });

  it("R5: una TERCERA clave no compila (ni `esCentral`, ni subzona, ni geografia)", () => {
    const conDeMas: ApiZonaDTO = {
      id: "018f2c31-0000-4000-8000-00000000za01",
      nombre: "FGAM Zona Sur",
      // @ts-expect-error 415/R5 — `esCentral` NO se publica: es una columna MUTABLE del catalogo y
      // seria un SEGUNDO sitio donde responder «¿es GAM?», que puede contradecir al nombre.
      esCentral: false,
    };
    expect(conDeMas.nombre).toBe("FGAM Zona Sur");
  });

  it("R4: `nombre` es el del catalogo tal cual — no se deriva nada de el", () => {
    // El «GAM / fuera de GAM y su subzona» que el integrador pidio YA ESTA en el nombre. Partir
    // "FGAM Zona Sur" por un espacio seria parsing sobre texto libre que nadie garantiza.
    expect(ZONA.nombre).toBe("FGAM Zona Sur");
    expect(ZONA).not.toHaveProperty("subzona");
    expect(ZONA).not.toHaveProperty("esGam");
  });
});

describe("415/R10+R11 — `ApiOrdenCostoDTO` tiene cinco claves y NINGUN total", () => {
  it("R10: las claves son EXACTAMENTE las cinco, y todas son cadenas", () => {
    expect(Object.keys(COSTO).sort()).toEqual([
      "comision",
      "flete",
      "fulfillment",
      "iva",
      "ivaComision",
    ]);
    for (const valor of Object.values(COSTO)) expect(typeof valor).toBe("string");
  });

  it("R11: una SEXTA clave llamada `total` no compila", () => {
    const conTotal: ApiOrdenCostoDTO = {
      ...COSTO,
      // @ts-expect-error 415/R11 — el unico `total` que este canal publica significa LO CONTRARIO
      // («lo que RECIBE la tienda» = monto a cobrar menos los cinco conceptos). Dos `total` de
      // signo opuesto en el mismo canal es la ambiguedad que esta prohibicion existe para evitar.
      total: "4545.35",
    };
    expect(conTotal.flete).toBe("2500.00");
  });

  it("R11: una sexta clave con OTRO nombre tampoco compila", () => {
    const conAlias: ApiOrdenCostoDTO = {
      ...COSTO,
      // @ts-expect-error 415/R11 — «otro nombre reintroduce la misma ambiguedad con disfraz»
      // (design §D4). La prohibicion es del CAMPO SUMADO, no de la palabra `total`.
      costoTotal: "4545.35",
    };
    expect(conAlias.iva).toBe("325.00");
  });

  it("R13: un concepto en `null` no compila — el cero se AFIRMA, no se omite", () => {
    const conNull: ApiOrdenCostoDTO = {
      ...COSTO,
      // @ts-expect-error 415/R13 — dentro del objeto NUNCA hay `null`: un concepto que no aplica
      // sale como `"0.00"`. La ausencia se declara en el campo que CONTIENE el objeto.
      comision: null,
    };
    expect(conNull.flete).toBe("2500.00");
  });
});

describe("415/R2+R9 — la convencion de presencia en el item y la herencia del detalle", () => {
  it("R2: `zona` es REQUERIDO y NO admite `null` (a diferencia de `mensajero`)", () => {
    const sinZona: ApiOrdenListItemDTO = {
      ...ITEM_BASE,
      // @ts-expect-error 415/R2 — `orden.zona_id` es NOT NULL: toda orden tiene zona.
      zona: null,
      costoEstimado: null,
      costoReal: null,
    };
    expect(sinZona.numRemision).toBe("REM-1");
    // Y `mensajero` SI admite `null`: es la UNICA diferencia entre los dos campos con nombre.
    expect(sinZona.mensajero).toBeNull();
  });

  it("R9: los tres campos son REQUERIDOS: omitirlos no compila", () => {
    // @ts-expect-error 415/R9 — las tres claves viajan SIEMPRE; `null` es un valor, no una omision.
    const incompleto: ApiOrdenListItemDTO = { ...ITEM_BASE };
    expect(incompleto.numGuia).toBe(10234);
  });

  it("R9: `null` SI es un valor valido de los DOS campos de costo, y la clave viaja", () => {
    const item: ApiOrdenListItemDTO = {
      ...ITEM_BASE,
      zona: ZONA,
      costoEstimado: null,
      costoReal: null,
    };
    expect("costoEstimado" in item).toBe(true);
    expect("costoReal" in item).toBe(true);
    const texto = JSON.stringify(item);
    expect(texto).toContain('"costoEstimado":null');
    expect(texto).toContain('"costoReal":null');
  });

  it("el item con los tres campos poblados tiene TRECE claves exactas (R34: las diez siguen)", () => {
    const item: ApiOrdenListItemDTO = {
      ...ITEM_BASE,
      zona: ZONA,
      costoEstimado: COSTO,
      costoReal: { ...COSTO, fulfillment: "692.00" },
    };
    expect(Object.keys(item).sort()).toEqual([
      "costoEstimado",
      "costoReal",
      "createdAt",
      "destinatario",
      "direccion",
      "estado",
      "mensajero",
      "montoCobrar",
      "numGuia",
      "numRemision",
      "producto",
      "telefonoDest",
      "zona",
    ]);
  });

  it("R14: los DOS campos de costo son el MISMO tipo (misma forma, misma convencion)", () => {
    const item: ApiOrdenListItemDTO = {
      ...ITEM_BASE,
      zona: ZONA,
      costoEstimado: COSTO,
      costoReal: COSTO,
    };
    // La asignacion cruzada solo compila si los dos campos declaran el mismo tipo.
    const cruzado: ApiOrdenListItemDTO["costoEstimado"] = item.costoReal;
    expect(Object.keys(cruzado!).sort()).toEqual(Object.keys(item.costoEstimado!).sort());
  });

  it("R37: el DETALLE hereda los tres campos del item, sin declarar nada propio", () => {
    const detalle: ApiOrdenDetalleDTO = {
      ...ITEM_BASE,
      zona: ZONA,
      costoEstimado: COSTO,
      costoReal: null,
      evidencias: [],
      gestiones: [],
    };
    // Herencia por `extends`: si el detalle declarara su propia `zona`, esto seguiria compilando
    // pero el tipo cruzado de abajo dejaria de hacerlo en cuanto las formas divergieran.
    const comoDelItem: ApiOrdenListItemDTO["zona"] = detalle.zona;
    expect(comoDelItem).toEqual({
      id: "018f2c31-0000-4000-8000-00000000za01",
      nombre: "FGAM Zona Sur",
    });
    expect(detalle.costoReal).toBeNull();
  });
});
