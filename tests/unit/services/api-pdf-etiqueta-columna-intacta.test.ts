import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ApiPdfEtiquetaService } from "@/lib/services/ApiPdfEtiquetaService";
import { EtiquetaGuiaService } from "@/lib/services/EtiquetaGuiaService";
import { EtiquetasLotePdfService } from "@/lib/services/EtiquetasLotePdfService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";

// Feature 177 — T22: test de "columna intacta" [R26, R35, R38].
//
// Que se demuestra: tras `/generate` (por ORDEN y por CARGA) la columna `download_url`
// conserva su valor previo y NINGUNA otra columna cambia (`estatus_id`, `num_guia`,
// `carga_id` en la orden; `name`/`total_files` en la carga), y no nace ninguna fila en el
// historial de estados (`OrdenHistorialEstado`).
//
// Como se demuestra, y por que asi: no se afirma sobre un mock del repositorio, porque eso
// solo probaria lo que el test cree que el repositorio hace. Se ejercita el camino REAL de
// escritura —`ApiPdfEtiquetaService` + `OrdenRepository` reales— contra un DOBLE DE PRISMA
// que intercepta TODOS los modelos y TODOS los metodos y REGISTRA cada escritura
// (`create`/`createMany`/`update`/`updateMany`/`upsert`/`delete`/`deleteMany`/`$executeRaw`...).
// Las escrituras registradas se APLICAN sobre la fila-fixture, de modo que "la columna quedo
// intacta" se comprueba sobre el estado final de la fila, no sobre una expectativa de llamada.
// Cualquier columna que el codigo tocara —hoy o manana, por el metodo que fuera— aparece en el
// registro y rompe la afirmacion de la lista COMPLETA de claves escritas.
//
// Dobles y por que: el generador de PDF (`EtiquetasLotePdfService`) y el armador de etiquetas
// (`EtiquetaGuiaService`) van REALES y forman parte del camino medido, precisamente porque son
// los candidatos naturales a escribir de mas: `EtiquetaGuiaService` solo consulta
// (`findEtiquetasByIds` -> `orden.findMany`) y `EtiquetasLotePdfService` no toca la base en
// absoluto (habla con Storage y con el firmador). Toda su interaccion con la base pasa por el
// espia, asi que si alguno escribiera, el test lo veria. Solo se sustituyen las fronteras que
// NO son base de datos: `IFileStorage` (red), `ISignedUrlProvider` (red) y el `build` de bytes
// del PDF (CPU puro, sin base), que `EtiquetasLotePdfService` ya acepta por constructor.

const TTL_SEG = 300;
const OWNER = "usuario-api-key-1";
const ORDEN_ID = "11111111-1111-4111-8111-111111111111";
const CARGA_ID = "22222222-2222-4222-8222-222222222222";
const ESTATUS_ID = "st-en-bodega-central";
const NUM_GUIA = 100234;

// URL firmada CADUCADA escrita por la feature 136/141: la fila heredada de R38.
const URL_HEREDADA_ORDEN =
  "https://proyecto.supabase.co/storage/v1/object/sign/etiquetas/vieja-orden.pdf?token=caducado";
const URL_HEREDADA_CARGA =
  "https://proyecto.supabase.co/storage/v1/object/sign/etiquetas/vieja-carga.pdf?token=caducado";

const ACTOR: Actor = { usuarioId: OWNER, rol: "apiKey" };

// --------------------------------------------------------------------------------------
// Doble de Prisma que registra TODAS las escrituras de TODOS los modelos
// --------------------------------------------------------------------------------------

interface Llamada {
  modelo: string;
  metodo: string;
  args: Record<string, unknown>;
}

/** Todo metodo del cliente Prisma capaz de MODIFICAR la base. */
const METODOS_ESCRITURA = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "executeRaw",
  "$executeRaw",
  "$executeRawUnsafe",
  "$queryRaw",
  "$queryRawUnsafe",
]);

type Fila = Record<string, unknown>;

interface Store {
  orden: Fila | null;
  carga: Fila | null;
}

function crearPrismaEspia(store: Store) {
  const llamadas: Llamada[] = [];

  function responder(modelo: string, metodo: string, args: Record<string, unknown>): unknown {
    const fila = modelo === "orden" ? store.orden : modelo === "carga" ? store.carga : null;
    switch (metodo) {
      case "findMany":
        return fila ? [fila] : [];
      case "findFirst":
      case "findUnique":
      case "findFirstOrThrow":
      case "findUniqueOrThrow":
        return fila;
      case "count":
        return fila ? 1 : 0;
      case "update":
      case "updateMany": {
        // La escritura se APLICA sobre la fila: el test comprueba el estado final, no solo
        // la intencion de la llamada.
        const data = (args?.data ?? {}) as Fila;
        if (fila) Object.assign(fila, data);
        return metodo === "update" ? fila : { count: fila ? 1 : 0 };
      }
      default:
        return null;
    }
  }

  const prisma = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        // Metodos de nivel raiz del cliente (`$executeRaw`, `$queryRaw`, `$transaction`...).
        if (prop.startsWith("$")) {
          return (...args: unknown[]) => {
            llamadas.push({ modelo: "$client", metodo: prop, args: { args } });
            return Promise.resolve([]);
          };
        }
        // Cualquier modelo, exista o no en el fixture: si el codigo lo tocara, queda registrado.
        return new Proxy(
          {},
          {
            get(_t, metodo) {
              if (typeof metodo !== "string") return undefined;
              return (args: Record<string, unknown> = {}) => {
                llamadas.push({ modelo: prop, metodo, args });
                return Promise.resolve(responder(prop, metodo, args));
              };
            },
          },
        );
      },
    },
  );

  const escrituras = () => llamadas.filter((l) => METODOS_ESCRITURA.has(l.metodo));
  const escriturasDe = (modelo: string) => escrituras().filter((l) => l.modelo === modelo);
  /** Todas las claves de columna que el codigo intento escribir, en cualquier modelo. */
  const clavesEscritas = () =>
    escrituras().flatMap((l) => Object.keys((l.args?.data ?? {}) as Fila));

  return { prisma, llamadas, escrituras, escriturasDe, clavesEscritas };
}

// --------------------------------------------------------------------------------------
// Fixtures: la fila HEREDADA de la 136/141 (download_url poblada, path NULL)
// --------------------------------------------------------------------------------------

function ordenHeredada(overrides: Fila = {}): Fila {
  return {
    id: ORDEN_ID,
    tiendaId: OWNER,
    numGuia: NUM_GUIA,
    numRemision: "REM-0001",
    estatusId: ESTATUS_ID,
    cargaId: CARGA_ID,
    destinatario: "Ana Perez",
    telefonoDest: "0991234567",
    direccion: "Calle 1",
    producto: "Caja",
    montoCobrar: new Prisma.Decimal(25.9),
    createdAt: new Date("2026-07-22T14:03:11.000Z"),
    downloadUrl: URL_HEREDADA_ORDEN, // R38: URL caducada de la 136
    downloadStoragePath: null, // ...y referencia nueva sin poblar
    estatus: { value: "en_bodega_central" },
    gestiones: [],
    // 268/R27 (2026-08-22): `API_ORDEN_DETALLE_SELECT` trae ahora tambien `incidentesAdmin` (la
    // segunda procedencia de las evidencias del incidente). Esta fila la lee
    // `findDetalleByOrdenIdForOwner`, asi que el mock tiene que devolver la relacion; el PDF de
    // etiquetas no la usa para nada.
    incidentesAdmin: [],
    tienda: { nombre: "Tienda Uno" },
    zona: { nombre: "GAM" },
    provincia: { nombre: "Pichincha" },
    canton: { nombre: "Quito" },
    distrito: { nombre: "Centro" },
    ...overrides,
  };
}

function cargaHeredada(overrides: Fila = {}): Fila {
  return {
    id: CARGA_ID,
    usuarioCarga: OWNER,
    name: "Lote de julio",
    totalFiles: 3,
    downloadUrl: URL_HEREDADA_CARGA, // R38: URL caducada de la 141
    downloadStoragePath: null,
    ordenes: [{ id: ORDEN_ID }],
    ...overrides,
  };
}

// --------------------------------------------------------------------------------------
// Montaje del camino REAL de escritura
// --------------------------------------------------------------------------------------

function montar(store: Store) {
  const espia = crearPrismaEspia(store);
  const repo = new OrdenRepository(espia.prisma as unknown as PrismaClient);

  const storage: IFileStorage = {
    upload: vi.fn(async (input) => input.path),
    remove: vi.fn(async () => undefined),
  };
  const signedUrls: ISignedUrlProvider = {
    createSignedUrl: vi.fn(async (path: string) => `https://firmada.test/${path}`),
    createSignedUrls: vi.fn(async () => ({})),
  };

  // REALES (parte del camino medido): arman el DTO y el PDF. `build` se sustituye por un
  // generador de bytes trivial porque es CPU pura sin base de datos.
  const lotePdf = new EtiquetasLotePdfService(
    new EtiquetaGuiaService(repo),
    storage,
    signedUrls,
    TTL_SEG,
    200,
    async () => new Uint8Array([37, 80, 68, 70]),
  );

  const service = new ApiPdfEtiquetaService(repo, lotePdf, signedUrls, TTL_SEG);
  return { service, storage, signedUrls, ...espia };
}

// --------------------------------------------------------------------------------------
// T22 — R26 / R35 / R38
// --------------------------------------------------------------------------------------

describe("feature 177 T22 — /generate no altera ninguna columna ajena a la referencia", () => {
  it("R26/R38: la orden heredada se genera y la UNICA escritura contra `orden` es un update de downloadStoragePath, con download_url intacta", async () => {
    const store: Store = { orden: ordenHeredada(), carga: null };
    const { service, escriturasDe } = montar(store);

    const res = await service.porOrden(ACTOR, ORDEN_ID);

    // R38: la fila heredada se trata como "sin PDF" -> genera (no devuelve la URL vieja).
    // Que HAYA generado se afirma abajo con la escritura observada; la respuesta ya no lo
    // cuenta (el testigo `generado` se retiro del contrato el 2026-08-25).
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.url).not.toBe(URL_HEREDADA_ORDEN);

    // R26: una sola escritura contra el modelo `orden`, y es un `update` de UNA columna.
    const escrituras = escriturasDe("orden");
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].metodo).toBe("update");
    expect(Object.keys(escrituras[0].args.data as Fila)).toEqual(["downloadStoragePath"]);
    expect(Object.keys(escrituras[0].args.data as Fila)).not.toContain("downloadUrl");

    // R26/R38: y la columna vieja sigue exactamente como estaba en la fila.
    expect(store.orden!.downloadUrl).toBe(URL_HEREDADA_ORDEN);
    expect(store.orden!.downloadStoragePath).toEqual(expect.any(String));
  });

  it("R26: tras /generate por orden no se escribio estatusId, numGuia ni cargaId — la lista COMPLETA de claves escritas es [downloadStoragePath]", async () => {
    const store: Store = { orden: ordenHeredada(), carga: null };
    const { service, escrituras, clavesEscritas } = montar(store);

    await service.porOrden(ACTOR, ORDEN_ID);

    // Ninguna escritura en ningun otro modelo del cliente Prisma.
    expect(escrituras().map((l) => `${l.modelo}.${l.metodo}`)).toEqual(["orden.update"]);
    // Lista COMPLETA de columnas escritas en toda la operacion.
    expect(clavesEscritas()).toEqual(["downloadStoragePath"]);
    for (const prohibida of ["downloadUrl", "estatusId", "numGuia", "cargaId"]) {
      expect(clavesEscritas()).not.toContain(prohibida);
    }

    // Y el estado final de la fila lo confirma columna a columna.
    expect(store.orden).toMatchObject({
      estatusId: ESTATUS_ID,
      numGuia: NUM_GUIA,
      cargaId: CARGA_ID,
      numRemision: "REM-0001",
      downloadUrl: URL_HEREDADA_ORDEN,
    });
  });

  it("R26: tras /generate por orden no nace ninguna fila en el historial de estados (ordenHistorialEstado)", async () => {
    const store: Store = { orden: ordenHeredada(), carga: null };
    const { service, llamadas, escriturasDe } = montar(store);

    await service.porOrden(ACTOR, ORDEN_ID);

    expect(escriturasDe("ordenHistorialEstado")).toEqual([]);
    // Explicito sobre los dos metodos con los que se insertan transiciones.
    const inserciones = llamadas.filter(
      (l) => l.modelo === "ordenHistorialEstado" && ["create", "createMany"].includes(l.metodo),
    );
    expect(inserciones).toHaveLength(0);
    // Ni tampoco en los modelos vecinos que registran actividad de la orden.
    expect(escriturasDe("gestionOrden")).toEqual([]);
    expect(escriturasDe("$client")).toEqual([]);
  });

  it("R35/R38: la carga heredada se genera y la UNICA escritura contra `carga` es un update de downloadStoragePath, con download_url, name y total_files intactos", async () => {
    const store: Store = { orden: ordenHeredada(), carga: cargaHeredada() };
    const { service, escriturasDe, clavesEscritas } = montar(store);

    const res = await service.porCarga(ACTOR, CARGA_ID);

    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.url).not.toBe(URL_HEREDADA_CARGA);

    const escrituras = escriturasDe("carga");
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].metodo).toBe("update");
    expect(Object.keys(escrituras[0].args.data as Fila)).toEqual(["downloadStoragePath"]);

    // R35: la carga conserva TODO lo demas...
    expect(store.carga).toMatchObject({
      downloadUrl: URL_HEREDADA_CARGA,
      name: "Lote de julio",
      totalFiles: 3,
      usuarioCarga: OWNER,
    });
    // ...y las ordenes del lote no se tocan (el consolidado no escribe en ellas).
    expect(escriturasDe("orden")).toEqual([]);
    expect(store.orden!.downloadUrl).toBe(URL_HEREDADA_ORDEN);
    expect(store.orden!.downloadStoragePath).toBeNull();
    expect(clavesEscritas()).toEqual(["downloadStoragePath"]);
  });

  it("R21/R31: con la referencia ya persistida la segunda invocacion NO escribe absolutamente nada (ni orden ni carga)", async () => {
    const store: Store = {
      orden: ordenHeredada({ downloadStoragePath: `${OWNER}/orden-ya-generada.pdf` }),
      carga: cargaHeredada({ downloadStoragePath: `${OWNER}/lote-ya-generado.pdf` }),
    };
    const { service, escrituras, escriturasDe } = montar(store);

    const porOrden = await service.porOrden(ACTOR, ORDEN_ID);
    const porCarga = await service.porCarga(ACTOR, CARGA_ID);

    // El reuso ya NO se lee de la respuesta: se demuestra con que no hubo NINGUNA escritura.
    expect(porOrden).toMatchObject({ status: "ok" });
    expect(porCarga).toMatchObject({ status: "ok" });

    expect(escriturasDe("orden")).toEqual([]);
    expect(escriturasDe("carga")).toEqual([]);
    expect(escrituras()).toEqual([]);

    // Y las filas siguen byte a byte como estaban.
    expect(store.orden!.downloadUrl).toBe(URL_HEREDADA_ORDEN);
    expect(store.orden!.downloadStoragePath).toBe(`${OWNER}/orden-ya-generada.pdf`);
    expect(store.carga).toMatchObject({
      downloadUrl: URL_HEREDADA_CARGA,
      name: "Lote de julio",
      totalFiles: 3,
      downloadStoragePath: `${OWNER}/lote-ya-generado.pdf`,
    });
  });
});
