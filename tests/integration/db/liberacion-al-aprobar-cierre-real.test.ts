import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 315 — **APROBAR UN CIERRE LIBERA SUS REPROGRAMADAS VENCIDAS, Y SOLO ESAS.** Contra Postgres.
 *
 * ⚠️ POR QUE ESTE ARCHIVO ES OBLIGATORIO Y NO UN EXTRA. `liberacion-al-aprobar-cierre.test.ts`
 * prueba el CABLEADO con dobles: que la aprobacion llama al liberador con el id correcto. Lo que
 * NO puede probar es lo unico que de verdad puede hacer dano — **el acotado**. El cierre que se
 * aprobo en produccion el 2026-08-28 llevaba, ademas de la orden vencida, ordenes reprogramadas
 * para el **31/08** y el **01/09**. Soltar esas dos pondria un paquete en la calle DIAS antes de
 * lo pactado con el destinatario: un defecto PEOR que la demora que esta ficha arregla.
 *
 * Y ese acotado vive en un `where` y en una correlacion del repositorio. En este repo esta medido
 * CUATRO veces que una mutacion de un `where` sobrevive en verde a una suite de dobles: los tests
 * de servicio reciben las filas ya construidas por el propio test. Aqui las construye POSTGRES.
 *
 * LAS DOS MUTACIONES QUE ESTE ARCHIVO TIENE QUE CAZAR:
 *   (a) liberar TODAS las del cierre sin mirar la fecha  -> `manana` y `pasado` saldrian;
 *   (b) no acotar por cierre (usar la consulta del reloj) -> `ajena` saldria.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte. SIN base alcanzable se SALTA
 * (`describe.skip`), que se VE en la salida; nunca un `return` silencioso dentro del caso.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `315-${Date.now().toString(36)}`;
const GUIA_BASE = 970_000_000 + (Date.now() % 20_000_000);

/** `fecha_reprogramacion` es `@db.Date`: medianoche UTC, misma convencion que `startOfDayCR`. */
const AYER = new Date("2026-08-27T00:00:00.000Z");
const HOY = new Date("2026-08-28T00:00:00.000Z");
const MANANA = new Date("2026-08-29T00:00:00.000Z");
const PASADO = new Date("2026-09-01T00:00:00.000Z");

/**
 * El corpus. Las SEIS ordenes estan en `reprogramada`, tienen mensajero, y su gestion vigente nace
 * de una VISITA REAL cuyo cierre esta `aprobado` — es decir, `puedeLiberarse` dice SI para las
 * seis. Lo unico que separa a las que salen de las que no es el ACOTADO: la fecha y el cierre.
 * Sin esa uniformidad el archivo podria pasar por el motivo equivocado.
 */
interface Semilla {
  clave: string;
  /** `"mio"` = la gestion vigente cuelga del cierre que se aprueba; `"ajeno"` = de otro. */
  cierre: "mio" | "ajeno";
  fecha: Date;
  /** ¿la libera la aprobacion de MI cierre, con `hoyCR = HOY`? */
  seLibera: boolean;
}

const SEMILLAS: Semilla[] = [
  // El caso de la ficha: vencida y de este cierre.
  { clave: "vencida", cierre: "mio", fecha: AYER, seLibera: true },
  // El limite es `<=`, no `<`: lo de HOY tambien sale.
  { clave: "hoy", cierre: "mio", fecha: HOY, seLibera: true },
  // 💰 LAS DOS DEL CASO REAL: el 31/08 y el 01/09. Van en el MISMO cierre y NO deben salir.
  { clave: "manana", cierre: "mio", fecha: MANANA, seLibera: false },
  { clave: "pasado", cierre: "mio", fecha: PASADO, seLibera: false },
  // Vencida, liberable, pero de OTRO cierre: la suelta la aprobacion de AQUEL, no esta.
  { clave: "ajena", cierre: "ajeno", fecha: AYER, seLibera: false },
];

/** Las que la aprobacion de MI cierre debe soltar, ordenadas para comparar sin ambiguedad. */
const ESPERADAS = SEMILLAS.filter((s) => s.seLibera)
  .map((s) => s.clave)
  .sort();

describeSiHayBase("315 — liberar al aprobar el cierre, contra Postgres real", () => {
  let prisma: PrismaClient;

  let conCorpus: <T>(
    fn: (ctx: {
      service: LiberacionReprogramadaService;
      cierreMioId: string;
      cierreAjenoId: string;
      idPorClave: Map<string, string>;
      estatusReprogramadaId: string;
      enBodegaCentralId: string;
      /** Lee el estado ACTUAL de las ordenes del corpus, por clave de semilla. */
      leerOrdenes: () => Promise<
        Map<
          string,
          {
            estatusId: string;
            mensajeroAsignadoId: string | null;
            prioridad: boolean;
            liberadaReprogramadaAt: Date | null;
          }
        >
      >;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    // Fallo RUIDOSO, jamas un `return` silencioso: con base alcanzable y sin catalogo este archivo
    // no puede comprobar nada, y un `passed` en esas condiciones es la clase de verde que este
    // repo ya se comio una vez.
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    const VALORES = ["reprogramada", "en_bodega_central", "en_bodega_satelite"];
    const catalogo = await prisma.orderStatus.findMany({
      where: { value: { in: VALORES } },
      select: { id: true, value: true },
    });
    const idPorValue = new Map(catalogo.map((c) => [c.value, c.id]));
    for (const v of VALORES) {
      if (!idPorValue.has(v)) {
        throw new Error(
          `falta el estatus «${v}» en el catalogo \`order_status\`. Corre \`pnpm run db:seed\`.`,
        );
      }
    }
    const estatusReprogramadaId = idPorValue.get("reprogramada") as string;
    const enBodegaCentralId = idPorValue.get("en_bodega_central") as string;

    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 1 });
    if (usuarios.length < 1) {
      throw new Error("hace falta al menos UN usuario en la base para sembrar las gestiones.");
    }
    const mensajeroId = usuarios[0].id;

    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // PRIMERA sentencia: serializa contra los otros archivos que escriben en `public`.
        await serializarEscriturasReales(tx);

        const crearCierre = async () =>
          (
            await tx.cierreDia.create({
              data: {
                mensajeroId,
                // APROBADO los dos: asi `puedeLiberarse` dice SI para las cinco semillas y lo
                // unico que las separa es el acotado, que es lo que este archivo mide.
                estado: "aprobado",
                destinoTipo: "bodega_central",
                destinoZonaId: fks.zonaId,
              },
              select: { id: true },
            })
          ).id;

        const cierreMioId = await crearCierre();
        const cierreAjenoId = await crearCierre();

        const idPorClave = new Map<string, string>();
        let n = 0;

        for (const s of SEMILLAS) {
          n += 1;
          const orden = await tx.orden.create({
            data: {
              numGuia: GUIA_BASE + n,
              numRemision: `R-${SUFIJO}-${s.clave}`,
              destinatario: `Dest ${s.clave}`,
              telefonoDest: "88880000",
              producto: `Prod ${s.clave}`,
              estatusId: estatusReprogramadaId,
              mensajeroAsignadoId: mensajeroId,
              tiendaId: fks.tiendaId,
              zonaId: fks.zonaId,
              provinciaId: fks.provinciaId,
              cantonId: fks.cantonId,
            },
            select: { id: true },
          });
          idPorClave.set(s.clave, orden.id);

          const gestion = await tx.gestionOrden.create({
            data: {
              ordenId: orden.id,
              mensajeroId,
              resultado: "reprogramada",
              fechaReprogramacion: s.fecha,
              cierreId: s.cierre === "mio" ? cierreMioId : cierreAjenoId,
              anuladaAt: null,
              createdAt: new Date("2026-08-27T18:00:00.000Z"),
            },
            select: { id: true },
          });
          // VISITA REAL: sin esta fila la orden entraria por la rama (a) de `puedeLiberarse` y el
          // corpus dejaria de medir lo que dice medir.
          await tx.ordenHistorialEstado.create({
            data: {
              ordenId: orden.id,
              estatusDestinoId: estatusReprogramadaId,
              origenTipo: "gestion",
              gestionOrdenId: gestion.id,
            },
          });
        }

        // `liberarOrden` abre su propia `$transaction`, y un cliente transaccional de Prisma no la
        // expone. El proxy la resuelve invocando el callback con LA MISMA tx: el SQL que se ejecuta
        // es el REAL, y todo sigue dentro de la transaccion que se revierte al final.
        const cliente = new Proxy(tx as object, {
          get(target, prop, receiver) {
            if (prop === "$transaction") {
              return async (f: (t: unknown) => Promise<unknown>) => f(target);
            }
            return Reflect.get(target, prop, receiver);
          },
        }) as unknown as PrismaClient;

        const service = new LiberacionReprogramadaService(
          new LiberacionReprogramadaRepository(cliente),
          // La zona del corpus ES la central: todo lo liberado va a `en_bodega_central`, asi el
          // aserto de destino es uno solo y no depende del reparto por zona (que ya tiene sus
          // propios tests).
          { findCentralZonaId: async () => fks.zonaId } as unknown as IZonaRepository,
          {
            findEstatusIdByValue: async (v: string) => idPorValue.get(v) ?? null,
          } as unknown as IOrdenRepository,
          { warn: () => {} },
        );

        const leerOrdenes = async () => {
          const filas = await tx.orden.findMany({
            where: { id: { in: [...idPorClave.values()] } },
            select: {
              id: true,
              estatusId: true,
              mensajeroAsignadoId: true,
              prioridad: true,
              liberadaReprogramadaAt: true,
            },
          });
          const porId = new Map(filas.map((f) => [f.id, f]));
          return new Map(
            [...idPorClave.entries()].map(([clave, id]) => {
              const f = porId.get(id);
              if (f === undefined) throw new Error(`la orden «${clave}» desaparecio del corpus`);
              return [
                clave,
                {
                  estatusId: f.estatusId,
                  mensajeroAsignadoId: f.mensajeroAsignadoId,
                  prioridad: f.prioridad,
                  liberadaReprogramadaAt: f.liberadaReprogramadaAt,
                },
              ] as const;
            }),
          );
        };

        return fn({
          service,
          cierreMioId,
          cierreAjenoId,
          idPorClave,
          estatusReprogramadaId,
          enBodegaCentralId,
          leerOrdenes,
        });
      });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("💰 libera las VENCIDAS de ese cierre y deja intactas las de fecha FUTURA", async () => {
    const { movidas, quietas, resumen } = await conCorpus(async (ctx) => {
      const resumen = await ctx.service.liberarPorCierreAprobado(ctx.cierreMioId, HOY);
      const filas = await ctx.leerOrdenes();
      const movidas: string[] = [];
      const quietas: string[] = [];
      for (const [clave, f] of filas) {
        (f.estatusId === ctx.enBodegaCentralId ? movidas : quietas).push(clave);
      }
      return {
        movidas: movidas.sort(),
        quietas: quietas.sort(),
        resumen,
        filas,
        reprogramada: ctx.estatusReprogramadaId,
      };
    });

    // ⭑ LA MITAD QUE ARREGLA LA FICHA: la vencida y la de hoy salen sin esperar a medianoche.
    expect(movidas).toEqual(ESPERADAS);
    // ⭑⭑ LA MITAD QUE MAS IMPORTA: el 31/08, el 01/09 y la del otro cierre siguen donde estaban.
    expect(quietas).toEqual(["ajena", "manana", "pasado"]);
    // Y el corpus mide algo: son dos liberadas, no cero.
    expect(resumen).toEqual({ evaluadas: 2, liberadas: 2, omitidas: 0, esperandoCierre: 0 });
  });

  it("la liberada queda como la deja el cron: sin mensajero, prioritaria y con marca", async () => {
    const filas = await conCorpus(async (ctx) => {
      await ctx.service.liberarPorCierreAprobado(ctx.cierreMioId, HOY);
      return ctx.leerOrdenes();
    });

    const vencida = filas.get("vencida");
    expect(vencida?.mensajeroAsignadoId).toBeNull(); // handoff limpio a bodega (R13)
    expect(vencida?.prioridad).toBe(true); // feature 110/R1
    expect(vencida?.liberadaReprogramadaAt).not.toBeNull(); // marca de auditoria (R13)

    // Y la del 31/08 no se toco NI UN CAMPO: sigue con su mensajero, sin prioridad y sin marca.
    const manana = filas.get("manana");
    expect(manana?.mensajeroAsignadoId).not.toBeNull();
    expect(manana?.prioridad).toBe(false);
    expect(manana?.liberadaReprogramadaAt).toBeNull();
  });

  it("el 31/08 espera al CALENDARIO, no a otra aprobacion: el mismo cierre, con `hoyCR` = 29/08", async () => {
    // Es la contraprueba de que la exclusion de arriba es POR LA FECHA y no por otra cosa. Tambien
    // es la razon de que el reloj diario siga existiendo: esta orden no espera a que nadie apruebe
    // nada — su cierre YA esta aprobado— y sin la corrida de las 00:00 CR no saldria nunca.
    const { movidas, resumen } = await conCorpus(async (ctx) => {
      const resumen = await ctx.service.liberarPorCierreAprobado(ctx.cierreMioId, MANANA);
      const filas = await ctx.leerOrdenes();
      return {
        movidas: [...filas]
          .filter(([, f]) => f.estatusId === ctx.enBodegaCentralId)
          .map(([clave]) => clave)
          .sort(),
        resumen,
      };
    });

    expect(movidas).toEqual(["hoy", "manana", "vencida"]);
    // El 01/09 SIGUE fuera: el filtro se movio un dia, no desaparecio.
    expect(resumen.evaluadas).toBe(3);
  });

  it("idempotente: una segunda pasada (o el cron a medianoche) no vuelve a mover nada", async () => {
    const { primera, segunda, movidas } = await conCorpus(async (ctx) => {
      const primera = await ctx.service.liberarPorCierreAprobado(ctx.cierreMioId, HOY);
      const segunda = await ctx.service.liberarPorCierreAprobado(ctx.cierreMioId, HOY);
      const filas = await ctx.leerOrdenes();
      return {
        primera,
        segunda,
        movidas: [...filas].filter(([, f]) => f.estatusId === ctx.enBodegaCentralId).length,
      };
    });

    expect(primera.liberadas).toBe(2);
    // La orden ya salio de `reprogramada`, asi que ni siquiera es candidata: 0 evaluadas.
    expect(segunda).toEqual({ evaluadas: 0, liberadas: 0, omitidas: 0, esperandoCierre: 0 });
    expect(movidas).toBe(2);
  });

  it("aprobar el OTRO cierre suelta la suya, y solo la suya", async () => {
    // La simetria completa: cada aprobacion mueve exactamente su parte. Sin el acotado, cualquiera
    // de las dos vaciaria el corpus entero.
    const movidas = await conCorpus(async (ctx) => {
      await ctx.service.liberarPorCierreAprobado(ctx.cierreAjenoId, HOY);
      const filas = await ctx.leerOrdenes();
      return [...filas]
        .filter(([, f]) => f.estatusId === ctx.enBodegaCentralId)
        .map(([clave]) => clave)
        .sort();
    });

    expect(movidas).toEqual(["ajena"]);
  });
});
