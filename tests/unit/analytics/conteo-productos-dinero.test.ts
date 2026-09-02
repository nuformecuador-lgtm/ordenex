import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import {
  claveDeConteoProductos,
  prepararConsultaProductos,
} from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { descargaConfig } from "@/lib/config/descarga";
import type { FilaProductoCruda } from "@/lib/interfaces/repositories/IConteoProductosRepository";
import type { IConteoProductosRepository } from "@/lib/interfaces/repositories/IConteoProductosRepository";
import {
  claveDeGrupoProducto,
  ConteoProductosService,
  fundir,
  fundirDinero,
  ordenesQueAportan,
} from "@/lib/services/ConteoProductosService";
import { cacheFalsa } from "./_cache-falsa";
import { congelada, dineroFalso, filaDinero, TARIFA } from "./_dinero-falso";

// FICHA 347 / B4.2 + B4.4 — LA FUSION DEL DINERO Y SU LLEGADA A LA FILA.
// Cubre R5, R11, R12, R13, R16, R17, R18, R19, R20, R21, R22, R25, R28, R30, R76, R77, R78.
//
// Los numeros estan calculados a mano (ver `_dinero-falso.ts`): con la tarifa del fixture, una
// entrega liquidada de 10.000 deja `ordenex = 3.955,00` y `tienda = 6.045,00`.

const AHORA = new Date("2026-09-01T12:00:00.000Z");
const T1 = "t1";

function consultaDe(raw: object = {}, rol = "maestro", usuarioId = "u1"): ConsultaProductos {
  const preparada = prepararConsultaProductos(raw, { usuarioId, rol } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba invalido: ${preparada.status}`);
  return preparada.consulta;
}

function filaVolumen(
  producto: string,
  status = "entregada",
  n = 1,
  tiendaId = T1,
  tiendaNombre = "Tienda Uno",
): FilaProductoCruda {
  return { tiendaId, tiendaNombre, producto, status, n };
}

function repoVolumen(filas: FilaProductoCruda[]): IConteoProductosRepository & { llamadas: number } {
  return {
    llamadas: 0,
    async contarProductos() {
      this.llamadas += 1;
      return filas;
    },
  } as IConteoProductosRepository & { llamadas: number };
}

/** Las cifras de un grupo, o un fallo con motivo: NUNCA un `return` temprano silencioso. */
function grupo(filas: readonly ReturnType<typeof filaDinero>[], clave: string, tienda = T1) {
  const dto = fundirDinero(filas).get(claveDeGrupoProducto(tienda, clave));
  if (dto === undefined) throw new Error(`la entrada no produjo el grupo (${tienda}, ${clave})`);
  return dto;
}

describe("R11 / R14 / R15 / R20 · las cuatro cifras de una fila", () => {
  it("una entrega liquidada da recaudado, ordenex y tienda con los numeros de la tarifa", () => {
    const c = grupo([filaDinero()], "base c");

    expect(c.recaudado).toBe("10000.00");
    expect(c.liquidado.recaudado).toBe("10000.00");
    expect(c.liquidado.ordenex).toBe("3955.00");
    expect(c.liquidado.tienda).toBe("6045.00");
    expect(c.liquidado.ordenes).toBe(1);
    expect(c.pendiente.recaudado).toBe("0.00");
    expect(c.pendiente.ordenes).toBe(0);
    expect(c.retorno).toBe("0.00");
  });

  it("R20 · `ordenex + tienda === liquidado.recaudado` para TODAS las filas fundidas", () => {
    const filas = [
      filaDinero({ ordenId: "o1" }),
      filaDinero({ ordenId: "o2", montoRecibido: "7333.33", congelada: congelada({ montoCobrar: "7333.33" }) }),
      filaDinero({ ordenId: "o3", producto: "1 * Otro", montoRecibido: "0.01", congelada: congelada({ montoCobrar: "0.01" }) }),
    ];
    const fundidas = fundirDinero(filas);
    expect(fundidas.size).toBeGreaterThan(0);

    for (const [id, c] of fundidas) {
      if (c.liquidado.ordenex === null) continue;
      expect(
        new Prisma.Decimal(c.liquidado.ordenex).plus(c.liquidado.tienda!).toFixed(2),
        id,
      ).toBe(c.liquidado.recaudado);
    }
  });

  it("R21 · `liquidado + pendiente === recaudado` para TODAS las filas fundidas", () => {
    const filas = [
      filaDinero({ ordenId: "o1" }),
      filaDinero({ ordenId: "o2", cierreEstado: null, congelada: null, montoRecibido: "500.00" }),
    ];
    for (const [id, c] of fundirDinero(filas)) {
      expect(
        new Prisma.Decimal(c.liquidado.recaudado).plus(c.pendiente.recaudado).toFixed(2),
        id,
      ).toBe(c.recaudado);
    }
  });

  it("R22 · ningun importe es `number`: todos son STRING con dos decimales", () => {
    const c = grupo([filaDinero()], "base c");
    const importes = [
      c.recaudado,
      c.liquidado.recaudado,
      c.liquidado.ordenex,
      c.liquidado.tienda,
      c.pendiente.recaudado,
      c.retorno,
    ];
    for (const v of importes) {
      expect(typeof v).toBe("string");
      expect(v as string).toMatch(/^-?\d+\.\d{2}$/);
    }
    // Y los CARDINALES si son enteros: son conteos, no dinero.
    expect(Number.isSafeInteger(c.liquidado.ordenes)).toBe(true);
    expect(Number.isSafeInteger(c.pendiente.ordenes)).toBe(true);
  });
});

describe("R12 · el importe COMPLETO de la orden cuenta en CADA producto", () => {
  it("una orden multiproducto aporta ENTERA a los dos grupos", () => {
    const filas = [filaDinero({ producto: "1 * Base C. 1 * Dr Melaxin." })];
    const baseC = grupo(filas, "base c");
    const melaxin = grupo(filas, "dr melaxin");

    // La MISMA plata en los dos. No se reparte: se repite. Por eso la columna NO es sumable.
    expect(baseC.recaudado).toBe("10000.00");
    expect(melaxin.recaudado).toBe("10000.00");
    expect(baseC).toEqual(melaxin);
    // Y la orden cuenta UNA vez en cada grupo, no media.
    expect(baseC.liquidado.ordenes).toBe(1);
    expect(melaxin.liquidado.ordenes).toBe(1);
  });

  it("el mismo producto escrito dos veces en una orden NO la cuenta dos veces", () => {
    const c = grupo([filaDinero({ producto: "2 * Base C. 1 * base c." })], "base c");
    expect(c.recaudado).toBe("10000.00");
    expect(c.liquidado.ordenes).toBe(1);
  });
});

describe("R13 · las ordenes ACOMPANADAS, en el lado del volumen", () => {
  it("cuenta las ordenes con DOS O MAS productos distintos, y es aditiva", () => {
    const { filas } = fundir([
      filaVolumen("1 * Base C. 1 * Dr Melaxin.", "entregada", 3),
      filaVolumen("1 * Base C", "entregada", 5),
    ]);
    const baseC = filas.find((f) => f.producto === "Base C");
    const melaxin = filas.find((f) => f.producto === "Dr Melaxin");

    expect(baseC?.ordenes).toBe(8);
    expect(baseC?.ordenesAcompanadas).toBe(3);
    expect(melaxin?.ordenes).toBe(3);
    expect(melaxin?.ordenesAcompanadas).toBe(3);
  });

  it("el mismo producto repetido en una orden NO la hace acompanada", () => {
    const { filas } = fundir([filaVolumen("2 * Base C. 1 * base c.", "entregada", 4)]);
    expect(filas[0].ordenesAcompanadas).toBe(0);
    expect(filas[0].ordenes).toBe(4);
  });

  it("nunca supera a `ordenes`", () => {
    const { filas } = fundir([
      filaVolumen("1 * A. 1 * B.", "entregada", 2),
      filaVolumen("1 * A", "rechazada", 7),
    ]);
    for (const f of filas) expect(f.ordenesAcompanadas).toBeLessThanOrEqual(f.ordenes);
  });
});

describe("R18 · ⚠ MUTACION M10 · una orden en DOS cierres cuenta UNA vez", () => {
  it("sus aportes se SUMAN y el cardinal NO se dobla", () => {
    const otraTarifa = { ...TARIFA, valorFlete: "1000.00", comisionCod: "0.00" };
    const c = grupo(
      [
        filaDinero({ ordenId: "o1", gestionId: "g1" }),
        filaDinero({
          ordenId: "o1",
          gestionId: "g2",
          montoRecibido: "5000.00",
          congelada: congelada({ montoCobrar: "5000.00", tarifa: otraTarifa }),
        }),
      ],
      "base c",
    );

    expect(c.recaudado).toBe("15000.00");
    expect(c.liquidado.ordenex).toBe("5085.00"); // 3.955 + (1.000 + 130)
    // ⚠ SI LA ORDEN CONTARA DOS VECES (mutacion M10), esto valdria 2.
    expect(c.liquidado.ordenes).toBe(1);
    expect(c.pendiente.ordenes).toBe(0);
  });

  it("y `ordenesQueAportan` la devuelve como UNA sola entrada, con sus dos gestiones", () => {
    const ordenes = ordenesQueAportan([
      filaDinero({ ordenId: "o1", gestionId: "g1" }),
      filaDinero({ ordenId: "o1", gestionId: "g2", montoRecibido: "5000.00" }),
    ]);
    expect(ordenes).toHaveLength(1);
    expect(ordenes[0].gestiones).toHaveLength(2);
  });
});

describe("R19 · ⚠ MUTACION M3 · el retorno NO entra en el reparto", () => {
  it("una rechazada liquidada suma `retorno` y deja `ordenex` intacto", () => {
    const c = grupo(
      [
        filaDinero({ ordenId: "o1" }),
        filaDinero({ ordenId: "o2", resultado: "rechazada", montoRecibido: null }),
      ],
      "base c",
    );

    expect(c.retorno).toBe("2260.00");
    expect(c.liquidado.ordenex).toBe("3955.00");
    // ⚠ SI EL RETORNO ENTRARA EN `ordenex` (M3), valdria 6.215,00 y esta igualdad se rompe.
    expect(new Prisma.Decimal(c.liquidado.ordenex!).plus(c.liquidado.tienda!).toFixed(2)).toBe(
      c.liquidado.recaudado,
    );
    expect(c.liquidado.recaudado).toBe("10000.00");
  });
});

describe("R26 / R28 / R30 · ⚠ MUTACIONES M1 y M6 · liquidado, pendiente y el dato ausente", () => {
  it("⚠ M1 · un cierre NO aprobado deja el dinero en PENDIENTE", () => {
    for (const estado of ["solicitado", "rechazado", "vencido"]) {
      const c = grupo([filaDinero({ cierreEstado: estado })], "base c");
      expect(c.pendiente.recaudado, estado).toBe("10000.00");
      expect(c.liquidado.recaudado, estado).toBe("0.00");
      // ⚠ SI SE QUITARA `estado = 'aprobado'` del criterio (M1), aqui entrarian 3.955,00 de un
      // cierre que todavia nadie aprobo.
      expect(c.liquidado.ordenex, estado).toBeNull();
      expect(c.liquidado.ordenes, estado).toBe(0);
      expect(c.pendiente.ordenes, estado).toBe(1);
    }
  });

  it("⚠ M6 · sin nada liquidado el reparto es `null`, NUNCA `\"0.00\"`", () => {
    const c = grupo([filaDinero({ cierreEstado: null, congelada: null })], "base c");

    expect(c.liquidado.ordenex).toBeNull();
    expect(c.liquidado.tienda).toBeNull();
    expect(c.retorno).toBeNull();
    // Y no hay ningun `"0.00"` disfrazado en el reparto: se comprueba sobre el JSON, que es lo
    // que de verdad cruza la frontera.
    expect(JSON.stringify({ o: c.liquidado.ordenex, t: c.liquidado.tienda, r: c.retorno })).toBe(
      '{"o":null,"t":null,"r":null}',
    );
    // El recaudo SI existe: es un hecho desde que se registro la gestion (R28).
    expect(c.recaudado).toBe("10000.00");
  });

  it("una fila con parte liquidada y parte pendiente reparte solo lo liquidado", () => {
    const c = grupo(
      [
        filaDinero({ ordenId: "o1" }),
        filaDinero({ ordenId: "o2", cierreEstado: null, congelada: null, montoRecibido: "2000.00" }),
      ],
      "base c",
    );

    expect(c.recaudado).toBe("12000.00");
    expect(c.liquidado.recaudado).toBe("10000.00");
    expect(c.pendiente.recaudado).toBe("2000.00");
    expect(c.liquidado.ordenes).toBe(1);
    expect(c.pendiente.ordenes).toBe(1);
    // El reparto es SOLO de lo liquidado: no se proyecta lo pendiente (R31).
    expect(c.liquidado.ordenex).toBe("3955.00");
  });
});

describe("R39 · las ordenes que no aportan nada no entran ni en las cifras ni en los cardinales", () => {
  it("una entrega sin recaudo y sin cierre no genera grupo", () => {
    const fundidas = fundirDinero([
      filaDinero({ montoRecibido: null, cierreEstado: null, congelada: null }),
    ]);
    expect(fundidas.size).toBe(0);
  });

  it("y no infla el cardinal de un grupo que si tiene aportes", () => {
    const c = grupo(
      [
        filaDinero({ ordenId: "o1" }),
        filaDinero({ ordenId: "o2", montoRecibido: null, cierreEstado: null, congelada: null }),
      ],
      "base c",
    );
    // ⚠ Es la propiedad que hace que aflojar el `WHERE` duela en el test de cuadre: una orden de
    // mas subiria el cardinal aunque su aporte fuese cero.
    expect(c.liquidado.ordenes + c.pendiente.ordenes).toBe(1);
  });

  it("una orden cuyo texto no produce ningun producto no cuelga su dinero de ningun grupo", () => {
    // Un texto en blanco no da item: en el VOLUMEN cae en `ordenesSinProducto`, y aqui su dinero
    // se queda fuera por el mismo motivo — no hay fila donde pintarlo, y no se inventa un
    // producto «(sin nombre)» para colgarle plata.
    expect(fundirDinero([filaDinero({ producto: "   " })]).size).toBe(0);
    // Y un texto SIN marcador de cantidad SI produce producto (`PRUEBA` es un caso real medido
    // en produccion): su dinero cuelga de el, que es lo correcto.
    expect(fundirDinero([filaDinero({ producto: "PRUEBA" })]).size).toBe(1);
  });
});

describe("R25 · determinismo", () => {
  it("la misma entrada produce el mismo mapa, y el orden de las filas no cambia nada", () => {
    const filas = [
      filaDinero({ ordenId: "o1" }),
      filaDinero({ ordenId: "o2", producto: "1 * Otro", montoRecibido: "300.00" }),
    ];
    expect([...fundirDinero(filas)]).toEqual([...fundirDinero(filas)]);
    const alReves = fundirDinero([...filas].reverse());
    for (const [id, c] of fundirDinero(filas)) expect(alReves.get(id)).toEqual(c);
  });
});

describe("R5 · con el dinero DENEGADO, el repositorio de dinero NO se llama ni una vez", () => {
  it("cuenta las llamadas: cero", async () => {
    const dinero = dineroFalso([filaDinero()]);
    const service = new ConteoProductosService(
      repoVolumen([filaVolumen("1 * Base C")]),
      cacheFalsa(),
      dinero,
      { now: () => AHORA },
    );

    const consulta = { ...consultaDe(), dinero: "denegado" } as ConsultaProductos;
    const datos = await service.consultar(consulta);

    // ⚠ No es una optimizacion: es R5. Un `SELECT` que se lanza para tirar el resultado ya
    // habria leido el dinero.
    expect(dinero.llamadas).toBe(0);
    expect(datos.dinero).toEqual({ estado: "denegado" });
    for (const f of datos.filas) expect(f.dinero).toBeNull();
    // Y no queda NINGUNA cifra en el payload: ni recortada, ni agregada, ni en cero.
    expect(JSON.stringify(datos)).not.toContain("3955");
    expect(JSON.stringify(datos)).not.toContain("10000.00");
  });

  it("con el dinero concedido si se llama, exactamente UNA vez por lectura", async () => {
    const dinero = dineroFalso([filaDinero()]);
    const service = new ConteoProductosService(
      repoVolumen([filaVolumen("1 * Base C")]),
      cacheFalsa(),
      dinero,
      { now: () => AHORA },
    );

    const datos = await service.consultar(consultaDe());

    expect(dinero.llamadas).toBe(1);
    expect(datos.dinero).toEqual({ estado: "concedido" });
    expect(datos.filas[0].dinero?.recaudado).toBe("10000.00");
    expect(datos.filas[0].dinero?.liquidado.ordenex).toBe("3955.00");
  });
});

describe("R78 · UNA sola lectura: volumen y dinero en la misma fila y el mismo instante", () => {
  it("las cifras de dinero se adosan a la fila de volumen que YA tiene esa clave", async () => {
    const service = new ConteoProductosService(
      repoVolumen([filaVolumen("1 * Base C", "entregada", 6)]),
      cacheFalsa(),
      dineroFalso([
        filaDinero({ ordenId: "o1" }),
        filaDinero({ ordenId: "o2", montoRecibido: "1000.00", congelada: congelada({ montoCobrar: "1000.00" }) }),
      ]),
      { now: () => AHORA },
    );

    const datos = await service.consultar(consultaDe());

    expect(datos.filas).toHaveLength(1);
    // El conteo y el importe salen del MISMO corte: no hay dos lecturas que puedan resolverse en
    // instantes distintos y dejar «6 entregadas» junto al recaudo de 5.
    expect(datos.filas[0].ordenes).toBe(6);
    expect(datos.filas[0].dinero?.recaudado).toBe("11000.00");
    expect(datos.filas[0].dinero?.liquidado.ordenes).toBe(2);
  });

  it("hay UN solo `lastSync`, sellado dentro del productor, para las dos consultas", async () => {
    const cache = cacheFalsa();
    let ahora = new Date("2026-09-01T12:00:00.000Z");
    const service = new ConteoProductosService(
      repoVolumen([filaVolumen("1 * Base C")]),
      cache,
      dineroFalso([filaDinero()]),
      { now: () => ahora },
    );

    const primera = await service.consultar(consultaDe());
    ahora = new Date("2026-09-01T12:10:00.000Z");
    const segunda = await service.consultar(consultaDe());

    expect(primera.lastSync).toBe("2026-09-01T12:00:00.000Z");
    expect(segunda.lastSync).toBe("2026-09-01T12:00:00.000Z");
    // Y una sola entrada de cache para las dos consultas.
    expect(cache.claves).toEqual([claveDeConteoProductos(consultaDe())]);
  });

  it("una fila de volumen SIN dinero se queda con `null`, no desaparece", async () => {
    const service = new ConteoProductosService(
      repoVolumen([filaVolumen("1 * Base C"), filaVolumen("1 * Sin Ventas", "en_reparto", 2)]),
      cacheFalsa(),
      dineroFalso([filaDinero()]),
      { now: () => AHORA },
    );

    const datos = await service.consultar(consultaDe());
    const sinVentas = datos.filas.find((f) => f.producto === "Sin Ventas");

    expect(sinVentas).toBeDefined();
    expect(sinVentas?.ordenes).toBe(2);
    expect(sinVentas?.dinero).toBeNull();
  });
});

describe("R76 · el tope: o van todas las ordenes, o no va ninguna", () => {
  it("`limite_excedido` apaga TODAS las cifras y deja el volumen intacto", async () => {
    const service = new ConteoProductosService(
      repoVolumen([filaVolumen("1 * Base C", "entregada", 9)]),
      cacheFalsa(),
      dineroFalso([], { estado: "limite_excedido", limite: descargaConfig.MAX_FILAS }),
      { now: () => AHORA },
    );

    const datos = await service.consultar(consultaDe());

    expect(datos.dinero).toEqual({
      estado: "limite_excedido",
      limite: descargaConfig.MAX_FILAS,
    });
    // ⚠ Ni una cifra parcial: una suma sobre un conjunto truncado NO se ve incompleta.
    for (const f of datos.filas) expect(f.dinero).toBeNull();
    // Y el VOLUMEN sigue: el tope es de la lectura de dinero, no de la de productos.
    expect(datos.filas[0].ordenes).toBe(9);
    expect(datos.filas[0].unidades).toBe(9);
  });
});
