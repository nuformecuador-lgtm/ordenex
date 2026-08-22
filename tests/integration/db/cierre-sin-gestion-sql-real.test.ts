import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * Feature 264 (B7, R1/R5/R7/R9/R11/R12) — EL `WHERE` Y EL `ORDER BY` DE LA LISTA, EJECUTADOS
 * CONTRA POSTGRES.
 *
 * POR QUE ESTE ARCHIVO EXISTE aunque ya haya tests unitarios del mismo metodo. Los tests de
 * servicio usan dobles del repositorio y **no ven el SQL**; los de repositorio comprueban que se
 * emite el objeto `where` que decimos, que es otra cosa distinta de que ese `where` seleccione
 * las filas correctas. Este repo ya midio **cuatro veces** que una mutacion de un `where`
 * sobrevive en verde por arriba. Aqui la unica forma de que el caso pase es que Postgres devuelva
 * de verdad las filas que afirmamos.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: si el test pasa, si falla o si el
 * proceso muere, no queda ni una fila en la base compartida.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), no pasa en verde: un `skip` se ve en la salida;
 * un `return` silencioso dentro del caso se leeria como `passed` sin haber comprobado nada, que
 * es peor que no tener el test. CON base pero SIN catalogo, **falla ruidosamente** con un mensaje
 * que dice que hay que sembrar.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision` y `num_guia` son UNIQUE en `orden`. */
const SUFIJO = `264-${Date.now().toString(36)}`;
const GUIA_BASE = 940_000_000 + (Date.now() % 50_000_000);

const ALCANCE_TOTAL: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

/**
 * El corpus. Cada fila es el testigo de UNA condicion, y las guias van a PROPOSITO en orden
 * DECRECIENTE respecto al orden de insercion: asi el orden correcto (por guia) NO coincide con el
 * orden de creacion, y una mutacion del `orderBy` a `createdAt` no puede acertar por casualidad.
 */
interface Semilla {
  clave: string;
  /** `"A"` = el cierre que se abre; `"B"` = otro cierre del MISMO mensajero; `"C"` = otro mensajero. */
  cierre: "A" | "B" | "C";
  guia: number | null;
  /** La orden se LIBERA despues de sembrar (estatus a bodega + sin mensajero), como al aprobar. */
  liberada?: boolean;
  /** El `destinatario` VIVO de la orden se cambia despues de sembrar el vinculo congelado. */
  mutaVivo?: boolean;
  /** `false` = el vinculo se guarda SIN estatus de origen (no consta). */
  conOrigen?: boolean;
}

const SEMILLAS: Semilla[] = [
  { clave: "a-normal", cierre: "A", guia: 40 },
  { clave: "a-liberada", cierre: "A", guia: 30, liberada: true },
  { clave: "a-congelada", cierre: "A", guia: 20, mutaVivo: true },
  { clave: "a-sin-guia", cierre: "A", guia: null, conOrigen: false },
  { clave: "b-otro-cierre", cierre: "B", guia: 50 },
  { clave: "c-otro-mensajero", cierre: "C", guia: 60 },
];

/** El orden que R12 exige: por guia ascendente, y los `null` al final, siempre en el mismo sitio. */
const ORDEN_ESPERADO = ["a-congelada", "a-liberada", "a-normal", "a-sin-guia"];

describeSiHayBase("264/B7 — la lista de ordenes sin gestionar contra Postgres real", () => {
  let prisma: PrismaClient;

  let conCorpus: <T>(
    fn: (ctx: {
      repo: CierresAdminRepository;
      cierreA: string;
      cierreB: string;
      cierreC: string;
      remisionPorClave: Map<string, string>;
      guiaPorClave: Map<string, number | null>;
      /** La MISMA transaccion, para poder leer la orden VIVA y contrastarla con la congelada. */
      leerDestinatarioVivo: (numRemision: string) => Promise<string | null>;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    // Fallo RUIDOSO, no `return` silencioso: con base alcanzable y sin catalogo este archivo no
    // puede comprobar nada, y un `passed` en esas condiciones es exactamente la clase de verde
    // que este repo ya se comio una vez.
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    const catalogo = await prisma.orderStatus.findMany({
      where: { value: { in: ["en_reparto", "sin_gestionar", "en_bodega_central"] } },
      select: { id: true, value: true },
    });
    const idPorValue = new Map(catalogo.map((c) => [c.value, c.id]));
    for (const v of ["en_reparto", "sin_gestionar", "en_bodega_central"]) {
      if (!idPorValue.has(v)) {
        throw new Error(
          `falta el estatus «${v}» en el catalogo \`order_status\`. Corre \`pnpm run db:seed\`: ` +
            "sin el, este archivo no puede sembrar el corpus y NO debe pasar en verde.",
        );
      }
    }
    const enReparto = idPorValue.get("en_reparto") as string;
    const sinGestionar = idPorValue.get("sin_gestionar") as string;
    const enBodega = idPorValue.get("en_bodega_central") as string;

    // `cierre_dia.mensajero_id` es FK -> `usuario`. Se reusan dos usuarios REALES distintos: lo
    // que se mide aqui es un WHERE, no un rol. Hacen falta DOS para el señuelo «otro mensajero».
    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 2 });
    if (usuarios.length < 2) {
      throw new Error(
        "hacen falta al menos DOS usuarios en la base para sembrar el señuelo de «otro " +
          "mensajero». Corre las semillas antes de esta suite.",
      );
    }
    const [m1, m2] = usuarios;

    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // PRIMERA sentencia: serializa contra los otros archivos que escriben en las tablas
        // reales de `public` (ver `_postgres-real.ts`).
        await serializarEscriturasReales(tx);

        const nuevoCierre = (mensajeroId: string) =>
          tx.cierreDia.create({
            data: {
              mensajeroId,
              estado: "vencido", // el cierre que el corte crea, que es el que motiva la ficha
              destinoTipo: "bodega_central",
              destinoZonaId: fks.zonaId,
            },
            select: { id: true },
          });

        const A = await nuevoCierre(m1.id);
        const B = await nuevoCierre(m1.id); // MISMO mensajero, OTRO cierre
        const C = await nuevoCierre(m2.id); // OTRO mensajero
        const idDelCierre = { A: A.id, B: B.id, C: C.id };

        const remisionPorClave = new Map<string, string>();
        const guiaPorClave = new Map<string, number | null>();

        for (const s of SEMILLAS) {
          const numGuia = s.guia === null ? null : GUIA_BASE + s.guia;
          const numRemision = `R-${SUFIJO}-${s.clave}`;
          const mensajeroId = s.cierre === "C" ? m2.id : m1.id;
          const orden = await tx.orden.create({
            data: {
              numGuia,
              numRemision,
              // El destinatario VIVO nace igual que el congelado; las semillas `mutaVivo` lo
              // cambian DESPUES, que es lo que separa «congelado» de «leido de la orden de hoy».
              destinatario: `Dest ${s.clave}`,
              telefonoDest: "88880000",
              producto: `Prod ${s.clave}`,
              estatusId: sinGestionar, // barrida por el corte
              mensajeroAsignadoId: mensajeroId,
              tiendaId: fks.tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          });

          await tx.cierreSinGestion.create({
            data: {
              cierreId: idDelCierre[s.cierre],
              ordenId: orden.id,
              numGuia,
              numRemision,
              destinatario: `Dest ${s.clave}`, // el CONGELADO
              producto: `Prod ${s.clave}`,
              tiendaNombre: `Tienda ${s.clave}`,
              zonaNombre: `Zona ${s.clave}`,
              estatusOrigenId: s.conOrigen === false ? null : enReparto,
            },
            select: { id: true },
          });

          // R5: la APROBACION libera la orden a bodega y le borra el mensajero. Es el momento en
          // que el predicado VIVO —el unico vinculo que habia antes de esta feature— se destruye.
          if (s.liberada) {
            await tx.orden.update({
              where: { id: orden.id },
              data: {
                estatusId: enBodega,
                mensajeroAsignadoId: null,
                asignadoAt: null,
                fechaReparto: null,
                prioridad: true,
              },
            });
          }

          // R11: alguien edita la orden DESPUES del cierre. El detalle tiene que seguir contando
          // lo que era cierto cuando el corte la barrio.
          if (s.mutaVivo) {
            await tx.orden.update({
              where: { id: orden.id },
              data: { destinatario: "VIVO EDITADO DESPUES" },
            });
          }

          remisionPorClave.set(s.clave, numRemision);
          guiaPorClave.set(s.clave, numGuia);
        }

        const repo = new CierresAdminRepository(
          tx as unknown as PrismaClient,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );
        return fn({
          repo,
          cierreA: A.id,
          cierreB: B.id,
          cierreC: C.id,
          remisionPorClave,
          guiaPorClave,
          leerDestinatarioVivo: async (numRemision) =>
            (
              await tx.orden.findFirst({
                where: { numRemision },
                select: { destinatario: true },
              })
            )?.destinatario ?? null,
        });
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R1/R7: devuelve las CUATRO barridas de ESTE cierre y ninguna mas", async () => {
    const { salen, esperadas } = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, ALCANCE_TOTAL);
      return {
        salen: (r?.sinGestion ?? []).map((f) => f.numRemision).sort(),
        esperadas: ORDEN_ESPERADO.map((c) => ctx.remisionPorClave.get(c) as string).sort(),
      };
    });

    // Igualdad EXACTA: lo que sobra importa tanto como lo que falta. La barrida de OTRO cierre
    // del MISMO mensajero y la de OTRO mensajero quedan fuera, y cada exclusion la produce el
    // `where: { cierreId }` — no un `if` en memoria.
    expect(salen).toEqual(esperadas);
    expect(salen).toHaveLength(4);
  });

  it("R7: el cierre B (mismo mensajero) trae SOLO lo suyo, y el C SOLO lo suyo", async () => {
    const { b, c } = await conCorpus(async (ctx) => {
      const rb = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreB, ALCANCE_TOTAL);
      const rc = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreC, ALCANCE_TOTAL);
      return {
        b: (rb?.sinGestion ?? []).map((f) => f.numRemision),
        c: (rc?.sinGestion ?? []).map((f) => f.numRemision),
      };
    });

    // Contrapunto obligatorio del caso anterior: si el `where` devolviera SIEMPRE vacio, aquel
    // habria fallado; si devolviera TODO, estos dos traerian seis filas cada uno.
    expect(b).toEqual([`R-${SUFIJO}-b-otro-cierre`]);
    expect(c).toEqual([`R-${SUFIJO}-c-otro-mensajero`]);
  });

  it("R12: el orden es por guia ascendente con los `null` al final, y es el MISMO dos veces", async () => {
    const { primera, segunda } = await conCorpus(async (ctx) => {
      const a = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, ALCANCE_TOTAL);
      const b = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, ALCANCE_TOTAL);
      return {
        primera: (a?.sinGestion ?? []).map((f) => f.numRemision),
        segunda: (b?.sinGestion ?? []).map((f) => f.numRemision),
      };
    });

    // ⭑ EL ORDEN LITERAL, y no «esta ordenado»: las guias se sembraron DECRECIENTES respecto al
    // orden de insercion, asi que este orden es imposible de acertar por casualidad si el
    // `orderBy` se cambiara por `createdAt` (todas las filas de una misma transaccion comparten
    // `CURRENT_TIMESTAMP`, asi que ese criterio ni siquiera desempata).
    expect(primera).toEqual(ORDEN_ESPERADO.map((c) => `R-${SUFIJO}-${c}`));
    // Y ademas es ESTABLE entre dos lecturas del mismo cierre.
    expect(segunda).toEqual(primera);
    // La de guia `null` va la ULTIMA, no en un sitio distinto cada vez.
    expect(primera[3]).toBe(`R-${SUFIJO}-a-sin-guia`);
  });

  it("R5: la orden ya LIBERADA a bodega sigue apareciendo en el detalle de su cierre", async () => {
    const fila = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, ALCANCE_TOTAL);
      return (
        (r?.sinGestion ?? []).find(
          (f) => f.numRemision === ctx.remisionPorClave.get("a-liberada"),
        ) ?? null
      );
    });

    // Este es el caso que NINGUN diseño «leer vivo» puede pasar: la aprobacion ya le borro
    // `mensajero_asignado_id` y le cambio el estatus, asi que el predicado vivo la habria
    // perdido. La fila persistida sobrevive (R5) — y el cierre aprobado es justo el que se
    // audita, porque es el que ya movio dinero.
    expect(fila).not.toBeNull();
    expect(fila?.destinatario).toBe("Dest a-liberada");
  });

  it("R11: devuelve el descriptivo CONGELADO, no el de la orden viva", async () => {
    const { congelado, vivo } = await conCorpus(async (ctx) => {
      const remision = ctx.remisionPorClave.get("a-congelada") as string;
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, ALCANCE_TOTAL);
      const fila = (r?.sinGestion ?? []).find((f) => f.numRemision === remision);
      return {
        congelado: fila?.destinatario ?? null,
        // El valor VIVO se LEE de la base, no se supone: si el `update` de la semilla no hubiera
        // corrido, comparar contra un literal daria un verde que no significa nada.
        vivo: await ctx.leerDestinatarioVivo(remision),
      };
    });

    // El precedente exacto: la feature 69/T18 ya pago una vez este error en ESTA misma pantalla
    // (el detalle navegaba `gestion_orden.orden.*` y el admin veia los valores de HOY). Aqui la
    // orden viva dice otra cosa y el detalle NO debe repetirla.
    expect(vivo).toBe("VIVO EDITADO DESPUES"); // la orden SI se edito despues del cierre
    expect(congelado).toBe("Dest a-congelada");
    expect(congelado).not.toBe(vivo);
  });

  it("R9/R32: la fila sin guia viaja con `numGuia: null` y sin estatus de origen inventado", async () => {
    const fila = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, ALCANCE_TOTAL);
      return (
        (r?.sinGestion ?? []).find(
          (f) => f.numRemision === ctx.remisionPorClave.get("a-sin-guia"),
        ) ?? null
      );
    });

    expect(fila).not.toBeNull(); // NO se omite por no tener guia
    expect(fila?.numGuia).toBeNull();
    expect(fila?.estatusOrigen).toBeNull(); // «no consta» viaja como `null`, no como un texto
  });

  it("R9: los ocho campos llegan resueltos, con el estatus de origen traducido a su `value`", async () => {
    const fila = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, ALCANCE_TOTAL);
      return (
        (r?.sinGestion ?? []).find(
          (f) => f.numRemision === ctx.remisionPorClave.get("a-normal"),
        ) ?? null
      );
    });

    expect(fila).toEqual({
      ordenId: expect.any(String),
      numGuia: GUIA_BASE + 40,
      numRemision: `R-${SUFIJO}-a-normal`,
      destinatario: "Dest a-normal",
      producto: "Prod a-normal",
      tiendaNombre: "Tienda a-normal",
      zonaNombre: "Zona a-normal",
      estatusOrigen: "en_reparto",
    });
  });

  it("R27: el cierre nace con la marca en `true` (el DEFAULT de la columna, no una linea de codigo)", async () => {
    const marca = await conCorpus(async (ctx) => {
      const r = await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, ALCANCE_TOTAL);
      return r?.sinGestionRegistrado ?? null;
    });

    // El `DEFAULT true` lo pone Postgres: el camino caliente del corte no escribe una sola linea
    // para marcarlo, y aun asi un cierre nuevo NUNCA se lee como «anterior al registro».
    expect(marca).toBe(true);
  });

  it("R8: un cierre fuera del alcance del satelite es indistinguible de uno inexistente", async () => {
    const { fuera, inexistente } = await conCorpus(async (ctx) => ({
      fuera: await ctx.repo.findCierreByIdEnAlcance(ctx.cierreA, {
        destinoTipo: "bodega_satelite",
        destinoZonaId: "zona-que-no-existe",
      }),
      inexistente: await ctx.repo.findCierreByIdEnAlcance(
        "00000000-0000-4000-8000-000000000000",
        ALCANCE_TOTAL,
      ),
    }));

    // El cierre A EXISTE y tiene cuatro barridas: para ese satelite es `null`, exactamente igual
    // que un id que no existe. Esa propiedad la produce el WHERE del `findFirst`, no un `if`.
    expect(fuera).toBeNull();
    expect(inexistente).toBeNull();
  });
});
