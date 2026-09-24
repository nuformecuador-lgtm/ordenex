import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { prepararConsultaAnalitica, type ConsultaAnalitica } from "@/lib/analytics/consulta";
import { ventanaDelDia } from "@/lib/analytics/rollup-dia";
import { AnaliticaOperativaRollupRepository } from "@/lib/repositories/AnaliticaOperativaRollupRepository";
import { AnaliticaOperativaVivaRepository } from "@/lib/repositories/AnaliticaOperativaVivaRepository";
import { CohorteCargaRepository } from "@/lib/repositories/CohorteCargaRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenTraspasoRepository } from "@/lib/repositories/OrdenTraspasoRepository";
import { RankingRepository } from "@/lib/repositories/RankingRepository";
import { completarPrimerIntentoEnCubos } from "@/lib/services/AnaliticaOperativaService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import type { CuboRollup } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import { C, R, claveDe } from "../../../../fixtures/codigos-455";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "../../_postgres-real";
import {
  FECHA_D,
  FECHA_D_MENOS_1,
  agregarTransicion,
  clienteSobreTransaccion,
  crearGestion,
  crearOrden,
  crearServicio,
  instanteCR,
  leerFilas,
  sembrarBase,
  type BaseSembrada,
  type TxDeTest,
} from "../../_semilla-rollup";
import { consultaDe, rangoDe } from "../../_cohorte-carga";

/**
 * FEATURE 455 — FASE 0 · C05 (R46, R52). LOS NUMEROS DE LA ANALITICA, sobre el codigo de HOY.
 *
 * El rollup diario (124, `AnaliticaRollupRepository`), su gemelo intradia (126,
 * `AnaliticaOperativaVivaRepository`), la cohorte de carga (`CohorteCargaRepository`) y el ranking
 * (`RankingRepository`) comparan `gestion_orden.resultado` y `order_status.value` con CODIGOS escritos
 * en SQL crudo o en `where`: exactamente lo que la 455 renombra. Un dia D (2001-06-15, la base real no
 * tiene nada ahi) sembrado con la semilla de la 124, en tx revertida:
 *   O1 entregada a la primera · O2 creada en D-1 y con novedad (`not_found`) en D · O3 rechazo ·
 *   O4 reprogramada · O5 incidente · O6 sin mensajero en `C.novedadInterna` · O7 `C.porDevolverCentral`
 *   y luego `C.devueltaATienda` (terminal) · O8 en `C.recogiendo`.
 * Invariantes (los nombres de las MEDIDAS y columnas no cambian con la 455, §9-F):
 *  - las filas del rollup de D, con el estatus leido en su clave del interruptor;
 *  - el intradia de D reproduce el rollup cubo a cubo;
 *  - la cohorte de carga de D por desenlace;
 *  - el ranking: entregas vigentes de D por mensajero.
 * `[INTERMEDIO]`: `AnaliticaOperativaRollupRepository.etiquetasDeEstatus` rotula con el codigo (R3; la
 * Fase 1, T1.11, lo cambia al nombre visible).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const MAESTRO = { usuarioId: "u-maestro-455-c05", rol: "maestro" } as const;
const AHORA = instanteCR(FECHA_D, "23:59");

function consultaGlobal(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(
    { rango: "personalizado", desde: FECHA_D, hasta: FECHA_D },
    MAESTRO,
    metricaId,
    AHORA,
  );
  if (r.status !== "ok") throw new Error(`preparacion no concedida: ${JSON.stringify(r)}`);
  return r.consulta;
}

type Medidas = Record<string, number>;

function medidasDe(c: {
  ordenesCreadas: number;
  ordenesEstadoStock: number;
  entregas: number;
  devoluciones: number;
  rechazos: number;
  reprogramaciones: number;
  incidentes: number;
  primerIntentoOk: number;
  segCicloAcum: number | bigint;
  segCicloN: number;
}): Medidas {
  const todas: Medidas = {
    ordenesCreadas: c.ordenesCreadas,
    ordenesEstadoStock: c.ordenesEstadoStock,
    entregas: c.entregas,
    devoluciones: c.devoluciones,
    rechazos: c.rechazos,
    reprogramaciones: c.reprogramaciones,
    incidentes: c.incidentes,
    primerIntentoOk: c.primerIntentoOk,
    segCicloAcum: Number(c.segCicloAcum),
    segCicloN: c.segCicloN,
  };
  return Object.fromEntries(Object.entries(todas).filter(([, v]) => v !== 0));
}

async function sembrarDia(tx: TxDeTest, base: BaseSembrada) {
  const orden = (clave: string, creada: Date, mensajeroId: string | null = base.mensajero1) =>
    crearOrden(tx, base, { clave, zonaId: base.zonaA, tiendaId: base.tienda1, mensajeroId, createdAt: creada });
  const gestionada = async (
    clave: string,
    creada: Date,
    resultado: string,
    destino: string,
    at: Date,
    causa: "not_found" | null = null,
    gestor: string = base.mensajero1,
  ) => {
    const id = await orden(clave, creada);
    await agregarTransicion(tx, base, id, { at: new Date(creada.getTime() + 5 * 60_000), destino: C.enReparto });
    const g = await crearGestion(tx, {
      ordenId: id,
      mensajeroId: gestor,
      resultado: resultado as never,
      causaDevolucion: causa,
      at,
    });
    await agregarTransicion(tx, base, id, { at, destino, origenTipo: "gestion", gestionOrdenId: g });
    return id;
  };
  await gestionada("O1", instanteCR(FECHA_D, "08:00"), R.entregado, C.entregado, instanteCR(FECHA_D, "12:00"));
  await gestionada(
    "O2",
    instanteCR(FECHA_D_MENOS_1, "09:00"),
    R.novedad,
    C.novedad,
    instanteCR(FECHA_D, "14:00"),
    "not_found",
  );
  await gestionada("O3", instanteCR(FECHA_D, "07:00"), R.rechazo, C.rechazo, instanteCR(FECHA_D, "15:00"));
  await gestionada("O4", instanteCR(FECHA_D, "06:30"), R.reprogramado, C.reprogramado, instanteCR(FECHA_D, "17:00"));
  // O5 la gestiona OTRO mensajero: sus medidas de gestion van a otro cubo y el ranking no la confunde.
  await gestionada(
    "O5",
    instanteCR(FECHA_D, "06:00"),
    R.incidente,
    C.incidente,
    instanteCR(FECHA_D, "16:00"),
    null,
    base.mensajero2,
  );
  const o6 = await orden("O6", instanteCR(FECHA_D, "05:00"), null);
  await agregarTransicion(tx, base, o6, { at: instanteCR(FECHA_D, "05:05"), destino: C.novedadInterna });
  const o7 = await orden("O7", instanteCR(FECHA_D, "04:00"));
  await agregarTransicion(tx, base, o7, { at: instanteCR(FECHA_D, "10:00"), destino: C.porDevolverCentral });
  await agregarTransicion(tx, base, o7, { at: instanteCR(FECHA_D, "18:00"), destino: C.devueltaATienda });
  const o8 = await orden("O8", instanteCR(FECHA_D, "04:30"));
  await agregarTransicion(tx, base, o8, { at: instanteCR(FECHA_D, "04:35"), destino: C.recogiendo });
}

describeSiHayBase("455/C05 — numeros de la analitica (Postgres real)", () => {
  let prisma: PrismaClient;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);
      await sembrarDia(tx, base);
      const et = (id: string | null) => (id === null ? "-" : (base.etiqueta.get(id) ?? id));

      // (1) El rollup diario de la 124.
      await crearServicio(tx).agregarFecha(FECHA_D);
      const rollup = (await leerFilas(tx, base, FECHA_D))
        .map((f) => ({
          cubo: [f.zona, f.tienda, f.mensajero ?? "-", claveDe(f.estatus), f.causa ?? "-"].join("|"),
          medidas: medidasDe(f),
        }))
        .sort((a, b) => a.cubo.localeCompare(b.cubo));

      // (2) El intradia de la 126 sobre la MISMA ventana.
      const cliente = clienteSobreTransaccion(tx);
      const crudos = await new AnaliticaOperativaVivaRepository(cliente).cubosDelDiaEnCurso(
        consultaGlobal("entregas"),
        ventanaDelDia(FECHA_D),
      );
      const prismaTx = tx as unknown as PrismaClient;
      const historial = new OrdenHistorialService(
        new OrdenRepository(prismaTx),
        new OrdenHistorialRepository(prismaTx),
        new OrdenDiaRepartoCambioRepository(prismaTx),
        new OrdenTraspasoRepository(prismaTx),
      );
      const intentos = await historial.contarIntentosEnLote([
        ...new Set(crudos.entregasVigentes.map((x) => x.ordenId)),
      ]);
      const intradia = (completarPrimerIntentoEnCubos(crudos, intentos) as readonly CuboRollup[])
        .map((c) => ({
          cubo: [
            et(String(c.zonaId)),
            et(String(c.tiendaId)),
            c.mensajeroId === null ? "-" : et(String(c.mensajeroId)),
            claveDe(et(String(c.estatusId))),
            c.causaDevolucion === null ? "-" : String(c.causaDevolucion),
          ].join("|"),
          medidas: medidasDe(c),
        }))
        .sort((a, b) => a.cubo.localeCompare(b.cubo));

      // (3) La cohorte de carga del dia D, vista por la tienda.
      const cohorte = (
        await new CohorteCargaRepository(prismaTx).contarCohortes(
          consultaDe(rangoDe(FECHA_D, FECHA_D), { usuarioId: base.tienda1, rol: "adminTienda" }),
        )
      )
        .filter((c) => c.fecha === FECHA_D)
        .map((c) => `${claveDe(c.desenlace === "viva" ? null : c.desenlace).replace("∅", "viva")}:${c.n}`)
        .sort();

      // (4) El ranking: entregas vigentes de D por mensajero.
      const ranking = (
        await new RankingRepository(prismaTx).contarEntregadasPorMensajero(
          instanteCR(FECHA_D, "00:00"),
          instanteCR(FECHA_D, "23:59"),
        )
      )
        .filter((f) => f.mensajeroId === base.mensajero1 || f.mensajeroId === base.mensajero2)
        .map((f) => `${et(f.mensajeroId)}:${f.total}`)
        .sort();

      // [INTERMEDIO] la etiqueta de estatus del rollup operativo.
      const idsEstatus = [C.entregado, C.novedad, C.novedadInterna].map((v) => base.estatus.get(v) as string);
      const etiquetas = await new AnaliticaOperativaRollupRepository(prismaTx).etiquetasDeEstatus(idsEstatus);
      const etiquetasLeidas = idsEstatus.map((id) => etiquetas.get(id)?.label ?? "∅");

      return { rollup, intradia, cohorte, ranking, etiquetasLeidas };
    });
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe("invariantes", () => {
    it("las filas del rollup de D, cubo a cubo y medida a medida", () => {
      expect(r.rollup).toEqual(ROLLUP_ESPERADO);
    });

    it("el intradia de D reproduce el rollup", () => {
      expect(r.intradia).toEqual(r.rollup);
    });

    it("la cohorte de carga de D por desenlace", () => {
      expect(r.cohorte).toEqual(COHORTE_ESPERADA);
    });

    it("el ranking: una entrega vigente de mensajero1 en D", () => {
      expect(r.ranking).toEqual(["mensajero1:1"]);
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R3)", () => {
    // Fase 0 (2026-09-24): la etiqueta del estatus del rollup operativo es su CODIGO. La Fase 1
    // (T1.11, `label: nombreDeEstado(f.value)`) reescribe este bloque con fecha.
    it("la etiqueta de estatus del rollup operativo es el codigo", () => {
      expect(r.etiquetasLeidas).toEqual([C.entregado, C.novedad, C.novedadInterna]);
    });
  });
});

// Valores medidos sobre el codigo de HOY (2026-09-24), con el estatus leido en su clave del interruptor.
// O2 se creo en D-1: no suma `ordenesCreadas` en D, pero su devolucion si (cubo de su causa).
// O3 (rechazo) y O4 (reprogramada) no cierran ciclo; O7 lo cierra al llegar a `devueltaATienda`.
const ROLLUP_ESPERADO = [
  { cubo: "zonaA|tienda1|-|novedadInterna|-", medidas: { ordenesCreadas: 1, ordenesEstadoStock: 1 } },
  {
    cubo: "zonaA|tienda1|mensajero1|devueltaATienda|-",
    medidas: { ordenesCreadas: 1, ordenesEstadoStock: 1, segCicloAcum: 50400, segCicloN: 1 },
  },
  {
    cubo: "zonaA|tienda1|mensajero1|entregado|-",
    medidas: {
      entregas: 1,
      ordenesCreadas: 1,
      ordenesEstadoStock: 1,
      primerIntentoOk: 1,
      segCicloAcum: 14400,
      segCicloN: 1,
    },
  },
  {
    cubo: "zonaA|tienda1|mensajero1|incidente|-",
    medidas: { ordenesCreadas: 1, ordenesEstadoStock: 1, segCicloAcum: 36000, segCicloN: 1 },
  },
  { cubo: "zonaA|tienda1|mensajero1|novedad|-", medidas: { ordenesEstadoStock: 1 } },
  { cubo: "zonaA|tienda1|mensajero1|novedad|not_found", medidas: { devoluciones: 1 } },
  {
    cubo: "zonaA|tienda1|mensajero1|rechazo|-",
    medidas: { ordenesCreadas: 1, ordenesEstadoStock: 1, rechazos: 1 },
  },
  { cubo: "zonaA|tienda1|mensajero1|recogiendo|-", medidas: { ordenesCreadas: 1, ordenesEstadoStock: 1 } },
  {
    cubo: "zonaA|tienda1|mensajero1|reprogramado|-",
    medidas: { ordenesCreadas: 1, ordenesEstadoStock: 1, reprogramaciones: 1 },
  },
  // La medida de GESTION del incidente va al cubo de quien la gestiono (mensajero2).
  { cubo: "zonaA|tienda1|mensajero2|incidente|-", medidas: { incidentes: 1 } },
];
// Siete ordenes cargadas en D (O2 es de D-1): tres con desenlace terminal y cuatro vivas.
const COHORTE_ESPERADA = ["devueltaATienda:1", "entregado:1", "incidente:1", "viva:4"];
