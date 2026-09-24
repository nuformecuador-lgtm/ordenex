import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RepartoMananaRepository } from "@/lib/repositories/RepartoMananaRepository";
import { startOfDayCR } from "@/lib/utils/fecha-cr";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, diaCR, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.18, R56) — UNA ORDEN CON GESTION PENDIENTE NO ES CARGA DEL MENSAJERO.
 *
 * Lo que la revision (B2, MUT-R10) encontro sin red: las dos exclusiones viven en un `where` de
 * Prisma —`OrdenRepository.findMensajerosConOrdenesEn` (aviso de mensajero ocupado y «Generar
 * guia») y `RepartoMananaRepository.whereRepartoManana` (aviso de reparto de mañana)—, y los tests de
 * servicio con dobles no ven el `WHERE` (memoria «probar el WHERE donde vive»). Aqui se miden los
 * repositorios REALES contra Postgres.
 *
 * La gestion es REAL: la registra `MisAsignacionesService.gestionar` (deja su evento
 * `gestion_registrada`, sin cierre), asi que la orden se queda `en_reparto` con gestion pendiente,
 * exactamente como en produccion.
 *
 * CONTROL POSITIVO por cada lector y sobre la MISMA orden: antes de la gestion SI cuenta. Sin el,
 * «no aparece» podria significar que el predicado no la veia nunca (estado, zona, fecha), y el test
 * pasaria en verde sin medir la exclusion. Y un segundo mensajero con una orden igual SIN gestion
 * sigue contando despues: la exclusion es por gestion pendiente, no por «el mundo se vacio».
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.18 — R56: la gestion pendiente no es carga del mensajero (Postgres real)", () => {
  let mundo: Mundo;
  let m: {
    ocupadosAntes: string[];
    ocupadosDespues: string[];
    mensajeroId: string;
    mensajero2Id: string;
    mananaAntes: number;
    mananaDespues: number;
    mananaControl: number;
    resumenDespues: { mensajeroId: string; total: number }[];
    estadoTrasGestion: string;
  };

  beforeAll(async () => {
    mundo = await prepararMundo();
    m = await conEscenario(mundo, async (e) => {
      const now = new Date();
      const hoy = startOfDayCR(now);
      const ordenRepo = new OrdenRepository(e.cliente);
      const mananaRepo = new RepartoMananaRepository(e.cliente);

      // La orden del mensajero 1: en_reparto, reservada para MAÑANA (para el lector del aviso).
      const o = await e.sembrarOrden({ estatus: "en_reparto", fechaReparto: diaCR(1, now) });
      // El control del mensajero 2: la misma forma, SIN gestion.
      await e.sembrarOrden({ estatus: "en_reparto", mensajeroId: e.mensajero2Id, fechaReparto: diaCR(1, now) });

      const ocupadosAntes = [
        ...(await ordenRepo.findMensajerosConOrdenesEn([e.mensajeroId, e.mensajero2Id], ["en_reparto"])),
      ];
      const mananaAntes = await mananaRepo.contarReservadasParaOtroDia(e.mensajeroId, hoy);

      // La 261 no deja gestionar una orden reservada para otro dia: se trae a hoy, se gestiona por
      // el servicio real y se devuelve a mañana. La gestion queda pendiente (sin cierre).
      await e.tx.orden.update({ where: { id: o.ordenId }, data: { fechaReparto: diaCR(0, now) } });
      await e.gestionarOk(o.ordenId, "entregada");
      await e.tx.orden.update({ where: { id: o.ordenId }, data: { fechaReparto: diaCR(1, now) } });
      const estadoTrasGestion = await e.estadoDe(o.ordenId);

      const ocupadosDespues = [
        ...(await ordenRepo.findMensajerosConOrdenesEn([e.mensajeroId, e.mensajero2Id], ["en_reparto"])),
      ];
      const mananaDespues = await mananaRepo.contarReservadasParaOtroDia(e.mensajeroId, hoy);
      const mananaControl = await mananaRepo.contarReservadasParaOtroDia(e.mensajero2Id, hoy);
      const resumenDespues = (await mananaRepo.resumenPorMensajero(hoy)).filter(
        (f) => f.mensajeroId === e.mensajeroId || f.mensajeroId === e.mensajero2Id,
      );

      return {
        ocupadosAntes,
        ocupadosDespues,
        mensajeroId: e.mensajeroId,
        mensajero2Id: e.mensajero2Id,
        mananaAntes,
        mananaDespues,
        mananaControl,
        resumenDespues,
        estadoTrasGestion,
      };
    });
  }, 60_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("precondicion: la orden sigue `en_reparto` tras la gestion (pendiente, no transicionada)", () => {
    expect(m.estadoTrasGestion).toBe("en_reparto");
  });

  it("CONTROL: antes de la gestion, los dos mensajeros estan ocupados", () => {
    expect(new Set(m.ocupadosAntes)).toEqual(new Set([m.mensajeroId, m.mensajero2Id]));
  });

  it("R56 ocupado/«Generar guia»: con la gestion pendiente, el mensajero 1 deja de estar ocupado; el 2 sigue", () => {
    expect(m.ocupadosDespues).toEqual([m.mensajero2Id]);
  });

  it("CONTROL: antes de la gestion, la orden cuenta en el reparto de mañana", () => {
    expect(m.mananaAntes).toBe(1);
  });

  it("R56 reparto de mañana: con la gestion pendiente no cuenta (cifra viva y resumen del cron)", () => {
    expect(m.mananaDespues).toBe(0);
    expect(m.mananaControl).toBe(1);
    expect(m.resumenDespues).toEqual([{ mensajeroId: m.mensajero2Id, total: 1 }]);
  });
});
