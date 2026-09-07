import { describe, expect, it, vi } from "vitest";

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
 * FICHA 383 (T5) — LA CARGA MASIVA, POR SUS DOS VIAS.
 *
 * Lo que se ancla aqui, y que ningun test de los que ya existian veria: una fila con un caracter
 * que la etiqueta NO puede imprimir. Hasta esta ficha entraba sin resistencia y el fallo aparecia
 * dias despues, al descargar el lote de etiquetas — con la 382, al menos, diciendo de que orden
 * era.
 *
 * Los literales van ESCAPADOS (`\u{1D560}` es el caracter double-struck medido en la orden de la
 * guia 11081885, el 2026-09-07) y los esperados son literales, nunca el resultado de llamar a la
 * funcion que se esta probando.
 */

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const APIKEY: Actor = { usuarioId: "key-user-1", rol: "apiKey" };

/** El caracter medido en produccion, y su reparacion. */
const DOUBLE_STRUCK_O = "\u{1D560}";
/** Irreparable: ninguna normalizacion vuelve imprimible un emoji. */
const EMOJI = "\u{1F642}";

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

function buildRepo(opciones: { omitidas?: string[]; overrides?: Partial<IOrdenRepository> } = {}) {
  const { omitidas = [], overrides = {} } = opciones;
  return {
    findUsuarioFulfillment: vi.fn().mockResolvedValue(false),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-1"),
    findExistingRemisiones: vi
      .fn()
      .mockResolvedValueOnce(new Map<string, string>())
      .mockResolvedValue(new Map<string, string>()),
    findAllProvincias: vi
      .fn()
      .mockResolvedValue([{ id: "p1", nombre: "Pichincha", disponible: true }]),
    findCantonesByProvinciaIds: vi
      .fn()
      .mockResolvedValue([{ id: "c1", nombre: "Quito", provinciaId: "p1", disponible: true }]),
    findDistritosByCantonIds: vi.fn().mockResolvedValue([
      {
        id: "d1",
        nombre: "La Mariscal",
        cantonId: "c1",
        zonaId: "z1",
        esCentral: false,
        disponible: true,
      },
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
function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton_distrito: "Quito (La Mariscal)",
    direccion: "avenida siempre viva 742",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
    ...overrides,
  };
}

/** Fila de la via API KEY (contrato publico de la 88, columnas separadas). */
function rowApi(overrides: Partial<RawRow> = {}): RawRow {
  return {
    num_remision: "REM-1",
    destinatario: "Ana",
    telefono: "0991234567",
    provincia: "Pichincha",
    canton: "Quito",
    distrito: "La Mariscal",
    direccion: "avenida siempre viva 742",
    producto: "Caja",
    notas: "",
    monto_cobrar: "",
    ...overrides,
  };
}

/** Lo que el servicio mando a persistir por la ruta CON guia (la que usa este archivo). */
function persistido(repo: IOrdenRepository): CreateOrdenData[] {
  const conGuia = repo.createManyOrdenesConGuia as ReturnType<typeof vi.fn>;
  if (conGuia.mock.calls.length === 0) return [];
  return conGuia.mock.calls[0][0] as CreateOrdenData[];
}

describe("383/R9 (T5.2a) — via SESION: el texto reparable entra REPARADO", () => {
  it("`𝕠rfirio` se crea, y lo que se manda a la base es `orfirio`", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [row({ destinatario: `${DOUBLE_STRUCK_O}rfirio` })],
      TIENDA,
    );

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("caso mal montado");
    expect(res.summary.creadas).toBe(1);
    expect(res.summary.conError).toBe(0);
    // Lo que IMPORTA: no basta con que la fila diga «creada». Lo que se escribe en la columna es
    // el texto reparado, y por eso se afirma sobre el `createData` que recibio el repositorio.
    expect(persistido(repo)[0].destinatario).toBe("orfirio");
  });

  it("y los otros tres campos reparables, igual", async () => {
    const repo = buildRepo();
    await buildService(repo).cargarMasiva(
      [
        row({
          telefono: `8888-${DOUBLE_STRUCK_O}`,
          producto: `caja \u{1D554}hica`,
          direccion: `avenida \u{1D55A}nvierno`,
        }),
      ],
      TIENDA,
    );

    const creada = persistido(repo)[0];
    expect(creada.telefonoDest).toBe("8888-o");
    expect(creada.producto).toBe("caja chica");
    expect(creada.direccion).toBe("avenida invierno");
  });
});

describe("383/R10 (T5.3) — la reparacion SE VE en la fila del resumen", () => {
  it("la fila creada trae `campo`, `original` y `aplicado`", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [row({ destinatario: `${DOUBLE_STRUCK_O}rfirio` })],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    // Literal completo: si alguien borra la emision del aviso, esto se pone rojo aunque la orden
    // se siga creando bien. Reparar en silencio es cambiar un fallo mudo por otro.
    expect(res.summary.filas[0].textoNormalizado).toEqual([
      { campo: "destinatario", original: `${DOUBLE_STRUCK_O}rfirio`, aplicado: "orfirio" },
    ]);
  });

  it("dos campos reparados en la misma fila: DOS avisos, en orden", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [row({ destinatario: `${DOUBLE_STRUCK_O}rfirio`, producto: `\u{1D554}aja` })],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    expect(res.summary.filas[0].textoNormalizado).toEqual([
      { campo: "destinatario", original: `${DOUBLE_STRUCK_O}rfirio`, aplicado: "orfirio" },
      { campo: "producto", original: "\u{1D554}aja", aplicado: "caja" },
    ]);
  });
});

describe("383/R13/R14 (T5.2b) — lo irreparable no entra, y el aviso dice cual y donde", () => {
  it("un emoji en el destinatario deja la fila en error bajo SU columna", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [row({ destinatario: `Ana ${EMOJI}` })],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    expect(res.summary.conError).toBe(1);
    expect(res.summary.creadas).toBe(0);
    const errores = res.summary.filas[0].errores ?? {};
    // La clave es la de la COLUMNA DEL ARCHIVO: es lo que hace que los chips y el XLSX de
    // errores (fichas 143/148) sigan funcionando sin tocar una linea suya.
    expect(Object.keys(errores)).toEqual(["destinatario"]);
    expect(errores.destinatario).toEqual([
      `El campo «destinatario» lleva un carácter que la etiqueta no puede imprimir: «\u2068${EMOJI}\u2069» (U+1F642). Reintentar no lo cambia: corrige esa celda y escríbela con letras y números normales.`,
    ]);
    // Y NO se persistio nada.
    expect(persistido(repo)).toEqual([]);
  });

  it("(T5.2e) dos campos rotos -> DOS claves en `errores`, no la primera y ya", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [row({ destinatario: `Ana ${EMOJI}`, direccion: `calle ${EMOJI}` })],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    expect(Object.keys(res.summary.filas[0].errores ?? {}).sort()).toEqual([
      "destinatario",
      "direccion",
    ]);
  });

  it("(T5.2d) lote de 3 con la del medio rota: 2 creadas y 1 error", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [
        row({ num_remision: "REM-1" }),
        row({ num_remision: "REM-2", destinatario: `Ana ${EMOJI}` }),
        row({ num_remision: "REM-3" }),
      ],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    expect(res.summary.creadas).toBe(2);
    expect(res.summary.conError).toBe(1);
    expect(res.summary.filas.map((f) => f.resultado)).toEqual(["creada", "error", "creada"]);
    expect(persistido(repo).map((d) => d.numRemision)).toEqual(["REM-1", "REM-3"]);
  });
});

describe("383/R12 (T5.2c) — `num_remision` NO se repara NUNCA", () => {
  it("una remision double-struck da ERROR, no una orden con otra remision", async () => {
    const repo = buildRepo();
    const rota = `REM-${DOUBLE_STRUCK_O}`;
    const res = await buildService(repo).cargarMasiva([row({ num_remision: rota })], TIENDA);
    if (res.status !== "ok") throw new Error("caso mal montado");

    expect(res.summary.conError).toBe(1);
    expect(Object.keys(res.summary.filas[0].errores ?? {})).toEqual(["num_remision"]);
    // La mentira que esto impide: crear la orden con `REM-o`, que la tienda no reconoceria y que
    // rompe el dedup y el round-trip del XLSX de errores.
    expect(persistido(repo)).toEqual([]);
  });

  it("y la remision que SI es imprimible se guarda tal cual", async () => {
    const repo = buildRepo();
    await buildService(repo).cargarMasiva([row({ num_remision: "REM-1042" })], TIENDA);
    expect(persistido(repo)[0].numRemision).toBe("REM-1042");
  });
});

describe("383/R16 (T5.5) — los campos que NO se evaluan", () => {
  it("un emoji SOLO en `notas`: la fila se crea y las notas se guardan con el emoji INTACTO", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [row({ notas: `dejar en porteria ${EMOJI}` })],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    expect(res.summary.creadas).toBe(1);
    // `notas` no se imprime en la etiqueta: ni se rechaza ni se repara.
    expect(persistido(repo)[0].notas).toBe(`dejar en porteria ${EMOJI}`);
    expect(res.summary.filas[0].textoNormalizado).toBeUndefined();
  });

  it("`provincia` con un emoji falla por GEOGRAFIA, no por caracter no imprimible", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [row({ provincia: `Pichincha ${EMOJI}` })],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    const errores = res.summary.filas[0].errores ?? {};
    expect(Object.keys(errores)).toEqual(["provincia"]);
    // Lo que se imprime es el nombre del CATALOGO, no el del archivo: este campo no entra en la
    // lista de la 383 y su fallo sigue siendo el de siempre.
    expect(errores.provincia?.[0]).not.toContain("no puede imprimir");
  });
});

describe("383/R21 (T5.4) — el aviso se CAE con la fila que no entro", () => {
  it("una fila reparada que la base descarto queda `duplicada` y SIN `textoNormalizado`", async () => {
    const repo = buildRepo({ omitidas: ["REM-1"] });
    const res = await buildService(repo).cargarMasiva(
      [row({ num_remision: "REM-1", destinatario: `${DOUBLE_STRUCK_O}rfirio` })],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    const fila = res.summary.filas[0];
    expect(fila.resultado).toBe("duplicada");
    // La leccion de la 294: decir «se reparo el nombre» de una orden que no se creo es
    // exactamente la mentira que aquella ficha vino a matar.
    expect(fila.textoNormalizado).toBeUndefined();
    expect("textoNormalizado" in fila).toBe(false);
  });
});

describe("383/R21 (T5.8) — una carga normal no gana NI UNA clave", () => {
  it("el `BulkSummary` de un lote sin caracteres raros es el de antes, byte a byte", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarMasiva(
      [row({ num_remision: "REM-1" }), row({ num_remision: "REM-2" })],
      TIENDA,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    // `toEqual` sobre el OBJETO COMPLETO, no sobre unas claves sueltas: es la unica forma de que
    // una clave nueva de mas ponga esto rojo (mismo criterio que la 304 aplico a `montoAjustado`).
    expect(res.summary).toEqual({
      total: 2,
      creadas: 2,
      duplicadas: 0,
      conError: 0,
      cargaId: "carga-1",
      filas: [
        { fila: 1, numRemision: "REM-1", resultado: "creada", estatus: "por_recolectar_en_tienda" },
        { fila: 2, numRemision: "REM-2", resultado: "creada", estatus: "por_recolectar_en_tienda" },
      ],
    });
  });
});

describe("383/R11 (T5.7) — el dry-run dice EXACTAMENTE lo que hara la carga en firme", () => {
  it("mismas filas, misma clasificacion y los mismos avisos", async () => {
    const filas = [
      row({ num_remision: "REM-1", destinatario: `${DOUBLE_STRUCK_O}rfirio` }),
      row({ num_remision: "REM-2", destinatario: `Ana ${EMOJI}` }),
      row({ num_remision: "REM-3" }),
    ];

    const repoPreview = buildRepo();
    const preview = await buildService(repoPreview).cargarMasiva(filas, TIENDA, { dryRun: true });
    const repoFirme = buildRepo();
    const firme = await buildService(repoFirme).cargarMasiva(filas, TIENDA);
    if (preview.status !== "ok" || firme.status !== "ok") throw new Error("caso mal montado");

    // El `cargaId` SI cambia (el dry-run no persiste, asi que no hay lote): se comparan las filas,
    // que es lo que el preview le enseña a la tienda antes de confirmar.
    expect(preview.summary.filas).toEqual(firme.summary.filas);
    expect(preview.summary.creadas).toBe(firme.summary.creadas);
    expect(preview.summary.conError).toBe(firme.summary.conError);
    expect(preview.summary.cargaId).toBeNull();
    // Y el preview NO escribio nada.
    expect(repoPreview.createManyOrdenesConGuia).not.toHaveBeenCalled();
    // Contenido, no solo forma: el aviso esta en las dos.
    expect(preview.summary.filas[0].textoNormalizado).toEqual([
      { campo: "destinatario", original: `${DOUBLE_STRUCK_O}rfirio`, aplicado: "orfirio" },
    ]);
  });
});

describe("383/R15 (T5.6) — la via API KEY, espejo", () => {
  it("repara igual: la orden se crea con `orfirio` y el aviso viaja en su fila", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarViaApi(
      [rowApi({ destinatario: `${DOUBLE_STRUCK_O}rfirio` })],
      APIKEY,
    );

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("caso mal montado");
    expect(res.summary.creadas).toBe(1);
    expect(persistido(repo)[0].destinatario).toBe("orfirio");
    expect(res.summary.filas[0].textoNormalizado).toEqual([
      { campo: "destinatario", original: `${DOUBLE_STRUCK_O}rfirio`, aplicado: "orfirio" },
    ]);
  });

  it("y rechaza igual: el error sale por `summary.errores[]`, con su clave y su mensaje", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarViaApi(
      [rowApi({ num_remision: "REM-1", destinatario: `Ana ${EMOJI}` }), rowApi({ num_remision: "REM-2" })],
      APIKEY,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    expect(res.summary.conError).toBe(1);
    expect(res.summary.creadas).toBe(1);
    expect(res.summary.errores).toEqual([
      {
        fila: 1,
        numRemision: "REM-1",
        resultado: "error",
        errores: {
          destinatario: [
            `El campo «destinatario» lleva un carácter que la etiqueta no puede imprimir: «\u2068${EMOJI}\u2069» (U+1F642). Reintentar no lo cambia: corrige esa celda y escríbela con letras y números normales.`,
          ],
        },
      },
    ]);
    // La otra fila del lote entra: un caracter raro no tumba el lote entero.
    expect(persistido(repo).map((d) => d.numRemision)).toEqual(["REM-2"]);
  });

  it("y `num_remision` tampoco se repara por esta via", async () => {
    const repo = buildRepo();
    const res = await buildService(repo).cargarViaApi(
      [rowApi({ num_remision: `REM-${DOUBLE_STRUCK_O}` })],
      APIKEY,
    );
    if (res.status !== "ok") throw new Error("caso mal montado");

    expect(res.summary.conError).toBe(1);
    expect(res.summary.errores[0].errores.num_remision).toHaveLength(1);
    expect(persistido(repo)).toEqual([]);
  });
});
