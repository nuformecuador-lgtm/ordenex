import { describe, it, expect, vi } from "vitest";
import { crearEncolarReintentoChatEnvio } from "@/lib/services/jobs/whatsapp-chat-envio-encolado";
import { crearWhatsappChatEnvioHandler } from "@/lib/services/jobs/whatsapp-chat-envio-handler";
import type { JobDTO, IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";

// Feature 109 — F3 (D1/R21). Encolado y handler del job `whatsapp_chat_envio`.
//
// NOTA: la assertion de REGISTRO en el drenador (buildHandlers incluye el tipo) vive en los
// tests hermanos `procesar-jobs-*.test.ts`, que importan `app/api/cron/procesar-jobs/route`.
// Ese modulo es, HOY, un-importable en el entorno de test de esta rama por un baseline
// preexistente ajeno (la ruta importa transitivamente `@/lib/auth/google-token-shared`, un
// archivo google aun sin commitear). Por eso aqui se ejercitan el encolado y el handler de
// forma AISLADA (sin importar la ruta), que es codigo nuevo de la feature.

const AHORA = new Date("2026-07-23T12:00:00.000Z");

function jobChat(): JobDTO {
  return {
    id: "job-chat",
    tipo: "whatsapp_chat_envio",
    payload: { mensajeChatId: "msg-q" },
    estado: "processing",
    intentos: 1,
    maxIntentos: 5,
    runAfter: AHORA,
    lockedAt: AHORA,
    lastError: null,
    dedupeKey: "whatsapp_chat_envio:msg-q",
    createdAt: AHORA,
    updatedAt: AHORA,
  };
}

describe("F3 — encolado del job whatsapp_chat_envio", () => {
  it("usa el tipo y una dedupeKey idempotente por mensaje", async () => {
    const enqueue = vi.fn(async () => null);
    const repo = { enqueue } as unknown as IJobRepository;

    await crearEncolarReintentoChatEnvio(repo)("msg-q");

    expect(enqueue).toHaveBeenCalledWith(
      "whatsapp_chat_envio",
      { mensajeChatId: "msg-q" },
      { dedupeKey: "whatsapp_chat_envio:msg-q" },
    );
  });
});

describe("F3 — handler del job whatsapp_chat_envio", () => {
  it("delega en service.reintentarEnvio con el mensajeChatId del payload", async () => {
    const reintentarEnvio = vi.fn(async () => {});
    const service = { reintentarEnvio } as unknown as ChatWhatsappService;
    const handler = crearWhatsappChatEnvioHandler(() => service);

    await handler(jobChat());

    expect(reintentarEnvio).toHaveBeenCalledWith("msg-q");
  });

  it("payload invalido (sin mensajeChatId) -> lanza (el job muere tras backoff)", async () => {
    const service = { reintentarEnvio: vi.fn() } as unknown as ChatWhatsappService;
    const handler = crearWhatsappChatEnvioHandler(() => service);

    await expect(handler({ ...jobChat(), payload: {} })).rejects.toThrow();
    expect((service.reintentarEnvio as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
