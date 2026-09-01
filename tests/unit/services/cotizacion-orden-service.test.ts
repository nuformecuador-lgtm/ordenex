import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";

import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { CotizacionOrdenService } from "@/lib/services/CotizacionOrdenService";
import type { CotizacionGeoRepository } from "@/lib/interfaces/services/ICotizacionOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigenteRepository,
  TarifaVigente,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import { MSG_FILA_SIN_TARIFA } from "@/lib/services/mensajes-tarifa";
import type { CostosCotizacion, CotizacionResumen } from "@/lib/types/cotizacion";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 255 (T5, T6, T7, T7B) — `CotizacionOrdenService`: cobertura y los DOS escenarios de
 * costo de cada fila, SIN persistir nada y SIN agregar el lote (el bloque `totales` se retiro
 * el 2026-08-31: sumaba todas las filas como si el lote se entregara al 100% y, en paralelo,
 * como si se rechazara al 100%; ninguna de las dos premisas describe un lote real).
 *
 * `derivarIngresoOrden` se envuelve en un espia que conserva la implementacion REAL: los
 * importes que se afirman aqui son los que produciria el cierre, no los de un doble. El espia
 * existe para dos cosas que no se ven en la salida: que la derivacion se invoca EXACTAMENTE
 * dos veces por fila cubierta (R24) y que nunca se le pasa una tarifa `null` (R15).
 */
vi.mock("@/lib/utils/ingreso-ordenex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/ingreso-ordenex")>();
  return { ...actual, derivarIngresoOrden: vi.fn(actual.derivarIngresoOrden) };
});

const espiaDerivar = vi.mocked(derivarIngresoOrden);

const FUENTE_SERVICE = codigoSinComentarios("lib/services/CotizacionOrdenService.ts");

const APIKEY: Actor = { usuarioId: "key-user-1", rol: "apiKey" as RolValue };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };

/**
 * La tarifa del ejemplo firmado de `design.md` §2.2: flete 2500 + IVA 13%, comision COD 3.5%
 * con su IVA 13%, y un flete de devolucion de 1396.46 cuyo IVA (181.54) da el `-1578,00` del
 * humano (decision D1). Las variantes GAM son DISTINTAS a proposito: es lo que hace visible
 * que la columna la elige el `esCentral` de la zona del distrito de cada fila (R25).
 */
const TARIFA: TarifaVigente = {
  valorFlete: "2500.00",
  valorFleteGam: "3000.00",
  valorFleteDevuelto: "1396.46",
  valorFleteDevueltoGam: "1500.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  // Sin pacto especial por distrito: estos casos cubren la tarifa NORMAL.
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/**
 * Tarifa del caso de los centimos (T7B.4): con comision del `10.01 %` un monto de `35` produce
 * una comision EXACTA de `3.5035`, que la aritmetica redondea a `3.50`. Tres filas iguales
 * suman `10.50` si el lote acumula los valores DE CADA FILA, y `10.51` si alguien acumulara
 * los exactos sin redondear. Ese centimo de diferencia es el test.
 *
 * ⚠️ FICHA 305 — POR QUE EL DECIMAL SE MUDO DEL MONTO AL PORCENTAJE. Hasta hoy el caso se
 * construia con un monto de `35.04` y una comision del `10 %`. Desde que la cotizacion redondea
 * el monto al colon (igual que la carga), un monto con centimos ya no llega vivo hasta la
 * aritmetica: `35.04` se cotiza como `35` y la comision saldria exacta, dejando este test SIN
 * NADA QUE MEDIR aunque siguiera verde. Lo que el test vigila —que el lote acumule los importes
 * YA REDONDEADOS de cada fila y no los exactos— no ha cambiado, asi que la escala de mas se
 * consigue ahora por el unico camino que sigue existiendo: un porcentaje con centimos, que es
 * ademas lo que la columna `tarifas.comision_cod` (`DECIMAL(5,2)`) permite.
 */
const TARIFA_CENTIMOS: TarifaVigente = {
  valorFlete: "10.00",
  valorFleteGam: "10.00",
  valorFleteDevuelto: "4.00",
  valorFleteDevueltoGam: "4.00",
  comisionCod: "10.01",
  ivaFlete: "0.00",
  ivaComisionCod: "0.00",
  // Sin pacto especial por distrito: estos casos cubren la tarifa NORMAL.
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/**
 * Feature 274 — la tarifa de OTRA zona, distinta en la MISMA columna (`valorFlete`, la que usa
 * un distrito no-central). Es lo que hace visible R32: dos filas del mismo lote y de la misma
 * tienda, ambas no-centrales, cotizan importes distintos porque su ZONA es distinta. Si la
 * diferencia se buscara entre `z1` y `z2` no probaria nada: `z2` es central y ya cambiaba de
 * columna desde la 255.
 */
const TARIFA_Z3: TarifaVigente = {
  valorFlete: "4000.00",
  valorFleteGam: "4500.00",
  valorFleteDevuelto: "2000.00",
  valorFleteDevueltoGam: "2200.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  // Sin pacto especial por distrito: estos casos cubren la tarifa NORMAL.
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

const PROVINCIAS = [{ id: "p1", nombre: "San José" }];
const CANTONES = [{ id: "c1", nombre: "Escazú", provinciaId: "p1" }];
const DISTRITOS = [
  { id: "d1", nombre: "San Rafael", cantonId: "c1", zonaId: "z1", esCentral: false, esZonaEspecial: false },
  { id: "d2", nombre: "Centro", cantonId: "c1", zonaId: "z2", esCentral: true, esZonaEspecial: false },
  { id: "d3", nombre: "Sin Zona", cantonId: "c1", zonaId: null, esCentral: false, esZonaEspecial: false },
  // Dos filas con el MISMO nombre dentro del canton -> distrito ambiguo (R19).
  { id: "d4", nombre: "Doble", cantonId: "c1", zonaId: "z1", esCentral: false, esZonaEspecial: false },
  { id: "d5", nombre: "Doble", cantonId: "c1", zonaId: "z2", esCentral: true, esZonaEspecial: false },
  // Feature 274: un tercer distrito NO-CENTRAL en una zona distinta de `z1`.
  { id: "d6", nombre: "Santa Ana", cantonId: "c1", zonaId: "z3", esCentral: false, esZonaEspecial: false },
];

function buildGeoRepo(overrides: Partial<CotizacionGeoRepository> = {}): CotizacionGeoRepository {
  return {
    findAllProvincias: vi.fn(async () => PROVINCIAS),
    findCantonesByProvinciaIds: vi.fn(async () => CANTONES),
    findDistritosByCantonIds: vi.fn(async () => DISTRITOS),
    ...overrides,
  };
}

/**
 * Feature 274/R37 — el resolver es UNO SOLO y es el mismo que liquida el cierre:
 * `resolveTarifa` / `resolveTarifas`. `resolveTarifaCotizablePorTienda` YA NO EXISTE, asi que
 * este doble ni siquiera puede ofrecerlo: la interfaz tiene dos metodos y TypeScript rechaza el
 * tercero. Esa es la forma en que R37 se sostiene sin un test de grep.
 *
 * El doble acepta una tarifa unica (todas las zonas resuelven lo mismo, el caso de siempre) o
 * un mapa `zonaId -> tarifa | null`, que es lo que permite escribir un lote donde una zona
 * resuelve y otra no.
 */
type TarifaPorZona = Record<string, TarifaVigente | null>;

function esTarifaUnica(v: TarifaVigente | TarifaPorZona): v is TarifaVigente {
  return "valorFlete" in v;
}

/**
 * La tarifa resuelta que devuelve el repo real: los 7 campos MAS `tarifaId` y `fulfillment`.
 *
 * El monto de fulfillment es inyectable desde 2026-08-25: dejo de ser un campo mudo que el
 * servicio ignoraba y paso a ser el SEXTO concepto del precio (y, en la carga, el predicado de
 * donde nace la orden). El default sigue siendo `"0.00"` — la tienda que no hace fulfillment—,
 * asi que todos los casos anteriores siguen midiendo lo mismo que median.
 */
function resuelta(
  tarifa: TarifaVigente,
  zonaId: string,
  fulfillment = "0.00",
): TarifaVigenteResuelta {
  return { ...tarifa, tarifaId: `tarifa-${zonaId}`, fulfillment };
}

function buildTarifaRepo(
  tarifas: TarifaVigente | TarifaPorZona | null = TARIFA,
  fulfillment = "0.00",
): ITarifaVigenteRepository {
  const paraZona = (zonaId: string | null): TarifaVigenteResuelta | null => {
    if (tarifas === null) return null;
    if (esTarifaUnica(tarifas)) return resuelta(tarifas, zonaId ?? "sin-zona", fulfillment);
    const tarifa = zonaId === null ? null : (tarifas[zonaId] ?? null);
    return tarifa === null ? null : resuelta(tarifa, zonaId as string, fulfillment);
  };

  return {
    resolveTarifa: vi.fn(async (_tiendaId: string, zonaId: string | null) => paraZona(zonaId)),
    resolveTarifas: vi.fn(async (pares: readonly ParTarifa[]) => {
      const mapa = new Map<string, TarifaVigenteResuelta | null>();
      for (const par of pares) mapa.set(clavePar(par), paraZona(par.zonaId));
      return mapa;
    }),
  };
}

function buildService(
  repo: CotizacionGeoRepository = buildGeoRepo(),
  tarifaRepo: ITarifaVigenteRepository = buildTarifaRepo(),
): CotizacionOrdenService {
  return new CotizacionOrdenService(repo, tarifaRepo);
}

/** Fila base cubierta y no-central, con el monto del ejemplo firmado. */
function fila(overrides: Partial<RawRow> = {}): RawRow {
  return {
    provincia: "San José",
    canton: "Escazú",
    distrito: "San Rafael",
    direccion: "Multiplaza, local 12",
    monto_cobrar: "25900",
    num_remision: "REM-0001",
    ...overrides,
  };
}

async function cotizar(
  rows: RawRow[],
  opciones: {
    repo?: CotizacionGeoRepository;
    tarifa?: TarifaVigente | TarifaPorZona | null;
    /** Monto de fulfillment de la tarifa que resuelve (2026-08-25). Por defecto, ninguno. */
    fulfillment?: string;
  } = {},
): Promise<CotizacionResumen> {
  const service = buildService(
    opciones.repo ?? buildGeoRepo(),
    buildTarifaRepo(
      opciones.tarifa === undefined ? TARIFA : opciones.tarifa,
      opciones.fulfillment ?? "0.00",
    ),
  );
  const result = await service.cotizar(rows, APIKEY);
  if (result.status !== "ok") throw new Error(`se esperaba ok, llego ${result.status}`);
  return result.resumen;
}

function costosDe(resumen: CotizacionResumen, indice = 0): CostosCotizacion {
  // `indice` es la posicion dentro de `filas` (las cotizadas), no el numero de fila del lote:
  // desde el 2026-08-31 las dos cosas dejan de coincidir cuando alguna fila queda en `errores`.
  const cotizada = resumen.filas[indice];
  if (cotizada === undefined) throw new Error(`no hay fila cotizada en la posicion ${indice}`);
  return cotizada.costos;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CotizacionOrdenService — autorizacion y tarifa (T5)", () => {
  it('no existe ninguna comprobacion de "tiene api key" tras autenticar (R5)', async () => {
    // Estructural: despues de autenticar, un `if (tieneApiKey)` seria codigo muerto. Lo unico
    // que el service comprueba es el ROL del actor, que es defensa en profundidad, no una
    // segunda autenticacion.
    expect(FUENTE_SERVICE).not.toMatch(/tieneApiKey|hasApiKey|apiKeyId|findApiKey|apiKeyRepo/i);
    expect(FUENTE_SERVICE).toContain('actor.rol !== "apiKey"');

    // Y el rol ajeno se rechaza sin tocar dato alguno.
    const repo = buildGeoRepo();
    const tarifaRepo = buildTarifaRepo();
    const result = await new CotizacionOrdenService(repo, tarifaRepo).cotizar([fila()], TIENDA);
    expect(result).toEqual({ status: "forbidden" });
    expect(tarifaRepo.resolveTarifas).not.toHaveBeenCalled();
    expect(repo.findAllProvincias).not.toHaveBeenCalled();
  });

  it("el service no conoce HTTP: no importa nada de next/* ni recibe Request (T5)", () => {
    expect(FUENTE_SERVICE).not.toMatch(/from\s+["']next\//);
    expect(FUENTE_SERVICE).not.toMatch(/\bRequest\b/);
  });

  it("resuelve las tarifas del lote en UNA sola consulta, no una por fila (R11/R32)", async () => {
    const tarifaRepo = buildTarifaRepo();
    const service = buildService(buildGeoRepo(), tarifaRepo);

    const result = await service.cotizar([fila(), fila(), fila({ distrito: "Centro" })], APIKEY);

    expect(result.status).toBe("ok");
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledTimes(1);
    // Tres filas, DOS zonas distintas: se piden los pares DISTINTOS, no uno por fila.
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledWith([
      { tiendaId: APIKEY.usuarioId, zonaId: "z1" },
      { tiendaId: APIKEY.usuarioId, zonaId: "z2" },
    ]);
    // El resolver SINGULAR es para un par suelto: un lote nunca lo usa (seria el N+1).
    expect(tarifaRepo.resolveTarifa).not.toHaveBeenCalled();
  });

  it("feature 274/R32: la geografia se resuelve ANTES que la tarifa (el orden se invirtio)", async () => {
    // Hasta la 273 este test afirmaba lo CONTRARIO —sin tarifa no se leia ni una provincia—, y
    // se podia: la tarifa era un atributo de la tienda. Ahora la tarifa depende de la ZONA de
    // cada fila, y la zona sale del distrito: sin geografia no hay par que resolver.
    const repo = buildGeoRepo();
    const tarifaRepo = buildTarifaRepo(null);
    const service = buildService(repo, tarifaRepo);

    const result = await service.cotizar([fila(), fila()], APIKEY);

    expect(result).toEqual({ status: "sin_tarifa" });
    expect(repo.findAllProvincias).toHaveBeenCalled();
    expect(repo.findCantonesByProvinciaIds).toHaveBeenCalled();
    expect(repo.findDistritosByCantonIds).toHaveBeenCalled();
    // Y la tarifa se pide DESPUES, ya con la zona en la mano.
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledWith([
      { tiendaId: APIKEY.usuarioId, zonaId: "z1" },
    ]);
  });

  it("nunca emite un importe cero por ausencia de tarifa (R15)", async () => {
    const service = buildService(buildGeoRepo(), buildTarifaRepo(null));

    const result = await service.cotizar([fila()], APIKEY);

    // La inversion del gap D1/R8 de la feature 98: sin tarifa NO hay resumen, ni filas, ni un
    // "0,00" servido como precio. Solo la negativa explicita.
    expect(result).toEqual({ status: "sin_tarifa" });
    expect(JSON.stringify(result)).not.toContain("0");
    expect(espiaDerivar).not.toHaveBeenCalled();
    // Y el service no llama al derivador del gap (que si degrada a "0.00").
    expect(FUENTE_SERVICE).not.toContain("costoEnvioDeTarifa");
  });

  it("la rama tarifa===null de derivarIngresoOrden es inalcanzable desde la cotizacion (R15)", async () => {
    await cotizar([fila(), fila({ distrito: "Sin Zona" }), fila({ distrito: "Centro" })]);

    expect(espiaDerivar.mock.calls.length).toBeGreaterThan(0);
    for (const [, tarifa] of espiaDerivar.mock.calls) {
      expect(tarifa).not.toBeNull();
    }
    // Sin tarifa el service corta ANTES: la unica llamada posible lleva tarifa.
    const service = buildService(buildGeoRepo(), buildTarifaRepo(null));
    espiaDerivar.mockClear();
    await service.cotizar([fila()], APIKEY);
    expect(espiaDerivar).not.toHaveBeenCalled();
  });
});

describe("CotizacionOrdenService — correlacion y ausencia de dedupe (T5)", () => {
  it("devuelve numRemision tal cual si viene y null si no viene (R9)", async () => {
    const resumen = await cotizar([
      fila({ num_remision: "REM-0001" }),
      fila({ num_remision: "" }),
      fila({ num_remision: undefined as unknown as string }),
    ]);

    expect(resumen.filas.map((f) => f.numRemision)).toEqual(["REM-0001", null, null]);
    // R9: no exigirlo para cotizar -> las tres filas cotizan igual.
    expect(resumen.filas.every((f) => f.resultado === "cotizada")).toBe(true);
    // R46: indice 1-based dentro del array recibido.
    expect(resumen.filas.map((f) => f.fila)).toEqual([1, 2, 3]);
  });

  it("dos filas con el mismo num_remision se cotizan las dos y ninguna es duplicada (R10)", async () => {
    const repo = buildGeoRepo();
    const resumen = await cotizar([fila({ num_remision: "REM-X" }), fila({ num_remision: "REM-X" })], {
      repo,
    });

    expect(resumen.filas.map((f) => f.resultado)).toEqual(["cotizada", "cotizada"]);
    expect(resumen.cotizadas).toBe(2);
    expect(JSON.stringify(resumen)).not.toContain("duplicada");
    // Sin persistencia no hay contra que deduplicar: el service no lee remisiones existentes.
    expect(FUENTE_SERVICE).not.toContain("findExistingRemisiones");
    expect(costosDe(resumen, 0)).toEqual(costosDe(resumen, 1));
  });
});

describe("CotizacionOrdenService — cobertura por fila (T6)", () => {
  it("T6.1 resuelve provincia -> canton -> distrito y toma la zona del distrito (R17)", async () => {
    const repo = buildGeoRepo();
    const resumen = await cotizar([fila({ provincia: "san jose", canton: "ESCAZU" })], { repo });

    // El encadenamiento es literal: provincias -> cantones DE ESAS provincias -> distritos DE
    // ESOS cantones, y la zona sale del distrito.
    expect(repo.findCantonesByProvinciaIds).toHaveBeenCalledWith(["p1"]);
    expect(repo.findDistritosByCantonIds).toHaveBeenCalledWith(["c1"]);
    expect(resumen.filas[0].resultado).toBe("cotizada");
    // Distrito con zona y no-central -> columna estandar del flete.
    expect(costosDe(resumen).entregado.flete).toBe("2500.00");
  });

  it("T6.2 distrito no encontrado en el canton (R18)", async () => {
    const resumen = await cotizar([fila({ distrito: "Inexistente" })]);

    // 2026-08-31: la fila sin precio NO esta en `filas`, esta en la lista hermana `errores`.
    expect(resumen.filas).toEqual([]);
    expect(resumen.errores[0]).toEqual({
      fila: 1,
      numRemision: "REM-0001",
      resultado: "error",
      errores: { distrito: ["distrito no encontrado en el canton"] },
    });
  });

  it("T6.3 distrito ambiguo en el canton (R19)", async () => {
    const resumen = await cotizar([fila({ distrito: "Doble" })]);

    expect(resumen.errores[0].errores).toEqual({ distrito: ["distrito ambiguo en el canton"] });
  });

  it("T6.4 el distrito X no tiene zona asignada (R20)", async () => {
    const resumen = await cotizar([fila({ distrito: "Sin Zona" })]);

    expect(resumen.errores[0].errores).toEqual({
      distrito: ["el distrito 'Sin Zona' no tiene zona asignada"],
    });
  });

  it("T6.4b los tres mensajes son byte-identicos a los que emite cargarViaApi (R18-R20)", async () => {
    const geografia = [
      { distrito: "Inexistente" },
      { distrito: "Doble" },
      { distrito: "Sin Zona" },
    ];

    const resumen = await cotizar(geografia.map((g) => fila(g)));

    // La MISMA geografia por el borde de la CARGA (feature 88): mismas filas, mas los campos
    // que aquella exige y esta no. `resolveGeo` es uno solo (design.md §5.1), asi que los tres
    // mensajes tienen que salir identicos carácter a carácter.
    const repoCarga = {
      findUsuarioFulfillment: vi.fn(async () => false),
      findExistingRemisiones: vi.fn(async () => new Map<string, string>()),
      findEstatusIdByValue: vi.fn(async () => "os-1"),
      findAllProvincias: vi.fn(async () => PROVINCIAS),
      findCantonesByProvinciaIds: vi.fn(async () => CANTONES),
      findDistritosByCantonIds: vi.fn(async () => DISTRITOS),
    } as unknown as IOrdenRepository;
    const carga = new BulkOrdenService(repoCarga, buildTarifaRepo());
    const resultadoCarga = await carga.cargarViaApi(
      geografia.map((g, i) =>
        fila({
          ...g,
          num_remision: `REM-CARGA-${i}`,
          destinatario: "Ana",
          telefono: "88888888",
          producto: "caja",
        }),
      ),
      APIKEY,
    );
    if (resultadoCarga.status !== "ok") throw new Error("la carga no devolvio ok");

    const mensajes = (errores: Record<string, string[]> | undefined) => errores?.distrito;
    // ⏳ Los DOS lados se leen ya de `errores`: la carga saco de `filas` sus filas fallidas (PR
    // 636) y la cotizacion hizo lo mismo el mismo dia. Se cambia la FUENTE, no lo que el caso
    // afirma: los tres mensajes de geografia siguen teniendo que salir identicos caracter a
    // caracter por los dos bordes, porque `resolveGeo` es uno solo (design.md §5.1).
    expect(resumen.errores.map((f) => mensajes(f.errores))).toEqual(
      resultadoCarga.summary.errores.map((f) => mensajes(f.errores)),
    );
    // Y son exactamente los tres del contrato, en el mismo orden.
    expect(resumen.errores.map((f) => mensajes(f.errores))).toEqual([
      ["distrito no encontrado en el canton"],
      ["distrito ambiguo en el canton"],
      ["el distrito 'Sin Zona' no tiene zona asignada"],
    ]);
  });

  it("una fila en error no trae bloque costos (R22)", async () => {
    const resumen = await cotizar([fila({ distrito: "Sin Zona" }), fila()]);

    // 2026-08-31: la separacion hace el aserto mas fuerte, no mas debil. Antes se comprobaba
    // que la fila mala no trajera `costos`; ahora ni siquiera esta en la lista que los lleva.
    expect(resumen.errores[0].resultado).toBe("error");
    expect("costos" in resumen.errores[0]).toBe(false);
    expect(resumen.filas.some((f) => f.fila === 1)).toBe(false);
    // Y la simetria: una fila cotizada no trae `errores`.
    expect(resumen.filas[0].resultado).toBe("cotizada");
    expect("errores" in resumen.filas[0]).toBe(false);
    // Exito parcial (R21): la fila mala no impide cotizar la otra.
    expect(resumen.cotizadas).toBe(1);
    expect(resumen.conError).toBe(1);
  });
});

describe("CotizacionOrdenService — los dos escenarios (T7)", () => {
  it("T7.1 cada fila cubierta emite los escenarios entregado y devuelto (R23)", async () => {
    const resumen = await cotizar([fila()]);

    expect(costosDe(resumen)).toEqual({
      entregado: {
        flete: "2500.00",
        iva: "325.00",
        comision: "906.50",
        ivaComision: "117.85",
        // Esta tienda no hace fulfillment: cero EXPLICITO, y el total no se mueve.
        fulfillment: "0.00",
        total: "22050.65",
      },
      devuelto: {
        flete: "1396.46",
        iva: "181.54",
        comision: "0.00",
        fulfillment: "0.00",
        total: "-1578.00",
      },
    });
  });

  it("T7.2 delega en derivarIngresoOrden dos veces (R24)", async () => {
    await cotizar([fila()]);

    expect(espiaDerivar).toHaveBeenCalledTimes(2);
    const [primera, segunda] = espiaDerivar.mock.calls;
    expect(primera[0]).toEqual({
      resultado: "entregada",
      esCentral: false,
      // El distrito de la fila no esta marcado como zona especial: la cotizacion viaja con la
      // marca igual que con `esCentral`, y aqui vale `false`.
      esZonaEspecial: false,
      montoCobrar: "25900",
      cobraComision: true,
    });
    // FICHA 301 (2026-08-28): la segunda llamada pide `rechazada`, no `devuelta`. El escenario
    // publico se sigue llamando "devuelto" y sus importes NO cambian, pero el resultado de
    // gestion que factura el retorno es `rechazada`: una `devuelta` es un intento fallido que
    // sigue vivo y desde esa fecha no genera ingreso alguno. Si esto volviera a `devuelta`, la
    // cotizacion publicaria ceros y le prometeria al integrador que un retorno es gratis.
    expect(segunda[0]).toEqual({
      resultado: "rechazada",
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "25900",
      cobraComision: true,
    });
    // `toMatchObject`: desde la 274 lo que llega es la tarifa RESUELTA (los 7 campos de la
    // formula mas `tarifaId` y `fulfillment`, que la formula no lee).
    expect(primera[1]).toMatchObject(TARIFA);
    expect(segunda[1]).toMatchObject(TARIFA);
  });

  it("estructural: el service no multiplica ni divide importes (R24)", () => {
    // Ninguna formula propia de flete, IVA ni comision: solo las dos sumas/restas de `total`.
    for (const operacion of [
      /\.mul\s*\(/,
      /\.times\s*\(/,
      /\.div\s*\(/,
      /\.dividedBy\s*\(/,
      /\.mod\s*\(/,
    ]) {
      expect(FUENTE_SERVICE).not.toMatch(operacion);
    }
    expect(FUENTE_SERVICE).toContain("derivarIngresoOrden");
  });

  it("T7.3 elige la columna GAM segun el esCentral de la zona del distrito de ESA fila (R25)", async () => {
    // Lote MIXTO: la primera fila cae en un distrito no-central y la segunda en uno central.
    const resumen = await cotizar([fila(), fila({ distrito: "Centro" })]);

    expect(costosDe(resumen, 0).entregado.flete).toBe("2500.00");
    expect(costosDe(resumen, 0).devuelto.flete).toBe("1396.46");
    expect(costosDe(resumen, 1).entregado.flete).toBe("3000.00");
    expect(costosDe(resumen, 1).devuelto.flete).toBe("1500.00");
    // El flag viaja por fila, no por lote: las dos llamadas de cada fila lo comparten.
    const esCentrales = espiaDerivar.mock.calls.map(([input]) => input.esCentral);
    expect(esCentrales).toEqual([false, false, true, true]);
  });

  it("el escenario entregado emite exactamente flete, iva, comision, ivaComision, fulfillment y total (R26)", async () => {
    const resumen = await cotizar([fila()]);

    expect(Object.keys(costosDe(resumen).entregado).sort()).toEqual(
      ["comision", "flete", "fulfillment", "iva", "ivaComision", "total"].sort(),
    );
  });

  it("el escenario devuelto emite exactamente flete, iva, comision, fulfillment y total, sin ivaComision (R27)", async () => {
    const resumen = await cotizar([fila()]);

    expect(Object.keys(costosDe(resumen).devuelto).sort()).toEqual(
      ["comision", "flete", "fulfillment", "iva", "total"].sort(),
    );
    expect("ivaComision" in costosDe(resumen).devuelto).toBe(false);
  });

  it("T7.4 devuelto.comision es el cero explicito 0.00 y nunca falta ni es null (R28)", async () => {
    const resumen = await cotizar([fila(), fila({ monto_cobrar: "" }), fila({ distrito: "Centro" })]);

    for (const indice of [0, 1, 2]) {
      const devuelto = costosDe(resumen, indice).devuelto;
      expect(devuelto.comision).toBe("0.00");
      expect(devuelto.comision).not.toBeNull();
      expect("comision" in devuelto).toBe(true);
    }
  });

  it("asume cobraComision true (R29)", async () => {
    const resumen = await cotizar([fila()]);

    expect(espiaDerivar.mock.calls.every(([input]) => input.cobraComision === true)).toBe(true);
    // Y se ve en la salida: con `cobraComision` false la comision seria un concepto AUSENTE.
    expect(costosDe(resumen).entregado.comision).toBe("906.50");
    expect(costosDe(resumen).entregado.ivaComision).toBe("117.85");
  });

  it("T7.5 entregado.total = monto_cobrar menos los cuatro conceptos (R30)", async () => {
    const resumen = await cotizar([fila()]);
    const entregado = costosDe(resumen).entregado;

    // 25900 − (2500 + 325 + 906.50 + 117.85) = 22050.65: lo que RECIBE la tienda (D1).
    expect(entregado.total).toBe("22050.65");
  });

  it("FICHA 305 · cotiza sobre el monto REDONDEADO, que es el que se va a cobrar", async () => {
    // EL DEFECTO QUE CIERRA, medido de punta a punta. La carga persiste `11898.81` como `11899`
    // desde la feature 299 (con centimos la orden no se puede entregar nunca), pero la
    // cotizacion seguia calculando sobre el exacto: se prometia la comision de `11898.81` y
    // luego se cobraba la de `11899`.
    const conCentimos = await cotizar([fila({ monto_cobrar: "11898.81" })]);
    const yaEntero = await cotizar([fila({ monto_cobrar: "11899" })]);

    // La afirmacion central: cotizar el monto con centimos es EXACTAMENTE cotizar el redondeado.
    // No compara una funcion consigo misma —son dos ENTRADAS distintas por el mismo camino— y es
    // lo que se rompe en cuanto alguien quite el redondeo de la puerta.
    expect(costosDe(conCentimos)).toEqual(costosDe(yaEntero));

    // Y los importes concretos, calculados a mano sobre 11899 y no copiados de la salida:
    //   comision      = 11899 × 3,50 %          = 416,465  -> 416,47 (ROUND_HALF_UP)
    //   iva comision  = 416,47 × 13 %           = 54,1411  -> 54,14
    //   total tienda  = 11899 − 2500 − 325 − 416,47 − 54,14 = 8603,39
    const entregado = costosDe(conCentimos).entregado;
    expect(entregado.comision).toBe("416.47");
    expect(entregado.ivaComision).toBe("54.14");
    expect(entregado.total).toBe("8603.39");

    // LO QUE SE PUBLICABA ANTES DE ESTA FICHA, escrito para que el cambio observable quede a la
    // vista: sobre el monto exacto la comision era 11898,81 × 3,50 % = 416,45835 -> 416,46 y el
    // total 8603,21. Un centimo en la comision, dieciocho en el total.
    expect(entregado.comision).not.toBe("416.46");
    expect(entregado.total).not.toBe("8603.21");
  });

  it("T7.6 devuelto.total es negativo e igual a -(flete + iva) (R31)", async () => {
    const resumen = await cotizar([fila()]);
    const devuelto = costosDe(resumen).devuelto;

    // El caso del humano: −(1396.46 + 181.54) = −1578.00, la DEUDA de la tienda (D1).
    expect(devuelto.flete).toBe("1396.46");
    expect(devuelto.iva).toBe("181.54");
    expect(devuelto.total).toBe("-1578.00");
    expect(devuelto.total.startsWith("-")).toBe(true);
  });

  it("sin monto_cobrar la comision es cero y entregado.total sale negativo (R32)", async () => {
    const resumen = await cotizar([fila({ monto_cobrar: "" }), fila({ monto_cobrar: undefined as unknown as string })]);

    for (const indice of [0, 1]) {
      const entregado = costosDe(resumen, indice).entregado;
      expect(entregado.comision).toBe("0.00");
      expect(entregado.ivaComision).toBe("0.00");
      // 0 − (2500 + 325) = −2825.
      expect(entregado.total).toBe("-2825.00");
    }
  });

  it("estructural: cero Number(/parseFloat(/parseInt( sobre importes en el service (R33)", () => {
    for (const prohibida of [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/]) {
      expect(FUENTE_SERVICE).not.toMatch(prohibida);
    }
    // La aritmetica es de decimales exactos de punta a punta.
    expect(FUENTE_SERVICE).toContain("Prisma.Decimal");
  });

  it("el service no redondea: el redondeo lo hace derivarIngresoOrden (R39)", async () => {
    for (const redondeo of [/\.toFixed\s*\(/, /toDecimalPlaces\s*\(/, /ROUND_/]) {
      expect(FUENTE_SERVICE).not.toMatch(redondeo);
    }
    // Y se comprueba en la salida: 906.50 × 13% = 117.845, que sale como 117,85 porque la
    // aritmetica redondea HALF_UP. El service solo transporta ese decimal al formateador.
    const resumen = await cotizar([fila()]);
    expect(costosDe(resumen).entregado.ivaComision).toBe("117.85");
    expect(costosDe(resumen).devuelto.iva).toBe("181.54");
  });
});

describe("CotizacionOrdenService — la cotizacion es POR ORDEN, sin agregado del lote", () => {
  // 2026-08-31 — LO QUE ESTOS TESTS FIJAN ES UNA AUSENCIA. Hasta hoy el resumen traia un
  // bloque `totales` que sumaba las filas cotizadas en el escenario ENTREGADO y, a la vez, en
  // el DEVUELTO: dos compilados bajo las premisas de "100% entregas" y "100% rechazos". Ningun
  // lote real cumple ninguna de las dos, asi que ninguno de los dos numeros era el costo del
  // lote — y se leian exactamente como eso. El precio que este service sabe es el de cada
  // orden; el agregado, con la tasa de entrega que corresponda, es de quien consume.
  it("el resumen NO trae bloque `totales`, ni siquiera vacio o en cero", async () => {
    for (const rows of [
      [fila()],
      [fila(), fila({ distrito: "Sin Zona" }), fila()],
      [fila({ distrito: "Sin Zona" }), fila({ provincia: "" })],
    ]) {
      const resumen = await cotizar(rows);
      expect("totales" in resumen).toBe(false);
      // Y la forma completa del resumen es exactamente esta: cinco claves (`errores` es la
      // lista hermana que naciO el 2026-08-31; su presencia es parte del contrato, no un extra).
      expect(Object.keys(resumen).sort()).toEqual([
        "conError",
        "cotizadas",
        "errores",
        "filas",
        "total",
      ]);
    }
  });

  it("los contadores de la raiz siguen cuadrando: cotizadas + conError === total", async () => {
    for (const rows of [
      [fila(), fila({ distrito: "Sin Zona" })],
      [fila(), fila(), fila({ distrito: "Centro" })],
      [fila({ distrito: "Inexistente" })],
    ]) {
      const resumen = await cotizar(rows);
      // Cada contador es la longitud de SU lista: por construccion no pueden desincronizarse.
      expect(resumen.cotizadas).toBe(resumen.filas.length);
      expect(resumen.conError).toBe(resumen.errores.length);
      expect(resumen.cotizadas + resumen.conError).toBe(resumen.total);
    }
  });

  it("un lote donde NINGUNA fila cotiza no emite ni un solo importe", async () => {
    const resumen = await cotizar([
      fila({ distrito: "Sin Zona" }),
      fila({ distrito: "Inexistente" }),
      fila({ provincia: "" }),
    ]);

    expect(resumen.cotizadas).toBe(0);
    expect(resumen.conError).toBe(3);
    expect("totales" in resumen).toBe(false);
    // Ni un cero suelto: `filas` (la unica lista que lleva importes) esta vacia, y las tres
    // entradas de `errores` no traen `costos`.
    expect(resumen.filas).toEqual([]);
    expect(resumen.errores.every((f) => !("costos" in f))).toBe(true);
  });

  it("una fila NO puede estar en las dos listas, y entre las dos cubren el lote entero", async () => {
    // La invariante que hace fiable el reparto: `filas` y `errores` particionan el lote. Sin
    // esto, duplicar una fila en las dos listas dejaria los contadores cuadrando igual.
    const resumen = await cotizar([
      fila(),
      fila({ distrito: "Sin Zona" }),
      fila({ distrito: "Centro" }),
      fila({ provincia: "" }),
    ]);

    const cotizadas = resumen.filas.map((f) => f.fila);
    const fallidas = resumen.errores.map((f) => f.fila);
    expect(cotizadas).toEqual([1, 3]);
    expect(fallidas).toEqual([2, 4]);
    expect([...cotizadas, ...fallidas].sort()).toEqual([1, 2, 3, 4]);
  });

  it("estructural: el service ya no acumula el lote (ni acumuladores ni sumas entre filas)", () => {
    // El grep es el complemento del test de comportamiento: si alguien reintroduce el bloque,
    // vuelve tambien el acumulador, y este diente lo caza aunque le cambien el nombre al campo.
    for (const acumulador of [/acumulador/i, /sumarEntregado/, /sumarDevuelto/, /filasSumadas/]) {
      expect(FUENTE_SERVICE).not.toMatch(acumulador);
    }
  });

  it("estructural: el service no opera sobre strings ni re-parsea un importe ya serializado (R55)", () => {
    // Nada de quitar separadores para volver a operar (alternativa A7).
    expect(FUENTE_SERVICE).not.toMatch(/\.replace\s*\(/);
    expect(FUENTE_SERVICE).not.toMatch(/\bNumber\s*\(/);
    // El serializador nunca alimenta a la aritmetica: no existe un decimal construido sobre su
    // salida, y ningun `plus` recibe el resultado de serializar.
    expect(FUENTE_SERVICE).not.toMatch(/Decimal\s*\(\s*serializar/);
    expect(FUENTE_SERVICE).not.toMatch(/plus\s*\(\s*serializar/);
    // Ni los caracteres del formato humano se escriben aqui.
    expect(FUENTE_SERVICE).not.toContain("₡");
    expect(FUENTE_SERVICE).not.toContain("separadorMiles");
    expect(FUENTE_SERVICE).not.toContain("separadorDecimal");
    // La aritmetica de la fila sigue siendo de decimales exactos.
    expect(FUENTE_SERVICE).toMatch(/\.plus\s*\(/);
  });

  it("la aritmetica por fila no cambia con el retiro del lote (los centimos siguen donde estaban)", async () => {
    // Las tres filas de 35 con la tarifa de centimos: cada una redondea su comision a 3.50 y
    // eso es lo unico que el contrato publica ahora.
    const resumen = await cotizar(
      [fila({ monto_cobrar: "35" }), fila({ monto_cobrar: "35" }), fila({ monto_cobrar: "35" })],
      { tarifa: TARIFA_CENTIMOS },
    );

    for (const indice of [0, 1, 2]) {
      expect(costosDe(resumen, indice).entregado.comision).toBe("3.50");
      expect(costosDe(resumen, indice).entregado.flete).toBe("10.00");
      expect(costosDe(resumen, indice).entregado.total).toBe("21.50");
      expect(costosDe(resumen, indice).devuelto.total).toBe("-4.00");
    }
  });
});

// ---------------------------------------------------------------------------------------
// Feature 274 (T7.3) — la tarifa por par (tienda, zona) y el criterio de lote de design §3.6
// ---------------------------------------------------------------------------------------

/** El lote donde `z1` resuelve y `z3` no: la materia prima de R34 y R35. */
const SOLO_Z1: TarifaPorZona = { z1: TARIFA, z3: null };

describe("CotizacionOrdenService — tarifa por zona (feature 274, R32-R38)", () => {
  it("R32 dos filas en zonas distintas cotizan importes distintos, con UNA sola consulta de tarifas", async () => {
    const tarifaRepo = buildTarifaRepo({ z1: TARIFA, z3: TARIFA_Z3 });
    const service = buildService(buildGeoRepo(), tarifaRepo);

    // Las DOS filas son no-centrales, asi que las dos leen la MISMA columna (`valorFlete`).
    // Lo unico que las separa es la zona de su distrito: si el importe saliera igual, la
    // tarifa se habria resuelto por la tienda y no por el par, que es exactamente la
    // regresion que la 274 viene a cerrar.
    const result = await service.cotizar([fila(), fila({ distrito: "Santa Ana" })], APIKEY);
    if (result.status !== "ok") throw new Error(`se esperaba ok, llego ${result.status}`);
    const resumen = result.resumen;

    expect(resumen.filas.map((f) => f.resultado)).toEqual(["cotizada", "cotizada"]);
    expect(costosDe(resumen, 0).entregado.flete).toBe("2500.00");
    expect(costosDe(resumen, 1).entregado.flete).toBe("4000.00");
    expect(costosDe(resumen, 0).entregado.flete).not.toBe(costosDe(resumen, 1).entregado.flete);
    // Y la devolucion tambien sale de la tarifa de SU zona.
    expect(costosDe(resumen, 0).devuelto.flete).toBe("1396.46");
    expect(costosDe(resumen, 1).devuelto.flete).toBe("2000.00");

    // R32/R7: UNA sola consulta por peticion, con los dos pares distintos.
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledTimes(1);
    expect(tarifaRepo.resolveTarifas).toHaveBeenCalledWith([
      { tiendaId: APIKEY.usuarioId, zonaId: "z1" },
      { tiendaId: APIKEY.usuarioId, zonaId: "z3" },
    ]);
  });

  it("R33 si todas las filas resuelven, el lote cotiza entero y nadie queda en error", async () => {
    const resumen = await cotizar(
      [fila(), fila({ distrito: "Santa Ana" }), fila({ distrito: "Centro" })],
      { tarifa: { z1: TARIFA, z2: TARIFA, z3: TARIFA_Z3 } },
    );

    expect(resumen.filas.every((f) => f.resultado === "cotizada")).toBe(true);
    expect(resumen.cotizadas).toBe(3);
    expect(resumen.conError).toBe(0);
    // Ninguna fila trae el canal de error de tarifa: la lista hermana esta vacia.
    expect(resumen.errores).toEqual([]);
  });

  it("R34/R38 lote mixto: la fila sin tarifa se degrada a error, sin bloque costos y sin aportar al lote", async () => {
    const resumen = await cotizar(
      [fila(), fila({ distrito: "Santa Ana", num_remision: "REM-0002" })],
      { tarifa: SOLO_Z1 },
    );

    // La fila que resuelve cotiza normalmente.
    expect(resumen.filas[0].resultado).toBe("cotizada");

    // R38: el MISMO canal de error por fila que ya usaba la geografia —`errores` por campo—,
    // con la clave `tarifa`. Ni un campo nuevo, ni un codigo nuevo, ni un bloque paralelo.
    expect(resumen.errores[0]).toEqual({
      fila: 2,
      numRemision: "REM-0002",
      resultado: "error",
      errores: { tarifa: [MSG_FILA_SIN_TARIFA] },
    });
    // R34: AUSENCIA de la clave `costos`, no un `costos` en cero. Un cero seria un precio.
    expect("costos" in resumen.errores[0]).toBe(false);
    // Y la fila degradada no se cuela en la lista de las que SI tienen precio.
    expect(resumen.filas.map((f) => f.fila)).toEqual([1]);

    // Contadores: la fila degradada cuenta como error y como excluida del lote.
    expect(resumen.cotizadas).toBe(1);
    expect(resumen.conError).toBe(1);
    expect(resumen.cotizadas + resumen.conError).toBe(resumen.total);

    // Y la fila que si resuelve conserva su precio intacto: la degradacion de la otra no le
    // toca ni un importe.
    expect(costosDe(resumen, 0).entregado.flete).toBe("2500.00");
  });

  it("R35 si NINGUNA fila que llego a resolver resuelve, el lote entero es sin_tarifa y no emite un solo importe", async () => {
    const service = buildService(buildGeoRepo(), buildTarifaRepo({ z1: null, z3: null }));

    const result = await service.cotizar(
      [fila(), fila({ distrito: "Santa Ana" }), fila({ distrito: "Inexistente" })],
      APIKEY,
    );

    // `sin_tarifa` conserva su nombre —el borde lo traduce a 409 sin cambiar una linea— pero
    // su significado se estrecho: "ninguna fila de este lote resolvio tarifa".
    expect(result).toEqual({ status: "sin_tarifa" });
    // Sin filas y sin ni un numero: el importe ni se calcula.
    expect(espiaDerivar).not.toHaveBeenCalled();
  });

  it("R36 un lote que NADIE llega a resolver responde ok con todas las filas en error, no sin_tarifa", async () => {
    const tarifaRepo = buildTarifaRepo(null);
    const service = buildService(buildGeoRepo(), tarifaRepo);

    const result = await service.cotizar(
      [fila({ distrito: "Inexistente" }), fila({ distrito: "Sin Zona" }), fila({ provincia: "" })],
      APIKEY,
    );

    // El caso que decide bien o mal la implementacion ingenua (`resueltas === 0`): aqui la
    // tarifa NO es el motivo del fallo, asi que un `sin_tarifa` —y su 409— le daria al
    // integrador un diagnostico falso sobre su cuenta.
    if (result.status !== "ok") throw new Error(`se esperaba ok, llego ${result.status}`);
    expect(result.resumen.cotizadas).toBe(0);
    expect(result.resumen.conError).toBe(3);
    expect("totales" in result.resumen).toBe(false);
    // Y ni siquiera se consulta la tarifa: no hay un solo par que pedir.
    expect(tarifaRepo.resolveTarifas).not.toHaveBeenCalled();
    // Ninguna fila lleva el error de tarifa: los tres errores son de geografia/validacion.
    expect(result.resumen.filas).toEqual([]);
    for (const f of result.resumen.errores) {
      expect(f.errores.tarifa).toBeUndefined();
    }
  });

  it("R37 cotiza con el UNICO resolver (el mismo que liquida el cierre) y con ningun otro metodo", async () => {
    // El doble ESTRICTO: cualquier acceso a un metodo del repositorio de tarifas que no sea
    // `resolveTarifas` estalla. Es la forma de afirmar R37 sin un grep: si la cotizacion
    // volviera a tener un resolver propio, este test lo caza aunque le cambien el nombre.
    const invocados: string[] = [];
    const tarifaRepo = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== "string") return undefined;
          invocados.push(prop);
          if (prop !== "resolveTarifas") {
            throw new Error(`la cotizacion invoco un resolver prohibido: ${prop}`);
          }
          return async (pares: readonly ParTarifa[]) => {
            const mapa = new Map<string, TarifaVigenteResuelta | null>();
            for (const par of pares) mapa.set(clavePar(par), resuelta(TARIFA, par.zonaId ?? ""));
            return mapa;
          };
        },
      },
    ) as unknown as ITarifaVigenteRepository;

    const result = await buildService(buildGeoRepo(), tarifaRepo).cotizar([fila()], APIKEY);

    expect(result.status).toBe("ok");
    expect(invocados).toEqual(["resolveTarifas"]);
    // Estructural: el nombre del resolver retirado no aparece en el service.
    expect(FUENTE_SERVICE).not.toContain("resolveTarifaCotizablePorTienda");
    expect(FUENTE_SERVICE).toContain("resolveTarifas");
  });

  it("R38 el literal del error de fila viene de la constante compartida, no de una copia local", async () => {
    const resumen = await cotizar([fila(), fila({ distrito: "Santa Ana" })], { tarifa: SOLO_Z1 });

    expect(resumen.errores[0].errores).toEqual({ tarifa: [MSG_FILA_SIN_TARIFA] });
    // El service IMPORTA la cadena; no la escribe. Un literal inline aqui seria la segunda
    // copia que diverge a la primera errata corregida (y R38 pide justo lo contrario: que la
    // carga y la cotizacion emitan la MISMA).
    expect(FUENTE_SERVICE).not.toContain(MSG_FILA_SIN_TARIFA);
    expect(FUENTE_SERVICE).toContain("MSG_FILA_SIN_TARIFA");
    // (Aqui decia que el bloque de imports quedaba FUERA de `FUENTE_SERVICE` porque el docstring
    // de cabecera cita `next/*` y el quitador se comia desde ahi hasta el primer `*/`. Era cierto
    // y era el defecto que la ficha 283 cerro el 2026-08-25: el quitador ya no abre bloque con un
    // `/*` que vive dentro de un comentario o de una cadena, asi que `FUENTE_SERVICE` SI incluye
    // los imports y el rodeo que esta nota explicaba ya no hace falta. La asercion no cambia: lo
    // que importa sigue estando afirmado arriba, la cadena emitida ES la constante, por identidad.)
  });
});

// ---------------------------------------------------------------------------
// FULFILLMENT (2026-08-25) — el SEXTO concepto del precio.
//
// `tarifas.fulfillment` existia desde el 2026-08-19 pero no cobraba: se congelaba en
// `cierre_detail` solo para mostrarse. La decision de producto cambio para el canal por API
// key: una tienda cuyo paquete sale de NUESTRA bodega paga ese monto fijo por orden, y la
// cotizacion —que es donde el integrador ve el precio antes de cargar— tiene que decirlo.
//
// Sigue SIN entrar en `derivarIngresoOrden`: la liquidacion (cierre y wallets) no se movio.
// ---------------------------------------------------------------------------
describe("CotizacionOrdenService — fulfillment (2026-08-25)", () => {
  it("el monto de la tarifa se cobra en los DOS escenarios y baja los dos totales", async () => {
    const resumen = await cotizar([fila()], { fulfillment: "1000.00" });

    expect(costosDe(resumen)).toEqual({
      entregado: {
        flete: "2500.00",
        iva: "325.00",
        comision: "906.50",
        ivaComision: "117.85",
        fulfillment: "1000.00",
        // 22.050,65 sin fulfillment: lo que RECIBE la tienda baja exactamente el monto.
        total: "21050.65",
      },
      devuelto: {
        flete: "1396.46",
        iva: "181.54",
        comision: "0.00",
        // El servicio de bodega YA se presto: una devolucion no lo devuelve gratis.
        fulfillment: "1000.00",
        // -1.578,00 sin fulfillment: la DEUDA crece por el mismo monto.
        total: "-2578.00",
      },
    });
  });

  it("los cuatro conceptos que ya existian no se mueven ni un centimo", async () => {
    const [con, sin] = await Promise.all([
      cotizar([fila()], { fulfillment: "1000.00" }),
      cotizar([fila()]),
    ]);

    const conF = costosDe(con);
    const sinF = costosDe(sin);
    for (const clave of ["flete", "iva", "comision", "ivaComision"] as const) {
      expect(conF.entregado[clave]).toBe(sinF.entregado[clave]);
    }
    expect(conF.devuelto.flete).toBe(sinF.devuelto.flete);
    expect(conF.devuelto.iva).toBe(sinF.devuelto.iva);
  });

  it("el monto entra UNA vez en cada fila cotizada, y la fila sin cobertura no lo lleva", async () => {
    const resumen = await cotizar([fila(), fila({ distrito: "Sin Zona" }), fila()], {
      fulfillment: "1000.00",
    });

    // 2026-08-31: sin bloque de lote, lo que se afirma es lo que el contrato publica — el
    // monto por orden, en las dos filas que cotizan, y ni un importe en la que no.
    expect(resumen.cotizadas).toBe(2);
    // Las dos que cotizan son las filas 1 y 3 del lote; en `filas` ocupan las posiciones 0 y 1
    // porque la que no cotiza ya no viaja entre ellas.
    expect(resumen.filas.map((f) => f.fila)).toEqual([1, 3]);
    for (const indice of [0, 1]) {
      expect(costosDe(resumen, indice).entregado.fulfillment).toBe("1000.00");
      expect(costosDe(resumen, indice).devuelto.fulfillment).toBe("1000.00");
    }
    expect("costos" in resumen.errores[0]).toBe(false);
  });

  it("no se cuela en la liquidacion: `derivarIngresoOrden` nunca ve el monto", async () => {
    await cotizar([fila()], { fulfillment: "1000.00" });

    // La derivacion recibe la tarifa entera —el objeto trae el campo—, pero la FORMULA no lo
    // lee: sus importes son los mismos con y sin monto. Lo que este test fija es la frontera
    // que sigue en pie: el fulfillment se suma FUERA, en el service, y no dentro del derivador
    // que alimenta el cierre y las wallets.
    for (const [, tarifa] of espiaDerivar.mock.calls) {
      expect(tarifa).not.toBeNull();
    }
    expect(FUENTE_SERVICE).toContain("montoFulfillmentDeTarifa");
  });
});

// ---------------------------------------------------------------------------
// 2026-08-31 — EL VALOR SOBRE EL QUE SE COTIZA (`montoCobrar`).
//
// Todo lo demas de la fila se DERIVA del monto a cobrar, y hasta hoy ese monto no volvia. La
// cotizacion lo redondea al colon en la puerta (ficha 305) para prometer el precio que de
// verdad se cobrara, asi que el numero con el que se calculo y el que el integrador mando
// pueden no ser el mismo: sin publicarlo, el desglose se lee como si no cuadrara.
// ---------------------------------------------------------------------------
describe("CotizacionOrdenService — el monto sobre el que se cotiza", () => {
  it("cada fila cotizada declara el monto que entro al calculo, en el dialecto crudo", async () => {
    const resumen = await cotizar([fila(), fila({ monto_cobrar: "48000" })]);

    expect(resumen.filas.map((f) => f.montoCobrar)).toEqual(["25900.00", "48000.00"]);
  });

  it("es el monto REDONDEADO, el mismo con el que se calculo la comision (ficha 305)", async () => {
    // El caso medido de la 299/305: `11898.81` se cobra como `11899`. Lo que este caso fija es
    // que el campo publicado y la base de la comision son el MISMO numero — publicar el crudo
    // recibido volveria a contar dos historias sobre el mismo dinero.
    const resumen = await cotizar([fila({ monto_cobrar: "11898.81" })]);

    expect(resumen.filas[0].montoCobrar).toBe("11899.00");
    const [entrada] = espiaDerivar.mock.calls[0];
    expect(entrada.montoCobrar).toBe("11899");
  });

  it("sin monto a cobrar publica el cero EXPLICITO, que es la base que uso la comision (R32)", async () => {
    // Ni ausente ni `null`: el cero se AFIRMA, igual que lo hace `comision` en el escenario
    // devuelto. Un campo que a veces esta y a veces no obliga a adivinar cual fue la base.
    const resumen = await cotizar([fila({ monto_cobrar: "" })]);

    expect(resumen.filas[0].montoCobrar).toBe("0.00");
    // Y el total entregado sale negativo: no hubo COD que cubriera lo facturado.
    expect(costosDe(resumen).entregado.total.startsWith("-")).toBe(true);
  });

  it("una fila en error no declara ningun monto: ahi no hubo cotizacion", async () => {
    const resumen = await cotizar([fila({ distrito: "Inexistente" })]);

    expect("montoCobrar" in resumen.errores[0]).toBe(false);
  });
});
