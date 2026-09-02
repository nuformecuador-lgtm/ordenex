import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import {
  ESTADOS_BODEGA_SATELITE,
  ESTADOS_CUSTODIA_SATELITE,
} from "@/lib/utils/estados-bodega-satelite";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 357 — «PASO POR MI BODEGA» CONTRA POSTGRES DE VERDAD.
 *
 * ─── POR QUE ESTE ARCHIVO, Y POR QUE NO VALEN DOBLES ───────────────────────────────────────
 *
 * Lo que esta ficha cambia es UN `WHERE`. En este repo esta medido —cuatro veces seguidas, y
 * escrito en `docs/verification.md`— que una mutacion del `WHERE` pasa en VERDE con dobles: el
 * doble acepta cualquier criterio y devuelve lo que se le dijo. Aqui las filas las elige
 * Postgres, y por eso quitar media condicion pone rojo un test con nombre.
 *
 * ─── LAS TRES FILAS QUE SOSTIENEN LA FICHA ────────────────────────────────────────────────
 *
 * El defecto tenia DOS caras opuestas y hay que cerrarlas A LA VEZ; una sola de ellas se
 * «arregla» con un cambio que empeora la otra:
 *
 *   (a) una `entregada` que SI paso por la bodega A -> A **la ve**. Es la cara A: hasta hoy,
 *       en cuanto el mensajero gestionaba la orden esta salia de los cinco estados del listado
 *       y desaparecia de la pantalla de la bodega que la despacho (17 asi en produccion).
 *   (b) una `entregada` de la MISMA zona que NO paso por ninguna bodega -> A **no la ve**. Es
 *       la cara B: si se hubieran añadido los desenlaces a la lista blanca sin cambiar el
 *       criterio, la satelite habria pasado a ver 252 `entregada` ajenas.
 *   (c) una que paso por la bodega **B** -> A **no la ve**. Es el que impide que «mi bodega»
 *       degenere en «mi zona», y el unico que se rompe si alguien quita el recorte por zona.
 *
 * ─── AISLAMIENTO ──────────────────────────────────────────────────────────────────────────
 *
 * Todo dentro de `enTransaccionRevertida`: si el test pasa, si falla o si el runner muere, no
 * queda ni una fila en la base compartida. Sin base alcanzable el archivo se SALTA (y eso se
 * ve en el reporte como `skipped`, no como `passed`).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** El criterio VIEJO, escrito aqui tal cual era, para poder medir el «antes» en la misma corrida. */
const LISTA_BLANCA_VIEJA = [
  "en_bodega_satelite",
  "por_recoger",
  "por_devolver",
  "devolviendo_a_bodega_central",
  "devuelta",
] as const;

interface Escenario {
  readonly adminA: string;
  readonly adminB: string;
  readonly zonaA: string;
  readonly zonaB: string;
  /** (a) `entregada` de la zona A que SI paso por la bodega A. */
  readonly entregadaPasoPorA: string;
  /** (b) `entregada` de la zona A que NO paso por ninguna bodega satelite. */
  readonly entregadaSinBodega: string;
  /** (c) `entregada` que paso por la bodega B (y vive en la zona B). */
  readonly entregadaPasoPorB: string;
  /** La cara B EXACTA: `devuelta` de la zona A sin paso por bodega. HOY se ve; no debe verse. */
  readonly devueltaSinBodega: string;
  /** El caso del reporte: la `rechazada` con cierre pendiente que su bodega no podia consultar. */
  readonly rechazadaPasoPorA: string;
  /** No-regresion: esta FISICAMENTE en el estante y no tiene fila de historial. */
  readonly enBodegaSinHistorial: string;
  /** Borrada (`deleted_at`) aunque paso por la bodega A: sigue fuera. */
  readonly borradaPasoPorA: string;
  /** Ruteada a A y aun no recibida: tiene pantalla propia («Por recibir»), no sale en el listado. */
  readonly enRutaHaciaA: string;
}

async function sembrar(tx: Tx): Promise<Escenario> {
  await serializarEscriturasReales(tx);
  const sufijo = `f357-${randomUUID().slice(0, 8)}`;

  const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
  const [tipoIdentificacion, rolTienda, rolSatelite, rolMensajero] = await Promise.all([
    tx.tipoIdentificacion.findFirst({ select: { id: true } }),
    tx.rol.findFirst({ where: { value: "adminTienda" }, select: { id: true } }),
    tx.rol.findFirst({ where: { value: "adminSatelite" }, select: { id: true } }),
    tx.rol.findFirst({ where: { value: "mensajero" }, select: { id: true } }),
  ]);
  // Fallo RUIDOSO, nunca un `return` silencioso: un `if (!catalogo) return;` deja el caso en
  // «passed» sin haber comprobado nada, que es como este repo ya se ha mentido antes.
  if (!canton || !tipoIdentificacion || !rolTienda || !rolSatelite || !rolMensajero) {
    throw new Error("la base local no tiene catalogos (geografia / roles / identificacion)");
  }

  const catalogo = new Map(
    (await tx.orderStatus.findMany({ select: { id: true, value: true } })).map((s) => [
      s.value,
      s.id,
    ]),
  );
  const estatus = (value: string): string => {
    const id = catalogo.get(value);
    if (id === undefined) throw new Error(`el catalogo local no tiene el estatus ${value}`);
    return id;
  };

  const crearZona = async (nombre: string): Promise<string> =>
    (await tx.zona.create({ data: { nombre: `${sufijo}-${nombre}` }, select: { id: true } })).id;

  const crearUsuario = async (
    nombre: string,
    rolId: string,
    zonaId: string | null,
  ): Promise<string> =>
    (
      await tx.usuario.create({
        data: {
          nombre,
          primerApellido: "Prueba",
          email: `${sufijo}-${nombre}@f357.local`,
          telefono: "88880000",
          passwordHash: "no-es-una-credencial",
          cedula: `${sufijo}-${nombre}`,
          tipoIdentificacionId: tipoIdentificacion.id,
          rolId,
          zonaId,
        },
        select: { id: true },
      })
    ).id;

  const zonaA = await crearZona("bodega-a");
  const zonaB = await crearZona("bodega-b");
  const adminA = await crearUsuario("SaraA", rolSatelite.id, zonaA);
  const adminB = await crearUsuario("SaraB", rolSatelite.id, zonaB);
  const tienda = await crearUsuario("Tienda", rolTienda.id, null);
  const mensajero = await crearUsuario("Ana", rolMensajero.id, zonaA);

  const crearOrden = async (
    clave: string,
    zonaId: string,
    estatusValue: string,
    opciones: { borrada?: boolean } = {},
  ): Promise<string> =>
    (
      await tx.orden.create({
        data: {
          numRemision: `${sufijo}-${clave}`,
          destinatario: `Cliente ${clave}`,
          telefonoDest: "80000000",
          direccion: `Direccion ${clave}`,
          producto: "caja",
          estatusId: estatus(estatusValue),
          tiendaId: tienda,
          zonaId,
          provinciaId: canton.provinciaId,
          cantonId: canton.id,
          mensajeroAsignadoId: mensajero,
          cobraComision: true,
          deletedAt: opciones.borrada === true ? new Date() : null,
        },
        select: { id: true },
      })
    ).id;

  /**
   * EL RECORRIDO REAL por una bodega satelite, escrito como lo escribe la aplicacion: el ruteo
   * desde la central (`ruteo_satelite`, actor maestro/admin) y la recepcion en la bodega
   * (`recepcion_satelite`, actor = el `adminSatelite` de esa zona).
   *
   * Se siembran las DOS filas a proposito: son los dos `estatus_destino` que
   * `ESTADOS_CUSTODIA_SATELITE` declara como evidencia, y sembrar solo una dejaria sin ejercer
   * la mitad del `IN`.
   */
  const sembrarPasoPorBodega = async (ordenId: string, adminDeLaBodega: string): Promise<void> => {
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusOrigenId: estatus("en_bodega_central"),
        estatusDestinoId: estatus("en_ruta_bodega_satelite"),
        actorUsuarioId: null, // el ruteo lo hace la central; su actor NO identifica la bodega
        origenTipo: "ruteo_satelite",
      },
    });
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusOrigenId: estatus("en_ruta_bodega_satelite"),
        estatusDestinoId: estatus("en_bodega_satelite"),
        actorUsuarioId: adminDeLaBodega,
        origenTipo: "recepcion_satelite",
      },
    });
  };

  /** Recorrido SIN bodega satelite: asignada desde la central y entregada. Es el caso (b). */
  const sembrarSinBodega = async (ordenId: string, destino: string): Promise<void> => {
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusOrigenId: estatus("en_bodega_central"),
        estatusDestinoId: estatus("por_recoger"),
        actorUsuarioId: null,
        origenTipo: "asignacion_bodega",
      },
    });
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusOrigenId: estatus("en_reparto"),
        estatusDestinoId: estatus(destino),
        actorUsuarioId: mensajero,
        origenTipo: "gestion",
      },
    });
  };

  const entregadaPasoPorA = await crearOrden("entregada-paso-a", zonaA, "entregada");
  await sembrarPasoPorBodega(entregadaPasoPorA, adminA);

  const entregadaSinBodega = await crearOrden("entregada-sin-bodega", zonaA, "entregada");
  await sembrarSinBodega(entregadaSinBodega, "entregada");

  const entregadaPasoPorB = await crearOrden("entregada-paso-b", zonaB, "entregada");
  await sembrarPasoPorBodega(entregadaPasoPorB, adminB);

  const devueltaSinBodega = await crearOrden("devuelta-sin-bodega", zonaA, "devuelta");
  await sembrarSinBodega(devueltaSinBodega, "devuelta");

  const rechazadaPasoPorA = await crearOrden("rechazada-paso-a", zonaA, "rechazada");
  await sembrarPasoPorBodega(rechazadaPasoPorA, adminA);

  // SIN historial a proposito: reproduce las filas que existen hoy en la base (medidas: SEIS
  // ordenes en `en_bodega_satelite` sin ninguna transicion que las haya llevado ahi).
  const enBodegaSinHistorial = await crearOrden("en-bodega-sin-hist", zonaA, "en_bodega_satelite");

  const borradaPasoPorA = await crearOrden("borrada-paso-a", zonaA, "entregada", {
    borrada: true,
  });
  await sembrarPasoPorBodega(borradaPasoPorA, adminA);

  const enRutaHaciaA = await crearOrden("en-ruta-hacia-a", zonaA, "en_ruta_bodega_satelite");
  await tx.ordenHistorialEstado.create({
    data: {
      ordenId: enRutaHaciaA,
      estatusOrigenId: estatus("en_bodega_central"),
      estatusDestinoId: estatus("en_ruta_bodega_satelite"),
      actorUsuarioId: null,
      origenTipo: "ruteo_satelite",
    },
  });

  return {
    adminA,
    adminB,
    zonaA,
    zonaB,
    entregadaPasoPorA,
    entregadaSinBodega,
    entregadaPasoPorB,
    devueltaSinBodega,
    rechazadaPasoPorA,
    enBodegaSinHistorial,
    borradaPasoPorA,
    enRutaHaciaA,
  };
}

/** El servicio REAL, atado a la transaccion del test. */
function servicio(tx: Tx): RecepcionSateliteService {
  const prisma = tx as unknown as PrismaClient;
  const ordenes = new OrdenRepository(prisma);
  return new RecepcionSateliteService(
    ordenes,
    new OrdenHistorialService(
      ordenes,
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
  );
}

const PAGINA = { page: 1, pageSize: 100 } as const;

describeSiHayBase("FICHA 357 · el alcance de la satelite es SU BODEGA, no su zona", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("(a)(b)(c) las tres filas de la ficha, en una sola pagina del servicio real", async () => {
    const { escenario, pagina, completo } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const actor = { usuarioId: sembrado.adminA, rol: "adminSatelite" as const };
      const srv = servicio(tx);
      return {
        escenario: sembrado,
        pagina: await srv.listarOrdenesBodegaPaginado(PAGINA, actor),
        completo: await srv.listarOrdenesBodegaCompleto({}, actor),
      };
    });

    expect(pagina.status).toBe("ok");
    if (pagina.status !== "ok") throw new Error("la pagina no volvio ok");
    const vistos = new Set(pagina.items.map((o) => o.id));

    // (a) LA CARA A: la entregada que SI paso por la bodega A. Antes de la ficha era invisible.
    expect(vistos).toContain(escenario.entregadaPasoPorA);
    // Y el caso literal del reporte humano: la rechazada con el cierre pendiente.
    expect(vistos).toContain(escenario.rechazadaPasoPorA);

    // (b) LA CARA B: misma zona, mismo estado, pero NUNCA paso por una bodega satelite.
    expect(vistos).not.toContain(escenario.entregadaSinBodega);

    // (c) EL QUE IMPIDE QUE «MI BODEGA» SEA «MI ZONA»: paso por la bodega B.
    expect(vistos).not.toContain(escenario.entregadaPasoPorB);

    // El conjunto de la DESCARGA mira EXACTAMENTE lo mismo: si divergiera, el archivo llevaria
    // filas que la pantalla no enseña y ningun test de pantalla lo veria.
    expect(completo.status).toBe("ok");
    if (completo.status !== "ok") throw new Error("el conjunto no volvio ok");
    expect(new Set(completo.items.map((o) => o.id))).toEqual(vistos);
  });

  it("la cara B se cierra: la `devuelta` ajena que HOY se ve deja de verse, y se demuestra que hoy se veia", async () => {
    const { escenario, pagina, viejoCriterio } = await enTransaccionRevertida(
      prisma,
      async (tx) => {
        const sembrado = await sembrar(tx);
        // El criterio VIEJO, corrido contra la MISMA base y las MISMAS filas: zona ∧ los cinco
        // estados. Sin esto, «ya no se ve» no distinguiria «lo arregle» de «nunca se vio».
        const antes = await tx.orden.findMany({
          where: {
            zonaId: sembrado.zonaA,
            deletedAt: null,
            estatus: { value: { in: [...LISTA_BLANCA_VIEJA] } },
          },
          select: { id: true },
        });
        return {
          escenario: sembrado,
          viejoCriterio: antes.map((o) => o.id),
          pagina: await servicio(tx).listarOrdenesBodegaPaginado(PAGINA, {
            usuarioId: sembrado.adminA,
            rol: "adminSatelite",
          }),
        };
      },
    );

    // ANTES: la devolucion ajena entraba. Esta es la afirmacion que hace que el «despues» valga.
    expect(viejoCriterio).toContain(escenario.devueltaSinBodega);

    expect(pagina.status).toBe("ok");
    if (pagina.status !== "ok") throw new Error("la pagina no volvio ok");
    const vistos = pagina.items.map((o) => o.id);
    // DESPUES: fuera.
    expect(vistos).not.toContain(escenario.devueltaSinBodega);
    // Y lo que SI estaba en el estante sigue estando: el cambio no puede perder lo fisico.
    expect(vistos).toContain(escenario.enBodegaSinHistorial);
  });

  it("las borradas siguen fuera —tampoco en el TOTAL— y las «Por recibir» no se cuelan", async () => {
    const { escenario, pagina } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      return {
        escenario: sembrado,
        pagina: await servicio(tx).listarOrdenesBodegaPaginado(PAGINA, {
          usuarioId: sembrado.adminA,
          rol: "adminSatelite",
        }),
      };
    });

    expect(pagina.status).toBe("ok");
    if (pagina.status !== "ok") throw new Error("la pagina no volvio ok");
    const vistos = pagina.items.map((o) => o.id);

    // `deleted_at` manda por encima de todo: paso por la bodega A y aun asi no vuelve.
    expect(vistos).not.toContain(escenario.borradaPasoPorA);
    // Y NO BASTA CON MIRAR LAS FILAS. La hidratacion repite `deletedAt: null` por su cuenta, asi
    // que una borrada que se colara en el `WHERE` desapareceria igual de `items` — pero seguiria
    // CONTADA, porque el total sale del `COUNT(*) OVER ()` de la consulta que ordena. Medido: con
    // la condicion retirada del `WHERE`, `items` sigue trayendo 3 y `total` pasa a 4. El total es
    // el que delata la fuga (el 29 de agosto se borraron 29 ordenes en produccion).
    expect(pagina.total).toBe(pagina.items.length);
    // `en_ruta_bodega_satelite` es EVIDENCIA de alcance pero NO un estado de este listado:
    // vive en `/recepcion-satelite/por-recibir`. Si entrara, la fila estaria en dos pantallas.
    expect(vistos).not.toContain(escenario.enRutaHaciaA);
    expect(ESTADOS_CUSTODIA_SATELITE as readonly string[]).toContain("en_ruta_bodega_satelite");
    expect(ESTADOS_BODEGA_SATELITE as readonly string[]).not.toContain(
      "en_ruta_bodega_satelite",
    );
  });

  it("la bodega B ve lo suyo y solo lo suyo: el alcance es simetrico, no un privilegio de A", async () => {
    const { escenario, paginaB } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      return {
        escenario: sembrado,
        paginaB: await servicio(tx).listarOrdenesBodegaPaginado(PAGINA, {
          usuarioId: sembrado.adminB,
          rol: "adminSatelite",
        }),
      };
    });

    expect(paginaB.status).toBe("ok");
    if (paginaB.status !== "ok") throw new Error("la pagina no volvio ok");
    const vistos = paginaB.items.map((o) => o.id);

    // Lo suyo, que es UNA sola: si B viera mas, el recorte por zona habria dejado de mandar.
    expect(vistos).toEqual([escenario.entregadaPasoPorB]);
    expect(paginaB.total).toBe(1);
  });

  it("el filtro de estado no puede ampliar el alcance: pedir un estado de la central devuelve NADA", async () => {
    const { pagina, conEstadoDeLaCentral } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const actor = { usuarioId: sembrado.adminA, rol: "adminSatelite" as const };
      const srv = servicio(tx);
      return {
        pagina: await srv.listarOrdenesBodegaPaginado(PAGINA, actor),
        // `en_bodega_central` no esta en `ESTADOS_BODEGA_SATELITE`: la interseccion queda vacia
        // y el listado devuelve NADA, no «todos».
        conEstadoDeLaCentral: await srv.listarOrdenesBodegaPaginado(
          { ...PAGINA, estados: ["en_bodega_central"] as never },
          actor,
        ),
      };
    });

    expect(pagina.status).toBe("ok");
    if (pagina.status !== "ok") throw new Error("la pagina no volvio ok");
    // Contraprueba de no-vacuidad: sin filtro SI hay filas, asi que el cero de abajo es del
    // filtro y no de la siembra.
    expect(pagina.items.length).toBeGreaterThan(0);

    expect(conEstadoDeLaCentral.status).toBe("ok");
    if (conEstadoDeLaCentral.status !== "ok") throw new Error("la pagina no volvio ok");
    expect(conEstadoDeLaCentral.items).toEqual([]);
    expect(conEstadoDeLaCentral.total).toBe(0);
  });

  it("todo lo que la pantalla enseña se puede filtrar: los estados observados salen del contrato", async () => {
    const { estados } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const pagina = await servicio(tx).listarOrdenesBodegaPaginado(PAGINA, {
        usuarioId: sembrado.adminA,
        rol: "adminSatelite",
      });
      return { estados: pagina.status === "ok" ? pagina.items.map((o) => o.estatusValue) : null };
    });

    expect(estados).not.toBeNull();
    const observados = new Set(estados as string[]);
    // No-vacuidad, y ADEMAS que la siembra ejercite estados NUEVOS de la ficha (no solo los
    // cinco de siempre): sin esto, la comprobacion de abajo estaria verde con una sola fila.
    expect(observados.size).toBeGreaterThanOrEqual(3);
    expect(observados).toContain("entregada");
    expect(observados).toContain("rechazada");
    for (const estado of observados) {
      expect(ESTADOS_BODEGA_SATELITE as readonly string[]).toContain(estado);
    }
  });
});
