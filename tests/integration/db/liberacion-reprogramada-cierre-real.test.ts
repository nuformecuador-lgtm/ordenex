import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";
import type { OrdenLiberableRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 276 (T6, bloque 🔴 OBLIGATORIO) — EL `select` DE LA LIBERACION, EJECUTADO CONTRA POSTGRES.
 *
 * ⚠️ POR QUE ESTE ARCHIVO ES OBLIGATORIO Y NO UN EXTRA. `liberacion-reprogramada-tope.test.ts`
 * prueba la REGLA con dobles: le entrega al servicio una fila ya construida y comprueba que decide
 * bien. Pero esa fila la construye el TEST, no el `select` del repositorio. En este repo esta
 * medido CUATRO veces que una mutacion de un `where`/`select` sobrevive en verde a una suite de
 * dobles — y el cambio de esta ficha es exactamente eso: un `select` que ahora tiene que traer el
 * cierre y la sonda de visita real DE LA GESTION CORRECTA.
 *
 * Lo que aqui es imposible falsear: si el `select` no pidiera `cierre`, Postgres no lo devolveria,
 * `gestionCierreEstado` saldria `null` y los asertos caen. Si la sonda no filtrara por familia,
 * la gestion SINTETICA saldria como visita real y el caso de la 100 cae. Y si el `take: 1` eligiera
 * la gestion equivocada, saldrian los hechos de la gestion ANULADA.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte. SIN base alcanzable se SALTA
 * (`describe.skip`), que se VE en la salida; nunca un `return` silencioso dentro del caso.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `276-${Date.now().toString(36)}`;
const GUIA_BASE = 930_000_000 + (Date.now() % 40_000_000);

/** `fecha_reprogramacion` es `@db.Date`: medianoche UTC, misma convencion que `startOfDayCR`. */
const AYER = new Date("2026-07-14T00:00:00.000Z");
const HOY = new Date("2026-07-15T00:00:00.000Z");
const MANANA = new Date("2026-07-16T00:00:00.000Z");

/**
 * El corpus. Cada orden es el testigo de UNA combinacion de los dos hechos nuevos.
 *
 * `vieja` describe la gestion ANULADA que se siembra ADEMAS de la vigente: existe para que el
 * `take: 1` tenga de verdad de donde equivocarse. Se le dan valores OPUESTOS a los de la vigente,
 * asi que un repositorio que eligiera la gestion equivocada devolveria justo lo contrario de lo que
 * se afirma y no podria acertar por casualidad.
 */
interface Semilla {
  clave: string;
  /** estado del cierre de la gestion VIGENTE; `null` = la gestion no tiene cierre. */
  cierre: "aprobado" | "solicitado" | "vencido" | "rechazado" | null;
  /** familia de la fila de historial que enlaza la gestion VIGENTE. */
  familiaVigente: "gestion" | "gestion_tienda_ayuda" | "reprogramacion_tienda" | null;
  fecha: Date;
  /** ¿se espera que el servicio la libere? */
  seLibera: boolean;
}

const SEMILLAS: Semilla[] = [
  // Visita real del mensajero, cierre APROBADO -> el contador ya subio -> se libera (R15).
  { clave: "real-aprobado", cierre: "aprobado", familiaVigente: "gestion", fecha: AYER, seLibera: true },
  // Visita real, cierre SIN aprobar -> el contador todavia puede subir -> NO (R12/R13).
  { clave: "real-solicitado", cierre: "solicitado", familiaVigente: "gestion", fecha: AYER, seLibera: false },
  { clave: "real-vencido", cierre: "vencido", familiaVigente: "gestion", fecha: AYER, seLibera: false },
  { clave: "real-rechazado", cierre: "rechazado", familiaVigente: "gestion", fecha: AYER, seLibera: false },
  // Visita real SIN cierre todavia -> aun puede entrar en uno -> NO (R32).
  { clave: "real-sin-cierre", cierre: null, familiaVigente: "gestion", fecha: AYER, seLibera: false },
  // La OTRA familia de visita real (237): mismo trato que `gestion`.
  { clave: "ayuda-solicitado", cierre: "solicitado", familiaVigente: "gestion_tienda_ayuda", fecha: AYER, seLibera: false },
  // La SINTETICA de la tienda (100): NO es visita real -> se libera con el criterio de siempre (R14).
  { clave: "sintetica-sin-cierre", cierre: null, familiaVigente: "reprogramacion_tienda", fecha: AYER, seLibera: true },
  // Gestion LEGADA sin ninguna fila de historial que la enlace: tampoco es visita real.
  { clave: "sin-historial", cierre: "solicitado", familiaVigente: null, fecha: AYER, seLibera: true },
  // Fecha FUTURA: el filtro de siempre sigue mandando y ni siquiera es candidata (R11).
  { clave: "futura", cierre: "aprobado", familiaVigente: "gestion", fecha: MANANA, seLibera: false },
];

const CANDIDATAS = SEMILLAS.filter((s) => s.fecha.getTime() <= HOY.getTime()).map((s) => s.clave);

describeSiHayBase("276/T6 — `findOrdenesLiberables` contra Postgres real", () => {
  let prisma: PrismaClient;

  let conCorpus: <T>(
    fn: (ctx: {
      repo: LiberacionReprogramadaRepository;
      /** clave de semilla -> id de orden. */
      idPorClave: Map<string, string>;
      /** id de orden -> clave de semilla (para leer los resultados). */
      clavePorId: Map<string, string>;
      estatusReprogramadaId: string;
      centralZonaId: string;
      tx: unknown;
    }) => Promise<T>,
  ) => Promise<T>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    // Fallo RUIDOSO, jamas un `return` silencioso: con base alcanzable y sin catalogo este archivo
    // no puede comprobar nada, y un `passed` en esas condiciones es la clase de verde que este repo
    // ya se comio una vez.
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el " +
          "corpus. Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    const catalogo = await prisma.orderStatus.findMany({
      where: { value: { in: ["reprogramada", "en_bodega_central", "en_bodega_satelite"] } },
      select: { id: true, value: true },
    });
    const idPorValue = new Map(catalogo.map((c) => [c.value, c.id]));
    for (const v of ["reprogramada", "en_bodega_central", "en_bodega_satelite"]) {
      if (!idPorValue.has(v)) {
        throw new Error(
          `falta el estatus «${v}» en el catalogo \`order_status\`. Corre \`pnpm run db:seed\`.`,
        );
      }
    }
    const estatusReprogramadaId = idPorValue.get("reprogramada") as string;

    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 1 });
    if (usuarios.length < 1) {
      throw new Error("hace falta al menos UN usuario en la base para sembrar las gestiones.");
    }
    const mensajeroId = usuarios[0].id;

    conCorpus = (fn) =>
      enTransaccionRevertida(prisma, async (tx) => {
        // PRIMERA sentencia: serializa contra los otros archivos que escriben en `public`.
        await serializarEscriturasReales(tx);

        const idPorClave = new Map<string, string>();
        const clavePorId = new Map<string, string>();
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
          clavePorId.set(orden.id, s.clave);

          const cierreVigenteId =
            s.cierre === null
              ? null
              : (
                  await tx.cierreDia.create({
                    data: {
                      mensajeroId,
                      estado: s.cierre,
                      destinoTipo: "bodega_central",
                      destinoZonaId: fks.zonaId,
                    },
                    select: { id: true },
                  })
                ).id;

          // ── LA GESTION VIEJA, ANULADA, con los hechos INVERTIDOS ──────────────────────────
          // Su unico trabajo es hacer que equivocarse de gestion sea DETECTABLE: lleva la fecha
          // de MAÑANA (asi la orden ni siquiera seria candidata si el `take: 1` la eligiera) y la
          // familia contraria a la de la vigente.
          const cierreViejo = await tx.cierreDia.create({
            data: {
              mensajeroId,
              estado: s.cierre === "aprobado" ? "solicitado" : "aprobado",
              destinoTipo: "bodega_central",
              destinoZonaId: fks.zonaId,
            },
            select: { id: true },
          });
          const vieja = await tx.gestionOrden.create({
            data: {
              ordenId: orden.id,
              mensajeroId,
              resultado: "reprogramada",
              fechaReprogramacion: MANANA,
              cierreId: cierreViejo.id,
              anuladaAt: new Date("2026-07-13T12:00:00.000Z"), // ANULADA: no cuenta
              createdAt: new Date("2026-07-12T10:00:00.000Z"), // y es la MAS VIEJA
            },
            select: { id: true },
          });
          await tx.ordenHistorialEstado.create({
            data: {
              ordenId: orden.id,
              estatusDestinoId: estatusReprogramadaId,
              origenTipo: s.familiaVigente === "gestion" ? "reprogramacion_tienda" : "gestion",
              gestionOrdenId: vieja.id,
            },
          });

          // ── LA GESTION VIGENTE (la que el `take: 1` debe elegir) ──────────────────────────
          const vigente = await tx.gestionOrden.create({
            data: {
              ordenId: orden.id,
              mensajeroId,
              resultado: "reprogramada",
              fechaReprogramacion: s.fecha,
              cierreId: cierreVigenteId,
              anuladaAt: null,
              createdAt: new Date("2026-07-14T18:00:00.000Z"), // la MAS RECIENTE
            },
            select: { id: true },
          });
          if (s.familiaVigente !== null) {
            await tx.ordenHistorialEstado.create({
              data: {
                ordenId: orden.id,
                estatusDestinoId: estatusReprogramadaId,
                origenTipo: s.familiaVigente,
                gestionOrdenId: vigente.id,
              },
            });
          }
          // Y una fila de historial de la orden que NO enlaza ninguna gestion, con una familia de
          // visita real: si la sonda filtrara por `orden_id` en vez de por la gestion, esta fila
          // haria pasar por «visita real» a TODAS las semillas.
          await tx.ordenHistorialEstado.create({
            data: {
              ordenId: orden.id,
              estatusDestinoId: estatusReprogramadaId,
              origenTipo: "gestion",
              gestionOrdenId: null,
            },
          });
        }

        const repo = new LiberacionReprogramadaRepository(tx as unknown as PrismaClient);
        return fn({
          repo,
          idPorClave,
          clavePorId,
          estatusReprogramadaId,
          centralZonaId: fks.zonaId,
          tx,
        });
      });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Las filas del corpus, indexadas por clave de semilla. */
  async function filasDelCorpus(): Promise<Map<string, OrdenLiberableRow>> {
    return conCorpus(async (ctx) => {
      const filas = await ctx.repo.findOrdenesLiberables(HOY);
      const mias = filas.filter((f) => ctx.clavePorId.has(f.id));
      return new Map(mias.map((f) => [ctx.clavePorId.get(f.id) as string, f]));
    });
  }

  it("el filtro de fecha NO se movio: entran las 8 con fecha <= hoy y NO la futura (R11)", async () => {
    const filas = await filasDelCorpus();

    expect([...filas.keys()].sort()).toEqual([...CANDIDATAS].sort());
    expect(filas.has("futura")).toBe(false);
    // El corpus mide algo de verdad: son ocho candidatas, no cero.
    expect(filas.size).toBe(8);
  });

  it("R12 — el `cierre.estado` que sale es el de la gestion VIGENTE, no el de la anulada", async () => {
    const filas = await filasDelCorpus();

    // ⭑ Aqui es donde una mutacion del `take: 1`/`orderBy` se cae: la gestion anulada de cada
    // semilla lleva el estado CONTRARIO, asi que elegirla invertiria todos estos valores.
    expect(filas.get("real-aprobado")?.gestionCierreEstado).toBe("aprobado");
    expect(filas.get("real-solicitado")?.gestionCierreEstado).toBe("solicitado");
    expect(filas.get("real-vencido")?.gestionCierreEstado).toBe("vencido");
    expect(filas.get("real-rechazado")?.gestionCierreEstado).toBe("rechazado");
    // Sin cierre: los dos hechos salen en `null`, no en `undefined` ni con el del cierre viejo.
    expect(filas.get("real-sin-cierre")?.gestionCierreId).toBeNull();
    expect(filas.get("real-sin-cierre")?.gestionCierreEstado).toBeNull();
  });

  it("R12/R14 — la SONDA de visita real distingue la familia, y por la gestion correcta", async () => {
    const filas = await filasDelCorpus();

    // Las dos familias de `ORIGEN_TIPOS_VISITA_REAL`, las dos `true`.
    expect(filas.get("real-solicitado")?.gestionEsVisitaReal).toBe(true);
    expect(filas.get("ayuda-solicitado")?.gestionEsVisitaReal).toBe(true);
    // ⭑ `reprogramacion_tienda` NO esta en la lista: la sintetica de la 100 sale `false`. Si la
    // sonda no filtrara por `origen_tipo`, esto seria `true` y la orden se congelaria sin motivo.
    expect(filas.get("sintetica-sin-cierre")?.gestionEsVisitaReal).toBe(false);
    // Gestion sin ninguna fila de historial enlazada: tampoco.
    expect(filas.get("sin-historial")?.gestionEsVisitaReal).toBe(false);
    // ⭑ Y la fila de historial con familia `gestion` que NO enlaza ninguna gestion (la sembrada a
    // proposito en cada orden) no contamina a nadie: si la sonda mirase `orden_id` en vez del
    // enlace a la gestion, las dos lineas de arriba serian `true`.
  });

  it("R12/R14/R15 — el SERVICIO, sobre lo que Postgres devuelve, libera exactamente lo que debe", async () => {
    // De punta a punta: repositorio REAL + servicio REAL. Es la unica forma de afirmar que la
    // regla y el `select` encajan; los dos por separado pueden estar bien y el par mal.
    const { liberadas, esperando, resumen } = await conCorpus(async (ctx) => {
      const liberadas: string[] = [];
      const repoEspia = {
        findOrdenesLiberables: (hoy: Date) => ctx.repo.findOrdenesLiberables(hoy),
        liberarOrden: async (input: { ordenId: string }) => {
          liberadas.push(ctx.clavePorId.get(input.ordenId) ?? input.ordenId);
          return true;
        },
        findLiberadasHoy: async () => [],
      };
      const service = new LiberacionReprogramadaService(
        repoEspia,
        { findCentralZonaId: async () => ctx.centralZonaId },
        {
          findEstatusIdByValue: async (v: string) =>
            v === "reprogramada" ? ctx.estatusReprogramadaId : `os-${v}`,
        },
        { warn: () => {} },
      );
      const resumen = await service.ejecutarLiberacion(HOY);
      return {
        liberadas: liberadas.filter((c) => CANDIDATAS.includes(c)).sort(),
        esperando: resumen.esperandoCierre ?? 0,
        resumen,
      };
    });

    // Las TRES que la regla deja pasar, y ninguna mas.
    expect(liberadas).toEqual(["real-aprobado", "sin-historial", "sintetica-sin-cierre"]);
    // Y las cinco congeladas se cuentan. (`esperandoCierre` puede incluir ordenes ajenas si la base
    // compartida tiene alguna; por eso se compara con `>=` el numero propio y se afirma que las
    // cinco claves NO estan entre las liberadas.)
    expect(esperando).toBeGreaterThanOrEqual(5);
    for (const clave of [
      "real-solicitado",
      "real-vencido",
      "real-rechazado",
      "real-sin-cierre",
      "ayuda-solicitado",
    ]) {
      expect(liberadas, `${clave} no deberia liberarse`).not.toContain(clave);
    }
    expect(resumen.omitidas).toBe(0); // ninguna congelada se contabiliza como fallo (R13)
  });
});
