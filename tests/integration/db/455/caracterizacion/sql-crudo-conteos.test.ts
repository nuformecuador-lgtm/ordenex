import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CicloVidaRepository } from "@/lib/repositories/CicloVidaRepository";
import { ConteoDevolucionesRepository } from "@/lib/repositories/ConteoDevolucionesRepository";
import { ConteoEntregasRepository } from "@/lib/repositories/ConteoEntregasRepository";
import { ConteoPorStatusRepository } from "@/lib/repositories/ConteoPorStatusRepository";
import { C, R, claveDe } from "../../../../fixtures/codigos-455";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "../../_postgres-real";
import {
  agregarTransicion,
  crearGestion,
  crearOrden,
  instanteCR,
  sembrarBase,
} from "../../_semilla-rollup";
import { D, consultaDe, rangoDe } from "../../_cohorte-carga";

/**
 * FEATURE 455 — FASE 0 · C07 (R46). LOS CONTEOS DE LA ANALITICA DE ENTREGAS.
 *
 * `ConteoPorStatusRepository` (y `ConteoEntregasRepository`, que lo pliega en desenlaces con la lista
 * `DESENLACES` de codigos), `ConteoDevolucionesRepository` (gestiones con `resultado = <codigo>`) y
 * `CicloVidaRepository` (ultima transicion a un estado TERMINAL, por codigo) comparan codigos en SQL.
 * Cohorte de carga del dia D (2001-06-15), vista por la tienda, en tx revertida:
 *   O1 `R.entregado` y transicion terminal a `C.entregado` · O2 `R.novedad` (not_found) ·
 *   O3 `R.novedad` sin causa · O4 `R.rechazo` · O5 `R.reprogramado` · O6 `R.incidente` y transicion
 *   terminal a `C.incidente` · O7 nunca gestionada (queda por su `order_status`: `C.enBodegaCentral`) ·
 *   O8 sin gestion y transicion terminal a `C.devueltaATienda`.
 * Invariantes: el desglose por status, el plegado en desenlaces, las devoluciones por causa y el
 * ciclo de vida acumulado. Sin `[INTERMEDIO]`: la 455 no cambia ningun numero.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("455/C07 — conteos de entregas, devoluciones y ciclo de vida (Postgres real)", () => {
  let prisma: PrismaClient;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);
      const orden = (clave: string, hora: string) =>
        crearOrden(tx, base, {
          clave,
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: instanteCR(D, hora),
        });
      const gestion = async (
        ordenId: string,
        resultado: string,
        hora: string,
        causa: "not_found" | null = null,
      ) =>
        crearGestion(tx, {
          ordenId,
          mensajeroId: base.mensajero1,
          resultado: resultado as never,
          causaDevolucion: causa,
          at: instanteCR(D, hora),
        });

      const o1 = await orden("O1", "08:00");
      const g1 = await gestion(o1, R.entregado, "12:00");
      await agregarTransicion(tx, base, o1, {
        at: instanteCR(D, "12:00"),
        destino: C.entregado,
        origenTipo: "gestion",
        gestionOrdenId: g1,
      });
      await gestion(await orden("O2", "08:10"), R.novedad, "13:00", "not_found");
      await gestion(await orden("O3", "08:20"), R.novedad, "13:30");
      await gestion(await orden("O4", "08:30"), R.rechazo, "14:00");
      await gestion(await orden("O5", "08:40"), R.reprogramado, "14:30");
      const o6 = await orden("O6", "08:50");
      const g6 = await gestion(o6, R.incidente, "15:00");
      await agregarTransicion(tx, base, o6, {
        at: instanteCR(D, "15:00"),
        destino: C.incidente,
        origenTipo: "gestion",
        gestionOrdenId: g6,
      });
      await orden("O7", "09:00");
      const o8 = await orden("O8", "09:10");
      await agregarTransicion(tx, base, o8, { at: instanteCR(D, "18:10"), destino: C.devueltaATienda });

      const consulta = consultaDe(rangoDe(D, D), { usuarioId: base.tienda1, rol: "adminTienda" });
      const cliente = tx as unknown as PrismaClient;
      const porStatusRepo = new ConteoPorStatusRepository(cliente);
      const porStatus = (await porStatusRepo.contarPorStatus(consulta))
        .map((f) => `${claveDe(f.status)}:${f.conteo}`)
        .sort();
      const plegado = (await new ConteoEntregasRepository(porStatusRepo).contar(consulta)).porDesenlace;
      const desenlaces = Object.entries(plegado)
        .map(([k, v]) => `${k === "otros" ? "otros" : claveDe(k)}:${v}`)
        .sort();
      const causas = (await new ConteoDevolucionesRepository(cliente).contarDevolucionesPorCausa(consulta))
        .map((c) => `${c.causa}:${c.conteo}`)
        .sort();
      const ciclo = await new CicloVidaRepository(cliente).acumularCiclos(consulta);
      return { porStatus, desenlaces, causas, ciclo: { segundosAcum: Number(ciclo.segundosAcum), n: ciclo.n } };
    });
  }

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("el desglose por status de la cohorte", () => {
    expect(r.porStatus).toEqual(POR_STATUS_ESPERADO);
  });

  it("el plegado en desenlaces (con el cubo `otros`)", () => {
    expect(r.desenlaces).toEqual(DESENLACES_ESPERADOS);
  });

  it("las devoluciones por causa", () => {
    expect(r.causas).toEqual(CAUSAS_ESPERADAS);
  });

  it("el ciclo de vida acumulado de las cerradas en D", () => {
    expect(r.ciclo).toEqual(CICLO_ESPERADO);
  });
});

// Valores medidos sobre el codigo de HOY (2026-09-24), con los codigos leidos en su clave del interruptor.
// O7 y O8 nunca se gestionaron: cuentan por su `order_status` (la semilla las deja en
// `C.enBodegaCentral`); O8 cierra ciclo por su transicion terminal, pero el desglose es por status.
const POR_STATUS_ESPERADO = [
  "enBodegaCentral:2",
  "entregado:1",
  "incidente:1",
  "novedad:2",
  "rechazo:1",
  "reprogramado:1",
];
const DESENLACES_ESPERADOS = [
  "entregado:1",
  "incidente:1",
  "novedad:2",
  "otros:2",
  "rechazo:1",
  "reprogramado:1",
];
const CAUSAS_ESPERADAS = ["not_found:1", "sin_causa:1"];
// O1 08:00->12:00 (14 400 s) + O6 08:50->15:00 (22 200 s) + O8 09:10->18:10 (32 400 s).
const CICLO_ESPERADO = { segundosAcum: 69000, n: 3 };
