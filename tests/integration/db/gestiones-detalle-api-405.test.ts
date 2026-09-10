import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTestConEspia,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⏳ 2026-09-10 — FEATURE 405 (T8): `gestiones[]` EJECUTADO CONTRA POSTGRES.
 *
 * QUE SOSTIENE ESTE ARCHIVO, y por que no puede vivir arriba. Cuatro de los requisitos de esta
 * ficha son propiedades del SQL, no del mapeo:
 *
 *   · R11 — que las ANULADAS no salgan depende del `anulada_at IS NULL` de la rama del `OR`;
 *   · R10 — que el orden sea estable depende del `ORDER BY created_at, id` de la relacion;
 *   · R6  — que `estadoResultante` sea el destino de la PRIMERA transicion depende de que el
 *           historial llegue ordenado y filtrado por `gestion_orden_id IS NOT NULL`;
 *   · R13 — que una orden ajena no se lea depende del `tienda_id = ownerId` del `findFirst`.
 *
 * Un test de servicio con dobles afirma que se llamo al repositorio; un test de repositorio con
 * un Prisma de mentira afirma la FORMA del `where`, no lo que la base hace con el. Este repo ya
 * midio CUATRO veces que una mutacion de un `where` sobrevive en verde por arriba. Aqui hay dos
 * tiendas de verdad, dos ordenes de verdad, cinco gestiones de verdad y un `SELECT` de verdad.
 *
 * CONTRAPRUEBAS APLICADAS (2026-09-10, y restauradas despues) — ver `progress/impl_405.md`:
 *   1. quitar la rama `{ anuladaAt: null }` del `OR` -> ROJO (la anulada aparece);
 *   2. quitar `tiendaId` del `where` del detalle -> ROJO (se lee la orden de la otra tienda);
 *   3. invertir el `orderBy` de `gestiones` a `desc` -> ROJO (el orden se da la vuelta);
 *   4. quedarse con la ULTIMA transicion en vez de la primera -> ROJO (R6).
 *
 * SIN BASE ALCANZABLE SE SALTA (`describe.skip`), NO pasa en verde: un `return` silencioso dentro
 * del caso se leeria como `passed` sin haber comprobado nada. CON base pero sin catalogo, falla
 * RUIDOSAMENTE en el `beforeAll`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` es UNICO entre las ordenes vivas de una tienda. */
const SUFIJO = `405-${Date.now().toString(36)}`;

/** Instantes FIJOS del escenario, para que el orden esperado sea un literal y no un calculo. */
const T = {
  reprogramada: new Date("2026-09-02T15:41:07.000Z"),
  devuelta: new Date("2026-09-04T18:02:55.000Z"),
  anulada: new Date("2026-09-05T09:00:00.000Z"),
  anuladaConFoto: new Date("2026-09-05T13:00:00.000Z"),
  legada: new Date("2026-09-06T11:30:00.000Z"),
} as const;

describeSiHayBase("ficha 405 — el detalle por API key publica las gestiones VIGENTES de la orden", () => {
  let prisma: PrismaClient;
  let eventos: { query: string }[];
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let tiendas: { id: string }[];
  let mensajeros: { id: string; nombre: string }[];
  let estatus: Map<string, string>;

  beforeAll(async () => {
    const espia = crearPrismaDeTestConEspia();
    prisma = espia.prisma;
    eventos = espia.eventos;

    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    fks = encontradas;

    tiendas = await prisma.usuario.findMany({ select: { id: true }, take: 2 });
    if (tiendas.length < 2) {
      throw new Error(
        "hacen falta al menos DOS usuarios: uno es la tienda dueña de la key y el otro la tienda " +
          "ajena que demuestra que el `where` filtra por tienda (R13).",
      );
    }

    mensajeros = await prisma.usuario.findMany({ select: { id: true, nombre: true }, take: 2 });
    if (mensajeros.length < 2) {
      throw new Error("hacen falta al menos DOS usuarios para atribuir gestiones distintas.");
    }

    const filas = await prisma.orderStatus.findMany({
      where: {
        value: { in: ["en_bodega_central", "reprogramada", "devolucion_por_confirmar", "entregada"] },
      },
      select: { id: true, value: true },
    });
    estatus = new Map(filas.map((f) => [f.value, f.id]));
    for (const value of ["en_bodega_central", "reprogramada", "devolucion_por_confirmar", "entregada"]) {
      if (!estatus.has(value)) {
        throw new Error(
          `falta el estado \`${value}\` en el catalogo \`order_status\`: corre \`pnpm run db:seed\`.`,
        );
      }
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Siembra el escenario COMPLETO y devuelve lo medido. Todo dentro de una transaccion que se
   * revierte siempre: si el test pasa, si falla o si el proceso muere, no queda ni una fila.
   */
  async function escenario() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [tiendaPropia, tiendaAjena] = tiendas;
      const [mensajeroA, mensajeroB] = mensajeros;

      const crearOrden = async (clave: string, tiendaId: string) =>
        (
          await tx.orden.create({
            data: {
              numRemision: `R-${SUFIJO}-${clave}`,
              destinatario: "Dest",
              telefonoDest: "88880000",
              producto: "Prod",
              estatusId: estatus.get("en_bodega_central")!,
              tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          })
        ).id;

      const propia = await crearOrden("propia", tiendaPropia.id);
      const ajena = await crearOrden("ajena", tiendaAjena.id);
      // Una TERCERA orden, propia y sin ninguna gestion: es el termino de comparacion de R19.
      const sinGestiones = await crearOrden("sin-gestiones", tiendaPropia.id);

      const crearGestion = async (data: {
        ordenId: string;
        mensajeroId: string;
        resultado: "entregada" | "reprogramada" | "devuelta" | "rechazada" | "incidente";
        createdAt: Date;
        anuladaAt?: Date | null;
        causaDevolucion?: "not_found" | "wrong_number" | "wrong_address" | null;
        motivo?: string | null;
        evidenciaStoragePath?: string | null;
      }) =>
        (
          await tx.gestionOrden.create({
            data: {
              ordenId: data.ordenId,
              mensajeroId: data.mensajeroId,
              resultado: data.resultado,
              createdAt: data.createdAt,
              anuladaAt: data.anuladaAt ?? null,
              causaDevolucion: data.causaDevolucion ?? null,
              evidenciaStoragePath: data.evidenciaStoragePath ?? null,
              evidenciaContentType: data.evidenciaStoragePath ? "image/jpeg" : null,
              // ⭑ EL TEXTO LIBRE, SEMBRADO A PROPOSITO (256/R22): si el `select` lo proyectara,
              // esta cadena aparecería en la respuesta y el aserto de abajo la caza.
              motivo: data.motivo ?? null,
            },
            select: { id: true },
          })
        ).id;

      const crearTransicion = async (
        ordenId: string,
        gestionOrdenId: string,
        destino: string,
        createdAt: Date,
      ) =>
        (
          await tx.ordenHistorialEstado.create({
            data: {
              ordenId,
              estatusDestinoId: estatus.get(destino)!,
              origenTipo: "gestion",
              gestionOrdenId,
              createdAt,
            },
            select: { id: true },
          })
        ).id;

      // --- LA ORDEN PROPIA: cuatro gestiones, una de cada tipo que interesa -------------------
      // (1) VIGENTE `reprogramada`, con transicion. La MAS ANTIGUA: sale primera (R10).
      const gReprogramada = await crearGestion({
        ordenId: propia,
        mensajeroId: mensajeroA.id,
        resultado: "reprogramada",
        createdAt: T.reprogramada,
        motivo: "TEXTO-LIBRE-el-cliente-no-contesto",
      });
      await crearTransicion(propia, gReprogramada, "reprogramada", T.reprogramada);

      // (2) VIGENTE `devuelta` CON causa tipificada. Su gestion origina DOS transiciones: la
      //     primera al pre-estado de la 239 y una SEGUNDA, posterior, al anclaje. R6 dice que
      //     `estadoResultante` es el destino de la PRIMERA.
      const gDevuelta = await crearGestion({
        ordenId: propia,
        mensajeroId: mensajeroB.id,
        resultado: "devuelta",
        createdAt: T.devuelta,
        causaDevolucion: "wrong_address",
        motivo: "TEXTO-LIBRE-direccion-mal-escrita",
      });
      await crearTransicion(propia, gDevuelta, "devolucion_por_confirmar", T.devuelta);
      await crearTransicion(
        propia,
        gDevuelta,
        "entregada", // destino DISTINTO y POSTERIOR a proposito: si el mapeo tomara la ultima,
        new Date(T.devuelta.getTime() + 60_000), // `estadoResultante` saldria `entregada`.
      );

      // (3) ANULADA SIN FOTO: la excluye el `where` de la consulta —no casa con ninguna de las
      //     dos ramas del `OR`—. Lleva causa y texto libre para que su fuga sea inconfundible.
      const gAnulada = await crearGestion({
        ordenId: propia,
        mensajeroId: mensajeroA.id,
        resultado: "devuelta",
        createdAt: T.anulada,
        anuladaAt: new Date("2026-09-05T10:00:00.000Z"),
        causaDevolucion: "not_found",
        motivo: "TEXTO-LIBRE-de-la-gestion-ANULADA",
      });
      await crearTransicion(propia, gAnulada, "devolucion_por_confirmar", T.anulada);

      // (3b) ANULADA **CON FOTO**: esta SI la devuelve la consulta, porque casa con la PRIMERA
      //      rama del `OR` (la de `evidencias[]`, que desde la 268 no filtra anuladas a
      //      proposito). Es el caso que separa las DOS redes de R11: el `where` no la para, la
      //      para el filtro en memoria del mapeo. Sin ella, quitar ese filtro sobreviviria en
      //      verde — medido el 2026-09-10.
      const gAnuladaConFoto = await crearGestion({
        ordenId: propia,
        mensajeroId: mensajeroB.id,
        resultado: "entregada",
        createdAt: T.anuladaConFoto,
        anuladaAt: new Date("2026-09-05T14:00:00.000Z"),
        evidenciaStoragePath: `ordenes/${SUFIJO}/anulada-con-foto.jpg`,
        motivo: "TEXTO-LIBRE-de-la-ANULADA-con-foto",
      });
      await crearTransicion(propia, gAnuladaConFoto, "entregada", T.anuladaConFoto);

      // (4) LEGADA: vigente y SIN fila de historial que la respalde -> `estadoResultante: null`.
      await crearGestion({
        ordenId: propia,
        mensajeroId: mensajeroA.id,
        resultado: "entregada",
        createdAt: T.legada,
      });

      // (5) EL INCIDENTE DEL ADMIN: NO es una gestion y no debe aparecer en `gestiones[]` (R14).
      await tx.ordenIncidente.create({
        data: {
          ordenId: propia,
          causa: "danado",
          motivo: "TEXTO-LIBRE-del-incidente-del-ADMIN",
          reportadoPor: mensajeroA.id,
        },
        select: { id: true },
      });

      // --- LA ORDEN AJENA: tambien con gestiones, para que R13 sea un hallazgo y no un vacio --
      await crearGestion({
        ordenId: ajena,
        mensajeroId: mensajeroB.id,
        resultado: "entregada",
        createdAt: T.reprogramada,
        motivo: "TEXTO-LIBRE-de-la-orden-AJENA",
      });

      // --- La foto de las dos tablas ANTES de leer (R18) ---------------------------------------
      const fotoAntes = await foto(tx, propia);

      const repo = new OrdenRepository(tx as unknown as PrismaClient);

      // R19: se cuentan las consultas que emite CADA lectura. El espia recoge todo lo que pasa
      // por la conexion, asi que se mide por delta alrededor de la llamada.
      const antesConGestiones = eventos.length;
      const detalle = await repo.findDetalleByOrdenIdForOwner(propia, tiendaPropia.id);
      const consultasConGestiones = eventos.length - antesConGestiones;

      const antesSinGestiones = eventos.length;
      const detalleVacio = await repo.findDetalleByOrdenIdForOwner(sinGestiones, tiendaPropia.id);
      const consultasSinGestiones = eventos.length - antesSinGestiones;

      // R13: la MISMA orden ajena, pedida con el owner de la key propia.
      const detalleAjeno = await repo.findDetalleByOrdenIdForOwner(ajena, tiendaPropia.id);
      // Y con su propio owner SI se ve: sin este contraste, un `null` por cualquier otra razon
      // (un id mal escrito, una siembra que no ocurrio) se leeria como «la frontera funciona».
      const detalleAjenoConSuOwner = await repo.findDetalleByOrdenIdForOwner(
        ajena,
        tiendas[1].id,
      );

      // R10: dos lecturas consecutivas sin escrituras intermedias.
      const segundaLectura = await repo.findDetalleByOrdenIdForOwner(propia, tiendaPropia.id);

      const fotoDespues = await foto(tx, propia);

      return {
        detalle,
        segundaLectura,
        detalleVacio,
        detalleAjeno,
        detalleAjenoConSuOwner,
        consultasConGestiones,
        consultasSinGestiones,
        fotoAntes,
        fotoDespues,
        nombres: {
          a: mensajeroA.nombre,
          b: mensajeroB.nombre,
        },
      };
    });
  }

  /** Estado COMPLETO de las dos tablas que esta lectura no debe tocar (R18). */
  async function foto(
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
    ordenId: string,
  ) {
    const gestiones = await tx.gestionOrden.findMany({
      where: { ordenId },
      orderBy: { id: "asc" },
    });
    const historial = await tx.ordenHistorialEstado.findMany({
      where: { ordenId },
      orderBy: { id: "asc" },
    });
    return { gestiones, historial };
  }

  it("R11: las DOS gestiones ANULADAS quedan fuera, y las TRES vigentes salen", async () => {
    const m = await escenario();

    expect(m.detalle).not.toBeNull();
    // TRES vigentes: reprogramada, devuelta y legada. Las otras dos estan anuladas.
    expect(m.detalle!.gestiones).toHaveLength(3);
    // El escenario se sembro de verdad: si `crearGestion` no hubiera escrito nada, el aserto de
    // arriba habria dado 0 y este lo confirma desde la otra punta.
    expect(m.fotoAntes.gestiones).toHaveLength(5);
    // Y ninguna de las dos se cuela: ni su causa, ni su texto libre.
    const texto = JSON.stringify(m.detalle);
    expect(texto).not.toContain("TEXTO-LIBRE-de-la-gestion-ANULADA");
    expect(texto).not.toContain("TEXTO-LIBRE-de-la-ANULADA-con-foto");
    // `not_found` es la causa que SOLO tiene la anulada sin foto en este escenario.
    expect(texto).not.toContain("not_found");
  });

  it("R11 + no-regresion 268: la ANULADA CON FOTO no entra en `gestiones[]` pero SI en `evidencias[]`", async () => {
    const m = await escenario();

    // ⭑ EL CASO DE LAS DOS REDES. Esta gestion SI la devuelve la consulta (casa con la rama del
    // `OR` que alimenta `evidencias[]`), asi que lo unico que impide que salga en `gestiones[]`
    // es el filtro en memoria del mapeo.
    expect(m.detalle!.gestiones.map((g) => g.createdAt.toISOString())).not.toContain(
      "2026-09-05T13:00:00.000Z",
    );
    // Y su evidencia sigue publicandose, como desde la 268: esta ficha declara que NO lo toca.
    expect(m.detalle!.evidencias).toHaveLength(1);
    expect(m.detalle!.evidencias[0].resultado).toBe("entregada");
    expect(m.detalle!.evidencias[0].storagePath).toContain("anulada-con-foto.jpg");
  });

  it("R10: salen de la mas antigua a la mas reciente, y dos lecturas dan el MISMO orden", async () => {
    const m = await escenario();

    // Literales a mano: el orden esperado es el de las fechas sembradas arriba.
    expect(m.detalle!.gestiones.map((g) => g.createdAt.toISOString())).toEqual([
      "2026-09-02T15:41:07.000Z",
      "2026-09-04T18:02:55.000Z",
      "2026-09-06T11:30:00.000Z",
    ]);
    expect(m.detalle!.gestiones.map((g) => g.resultado)).toEqual([
      "reprogramada",
      "devuelta",
      "entregada",
    ]);
    // R10: sin escrituras entre medias, la segunda lectura es identica byte a byte.
    expect(JSON.stringify(m.segundaLectura!.gestiones)).toBe(
      JSON.stringify(m.detalle!.gestiones),
    );
  });

  it("R6: `estadoResultante` es el destino de la PRIMERA transicion que origino la gestion", async () => {
    const m = await escenario();
    const [reprogramada, devuelta, legada] = m.detalle!.gestiones;

    expect(reprogramada.estadoResultante).toBe("reprogramada");
    // ⭑ EL CASO DISCRIMINANTE: esta gestion origino DOS transiciones. La primera fue al
    // pre-estado de la 239; la segunda, un minuto despues, a `entregada`. Si el mapeo se quedara
    // con la ULTIMA —o con «cualquiera»—, aqui saldria `entregada`.
    expect(devuelta.estadoResultante).toBe("devolucion_por_confirmar");
    // R7: la legada no tiene fila de historial -> `null`, con la clave presente.
    expect("estadoResultante" in legada).toBe(true);
    expect(legada.estadoResultante).toBeNull();
  });

  it("R8: `motivo` es la causa TIPIFICADA, y el TEXTO LIBRE del mensajero no sale jamas", async () => {
    const m = await escenario();
    const [reprogramada, devuelta, legada] = m.detalle!.gestiones;

    expect(devuelta.motivo).toBe("wrong_address");
    expect(reprogramada.motivo).toBeNull();
    expect(legada.motivo).toBeNull();

    // 256/R22 — el texto libre esta EN LA BASE (se sembro) y NO en la respuesta.
    expect(m.fotoAntes.gestiones.some((g) => g.motivo?.startsWith("TEXTO-LIBRE"))).toBe(true);
    const texto = JSON.stringify(m.detalle);
    expect(texto).not.toContain("TEXTO-LIBRE");
  });

  it("R13: la orden de OTRA tienda no se devuelve, ni sus gestiones, y su dueño si la ve", async () => {
    const m = await escenario();

    // La frontera: no hay dato que traducir a 404; sencillamente no se lee.
    expect(m.detalleAjeno).toBeNull();
    // Y el contraste que impide que este caso pase por accidente: con SU owner, existe y tiene
    // su gestion.
    expect(m.detalleAjenoConSuOwner).not.toBeNull();
    expect(m.detalleAjenoConSuOwner!.gestiones).toHaveLength(1);
    // El detalle propio no arrastra nada de la ajena.
    expect(JSON.stringify(m.detalle)).not.toContain("TEXTO-LIBRE-de-la-orden-AJENA");
  });

  it("R14: un incidente reportado por un ADMIN no aparece en `gestiones[]`", async () => {
    const m = await escenario();

    // Tres gestiones: el `orden_incidente` sembrado NO suma una cuarta.
    expect(m.detalle!.gestiones).toHaveLength(3);
    expect(m.detalle!.gestiones.map((g) => g.resultado)).not.toContain("incidente");
    expect(JSON.stringify(m.detalle)).not.toContain("TEXTO-LIBRE-del-incidente-del-ADMIN");
  });

  it("R18: servir el detalle NO escribe en `gestion_orden` ni en `orden_historial_estado`", async () => {
    const m = await escenario();

    // Igualdad de las filas ENTERAS, no solo del conteo: un UPDATE de una columna cualquiera
    // pasaria desapercibido con un `count(*)`.
    expect(m.fotoDespues.gestiones).toEqual(m.fotoAntes.gestiones);
    expect(m.fotoDespues.historial).toEqual(m.fotoAntes.historial);
    // Y la foto no esta vacia: si lo estuviera, la igualdad de arriba seria `[] === []`.
    expect(m.fotoAntes.gestiones.length).toBeGreaterThan(0);
    expect(m.fotoAntes.historial.length).toBeGreaterThan(0);
  });

  it("R19: el detalle con gestiones emite el MISMO numero de consultas que sin ellas", async () => {
    const m = await escenario();

    expect(m.detalleVacio!.gestiones).toEqual([]);
    expect(m.detalle!.gestiones).toHaveLength(3);
    // La propiedad: el coste no depende del numero de gestiones. Si alguien resolviera
    // `estadoResultante` con una consulta por gestion, aqui habria tres de mas.
    expect(m.consultasConGestiones).toBe(m.consultasSinGestiones);
    // Y el espia esta midiendo algo: cero consultas significaria que el `log: query` no llego.
    expect(m.consultasConGestiones).toBeGreaterThan(0);
  });

  it("R9: cada gestion lleva su mensajero ATRIBUIDO, con `{id, nombre}` y nada mas", async () => {
    const m = await escenario();

    for (const g of m.detalle!.gestiones) {
      expect(Object.keys(g.mensajero).sort()).toEqual(["id", "nombre"]);
      expect(typeof g.mensajero.id).toBe("string");
      expect(g.mensajero.nombre.length).toBeGreaterThan(0);
    }
    // Las dos primeras se sembraron con mensajeros DISTINTOS: si el mapeo repitiera uno solo
    // —por ejemplo el asignado de la orden—, los dos ids serian iguales.
    expect(m.detalle!.gestiones[0].mensajero.id).not.toBe(m.detalle!.gestiones[1].mensajero.id);
  });
});
