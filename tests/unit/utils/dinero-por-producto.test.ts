import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

import {
  aporteEsCero,
  CRITERIO_RECAUDO_ENTREGA,
  esLiquidada,
  ESTADO_CIERRE_LIQUIDADO,
  repartoDeOrden,
  RESULTADOS_QUE_APORTAN,
  type GestionDeDinero,
} from "@/lib/utils/dinero-por-producto";
import { CRITERIO_DE_APORTE } from "@/lib/utils/aporte-por-orden";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type { OrdenCongelada } from "@/lib/utils/aporte-por-orden";

// FICHA 347 / B1.2 — EL MODULO PURO DEL DINERO. Cubre R14, R15, R16, R17, R18, R19, R20, R21,
// R22, R23, R24, R25, R26, R27, R30, R31, R39.
//
// ⚠ LOS NUMEROS ESTAN CALCULADOS A MANO Y ESCRITOS A MANO. No se derivan de la funcion que se
// prueba ni de la tarifa: una asercion contra su propia fuente esta siempre verde y no distingue
// nada — es la leccion medida en este repo. Con la tarifa de abajo:
//
//   flete            = 3.000,00                    iva flete   = 13 % = 390,00
//   comision COD     =  5 % de 10.000 = 500,00     iva comision = 13 % =  65,00
//   ordenex          = 3.000 + 390 + 500 + 65      = 3.955,00
//   tienda           = 10.000 - 3.390 - 565        = 6.045,00
//   retorno (rechazo)= 2.000 + 13 %                = 2.260,00

const TARIFA: TarifaVigente = {
  valorFlete: "3000.00",
  valorFleteGam: "2500.00",
  valorFleteDevuelto: "2000.00",
  valorFleteDevueltoGam: "1800.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

function congelada(opts: Partial<OrdenCongelada> = {}): OrdenCongelada {
  return {
    esCentral: false,
    esZonaEspecial: false,
    montoCobrar: "10000.00",
    cobraComision: true,
    tarifa: TARIFA,
    ...opts,
  };
}

function g(opts: Partial<GestionDeDinero> = {}): GestionDeDinero {
  return {
    resultado: "entregada",
    montoRecibido: "10000.00",
    cierreEstado: "aprobado",
    congelada: congelada(),
    ...opts,
  };
}

describe("R24 · el criterio del recaudo y los resultados se DERIVAN, no se escriben", () => {
  it("el criterio de recaudo es SOLO `entregada`, con supresion de ceros", () => {
    // Escrito a mano: es el contrato de ⟨Q1⟩, no una copia de la constante.
    expect([...CRITERIO_RECAUDO_ENTREGA.resultados]).toEqual(["entregada"]);
    expect(CRITERIO_RECAUDO_ENTREGA.exigeMontoRecibido).toBe(true);
    // El recaudo EXISTE sin cierre: es lo cobrado, no lo derivado.
    expect(CRITERIO_RECAUDO_ENTREGA.exigeTarifa).toBe(false);
    expect(CRITERIO_RECAUDO_ENTREGA.exigeCobraComision).toBe(false);
    expect(CRITERIO_RECAUDO_ENTREGA.exigeMontoCobrar).toBe(false);
  });

  it("hoy la lista vale exactamente `entregada` + `rechazada`", () => {
    expect([...RESULTADOS_QUE_APORTAN]).toEqual(["entregada", "rechazada"]);
  });

  it("y sale de la UNION de los seis conceptos: no hay ninguna lista escrita", () => {
    // La misma union, calculada aqui desde la otra punta. Si alguien escribiera la lista a mano
    // en el modulo, este caso seguiria pasando — por eso existe el del concepto INYECTADO.
    const esperada = new Set<string>(CRITERIO_RECAUDO_ENTREGA.resultados);
    for (const c of Object.values(CRITERIO_DE_APORTE)) {
      for (const r of c.resultados) esperada.add(r);
    }
    expect(new Set(RESULTADOS_QUE_APORTAN)).toEqual(esperada);
  });

  it("es determinista: mismo orden en cada lectura, sin `localeCompare`", () => {
    expect([...RESULTADOS_QUE_APORTAN]).toEqual([...RESULTADOS_QUE_APORTAN].sort());
    expect(new Set(RESULTADOS_QUE_APORTAN).size).toBe(RESULTADOS_QUE_APORTAN.length);
  });
});

describe("R24 · EL CASO DEL CONCEPTO INYECTADO — la unica prueba de que se DERIVA", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/utils/aporte-por-orden");
  });

  it("un septimo concepto con un resultado nuevo aparece SOLO en la lista sin tocar el modulo", async () => {
    // ⚠ ESTE ES EL CASO QUE MATA LA MUTACION M4 (escribir `["entregada","rechazada"]` a mano).
    // Todos los demas casos de este archivo siguen verdes con la lista escrita; este cae.
    const real = await vi.importActual<typeof import("@/lib/utils/aporte-por-orden")>(
      "@/lib/utils/aporte-por-orden",
    );
    vi.doMock("@/lib/utils/aporte-por-orden", () => ({
      ...real,
      CRITERIO_DE_APORTE: {
        ...real.CRITERIO_DE_APORTE,
        // Un concepto que hoy no existe, con un resultado que hoy no aporta.
        ingreso_inventado: {
          resultados: ["reprogramada"],
          exigeCobraComision: false,
          exigeTarifa: true,
          exigeMontoCobrar: false,
          exigeMontoRecibido: false,
        },
      },
    }));

    const mod = await import("@/lib/utils/dinero-por-producto");
    expect([...mod.RESULTADOS_QUE_APORTAN]).toEqual(["entregada", "rechazada", "reprogramada"]);
  });
});

describe("R23 / R26 · que es una gestion LIQUIDADA — las TRES condiciones", () => {
  it("cierre aprobado + snapshot + tarifa congelada", () => {
    expect(esLiquidada(g())).toBe(true);
    expect(ESTADO_CIERRE_LIQUIDADO).toBe("aprobado");
  });

  it("un cierre SOLICITADO no liquida (⟨Q2⟩: el snapshot se escribe al solicitar)", () => {
    expect(esLiquidada(g({ cierreEstado: "solicitado" }))).toBe(false);
    expect(esLiquidada(g({ cierreEstado: "rechazado" }))).toBe(false);
    expect(esLiquidada(g({ cierreEstado: "vencido" }))).toBe(false);
  });

  it("sin cierre no liquida", () => {
    expect(esLiquidada(g({ cierreEstado: null, congelada: null }))).toBe(false);
  });

  it("R23 · con cierre aprobado pero SIN tarifa congelada tampoco liquida", () => {
    expect(esLiquidada(g({ congelada: congelada({ tarifa: null }) }))).toBe(false);
  });
});

describe("R14 / R15 / R20 · el reparto de una entrega liquidada", () => {
  it("las cuatro cifras salen con los numeros calculados a mano", () => {
    const r = repartoDeOrden([g()]);

    expect(r.recaudado).toBe("10000.00");
    expect(r.liquidadoRecaudado).toBe("10000.00");
    expect(r.pendienteRecaudado).toBe("0.00");
    expect(r.ordenex).toBe("3955.00"); // 3000 + 390 + 500 + 65
    expect(r.tienda).toBe("6045.00"); // 10000 - 3390 - 565
    expect(r.retorno).toBe("0.00");
    expect(r.hayLiquidado).toBe(true);
  });

  it("R20 · `ordenex + tienda === liquidado.recaudado`, EXACTO y sin margen", () => {
    for (const monto of ["10000.00", "7333.33", "0.01", "123456.78"]) {
      const r = repartoDeOrden([
        g({ montoRecibido: monto, congelada: congelada({ montoCobrar: monto }) }),
      ]);
      const suma = new Prisma.Decimal(r.ordenex!).plus(r.tienda!);
      expect(suma.toFixed(2), monto).toBe(r.liquidadoRecaudado);
    }
  });

  it("R22 · todo importe es STRING con DOS decimales; ninguno es `number`", () => {
    const r = repartoDeOrden([g()]);
    for (const [campo, valor] of Object.entries(r)) {
      if (campo === "hayLiquidado") continue;
      if (valor === null) continue;
      expect(typeof valor, campo).toBe("string");
      expect(valor as string, campo).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("sin comision COD la orden solo factura flete + IVA (R14)", () => {
    const r = repartoDeOrden([g({ congelada: congelada({ cobraComision: false }) })]);
    expect(r.ordenex).toBe("3390.00"); // 3000 + 390, sin comision
    expect(r.tienda).toBe("6610.00"); // 10000 - 3390
  });
});

describe("R19 · el RETORNO entra, pero FUERA del reparto", () => {
  it("una rechazada liquidada aporta retorno y NO toca `ordenex` ni `tienda`", () => {
    const r = repartoDeOrden([g({ resultado: "rechazada", montoRecibido: null })]);

    // Un rechazo NO recauda: no hay plata recogida que repartir.
    expect(r.recaudado).toBe("0.00");
    expect(r.retorno).toBe("2260.00"); // 2000 + 13 %
    expect(r.ordenex).toBe("0.00");
    expect(r.tienda).toBe("0.00");
  });

  it("R20 sigue siendo cierta con una entrega Y un rechazo en la misma orden", () => {
    const r = repartoDeOrden([
      g(),
      g({ resultado: "rechazada", montoRecibido: null }),
    ]);

    expect(r.retorno).toBe("2260.00");
    // ⚠ SI EL RETORNO ENTRARA EN `ordenex` (mutacion M3), esto valdria 6.215,00 y la suma daria
    // 12.260,00 sobre un recaudado de 10.000,00.
    expect(r.ordenex).toBe("3955.00");
    expect(new Prisma.Decimal(r.ordenex!).plus(r.tienda!).toFixed(2)).toBe(r.liquidadoRecaudado);
  });

  it("una `devuelta` no aporta NADA (regla de la ficha 301, que esta ficha lee y no reescribe)", () => {
    const r = repartoDeOrden([g({ resultado: "devuelta", montoRecibido: null })]);
    expect(r.recaudado).toBe("0.00");
    expect(r.retorno).toBe("0.00");
    expect(r.ordenex).toBe("0.00");
  });
});

describe("R21 / R26 / R27 / R30 · liquidado vs pendiente", () => {
  it("una entrega SIN cierre trae su recaudo y NINGUNA cifra de reparto", () => {
    const r = repartoDeOrden([g({ cierreEstado: null, congelada: null })]);

    expect(r.recaudado).toBe("10000.00");
    expect(r.pendienteRecaudado).toBe("10000.00");
    expect(r.liquidadoRecaudado).toBe("0.00");
    // ⚠ R30 — `null`, NUNCA `"0.00"`: no se proyecta, no se estima, no se extrapola (R31).
    // Es la mutacion M6.
    expect(r.ordenex).toBeNull();
    expect(r.tienda).toBeNull();
    expect(r.retorno).toBeNull();
    expect(r.hayLiquidado).toBe(false);
  });

  it("R23 · con cierre aprobado y SIN tarifa congelada tampoco hay reparto, y el recaudo queda pendiente", () => {
    const r = repartoDeOrden([g({ congelada: congelada({ tarifa: null }) })]);

    expect(r.recaudado).toBe("10000.00");
    expect(r.pendienteRecaudado).toBe("10000.00");
    expect(r.ordenex).toBeNull();
  });

  it("R21 · `liquidado + pendiente === recaudado`, EXACTO, con la orden a caballo", () => {
    const r = repartoDeOrden([
      g({ montoRecibido: "4000.00", congelada: congelada({ montoCobrar: "4000.00" }) }),
      g({ montoRecibido: "6000.00", cierreEstado: null, congelada: null }),
    ]);

    expect(r.recaudado).toBe("10000.00");
    expect(r.liquidadoRecaudado).toBe("4000.00");
    expect(r.pendienteRecaudado).toBe("6000.00");
    expect(
      new Prisma.Decimal(r.liquidadoRecaudado).plus(r.pendienteRecaudado).toFixed(2),
    ).toBe(r.recaudado);
  });
});

describe("R18 · una orden en DOS cierres: los aportes se SUMAN, con el snapshot de cada uno", () => {
  it("dos gestiones liquidadas con tarifas congeladas DISTINTAS derivan cada una con la suya", () => {
    const otraTarifa: TarifaVigente = { ...TARIFA, valorFlete: "1000.00", comisionCod: "0.00" };
    const r = repartoDeOrden([
      g({ montoRecibido: "10000.00" }),
      g({
        montoRecibido: "5000.00",
        congelada: congelada({ montoCobrar: "5000.00", tarifa: otraTarifa }),
      }),
    ]);

    // Cierre A: 3000 + 390 + 500 + 65 = 3955. Cierre B: 1000 + 130 + 0 + 0 = 1130.
    expect(r.ordenex).toBe("5085.00");
    expect(r.recaudado).toBe("15000.00");
    expect(r.liquidadoRecaudado).toBe("15000.00");
    expect(r.tienda).toBe("9915.00"); // 15000 - 5085
    // Y R20 se mantiene con las dos derivaciones sumadas.
    expect(new Prisma.Decimal(r.ordenex!).plus(r.tienda!).toFixed(2)).toBe(r.liquidadoRecaudado);
  });
});

describe("R25 · determinismo", () => {
  it("la misma entrada da la misma salida, sin reloj y sin orden de llegada", () => {
    const gestiones = [g(), g({ resultado: "rechazada", montoRecibido: null })];
    expect(repartoDeOrden(gestiones)).toEqual(repartoDeOrden(gestiones));
    // El orden de las gestiones no cambia ninguna cifra: solo hay sumas.
    expect(repartoDeOrden([...gestiones].reverse())).toEqual(repartoDeOrden(gestiones));
  });

  it("sin gestiones no hay cifras derivadas y el recaudo es cero", () => {
    const r = repartoDeOrden([]);
    expect(r.recaudado).toBe("0.00");
    expect(r.ordenex).toBeNull();
    expect(aporteEsCero(r)).toBe(true);
  });
});

describe("R39 · que orden NO aporta nada", () => {
  it("una entrega liquidada de verdad SI aporta", () => {
    expect(aporteEsCero(repartoDeOrden([g()]))).toBe(false);
  });

  it("una entrega sin recaudo y sin cierre no aporta en NINGUNA de las cuatro cifras", () => {
    const r = repartoDeOrden([g({ montoRecibido: null, cierreEstado: null, congelada: null })]);
    expect(aporteEsCero(r)).toBe(true);
  });

  it("una entrega PENDIENTE con recaudo SI aporta: su recaudo es un hecho", () => {
    const r = repartoDeOrden([g({ cierreEstado: null, congelada: null })]);
    expect(aporteEsCero(r)).toBe(false);
  });

  it("una rechazada liquidada SI aporta aunque no recaude: su retorno no es cero", () => {
    const r = repartoDeOrden([g({ resultado: "rechazada", montoRecibido: null })]);
    expect(aporteEsCero(r)).toBe(false);
  });
});
