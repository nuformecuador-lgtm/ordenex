// ⏳ 2026-09-10 — Feature 405 (T7): `gestiones[]` en el DTO del detalle, medido sobre la CADENA
// REAL (`OrdenRepository` -> `ApiOrdenLecturaService`) con Prisma mockeado.
//
// POR QUE LA CADENA REAL Y NO UN DOBLE DEL REPOSITORIO. Casi todo lo que esta ficha decide vive en
// el MAPEO del repositorio: que `resultado` viaje crudo, que `motivo` sea la causa tipificada, que
// `estadoResultante` salga del historial, que el nombre se componga con la fuente unica. Con un
// doble del repositorio esos casos pasarian aunque el mapeo NO existiera —bastaria con que el
// doble devolviera ya la fila hecha—, que es exactamente el modo de fallo que este repo persigue.
// Aqui el unico doble es Prisma, y devuelve filas CRUDAS.
//
// LO QUE ESTE ARCHIVO **NO** PUEDE MEDIR, y por eso no lo intenta: un doble de Prisma no ejecuta
// el `where` ni el `orderBy`. R6, R10, R11, R13, R14, R18 y R19 dependen del SQL y viven en
// `tests/integration/db/gestiones-detalle-api-405.test.ts`, contra Postgres de verdad. En este
// repo una mutacion de un `WHERE` sobrevivio en verde por arriba cuatro veces.
//
// Cubre: R2, R4, R5, R7, R8.
import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiOrdenDetalleRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const ORDEN_ID = "3f6a1c2e-0000-4000-8000-000000000001";

const signedUrls: ISignedUrlProvider = {
  createSignedUrl: vi.fn(async () => "https://signed/one"),
  createSignedUrls: vi.fn(async () => ({})),
};

/** Una fila CRUDA de `gestion_orden`, con las claves que pide el `select` del detalle. */
function gestionCruda(over: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    resultado: "entregada",
    evidenciaStoragePath: null,
    evidenciaContentType: null,
    createdAt: new Date("2026-09-02T15:41:07.000Z"),
    anuladaAt: null,
    causaDevolucion: null,
    causaIncidente: null,
    mensajero: {
      id: "018f2c31-0000-4000-8000-0000000000aa",
      nombre: "Carlos",
      primerApellido: "Jimenez",
      segundoApellido: "Mora",
    },
    ...over,
  };
}

/** Una fila CRUDA de `orden_historial_estado` de las que enlazan con una gestion. */
function transicionCruda(over: Record<string, unknown> = {}) {
  return {
    id: "h-1",
    gestionOrdenId: "g-1",
    createdAt: new Date("2026-09-02T15:41:07.000Z"),
    estatusDestino: { value: "entregada" },
    ...over,
  };
}

/** La fila CRUDA de `orden` que Prisma devuelve para `API_ORDEN_DETALLE_SELECT`. */
function ordenCruda(over: Record<string, unknown> = {}) {
  return {
    numGuia: 100234,
    numRemision: "REM-0001",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal(1500),
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    estatus: { value: "entregada" },
    mensajeroAsignado: null,
    gestiones: [],
    historialEstados: [],
    incidentesAdmin: [],
    ...over,
  };
}

/** El servicio REAL sobre el repositorio REAL, con Prisma de mentira debajo. */
function servicioSobrePrisma(fila: Record<string, unknown> | null) {
  const prisma = {
    orden: {
      findFirst: vi.fn(async () => fila),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
  };
  const repo = new OrdenRepository(prisma as unknown as PrismaClient);
  return { svc: new ApiOrdenLecturaService(repo, signedUrls), prisma };
}

// ---------------------------------------------------------------------------------------------
// R2 — la clave viaja SIEMPRE, y vacia es `[]`
// ---------------------------------------------------------------------------------------------

describe("405/R2 — una orden sin gestiones vigentes devuelve `gestiones` vacio, no null", () => {
  it("el detalle de una orden sin ninguna gestion trae la CLAVE con un array vacio", async () => {
    const { svc } = servicioSobrePrisma(ordenCruda());

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect("gestiones" in res!).toBe(true);
    expect(res!.gestiones).toEqual([]);
    expect(res!.gestiones).not.toBeNull();
    // Y en el JSON que ve el integrador: la clave existe y es un array, no `null` ni ausente.
    expect(JSON.stringify(res)).toContain('"gestiones":[]');
  });

  it("el array vacio NO hace que el detalle pierda `evidencias` ni ninguna otra clave", async () => {
    const { svc } = servicioSobrePrisma(ordenCruda());

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.evidencias).toEqual([]);
    expect(Object.keys(res!).sort()).toEqual([
      "createdAt",
      "destinatario",
      "direccion",
      "estado",
      "evidencias",
      "gestiones",
      "mensajero",
      "montoCobrar",
      "numGuia",
      "numRemision",
      "producto",
      "telefonoDest",
    ]);
  });

  it("un repositorio que devolviera `null` en vez de `[]` no puede colarse: el tipo lo prohibe", () => {
    // Chequeo de TIPO (no de runtime): si `gestiones` admitiera `null`, esto compilaria y la
    // convencion de R2 seria una promesa de prosa. Es el mismo candado que la 268 puso entre el
    // DTO y la fila del repo.
    type Gestiones = ApiOrdenDetalleRow["gestiones"];
    type AdmiteNull = null extends Gestiones ? true : false;
    const admiteNull: AdmiteNull = false;
    expect(admiteNull).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// R4 — `createdAt` es el instante de REGISTRO y viaja como el de la orden
// ---------------------------------------------------------------------------------------------

describe("405/R4 — `createdAt` de la gestion es el instante de registro y viaja como el de la orden", () => {
  it("es el `created_at` de la gestion, no el de la orden ni el de su transicion", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        // La orden nacio el 20 de julio; la gestion se registro el 2 de septiembre; la transicion
        // que causo quedo escrita un segundo despues. Las tres fechas son DISTINTAS a proposito.
        gestiones: [gestionCruda({ createdAt: new Date("2026-09-02T15:41:07.000Z") })],
        historialEstados: [
          transicionCruda({ createdAt: new Date("2026-09-02T15:41:08.000Z") }),
        ],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    // Literal ESCRITO A MANO, no derivado de la fixture: si el mapeo tomara la fecha de la orden
    // o la de la transicion, este aserto cae.
    expect(res!.gestiones[0].createdAt.toISOString()).toBe("2026-09-02T15:41:07.000Z");
    expect(res!.createdAt.toISOString()).toBe("2026-07-20T15:04:00.000Z");
  });

  it("es un `Date`, igual que el `createdAt` de la orden, y serializa al mismo formato ISO", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({ gestiones: [gestionCruda()], historialEstados: [transicionCruda()] }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones[0].createdAt).toBeInstanceOf(Date);
    expect(res!.createdAt).toBeInstanceOf(Date);
    // El cuerpo que sale por HTTP: las dos fechas con la MISMA forma (ISO 8601 en UTC).
    const json = JSON.parse(JSON.stringify(res)) as {
      createdAt: string;
      gestiones: { createdAt: string }[];
    };
    expect(json.gestiones[0].createdAt).toBe("2026-09-02T15:41:07.000Z");
    expect(json.createdAt).toBe("2026-07-20T15:04:00.000Z");
  });
});

// ---------------------------------------------------------------------------------------------
// R5 — `resultado` viaja crudo
// ---------------------------------------------------------------------------------------------

describe("405/R5 — `resultado` viaja como value crudo del enum, sin traducir", () => {
  it("los CINCO values del catalogo salen tal cual, sin etiqueta en español", async () => {
    // La lista se escribe A MANO: si se derivara del catalogo, un renombre del catalogo cambiaria
    // a la vez lo esperado y lo obtenido, y el aserto quedaria siempre verde.
    const crudos = ["entregada", "reprogramada", "devuelta", "rechazada", "incidente"];
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: crudos.map((resultado, i) =>
          gestionCruda({
            id: `g-${i}`,
            resultado,
            createdAt: new Date(Date.UTC(2026, 8, 2, 10, i, 0)),
          }),
        ),
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones.map((g) => g.resultado)).toEqual([
      "entregada",
      "reprogramada",
      "devuelta",
      "rechazada",
      "incidente",
    ]);
  });

  it("no se cuela ninguna etiqueta de presentacion en el cuerpo", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({ gestiones: [gestionCruda({ resultado: "devuelta" })] }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    const texto = JSON.stringify(res);
    expect(texto).toContain('"resultado":"devuelta"');
    // Las traducciones que pinta la UI («Devuelta», «Entregada», «Reprogramada») no salen por el
    // canal: el value es minusculas y sin tilde.
    expect(texto).not.toMatch(/"resultado":"(Devuelta|Entregada|Reprogramada|Rechazada)"/);
  });
});

// ---------------------------------------------------------------------------------------------
// R7 — sin transicion registrada, `estadoResultante` es `null` (y la clave sigue)
// ---------------------------------------------------------------------------------------------

describe("405/R7 — una gestion sin transicion registrada emite `estadoResultante: null`", () => {
  it("la gestion LEGADA (sin fila de historial que la respalde) sale con `null`, no se omite", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [gestionCruda({ id: "g-legada" })],
        historialEstados: [], // el historial de la 49 no existia cuando se registro
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones).toHaveLength(1);
    expect("estadoResultante" in res!.gestiones[0]).toBe(true);
    expect(res!.gestiones[0].estadoResultante).toBeNull();
    expect(JSON.stringify(res)).toContain('"estadoResultante":null');
  });

  it("una transicion de OTRA gestion no se le atribuye a esta", async () => {
    // El modo de fallo que este caso caza: un emparejamiento por posicion (o por «la primera del
    // historial») en vez de por `gestion_orden_id`.
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [gestionCruda({ id: "g-sin-historial" })],
        historialEstados: [
          transicionCruda({ id: "h-otra", gestionOrdenId: "g-OTRA", estatusDestino: { value: "reprogramada" } }),
        ],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones[0].estadoResultante).toBeNull();
  });

  it("con transicion registrada SI lleva el value del estado destino", async () => {
    // Contraste del caso de arriba: sin esto, un mapeo que devolviera SIEMPRE `null` pasaria.
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [gestionCruda({ id: "g-1", resultado: "devuelta" })],
        historialEstados: [
          transicionCruda({
            gestionOrdenId: "g-1",
            estatusDestino: { value: "devolucion_por_confirmar" },
          }),
        ],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    // Literal a mano, y ADEMAS es el value real de la 239: una `devuelta` NO deja la orden en
    // `devuelta`. Si alguien "derivara" el estado del resultado, aqui saldria `devuelta` y el
    // aserto lo caza (es la alternativa 6.3 que el design descarta por falsa).
    expect(res!.gestiones[0].estadoResultante).toBe("devolucion_por_confirmar");
  });
});

// ---------------------------------------------------------------------------------------------
// R8 — `motivo` es la causa TIPIFICADA, y solo donde aplica
// ---------------------------------------------------------------------------------------------

describe("405/R8 — `motivo` lleva la causa de devolucion en `devuelta`, la de incidente en `incidente` y `null` en el resto", () => {
  it("`devuelta` publica `causa_devolucion` con su value crudo en INGLES", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [
          gestionCruda({ resultado: "devuelta", causaDevolucion: "wrong_address" }),
        ],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones[0].motivo).toBe("wrong_address");
  });

  it("`incidente` publica `causa_incidente` con su value crudo en ESPAÑOL (la asimetria es deliberada)", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [gestionCruda({ resultado: "incidente", causaIncidente: "robado" })],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones[0].motivo).toBe("robado");
  });

  it("una `devuelta` NO publica la causa de incidente aunque la fila la traiga, y viceversa", async () => {
    // La fila trae LAS DOS columnas pobladas —imposible en la practica, deliberado aqui—: si el
    // mapeo hiciera `causaDevolucion ?? causaIncidente`, el cruce pasaria desapercibido.
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [
          gestionCruda({
            id: "g-dev",
            resultado: "devuelta",
            causaDevolucion: "not_found",
            causaIncidente: "danado",
            createdAt: new Date("2026-09-02T10:00:00.000Z"),
          }),
          gestionCruda({
            id: "g-inc",
            resultado: "incidente",
            causaDevolucion: "not_found",
            causaIncidente: "danado",
            createdAt: new Date("2026-09-02T11:00:00.000Z"),
          }),
        ],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones.map((g) => g.motivo)).toEqual(["not_found", "danado"]);
  });

  it("los otros TRES resultados publican `null`, con la clave presente", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: ["entregada", "reprogramada", "rechazada"].map((resultado, i) =>
          gestionCruda({
            id: `g-${i}`,
            resultado,
            // Las columnas de causa POBLADAS: si el mapeo no ramificara por `resultado`, se
            // publicaria una causa en una entrega.
            causaDevolucion: "not_found",
            causaIncidente: "robado",
            createdAt: new Date(Date.UTC(2026, 8, 2, 10, i, 0)),
          }),
        ),
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones.map((g) => g.motivo)).toEqual([null, null, null]);
    for (const g of res!.gestiones) expect("motivo" in g).toBe(true);
  });

  it("una `devuelta` SIN causa registrada (historico anterior a la 73) publica `null`", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [gestionCruda({ resultado: "devuelta", causaDevolucion: null })],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones[0].motivo).toBeNull();
  });

  it("un `incidente` SIN causa registrada (historico anterior a la 158) publica `null`", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [gestionCruda({ resultado: "incidente", causaIncidente: null })],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones[0].motivo).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// R9 (parcial) — el nombre del mensajero se compone con la MISMA fuente unica
// ---------------------------------------------------------------------------------------------

describe("405/R9 — el `mensajero` de la gestion se compone con la fuente unica del repo", () => {
  it("compone el nombre COMPLETO desde las tres columnas de identidad", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({ gestiones: [gestionCruda()] }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    // Literal a mano, NO `nombreCompletoUsuario(...)`: comparar contra la funcion que lo genera
    // estaria siempre verde.
    expect(res!.gestiones[0].mensajero).toEqual({
      id: "018f2c31-0000-4000-8000-0000000000aa",
      nombre: "Carlos Jimenez Mora",
    });
  });

  it("una cuenta sin apellidos sale con su `nombre` a secas, sin espacios de cola", async () => {
    const { svc } = servicioSobrePrisma(
      ordenCruda({
        gestiones: [
          gestionCruda({
            mensajero: {
              id: "u-2",
              nombre: "Ana",
              primerApellido: null,
              segundoApellido: null,
            },
          }),
        ],
      }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.gestiones[0].mensajero.nombre).toBe("Ana");
  });

  it("el mensajero de la GESTION es independiente del ASIGNADO a la orden", async () => {
    // El caso que separa los dos conceptos: la orden no tiene asignado (404 -> `null`) y la
    // gestion si tiene mensajero. Si alguien hubiera cableado uno al otro, esto cae.
    const { svc } = servicioSobrePrisma(
      ordenCruda({ mensajeroAsignado: null, gestiones: [gestionCruda()] }),
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.mensajero).toBeNull();
    expect(res!.gestiones[0].mensajero.nombre).toBe("Carlos Jimenez Mora");
  });
});
