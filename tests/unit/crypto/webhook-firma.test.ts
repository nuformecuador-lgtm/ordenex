import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  firmarWebhook,
  cabecerasFirma,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@/lib/crypto/webhook-firma";

// Feature 99 (R18) — la firma es HMAC-SHA256 determinista sobre `${timestamp}.${cuerpo}` y
// cambia si cualquiera cambia. El secreto nunca aparece en la salida.

const SECRET = "ordx_whsec_secreto-de-prueba";
const CUERPO = JSON.stringify({ evento: "orden.estado_actualizado", eventoId: "e1" });
const TS = 1_700_000_000;

describe("R18 — firma HMAC-SHA256 determinista sobre timestamp + cuerpo", () => {
  it("coincide con el HMAC-SHA256 hex de `${timestamp}.${cuerpo}`", () => {
    const esperado = createHmac("sha256", SECRET).update(`${TS}.${CUERPO}`).digest("hex");
    expect(firmarWebhook(SECRET, TS, CUERPO)).toBe(esperado);
  });

  it("es determinista: misma entrada -> misma firma", () => {
    expect(firmarWebhook(SECRET, TS, CUERPO)).toBe(firmarWebhook(SECRET, TS, CUERPO));
  });

  it("cambia si cambia el cuerpo", () => {
    expect(firmarWebhook(SECRET, TS, CUERPO)).not.toBe(firmarWebhook(SECRET, TS, CUERPO + " "));
  });

  it("cambia si cambia el timestamp (anti-replay ligado a la firma)", () => {
    expect(firmarWebhook(SECRET, TS, CUERPO)).not.toBe(firmarWebhook(SECRET, TS + 1, CUERPO));
  });

  it("cambia si cambia el secreto", () => {
    expect(firmarWebhook(SECRET, TS, CUERPO)).not.toBe(firmarWebhook(SECRET + "x", TS, CUERPO));
  });

  it("el secreto NUNCA aparece en la firma ni en las cabeceras", () => {
    const firma = firmarWebhook(SECRET, TS, CUERPO);
    expect(firma).not.toContain(SECRET);
    const headers = cabecerasFirma(SECRET, TS, CUERPO);
    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toBe(`sha256=${firma}`);
    expect(headers[WEBHOOK_TIMESTAMP_HEADER]).toBe(String(TS));
    expect(JSON.stringify(headers)).not.toContain(SECRET);
  });
});
