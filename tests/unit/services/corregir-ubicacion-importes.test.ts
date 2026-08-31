import { describe, it, expect, vi } from "vitest";

import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DistritoResueltoRow,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

// FICHA 327 / C4 — EL DINERO DEL AVISO, CONTRA NUMEROS CALCULADOS A MANO.
//
// ⚠️ POR QUE NO SE COMPARA CONTRA `costosListadoOrden(...)` INVOCADA OTRA VEZ. Seria una asercion
// contra su propia fuente: cualquier cambio en la formula movería a la vez el valor esperado y el
// obtenido, y el test seguiria verde mientras la factura cambia. Los esperados de abajo estan
// calculados A MANO a partir de una tarifa sembrada, con la aritmetica escrita al lado, para que
// tocar la formula del cierre ponga ESTE archivo en rojo — que es exactamente lo que R12 pide:
// que el aviso y la factura no puedan divergir sin que nadie se entere.
//
// LA TARIFA SEMBRADA (los siete valores que entran en la formula):
//   valorFlete 2000.00 · valorFleteGam 1500.00 · comisionCod 5.50 % · ivaFlete 13.00 %
//   ivaComisionCod 13.00 % · tarifaEspecial segun el caso
// LA ORDEN:  montoCobrar 12345.00 · cobraComision true (salvo el ultimo caso)
//
// LA COMISION, IGUAL EN TODOS LOS CASOS QUE COBRAN COMISION:
//   comision      = round2(12345.00 × 5.50 / 100) = round2(678.975)  = 678.98   ← el redondeo
//   iva comision  = round2(678.98  × 13.00 / 100) = round2(88.2674)  =  88.27      INTERMEDIO
//   comision+IVA  = 678.98 + 88.27                                   = 767.25      es la clave
//
// Ese redondeo intermedio es justo el que el navegador NO hacia (feature 204: 14 de 66 ordenes con
// un centimo de desviacion). Un `12345 × 0.055 × 1.13` de una sola pasada da 767,2568 -> 767.26.

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const COMISION_CON_IVA = "767.25";

function tarifa(overrides: Partial<TarifaVigente> = {}): TarifaVigente {
  return {
    valorFlete: "2000.00",
    valorFleteGam: "1500.00",
    valorFleteDevuelto: "1000.00",
    valorFleteDevueltoGam: "800.00",
    comisionCod: "5.50",
    ivaFlete: "13.00",
    ivaComisionCod: "13.00",
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
    ...overrides,
  };
}

function orden(overrides: Partial<OrdenParaCorreccionRow> = {}): OrdenParaCorreccionRow {
  return {
    id: ORDEN_ID,
    tiendaId: "tienda-1",
    estatusValue: "en_reparto",
    numGuia: null,
    destinatario: "Ana Perez",
    telefonoDest: "8888-7777",
    producto: "caja",
    notas: null,
    direccion: "avenida siempre viva 742",
    peso: 1,
    montoCobrar: "12345.00",
    cobraComision: true,
    provinciaId: "p-1",
    cantonId: "c-1",
    distritoId: "d-1",
    distritoNombre: "Distrito Uno",
    zonaId: "z-1",
    zonaNombre: "Zona Uno",
    esCentral: false,
    esZonaEspecial: false,
    yaEnUnCierre: false,
    ...overrides,
  };
}

function distrito(overrides: Partial<DistritoResueltoRow> = {}): DistritoResueltoRow {
  return {
    id: "d-2",
    nombre: "Distrito Dos",
    cantonId: "c-1",
    provinciaId: "p-1",
    zonaId: "z-2",
    zonaNombre: "Zona Dos",
    esCentral: false,
    esZonaEspecial: false,
    ...overrides,
  };
}

/** Pide el aviso: cambia el distrito y NO confirma, que es lo que devuelve las dos columnas. */
async function avisoDe(opciones: {
  ordenFila?: Partial<OrdenParaCorreccionRow>;
  distritoFila?: Partial<DistritoResueltoRow>;
  tarifaFila?: TarifaVigente | null;
}) {
  const service = new CorregirDatosClienteService(
    {
      findParaCorreccion: vi.fn(async () => orden(opciones.ordenFila)),
      findDistritoParaCorreccion: vi.fn(async () => distrito(opciones.distritoFila)),
      corregirDatosCliente: vi.fn(async () => "ok" as const),
    },
    {
      resolveTarifa: vi.fn(async () =>
        opciones.tarifaFila === undefined ? tarifa() : opciones.tarifaFila,
      ),
    },
  );
  const r = await service.corregir(
    { ordenId: ORDEN_ID, provinciaId: "p-1", cantonId: "c-1", distritoId: "d-2" },
    MAESTRO,
  );
  if (r.status !== "confirmacion_requerida") {
    throw new Error(`se esperaba el aviso y llego \`${r.status}\`: el test mediria otra cosa`);
  }
  return r.aviso;
}

describe("327/C4 — R12: la zona elige la columna del flete (GAM vs estandar)", () => {
  it("zona NO central: flete 2000.00 + IVA 260.00 = 2260.00", async () => {
    //   flete      = valorFlete                       = 2000.00
    //   iva flete  = round2(2000.00 × 13.00 / 100)     =  260.00
    //   flete+IVA                                      = 2260.00
    const aviso = await avisoDe({ distritoFila: { esCentral: false } });

    expect(aviso.propuesta.fleteConIva).toBe("2260.00");
    expect(aviso.propuesta.comisionConIva).toBe(COMISION_CON_IVA);
    expect(aviso.propuesta.fleteOrigen).toBe("normal");
    expect(aviso.propuesta.esCentral).toBe(false);
  });

  it("zona CENTRAL: flete 1500.00 + IVA 195.00 = 1695.00", async () => {
    //   flete      = valorFleteGam                    = 1500.00
    //   iva flete  = round2(1500.00 × 13.00 / 100)    =  195.00
    //   flete+IVA                                      = 1695.00
    const aviso = await avisoDe({ distritoFila: { esCentral: true } });

    expect(aviso.propuesta.fleteConIva).toBe("1695.00");
    expect(aviso.propuesta.comisionConIva).toBe(COMISION_CON_IVA);
    expect(aviso.propuesta.esCentral).toBe(true);
  });

  it("las DOS columnas del aviso se calculan por separado: actual GAM, propuesta estandar", async () => {
    // Este es el caso que un aviso de una sola columna no podria contar: el importe SUBE.
    const aviso = await avisoDe({
      ordenFila: { esCentral: true },
      distritoFila: { esCentral: false },
    });

    expect(aviso.actual.fleteConIva).toBe("1695.00");
    expect(aviso.propuesta.fleteConIva).toBe("2260.00");
  });
});

describe("327/C4 — R12/R14: el distrito elige el pacto especial", () => {
  it("distrito especial CON pacto: 3333.33 + IVA 433.33 = 3766.66, origen `especial`", async () => {
    //   flete      = tarifaEspecial                        = 3333.33
    //   iva flete  = round2(3333.33 × 13.00 / 100)
    //              = round2(433.3329)                      =  433.33
    //   flete+IVA                                           = 3766.66
    const aviso = await avisoDe({
      distritoFila: { esZonaEspecial: true },
      tarifaFila: tarifa({ tarifaEspecial: "3333.33" }),
    });

    expect(aviso.propuesta.fleteConIva).toBe("3766.66");
    expect(aviso.propuesta.fleteOrigen).toBe("especial");
  });

  it("el pacto IGNORA la columna GAM: con `esCentral` y pacto, el flete es el pactado", async () => {
    // `tarifa_especial` es UN precio acordado para ese distrito, no una tabla con variante GAM.
    const aviso = await avisoDe({
      distritoFila: { esZonaEspecial: true, esCentral: true },
      tarifaFila: tarifa({ tarifaEspecial: "3333.33" }),
    });

    expect(aviso.propuesta.fleteConIva).toBe("3766.66");
  });

  it("distrito especial SIN pacto: cae a la columna normal, y el ORIGEN lo delata", async () => {
    // El importe es IDENTICO al de una orden corriente (2260.00): sin `fleteOrigen` no habria
    // forma de distinguir «cobra la normal porque le toca» de «falta configurar el pacto».
    const aviso = await avisoDe({
      distritoFila: { esZonaEspecial: true },
      tarifaFila: tarifa({ tarifaEspecial: null }),
    });

    expect(aviso.propuesta.fleteConIva).toBe("2260.00");
    expect(aviso.propuesta.fleteOrigen).toBe("especial_sin_pacto");
  });
});

describe("327/C4 — R12/R13: comision y ausencia de tarifa", () => {
  it("una orden que NO cobra comision: flete igual, comision 0.00", async () => {
    const aviso = await avisoDe({ ordenFila: { cobraComision: false } });

    expect(aviso.propuesta.fleteConIva).toBe("2260.00");
    expect(aviso.propuesta.comisionConIva).toBe("0.00");
    // Y el `0.00` de aqui SI es un cero de verdad: hay tarifa, la orden no cobra comision.
    expect(aviso.propuesta.tarifa).toBe("resuelta");
  });

  it("`montoCobrar` null: la comision es 0.00 y el flete no se mueve", async () => {
    const aviso = await avisoDe({ ordenFila: { montoCobrar: null } });

    expect(aviso.propuesta.fleteConIva).toBe("2260.00");
    expect(aviso.propuesta.comisionConIva).toBe("0.00");
  });

  it("R13 — sin tarifa: los importes son 0.00 PERO el discriminante dice `sin_tarifa`", async () => {
    const aviso = await avisoDe({ tarifaFila: null });

    expect(aviso.propuesta.tarifa).toBe("sin_tarifa");
    expect(aviso.propuesta.fleteConIva).toBe("0.00");
    expect(aviso.propuesta.comisionConIva).toBe("0.00");
    // La diferencia con el caso de arriba se ve aqui: mismo `0.00`, distinto significado. La
    // pantalla NO puede decidirlo por el numero.
    expect(aviso.propuesta.tarifa).not.toBe("resuelta");
  });
});
