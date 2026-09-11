import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTestConEspia,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * ⏳ 2026-09-10 — FEATURE 415 (T7): `zona` Y EL COSTO, EJECUTADOS CONTRA POSTGRES.
 *
 * ⚠️ ESTO EXISTE PORQUE LOS DOBLES NO VEN EL SQL, y no es una frase de manual: este repo ya midio
 * CUATRO veces que una mutacion de un `WHERE` sobrevive en verde por arriba. Lo que solo Postgres
 * puede decir, y que aqui se ejecuta de verdad:
 *
 *   · R26 — que el filtro `cierre.estado = "aprobado"` RECORTE. Los tests de arriba afirman que se
 *     le PIDIO a Prisma; que un cierre `solicitado` o `rechazado` no alimente `costoReal` depende
 *     del motor. **Los dos estados se SIEMBRAN aqui porque hoy no existen en produccion** (medido:
 *     1.182 de 1.182 filas congeladas son de cierres aprobados), y sin sembrarlos el filtro no
 *     tendria ningun test que lo matara si alguien lo borrase por «redundante».
 *   · R27 — que con DOS cierres aprobados gane la fila MAS RECIENTE. Depende del
 *     `ORDER BY created_at DESC, id DESC` y del `take: 1` que aplica el motor POR FILA PADRE.
 *   · R33 — que una fila congelada de OTRA tienda no alimente el `costoReal` del dueno actual.
 *     Depende del `tiendaId` del `where` de la relacion.
 *   · R8/R24/R31 — el COSTE: cuantas consultas emite cada lectura y que no dependa del numero de
 *     items ni de cuantos cierres tenga cada orden.
 *
 * ⛔ NINGUN `if (!algo) return;` EN ESTE ARCHIVO. La ausencia de datos tiene que hacer FALLAR el
 * test, no reportarlo `passed`. Cada caso afirma primero que SEMBRO (longitud > 0) y luego afirma
 * sobre el contenido.
 *
 * SIN BASE ALCANZABLE SE SALTA (`describe.skip`), no pasa en verde. **Revisar los `skipped` del
 * gate**: sin `DATABASE_URL` este archivo entero se salta y el gate sale «OK» igual.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` es UNICO entre las ordenes vivas de una tienda. */
const SUFIJO = `415-${Date.now().toString(36)}`;

const ACTOR = (usuarioId: string): Actor => ({ usuarioId, rol: "apiKey" });

const SIGNED_URLS_NOOP: ISignedUrlProvider = {
  createSignedUrl: async () => "https://signed/one",
  createSignedUrls: async () => ({}),
};

/**
 * ⏳ 2026-09-10 (R8/R24/R31) — EL COSTE DEL DETALLE, CONGELADO, MEDIDO CON EL ESPIA.
 *
 * Las NUEVE primeras son las que la 405 dejo congeladas y siguen intactas; las TRES marcadas con ⭑
 * las anade esta ficha, porque Prisma resuelve CADA relacion anidada con su propia consulta y ni la
 * zona ni el distrito ni la fila congelada se pueden traer sin leerlas.
 *
 * ⚠️ Publicar `zona.id` NO anade ninguna consulta: es una columna mas del `select` de una relacion
 * que ya hacia falta para `esCentral`.
 *
 * Este literal es EL CONTRATO DE COSTE. Si alguien anade una relacion al `select` del detalle, el
 * `toEqual` se pone rojo y le ensena la consulta nueva POR SU NOMBRE.
 */
const CONSULTAS_DEL_DETALLE = [
  "orden", //   1. el `findFirst` con el `where` del owner
  "order_status", //   2. `estatus` de la orden
  "usuario", //   3. `mensajeroAsignado` (feature 404)
  "zona", // ⭑ 4. 415: `zona` (id, nombre, esCentral)
  "distrito", // ⭑ 5. 415: `distrito.zonaEspecial`
  "cierre_detail", // ⭑ 6. 415: la fila congelada, con su `where`, su `orderBy` y su `take: 1`
  "gestion_orden", //   7. la relacion `gestiones` (superconjunto, 405)
  "orden_historial_estado", //   8. 405: el historial de la ORDEN
  "orden_incidente", //   9. `incidentesAdmin` (feature 268)
  "usuario", //  10. 405: `gestiones.mensajero`
  "order_status", //  11. 405: `historialEstados.estatusDestino`
  "orden_incidente_evidencia", //  12. la portada del incidente del admin (268)
];

/** Las consultas del LISTADO, congeladas igual. Es lo unico que caza una tarifa por item. */
const CONSULTAS_DEL_LISTADO = [
  "orden", //   1. el `findMany` paginado
  "order_status", //   2. `estatus`
  "usuario", //   3. `mensajeroAsignado`
  "zona", // ⭑ 4. 415
  "distrito", // ⭑ 5. 415
  "cierre_detail", // ⭑ 6. 415
  "orden", //   7. el `count` del total
  "tarifas", // ⭑ 8. 415: UNA consulta de tarifas para la pagina entera (R24)
];

function tablasDe(eventos: { query: string }[]): string[] {
  return eventos.map(
    (e) => /FROM\s+"?public"?\.?"?(\w+)"?/i.exec(e.query)?.[1] ?? `??:${e.query.slice(0, 40)}`,
  );
}

/** Instantes FIJOS, para que «la mas reciente» sea un literal y no un calculo. */
const T = {
  cierreViejo: new Date("2026-09-01T10:00:00.000Z"),
  cierreNuevo: new Date("2026-09-05T10:00:00.000Z"),
} as const;

describeSiHayBase("ficha 415 — zona y costo por orden, contra Postgres real", () => {
  let prisma: PrismaClient;
  let eventos: { query: string }[];
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let usuarios: { id: string }[];
  let zonas: { id: string; nombre: string; esCentral: boolean }[];
  let estatusId: string;

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

    usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 2 });
    if (usuarios.length < 2) {
      throw new Error(
        "hacen falta al menos DOS usuarios: uno es la tienda duena y el otro la tienda ajena " +
          "que demuestra que el `tienda_id` CONGELADO acota (R33).",
      );
    }

    zonas = await prisma.zona.findMany({
      select: { id: true, nombre: true, esCentral: true },
      take: 2,
      orderBy: { nombre: "asc" },
    });
    if (zonas.length < 2) {
      throw new Error("hacen falta al menos DOS zonas en el catalogo: corre `pnpm run db:seed`.");
    }

    const est = await prisma.orderStatus.findFirst({
      where: { value: "en_bodega_central" },
      select: { id: true },
    });
    if (!est) {
      throw new Error("falta `en_bodega_central` en `order_status`: corre `pnpm run db:seed`.");
    }
    estatusId = est.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * La tarifa congelada de laboratorio. Numeros REDONDOS para que la aritmetica de cada caso se
   * pueda escribir a mano:
   *   flete estandar 3000.00 · flete GAM 2500.00 · comision COD 3.50 % · IVA 13 % · IVA com. 13 %
   */
  function tarifaCongelada(over: Record<string, unknown> = {}) {
    return {
      tarifaId: null as string | null,
      tarifaValorFlete: new Prisma.Decimal("3000.00"),
      tarifaValorFleteGam: new Prisma.Decimal("2500.00"),
      tarifaValorFleteDevuelto: new Prisma.Decimal("1500.00"),
      tarifaValorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
      tarifaComisionCod: new Prisma.Decimal("3.50"),
      tarifaIvaFlete: new Prisma.Decimal("13.00"),
      tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
      tarifaEspecial: null,
      tarifaEspecialDevuelta: null,
      tarifaFulfillment: new Prisma.Decimal("692.00"),
      ...over,
    };
  }

  /**
   * Siembra el escenario COMPLETO dentro de una transaccion que se revierte SIEMPRE: si el test
   * pasa, si falla o si el proceso muere, no queda ni una fila.
   */
  async function escenario() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const [tiendaPropia, tiendaAjena] = usuarios;
      const [zonaA, zonaB] = zonas;

      // ⭑ UNA FILA DE `tarifas` PARA EL PAR (tienda propia, zona A): es la VIGENTE con la que se
      //   deriva `costoEstimado`. Su fulfillment es 696.00, el NUEVO; el congelado llevara 692.00,
      //   que es el caso medido en produccion (263 de 1.581 detalles).
      const tarifaVigente = await tx.tarifa.create({
        data: {
          tiendaId: tiendaPropia.id,
          zonaId: zonaA.id,
          valorFlete: new Prisma.Decimal("3000.00"),
          valorFleteGam: new Prisma.Decimal("2500.00"),
          valorFleteDevuelto: new Prisma.Decimal("1500.00"),
          valorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
          comisionCod: new Prisma.Decimal("3.50"),
          ivaFlete: new Prisma.Decimal("13.00"),
          ivaComisionCod: new Prisma.Decimal("13.00"),
          fulfillment: new Prisma.Decimal("696.00"),
        },
        select: { id: true },
      });

      const crearOrden = async (
        clave: string,
        tiendaId: string,
        zonaId: string,
        over: Record<string, unknown> = {},
      ) =>
        (
          await tx.orden.create({
            data: {
              numRemision: `R-${SUFIJO}-${clave}`,
              destinatario: "Dest",
              telefonoDest: "88880000",
              producto: "Prod",
              estatusId,
              tiendaId,
              zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
              montoCobrar: new Prisma.Decimal("25900.00"),
              cobraComision: true,
              ...over,
            },
            select: { id: true },
          })
        ).id;

      const crearCierre = async (
        estado: "aprobado" | "solicitado" | "rechazado",
        createdAt: Date,
      ) =>
        (
          await tx.cierreDia.create({
            data: {
              mensajeroId: tiendaAjena.id,
              estado,
              destinoTipo: "bodega_central",
              destinoZonaId: zonas[0].id,
              createdAt,
              ...(estado === "rechazado" ? { motivoRechazo: "prueba 415" } : {}),
            },
            select: { id: true },
          })
        ).id;

      const congelar = async (
        cierreId: string,
        ordenId: string,
        tiendaId: string,
        createdAt: Date,
        tarifa: Record<string, unknown>,
        over: Record<string, unknown> = {},
      ) =>
        tx.cierreDetail.create({
          data: {
            cierreId,
            ordenId,
            montoCobrar: new Prisma.Decimal("25900.00"),
            cobraComision: true,
            zonaId: zonas[0].id,
            tiendaId,
            esCentral: true,
            esZonaEspecial: false,
            numRemision: `R-${SUFIJO}-cong`,
            destinatario: "Dest",
            producto: "Prod",
            tiendaNombre: "Tienda",
            zonaNombre: "Zona congelada",
            provinciaNombre: "Prov",
            cantonNombre: "Canton",
            createdAt,
            ...tarifa,
            ...over,
          },
          select: { id: true },
        });

      // --- Los cierres de cada estado -------------------------------------------------------
      const aprobadoViejo = await crearCierre("aprobado", T.cierreViejo);
      const aprobadoNuevo = await crearCierre("aprobado", T.cierreNuevo);
      const solicitado = await crearCierre("solicitado", T.cierreNuevo);
      const rechazado = await crearCierre("rechazado", T.cierreNuevo);

      // (1) CIERRE APROBADO — el caso base de `costoReal`.
      const conAprobado = await crearOrden("aprobada", tiendaPropia.id, zonaA.id);
      await congelar(
        aprobadoNuevo,
        conAprobado,
        tiendaPropia.id,
        T.cierreNuevo,
        tarifaCongelada({ tarifaId: tarifaVigente.id }),
      );

      // (2) CIERRE SOLICITADO — HOY NO EXISTE EN PRODUCCION, y por eso se siembra: es el caso
      //     que demuestra que el filtro de R26/D5 hace algo. La fila congelada SI existe.
      const conSolicitado = await crearOrden("solicitada", tiendaPropia.id, zonaA.id);
      await congelar(
        solicitado,
        conSolicitado,
        tiendaPropia.id,
        T.cierreNuevo,
        tarifaCongelada({ tarifaId: tarifaVigente.id }),
      );

      // (3) CIERRE RECHAZADO — la otra mitad: el filtro funciona Y la fila NO se borro (69/R10).
      const conRechazado = await crearOrden("rechazada", tiendaPropia.id, zonaA.id);
      await congelar(
        rechazado,
        conRechazado,
        tiendaPropia.id,
        T.cierreNuevo,
        tarifaCongelada({ tarifaId: tarifaVigente.id }),
      );

      // (4) DOS CIERRES APROBADOS, con tarifas congeladas DISTINTAS: elegir mal da otro importe.
      const conDos = await crearOrden("dos-cierres", tiendaPropia.id, zonaA.id);
      await congelar(
        aprobadoViejo,
        conDos,
        tiendaPropia.id,
        T.cierreViejo,
        // La VIEJA: flete GAM 1000.00 (y por tanto IVA 130.00). Inconfundible.
        tarifaCongelada({
          tarifaId: tarifaVigente.id,
          tarifaValorFleteGam: new Prisma.Decimal("1000.00"),
          tarifaFulfillment: new Prisma.Decimal("500.00"),
        }),
      );
      await congelar(
        aprobadoNuevo,
        conDos,
        tiendaPropia.id,
        T.cierreNuevo,
        tarifaCongelada({ tarifaId: tarifaVigente.id }), // la NUEVA: 2500.00 / 692.00
      );

      // (5) SIN NINGUNA FILA CONGELADA — el 28 % medido.
      const sinCongelado = await crearOrden("sin-congelado", tiendaPropia.id, zonaA.id);

      // (6) FILA CONGELADA DE OTRA TIENDA sobre una orden que HOY es de la propia (R33).
      const duenoCambiado = await crearOrden("dueno-cambiado", tiendaPropia.id, zonaA.id);
      await congelar(
        aprobadoNuevo,
        duenoCambiado,
        tiendaAjena.id, // ⭑ el `tienda_id` CONGELADO es el de la OTRA tienda
        T.cierreNuevo,
        tarifaCongelada({
          tarifaId: tarifaVigente.id,
          tarifaValorFleteGam: new Prisma.Decimal("7777.00"), // inconfundible si se colara
        }),
      );

      // (7) FILA CONGELADA CON `tarifa_id IS NULL` — el cero AFIRMADO (R28).
      const sinTarifaCongelada = await crearOrden("sin-tarifa-cong", tiendaPropia.id, zonaA.id);
      await congelar(
        aprobadoNuevo,
        sinTarifaCongelada,
        tiendaPropia.id,
        T.cierreNuevo,
        // `tarifa_id` NULL => las once columnas de tarifa en NULL, como las escribe `crearCierre`.
        {
          tarifaId: null,
          tarifaValorFlete: null,
          tarifaValorFleteGam: null,
          tarifaValorFleteDevuelto: null,
          tarifaValorFleteDevueltoGam: null,
          tarifaComisionCod: null,
          tarifaIvaFlete: null,
          tarifaIvaComisionCod: null,
          tarifaEspecial: null,
          tarifaEspecialDevuelta: null,
          tarifaFulfillment: null,
        },
      );

      // (8) FILA CON TARIFA PERO SIN `tarifa_fulfillment` — solo el fulfillment a "0.00" (R29).
      const sinFulfillment = await crearOrden("sin-fulfillment", tiendaPropia.id, zonaA.id);
      await congelar(
        aprobadoNuevo,
        sinFulfillment,
        tiendaPropia.id,
        T.cierreNuevo,
        tarifaCongelada({ tarifaId: tarifaVigente.id, tarifaFulfillment: null }),
      );

      // (9) LA ZONA VIVA ES OTRA que la congelada (ficha 366: no se re-tarifa hacia atras).
      const zonaMovida = await crearOrden("zona-movida", tiendaPropia.id, zonaB.id);
      await congelar(
        aprobadoNuevo,
        zonaMovida,
        tiendaPropia.id,
        T.cierreNuevo,
        tarifaCongelada({ tarifaId: tarifaVigente.id }),
        { zonaId: zonaA.id, zonaNombre: "NOMBRE-CONGELADO-VIEJO" },
      );

      // --- La lectura, por la CADENA REAL ----------------------------------------------------
      const repo = new OrdenRepository(tx as unknown as PrismaClient);
      const svc = new ApiOrdenLecturaService(
        repo,
        SIGNED_URLS_NOOP,
        new TarifaVigenteRepository(tx as unknown as PrismaClient),
      );
      const actor = ACTOR(tiendaPropia.id);

      const porId = async (id: string) => svc.detallePorOrdenId(actor, id);

      const detalles = {
        aprobado: await porId(conAprobado),
        solicitado: await porId(conSolicitado),
        rechazado: await porId(conRechazado),
        dosCierres: await porId(conDos),
        dosCierresBis: await porId(conDos), // R27: segunda lectura, sin cambios de datos
        sinCongelado: await porId(sinCongelado),
        duenoCambiado: await porId(duenoCambiado),
        sinTarifaCongelada: await porId(sinTarifaCongelada),
        sinFulfillment: await porId(sinFulfillment),
        zonaMovida: await porId(zonaMovida),
      };

      // R26: la fila del cierre RECHAZADO sigue existiendo (no se borro; es inmutable).
      const filasDelRechazado = await tx.cierreDetail.count({ where: { cierreId: rechazado } });
      const filasDelSolicitado = await tx.cierreDetail.count({ where: { cierreId: solicitado } });
      const filasDeDos = await tx.cierreDetail.count({ where: { ordenId: conDos } });

      // --- EL COSTE, medido por delta alrededor de cada llamada -------------------------------
      const antesDetalle = eventos.length;
      await repo.findDetalleByOrdenIdForOwner(conAprobado, tiendaPropia.id);
      const tablasDetalle = tablasDe(eventos.slice(antesDetalle));

      const medirListado = async (take: number) => {
        const antes = eventos.length;
        await svc.listar(actor, { limit: take, offset: 0 });
        return tablasDe(eventos.slice(antes));
      };
      const tablasListado1 = await medirListado(1);
      const tablasListado50 = await medirListado(50);

      return {
        detalles,
        filasDelRechazado,
        filasDelSolicitado,
        filasDeDos,
        tablasDetalle,
        tablasListado1,
        tablasListado50,
        zonaA,
        zonaB,
      };
    });
  }

  /**
   * ARITMETICA A MANO con la tarifa congelada de `tarifaCongelada()` (esCentral: true, monto
   * 25900.00, comision activa):
   *   flete       = tarifaValorFleteGam                    = 2500.00
   *   iva         = 2500.00 x 13 %                         =  325.00
   *   comision    = 25900.00 x 3.50 %                      =  906.50
   *   ivaComision = 906.50 x 13 % = 117.845 -> HALF_UP     =  117.85
   *   fulfillment = tarifaFulfillment                      =  692.00
   */
  const COSTO_REAL_ESPERADO = {
    flete: "2500.00",
    iva: "325.00",
    comision: "906.50",
    ivaComision: "117.85",
    fulfillment: "692.00",
  };

  /** Lo mismo con la tarifa VIGENTE, cuyo unico cambio es el fulfillment: 696.00. */
  const COSTO_ESTIMADO_ESPERADO = { ...COSTO_REAL_ESPERADO, fulfillment: "696.00" };

  it("R25: una orden con cierre APROBADO trae `costoReal` con los importes congelados", async () => {
    const m = await escenario();

    // Primero: SEMBRO. Sin esto, un escenario vacio dejaria los asertos de abajo sin contenido.
    expect(m.detalles.aprobado).not.toBeNull();
    expect(m.detalles.aprobado!.costoReal).toEqual(COSTO_REAL_ESPERADO);
    // Y el estimado sale de la tarifa VIGENTE: mismos cuatro conceptos, otro fulfillment.
    expect(m.detalles.aprobado!.costoEstimado).toEqual(COSTO_ESTIMADO_ESPERADO);
    expect(m.detalles.aprobado!.costoReal!.fulfillment).not.toBe(
      m.detalles.aprobado!.costoEstimado!.fulfillment,
    );
  });

  it("R26: una orden con cierre SOLICITADO trae `costoReal: null` — y su fila SI existe", async () => {
    const m = await escenario();

    // ⭑ ESTE ES EL CASO QUE DEMUESTRA QUE EL FILTRO DE D5 HACE ALGO. La fila congelada esta
    //   escrita (el cierre se SOLICITO, y ahi es cuando `crearCierre` la escribe), y aun asi el
    //   costo no sale. Si alguien borrara `cierre: { estado: "aprobado" }` del `where`, este
    //   aserto se pondria rojo con los importes de arriba.
    expect(m.filasDelSolicitado).toBe(1);
    expect(m.detalles.solicitado).not.toBeNull();
    expect(m.detalles.solicitado!.costoReal).toBeNull();
    // El resto de la orden se sirve igual: no se bloquea nada.
    expect(m.detalles.solicitado!.zona.nombre.length).toBeGreaterThan(0);
  });

  it("R26: una orden con cierre RECHAZADO trae `costoReal: null`, y la fila NO se borro", async () => {
    const m = await escenario();

    // Las DOS mitades: el filtro funciona...
    expect(m.detalles.rechazado).not.toBeNull();
    expect(m.detalles.rechazado!.costoReal).toBeNull();
    // ...y la fila congelada sigue ahi (69/R10: es INMUTABLE, un rechazo no la retira).
    expect(m.filasDelRechazado).toBe(1);
  });

  it("R27: con DOS cierres aprobados gana la fila MAS RECIENTE, y repetir da lo mismo", async () => {
    const m = await escenario();

    // Sembro las dos: si solo hubiera una, «la mas reciente» no probaria nada.
    expect(m.filasDeDos).toBe(2);
    expect(m.detalles.dosCierres).not.toBeNull();
    // La NUEVA tiene flete GAM 2500.00 y fulfillment 692.00; la VIEJA, 1000.00 y 500.00.
    expect(m.detalles.dosCierres!.costoReal).toEqual(COSTO_REAL_ESPERADO);
    // Elegir mal daria estos otros, escritos a mano: 1000.00 y su IVA 130.00.
    expect(m.detalles.dosCierres!.costoReal!.flete).not.toBe("1000.00");
    expect(m.detalles.dosCierres!.costoReal!.iva).not.toBe("130.00");
    // Determinismo: dos lecturas consecutivas sin cambios dan EXACTAMENTE lo mismo.
    expect(m.detalles.dosCierresBis!.costoReal).toEqual(m.detalles.dosCierres!.costoReal);
  });

  it("R26: una orden SIN ninguna fila congelada trae `costoReal: null` — es el 28 %", async () => {
    const m = await escenario();

    expect(m.detalles.sinCongelado).not.toBeNull();
    expect(m.detalles.sinCongelado!.costoReal).toBeNull();
    // Pero el ESTIMADO si sale: la tarifa vigente no depende de que haya cierre.
    expect(m.detalles.sinCongelado!.costoEstimado).toEqual(COSTO_ESTIMADO_ESPERADO);
  });

  it("R33: una fila congelada de OTRA tienda no alimenta el `costoReal` del dueno actual", async () => {
    const m = await escenario();

    expect(m.detalles.duenoCambiado).not.toBeNull();
    expect(m.detalles.duenoCambiado!.costoReal).toBeNull();
    // El importe inconfundible de la fila ajena (7777.00) no aparece por ningun lado.
    expect(JSON.stringify(m.detalles.duenoCambiado)).not.toContain("7777.00");
  });

  it('R28: una fila congelada con `tarifa_id IS NULL` trae los cinco `"0.00"`', async () => {
    const m = await escenario();

    expect(m.detalles.sinTarifaCongelada).not.toBeNull();
    // ⭑ CERO AFIRMADO, no `null`: ese cierre liquido cero y el cero es VERDAD (design §D8).
    expect(m.detalles.sinTarifaCongelada!.costoReal).toEqual({
      flete: "0.00",
      iva: "0.00",
      comision: "0.00",
      ivaComision: "0.00",
      fulfillment: "0.00",
    });
    // Y la ASIMETRIA, en el mismo caso: el ESTIMADO de esa misma orden SI tiene importes, porque
    // la tienda si tiene tarifa vigente hoy. Lo que falto fue la del dia del cierre.
    expect(m.detalles.sinTarifaCongelada!.costoEstimado).toEqual(COSTO_ESTIMADO_ESPERADO);
  });

  it('R29: una fila con `tarifa_fulfillment IS NULL` trae `fulfillment: "0.00"` y el resto igual', async () => {
    const m = await escenario();

    expect(m.detalles.sinFulfillment).not.toBeNull();
    expect(m.detalles.sinFulfillment!.costoReal).toEqual({
      ...COSTO_REAL_ESPERADO,
      fulfillment: "0.00",
    });
  });

  it("R1/R3 + design §8: `zona` es el `{id, nombre}` VIVO, aunque el congelado diga otro", async () => {
    const m = await escenario();

    expect(m.detalles.zonaMovida).not.toBeNull();
    // La orden vive HOY en la zona B; su fila congelada guarda la zona A y el nombre viejo.
    expect(m.detalles.zonaMovida!.zona).toEqual({ id: m.zonaB.id, nombre: m.zonaB.nombre });
    expect(JSON.stringify(m.detalles.zonaMovida)).not.toContain("NOMBRE-CONGELADO-VIEJO");
    expect(m.detalles.zonaMovida!.zona.id).not.toBe(m.zonaA.id);
    // Es deliberado y firmado (ficha 366: «no se re-tarifa hacia atras»): el `costoReal` sigue
    // siendo el de la fila congelada, y aqui no se reconcilia nada.
    expect(m.detalles.zonaMovida!.costoReal).toEqual(COSTO_REAL_ESPERADO);
  });

  it("R8/R31: el DETALLE emite EXACTAMENTE 12 consultas, y son estas doce", async () => {
    const m = await escenario();

    // El espia esta midiendo de verdad: una lista vacia significaria que el `log: query` no llego.
    expect(m.tablasDetalle.length).toBeGreaterThan(0);
    expect(m.tablasDetalle).toEqual(CONSULTAS_DEL_DETALLE);
    expect(m.tablasDetalle).toHaveLength(12);
  });

  it("R8/R24/R31: el LISTADO emite 8 consultas, y NO cambia entre `limit=1` y `limit=50`", async () => {
    const m = await escenario();

    expect(m.tablasListado1.length).toBeGreaterThan(0);
    expect(m.tablasListado1).toEqual(CONSULTAS_DEL_LISTADO);
    // ⭑ LA INVARIANTE, que es lo que de verdad importa: el numero NO depende del numero de items
    //   de la pagina. Con `limit=50` entran las nueve ordenes sembradas, en DOS zonas distintas y
    //   con hasta dos cierres cada una, y sigue siendo el MISMO conjunto de consultas.
    expect(m.tablasListado50).toEqual(m.tablasListado1);
    expect(m.tablasListado50).toHaveLength(8);
  });
});
