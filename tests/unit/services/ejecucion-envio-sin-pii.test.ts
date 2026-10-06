import { describe, expect, it, vi } from "vitest";
import { EjecucionEnvioService, type MetaEnvios } from "@/lib/services/EjecucionEnvioService";
import type { WhatsappEnvioOutcome } from "@/lib/clients/whatsapp-cloud";
import { destinatario, ejecucionFila, ejecucionesRepo, envio, enviosRepo, plantilla } from "./_dobles-envios-474";

// Ficha 474 (T7.2, R45) — ni el token, ni un secreto, ni un telefono COMPLETO en motivos, historial
// ni logs. El detalle crudo de Meta (que repite el numero destino) NO se persiste: el motivo es el
// texto fijo del codigo.

const TOKEN = "EAAG-token-secreto";
const TELEFONO = "50688882222";

describe("474/R45 — sin PII ni secretos", () => {
  it("rechazo permanente con el numero en el detalle de Meta: el motivo NO lo contiene", async () => {
    const salidas: WhatsappEnvioOutcome[] = [
      { status: "permanente", detalle: `HTTP 400 (Meta 131026): Recipient ${TELEFONO} token=${TOKEN}`, codigoMeta: 131026 },
    ];
    const enviarPlantilla = vi.fn(async () => salidas.shift() as WhatsappEnvioOutcome);
    const m: MetaEnvios = { enviador: { enviarPlantilla }, subidor: { subir: vi.fn() }, idioma: "es" };
    const ej = ejecucionesRepo(ejecucionFila());
    const logs: string[] = [];
    const s = new EjecucionEnvioService({
      envios: enviosRepo({
        obtener: vi.fn(async () => envio({ encendido: true })),
        resolverDestinatarios: vi.fn(async () => [destinatario({ telefono: "8888-2222" })]),
      }),
      ejecuciones: ej.repo,
      plantillas: { findEnviableDeInformeById: vi.fn(async () => plantilla()) },
      almacen: { guardar: vi.fn(), leer: vi.fn(), firmar: vi.fn(), borrar: vi.fn() },
      cola: { enqueue: vi.fn() },
      meta: () => m,
      logger: { warn: (x) => logs.push(x) },
    });
    const r = await s.ejecutar("ej-1");
    const visible = JSON.stringify({ r, entregas: ej.entregas().map((e) => ({ estado: e.estado, motivo: e.motivo })), fila: ej.fila(), logs });
    expect(visible).not.toContain(TOKEN);
    expect(visible).not.toContain(TELEFONO);
    expect(ej.entregas()[0].motivo).toBe("El número no tiene WhatsApp o no puede recibir mensajes.");
  });

  it("una excepcion del cliente se loguea SIN el telefono ni el mensaje crudo", async () => {
    const enviarPlantilla = vi.fn(async () => {
      throw new Error(`fallo enviando a ${TELEFONO} con ${TOKEN}`);
    });
    const m: MetaEnvios = { enviador: { enviarPlantilla }, subidor: { subir: vi.fn() }, idioma: "es" };
    const ej = ejecucionesRepo(ejecucionFila());
    const logs: string[] = [];
    const s = new EjecucionEnvioService({
      envios: enviosRepo({
        obtener: vi.fn(async () => envio({ encendido: true })),
        resolverDestinatarios: vi.fn(async () => [destinatario({ telefono: "8888-2222" })]),
      }),
      ejecuciones: ej.repo,
      plantillas: { findEnviableDeInformeById: vi.fn(async () => plantilla()) },
      almacen: { guardar: vi.fn(), leer: vi.fn(), firmar: vi.fn(), borrar: vi.fn() },
      cola: { enqueue: vi.fn() },
      meta: () => m,
      logger: { warn: (x) => logs.push(x) },
    });
    await s.ejecutar("ej-1");
    expect(logs.length).toBeGreaterThan(0); // autocomprobacion: si se logueo
    expect(logs.join("|")).not.toContain(TELEFONO);
    expect(logs.join("|")).not.toContain(TOKEN);
  });
});
