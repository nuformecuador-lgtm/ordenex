import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenService } from "@/lib/services/OrdenService";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import {
  listarOrdenesCompletoSchema,
  listarOrdenesSchema,
  SALIO_A_REPARTO_VALORES,
} from "@/lib/types/orden";
import {
  listarIdsVigentesBodegaSchema,
  listarOrdenesBodegaCompletoSchema,
  listarOrdenesBodegaPaginadoSchema,
} from "@/lib/types/recepcion-satelite";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 370 — «YA SALIO A REPARTO» CONTRA POSTGRES DE VERDAD.
 *
 * ─── POR QUE ESTE ARCHIVO, Y POR QUE NO VALEN DOBLES ───────────────────────────────────────
 *
 * Lo que esta ficha cambia es UN `WHERE`. En este repo esta medido —cuatro veces seguidas, y
 * escrito en `docs/verification.md`— que una mutacion del `WHERE` pasa en VERDE con dobles: el
 * doble acepta cualquier criterio y devuelve lo que se le dijo. Aqui las filas las elige
 * Postgres, y por eso invertir el filtro, cambiar el estado destino o quitar el `EXISTS` pone
 * rojo un test con nombre.
 *
 * ─── LAS FILAS QUE SOSTIENEN LA FICHA ─────────────────────────────────────────────────────
 *
 * Cada caso viene con su HERMANA del grupo contrario, sembrada en la MISMA corrida: sin eso,
 * «no sale» no distingue «el filtro funciona» de «la siembra estaba vacia».
 *
 *   (1) recien creada, guia generada, nunca salio          -> NUEVA
 *   (2) CERO filas de historial (la mas nueva de todas)    -> NUEVA   [mata el `every`]
 *   (3) salio a `en_reparto` y tiene gestion `reprogramada` -> CON HISTORIA
 *   (4) salio a `en_reparto` y NO tiene NINGUNA gestion     -> CON HISTORIA  [las 76 de produccion]
 *   (5) asignada y desasignada SIN llegar a salir           -> NUEVA
 *
 * (4) es el caso que descarta el criterio ingenuo («¿tiene gestion?»): son 76 ordenes en
 * produccion que salieron, nadie gestiono y el cron corto a `sin_gestionar` — un 11% mal
 * clasificado. Este archivo mide el criterio ingenuo EN LA MISMA CORRIDA para demostrar que
 * discrepa, en vez de afirmarlo de palabra.
 *
 * (2) mata la confusion `none` vs `every`: `every` es vacuamente cierto sobre el conjunto vacio
 * y clasificaria como «ya salio» justo a la orden recien nacida, en verde y sin ruido.
 *
 * ─── AISLAMIENTO ──────────────────────────────────────────────────────────────────────────
 *
 * Todo dentro de `enTransaccionRevertida`: si el test pasa, si falla o si el runner muere, no
 * queda ni una fila en la base compartida. Sin base alcanzable el archivo se SALTA (y eso se
 * ve en el reporte como `skipped`, NUNCA como `passed`).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface Escenario {
  readonly maestro: string;
  readonly adminSat: string;
  readonly zonaCentral: string;
  readonly zonaSat: string;
  // --- Bodega central ---------------------------------------------------------------
  /** (1) Guia generada y nada mas: nunca salio. */
  readonly nueva: string;
  /** (2) CERO filas de historial. La que `every` clasificaria mal. */
  readonly nuevaSinHistorial: string;
  /** (3) Salio y tiene gestion `reprogramada`. */
  readonly salioYReprogramada: string;
  /** (4) ⭐ Salio, NADIE la gestiono, el cron la corto a `sin_gestionar`. */
  readonly salioSinGestion: string;
  /** (5) Asignada y desasignada ANTES de salir: cuenta como NUEVA (decision humana). */
  readonly asignadaYDesasignada: string;
  // --- Bodega satelite --------------------------------------------------------------
  readonly satNueva: string;
  readonly satSalioSinGestion: string;
  readonly satSalioYReprogramada: string;
  readonly satAsignadaYDesasignada: string;
}

/** Las cinco de la bodega CENTRAL, en el orden en que se declaran arriba. */
function centrales(e: Escenario): string[] {
  return [
    e.nueva,
    e.nuevaSinHistorial,
    e.salioYReprogramada,
    e.salioSinGestion,
    e.asignadaYDesasignada,
  ];
}

function nuevasCentrales(e: Escenario): string[] {
  return [e.nueva, e.nuevaSinHistorial, e.asignadaYDesasignada];
}

function conHistoriaCentrales(e: Escenario): string[] {
  return [e.salioYReprogramada, e.salioSinGestion];
}

function nuevasSatelite(e: Escenario): string[] {
  return [e.satNueva, e.satAsignadaYDesasignada];
}

function conHistoriaSatelite(e: Escenario): string[] {
  return [e.satSalioSinGestion, e.satSalioYReprogramada];
}

async function sembrar(tx: Tx): Promise<Escenario> {
  await serializarEscriturasReales(tx);
  const sufijo = `f370-${randomUUID().slice(0, 8)}`;

  const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
  const [tipoIdentificacion, rolTienda, rolSatelite, rolMensajero, rolMaestro] =
    await Promise.all([
      tx.tipoIdentificacion.findFirst({ select: { id: true } }),
      tx.rol.findFirst({ where: { value: "adminTienda" }, select: { id: true } }),
      tx.rol.findFirst({ where: { value: "adminSatelite" }, select: { id: true } }),
      tx.rol.findFirst({ where: { value: "mensajero" }, select: { id: true } }),
      tx.rol.findFirst({ where: { value: "maestro" }, select: { id: true } }),
    ]);
  // Fallo RUIDOSO, nunca un `return` silencioso: un `if (!catalogo) return;` deja el caso en
  // «passed» sin haber comprobado nada, que es como este repo ya se ha mentido antes.
  if (!canton || !tipoIdentificacion || !rolTienda || !rolSatelite || !rolMensajero || !rolMaestro) {
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
          email: `${sufijo}-${nombre}@f370.local`,
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

  const zonaCentral = await crearZona("central");
  const zonaSat = await crearZona("satelite");
  const maestro = await crearUsuario("Maestra", rolMaestro.id, null);
  const adminSat = await crearUsuario("SaraSat", rolSatelite.id, zonaSat);
  const tienda = await crearUsuario("Tienda", rolTienda.id, null);
  const mensajero = await crearUsuario("Ana", rolMensajero.id, zonaSat);

  const crearOrden = async (
    clave: string,
    zonaId: string,
    estatusValue: string,
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
          // NULL a proposito: las de la central son ademas «reasignables», que es la pantalla
          // desde la que se pide este filtro.
          mensajeroAsignadoId: null,
          cobraComision: true,
        },
        select: { id: true },
      })
    ).id;

  /** Una transicion del historial, escrita como la escribe la aplicacion. */
  const transicion = async (
    ordenId: string,
    origen: string | null,
    destino: string,
    origenTipo: Parameters<typeof tx.ordenHistorialEstado.create>[0]["data"]["origenTipo"],
  ): Promise<void> => {
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusOrigenId: origen === null ? null : estatus(origen),
        estatusDestinoId: estatus(destino),
        actorUsuarioId: null,
        origenTipo,
      },
    });
  };

  /** La gestion REAL que acompaña a una `reprogramada`. Es lo que mide el criterio INGENUO. */
  const gestionReprogramada = async (ordenId: string): Promise<void> => {
    await tx.gestionOrden.create({
      data: { ordenId, mensajeroId: mensajero, resultado: "reprogramada", motivo: "no estaba" },
    });
  };

  // ─── BODEGA CENTRAL ──────────────────────────────────────────────────────────────────
  // (1) Nace y se le genera la guia. Ni un paso mas.
  const nueva = await crearOrden("nueva", zonaCentral, "en_bodega_central");
  await transicion(nueva, null, "en_preparacion", "carga_masiva");
  await transicion(nueva, "en_preparacion", "en_bodega_central", "generacion_guia");

  // (2) SIN una sola fila de historial. `none` la incluye en «nunca salio»; `every` la sacaria.
  const nuevaSinHistorial = await crearOrden("nueva-sin-hist", zonaCentral, "en_bodega_central");

  // (3) Salio, la reprogramaron y volvio a la central.
  const salioYReprogramada = await crearOrden("salio-reprog", zonaCentral, "en_bodega_central");
  await transicion(salioYReprogramada, "en_bodega_central", "por_recoger", "asignacion_bodega");
  await transicion(salioYReprogramada, "por_recoger", "en_reparto", "recoleccion");
  await transicion(salioYReprogramada, "en_reparto", "reprogramada", "gestion");
  await transicion(
    salioYReprogramada,
    "reprogramada",
    "en_bodega_central",
    "liberacion_reprogramada",
  );
  await gestionReprogramada(salioYReprogramada);

  // (4) ⭐ Salio, NADIE la gestiono y el corte de la noche la mando a `sin_gestionar`. Sin una
  // sola fila de `gestion_orden`: es la fila que el criterio ingenuo clasificaria como «nueva».
  const salioSinGestion = await crearOrden("salio-sin-gestion", zonaCentral, "en_bodega_central");
  await transicion(salioSinGestion, "en_bodega_central", "por_recoger", "asignacion_bodega");
  await transicion(salioSinGestion, "por_recoger", "en_reparto", "recoleccion");
  await transicion(salioSinGestion, "en_reparto", "sin_gestionar", "corte_sin_gestionar");
  await transicion(
    salioSinGestion,
    "sin_gestionar",
    "en_bodega_central",
    "liberacion_sin_gestionar",
  );

  // (5) Se le puso mensajero y se deshizo ANTES de que saliera. Decision humana: es NUEVA.
  const asignadaYDesasignada = await crearOrden("asig-desasig", zonaCentral, "en_bodega_central");
  await transicion(asignadaYDesasignada, "en_bodega_central", "por_recoger", "asignacion_bodega");
  await transicion(
    asignadaYDesasignada,
    "por_recoger",
    "en_bodega_central",
    "deshacer_asignacion",
  );

  // ─── BODEGA SATELITE ─────────────────────────────────────────────────────────────────
  // Todas llevan la EVIDENCIA de «paso por MI bodega» (ficha 357): ruteo + recepcion. Sin ella
  // el listado de la satelite no las veria y estos casos no medirian nada de esta ficha.
  const rutearYRecibir = async (ordenId: string): Promise<void> => {
    await transicion(ordenId, "en_bodega_central", "en_ruta_bodega_satelite", "ruteo_satelite");
    await transicion(
      ordenId,
      "en_ruta_bodega_satelite",
      "en_bodega_satelite",
      "recepcion_satelite",
    );
  };

  const satNueva = await crearOrden("sat-nueva", zonaSat, "en_bodega_satelite");
  await rutearYRecibir(satNueva);

  const satSalioSinGestion = await crearOrden("sat-salio-sin-g", zonaSat, "en_bodega_satelite");
  await rutearYRecibir(satSalioSinGestion);
  await transicion(satSalioSinGestion, "en_bodega_satelite", "por_recoger", "asignacion_satelite");
  await transicion(satSalioSinGestion, "por_recoger", "en_reparto", "recoleccion");
  await transicion(satSalioSinGestion, "en_reparto", "sin_gestionar", "corte_sin_gestionar");
  await transicion(
    satSalioSinGestion,
    "sin_gestionar",
    "en_bodega_satelite",
    "liberacion_sin_gestionar",
  );

  const satSalioYReprogramada = await crearOrden("sat-salio-rep", zonaSat, "en_bodega_satelite");
  await rutearYRecibir(satSalioYReprogramada);
  await transicion(
    satSalioYReprogramada,
    "en_bodega_satelite",
    "por_recoger",
    "asignacion_satelite",
  );
  await transicion(satSalioYReprogramada, "por_recoger", "en_reparto", "recoleccion");
  await transicion(satSalioYReprogramada, "en_reparto", "reprogramada", "gestion");
  await transicion(
    satSalioYReprogramada,
    "reprogramada",
    "en_bodega_satelite",
    "liberacion_reprogramada",
  );
  await gestionReprogramada(satSalioYReprogramada);

  const satAsignadaYDesasignada = await crearOrden("sat-asig-des", zonaSat, "en_bodega_satelite");
  await rutearYRecibir(satAsignadaYDesasignada);
  await transicion(
    satAsignadaYDesasignada,
    "en_bodega_satelite",
    "por_recoger",
    "asignacion_satelite",
  );
  await transicion(
    satAsignadaYDesasignada,
    "por_recoger",
    "en_bodega_satelite",
    "deshacer_asignacion",
  );

  return {
    maestro,
    adminSat,
    zonaCentral,
    zonaSat,
    nueva,
    nuevaSinHistorial,
    salioYReprogramada,
    salioSinGestion,
    asignadaYDesasignada,
    satNueva,
    satSalioSinGestion,
    satSalioYReprogramada,
    satAsignadaYDesasignada,
  };
}

/** Los servicios REALES, atados a la transaccion del test. */
function servicios(tx: Tx): { ordenes: OrdenService; satelite: RecepcionSateliteService } {
  const prisma = tx as unknown as PrismaClient;
  const repo = new OrdenRepository(prisma);
  const historial = new OrdenHistorialService(
    repo,
    new OrdenHistorialRepository(prisma),
    new OrdenDiaRepartoCambioRepository(prisma),
  );
  return {
    ordenes: new OrdenService(repo, historial),
    satelite: new RecepcionSateliteService(repo, historial),
  };
}

/**
 * La entrada del listado de `/ordenes` PASANDO POR EL BORDE (`listarOrdenesSchema`), no
 * construida a mano: asi el mismo caso que mide el `WHERE` demuestra que el schema `.strict()`
 * ACEPTA la clave nueva y sus dos valores. Un objeto a mano se saltaria esa mitad.
 */
function entradaOrdenes(zonaId: string, salio?: string) {
  return listarOrdenesSchema.parse({
    page: 1,
    pageSize: 50,
    filter: { zona_id: [zonaId], ...(salio ? { salio_a_reparto: salio } : {}) },
  });
}

function entradaOrdenesCompleto(zonaId: string, salio?: string) {
  return listarOrdenesCompletoSchema.parse({
    filter: { zona_id: [zonaId], ...(salio ? { salio_a_reparto: salio } : {}) },
  });
}

describeSiHayBase("FICHA 370 · «ya salio a reparto» decide sobre filas reales", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("/ordenes: los dos grupos son complementarios y disjuntos, con las cinco filas en la MISMA corrida", async () => {
    const { escenario, sinFiltro, nuevas, conHistoria } = await enTransaccionRevertida(
      prisma,
      async (tx) => {
        const sembrado = await sembrar(tx);
        const actor = { usuarioId: sembrado.maestro, rol: "maestro" as const };
        const { ordenes } = servicios(tx);
        return {
          escenario: sembrado,
          sinFiltro: await ordenes.listar(entradaOrdenes(sembrado.zonaCentral), actor),
          nuevas: await ordenes.listar(
            entradaOrdenes(sembrado.zonaCentral, "nunca_salio"),
            actor,
          ),
          conHistoria: await ordenes.listar(
            entradaOrdenes(sembrado.zonaCentral, "ya_salio"),
            actor,
          ),
        };
      },
    );

    const ids = (r: typeof sinFiltro): string[] => {
      if (r.status !== "ok") throw new Error(`el listado no volvio ok: ${r.status}`);
      return r.items.map((o) => o.id);
    };

    // SIN FILTRO salen los DOS grupos: es la contraprueba de no-vacuidad de todo lo de abajo
    // y, a la vez, el caso «ausencia de la clave = no filtra».
    expect(new Set(ids(sinFiltro))).toEqual(new Set(centrales(escenario)));

    // (1)(2)(5) NUEVAS — y ni una de las dos que salieron.
    expect(new Set(ids(nuevas))).toEqual(new Set(nuevasCentrales(escenario)));
    // (3)(4) CON HISTORIA — y ni una de las tres nuevas.
    expect(new Set(ids(conHistoria))).toEqual(new Set(conHistoriaCentrales(escenario)));

    // Complementarios y DISJUNTOS: una orden esta exactamente en un grupo.
    expect([...ids(nuevas), ...ids(conHistoria)].sort()).toEqual([...ids(sinFiltro)].sort());
    expect(ids(nuevas).filter((id) => ids(conHistoria).includes(id))).toEqual([]);
    // Y el `total` acompaña: si el filtro se aplicara a las filas pero no al conteo, la
    // paginacion mentiria y `items` no lo delataria.
    if (nuevas.status !== "ok" || conHistoria.status !== "ok") throw new Error("no ok");
    expect(nuevas.total).toBe(3);
    expect(conHistoria.total).toBe(2);
  });

  it("⭐ la que salio y NADIE gestiono cuenta como CON HISTORIA: el criterio ingenuo la clasificaria mal", async () => {
    const { escenario, nuevas, conHistoria, conGestion } = await enTransaccionRevertida(
      prisma,
      async (tx) => {
        const sembrado = await sembrar(tx);
        const actor = { usuarioId: sembrado.maestro, rol: "maestro" as const };
        const { ordenes } = servicios(tx);
        // EL CRITERIO INGENUO, corrido contra las MISMAS filas: «¿tiene alguna gestion?». Sin
        // esto, «el filtro acierta» no distinguiria «acerte» de «los dos criterios coinciden».
        const gestionadas = await tx.orden.findMany({
          where: { zonaId: sembrado.zonaCentral, gestiones: { some: {} } },
          select: { id: true },
        });
        return {
          escenario: sembrado,
          conGestion: gestionadas.map((o) => o.id),
          nuevas: await ordenes.listar(
            entradaOrdenes(sembrado.zonaCentral, "nunca_salio"),
            actor,
          ),
          conHistoria: await ordenes.listar(
            entradaOrdenes(sembrado.zonaCentral, "ya_salio"),
            actor,
          ),
        };
      },
    );

    if (nuevas.status !== "ok" || conHistoria.status !== "ok") throw new Error("no ok");

    // EL CRITERIO INGENUO diria que esta orden es «nueva»: no tiene ni una gestion.
    expect(conGestion).not.toContain(escenario.salioSinGestion);
    // EL CRITERIO DE LA FICHA dice que YA SALIO. Esta es la discrepancia entera, medida.
    expect(conHistoria.items.map((o) => o.id)).toContain(escenario.salioSinGestion);
    expect(nuevas.items.map((o) => o.id)).not.toContain(escenario.salioSinGestion);
    // No-vacuidad del criterio ingenuo: SI encuentra la otra, asi que su cero de arriba es un
    // cero de verdad y no «la consulta no funciona».
    expect(conGestion).toContain(escenario.salioYReprogramada);
  });

  it("CERO filas de historial es NUEVA (y no «ya salio»): la diferencia entre `none` y `every`", async () => {
    const { escenario, filasDeHistorial, nuevas, conHistoria } = await enTransaccionRevertida(
      prisma,
      async (tx) => {
        const sembrado = await sembrar(tx);
        const actor = { usuarioId: sembrado.maestro, rol: "maestro" as const };
        const { ordenes } = servicios(tx);
        return {
          escenario: sembrado,
          filasDeHistorial: await tx.ordenHistorialEstado.count({
            where: { ordenId: sembrado.nuevaSinHistorial },
          }),
          nuevas: await ordenes.listar(
            entradaOrdenes(sembrado.zonaCentral, "nunca_salio"),
            actor,
          ),
          conHistoria: await ordenes.listar(
            entradaOrdenes(sembrado.zonaCentral, "ya_salio"),
            actor,
          ),
        };
      },
    );

    if (nuevas.status !== "ok" || conHistoria.status !== "ok") throw new Error("no ok");

    // La premisa del caso, afirmada y no supuesta: esta orden NO tiene ni una transicion.
    expect(filasDeHistorial).toBe(0);
    // `none` -> NOT EXISTS -> la incluye. `every` seria vacuamente cierto y la mandaria al otro
    // grupo, en verde: por eso este caso existe.
    expect(nuevas.items.map((o) => o.id)).toContain(escenario.nuevaSinHistorial);
    expect(conHistoria.items.map((o) => o.id)).not.toContain(escenario.nuevaSinHistorial);
    // Y la hermana con historial pero SIN salida (la asignada y desasignada) tambien es nueva:
    // «tener historial» no es «haber salido».
    expect(nuevas.items.map((o) => o.id)).toContain(escenario.asignadaYDesasignada);
  });

  it("/ordenes: la DESCARGA devuelve exactamente lo mismo que la pantalla, con y sin filtro", async () => {
    const { pantalla, archivo } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const actor = { usuarioId: sembrado.maestro, rol: "maestro" as const };
      const { ordenes } = servicios(tx);
      const pantalla: Record<string, string[]> = {};
      const archivo: Record<string, string[]> = {};
      for (const valor of [undefined, ...SALIO_A_REPARTO_VALORES]) {
        const clave = valor ?? "sin_filtro";
        const p = await ordenes.listar(entradaOrdenes(sembrado.zonaCentral, valor), actor);
        const a = await ordenes.listarCompleto(
          entradaOrdenesCompleto(sembrado.zonaCentral, valor),
          actor,
        );
        if (p.status !== "ok" || a.status !== "ok") throw new Error(`no ok en ${clave}`);
        pantalla[clave] = p.items.map((o) => o.id).sort();
        archivo[clave] = a.items.map((o) => o.id).sort();
      }
      return { pantalla, archivo };
    });

    // No-vacuidad ANTES de comparar: dos conjuntos vacios tambien son iguales.
    expect(pantalla["sin_filtro"]!.length).toBe(5);
    expect(pantalla["nunca_salio"]!.length).toBe(3);
    expect(pantalla["ya_salio"]!.length).toBe(2);
    // Si el filtro se aplicara en `list` y no en `listarCompleto`, el archivo llevaria filas que
    // la pantalla no enseña y ningun test de pantalla lo veria. Ya paso en este repo.
    expect(archivo).toEqual(pantalla);
  });

  it("bodega satelite: los mismos casos, en las TRES consultas del modulo", async () => {
    const { escenario, sinFiltro, nuevas, conHistoria, completoNuevas, vigentesNuevas } =
      await enTransaccionRevertida(prisma, async (tx) => {
        const sembrado = await sembrar(tx);
        const actor = { usuarioId: sembrado.adminSat, rol: "adminSatelite" as const };
        const { satelite } = servicios(tx);
        const pagina = (salio?: string) =>
          satelite.listarOrdenesBodegaPaginado(
            listarOrdenesBodegaPaginadoSchema.parse({
              page: 1,
              pageSize: 50,
              ...(salio ? { salio_a_reparto: salio } : {}),
            }),
            actor,
          );
        return {
          escenario: sembrado,
          sinFiltro: await pagina(),
          nuevas: await pagina("nunca_salio"),
          conHistoria: await pagina("ya_salio"),
          completoNuevas: await satelite.listarOrdenesBodegaCompleto(
            listarOrdenesBodegaCompletoSchema.parse({ salio_a_reparto: "nunca_salio" }),
            actor,
          ),
          // LA TERCERA consulta: decide sobre que filas se puede ACTUAR, no solo que se ve.
          // Se le preguntan las CUATRO; solo pueden volver las dos nuevas.
          vigentesNuevas: await satelite.listarIdsVigentesBodega(
            listarIdsVigentesBodegaSchema.parse({
              salio_a_reparto: "nunca_salio",
              ids: [
                sembrado.satNueva,
                sembrado.satAsignadaYDesasignada,
                sembrado.satSalioSinGestion,
                sembrado.satSalioYReprogramada,
              ],
            }),
            actor,
          ),
        };
      });

    if (sinFiltro.status !== "ok" || nuevas.status !== "ok" || conHistoria.status !== "ok") {
      throw new Error("la pagina de la satelite no volvio ok");
    }
    if (completoNuevas.status !== "ok") throw new Error("el conjunto no volvio ok");
    if (vigentesNuevas.status !== "ok") throw new Error("la vigencia no volvio ok");

    const todas = [...nuevasSatelite(escenario), ...conHistoriaSatelite(escenario)];

    // (a) SIN FILTRO salen los DOS grupos: no-vacuidad y «ausente no filtra».
    expect(new Set(sinFiltro.items.map((o) => o.id))).toEqual(new Set(todas));
    expect(sinFiltro.total).toBe(4);

    // (b) LA PAGINA parte el conjunto, incluido el caso `sin_gestionar`.
    expect(new Set(nuevas.items.map((o) => o.id))).toEqual(new Set(nuevasSatelite(escenario)));
    expect(new Set(conHistoria.items.map((o) => o.id))).toEqual(
      new Set(conHistoriaSatelite(escenario)),
    );
    expect(conHistoria.items.map((o) => o.id)).toContain(escenario.satSalioSinGestion);
    expect(nuevas.total).toBe(2);
    expect(conHistoria.total).toBe(2);

    // (c) LA DESCARGA mira exactamente el mismo conjunto que la pagina.
    expect(completoNuevas.items.map((o) => o.id).sort()).toEqual(
      nuevas.items.map((o) => o.id).sort(),
    );

    // (d) LA SELECCION: preguntando por las cuatro, solo siguen vigentes las dos nuevas. Si
    // esta consulta no llevara el filtro, la barra ofreceria acciones sobre filas que la
    // pantalla ya no enseña.
    expect(vigentesNuevas.ids.sort()).toEqual([...nuevasSatelite(escenario)].sort());
  });

  it("los dos dialectos del criterio dicen lo mismo: Prisma (`/ordenes`) y SQL crudo (satelite)", async () => {
    const { porPrisma, porSqlCrudo } = await enTransaccionRevertida(prisma, async (tx) => {
      const sembrado = await sembrar(tx);
      const { ordenes, satelite } = servicios(tx);
      const maestro = { usuarioId: sembrado.maestro, rol: "maestro" as const };
      const admin = { usuarioId: sembrado.adminSat, rol: "adminSatelite" as const };
      const porPrisma: Record<string, string[]> = {};
      const porSqlCrudo: Record<string, string[]> = {};
      // LAS MISMAS FILAS por los DOS caminos: las de la zona satelite, todas con evidencia de
      // paso por esa bodega y todas en estados que el listado de la bodega muestra. Por eso los
      // dos conjuntos tienen que coincidir fila a fila.
      for (const valor of [undefined, ...SALIO_A_REPARTO_VALORES]) {
        const clave = valor ?? "sin_filtro";
        const p = await ordenes.listar(entradaOrdenes(sembrado.zonaSat, valor), maestro);
        const s = await satelite.listarOrdenesBodegaCompleto(
          listarOrdenesBodegaCompletoSchema.parse(valor ? { salio_a_reparto: valor } : {}),
          admin,
        );
        if (p.status !== "ok" || s.status !== "ok") throw new Error(`no ok en ${clave}`);
        porPrisma[clave] = p.items.map((o) => o.id).sort();
        porSqlCrudo[clave] = s.items.map((o) => o.id).sort();
      }
      return { porPrisma, porSqlCrudo };
    });

    // No-vacuidad y particion real ANTES de comparar: si los tres conjuntos fueran vacios, la
    // igualdad de abajo seria cierta y no diria nada.
    expect(porPrisma["sin_filtro"]!.length).toBe(4);
    expect(porPrisma["nunca_salio"]!.length).toBe(2);
    expect(porPrisma["ya_salio"]!.length).toBe(2);
    // EL CRITERIO ES UNO. Se emite en dos dialectos porque las dos rutas no comparten motor de
    // SQL (ver `criterioSalidaAReparto` en el repositorio); esta es la garantia EJECUTABLE de
    // que no han divergido.
    expect(porSqlCrudo).toEqual(porPrisma);
  });
});
