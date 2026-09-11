import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DevolucionSlaService } from "@/lib/services/DevolucionSlaService";
import { devolucionSlaConfig } from "@/lib/config/devolucion-sla";
import type {
  DevueltaSlaRow,
  IDevolucionSlaRepository,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";

// FICHA 409 (T1.2, R39) — EL «5» NO SE ESCRIBE DOS VECES.
//
// El aviso `novedades_sin_gestionar` le DICE EL PLAZO A LA TIENDA («A los 5 días se rechaza
// automáticamente»), y la tienda organiza su trabajo con ese numero. Si el texto y el cron leyeran
// numeros distintos, el aviso mentiria — leccion de la 407 en su forma aritmetica.
//
// ⚠️ ESTE ARCHIVO TIENE TRES ASERTOS Y **UNO ES DE COMPORTAMIENTO DEL CRON**. Un test que solo
// comprobara que la constante vale 5 estaria comparando un numero consigo mismo: mutar la
// configuracion a 6 lo pondria rojo, si, pero no demostraria que el cron LA USA. El caso de
// 4 d 23 h / 5 d 00 h si lo demuestra — y con la configuracion en 6 tambien se pone rojo, por la
// otra via.

const ROOT = path.resolve(__dirname, "..", "..", "..");
const NOW = new Date("2026-07-20T12:00:00.000Z");
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const ESTATUS: Record<string, string> = {
  devuelta: "os-devuelta",
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
  rechazada: "os-rechazada",
};

function row(ancladaAt: Date, causa: DevueltaSlaRow["causa"]): DevueltaSlaRow {
  return {
    ordenId: "o1",
    zonaId: "z-limon",
    mensajeroId: "m1",
    causa,
    ancladaAt,
    origenAncla: "aprobacion",
  };
}

function correrCron(fila: DevueltaSlaRow) {
  const escalar = vi.fn(async () => true);
  const liberar = vi.fn(async () => true);
  const repo: IDevolucionSlaRepository = {
    findDevueltasSla: vi.fn(async () => [fila]),
    liberarDevueltaSla: liberar,
    escalarDevueltaSla: escalar,
  };
  const zonaRepo: Pick<IZonaRepository, "findCentralZonaId"> = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  };
  const ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue"> = {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
  };
  // Cero intentos: la rama del TOPE (276) no interviene, asi que lo unico que puede escalar una
  // `wrong_*` es la VENTANA — que es lo que este archivo mide.
  const historial: Pick<IOrdenHistorialService, "contarIntentosEnLote"> = {
    contarIntentosEnLote: vi.fn(async () => new Map<string, number>()),
  };
  const service = new DevolucionSlaService(repo, zonaRepo, ordenRepo, historial, { warn: () => {} });
  return { service, escalar, liberar };
}

describe("R39 (a) — la configuracion dice 5 dias y 24 horas", () => {
  it("los dos valores, escritos a mano", () => {
    expect(devolucionSlaConfig.DIAS_RECHAZO_AUTOMATICO).toBe(5);
    expect(devolucionSlaConfig.HORAS_REINTENTO).toBe(24);
  });
});

describe("R39 (b) — el CRON aplica ese mismo plazo, no otro", () => {
  it("una `wrong_address` de 4 d 23 h NO escala", async () => {
    const { service, escalar } = correrCron(
      row(new Date(NOW.getTime() - (4 * DIA + 23 * HORA)), "wrong_address"),
    );

    const r = await service.ejecutar(NOW);

    expect(escalar).not.toHaveBeenCalled();
    expect(r.escaladas).toBe(0);
    expect(r.evaluadas).toBe(1); // la orden reposa: la ventana sigue viva
  });

  it("una `wrong_address` de 5 d 00 h SI escala", async () => {
    const { service, escalar } = correrCron(
      row(new Date(NOW.getTime() - 5 * DIA), "wrong_address"),
    );

    const r = await service.ejecutar(NOW);

    expect(escalar).toHaveBeenCalledTimes(1);
    expect(r.escaladas).toBe(1);
  });

  it("una `not_found` de 23 h 59 min no actua, y una de 24 h 00 min si", async () => {
    const casi = correrCron(row(new Date(NOW.getTime() - (23 * HORA + 59 * 60 * 1000)), "not_found"));
    const justa = correrCron(row(new Date(NOW.getTime() - 24 * HORA), "not_found"));

    const antes = await casi.service.ejecutar(NOW);
    const despues = await justa.service.ejecutar(NOW);

    expect(antes.liberadas).toBe(0);
    expect(antes.escaladas).toBe(0);
    // Con cero intentos vigentes, la `not_found` vencida se LIBERA a bodega (reintento).
    expect(despues.liberadas).toBe(1);
  });
});

describe("R39 (c) — el numero no esta escrito dos veces", () => {
  it("`DevolucionSlaService` deriva sus ventanas de la configuracion, no de un literal", () => {
    const fuente = fs.readFileSync(
      path.join(ROOT, "lib", "services", "DevolucionSlaService.ts"),
      "utf8",
    );

    expect(fuente).toContain("devolucionSlaConfig.DIAS_RECHAZO_AUTOMATICO");
    expect(fuente).toContain("devolucionSlaConfig.HORAS_REINTENTO");
    // Los literales viejos ya no estan: `5 * DIA_MS` y `24 * HORA_MS` eran las dos copias.
    expect(fuente).not.toMatch(/VENTANA_WRONG_MS\s*=\s*5\s*\*/);
    expect(fuente).not.toMatch(/VENTANA_NOT_FOUND_MS\s*=\s*24\s*\*/);
  });

  it("el texto del aviso tambien deriva de ahi: `emitir.ts` no escribe el numero", () => {
    const fuente = fs.readFileSync(
      path.join(ROOT, "lib", "notificaciones", "emitir.ts"),
      "utf8",
    );

    expect(fuente).toContain("devolucionSlaConfig.DIAS_RECHAZO_AUTOMATICO");
    expect(fuente).toContain("devolucionSlaConfig.HORAS_REINTENTO");
    // Ni «A los 5 días» ni «A las 24 horas» como literal en el emisor: se componen.
    expect(fuente).not.toContain("A los 5 días");
    expect(fuente).not.toContain("A las 24 horas");
  });
});
