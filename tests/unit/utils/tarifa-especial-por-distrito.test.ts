import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  derivarIngresoOrden,
  resolverFlete,
  costoEnvioDeTarifa,
  costosListadoOrden,
} from "@/lib/utils/ingreso-ordenex";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar } from "@/lib/utils/cascada-tarifa";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

/**
 * TARIFA ESPECIAL POR DISTRITO (2026-08-25) — sucede a
 * `tests/unit/utils/alcance-dinero-sin-especiales.test.ts`, que este archivo BORRA.
 *
 * Aquel guardaba la decision contraria: la feature 274 declaro en su R40 que
 * `tarifas.tarifa_especial` y `distrito.zona_especial` existian en la base y NO tocaban ni un
 * centimo, y dejo aserciones de ejecucion para que nadie las conectara "ya que estamos". El
 * motivo era explicito y sigue siendo bueno: conectarlas cambia lo que se factura, y eso es
 * una decision de producto, no un efecto colateral. Esa decision ya se tomo. El guardian no se
 * relaja —se INVIERTE—: los mismos importes que antes se comprobaba que NO se movian, ahora se
 * comprueba que se mueven EXACTAMENTE donde deben y en ningun otro sitio.
 *
 * La regla bajo prueba, entera:
 *
 *   distrito especial + pacto   -> el flete ES el pacto (y el IVA se calcula sobre el pacto)
 *   distrito especial sin pacto -> flete NORMAL, pero el origen queda MARCADO
 *   distrito no especial        -> flete NORMAL, aunque la tarifa traiga pacto
 *
 * Entrega y devolucion se deciden por separado, y la comision COD nunca cambia.
 */

// Tarifa SIN ningun pacto: el estado de todas las filas anteriores a esta feature.
const SIN_PACTO: TarifaVigente = {
  valorFlete: "1000.00",
  valorFleteGam: "800.00",
  valorFleteDevuelto: "500.00",
  valorFleteDevueltoGam: "400.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

// La MISMA tarifa con los dos pactos. Montos deliberadamente lejos de los normales: si un
// camino se olvidara de aplicarlos, no habria forma de que el numero coincidiera por azar.
const CON_PACTO: TarifaVigente = {
  ...SIN_PACTO,
  tarifaEspecial: "2500.00",
  tarifaEspecialDevuelta: "1200.00",
};

const ORDEN = {
  montoCobrar: "25000.00",
  cobraComision: true,
};

describe("resolverFlete — la tabla de verdad completa", () => {
  it("distrito NO especial: columna normal, aunque la tarifa traiga los dos pactos", () => {
    const r = resolverFlete(CON_PACTO, { esCentral: false, esZonaEspecial: false });
    expect(r.flete.toFixed(2)).toBe("1000.00");
    expect(r.fleteDevuelto.toFixed(2)).toBe("500.00");
    expect(r.origen).toBe("normal");
    expect(r.origenDevuelto).toBe("normal");
  });

  it("distrito NO especial + zona central: sigue mandando la variante GAM", () => {
    const r = resolverFlete(CON_PACTO, { esCentral: true, esZonaEspecial: false });
    expect(r.flete.toFixed(2)).toBe("800.00");
    expect(r.fleteDevuelto.toFixed(2)).toBe("400.00");
  });

  it("distrito especial + pacto: manda el pacto en los dos conceptos", () => {
    const r = resolverFlete(CON_PACTO, { esCentral: false, esZonaEspecial: true });
    expect(r.flete.toFixed(2)).toBe("2500.00");
    expect(r.fleteDevuelto.toFixed(2)).toBe("1200.00");
    expect(r.origen).toBe("especial");
    expect(r.origenDevuelto).toBe("especial");
  });

  it("el pacto IGNORA `esCentral`: es UN precio, no una tabla con variante GAM", () => {
    const estandar = resolverFlete(CON_PACTO, { esCentral: false, esZonaEspecial: true });
    const central = resolverFlete(CON_PACTO, { esCentral: true, esZonaEspecial: true });
    expect(central.flete.toFixed(2)).toBe(estandar.flete.toFixed(2));
    expect(central.fleteDevuelto.toFixed(2)).toBe(estandar.fleteDevuelto.toFixed(2));
  });

  it("distrito especial SIN pacto: cae a la columna normal, pero el origen lo DICE", () => {
    const r = resolverFlete(SIN_PACTO, { esCentral: false, esZonaEspecial: true });
    // El importe es el mismo que el de una orden corriente...
    expect(r.flete.toFixed(2)).toBe("1000.00");
    expect(r.fleteDevuelto.toFixed(2)).toBe("500.00");
    // ...y por eso el origen es lo UNICO que distingue el hueco de configuracion.
    expect(r.origen).toBe("especial_sin_pacto");
    expect(r.origenDevuelto).toBe("especial_sin_pacto");
  });

  it("los dos pactos son INDEPENDIENTES: se puede pactar solo uno", () => {
    const soloEntrega: TarifaVigente = { ...SIN_PACTO, tarifaEspecial: "2500.00" };
    const r = resolverFlete(soloEntrega, { esCentral: false, esZonaEspecial: true });
    expect(r.flete.toFixed(2)).toBe("2500.00");
    expect(r.origen).toBe("especial");
    expect(r.fleteDevuelto.toFixed(2)).toBe("500.00");
    expect(r.origenDevuelto).toBe("especial_sin_pacto");
  });

  it("un pacto de CERO es un pacto, no una ausencia", () => {
    // Es la distincion que la columna nullable existe para preservar: 0.00 significa "se
    // acordo no cobrar flete", y eso NO es lo mismo que "no se acordo nada".
    const gratis: TarifaVigente = { ...SIN_PACTO, tarifaEspecial: "0.00" };
    const r = resolverFlete(gratis, { esCentral: false, esZonaEspecial: true });
    expect(r.flete.toFixed(2)).toBe("0.00");
    expect(r.origen).toBe("especial");
  });
});

describe("derivarIngresoOrden — el pacto es la BASE, el IVA se calcula sobre el", () => {
  it("entregada en distrito especial: flete = pacto, IVA = 13% del pacto", () => {
    const d = derivarIngresoOrden(
      { ...ORDEN, resultado: "entregada", esCentral: false, esZonaEspecial: true },
      CON_PACTO,
    );
    expect(d.ingreso_flete?.toFixed(2)).toBe("2500.00");
    expect(d.ingreso_iva_flete?.toFixed(2)).toBe("325.00"); // 2500 * 13%
  });

  it("y la comision COD no se entera: lo especial es el FLETE, no la factura", () => {
    const normal = derivarIngresoOrden(
      { ...ORDEN, resultado: "entregada", esCentral: false, esZonaEspecial: false },
      CON_PACTO,
    );
    const especial = derivarIngresoOrden(
      { ...ORDEN, resultado: "entregada", esCentral: false, esZonaEspecial: true },
      CON_PACTO,
    );
    expect(especial.ingreso_comision_cod?.toFixed(2)).toBe(
      normal.ingreso_comision_cod?.toFixed(2),
    );
    expect(especial.ingreso_iva_comision_cod?.toFixed(2)).toBe(
      normal.ingreso_iva_comision_cod?.toFixed(2),
    );
    expect(normal.ingreso_comision_cod?.toFixed(2)).toBe("1250.00"); // 5% de 25.000
  });

  it("rechazada en distrito especial: usa el pacto de DEVOLUCION, no el de entrega", () => {
    const d = derivarIngresoOrden(
      { ...ORDEN, resultado: "rechazada", esCentral: false, esZonaEspecial: true },
      CON_PACTO,
    );
    expect(d.ingreso_flete_devolucion?.toFixed(2)).toBe("1200.00");
    expect(d.ingreso_iva_flete_devolucion?.toFixed(2)).toBe("156.00"); // 1200 * 13%
    // Y NO el de entrega, que es el error facil de cometer con dos columnas parecidas.
    expect(d.ingreso_flete_devolucion?.toFixed(2)).not.toBe("2500.00");
  });

  it("ficha 301: el pacto de devolucion NO se aplica a una devuelta (no cobra nada)", () => {
    // Hasta el 2026-08-28 este caso emitia los mismos 1.200,00 + 156,00 que el rechazo. El
    // pacto especial sigue existiendo y sigue eligiendose bien; lo que ya no ocurre es que una
    // devuelta llegue a usarlo, porque no deriva ningun concepto.
    const d = derivarIngresoOrden(
      { ...ORDEN, resultado: "devuelta", esCentral: false, esZonaEspecial: true },
      CON_PACTO,
    );
    expect(d).toEqual({});
    // `resolverFlete` (el que ELIGE el monto) no se toco: el pacto de devolucion sigue ahi.
    expect(resolverFlete(CON_PACTO, { esCentral: false, esZonaEspecial: true }).fleteDevuelto.toFixed(2)).toBe(
      "1200.00",
    );
  });

  it("distrito especial SIN pacto: el importe es el de siempre (no bloquea, no cobra 0)", () => {
    const sin = derivarIngresoOrden(
      { ...ORDEN, resultado: "entregada", esCentral: false, esZonaEspecial: true },
      SIN_PACTO,
    );
    const normal = derivarIngresoOrden(
      { ...ORDEN, resultado: "entregada", esCentral: false, esZonaEspecial: false },
      SIN_PACTO,
    );
    expect(sin).toEqual(normal);
    expect(sin.ingreso_flete?.toFixed(2)).toBe("1000.00");
  });

  it("sin tarifa vigente el gap R9 se preserva: ningun concepto, sin lanzar", () => {
    const d = derivarIngresoOrden(
      { ...ORDEN, resultado: "entregada", esCentral: false, esZonaEspecial: true },
      null,
    );
    expect(d).toEqual({});
  });

  it("`IngresoOrdenDerivado` sigue conteniendo SOLO montos", () => {
    // No es cosmetico: `CierresAdminRepository` suma con `Object.values(derivado)` y
    // `WalletTiendaFeedService` recorre sus claves. Un `origen` colado ahi dentro entraria en
    // una suma de dinero como si fuera un importe.
    const d = derivarIngresoOrden(
      { ...ORDEN, resultado: "entregada", esCentral: false, esZonaEspecial: true },
      CON_PACTO,
    );
    for (const v of Object.values(d)) expect(v).toBeInstanceOf(Prisma.Decimal);
  });
});

describe("las superficies derivadas cobran lo MISMO que la formula", () => {
  it("costoEnvioDeTarifa (carga y cotizacion por API) aplica el pacto", () => {
    // 2500 + 13% = 2825.00
    expect(costoEnvioDeTarifa(CON_PACTO, false, true)).toBe("2825.00");
    // Sin la marca del distrito, la tarifa normal: 1000 + 13% = 1130.00
    expect(costoEnvioDeTarifa(CON_PACTO, false, false)).toBe("1130.00");
    // Con la marca pero sin pacto, tambien la normal.
    expect(costoEnvioDeTarifa(SIN_PACTO, false, true)).toBe("1130.00");
    // Y el gap sin tarifa sigue siendo "0.00", no un error.
    expect(costoEnvioDeTarifa(null, false, true)).toBe("0.00");
  });

  it("costosListadoOrden pinta el mismo flete y ADEMAS delata el hueco", () => {
    const conPacto = costosListadoOrden(CON_PACTO, {
      ...ORDEN,
      esCentral: false,
      esZonaEspecial: true,
    });
    expect(conPacto.fleteConIva).toBe("2825.00");
    expect(conPacto.fleteOrigen).toBe("especial");

    const sinPacto = costosListadoOrden(SIN_PACTO, {
      ...ORDEN,
      esCentral: false,
      esZonaEspecial: true,
    });
    // Mismo importe que una orden corriente...
    expect(sinPacto.fleteConIva).toBe("1130.00");
    // ...y el unico rastro del hueco.
    expect(sinPacto.fleteOrigen).toBe("especial_sin_pacto");

    // Sin tarifa NINGUNA no hay pacto que faltar: no se marca nada.
    expect(
      costosListadoOrden(null, { ...ORDEN, esCentral: false, esZonaEspecial: true }),
    ).toEqual({ fleteConIva: "0.00", comisionConIva: "0.00", fleteOrigen: "normal" });
  });
});

describe("el resolver del DINERO trae las dos columnas del pacto", () => {
  const filaCompleta = {
    id: "ta-1",
    tiendaId: "t1",
    zonaId: "z1",
    valorFlete: new Prisma.Decimal("1000.00"),
    valorFleteGam: new Prisma.Decimal("800.00"),
    valorFleteDevuelto: new Prisma.Decimal("500.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("400.00"),
    fulfillment: new Prisma.Decimal("1.00"),
    comisionCod: new Prisma.Decimal("5.00"),
    ivaFlete: new Prisma.Decimal("13.00"),
    ivaComisionCod: new Prisma.Decimal("13.00"),
    tarifaEspecial: new Prisma.Decimal("2500.00"),
    tarifaEspecialDevuelta: new Prisma.Decimal("1200.00"),
    isDefault: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  async function resolver(fila: Record<string, unknown>) {
    const findMany = vi.fn(async () => [fila]);
    const repo = new TarifaVigenteRepository({ tarifa: { findMany } } as unknown as PrismaClient);
    const par = { tiendaId: "t1", zonaId: "z1" };
    const resueltas = await repo.resolveTarifas([par]);
    return {
      select: (findMany.mock.calls[0] as unknown as [{ select: Record<string, boolean> }])[0]
        .select,
      resuelta: resueltas.get(clavePar(par)),
    };
  }

  it("las pide en el SELECT y las propaga ya como STRING escala 2", async () => {
    const { select, resuelta } = await resolver(filaCompleta);
    expect(Object.keys(select).sort()).toEqual([
      "comisionCod",
      "fulfillment",
      "id",
      "ivaComisionCod",
      "ivaFlete",
      "tarifaEspecial",
      "tarifaEspecialDevuelta",
      "tiendaId",
      "valorFlete",
      "valorFleteDevuelto",
      "valorFleteDevueltoGam",
      "valorFleteGam",
      "zonaId",
    ]);
    expect(resuelta?.tarifaEspecial).toBe("2500.00");
    expect(resuelta?.tarifaEspecialDevuelta).toBe("1200.00");
  });

  it("una fila sin pacto propaga null, no un cero", async () => {
    const { resuelta } = await resolver({
      ...filaCompleta,
      tarifaEspecial: null,
      tarifaEspecialDevuelta: null,
    });
    expect(resuelta?.tarifaEspecial).toBeNull();
    expect(resuelta?.tarifaEspecialDevuelta).toBeNull();
  });
});

describe("el LISTADO cobra el pacto y senala el hueco", () => {
  function ordenListRow(zonaEspecial: boolean | null) {
    return {
      id: "ord-1",
      numGuia: 10,
      numRemision: "REM-1",
      estatusId: idEstado("en_bodega_central"),
      destinatario: "Ana",
      telefonoDest: "0991234567",
      tiendaId: "t1",
      zonaId: "z1",
      provinciaId: "p1",
      cantonId: "c1",
      distritoId: "d1",
      producto: "Caja",
      peso: new Prisma.Decimal("1.500"),
      notas: null,
      deletedAt: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      mensajeroAsignadoId: null,
      prioridad: false,
      estatus: { id: idEstado("en_bodega_central"), value: "en_bodega_central" },
      tienda: { id: "t1", nombre: "Tienda X", email: "t@x.co", telefono: "0990000001" },
      zona: { id: "z1", nombre: "Limon", esCentral: false },
      provincia: { id: "p1", nombre: "Limon" },
      canton: { id: "c1", nombre: "Central" },
      distrito: { id: "d1", nombre: "Matama", zonaEspecial },
      mensajeroAsignado: null,
      gestiones: [],
      montoCobrar: new Prisma.Decimal("25000.00"),
      cobraComision: true,
    };
  }

  async function listar(zonaEspecial: boolean | null, tarifaEspecial: Prisma.Decimal | null) {
    const prisma = {
      orden: {
        findMany: vi.fn(async () => [ordenListRow(zonaEspecial)]),
        count: vi.fn(async () => 1),
      },
      tarifa: {
        findMany: vi.fn(async () => [
          {
            id: "ta-1",
            tiendaId: "t1",
            zonaId: "z1",
            valorFlete: new Prisma.Decimal("1000.00"),
            valorFleteGam: new Prisma.Decimal("800.00"),
            valorFleteDevuelto: new Prisma.Decimal("500.00"),
            valorFleteDevueltoGam: new Prisma.Decimal("400.00"),
            fulfillment: new Prisma.Decimal("1.00"),
            comisionCod: new Prisma.Decimal("5.00"),
            ivaFlete: new Prisma.Decimal("13.00"),
            ivaComisionCod: new Prisma.Decimal("13.00"),
            tarifaEspecial,
            tarifaEspecialDevuelta: null,
            isDefault: false,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
          },
        ]),
      },
    };
    const res = await new OrdenRepository(prisma as unknown as PrismaClient).list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 50,
    });
    return res.items[0];
  }

  it("distrito especial con pacto: la columna de dinero SI se mueve", async () => {
    await sembrarCatalogoEstados();
    const normal = await listar(false, new Prisma.Decimal("2500.00"));
    const especial = await listar(true, new Prisma.Decimal("2500.00"));

    expect(normal.fleteConIva).toBe("1130.00");
    expect(normal.fleteOrigen).toBe("normal");
    expect(especial.fleteConIva).toBe("2825.00");
    expect(especial.fleteOrigen).toBe("especial");
    // La comision no se mueve en ningun caso.
    expect(especial.comisionConIva).toBe(normal.comisionConIva);
  });

  it("zona_especial NULL no es especial: la columna es tri-valuada", async () => {
    await sembrarCatalogoEstados();
    // `null` = "nadie lo decidio", que NO es lo mismo que "es especial". Si el codigo leyera
    // la columna con un `!!` o un `!== false`, este caso cobraria el pacto sin que nadie lo
    // haya marcado.
    const sinDecidir = await listar(null, new Prisma.Decimal("2500.00"));
    expect(sinDecidir.fleteConIva).toBe("1130.00");
    expect(sinDecidir.fleteOrigen).toBe("normal");
  });

  it("distrito especial sin pacto: mismo importe, pero marcado", async () => {
    await sembrarCatalogoEstados();
    const fila = await listar(true, null);
    expect(fila.fleteConIva).toBe("1130.00");
    expect(fila.fleteOrigen).toBe("especial_sin_pacto");
  });
});

describe("el SNAPSHOT del cierre congela las entradas nuevas", () => {
  const RAIZ = path.join(__dirname, "..", "..", "..");

  it("`cierre_detail` tiene las tres columnas nuevas", () => {
    // Sin esto, un cierre de hace un ano se re-derivaria con la tarifa y la marca de HOY, que
    // es el descuadre invisible que el snapshot existe para impedir. El assert mira el schema
    // porque es la unica forma de comprobar que la columna EXISTE, no solo que el TS la cita.
    const schema = fs.readFileSync(path.join(RAIZ, "db", "schema.prisma"), "utf8");
    for (const col of ["es_zona_especial", "tarifa_especial", "tarifa_especial_devuelta"]) {
      expect(schema).toContain(`@map("${col}")`);
    }
  });

  it("la proyeccion compartida del snapshot las pide", () => {
    // `DETALLE_SELECT` es lo que leen los DOS feeds de wallet (caja y ledger por tienda). Si
    // una entrada de la formula no esta ahi, los dos liquidan con datos incompletos a la vez.
    const fuente = fs.readFileSync(path.join(RAIZ, "lib", "utils", "cierre-detalle.ts"), "utf8");
    for (const campo of ["esZonaEspecial", "tarifaEspecial", "tarifaEspecialDevuelta"]) {
      expect(fuente).toContain(`${campo}: true`);
    }
  });
});
