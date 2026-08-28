import { describe, it, expect, vi } from "vitest";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import type {
  CreateOrdenData,
  IOrdenRepository,
  LoteContexto,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";

/**
 * FEATURE 294 — UNA FILA QUE NO ENTRA APARECE EN EL RESUMEN.
 *
 * QUE SE PRUEBA AQUI Y QUE NO. El indice (que una remision borrada libere su numero) se prueba
 * contra Postgres, en `tests/integration/db/orden-remision-borrada-libera-numero.test.ts`: con
 * dobles no se puede, porque un doble no tiene indices. Lo que se prueba AQUI es la otra mitad
 * del defecto, que es puro servicio: `createMany({ skipDuplicates })` puede tragarse una fila
 * SIN error, y hasta esta ficha el resumen seguia contandola como `creada`. Una tienda real
 * confirmo la carga de 3 ordenes y no aparecio ninguna, sin un solo mensaje.
 *
 * El contrato que se ancla: si el repositorio devuelve la fila en `omitidas`, el summary la
 * cuenta como `duplicada` —nunca como `creada`— en LAS DOS VIAS (sesion y API key) y en LAS DOS
 * rutas de lote. Con el reporte quitado, todos los casos de este archivo caen.
 */

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const APIKEY: Actor = { usuarioId: "key-user-1", rol: "apiKey" };

const TARIFA_STUB: TarifaVigenteResuelta = {
  tarifaId: "t-stub",
  fulfillment: "0.00",
  valorFlete: "3.50",
  valorFleteGam: "5.00",
  valorFleteDevuelto: "1.00",
  valorFleteDevueltoGam: "2.00",
  comisionCod: "5.00",
  ivaFlete: "12.00",
  ivaComisionCod: "12.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

const tarifaRepoStub: ITarifaVigenteRepository = {
  resolveTarifa: vi.fn(async () => TARIFA_STUB),
  resolveTarifas: vi.fn(
    async (pares: readonly ParTarifa[]) =>
      new Map<string, TarifaVigenteResuelta | null>(pares.map((p) => [clavePar(p), TARIFA_STUB])),
  ),
};

/**
 * Doble del repositorio con UN pomo: `omitidas`, las remisiones que la base descarto.
 *
 * `findExistingRemisiones` se comporta como el metodo real: solo ve ordenes VIVAS. Se le pasa
 * `estatusDeLoOmitido` para poder distinguir los dos escenarios —el numero lo ocupa una orden
 * viva (hay estatus que reportar) o no lo ocupa nada visible (no lo hay)—.
 */
function buildRepo(opciones: {
  omitidas: string[];
  fulfillment?: boolean;
  estatusDeLoOmitido?: string;
  overrides?: Partial<IOrdenRepository>;
}): IOrdenRepository {
  const { omitidas, fulfillment = false, estatusDeLoOmitido, overrides = {} } = opciones;
  return {
    findUsuarioFulfillment: vi.fn().mockResolvedValue(fulfillment),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-1"),
    // Antes de insertar NO existe nada (si existiera, la fila saldria `duplicada` por el
    // pre-chequeo y este archivo no probaria nada). DESPUES —la segunda llamada, la que hace
    // `reclasificarOmitidas`— el numero puede estar ocupado por una orden viva.
    findExistingRemisiones: vi
      .fn()
      .mockResolvedValueOnce(new Map<string, string>())
      .mockResolvedValue(
        estatusDeLoOmitido === undefined
          ? new Map<string, string>()
          : new Map<string, string>(omitidas.map((r) => [r, estatusDeLoOmitido])),
      ),
    findAllProvincias: vi.fn().mockResolvedValue([{ id: "p1", nombre: "Pichincha" }]),
    findCantonesByProvinciaIds: vi
      .fn()
      .mockResolvedValue([{ id: "c1", nombre: "Quito", provinciaId: "p1" }]),
    findDistritosByCantonIds: vi
      .fn()
      .mockResolvedValue([
        { id: "d1", nombre: "La Mariscal", cantonId: "c1", zonaId: "z1", esCentral: false },
      ]),
    setCargaDownloadUrl: vi.fn(async () => {}),
    setOrdenesDownloadUrl: vi.fn(async () => {}),
    createManyOrdenes: vi.fn(
      async (data: CreateOrdenData[], _b: number, _h: unknown, lote: LoteContexto) => ({
        inserted: data.filter((d) => !omitidas.includes(d.numRemision)).length,
        cargaId: lote.cargaId ?? "carga-1",
        omitidas: data.filter((d) => omitidas.includes(d.numRemision)).map((d) => d.numRemision),
      }),
    ),
    createManyOrdenesConGuia: vi.fn(
      async (data: CreateOrdenData[], _b: number, _h: unknown, lote: LoteContexto) => ({
        creadas: data
          .filter((d) => !omitidas.includes(d.numRemision))
          .map((d, i) => ({
            ordenId: `o-${d.numRemision}`,
            numRemision: d.numRemision,
            numGuia: 1000 + i,
            estatusValue: "por_recolectar_en_tienda",
          })),
        cargaId: lote.cargaId ?? "carga-1",
        omitidas: data.filter((d) => omitidas.includes(d.numRemision)).map((d) => d.numRemision),
      }),
    ),
    ...overrides,
  } as unknown as IOrdenRepository;
}

function buildService(repo: IOrdenRepository): BulkOrdenService {
  return new BulkOrdenService(repo, tarifaRepoStub);
}

/** Fila de la via SESION (plantilla v3). */
function row(numRemision: string): RawRow {
  return {
    num_remision: numRemision,
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton_distrito: "Quito (La Mariscal)",
    direccion: "",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
  };
}

/** Fila de la via API KEY (contrato publico de la 88, columnas separadas). */
function rowApi(numRemision: string): RawRow {
  return {
    num_remision: numRemision,
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito: "La Mariscal",
    direccion: "",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
  };
}

describe("294 — via SESION: la fila que la base descarto no se cuenta como creada", () => {
  // Las dos ramas de la bifurcacion de la 155: `false` -> ruta CON guia; `true` -> la otra.
  for (const fulfillment of [false, true]) {
    const ruta = fulfillment ? "createManyOrdenes" : "createManyOrdenesConGuia";

    it(`(${ruta}) la omitida sale como \`duplicada\` y NO suma en \`creadas\``, async () => {
      const repo = buildRepo({
        omitidas: ["R-2"],
        fulfillment,
        estatusDeLoOmitido: "en_preparacion",
      });
      const res = await buildService(repo).cargarMasiva([row("R-1"), row("R-2")], TIENDA);

      expect(res.status).toBe("ok");
      if (res.status !== "ok") return;
      expect(res.summary.creadas).toBe(1);
      expect(res.summary.duplicadas).toBe(1);
      expect(res.summary.total).toBe(2);
      const fila = res.summary.filas.find((f) => f.numRemision === "R-2");
      expect(fila?.resultado).toBe("duplicada");
      // El estatus reportado es el de la orden que OCUPA el numero, no el inicial del lote.
      expect(fila?.estatus).toBe("en_preparacion");
      // La que si entro sigue intacta.
      expect(res.summary.filas.find((f) => f.numRemision === "R-1")?.resultado).toBe("creada");
    });

    it(`(${ruta}) si no se resuelve el estatus real, NO se repite el inicial del lote`, async () => {
      // Decir «creada en <estado inicial>» sobre una fila que no se creo es la mentira que esta
      // ficha viene a matar; sin dato, se omite el campo.
      const repo = buildRepo({ omitidas: ["R-1"], fulfillment });
      const res = await buildService(repo).cargarMasiva([row("R-1")], TIENDA);

      if (res.status !== "ok") throw new Error("esperaba ok");
      expect(res.summary.creadas).toBe(0);
      expect(res.summary.duplicadas).toBe(1);
      const fila = res.summary.filas[0];
      expect(fila.resultado).toBe("duplicada");
      expect(fila.estatus).toBeUndefined();
    });
  }

  it("sin omitidas no se consulta la base de mas: `findExistingRemisiones` se llama UNA vez", async () => {
    const repo = buildRepo({ omitidas: [] });
    await buildService(repo).cargarMasiva([row("R-1")], TIENDA);
    expect(repo.findExistingRemisiones).toHaveBeenCalledTimes(1); // solo el pre-chequeo
  });

  it("dry-run: no se persiste nada, asi que no hay nada que reclasificar", async () => {
    const repo = buildRepo({ omitidas: ["R-1"] });
    const res = await buildService(repo).cargarMasiva([row("R-1")], TIENDA, { dryRun: true });

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.summary.creadas).toBe(1);
    expect(res.summary.duplicadas).toBe(0);
  });
});

describe("294 — via API KEY (contrato publico de la 88)", () => {
  it("la omitida sale como `duplicada`, sin numGuia y fuera del bloque `ordenes`", async () => {
    const repo = buildRepo({ omitidas: ["R-2"], estatusDeLoOmitido: "en_bodega_central" });
    const res = await buildService(repo).cargarViaApi([rowApi("R-1"), rowApi("R-2")], APIKEY);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.summary.creadas).toBe(1);
    expect(res.summary.duplicadas).toBe(1);

    const omitida = res.summary.filas.find((f) => f.numRemision === "R-2");
    expect(omitida?.resultado).toBe("duplicada");
    expect(omitida?.estatus).toBe("en_bodega_central");
    // ESTE era el agujero de la via API: la fila se quedaba `creada` SIN guia y sin entrada en
    // `ordenes`, o sea un `creada` que el integrador no podia rastrear ni imprimir.
    expect(omitida?.numGuia).toBeUndefined();
    expect(res.summary.ordenes.map((o) => o.numRemision)).toEqual(["R-1"]);
    expect(res.manifiestoOrdenIds).toEqual(["o-R-1"]);
  });

  it("la fila que SI entro conserva su numGuia y su entrada en `ordenes`", async () => {
    const repo = buildRepo({ omitidas: ["R-2"] });
    const res = await buildService(repo).cargarViaApi([rowApi("R-1"), rowApi("R-2")], APIKEY);

    if (res.status !== "ok") throw new Error("esperaba ok");
    const creada = res.summary.filas.find((f) => f.numRemision === "R-1");
    expect(creada?.resultado).toBe("creada");
    expect(creada?.numGuia).toBe(1000);
    expect(res.summary.ordenes).toHaveLength(1);
  });

  it("el lote ENTERO descartado: cero creadas, todas duplicadas, y el total no se mueve", async () => {
    const repo = buildRepo({ omitidas: ["R-1", "R-2"] });
    const res = await buildService(repo).cargarViaApi([rowApi("R-1"), rowApi("R-2")], APIKEY);

    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.summary.total).toBe(2);
    expect(res.summary.creadas).toBe(0);
    expect(res.summary.duplicadas).toBe(2);
    expect(res.summary.conError).toBe(0);
    expect(res.summary.ordenes).toEqual([]);
    expect(res.manifiestoOrdenIds).toEqual([]);
  });
});
