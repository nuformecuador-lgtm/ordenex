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

  // Feature 311 (R3): un `image` SIN el sub-objeto `image` (o sin `id` dentro) no tiene binario
  // que bajar, asi que sigue degradando a `otro`. Este test es de la 109 y se CONSERVA: es la
  // garantia de que la 311 no convirtio la degradacion en una burbuja de imagen rota.
  it("un mensaje de media sin identificador utilizable degrada a 'otro' sin cuerpo (R3)", () => {
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

// ---------------------------------------------------------------------------
// Feature 311 — B2.T. Los ocho tipos entrantes nuevos: media, reaccion, contactos y el cambio
// de numero del cliente. Regla comun a TODOS: nada lanza y nada rompe el lote; lo que no trae
// el dato esencial DEGRADA a `otro` (R3/R6/R8/R10/R11).
// ---------------------------------------------------------------------------

/** Envuelve una lista de mensajes crudos de Meta en la forma del webhook. */
function payloadConMensajes(...mensajes: Record<string, unknown>[]) {
  return { entry: [{ changes: [{ value: { messages: mensajes } }] }] };
}

const BASE = { from: "50688887777", timestamp: "1700000000" };

describe("Feature 311 · media entrante (R1/R2/R3)", () => {
  const CASOS = [
    { metaType: "image", tipo: "imagen", mime: "image/jpeg" },
    { metaType: "audio", tipo: "audio", mime: "audio/ogg" },
    { metaType: "video", tipo: "video", mime: "video/mp4" },
    { metaType: "document", tipo: "documento", mime: "application/pdf" },
    { metaType: "sticker", tipo: "sticker", mime: "image/webp" },
  ] as const;

  it.each(CASOS)(
    "R1: $metaType se normaliza a $tipo conservando media id y mime",
    ({ metaType, tipo, mime }) => {
      const eventos = parseWebhookEventos(
        payloadConMensajes({
          ...BASE,
          id: `wamid.${metaType}`,
          type: metaType,
          [metaType]: { id: "MEDIA-123", mime_type: mime, sha256: "xx" }, // sha256 se strip-ea
        }),
      );

      const m = eventos.mensajes[0];
      expect(m.tipo).toBe(tipo);
      expect(m.media).toEqual({
        mediaId: "MEDIA-123",
        mediaMime: mime,
        mediaNombre: null,
        mediaTamanoBytes: null,
      });
    },
  );

  it("R1: un documento conserva el nombre de archivo que manda Meta", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.DOC",
        type: "document",
        document: { id: "MEDIA-DOC", mime_type: "application/pdf", filename: "factura.pdf" },
      }),
    );
    expect(eventos.mensajes[0].media?.mediaNombre).toBe("factura.pdf");
  });

  it("R2: el caption de una imagen se conserva como cuerpo del mensaje", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.IMGCAP",
        type: "image",
        image: { id: "MEDIA-1", caption: "Aqui esta la casa" },
      }),
    );
    expect(eventos.mensajes[0].cuerpo).toBe("Aqui esta la casa");
  });

  it("R2: sin caption el cuerpo es null y el mensaje se registra igual", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({ ...BASE, id: "wamid.IMG2", type: "image", image: { id: "MEDIA-2" } }),
    );
    expect(eventos.mensajes).toHaveLength(1);
    expect(eventos.mensajes[0].tipo).toBe("imagen");
    expect(eventos.mensajes[0].cuerpo).toBeNull();
  });

  it("R3: media con id vacio degrada a `otro` sin media y sin lanzar", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({ ...BASE, id: "wamid.IMG3", type: "image", image: { id: "" } }),
    );
    expect(eventos.mensajes[0].tipo).toBe("otro");
    expect(eventos.mensajes[0].media).toBeUndefined();
  });

  it("R3: un tipo inesperado dentro del sub-objeto NO tumba el resto del lote", () => {
    // `image` con forma basura: `.catch(undefined)` lo degrada a "sin media" y el mensaje
    // siguiente del MISMO lote sigue llegando entero (esa es la razon del `.catch`).
    const eventos = parseWebhookEventos(
      payloadConMensajes(
        { ...BASE, id: "wamid.ROTO", type: "image", image: "esto-no-es-un-objeto" },
        { ...BASE, id: "wamid.SANO", type: "text", text: { body: "sigo aqui" } },
      ),
    );
    expect(eventos.mensajes).toHaveLength(2);
    expect(eventos.mensajes[0].tipo).toBe("otro");
    expect(eventos.mensajes[1].cuerpo).toBe("sigo aqui");
  });
});

describe("Feature 311 · reacciones (R4/R5/R6)", () => {
  it("R4: una reaction con message_id y emoji conserva objetivo y emoji", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.REACT",
        type: "reaction",
        reaction: { message_id: "wamid.OBJETIVO", emoji: "❤️" },
      }),
    );
    expect(eventos.mensajes[0].tipo).toBe("reaccion");
    expect(eventos.mensajes[0].reaccion).toEqual({
      objetivoWaMessageId: "wamid.OBJETIVO",
      emoji: "❤️",
    });
  });

  it("R5: emoji vacio = reaccion RETIRADA (emoji null), no emoji vacio", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.RETIRO",
        type: "reaction",
        reaction: { message_id: "wamid.OBJETIVO", emoji: "" },
      }),
    );
    expect(eventos.mensajes[0].tipo).toBe("reaccion");
    expect(eventos.mensajes[0].reaccion).toEqual({
      objetivoWaMessageId: "wamid.OBJETIVO",
      emoji: null,
    });
  });

  it("R5: emoji ausente tambien es retirada", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.RETIRO2",
        type: "reaction",
        reaction: { message_id: "wamid.OBJETIVO" },
      }),
    );
    expect(eventos.mensajes[0].reaccion?.emoji).toBeNull();
  });

  it("R6: reaction sin message_id degrada a `otro` sin lanzar", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.SINOBJ",
        type: "reaction",
        reaction: { emoji: "👍" },
      }),
    );
    expect(eventos.mensajes[0].tipo).toBe("otro");
    expect(eventos.mensajes[0].reaccion).toBeUndefined();
  });
});

describe("Feature 311 · contactos (R7/R8)", () => {
  it("R7: normaliza nombre, telefonos y correos y DESCARTA lo no declarado", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.CONTACT",
        type: "contacts",
        contacts: [
          {
            name: { formatted_name: "Ana Perez", first_name: "Ana" },
            phones: [{ phone: "+506 8888-1111", type: "CELL", wa_id: "50688881111" }],
            emails: [{ email: "ana@example.com", type: "WORK" }],
            addresses: [{ street: "Calle 1", city: "San Jose", country: "Costa Rica" }],
            org: { company: "Acme", department: "Ventas" },
            urls: [{ url: "https://acme.test" }],
            birthday: "1990-01-01", // NO declarado -> strip
          },
        ],
      }),
    );

    const m = eventos.mensajes[0];
    expect(m.tipo).toBe("contactos");
    expect(m.contactos).toEqual([
      {
        nombre: "Ana Perez",
        telefonos: [{ valor: "+506 8888-1111", tipo: "CELL" }],
        correos: [{ valor: "ana@example.com", tipo: "WORK" }],
        direcciones: ["Calle 1, San Jose, Costa Rica"],
        organizacion: "Acme",
        urls: ["https://acme.test"],
      },
    ]);
    // El campo no declarado no sobrevive en ninguna parte del tipo de dominio.
    expect(JSON.stringify(m)).not.toContain("1990-01-01");
    expect(JSON.stringify(m)).not.toContain("department");
  });

  it("R8: contacts vacio degrada a `otro` sin lanzar", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({ ...BASE, id: "wamid.C0", type: "contacts", contacts: [] }),
    );
    expect(eventos.mensajes[0].tipo).toBe("otro");
    expect(eventos.mensajes[0].contactos).toBeUndefined();
  });

  it("R8: contacts no parseable degrada a `otro` sin lanzar", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({ ...BASE, id: "wamid.C1", type: "contacts", contacts: "no-es-lista" }),
    );
    expect(eventos.mensajes[0].tipo).toBe("otro");
  });

  it("R8: una lista cuyos contactos no traen NINGUN dato utilizable degrada a `otro`", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.C2",
        type: "contacts",
        contacts: [{ name: {}, phones: [] }],
      }),
    );
    expect(eventos.mensajes[0].tipo).toBe("otro");
  });
});

describe("Feature 311 · cambio de numero del cliente (R9/R10)", () => {
  // LOS TRES NOMBRES SON EL PUNTO. La Cloud API ha usado los tres para el mismo evento y el
  // repo apunta a v21.0 (`lib/config/whatsapp.ts`), donde NO se llama `user_changed_number`:
  // casar solo contra ese literal dejaria R9 muerto en silencio en la version que corremos.
  const SUBTIPOS = [
    "user_changed_number",
    "customer_changed_number",
    "customer_identity_changed",
  ] as const;

  it.each(SUBTIPOS)("R9: `%s` normaliza el numero anterior y el nuevo", (subtipo) => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        from: "50688887777",
        timestamp: "1700000000",
        id: `wamid.SYS-${subtipo}`,
        type: "system",
        system: { type: subtipo, body: "El cliente cambio de numero", wa_id: "50699996666" },
      }),
    );

    const m = eventos.mensajes[0];
    expect(m.tipo).toBe("sistema");
    expect(m.sistema).toEqual({
      telefonoAnterior: "50688887777",
      telefonoNuevo: "50699996666",
    });
  });

  it("R9: si no viene `wa_id`, cae a `new_wa_id` y luego a `customer` (P1)", () => {
    const conNew = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.SYS-NEW",
        type: "system",
        system: { type: "customer_changed_number", new_wa_id: "50611112222" },
      }),
    );
    expect(conNew.mensajes[0].sistema?.telefonoNuevo).toBe("50611112222");

    const conCustomer = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.SYS-CUST",
        type: "system",
        system: { type: "customer_changed_number", customer: "50633334444" },
      }),
    );
    expect(conCustomer.mensajes[0].sistema?.telefonoNuevo).toBe("50633334444");
  });

  it("R10: system sin numero nuevo degrada, no inventa numeros y no lanza", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.SYS-SIN",
        type: "system",
        system: { type: "customer_changed_number", body: "algo paso" },
      }),
    );
    expect(eventos.mensajes[0].tipo).toBe("otro");
    expect(eventos.mensajes[0].sistema).toBeUndefined();
  });

  it("R10: un subtipo de system fuera de alcance degrada a `otro`", () => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: "wamid.SYS-OTRO",
        type: "system",
        system: { type: "customer_identity_unverified", wa_id: "50699996666" },
      }),
    );
    expect(eventos.mensajes[0].tipo).toBe("otro");
    expect(eventos.mensajes[0].sistema).toBeUndefined();
  });
});

describe("Feature 311 · tipos fuera de alcance y desconocidos (R11)", () => {
  const FUERA_DE_ALCANCE = [
    "button",
    "interactive",
    "order",
    "request_welcome",
    "ephemeral",
    "un_tipo_que_meta_aun_no_ha_inventado",
  ] as const;

  it.each(FUERA_DE_ALCANCE)("`%s` se registra como `otro` sin lanzar", (type) => {
    const eventos = parseWebhookEventos(
      payloadConMensajes({
        ...BASE,
        id: `wamid.${type}`,
        type,
        // Campos que el sistema NO declara: deben desaparecer por strip.
        payload_desconocido: { secreto: "no debe sobrevivir" },
      }),
    );
    const m = eventos.mensajes[0];
    expect(m.tipo).toBe("otro");
    expect(JSON.stringify(m)).not.toContain("no debe sobrevivir");
  });
});
