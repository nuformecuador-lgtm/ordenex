import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import { costoEstimadoDe, costoRealDe } from "@/lib/utils/api-orden-costo";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

/**
 * ⏳ 2026-09-10 — FEATURE 415 (T2): el modulo PURO que produce los cinco conceptos de costo.
 *
 * ⚠️ **TODOS LOS IMPORTES ESPERADOS ESTAN ESCRITOS A MANO**, con la aritmetica anotada al lado de
 * cada caso. Ni un solo `expect(x).toBe(costoEstimadoDe(...))` ni `toBe(derivarIngresoOrden(...))`:
 * comparar un importe contra la funcion que lo calcula esta SIEMPRE verde y no prueba nada. Es la
 * trampa numero uno de esta ficha, y este archivo es donde mas facil seria caer en ella.
 *
 * Lo que se afirma aqui es la FORMA y los VALORES; el `select`, el `where` del congelado y el
 * `take: 1` no viven aqui y no se pueden probar con dobles: eso es
 * `tests/integration/db/costo-y-zona-api-415.test.ts`, contra Postgres real.
 */

/**
 * Tarifa de laboratorio, con numeros REDONDOS para que la aritmetica se pueda escribir a mano:
 *   flete estandar 3000.00 · flete GAM 2500.00 · devolucion 1500.00 / GAM 1200.00
 *   comision COD 3.50 % · IVA flete 13 % · IVA comision 13 % · sin pacto especial
 */
const TARIFA: TarifaVigente = {
  valorFlete: "3000.00",
  valorFleteGam: "2500.00",
  valorFleteDevuelto: "1500.00",
  valorFleteDevueltoGam: "1200.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/** Entradas base: zona central, sin pacto especial, COD de 25.900,00 y con comision. */
const ENTRADAS = {
  esCentral: true,
  esZonaEspecial: false,
  montoCobrar: "25900.00",
  cobraComision: true,
};

const FULFILLMENT = "696.00";

/** El dialecto money-safe del canal: signo opcional, punto, DOS decimales. Sin simbolo, sin miles. */
const MONEY_SAFE = /^-?\d+\.\d{2}$/;

describe("api-orden-costo — los cinco conceptos (feature 415, T2)", () => {
  it("R10/R12/R16: una tarifa GAM produce los CINCO conceptos con estos valores exactos", () => {
    // ARITMETICA A MANO (no se llama a nada del codigo para obtenerla):
    //   flete       = valorFleteGam                       = 2500.00   (esCentral: true)
    //   iva         = 2500.00 x 13 / 100                  =  325.00
    //   comision    = 25900.00 x 3.50 / 100 = 906.50      =  906.50
    //   ivaComision = 906.50 x 13 / 100 = 117.845 -> H.UP =  117.85
    //   fulfillment = el monto que entra por parametro    =  696.00
    const costo = costoEstimadoDe(TARIFA, FULFILLMENT, ENTRADAS);

    expect(costo).toEqual({
      flete: "2500.00",
      iva: "325.00",
      comision: "906.50",
      ivaComision: "117.85",
      fulfillment: "696.00",
    });
  });

  it("R15: el escenario es ENTREGADA — sale el flete de ENTREGA, nunca el de devolucion", () => {
    const costo = costoEstimadoDe(TARIFA, FULFILLMENT, ENTRADAS)!;

    // El flete de entrega GAM es 2500.00 y el de DEVOLUCION GAM es 1200.00. Si la derivacion
    // pidiera `rechazada` en vez de `entregada`, saldria 1200.00 (y sin comision).
    expect(costo.flete).toBe("2500.00");
    expect(costo.flete).not.toBe("1200.00");
    expect(costo.flete).not.toBe("1500.00");
    // Y la comision COD existe, que es lo que un escenario de rechazo NO tiene (no hubo recaudo).
    expect(costo.comision).toBe("906.50");
  });

  it("R20: `esCentral` elige la columna — true da la GAM, false la estandar, y difieren", () => {
    //   esCentral: true  -> flete 2500.00 ; iva 2500.00 x 13 % = 325.00
    //   esCentral: false -> flete 3000.00 ; iva 3000.00 x 13 % = 390.00
    const central = costoEstimadoDe(TARIFA, FULFILLMENT, { ...ENTRADAS, esCentral: true })!;
    const estandar = costoEstimadoDe(TARIFA, FULFILLMENT, { ...ENTRADAS, esCentral: false })!;

    expect(central.flete).toBe("2500.00");
    expect(central.iva).toBe("325.00");
    expect(estandar.flete).toBe("3000.00");
    expect(estandar.iva).toBe("390.00");
    // La comision NO depende de la columna de flete: misma base, mismo importe.
    expect(central.comision).toBe(estandar.comision);
  });

  it("R20: un distrito con PACTO ESPECIAL usa el monto pactado y no la columna", () => {
    //   tarifaEspecial 1800.00 pactado ; iva = 1800.00 x 13 % = 234.00
    //   El pacto IGNORA `esCentral` a proposito: es UN precio para ese distrito.
    const conPacto: TarifaVigente = { ...TARIFA, tarifaEspecial: "1800.00" };
    const costo = costoEstimadoDe(conPacto, FULFILLMENT, {
      ...ENTRADAS,
      esZonaEspecial: true,
    })!;

    expect(costo.flete).toBe("1800.00");
    expect(costo.iva).toBe("234.00");

    // Sin pacto registrado, la zona especial cae a la columna normal: 2500.00, no 1800.00.
    const sinPacto = costoEstimadoDe(TARIFA, FULFILLMENT, { ...ENTRADAS, esZonaEspecial: true })!;
    expect(sinPacto.flete).toBe("2500.00");
  });

  it('R13: `cobraComision: false` deja comision e ivaComision en "0.00", NO ausentes', () => {
    const costo = costoEstimadoDe(TARIFA, FULFILLMENT, { ...ENTRADAS, cobraComision: false })!;

    expect(costo.comision).toBe("0.00");
    expect(costo.ivaComision).toBe("0.00");
    // Las claves EXISTEN: ni `undefined` ni omitidas. La ausencia se declara fuera del objeto.
    expect("comision" in costo).toBe(true);
    expect("ivaComision" in costo).toBe(true);
    expect(JSON.stringify(costo)).toContain('"comision":"0.00"');
    // Y el flete no se mueve por no cobrar comision.
    expect(costo.flete).toBe("2500.00");
  });

  it('R22+R28: LA ASIMETRIA — el estimado sin tarifa es `null`; el real son cinco "0.00"', () => {
    // ⭑ LOS DOS EN EL MISMO BLOQUE A PROPOSITO. Separados parecen una inconsistencia; juntos se
    // lee por que no lo son (design §D7 / §D8):
    //   · en `costoEstimado`, un cero MENTIRIA: prometeria un envio gratis sobre algo que todavia
    //     no se ha cobrado y que SI se cobrara en cuanto la tienda tenga tarifa. En un borde que
    //     sirve precios, eso es una mentira sobre dinero servida como precio (274/R39).
    //   · en `costoReal`, el cero DESCRIBE lo que paso: `cierre_detail.tarifa_id IS NULL` significa
    //     que la tienda no tenia tarifa al SOLICITAR y ese cierre liquido cero. Un `null` diria
    //     «no se sabe», que seria falso.
    const estimado = costoEstimadoDe(null, "0.00", ENTRADAS);
    const real = costoRealDe(null, "0.00", ENTRADAS);

    expect(estimado).toBeNull();
    expect(real).toEqual({
      flete: "0.00",
      iva: "0.00",
      comision: "0.00",
      ivaComision: "0.00",
      fulfillment: "0.00",
    });
    // `costoRealDe` NUNCA devuelve `null`: la ausencia de FILA la decide el llamador.
    expect(real).not.toBeNull();
  });

  it("R25: con la MISMA tarifa y las MISMAS entradas, estimado y real dan lo mismo", () => {
    // Lo que los separa es de donde sale la tarifa, no la formula. Si un dia divergieran, la
    // misma plata se leeria distinta segun el campo.
    const estimado = costoEstimadoDe(TARIFA, FULFILLMENT, ENTRADAS);
    const real = costoRealDe(TARIFA, FULFILLMENT, ENTRADAS);

    expect(real).toEqual(estimado);
  });

  it("R12: todo importe casa el dialecto money-safe, sin simbolo y sin separador de miles", () => {
    const costo = costoEstimadoDe(TARIFA, FULFILLMENT, ENTRADAS)!;

    for (const [clave, valor] of Object.entries(costo)) {
      expect(valor, `${clave} = ${valor}`).toMatch(MONEY_SAFE);
      expect(valor).not.toContain(",");
      expect(valor).not.toContain("₡");
      expect(valor).not.toContain("$");
    }
    // Un importe de cuatro cifras sale SIN punto de miles: "2500.00", no "2.500,00".
    expect(costo.flete).toBe("2500.00");
  });

  it("R10/R11: el objeto tiene las CINCO claves y NINGUNA que sume los cinco", () => {
    const costo = costoEstimadoDe(TARIFA, FULFILLMENT, ENTRADAS)!;

    expect(Object.keys(costo).sort()).toEqual([
      "comision",
      "flete",
      "fulfillment",
      "iva",
      "ivaComision",
    ]);
    // La suma A MANO de los cinco: 2500.00 + 325.00 + 906.50 + 117.85 + 696.00 = 4545.35.
    // Ese numero NO puede aparecer en ningun valor, con ningun nombre. R11 lo escribe como
    // PROHIBICION y no como omision para que no vuelva de paso en otra ficha: el unico `total`
    // que este canal publica significa LO CONTRARIO («lo que RECIBE la tienda»).
    expect(Object.values(costo)).not.toContain("4545.35");
    expect(costo).not.toHaveProperty("total");
    expect(JSON.stringify(costo)).not.toContain("4545.35");
  });

  it("R17: money-safe — `657.25` y no `657.26`, el centimo que la 204 midio", () => {
    // CONTRAPRUEBA DEL CALCULO SOBRE `number` (feature 204, caso real de la base):
    //   monto 16618.40, comision 3.50 %, IVA de comision 13 %.
    //   CORRECTO (Decimal, con el redondeo INTERMEDIO):
    //     comision    = 16618.40 x 3.50 % = 581.644 -> HALF_UP -> 581.64
    //     ivaComision = 581.64   x 13   % =  75.6132 -> HALF_UP ->  75.61
    //     comision + IVA = 581.64 + 75.61 = 657.25
    //   LO QUE HACIA EL NAVEGADOR (sin el redondeo intermedio, sobre float):
    //     581.644 x 1.13 = 657.25772 -> toFixed(2) -> 657.26   <- UN CENTIMO DE MAS
    const costo = costoEstimadoDe(TARIFA, "0.00", {
      ...ENTRADAS,
      montoCobrar: "16618.40",
    })!;

    expect(costo.comision).toBe("581.64");
    expect(costo.ivaComision).toBe("75.61");

    // La suma la hace el TEST (dos cadenas ya publicadas), no la funcion bajo prueba.
    const suma = new Prisma.Decimal(costo.comision).plus(costo.ivaComision).toFixed(2);
    expect(suma).toBe("657.25");
    expect(suma).not.toBe("657.26");
  });

  it("R17: `montoCobrar: null` entra como cero y no revienta", () => {
    // Sin COD no hay base de comision: 0.00 x 3.50 % = 0.00, y su IVA tambien 0.00. El flete no
    // depende del COD, asi que sigue siendo 2500.00.
    const costo = costoEstimadoDe(TARIFA, FULFILLMENT, { ...ENTRADAS, montoCobrar: null })!;

    expect(costo).toEqual({
      flete: "2500.00",
      iva: "325.00",
      comision: "0.00",
      ivaComision: "0.00",
      fulfillment: "696.00",
    });
  });

  it("R29: el `fulfillment` es el monto que entra, no uno derivado de la tarifa", () => {
    // El caso MEDIDO: la misma tarifa con el fulfillment congelado viejo (692,00) y el vigente
    // (696,00). Los dos a mano, y los otros cuatro conceptos IDENTICOS entre si.
    const congelado = costoRealDe(TARIFA, "692.00", ENTRADAS);
    const vigente = costoEstimadoDe(TARIFA, "696.00", ENTRADAS)!;

    expect(congelado.fulfillment).toBe("692.00");
    expect(vigente.fulfillment).toBe("696.00");
    expect(congelado.flete).toBe(vigente.flete);
    expect(congelado.comision).toBe(vigente.comision);
  });
});
