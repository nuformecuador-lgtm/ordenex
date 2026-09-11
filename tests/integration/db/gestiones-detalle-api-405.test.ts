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

/**
 * ⏳ 2026-09-10 (R19-b) — las TABLAS de las consultas emitidas, en orden.
 *
 * Se guarda el NOMBRE de la tabla y no solo el conteo porque un rojo de «esperaba 9, hubo 10» no
 * dice nada; uno que enseña la lista entera dice CUÁL sobra. Si el `FROM` no se puede extraer, se
 * conserva un recorte del SQL: es preferible una entrada fea a perder la consulta del recuento.
 */
function tablasDe(eventos: { query: string }[]): string[] {
  return eventos.map(
    (e) => /FROM\s+"?public"?\.?"?(\w+)"?/i.exec(e.query)?.[1] ?? `??:${e.query.slice(0, 40)}`,
  );
}

/**
 * ⏳ 2026-09-10 (R19/R19-b) — EL COSTE DEL DETALLE, CONGELADO.
 *
 * ⚠️ AQUI DECIA «Nueve consultas» y hoy son DOCE: lo enmienda el bloque fechado de justo debajo
 * (feature 415). Lo que sigue vigente de este parrafo es el HISTORIAL de como se llego a nueve.
 *
 * Nueve consultas, en este orden, y cada una con su porqué. Las SEIS primeras son las que ya
 * emitía `dev` —medido el 2026-09-10 con este mismo espía sobre la misma orden: 6—; las TRES
 * marcadas con ⭑ las añade esta ficha, porque Prisma resuelve cada relación anidada con su propia
 * consulta y `gestiones[]` no se puede devolver sin leerlas.
 *
 * Este literal es EL CONTRATO DE COSTE. Si alguien añade una relación al `select` del detalle,
 * este `toEqual` se pone rojo y le enseña la consulta nueva por su nombre. Es justo lo que faltaba
 * cuando la revisión midió 6 → 9 con la suite entera en verde.
 */
//
// ⏳ 2026-09-10 (feature 415, T3/T7) — NUEVE PASAN A DOCE, Y ES DELIBERADO. La 415 anade TRES
// relaciones al `select` del canal (`zona`, `distrito` y `cierreDetalles`) y Prisma resuelve cada
// relacion anidada con su propia consulta. El numero se MIDIO con este mismo espia, no se estimo:
// esta escrito en `progress/impl_415.md` junto a la linea base (9) que este archivo congelaba.
//
// ⚠️ Publicar `zona.id` NO anade ninguna consulta: es una columna mas del `select` de una relacion
// que ya hacia falta para `esCentral`. Y `cierreDetalles` lleva `take: 1`, que Prisma aplica POR
// FILA PADRE: sigue sin depender de en cuantos cierres aparezca cada orden.
//
// Lo que NO cambia, y es lo que de verdad importa: el numero es FIJO. Cero, tres o seis gestiones
// cuestan las mismas doce, y el `it` de abajo lo sigue afirmando comparando la orden CON gestiones
// contra la orden SIN ellas.
const CONSULTAS_DEL_DETALLE = [
  "orden", //   1. el `findFirst` con el `where` del owner
  "order_status", //   2. `estatus` de la orden
  "usuario", //   3. `mensajeroAsignado` (feature 404)
  "zona", // ⭑ 4. 415: la zona DE LA ORDEN (id, nombre, esCentral)
  "distrito", // ⭑ 5. 415: `distrito.zonaEspecial`, la marca tri-valuada
  "cierre_detail", // ⭑ 6. 415: la fila congelada del cierre aprobado (take: 1)
  "gestion_orden", //   7. la relacion `gestiones` (superconjunto)
  "orden_historial_estado", //   8. 405: el historial de la ORDEN (R6)
  "orden_incidente", //   9. `incidentesAdmin` (feature 268)
  "usuario", //  10. 405: `gestiones.mensajero` (R9)
  "order_status", //  11. 405: `historialEstados.estatusDestino` (R6)
  "orden_incidente_evidencia", //  12. la portada del incidente del admin (268)
];

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
        // ⭑ CON FOTO. `reprogramada` es el unico resultado que NO la exige, pero la tiene en la
        //   mayoria de los casos reales (8 de 12 vigentes en la base local, medido el
        //   2026-09-10). Y es una de las DOS filas que hacen letal la mutacion del filtro de
        //   `evidencias[]`: la consulta la devuelve, y lo unico que la mantiene fuera del
        //   contrato publico es la lista `["entregada","rechazada","incidente"]` del mapeo.
        evidenciaStoragePath: `ordenes/${SUFIJO}/reprogramada-con-foto.jpg`,
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
        // ⭑ CON FOTO, Y NO ES UN ADORNO: en una `devuelta` la evidencia es **OBLIGATORIA** desde
        //   la feature 75 (`lib/types/gestion-orden.ts`, rama `devuelta` del
        //   `discriminatedUnion`: `evidencias: evidenciasSchema`). Una `devuelta` vigente SIN
        //   foto describe un estado que ninguna gestion creada desde entonces puede tener, y un
        //   escenario imposible no prueba nada. La segunda fila que hace letal la mutacion.
        evidenciaStoragePath: `ordenes/${SUFIJO}/devuelta-con-foto.jpg`,
      });
      await crearTransicion(propia, gDevuelta, "devolucion_por_confirmar", T.devuelta);
      await crearTransicion(
        propia,
        gDevuelta,
        "entregada", // destino DISTINTO y POSTERIOR a proposito: si el mapeo tomara la ultima,
        new Date(T.devuelta.getTime() + 60_000), // `estadoResultante` saldria `entregada`.
      );

      // (3) ANULADA y LEGADA (sin foto): la excluye el `where` de la consulta —no casa con
      //     ninguna de las dos ramas del `OR`—. Es una `devuelta` ANTERIOR a la feature 75, que
      //     es cuando la foto paso a ser obligatoria: por eso puede no tenerla, y por eso es el
      //     unico sitio del escenario donde una `devuelta` sin evidencia es realista.
      //     Lleva causa y texto libre para que su fuga sea inconfundible.
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
      //     Tampoco tiene foto, y las dos cosas van juntas: es una gestion anterior al historial
      //     de la feature 49 y a la evidencia obligatoria, asi que es coherente consigo misma.
      //     Es ademas la fila que hace letal la OTRA mitad del filtro de `evidencias[]` (la de
      //     `evidenciaStoragePath !== null`): si esa mitad desapareciera, entraria con un
      //     `storagePath` nulo y el service intentaria firmarlo.
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

      // R19/R19-b: se cuentan las consultas que emite CADA lectura, y se guarda ADEMAS la TABLA
      // de cada una para que un rojo diga QUE consulta sobra en vez de solo cuántas hay. El espia
      // recoge todo lo que pasa por la conexion, asi que se mide por delta alrededor de la llamada.
      const antesConGestiones = eventos.length;
      const detalle = await repo.findDetalleByOrdenIdForOwner(propia, tiendaPropia.id);
      const tablasConGestiones = tablasDe(eventos.slice(antesConGestiones));

      const antesSinGestiones = eventos.length;
      const detalleVacio = await repo.findDetalleByOrdenIdForOwner(sinGestiones, tiendaPropia.id);
      const tablasSinGestiones = tablasDe(eventos.slice(antesSinGestiones));

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
        tablasConGestiones,
        tablasSinGestiones,
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

  // ⏳ 2026-09-10 — R15, LA MITAD DEL FILTRO QUE NADIE VIGILABA (bloqueante 1 de la revision).
  //
  // QUE PASO. Hasta esta ficha, lo que entraba en `evidencias[]` lo decidia POSTGRES:
  // `resultado IN ('entregada','rechazada','incidente') AND evidencia_storage_path IS NOT NULL`.
  // Al pasar el `where` a superconjunto, la consulta devuelve TAMBIEN `devuelta` y `reprogramada`
  // con foto, y lo unico que las mantiene fuera del contrato publico es una linea de JavaScript.
  // El reviewer anadio `"devuelta"` y `"reprogramada"` a esa lista y la mutacion **sobrevivio a
  // 9.446 tests en verde** el 2026-09-10. No era teorico: en la base local hay 14 filas vigentes
  // con foto en esos dos resultados.
  //
  // POR QUE NO SE CAZABA. El escenario sembraba la `devuelta` SIN foto, y una `devuelta` sin foto
  // **no puede existir** desde la feature 75 (la evidencia es obligatoria en esa rama del
  // `discriminatedUnion`). Un escenario imposible no prueba nada: la fila nunca entraba por la
  // puerta que el filtro tenia que cerrar.
  //
  // EL ARREGLO ES EL ESCENARIO, NO EL ASERTO: la `devuelta` y la `reprogramada` vigentes ahora
  // llevan foto, como en la realidad, y este caso afirma el CONJUNTO EXACTO de `evidencias[]`.
  it("R15: `evidencias[]` NO gana las gestiones con foto cuyo resultado no le corresponde", async () => {
    const m = await escenario();

    // Las TRES filas con foto que la consulta devuelve, por su nombre. El aserto no es un conteo:
    // es la lista entera, para que una de mas se vea con nombre y apellidos.
    const conFoto = m.fotoAntes.gestiones
      .filter((g) => g.evidenciaStoragePath !== null)
      .map((g) => `${g.resultado}:${g.evidenciaStoragePath!.split("/").pop()}`)
      .sort();
    expect(conFoto).toEqual([
      "devuelta:devuelta-con-foto.jpg",
      "entregada:anulada-con-foto.jpg",
      "reprogramada:reprogramada-con-foto.jpg",
    ]);

    // ⭑ Y SOLO UNA CRUZA. Si alguien anade `devuelta` o `reprogramada` a la lista del filtro en
    // memoria de `toApiOrdenDetalleRow`, este `toEqual` pasa a tener DOS elementos mas y se pone
    // rojo con el nombre del archivo filtrado dentro.
    expect(
      m.detalle!.evidencias.map((e) => `${e.resultado}:${e.storagePath.split("/").pop()}`),
    ).toEqual(["entregada:anulada-con-foto.jpg"]);

    // Las dos que NO deben cruzar existen y llevan foto: sin esto, el aserto de arriba pasaria
    // igual sobre un escenario que no tuviera ninguna (el falso verde por falta de datos).
    expect(conFoto).toHaveLength(3);
    expect(JSON.stringify(m.detalle!.evidencias)).not.toContain("devuelta-con-foto.jpg");
    expect(JSON.stringify(m.detalle!.evidencias)).not.toContain("reprogramada-con-foto.jpg");
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

  // ⏳ 2026-09-10 — R19 REESCRITO tras la revision (bloqueante 2).
  //
  // AQUI SOLO SE COMPARABA «con 3 gestiones» contra «con 0 gestiones». Esa es una propiedad MAS
  // DEBIL que el requisito —dice que no hay N+1, no cuántas consultas hay—, y por eso no cazó que
  // el detalle hubiera pasado de 6 a 9. R19 decía «el MISMO número que hoy» y era **inalcanzable**:
  // `gestiones[]` no se puede devolver sin leerlas. La premisa era falsa, no la implementación.
  //
  // El requisito se reescribió con el número MEDIDO y aquí se CONGELA. Las dos mitades se afirman
  // por separado, porque protegen cosas distintas.
  it("R19/R19-b (+415): el detalle emite EXACTAMENTE 12 consultas, y son estas doce", async () => {
    const m = await escenario();

    // ⭑ EL NUMERO, CON NOMBRE Y APELLIDOS. Un `toEqual` de la lista entera: si mañana alguien
    // añade una relación al `select`, este aserto dice CUÁL es la consulta nueva.
    expect(m.tablasConGestiones).toEqual(CONSULTAS_DEL_DETALLE);
    // ⏳ 2026-09-10 (feature 415): NUEVE -> DOCE, medido con este mismo espia.
    expect(m.tablasConGestiones).toHaveLength(12);
    // Y el espía está midiendo de verdad: una lista vacía significaría que el `log: query` no
    // llegó y que este caso lleva pasando en falso.
    expect(m.tablasConGestiones.length).toBeGreaterThan(0);
  });

  it("R19: ese número NO depende del número de gestiones (no hay N+1)", async () => {
    const m = await escenario();

    expect(m.detalleVacio!.gestiones).toEqual([]);
    expect(m.detalle!.gestiones).toHaveLength(3);
    // La segunda mitad del requisito, y la que de verdad importa para el coste: si alguien
    // resolviera `estadoResultante` con una consulta por gestión, aquí habría tres de más.
    expect(m.tablasConGestiones).toHaveLength(m.tablasSinGestiones.length);
    // Ojo con el matiz: una orden SIN gestiones emite las mismas 12. Prisma pide la relación
    // igualmente, y por eso el conteo no se mueve.
    expect(m.tablasSinGestiones).toEqual(CONSULTAS_DEL_DETALLE);
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
