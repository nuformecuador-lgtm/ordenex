import { describe, it, expect } from "vitest";
import { parseWebhookEventos } from "@/lib/types/whatsapp-webhook";

// Feature 109 — B2.T (R5). El esquema zod DESCARTA (strip) los campos no reconocidos de
// Meta y NORMALIZA el payload a mensajes entrantes + statuses de dominio.

function payloadEntrante(extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account", // campo extra -> se strip-ea
    entry: [
      {
        id: "waba-1", // extra
        changes: [
          {
            field: "messages", // extra
            value: {
              messaging_product: "whatsapp", // extra
              metadata: { display_phone_number: "1555", phone_number_id: "99" }, // extra/PII
              contacts: [{ profile: { name: "Ana" }, wa_id: "573001112233" }], // extra/PII
              messages: [
                {
                  from: "573001112233",
                  id: "wamid.ENTRANTE1",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "Hola, donde va mi paquete?" },
                  ...extra,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("parseWebhookEventos (R5)", () => {
  it("descarta campos extra del payload y normaliza el mensaje entrante", () => {
    const eventos = parseWebhookEventos(payloadEntrante());

    expect(eventos.mensajes).toHaveLength(1);
    const m = eventos.mensajes[0];
    expect(m).toEqual({
      waMessageId: "wamid.ENTRANTE1",
      telefonoE164: "573001112233",
      tipo: "texto",
      cuerpo: "Hola, donde va mi paquete?",
      ocurridoAt: new Date(1700000000 * 1000),
    });
    // No hay rastro de los campos extra (metadata/contacts/object) en el tipo de dominio.
    expect(Object.keys(m).sort()).toEqual(
      ["cuerpo", "ocurridoAt", "telefonoE164", "tipo", "waMessageId"].sort(),
    );
  });

  it("un mensaje no-texto se normaliza como tipo 'otro' sin cuerpo", () => {
    const eventos = parseWebhookEventos({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "573", id: "wamid.IMG", timestamp: "1700000001", type: "image" },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(eventos.mensajes[0].tipo).toBe("otro");
    expect(eventos.mensajes[0].cuerpo).toBeNull();
  });

  it("normaliza statuses accionables y descarta los que no reconoce", () => {
    const eventos = parseWebhookEventos({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.OUT1", status: "delivered", timestamp: "1700000002", recipient_id: "573" },
                  { id: "wamid.OUT2", status: "deleted", timestamp: "1700000003" }, // no accionable
                ],
              },
            },
          ],
        },
      ],
    });
    expect(eventos.statuses).toEqual([
      {
        waMessageId: "wamid.OUT1",
        estado: "delivered",
        ocurridoAt: new Date(1700000002 * 1000),
        // Un status sano no trae `errors`: el motivo normaliza a null.
        error: null,
      },
    ]);
  });

  it("lanza ante un payload sin `entry` (forma no valida de Meta)", () => {
    expect(() => parseWebhookEventos({ foo: "bar" })).toThrow();
  });
});
