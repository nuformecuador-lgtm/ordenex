import { describe, expect, it, vi } from "vitest";

import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigente,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { CotizadorService } from "@/lib/services/CotizadorService";
import type {
  CotizacionApiEntrada,
  CotizacionConCostos,
  ResultadoCobertura,
} from "@/lib/types/cotizador";
import { cotizacionApiSchema } from "@/lib/types/cotizador";
import { pagoTiendaOrdenex } from "@/lib/utils/ingreso-ordenex";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// Feature 248 (T5, bloque C) — el COTIZADOR del canal por API key, con dobles: sin Prisma, sin
// HTTP y sin `next/headers`. Todo lo que se afirma aqui es aritmetica de `ingreso-ordenex`
// COMPUESTA, nunca reimplementada (R23; su guardia estatica vive aparte).
//
// R21 — `pagoTiendaOrdenex` se ESPIA conservando la implementacion real (`importOriginal`), para
// poder afirmar que la rama del escenario DEVUELTA no lo llama sin falsear ningun importe.
// `vi.mock` se iza sobre los imports, asi que el espia ya esta puesto cuando el service carga.
vi.mock("@/lib/utils/ingreso-ordenex", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/utils/ingreso-ordenex")>();
  return { ...real, pagoTiendaOrdenex: vi.fn(real.pagoTiendaOrdenex) };
});

const espiaPagoTienda = vi.mocked(pagoTiendaOrdenex);

/**
 * Tarifa de los ejemplos del design (§4.2): flete GAM 2200,00 al 13 % de IVA -> 286,00;
 * comision COD 3,50 % y su IVA al 13 %; flete de devolucion GAM 1500,00 -> IVA 195,00.
 */
const TARIFA: TarifaVigente = {
  valorFlete: "2000.00",
  valorFleteGam: "2200.00",
  valorFleteDevuelto: "1400.00",
  valorFleteDevueltoGam: "1500.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

const ACTOR: Actor = { usuarioId: "tienda-de-la-key", rol: "apiKey" };

const CUBIERTO: ResultadoCobertura = {
  estado: "cubierto",
  distritoId: "d1",
  zonaId: "z1",
  zonaNombre: "GAM",
  esCentral: true,
};

function coberturaFake(resultado: ResultadoCobertura = CUBIERTO): ICoberturaService {
  return { consultar: vi.fn().mockResolvedValue(resultado) };
}

function tarifasFake(tarifa: TarifaVigente | null = TARIFA): ITarifaVigentePorTiendaRepository {
  return {
    resolveTarifaPorTienda: vi.fn().mockResolvedValue(tarifa),
    resolveTarifasPorTiendas: vi.fn(),
  };
}

/** Entrada YA validada por el schema del borde (defaults resueltos). */
function entrada(over: Partial<CotizacionApiEntrada> = {}): CotizacionApiEntrada {
  return {
    provincia: "San José",
    canton: "Central",
    distrito: "Carmen",
    monto_cobrar: "25000.00",
    cantidad: 1,
    cobra_comision: true,
    ...over,
  };
}

/** Estrecha la respuesta al caso con costos (las que no lo son se afirman aparte, R16). */
function conCostos(respuesta: Awaited<ReturnType<CotizadorService["cotizar"]>>): CotizacionConCostos {
  if (!("escenarios" in respuesta)) throw new Error("se esperaba una cotizacion CON costos");
  return respuesta;
}

async function cotizar(
  over: Partial<CotizacionApiEntrada> = {},
  tarifa: TarifaVigente | null = TARIFA,
): Promise<CotizacionConCostos> {
  const service = new CotizadorService(coberturaFake(), tarifasFake(tarifa));
  return conCostos(await service.cotizar(ACTOR, entrada(over)));
}

describe("CotizadorService (feature 248, bloque C)", () => {
  it("R15: la tarifa se resuelve por actor.usuarioId y un tiendaId del cuerpo se ignora", async () => {
    const tarifas = tarifasFake();
    const service = new CotizadorService(coberturaFake(), tarifas);

    // Un integrador malicioso mete una clave de tienda en el cuerpo. El tipo de entrada ni
    // siquiera la declara (el schema del borde la descarta), asi que se fuerza aqui para
    // demostrar que ni asi cambia el sujeto de la cotizacion.
    const cuerpoConTiendaAjena = {
      ...entrada(),
      tiendaId: "tienda-ajena",
      tienda_id: "tienda-ajena",
    } as CotizacionApiEntrada;
    await service.cotizar(ACTOR, cuerpoConTiendaAjena);

    expect(tarifas.resolveTarifaPorTienda).toHaveBeenCalledTimes(1);
    expect(tarifas.resolveTarifaPorTienda).toHaveBeenCalledWith("tienda-de-la-key");
  });

  it("R18: el escenario entregada devuelve flete, IVA del flete, comisión COD e IVA de la comisión por separado", async () => {
    const { escenarios } = await cotizar();

    expect(escenarios.entregada.unitario).toEqual({
      flete: "2200.00", // GAM: la zona elige la COLUMNA, no la formula
      ivaFlete: "286.00", // 13 % de 2200,00
      comisionCod: "875.00", // 3,50 % de 25 000,00
      ivaComisionCod: "113.75", // 13 % de 875,00
      costoTotal: "3474.75",
      netoTienda: "21525.25",
    });
  });

  it("R19: el neto de entregada es el monto COD menos los dos bloques facturados", async () => {
    const { escenarios } = await cotizar();

    // 25 000,00 - (2200,00 + 286,00) - (875,00 + 113,75) = 21 525,25
    expect(escenarios.entregada.unitario.netoTienda).toBe("21525.25");
    expect(espiaPagoTienda).toHaveBeenCalledWith("25000.00", "2486.00", "988.75");
  });

  it("R20: el escenario devuelta trae flete de devolución y su IVA, sin comisión ni COD", async () => {
    const { escenarios } = await cotizar();

    expect(escenarios.devuelta.unitario).toEqual({
      fleteDevolucion: "1500.00",
      ivaFleteDevolucion: "195.00",
      costoTotal: "1695.00",
      netoTienda: "-1695.00",
    });
    // Ni comision, ni IVA de comision, ni monto COD a recibir: una devolucion no recauda.
    expect(Object.keys(escenarios.devuelta.unitario).sort()).toEqual([
      "costoTotal",
      "fleteDevolucion",
      "ivaFleteDevolucion",
      "netoTienda",
    ]);
  });

  it("R21: el neto de devuelta es el negativo del flete de devolución más su IVA, sin recalcular importes ni llamar a pagoTiendaOrdenex", async () => {
    espiaPagoTienda.mockClear();
    const { escenarios } = await cotizar();
    const devuelta = escenarios.devuelta.unitario;

    expect(devuelta.netoTienda).toBe("-1695.00");
    // La negacion es lo UNICO nuevo: el importe negado es exactamente el que ya salio derivado.
    expect(devuelta.netoTienda).toBe(`-${devuelta.costoTotal}`);

    // La rama de la devolucion NO llama a `pagoTiendaOrdenex`: la unica llamada de toda la
    // cotizacion es la del escenario ENTREGADA (R19), con los importes de la entrega.
    expect(espiaPagoTienda).toHaveBeenCalledTimes(1);
    expect(espiaPagoTienda).toHaveBeenCalledWith("25000.00", "2486.00", "988.75");
    for (const llamada of espiaPagoTienda.mock.calls) {
      // Ningun importe de devolucion cruzo por esa funcion, ni siquiera como "0.00" de relleno
      // (`pagoTiendaOrdenex("0.00", fleteDevConIva, "0.00")` daria el mismo numero FUERA de su
      // semantica documentada; por eso se descarto).
      expect(llamada).not.toContain("1695.00");
      expect(llamada).not.toContain("1500.00");
      expect(llamada).not.toContain("195.00");
      expect(llamada).not.toContain("0.00");
    }
  });

  it("R25: cantidad ausente vale 1", async () => {
    // El default lo resuelve el schema del borde, que lee el minimo de `lib/config/cotizador.ts`.
    const parsed = cotizacionApiSchema.parse({
      provincia: "San José",
      canton: "Central",
      distrito: "Carmen",
      monto_cobrar: "25000.00",
    });
    expect(parsed.cantidad).toBe(1);

    const service = new CotizadorService(coberturaFake(), tarifasFake());
    const respuesta = conCostos(await service.cotizar(ACTOR, parsed));

    expect(respuesta.cantidad).toBe(1);
    // Con N = 1 el total es el unitario, dígito a dígito (ni un "-0.00", ni un centimo suelto).
    expect(respuesta.escenarios.entregada.total).toEqual(respuesta.escenarios.entregada.unitario);
    expect(respuesta.escenarios.devuelta.total).toEqual(respuesta.escenarios.devuelta.unitario);
  });

  it("R26: el total es el unitario YA REDONDEADO por N (caso medido donde redondear al final daría otro número), incluido el neto negativo", async () => {
    // CASO MEDIDO. Monto 16 618,40 al 3,50 % -> comision EXACTA 581,644 (tercer decimal), que
    // `derivarIngresoOrden` redondea a 581,64 por gestion. Por 3 ordenes:
    //   · unitario ya redondeado x N  -> 581,64 x 3 = 1744,92   <- lo que factura el cierre
    //   · redondear al final          -> 581,644 x 3 = 1744,932 -> 1744,93  <- UN CENTIMO DE MAS
    // El cierre suma los `Decimal` YA redondeados por gestion (`agregarIngresosPorConcepto`),
    // asi que la segunda forma daria un total que no cuadra orden por orden.
    const { escenarios } = await cotizar({ monto_cobrar: "16618.40", cantidad: 3 });

    expect(escenarios.entregada.unitario.comisionCod).toBe("581.64");
    expect(escenarios.entregada.total.comisionCod).toBe("1744.92");
    expect(escenarios.entregada.total.comisionCod).not.toBe("1744.93");

    // El IVA de esa comision tiene el mismo perfil: 13 % de 581,64 = 75,6132 -> 75,61 x 3 = 226,83.
    expect(escenarios.entregada.unitario.ivaComisionCod).toBe("75.61");
    expect(escenarios.entregada.total.ivaComisionCod).toBe("226.83");

    expect(escenarios.entregada.total.flete).toBe("6600.00");
    expect(escenarios.entregada.total.ivaFlete).toBe("858.00");

    // El neto negativo se multiplica igual que todo lo demas.
    expect(escenarios.devuelta.unitario.netoTienda).toBe("-1695.00");
    expect(escenarios.devuelta.total.netoTienda).toBe("-5085.00");
    expect(escenarios.devuelta.total.costoTotal).toBe("5085.00");
  });

  it("R28: la respuesta declara el supuesto de distrito y monto COD compartidos", async () => {
    const una = await cotizar({ cantidad: 1 });
    expect(una.supuesto).toBe(
      "la cotización corresponde a 1 orden con ese distrito y ese monto a cobrar",
    );

    const varias = await cotizar({ cantidad: 3 });
    expect(varias.supuesto).toBe("las 3 órdenes comparten distrito y monto a cobrar");
    // Presente en TODA respuesta con escenarios: sin el, un integrador multiplicaria una
    // canasta heterogenea y la comision COD (un % del monto) saldria mal.
    expect(varias.supuesto.length).toBeGreaterThan(0);
  });

  it("R30: sin tarifa vigente responde 0.00 en todos los conceptos y tarifaVigente false", async () => {
    const respuesta = await cotizar({ cantidad: 4 }, null);

    expect(respuesta.tarifaVigente).toBe(false);
    expect(respuesta.escenarios.entregada.unitario).toEqual({
      flete: "0.00",
      ivaFlete: "0.00",
      comisionCod: "0.00",
      ivaComisionCod: "0.00",
      costoTotal: "0.00",
      // Sin nada facturado, el neto es el COD integro: `pagoTiendaOrdenex` no inventa un cargo.
      netoTienda: "25000.00",
    });
    expect(respuesta.escenarios.devuelta.unitario).toEqual({
      fleteDevolucion: "0.00",
      ivaFleteDevolucion: "0.00",
      costoTotal: "0.00",
      netoTienda: "0.00", // negar cero es cero: nunca "-0.00"
    });
    // El gap se hereda tal cual (feature 42/R9): 200, sin lanzar.
    expect(respuesta.escenarios.entregada.total.costoTotal).toBe("0.00");
  });

  it("R31: usa el resolver por tienda sin añadir filtro de status", async () => {
    const tarifas = tarifasFake();
    const service = new CotizadorService(coberturaFake(), tarifas);
    await service.cotizar(ACTOR, entrada());

    // Se llama al resolver TAL CUAL: un solo argumento, la tienda. Ningun criterio extra.
    expect(tarifas.resolveTarifaPorTienda).toHaveBeenCalledTimes(1);
    const llamada = vi.mocked(tarifas.resolveTarifaPorTienda).mock.calls[0];
    expect(llamada).toEqual(["tienda-de-la-key"]);

    // Y el fuente del service no menciona `status` ni habla con Prisma: la deuda de la feature
    // 69 (decision (g)) se HEREDA, no se arregla de contrabando en un cotizador de solo lectura.
    const fuente = codigoSinComentarios("lib/services/CotizadorService.ts");
    expect(fuente).not.toMatch(/status/);
    // Y tampoco habla con la base: el service compone repositorios, no consulta (regla de
    // capas). `Prisma.Decimal` si aparece —es el tipo money-safe—, pero ni el cliente ni una
    // query. Sin esto, "no filtra status" se podria cumplir consultando por otra via.
    expect(fuente).not.toMatch(/getPrismaClient|prisma\.tarifa|findFirst|findMany/i);
  });

  it("R33: cobra_comision ausente vale true; con false el escenario entregada omite comisión e IVA de comisión", async () => {
    // Ausente -> `true`, que es el caso CARO: una cotizacion que se equivoca hacia arriba hace
    // que la factura posterior sea menor o igual a lo cotizado.
    const porDefecto = cotizacionApiSchema.parse({
      provincia: "San José",
      canton: "Central",
      distrito: "Carmen",
      monto_cobrar: "25000.00",
    });
    expect(porDefecto.cobra_comision).toBe(true);

    const conComision = await cotizar();
    expect(conComision.cobraComision).toBe(true);
    expect(conComision.escenarios.entregada.unitario.comisionCod).toBe("875.00");

    const sinComision = await cotizar({ cobra_comision: false, cantidad: 2 });
    expect(sinComision.cobraComision).toBe(false);

    // OMITE, no emite "0.00": `derivarIngresoOrden` deja los conceptos AUSENTES y la respuesta
    // respeta la distincion (un concepto ausente y uno en cero no dicen lo mismo).
    for (const importes of [
      sinComision.escenarios.entregada.unitario,
      sinComision.escenarios.entregada.total,
    ]) {
      expect(Object.keys(importes).sort()).toEqual([
        "costoTotal",
        "flete",
        "ivaFlete",
        "netoTienda",
      ]);
      expect("comisionCod" in importes).toBe(false);
      expect("ivaComisionCod" in importes).toBe(false);
    }
    // Y el neto sube: sin comision solo se factura el flete con su IVA.
    expect(sinComision.escenarios.entregada.unitario.netoTienda).toBe("22514.00");
  });
});
