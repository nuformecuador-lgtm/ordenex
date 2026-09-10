import { describe, it, expect, vi } from "vitest";

import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ApiOrdenDetalleRow,
  ApiOrdenGestionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { ApiMensajeroDTO, ApiOrdenGestionDTO } from "@/lib/types/api-orden";

// ⏳ 2026-09-10 — Feature 405 (T9): GUARDIA DE LISTA BLANCA Y NO-FUGA de `gestiones[]`.
// Cubre R3, R9 y R12. Molde: `rastreo-dto-lista-blanca.guardia.test.ts` (229).
//
// R12 no se cumple «teniendo cuidado»: se cumple porque la lista blanca es un MECANISMO
// comprobable. Esta guardia lo comprueba por los dos lados a la vez:
//
//   1. FORMA — el conjunto EXACTO de claves de cada elemento es {createdAt, resultado,
//      estadoResultante, motivo, mensajero}, y el de `mensajero` es {id, nombre}. Conjunto
//      ENTERO, no un `toContain`: una clave de mas es una FUGA, no una mejora, y un `toContain`
//      no la veria nunca.
//   2. CONTENIDO — ninguno de los valores sensibles de una gestion poblada aparece en el
//      resultado serializado. Los valores de prueba son INCONFUNDIBLES (`FUGA-...`) para que la
//      busqueda no pueda dar un falso positivo contra una fecha o un nombre.
//
// EL DOBLE DEL REPOSITORIO DEVUELVE A PROPOSITO FILAS MAS ANCHAS QUE SU CONTRATO: trae el texto
// libre `motivo` del mensajero (256/R22), el `storagePath` de la evidencia, el `id` de la gestion,
// el `cierreId`, el `montoRecibido`, el `metodoPago`, la `indemnizacion`, el `pagoMensajero`, la
// coordenada y el telefono del mensajero. Eso NO es un descuido del test: es el escenario que la
// guardia tiene que cazar. Si `toDetalleDTO` construyera el elemento con un spread de la fila
// (`{ ...g }`) en vez de campo a campo, todo eso cruzaria la frontera y aqui se veria. Con un
// doble «limpio» la guardia no probaria nada.

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const ORDEN_ID = "3f6a1c2e-0000-4000-8000-000000000001";

/** Valores de prueba inconfundibles: si uno de estos aparece en la salida, es una fuga. */
const SENSIBLES = {
  motivoLibre: "FUGA-MOTIVO-el-cliente-no-contesto-el-telefono",
  storagePath: "FUGA-STORAGE-ordenes/o1/evidencia.jpg",
  gestionId: "FUGA-GESTION-ID-55",
  cierreId: "FUGA-CIERRE-ID-12",
  ordenId: "FUGA-ORDEN-ID-0b1c2d3e",
  tiendaId: "FUGA-TIENDA-ID-77",
  montoRecibido: "FUGA-MONTO-48750",
  metodoPago: "FUGA-METODO-sinpe",
  pagoMensajero: "FUGA-PAGO-MENSAJERO-2500",
  indemnizacion: "FUGA-INDEMNIZACION-19000",
  ingresoBodegaRechazo: "FUGA-INGRESO-BODEGA-3000",
  ubicacionLat: "FUGA-COORD-LAT-9.9281",
  ubicacionLng: "FUGA-COORD-LNG--84.0907",
  telefonoMensajero: "FUGA-TELEFONO-88887777",
  cedulaMensajero: "FUGA-CEDULA-112340567",
  anuladaPor: "FUGA-ANULADA-POR-ID-91",
  confirmadaFisicaAt: "FUGA-CONFIRMADA-2026-09-03",
} as const;

/** La forma que el contrato publica, escrita a mano UNA vez. */
const CLAVES_PUBLICAS = ["createdAt", "estadoResultante", "mensajero", "motivo", "resultado"];
const CLAVES_MENSAJERO = ["id", "nombre"];

/**
 * La fila de UNA gestion tal y como saldria de un repositorio DESCUIDADO: el contrato pide cinco
 * campos, esta trae media tabla.
 */
interface FilaGestionPoblada extends ApiOrdenGestionRow {
  readonly id: string;
  readonly ordenId: string;
  readonly tiendaId: string;
  readonly motivoLibre: string;
  readonly storagePath: string;
  readonly cierreId: string;
  readonly montoRecibido: string;
  readonly metodoPago: string;
  readonly pagoMensajero: string;
  readonly indemnizacion: string;
  readonly ingresoBodegaRechazo: string;
  readonly ubicacionLat: string;
  readonly ubicacionLng: string;
  readonly anuladaPor: string;
  readonly confirmadaFisicaAt: string;
}

/** Y su mensajero, tambien mas ancho de la cuenta. */
interface MensajeroPoblado extends ApiMensajeroDTO {
  readonly telefono: string;
  readonly cedula: string;
}

const MENSAJERO_POBLADO: MensajeroPoblado = {
  id: "018f2c31-0000-4000-8000-0000000000aa",
  nombre: "Carlos Jimenez Mora",
  telefono: SENSIBLES.telefonoMensajero,
  cedula: SENSIBLES.cedulaMensajero,
};

const GESTION_POBLADA: FilaGestionPoblada = {
  // Lo que SI se publica
  createdAt: new Date("2026-09-02T15:41:07.000Z"),
  resultado: "devuelta",
  estadoResultante: "devolucion_por_confirmar",
  motivo: "wrong_address",
  mensajero: MENSAJERO_POBLADO,
  // Lo que NO se publica y la fila trae igualmente
  id: SENSIBLES.gestionId,
  ordenId: SENSIBLES.ordenId,
  tiendaId: SENSIBLES.tiendaId,
  motivoLibre: SENSIBLES.motivoLibre,
  storagePath: SENSIBLES.storagePath,
  cierreId: SENSIBLES.cierreId,
  montoRecibido: SENSIBLES.montoRecibido,
  metodoPago: SENSIBLES.metodoPago,
  pagoMensajero: SENSIBLES.pagoMensajero,
  indemnizacion: SENSIBLES.indemnizacion,
  ingresoBodegaRechazo: SENSIBLES.ingresoBodegaRechazo,
  ubicacionLat: SENSIBLES.ubicacionLat,
  ubicacionLng: SENSIBLES.ubicacionLng,
  anuladaPor: SENSIBLES.anuladaPor,
  confirmadaFisicaAt: SENSIBLES.confirmadaFisicaAt,
};

const FILA_DETALLE: ApiOrdenDetalleRow = {
  numGuia: 100234,
  numRemision: "REM-0001",
  estatusValue: "devolviendo_a_tienda",
  destinatario: "Ana",
  telefonoDest: "0991234567",
  producto: "Caja",
  direccion: "Calle 1",
  montoCobrar: 1500,
  createdAt: new Date("2026-07-20T15:04:00.000Z"),
  mensajero: null,
  evidencias: [],
  gestiones: [GESTION_POBLADA],
};

function servicio() {
  const repo = {
    listByOwner: vi.fn(),
    findDetalleByOrdenIdForOwner: vi.fn().mockResolvedValue(FILA_DETALLE),
    findEstatusIdByValue: vi.fn(),
  };
  const signedUrls: ISignedUrlProvider = {
    createSignedUrl: vi.fn(async () => "https://signed/one"),
    createSignedUrls: vi.fn(async () => ({})),
  };
  return new ApiOrdenLecturaService(repo as never, signedUrls);
}

// ---------------------------------------------------------------------------------------------
// 1. FORMA — el conjunto EXACTO de claves
// ---------------------------------------------------------------------------------------------

describe("405/R3 — cada gestion lleva EXACTAMENTE las cinco claves publicas", () => {
  it("el conjunto de claves del elemento es el conjunto entero, ni una mas ni una menos", async () => {
    const res = await servicio().detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones).toHaveLength(1);
    expect(Object.keys(res!.gestiones[0]).sort()).toEqual(CLAVES_PUBLICAS);
  });

  it("las cinco siguen presentes cuando TODO lo opcional es `null`", async () => {
    // R3 dice «SIEMPRE presentes, sea cual sea el resultado»: una entrega no tiene motivo ni
    // (si es legada) transicion, y aun asi las claves viajan.
    const repo = {
      listByOwner: vi.fn(),
      findDetalleByOrdenIdForOwner: vi.fn().mockResolvedValue({
        ...FILA_DETALLE,
        gestiones: [
          { ...GESTION_POBLADA, resultado: "entregada", motivo: null, estadoResultante: null },
        ],
      }),
      findEstatusIdByValue: vi.fn(),
    };
    const svc = new ApiOrdenLecturaService(repo as never, {
      createSignedUrl: vi.fn(),
      createSignedUrls: vi.fn(async () => ({})),
    } as unknown as ISignedUrlProvider);

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(Object.keys(res!.gestiones[0]).sort()).toEqual(CLAVES_PUBLICAS);
    const texto = JSON.stringify(res);
    expect(texto).toContain('"motivo":null');
    expect(texto).toContain('"estadoResultante":null');
  });

  it("el DTO publicado no puede declarar una SEXTA clave: el tipo es el contrato", () => {
    // Chequeo de TIPO. Si `ApiOrdenGestionDTO` ganara una clave, este `Exclude` deja de ser
    // `never` y el archivo no compila — que es como se quiere uno enterar.
    type Extra = Exclude<
      keyof ApiOrdenGestionDTO,
      "createdAt" | "resultado" | "estadoResultante" | "motivo" | "mensajero"
    >;
    const sinExtras: Extra extends never ? true : never = true;
    expect(sinExtras).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. R9 — el `mensajero` es el MISMO tipo de la 404
// ---------------------------------------------------------------------------------------------

describe("405/R9 — el mensajero de la gestion usa el MISMO tipo publicado por la 404", () => {
  it("su conjunto de claves es exactamente el de la 404: {id, nombre}", async () => {
    const res = await servicio().detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(Object.keys(res!.gestiones[0].mensajero).sort()).toEqual(CLAVES_MENSAJERO);
  });

  it("la asignacion cruzada compila: es el MISMO tipo, no uno «parecido»", () => {
    // R9 es una dependencia ESTRUCTURAL, no de prosa. Si la 405 declarara su propio objeto
    // `{id, nombre}`, estas dos asignaciones seguirian compilando por estructura; lo que las
    // rompe es que la 404 cambie la forma —y entonces esta ficha debe seguirla, no divergir—.
    const deLaGestion: ApiOrdenGestionDTO["mensajero"] = {
      id: "u-1",
      nombre: "Ana Solis",
    };
    const comoDeLa404: ApiMensajeroDTO = deLaGestion;
    const deVuelta: ApiOrdenGestionDTO["mensajero"] = comoDeLa404;
    expect(deVuelta).toEqual({ id: "u-1", nombre: "Ana Solis" });
  });

  it("`ApiMensajeroDTO` se declara UNA sola vez en `lib/`: no hay un segundo tipo de mensajero", async () => {
    // El modo de fallo que R9 previene explicitamente: dos tipos para el mismo concepto. Se mide
    // sobre el arbol, porque un `import` correcto hoy no impide que manana alguien declare otro.
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const raiz = path.resolve(__dirname, "../../..");

    function* archivos(dir: string): Generator<string> {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === ".next") continue;
          yield* archivos(completo);
        } else if (e.name.endsWith(".ts")) {
          yield completo;
        }
      }
    }

    const declaraciones: string[] = [];
    for (const archivo of archivos(path.join(raiz, "lib"))) {
      const contenido = readFileSync(archivo, "utf8");
      if (/\b(interface|type)\s+ApiMensajeroDTO\b/.test(contenido)) {
        declaraciones.push(path.relative(raiz, archivo).split(path.sep).join("/"));
      }
    }
    expect(declaraciones).toEqual(["lib/types/api-orden.ts"]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. R12 — CONTENIDO: ningun valor sensible cruza
// ---------------------------------------------------------------------------------------------

describe("405/R12 — ningun valor sensible de la gestion cruza al DTO publico", () => {
  it("ninguno de los valores `FUGA-...` aparece en la respuesta serializada", async () => {
    const res = await servicio().detallePorOrdenId(ACTOR, ORDEN_ID);
    const serializado = JSON.stringify(res);

    const filtrados = Object.entries(SENSIBLES).filter(([, valor]) =>
      serializado.includes(valor),
    );
    expect(
      filtrados.map(([clave]) => clave),
      "Estos valores de la fila cruda llegaron al DTO publico. Si el mapeo hace `{...g}` en vez " +
        "de copiar campo a campo, es exactamente esto lo que pasa.",
    ).toEqual([]);
  });

  it("el detector NO esta ciego: si se busca un valor que SI se publica, lo encuentra", async () => {
    // Contraprueba del propio buscador. Sin esto, un `JSON.stringify` que devolviera "" dejaria
    // el aserto de arriba siempre verde.
    const res = await servicio().detallePorOrdenId(ACTOR, ORDEN_ID);
    const serializado = JSON.stringify(res);

    expect(serializado).toContain("Carlos Jimenez Mora");
    expect(serializado).toContain("wrong_address");
    expect(serializado).toContain("devolucion_por_confirmar");
    expect(serializado.length).toBeGreaterThan(100);
  });

  it("ni el texto libre del mensajero ni ningun nombre de clave interna cruzan", async () => {
    const res = await servicio().detallePorOrdenId(ACTOR, ORDEN_ID);
    const serializado = JSON.stringify(res);

    // Por NOMBRE de clave, ademas de por valor: una fuga puede llegar con el valor cambiado.
    for (const clave of [
      "motivoLibre",
      "storagePath",
      "storage_path",
      "bucket",
      "cierreId",
      "ordenId",
      "tiendaId",
      "montoRecibido",
      "metodoPago",
      "pagoMensajero",
      "indemnizacion",
      "ingresoBodegaRechazo",
      "ubicacionLat",
      "ubicacionLng",
      "anuladaPor",
      "anuladaAt",
      "confirmadaFisicaAt",
      "telefono",
      "cedula",
    ]) {
      expect(serializado, `la clave interna \`${clave}\` no debe salir`).not.toContain(
        `"${clave}"`,
      );
    }
  });

  it("el `id` interno de la gestion no viaja: el elemento no tiene identificador publico", async () => {
    const res = await servicio().detallePorOrdenId(ACTOR, ORDEN_ID);

    expect("id" in res!.gestiones[0]).toBe(false);
    expect(JSON.stringify(res)).not.toContain(SENSIBLES.gestionId);
  });
});
