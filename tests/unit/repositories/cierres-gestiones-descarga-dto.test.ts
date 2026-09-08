import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";

// Feature 230 — Tandas 2 y 7 (T2.1/T7.1, R22/R26/R27/R41/R42/R43/R44/R46/R47) — el DTO que el
// servidor emite para la hoja fundida.
//
// La declaración de columnas y la proyección a celdas son de otra tanda. Lo que se mide aquí es
// lo que el BORDE DE DATOS entrega, y son cuatro invariantes que no se cumplen «porque la
// columna no existe» sino porque el dato no sale del repositorio:
//
//   - **nada de evidencia** (R22/R41): ni la URL, ni el `storage_path`, ni un booleano derivado.
//     Se afirma sobre el DTO SERIALIZADO, que es lo que cruza la frontera;
//   - **ningún identificador interno** (R42): ni `gestionId`, ni `ordenId`, ni `cierreId`, ni
//     `mensajeroId`, ni `destinoZonaId`. El identificador de negocio de la fila es `numRemision`;
//   - **money-safe** (R43/R44): todo monto es el STRING del snapshot, escala 2, sin símbolo ni
//     separador. Ningún `number` en un campo de dinero;
//   - **`null` es `null`** (R46/R47): una indemnización sin capturar NO vale cero.
//
// Y una quinta, que es la mitigación exigida por el riesgo 4 del design: los DOS caminos
// producen la MISMA fila para la misma gestión (R26). Aquí se comprueba a grano de DTO, que es
// donde puede divergir sin que ninguna pantalla lo diga.

const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const FILTROS: FiltrosDescargaGestiones = { mensajeroIds: ["m-1"] };

const dec = (v: string) => new Prisma.Decimal(v);

/** Una gestión `entregada` con recaudo desglosado, tal como la proyecta `GESTION_DESCARGA_SELECT`. */
function gestionEntregada(over: Record<string, unknown> = {}) {
  return {
    id: "g-1",
    ordenId: "o-1",
    cierreId: "c-1",
    // 2026-09-05 — el reloj de la gestión, un `timestamp`. 18:30 UTC son las 12:30 del MISMO
    // día en CR; el caso de las 18:00 CR (que en UTC ya es el día siguiente) tiene el suyo.
    createdAt: new Date("2026-02-11T18:30:00.000Z"),
    // Las lecturas de la orden VIVA de esta proyección: el día de reparto (2026-09-05) y, desde
    // la ficha 385, cuándo nació la orden y cuántas veces la intentó LA TIENDA.
    //
    // `createdAt` va a las 03:00 UTC del 6 de febrero A PROPÓSITO: en Costa Rica eso son las
    // 21:00 del DÍA 5. Un `toISOString().slice(0, 10)` diría «2026-02-06» y le adelantaría el
    // día a toda orden creada de tarde-noche. Con una hora del mediodía, las dos formas
    // coincidirían y el caso pasaría en verde sin comprobar nada.
    orden: {
      fechaReparto: new Date("2026-02-09T00:00:00.000Z"),
      createdAt: new Date("2026-02-06T03:00:00.000Z"),
      intentosContacto: 4,
    },
    resultado: "entregada",
    montoRecibido: dec("15000.50"),
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    pagoMensajero: dec("1200.00"),
    ingresoBodegaRechazo: null,
    causaIncidente: null,
    // R47: sin capturar. `null`, jamás "0.00".
    indemnizacion: null,
    pagos: [{ metodo: "efectivo", monto: dec("15000.50") }],
    historialEstados: [],
    cierre: { solicitadoAt: new Date("2026-02-10T18:30:00.000Z"), mensajero: { nombre: "Ana" } },
    ...over,
  };
}

/** El snapshot congelado de esa orden, con su tarifa completa. */
function detalle(over: Record<string, unknown> = {}) {
  return {
    ordenId: "o-1",
    cierreId: "c-1",
    numGuia: 4021,
    numRemision: "REM-4021",
    destinatario: "Bea",
    direccion: "Calle 3",
    producto: "Caja",
    tiendaNombre: "Tienda A",
    zonaNombre: "Central",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    // R46: un dato nulo llega nulo, no como el guion de pantalla.
    distritoNombre: null,
    montoCobrar: dec("15000.50"),
    cobraComision: true,
    esCentral: true,
    tarifaId: "t-1",
    tarifaValorFlete: dec("2000.00"),
    tarifaValorFleteGam: dec("1800.00"),
    tarifaValorFleteDevuelto: dec("900.00"),
    tarifaValorFleteDevueltoGam: dec("800.00"),
    tarifaComisionCod: dec("3.00"),
    tarifaIvaFlete: dec("13.00"),
    tarifaIvaComisionCod: dec("13.00"),
    // 2026-08-19: la NOVENA columna de tarifa. Se congela con las otras ocho («todas o
    // ninguna», gap R9) aunque no entre en la formula, y la hoja la lleva como columna propia.
    tarifaFulfillment: dec("500.00"),
    ...over,
  };
}

/**
 * FICHA 394 — los GRUPOS que `contarIntentosVigentesEnLoteCon` recibe de Postgres: un grupo por
 * par `(orden, cierre aprobado con gestión contable vigente)`. El conteo de una orden es cuántos
 * grupos suyos hay, así que el doble se escribe en la misma forma que la base devuelve, no como
 * un número ya sumado. Un `Map` prefabricado aquí probaría la suma del test, no la del código.
 */
function grupos(...pares: [ordenId: string, cierreId: string][]) {
  return pares.map(([ordenId, cierreId]) => ({ ordenId, cierreId }));
}

function prismaFalso(gestiones: unknown[], detalles: unknown[], intentos: unknown[] = []) {
  return {
    gestionOrden: {
      findMany: vi.fn(async () => gestiones),
      // FICHA 394: la TERCERA consulta de la descarga — el derivador en lote de los intentos de
      // entrega. Por defecto no devuelve grupos: es el caso de la orden sin ningún intento
      // contable, que tiene que salir con `0` y no con un hueco.
      groupBy: vi.fn(async (_args?: { by?: unknown; where?: Record<string, unknown> }) => intentos),
    },
    cierreDetail: { findMany: vi.fn(async () => detalles) },
  };
}

function repoAdmin(prisma: ReturnType<typeof prismaFalso>) {
  return new CierresAdminRepository(
    prisma as unknown as PrismaClient,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const repoBodega = (prisma: ReturnType<typeof prismaFalso>) =>
  new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

async function filaAdmin(gestiones: unknown[], detalles: unknown[], intentos: unknown[] = []) {
  const filas = await repoAdmin(
    prismaFalso(gestiones, detalles, intentos),
  ).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);
  return filas[0]!;
}

describe("DTO de la hoja fundida (feature 230, T2.1/T7.1)", () => {
  it("lleva el mensajero y la fecha del cierre al que pertenece la gestión (R8/R11)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(fila.mensajeroNombre).toBe("Ana");
    expect(fila.cierreSolicitadoAt).toBe("2026-02-10T18:30:00.000Z");
  });

  it("la fecha de gestión sale de `created_at` y NO de la fecha del cierre (2026-09-05)", async () => {
    // El cierre se solicitó el 10 de febrero y la gestión se registró el 11: son días distintos,
    // que es lo que pasa en el 29 % de los casos medidos en producción. Cada celda trae el suyo.
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(fila.fechaGestion).toBe("2026-02-11");
    expect(fila.cierreSolicitadoAt).toBe("2026-02-10T18:30:00.000Z");
    expect(fila.fechaGestion).not.toBe(fila.cierreSolicitadoAt.slice(0, 10));
  });

  it("la fecha de gestión es el día de COSTA RICA, no el del UTC (2026-09-05)", async () => {
    // Éste es el off-by-one que la ficha vino a evitar: `2026-02-12T02:00:00Z` son las 20:00 del
    // 11 de febrero en Costa Rica. `toISOString().slice(0, 10)` diría «2026-02-12» y le
    // adelantaría el día a TODA gestión registrada después de las 18:00 CR — es decir, a las de
    // última hora de la tarde, que son muchas.
    const fila = await filaAdmin(
      [gestionEntregada({ createdAt: new Date("2026-02-12T02:00:00.000Z") })],
      [detalle()],
    );

    expect(fila.fechaGestion).toBe("2026-02-11");
    expect(fila.fechaGestion).not.toBe("2026-02-12");
  });

  it("el día de reparto sale de `orden.fecha_reparto` tal cual, y vacío si se anuló (2026-09-05)", async () => {
    const conReparto = await filaAdmin([gestionEntregada()], [detalle()]);
    expect(conReparto.diaReparto).toBe("2026-02-09");
    // No se contamina con ninguna de las otras dos fechas de la fila.
    expect(conReparto.diaReparto).not.toBe(conReparto.fechaGestion);

    // `fecha_reparto` se ANULA al deshacer una asignación, al liberar a bodega satélite y al
    // aprobar el cierre de una orden sin gestionar. `null` es entonces legítimo, y NO se
    // sustituye por la fecha del cierre ni por la de la gestión: eso inventaría el dato.
    // Solo se anula `fecha_reparto`: los otros dos campos de la orden siguen ahí, que es lo que
    // pasa en la base. Sustituir el objeto entero mediría además otra cosa.
    const sinReparto = await filaAdmin(
      [
        gestionEntregada({
          orden: {
            fechaReparto: null,
            createdAt: new Date("2026-02-06T03:00:00.000Z"),
            intentosContacto: 4,
          },
        }),
      ],
      [detalle()],
    );
    expect(sinReparto.diaReparto).toBeNull();
    expect(sinReparto.fechaGestion).toBe("2026-02-11"); // la otra celda no se cae con ella
    // Y las dos de la ficha 385 tampoco se caen con ella: son campos independientes.
    expect(sinReparto.fechaCreacionOrden).toBe("2026-02-05");
    expect(sinReparto.intentosContactoTienda).toBe(4);
  });

  it("la fecha de creación de la orden es el día de COSTA RICA, no el del UTC (ficha 385)", async () => {
    // `orden.created_at` es un `timestamp`, igual que el de la gestión: le toca el MISMO
    // tratamiento (`fechaCalendarioCR`) y no el recorte del ISO que sí vale para `fecha_reparto`,
    // que es `@db.Date`. El fixture la pone a las 03:00 UTC del 6 de febrero = 21:00 del 5 en
    // CR: si alguien cambia esta línea por `toISOString().slice(0, 10)`, sale «2026-02-06».
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(fila.fechaCreacionOrden).toBe("2026-02-05");
    expect(fila.fechaCreacionOrden).not.toBe("2026-02-06");
    // Y no se contamina con ninguna de las otras tres fechas de la fila, que son otros días.
    expect(fila.fechaCreacionOrden).not.toBe(fila.fechaGestion);
    expect(fila.fechaCreacionOrden).not.toBe(fila.diaReparto);
    expect(fila.fechaCreacionOrden).not.toBe(fila.cierreSolicitadoAt.slice(0, 10));
    expect(fila.fechaCreacionOrden).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("los intentos son los de LA TIENDA y el cero viaja como cero (ficha 385)", async () => {
    // `orden.intentos_contacto`: el contador que sube la tienda desde /novedades. NO son los
    // intentos de ENTREGA del mensajero, que no son columna de `orden` sino un conteo sobre
    // `orden_historial` — y que esta proyección no consulta.
    const conIntentos = await filaAdmin([gestionEntregada()], [detalle()]);
    expect(conIntentos.intentosContactoTienda).toBe(4);
    expect(typeof conIntentos.intentosContactoTienda).toBe("number");

    // NOT NULL DEFAULT 0: el cero es un hecho («la tienda no lo intentó nunca»), no un hueco.
    const sinIntentos = await filaAdmin(
      [
        gestionEntregada({
          orden: {
            fechaReparto: new Date("2026-02-09T00:00:00.000Z"),
            createdAt: new Date("2026-02-06T03:00:00.000Z"),
            intentosContacto: 0,
          },
        }),
      ],
      [detalle()],
    );
    expect(sinIntentos.intentosContactoTienda).toBe(0);
    expect(sinIntentos.intentosContactoTienda).not.toBeNull();
    expect(sinIntentos.intentosContactoTienda).not.toBeUndefined();

    // ⚠️ FICHA 394 (2026-09-08) — AQUÍ HABÍA LO CONTRARIO, y el cambio es el encargo, no una
    // relajación. La 385 afirmaba `expect(conIntentos).not.toHaveProperty("intentosEntrega")`
    // con este razonamiento: «si mañana alguien lo añade, tiene que ser una columna con su
    // propio nombre, no un cambio de fuente de ésta». El humano midió que lo que había pedido
    // eran los intentos de ENTREGA y firmó SUSTITUIR la columna, así que el DTO lleva los DOS
    // números —cada uno con su nombre completo, que es la mitad del razonamiento que SÍ sigue
    // viva— y la hoja se queda con el del mensajero.
    //
    // Lo que NO cambia: un «intentos» a secas sigue prohibido. Es el nombre ambiguo que dejó
    // pasar la confusión, y ninguno de los dos contadores puede reclamarlo.
    expect(conIntentos).toHaveProperty("intentosEntrega");
    expect(conIntentos).not.toHaveProperty("intentos");
  });

  // --- FICHA 394 (2026-09-08): los intentos de ENTREGA -----------------------------------

  it("los intentos de ENTREGA cuentan CIERRES aprobados, no gestiones (ficha 394)", async () => {
    // Tres grupos, y DOS de ellos son del mismo cierre `c-9`: son dos gestiones contables de la
    // misma orden dentro de un mismo cierre aprobado, y eso es UN intento (215/R29). El conteo
    // correcto es 2 —`c-9` y `c-8`—, no 3. Un `count()` de gestiones diría 3, escalaría antes de
    // tiempo y cobraría de más.
    const fila = await filaAdmin(
      [gestionEntregada()],
      [detalle()],
      grupos(["o-1", "c-9"], ["o-1", "c-8"]),
    );

    expect(fila.intentosEntrega).toBe(2);
    expect(typeof fila.intentosEntrega).toBe("number");
  });

  it("una orden sin ningún intento contable sale con CERO, no con un hueco (ficha 394)", async () => {
    // Postgres no emite grupos vacíos: la orden simplemente no está en el Map. El `?? 0` vive en
    // el compositor porque el DTO promete un número — un `undefined` aquí saldría a la hoja como
    // celda vacía, que se lee «no se sabe» en vez de «nadie la ha intentado».
    const fila = await filaAdmin([gestionEntregada()], [detalle()], grupos(["OTRA-ORDEN", "c-9"]));

    expect(fila.intentosEntrega).toBe(0);
    expect(fila.intentosEntrega).not.toBeNull();
    expect(fila.intentosEntrega).not.toBeUndefined();
  });

  it("los DOS contadores viajan a la vez y no se contaminan (ficha 394)", async () => {
    // El fallo que la ficha corrige: la hoja traía el de la tienda donde se pedía el del
    // mensajero. Con los dos números DISTINTOS en la misma fila, cruzarlos se ve.
    const fila = await filaAdmin(
      [gestionEntregada()], // `orden.intentosContacto: 4` en el fixture
      [detalle()],
      grupos(["o-1", "c-9"], ["o-1", "c-8"], ["o-1", "c-7"]),
    );

    expect(fila.intentosContactoTienda).toBe(4); // la TIENDA
    expect(fila.intentosEntrega).toBe(3); // el MENSAJERO
    expect(fila.intentosEntrega).not.toBe(fila.intentosContactoTienda);
  });

  it("el conteo pide los VIGENTES, no todos los que hubo (ficha 394)", async () => {
    // El `where` que llega a Prisma es el predicado ÚNICO de la 215, no uno escrito aquí. Es la
    // mitad firmada del encargo: «vigentes» significa gestión no anulada, en un cierre APROBADO
    // y con un resultado de la lista de inclusión. Si alguien cambiara el conteo a «todos», este
    // caso se pone rojo antes de que ninguna hoja salga mal.
    const prisma = prismaFalso([gestionEntregada()], [detalle()]);

    await repoAdmin(prisma).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);

    const args = prisma.gestionOrden.groupBy.mock.calls[0]![0]!;
    // El grano: por el PAR, que es lo que hace que el conteo sea de cierres y no de gestiones.
    expect(args.by).toEqual(["ordenId", "cierreId"]);
    const where = args.where as Record<string, unknown>;
    expect(where.anuladaAt).toBeNull(); // la deshecha no cuenta
    expect(where.cierre).toEqual({ estado: "aprobado" }); // el cierre sin aprobar tampoco
    expect(where.cierreId).toEqual({ not: null });
    expect(where.resultado).toEqual({ in: ["rechazada", "devuelta", "reprogramada"] });
    // Lista de INCLUSIÓN: un `notIn` haría que un `resultado` futuro del enum empezara a contar
    // solo, que es exactamente lo que la 215 prohíbe.
    expect(JSON.stringify(where)).not.toContain("notIn");
  });

  it("pide el conteo UNA sola vez, con los ids de orden sin repetir (ficha 394)", async () => {
    // Anti N+1, que es el motivo de que el gemelo en lote exista: la descarga puede traer miles
    // de gestiones. Y las dos filas son de la MISMA orden en dos cierres, así que el id viaja
    // una vez: su conteo es uno solo.
    const prisma = prismaFalso(
      [
        gestionEntregada({ id: "g-1", cierreId: "c-1" }),
        gestionEntregada({ id: "g-2", cierreId: "c-2" }),
      ],
      [detalle({ cierreId: "c-1" }), detalle({ cierreId: "c-2" })],
      grupos(["o-1", "c-9"]),
    );

    const filas = await repoAdmin(prisma).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);

    expect(prisma.gestionOrden.groupBy).toHaveBeenCalledTimes(1);
    const where = prisma.gestionOrden.groupBy.mock.calls[0]![0]!.where as {
      ordenId: { in: string[] };
    };
    expect(where.ordenId).toEqual({ in: ["o-1"] });
    // Y las dos filas de esa orden llevan el MISMO número: es un dato de la ORDEN, no de la fila.
    expect(filas.map((f) => f.intentosEntrega)).toEqual([1, 1]);
  });

  it("sin gestiones tampoco se pide el conteo: cero filas no cuesta una consulta (ficha 394)", async () => {
    const prisma = prismaFalso([], []);

    const filas = await repoAdmin(prisma).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);

    expect(filas).toEqual([]);
    expect(prisma.gestionOrden.groupBy).not.toHaveBeenCalled();
  });

  // Que los DOS campos se PIDAN de verdad en el `select` que llega a Prisma —y no salgan de un
  // valor fijo ni del snapshot congelado— se afirma donde se lee la consulta:
  // `cierres-admin-gestiones-where.test.ts`.

  it("no emite NINGÚN campo de evidencia, ni siquiera derivado (R22/R41)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(JSON.stringify(fila).toLowerCase()).not.toContain("evidencia");
    expect(fila).not.toHaveProperty("evidenciaUrl");
    expect(fila).not.toHaveProperty("evidenciaStoragePath");
    expect(fila).not.toHaveProperty("tieneEvidencia");
  });

  it("no emite ningún identificador interno de registro (R42)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    for (const clave of ["gestionId", "ordenId", "cierreId", "mensajeroId", "destinoZonaId"]) {
      expect(fila).not.toHaveProperty(clave);
    }
    // El identificador de negocio de la fila SÍ está: sin él, las filas no se pueden auditar.
    expect(fila.numRemision).toBe("REM-4021");
  });

  it("los montos salen como el STRING del snapshot, escala 2, sin símbolo ni separador (R43)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(fila.montoRecibido).toBe("15000.50");
    expect(fila.pagoMensajero).toBe("1200.00");
    expect(fila.pagos).toEqual([{ metodo: "efectivo", monto: "15000.50" }]);
    expect(fila.ingresoOrdenex?.montoCobrar).toBe("15000.50");

    // Ni un `number` en un campo de dinero: es lo que distingue «money-safe» de «hoy coincide».
    for (const v of [fila.montoRecibido, fila.pagoMensajero, fila.ingresoOrdenex?.total]) {
      expect(typeof v).toBe("string");
      expect(v).not.toMatch(/[₡$,]/);
    }
  });

  it("una indemnización sin capturar llega null y NUNCA cero (R47)", async () => {
    const fila = await filaAdmin(
      [gestionEntregada({ resultado: "incidente", causaIncidente: "perdida" })],
      [detalle()],
    );

    expect(fila.indemnizacion).toBeNull();
    expect(fila.indemnizacion).not.toBe("0.00");
  });

  it("un dato nulo llega nulo, nunca como el marcador de pantalla (R46)", async () => {
    const fila = await filaAdmin([gestionEntregada()], [detalle()]);

    expect(fila.distritoNombre).toBeNull();
    expect(fila.motivo).toBeNull();
    expect(fila.fechaReprogramacion).toBeNull();
    expect(JSON.stringify(fila)).not.toContain("—");
  });

  it("empareja el snapshot por (cierre, orden) y no sólo por orden", async () => {
    // La MISMA orden en DOS cierres distintos: es lo que el índice único de `cierre_detail`
    // permite y lo que su propio comentario anuncia («trazar en qué cierres apareció una orden»).
    // Emparejando sólo por `orden_id`, las dos filas cogerían el mismo snapshot —y con él, los
    // mismos montos— y una de las dos sería falsa.
    const filas = await repoAdmin(
      prismaFalso(
        [
          gestionEntregada({ id: "g-1", cierreId: "c-1" }),
          gestionEntregada({ id: "g-2", cierreId: "c-2" }),
        ],
        [
          detalle({ cierreId: "c-1", numRemision: "REM-A", montoCobrar: dec("100.00") }),
          detalle({ cierreId: "c-2", numRemision: "REM-B", montoCobrar: dec("200.00") }),
        ],
      ),
    ).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);

    expect(filas.map((f) => f.numRemision)).toEqual(["REM-A", "REM-B"]);
    expect(filas.map((f) => f.ingresoOrdenex?.montoCobrar)).toEqual(["100.00", "200.00"]);
  });

  it("una gestión sin su fila congelada revienta duro, sin fallback a datos vivos", async () => {
    // Riesgo ACEPTADO y documentado (design §10.2): un cierre corrupto tumba la descarga entera.
    // Se conserva a propósito — un fallback mostraría valores de HOY disfrazados de congelados,
    // que es el camino de lectura que la feature 69 vino a matar.
    await expect(filaAdmin([gestionEntregada()], [])).rejects.toBeInstanceOf(
      CierreDetalleFaltanteError,
    );
  });

  it("los DOS caminos producen la MISMA fila para la misma gestión (R26)", async () => {
    const gestiones = [gestionEntregada()];
    const detalles = [detalle()];
    // FICHA 394: los MISMOS grupos a los dos lados. Con el conteo en cero por ambos lados la
    // paridad seguiría siendo cierta aunque uno de los dos caminos no consultara nada — que es
    // el modo de fallo que R26 existe para cazar.
    const intentos = grupos(["o-1", "c-9"], ["o-1", "c-8"]);

    const porCierresDelDia = await repoAdmin(
      prismaFalso(gestiones, detalles, intentos),
    ).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);
    const porBodega = await repoBodega(
      prismaFalso(gestiones, detalles, intentos),
    ).findGestionesDeCierresBodegaCompleto(FILTROS);

    expect(porBodega).toEqual(porCierresDelDia);
    expect(porBodega[0]!.intentosEntrega).toBe(2);
  });

  it("los DOS caminos piden el conteo con el MISMO criterio (R26, ficha 394)", async () => {
    // No basta con que las dos filas coincidan sobre el mismo doble: lo que R26 protege es que
    // los dos caminos no diverjan, y el conteo es una consulta PROPIA de cada uno. Se comparan
    // los argumentos que cada repositorio manda a Prisma, no dos constantes que hoy coinciden.
    const admin = prismaFalso([gestionEntregada()], [detalle()]);
    const bodega = prismaFalso([gestionEntregada()], [detalle()]);

    await repoAdmin(admin).findGestionesPorAlcanceCompleto(ALCANCE, FILTROS);
    await repoBodega(bodega).findGestionesDeCierresBodegaCompleto(FILTROS);

    expect(bodega.gestionOrden.groupBy.mock.calls[0]![0]).toEqual(
      admin.gestionOrden.groupBy.mock.calls[0]![0],
    );
  });

  it("una gestión de un cierre con destino bodega central sale por el camino A sin trato especial (R27)", async () => {
    // «GAM» es la zona `esCentral`, y sus cierres entran por el `destinoTipo` que el alcance ya
    // fija. Con `esCentral: true` en el snapshot, la fila sale por el camino de cierres del día
    // exactamente igual que cualquier otra: ni un `if` que la nombre.
    const fila = await filaAdmin([gestionEntregada()], [detalle({ esCentral: true })]);

    expect(fila.numRemision).toBe("REM-4021");
    expect(fila.ingresoOrdenex?.esCentral).toBe(true);
  });
});
