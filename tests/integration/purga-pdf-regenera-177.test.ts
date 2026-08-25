// Feature 178 — T23/T24 [R16]: test de integracion de EXTREMO A EXTREMO DEL ESTADO DE DATOS
// entre la purga (178) y `/generate` (177).
//
// POR QUE existe: `ApiPdfEtiquetaService` decide "el PDF existe" SOLO por
// `download_storage_path` y, si viene con valor, RE-FIRMA sin comprobar que el objeto siga en el
// bucket (`lib/services/ApiPdfEtiquetaService.ts:50-51,90`). Si la purga limpiase unicamente
// `download_url`, el integrador recibiria un `200 { url }` re-firmado sobre un objeto YA BORRADO
// — un 404 al descargar. R16 lo prohibe.
//
// CLAVE DE DISEÑO: el eslabon entre las dos features es el **estado de datos compartido**, no una
// expectativa hardcodeada. Un unico `EstadoDatos` (arrays `cargas` / `ordenes`) esta detras a la
// vez del doble de Prisma que consume el `PurgaPdfCargasRepository` REAL y del doble del
// `IOrdenRepository` que consume el `ApiPdfEtiquetaService` REAL. Las filas que muta
// `limpiarReferencias` son literalmente las mismas que lee la 177 despues. Con dos dobles
// independientes el test seria falso.
//
// Piezas REALES bajo prueba: `PurgaPdfCargasService` + `PurgaPdfCargasRepository` +
// `ApiPdfEtiquetaService` + los dos handlers de ruta de la 177. Dobles: Prisma (estado mutable en
// memoria), Storage (bucket en memoria), generador de PDF y firmador de URLs.
import { describe, it, expect, vi } from "vitest";
import { handleCargaGenerateApi } from "@/app/api/ordenes/api-key/carga/[cargaId]/generate/route";
import { handleGenerarPdfOrdenApi } from "@/app/api/ordenes/api-key/orden/[id]/generate/route";
import { PurgaPdfCargasRepository } from "@/lib/repositories/PurgaPdfCargasRepository";
import { PurgaPdfCargasService } from "@/lib/services/PurgaPdfCargasService";
import { ApiPdfEtiquetaService } from "@/lib/services/ApiPdfEtiquetaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenResolucionService } from "@/lib/interfaces/services/IApiOrdenResolucionService";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  EtiquetaOrdenPdfResultado,
  EtiquetasLotePdfResultado,
  IEtiquetasLotePdfService,
} from "@/lib/interfaces/services/IEtiquetasLotePdfService";
import type { ApiOrdenDetalleRow } from "@/lib/interfaces/repositories/IOrdenRepository";

const OWNER = "store-1";
const ACTOR: Actor = { usuarioId: OWNER, rol: "apiKey" };
const AUTH_OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };
const SECRETO = "ordx_secretovivo1234567890";
const TTL = 300;

const CARGA_ID = "11111111-1111-4111-8111-111111111111";
const ORDEN_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/** Rutas del estado inicial: objetos que la purga DEBE borrar y desreferenciar. */
const PATH_CARGA_ORIGINAL = `${OWNER}/lote-original.pdf`;
const PATH_ORDEN_ORIGINAL = `${OWNER}/orden-original.pdf`;

// ---------------------------------------------------------------------------
// Estado de datos compartido
// ---------------------------------------------------------------------------

interface CargaRow {
  id: string;
  usuarioCarga: string;
  createdAt: Date;
  downloadUrl: string | null;
  downloadStoragePath: string | null;
}

interface OrdenRow {
  id: string;
  cargaId: string | null;
  tiendaId: string;
  deletedAt: Date | null;
  numGuia: number | null;
  downloadUrl: string | null;
  downloadStoragePath: string | null;
}

interface EstadoDatos {
  cargas: CargaRow[];
  ordenes: OrdenRow[];
}

// ---------------------------------------------------------------------------
// Doble de Prisma sobre el estado compartido
//
// NO reimplementa la logica del repositorio: INTERPRETA el `where` que el repositorio real
// construye. Cualquier filtro que el repo empiece a emitir y este interprete no conozca revienta
// con un error explicito en vez de pasar de largo (que es como un doble laxo vuelve verde un test
// que deberia estar rojo).
// ---------------------------------------------------------------------------

type Filtro = Record<string, unknown>;

function esNotNull(cond: unknown): boolean {
  return typeof cond === "object" && cond !== null && "not" in cond && (cond as Filtro).not === null;
}

function casaOrden(orden: OrdenRow, where: Filtro): boolean {
  return Object.entries(where).every(([clave, valor]) => {
    switch (clave) {
      case "OR":
        return (valor as Filtro[]).some((sub) => casaOrden(orden, sub));
      case "downloadStoragePath":
        if (!esNotNull(valor)) throw new Error(`filtro de orden no soportado: ${clave}`);
        return orden.downloadStoragePath !== null;
      case "downloadUrl":
        if (!esNotNull(valor)) throw new Error(`filtro de orden no soportado: ${clave}`);
        return orden.downloadUrl !== null;
      case "cargaId": {
        if (typeof valor === "string") return orden.cargaId === valor;
        const dentro = (valor as { in?: string[] }).in;
        if (!dentro) throw new Error(`filtro de orden no soportado: ${clave}`);
        return orden.cargaId !== null && dentro.includes(orden.cargaId);
      }
      default:
        throw new Error(`filtro de orden no soportado: ${clave}`);
    }
  });
}

function casaCarga(estado: EstadoDatos, carga: CargaRow, where: Filtro): boolean {
  return Object.entries(where).every(([clave, valor]) => {
    switch (clave) {
      case "OR":
        return (valor as Filtro[]).some((sub) => casaCarga(estado, carga, sub));
      case "createdAt": {
        const lte = (valor as { lte?: Date }).lte;
        if (!lte) throw new Error(`filtro de carga no soportado: ${clave}`);
        return carga.createdAt.getTime() <= lte.getTime();
      }
      case "downloadStoragePath":
        if (!esNotNull(valor)) throw new Error(`filtro de carga no soportado: ${clave}`);
        return carga.downloadStoragePath !== null;
      case "downloadUrl":
        if (!esNotNull(valor)) throw new Error(`filtro de carga no soportado: ${clave}`);
        return carga.downloadUrl !== null;
      case "ordenes": {
        const some = (valor as { some?: Filtro }).some;
        if (!some) throw new Error(`filtro de carga no soportado: ${clave}`);
        return estado.ordenes
          .filter((o) => o.cargaId === carga.id)
          .some((o) => casaOrden(o, some));
      }
      default:
        throw new Error(`filtro de carga no soportado: ${clave}`);
    }
  });
}

interface ArgsFindMany {
  where: Filtro;
  orderBy?: unknown;
  take?: number;
  skip?: number;
  select?: Record<string, boolean>;
}

/** Aplica un `data` de UPDATE (solo las columnas testigo, R15) sobre una fila del estado. */
function aplicarData(fila: { downloadUrl: string | null; downloadStoragePath: string | null }, data: Filtro): void {
  for (const [clave, valor] of Object.entries(data)) {
    if (clave === "downloadUrl") fila.downloadUrl = valor as string | null;
    else if (clave === "downloadStoragePath") fila.downloadStoragePath = valor as string | null;
    else throw new Error(`columna no esperada en el UPDATE de la purga: ${clave}`);
  }
}

type PrismaPurga = ConstructorParameters<typeof PurgaPdfCargasRepository>[0];

function prismaDoble(estado: EstadoDatos): PrismaPurga {
  const cargasOrdenadas = (where: Filtro): CargaRow[] =>
    estado.cargas
      .filter((c) => casaCarga(estado, c, where))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const cliente = {
    carga: {
      findMany: async (args: ArgsFindMany) => {
        const filas = cargasOrdenadas(args.where).slice(0, args.take ?? undefined);
        return filas.map((c) => ({ id: c.id, downloadStoragePath: c.downloadStoragePath }));
      },
      findFirst: async (args: ArgsFindMany) => {
        const filas = cargasOrdenadas(args.where).slice(args.skip ?? 0);
        const primera = filas[0];
        return primera ? { id: primera.id } : null;
      },
      update: async (args: { where: { id: string }; data: Filtro }) => {
        const carga = estado.cargas.find((c) => c.id === args.where.id);
        if (!carga) throw new Error(`carga inexistente en el doble: ${args.where.id}`);
        aplicarData(carga, args.data);
        return { id: carga.id };
      },
    },
    orden: {
      findMany: async (args: ArgsFindMany) => {
        return estado.ordenes
          .filter((o) => casaOrden(o, args.where))
          .map((o) => ({ cargaId: o.cargaId, downloadStoragePath: o.downloadStoragePath }));
      },
      updateMany: async (args: { where: Filtro; data: Filtro }) => {
        const afectadas = estado.ordenes.filter((o) => casaOrden(o, args.where));
        for (const o of afectadas) aplicarData(o, args.data);
        return { count: afectadas.length };
      },
    },
    // Sin aislamiento real: la transaccion se ejecuta contra el MISMO estado en memoria.
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(cliente),
  };
  return cliente as unknown as PrismaPurga;
}

// ---------------------------------------------------------------------------
// Doble del bucket: registra que objetos existen realmente
// ---------------------------------------------------------------------------

function bucketDoble(objetos: Set<string>): IFileStorage {
  return {
    upload: vi.fn(),
    remove: async (paths: string[]) => {
      for (const p of paths) objetos.delete(p);
    },
  };
}

// ---------------------------------------------------------------------------
// Doble del generador de PDF: cada llamada SUBE un objeto nuevo con ruta nueva
// ---------------------------------------------------------------------------

interface GeneradorDoble {
  service: IEtiquetasLotePdfService;
  /** Rutas devueltas por el generador, en orden de invocacion. */
  rutasGeneradas: string[];
}

function generadorDoble(objetos: Set<string>): GeneradorDoble {
  const rutasGeneradas: string[] = [];
  let n = 0;

  const subir = (prefijo: string): string => {
    n += 1;
    const path = `${OWNER}/${prefijo}-regenerado-${n}.pdf`;
    objetos.add(path); // el objeto pasa a existir en ESTA llamada
    rutasGeneradas.push(path);
    return path;
  };

  const service: IEtiquetasLotePdfService = {
    generarYAlmacenar: vi.fn(async (): Promise<EtiquetasLotePdfResultado> => {
      const path = subir("lote");
      return { path, signedUrl: `https://storage.test/generador/${path}`, expiraEnSegundos: TTL };
    }),
    generarYAlmacenarPorOrden: vi.fn(async (ordenIds: string[]): Promise<EtiquetaOrdenPdfResultado[]> =>
      ordenIds.map((ordenId) => {
        const path = subir("orden");
        return {
          ordenId,
          path,
          signedUrl: `https://storage.test/generador/${path}`,
          expiraEnSegundos: TTL,
        };
      }),
    ),
  };

  return { service, rutasGeneradas };
}

// ---------------------------------------------------------------------------
// Doble del firmador: la URL lleva la ruta dentro, para poder leerla de vuelta
// ---------------------------------------------------------------------------

const PREFIJO_FIRMA = "https://storage.test/object/sign/etiquetas-guia/";

function firmadorDoble(): ISignedUrlProvider {
  return {
    createSignedUrl: async (path: string, ttl: number) =>
      `${PREFIJO_FIRMA}${path}?ttl=${ttl}&token=firmado`,
    createSignedUrls: vi.fn(),
  };
}

/** Ruta del objeto que hay DETRAS de una URL firmada por el doble. */
function rutaFirmada(url: string): string {
  return url.slice(PREFIJO_FIRMA.length).split("?")[0];
}

// ---------------------------------------------------------------------------
// Doble del `IOrdenRepository` de la 177, SOBRE EL MISMO estado de datos
// ---------------------------------------------------------------------------

function detalleDe(orden: OrdenRow): ApiOrdenDetalleRow {
  return {
    numGuia: orden.numGuia,
    numRemision: `REM-${orden.id.slice(0, 4)}`,
    estatusValue: "por_recolectar_en_tienda",
    destinatario: "Destinatario",
    telefonoDest: "88880000",
    producto: "Producto",
    direccion: "Direccion",
    montoCobrar: null,
    createdAt: new Date("2026-06-04T09:00:00.000Z"),
    evidencias: [],
  };
}

function repo177(estado: EstadoDatos) {
  const ordenPropia = (ordenId: string, ownerId: string): OrdenRow | undefined =>
    estado.ordenes.find((o) => o.id === ordenId && o.tiendaId === ownerId && o.deletedAt === null);

  return {
    findDownloadStoragePathByOrdenForOwner: async (ordenId: string, ownerId: string) =>
      ordenPropia(ordenId, ownerId)?.downloadStoragePath ?? null,
    findDetalleByOrdenIdForOwner: async (ordenId: string, ownerId: string) => {
      const orden = ordenPropia(ordenId, ownerId);
      return orden ? detalleDe(orden) : null;
    },
    setOrdenDownloadStoragePath: async (ordenId: string, path: string) => {
      const orden = estado.ordenes.find((o) => o.id === ordenId);
      if (orden) orden.downloadStoragePath = path;
    },
    findCargaConOrdenesForOwner: async (cargaId: string, ownerId: string) => {
      const carga = estado.cargas.find((c) => c.id === cargaId && c.usuarioCarga === ownerId);
      if (!carga) return null;
      return {
        downloadStoragePath: carga.downloadStoragePath,
        ordenIds: estado.ordenes
          .filter((o) => o.cargaId === cargaId && o.tiendaId === ownerId && o.deletedAt === null)
          .map((o) => o.id),
      };
    },
    setCargaDownloadStoragePath: async (cargaId: string, path: string) => {
      const carga = estado.cargas.find((c) => c.id === cargaId);
      if (carga) carga.downloadStoragePath = path;
    },
  };
}

/** Resolucion del identificador libre de la 177 contra el mismo estado (no es lo que mide R16). */
function resolucionDoble(estado: EstadoDatos): IApiOrdenResolucionService {
  return {
    resolver: async (actor: Actor, identificador: string) => {
      const orden = estado.ordenes.find(
        (o) => o.id === identificador && o.tiendaId === actor.usuarioId && o.deletedAt === null,
      );
      return orden
        ? ({ status: "ok", orden: { id: orden.id, numGuia: orden.numGuia }, via: "num_guia" } as const)
        : ({ status: "not_found" } as const);
    },
  };
}

// ---------------------------------------------------------------------------
// Montaje: UN estado, dos features encima
// ---------------------------------------------------------------------------

/** `now` de la corrida y `createdAt` de la carga: 60 dias de antiguedad -> candidata con N=7. */
const AHORA = new Date("2026-08-03T09:00:00.000Z");
const CREADA_HACE_60_DIAS = new Date("2026-06-04T09:00:00.000Z");

function montar() {
  const estado: EstadoDatos = {
    cargas: [
      {
        id: CARGA_ID,
        usuarioCarga: OWNER,
        createdAt: CREADA_HACE_60_DIAS,
        // Como en produccion: las DOS columnas testigo pobladas.
        downloadUrl: `${PREFIJO_FIRMA}${PATH_CARGA_ORIGINAL}?ttl=3600`,
        downloadStoragePath: PATH_CARGA_ORIGINAL,
      },
    ],
    ordenes: [
      {
        id: ORDEN_ID,
        cargaId: CARGA_ID,
        tiendaId: OWNER,
        deletedAt: null,
        numGuia: 1042,
        downloadUrl: `${PREFIJO_FIRMA}${PATH_ORDEN_ORIGINAL}?ttl=3600`,
        downloadStoragePath: PATH_ORDEN_ORIGINAL,
      },
    ],
  };

  // Bucket con los dos objetos originales realmente presentes.
  const objetos = new Set<string>([PATH_CARGA_ORIGINAL, PATH_ORDEN_ORIGINAL]);
  const storage = bucketDoble(objetos);
  const generador = generadorDoble(objetos);

  // 178 REAL sobre el estado.
  const purga = new PurgaPdfCargasService(
    new PurgaPdfCargasRepository(prismaDoble(estado)),
    storage,
    () => ({ PURGA_PDF_RETENCION_DIAS: 7, PURGA_PDF_MAX_CARGAS_POR_CORRIDA: 200 }),
  );

  // 177 REAL sobre EL MISMO estado.
  const pdfService = new ApiPdfEtiquetaService(
    repo177(estado),
    generador.service,
    firmadorDoble(),
    TTL,
  );

  const autenticar = async (): Promise<ApiKeyAuthResult> => AUTH_OK;

  const generateCarga = () =>
    handleCargaGenerateApi(
      new Request(`http://localhost/api/ordenes/api-key/carga/${CARGA_ID}/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRETO}` },
      }),
      CARGA_ID,
      { autenticar, pdfService },
    );

  const generateOrden = () =>
    handleGenerarPdfOrdenApi(
      new Request(`http://localhost/api/ordenes/api-key/orden/${ORDEN_ID}/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRETO}` },
      }),
      ORDEN_ID,
      { autenticar, pdfService, resolucionService: resolucionDoble(estado) },
    );

  return { estado, objetos, purga, generador, generateCarga, generateOrden };
}

// ---------------------------------------------------------------------------
// T24 — control discriminante (ANTES de la purga)
// ---------------------------------------------------------------------------

describe("Feature 178 x 177 — /generate ANTES de la purga (R16, control discriminante)", () => {
  it("R16 T24: antes de la purga /generate de carga y de orden devuelven 200 reusando la referencia viva y NO invocan al generador", async () => {
    const { generador, generateCarga, generateOrden } = montar();

    const resCarga = await generateCarga();
    const resOrden = await generateOrden();

    expect(resCarga.status).toBe(200);
    expect(resOrden.status).toBe(200);

    const jsonCarga = await resCarga.json();
    const jsonOrden = await resOrden.json();

    // Reuso puro: solo se re-firma la referencia viva. Se comprueba por la RUTA firmada y por
    // el generador sin invocar, no por un testigo en el cuerpo: `generado` se retiro del
    // contrato el 2026-08-25 y la respuesta ya no distingue reuso de construccion.
    expect(rutaFirmada(jsonCarga.url)).toBe(PATH_CARGA_ORIGINAL);
    expect(rutaFirmada(jsonOrden.url)).toBe(PATH_ORDEN_ORIGINAL);

    // Sin este control, T23 pasaria aunque la purga no hiciera absolutamente nada.
    expect(generador.service.generarYAlmacenar).not.toHaveBeenCalled();
    expect(generador.service.generarYAlmacenarPorOrden).not.toHaveBeenCalled();
    expect(generador.rutasGeneradas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T23 — despues de la purga, sobre EL MISMO estado
// ---------------------------------------------------------------------------

describe("Feature 178 x 177 — /generate DESPUES de la purga (R16)", () => {
  it("R16 T23: tras purgar la carga, /generate de carga y de orden devuelven 200, invocan al generador y firman un objeto subido en esa misma llamada", async () => {
    const { estado, objetos, purga, generador, generateCarga, generateOrden } = montar();

    // Rutas originales capturadas ANTES de purgar, leidas del propio estado (no hardcodeadas).
    const rutaCargaAntes = estado.cargas[0].downloadStoragePath;
    const rutaOrdenAntes = estado.ordenes[0].downloadStoragePath;
    expect(rutaCargaAntes).toBe(PATH_CARGA_ORIGINAL);
    expect(rutaOrdenAntes).toBe(PATH_ORDEN_ORIGINAL);

    // --- Purga REAL (service + repositorio reales) sobre el estado compartido ---
    const resumen = await purga.ejecutar(AHORA);
    // Los objetos originales ya no estan en el bucket: re-firmarlos daria un 404 al descargar.
    expect(objetos.has(PATH_CARGA_ORIGINAL)).toBe(false);
    expect(objetos.has(PATH_ORDEN_ORIGINAL)).toBe(false);

    // --- 177 contra EL MISMO estado que la purga acaba de mutar ---
    const resCarga = await generateCarga();
    const resOrden = await generateOrden();

    expect(resCarga.status).toBe(200);
    expect(resOrden.status).toBe(200);
    const jsonCarga = await resCarga.json();
    const jsonOrden = await resOrden.json();

    // 1. Regeneracion, no re-firma de la referencia purgada: se afirma con la invocacion del
    //    generador y con la ruta nueva (abajo), no con un testigo en el cuerpo de la respuesta.

    // 2. Se invoco al generador de PDF en ambos caminos.
    expect(generador.service.generarYAlmacenar).toHaveBeenCalledTimes(1);
    expect(generador.service.generarYAlmacenarPorOrden).toHaveBeenCalledTimes(1);
    expect(generador.rutasGeneradas).toHaveLength(2);
    const [rutaCargaGenerada, rutaOrdenGenerada] = generador.rutasGeneradas;

    // 3. La URL corresponde a un objeto SUBIDO EN ESA LLAMADA, no a la ruta purgada.
    expect(rutaFirmada(jsonCarga.url)).not.toBe(rutaCargaAntes);
    expect(rutaFirmada(jsonOrden.url)).not.toBe(rutaOrdenAntes);
    expect(rutaFirmada(jsonCarga.url)).toBe(rutaCargaGenerada);
    expect(rutaFirmada(jsonOrden.url)).toBe(rutaOrdenGenerada);
    expect(objetos.has(rutaCargaGenerada)).toBe(true);
    expect(objetos.has(rutaOrdenGenerada)).toBe(true);

    // 4. La nueva ruta quedo persistida en el mismo estado compartido.
    expect(estado.cargas[0].downloadStoragePath).toBe(rutaCargaGenerada);
    expect(estado.ordenes[0].downloadStoragePath).toBe(rutaOrdenGenerada);

    // 5. Contabilidad de la corrida (R23/R24): una carga, su orden y sus dos objetos.
    expect(resumen.cargasPurgadas).toBe(1);
    expect(resumen.ordenesAfectadas).toBe(1);
    expect(resumen.objetosBorrados).toBe(2);
  });
});
