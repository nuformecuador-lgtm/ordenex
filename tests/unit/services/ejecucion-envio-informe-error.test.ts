import { describe, expect, it, vi } from "vitest";
import { EjecucionEnvioService, type MetaEnvios } from "@/lib/services/EjecucionEnvioService";
import type { InformeWhatsapp } from "@/lib/whatsapp-envios/informes/tipos";
import { crearInformePicking } from "@/lib/whatsapp-envios/informes/picking/informe";
import type { IPickingRepository } from "@/lib/interfaces/repositories/IPickingRepository";
import { destinatario, ejecucionFila, ejecucionesRepo, envio, enviosRepo, plantilla } from "./_dobles-envios-474";

// Ficha 476 (T1.1, design §3.1, R7) — la rama `{ tipo: "error" }` de ResultadoInforme en el MOTOR: la
// ejecucion termina `error` con el motivo del informe (visible en el historial), sin entregas, sin
// guardar PDF y sin tocar Meta. Se ejerce con el informe de picking REAL y una tienda sin fulfillment.

const AHORA = new Date("2026-10-05T12:30:00.000Z");

function montar(origen: "programado" | "prueba" = "programado") {
  const repo: IPickingRepository = {
    tiendaDelPicking: vi.fn(async () => ({ id: "t1", nombre: "Gameos", fulfillment: false, esTienda: true, activo: true })),
    ordenesEnPreparacion: vi.fn(async () => []),
    tiendasFulfillment: vi.fn(async () => []),
    entradasEnPreparacion: vi.fn(async () => []),
  };
  const informe = crearInformePicking({ repo }) as unknown as InformeWhatsapp<unknown>;
  const envios = enviosRepo({
    obtener: vi.fn(async () =>
      envio({ encendido: true, informeClave: "picking", plantillaId: "pl-p", parametros: { tiendaId: "t1", diasAtraso: 2 } }),
    ),
    resolverDestinatarios: vi.fn(async () => [destinatario()]),
  });
  const ej = ejecucionesRepo(ejecucionFila({ origen }));
  const almacen = { guardar: vi.fn(), leer: vi.fn(), firmar: vi.fn(), borrar: vi.fn() };
  const enviarPlantilla = vi.fn();
  const subir = vi.fn();
  const metaFabrica = vi.fn((): MetaEnvios => ({ enviador: { enviarPlantilla }, subidor: { subir }, idioma: "es" }));
  const s = new EjecucionEnvioService({
    envios,
    ejecuciones: ej.repo,
    plantillas: {
      findEnviableDeInformeById: vi.fn(async () =>
        plantilla({ id: "pl-p", informeClave: "picking", llevaDocumento: true, variables: ["tienda"] }),
      ),
    },
    almacen,
    cola: { enqueue: vi.fn(async () => null) },
    meta: metaFabrica,
    now: () => AHORA,
    informe: () => informe,
    logger: { warn: () => {} },
  });
  return { s, ej, almacen, metaFabrica, enviarPlantilla, subir, repo };
}

describe("476/R7 — informe que responde «error»", () => {
  it("la ejecucion termina en error con SU motivo, sin entregas, sin PDF y sin Meta", async () => {
    const { s, ej, almacen, metaFabrica, enviarPlantilla, subir, repo } = montar();
    const r = await s.ejecutar("ej-1");
    const motivo = "La tienda «Gameos» ya no tiene fulfillment: revisa el envío.";
    expect(r).toEqual({ estado: "error", motivo, entregas: [] });
    expect(ej.fila().estado).toBe("error");
    expect(ej.fila().motivo).toBe(motivo);
    expect(ej.entregas()).toEqual([]);
    expect(ej.repo.fijarContenido).not.toHaveBeenCalled();
    expect(almacen.guardar).not.toHaveBeenCalled();
    expect(metaFabrica).not.toHaveBeenCalled();
    expect(enviarPlantilla).not.toHaveBeenCalled();
    expect(subir).not.toHaveBeenCalled();
    expect(repo.ordenesEnPreparacion).not.toHaveBeenCalled();
  });

  it("es TERMINAL: volver a ejecutar no regenera ni envia", async () => {
    const { s, ej, repo } = montar();
    await s.ejecutar("ej-1");
    await s.ejecutar("ej-1");
    expect(repo.tiendaDelPicking).toHaveBeenCalledTimes(1);
    expect(ej.fila().estado).toBe("error");
  });
});
