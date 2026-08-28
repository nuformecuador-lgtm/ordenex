import { describe, it, expect } from "vitest";
import { agregarReacciones, type MensajeConReaccion } from "@/lib/utils/chat-reacciones";

// Feature 311 — E1.T (R19/R20). La reaccion PERTENECE al mensaje al que reacciona (D4). Estos
// tests fijan las cuatro reglas del agregado: sale de las burbujas, se cuelga del objetivo, la
// ultima del mismo autor gana, y una RETIRADA deja el mensaje sin reaccion.

const T0 = new Date("2026-08-27T10:00:00.000Z");
const T1 = new Date("2026-08-27T10:01:00.000Z");
const T2 = new Date("2026-08-27T10:02:00.000Z");

function mensaje(over: Partial<MensajeConReaccion> & { waMessageId: string }): MensajeConReaccion {
  return {
    direccion: "entrante",
    tipo: "texto",
    reaccionAWaMessageId: null,
    reaccionEmoji: null,
    ocurridoAt: T0,
    ...over,
  };
}

function reaccion(
  objetivo: string,
  emoji: string | null,
  ocurridoAt: Date,
  direccion: MensajeConReaccion["direccion"] = "entrante",
): MensajeConReaccion {
  return {
    waMessageId: `wamid.R-${emoji ?? "retiro"}-${ocurridoAt.getTime()}-${direccion}`,
    direccion,
    tipo: "reaccion",
    reaccionAWaMessageId: objetivo,
    reaccionEmoji: emoji,
    ocurridoAt,
  };
}

describe("agregarReacciones (R19)", () => {
  it("saca las filas `reaccion` del hilo y las cuelga del mensaje objetivo", () => {
    const objetivo = mensaje({ waMessageId: "wamid.OBJ" });
    const { burbujas, reaccionesPorWaMessageId } = agregarReacciones([
      objetivo,
      reaccion("wamid.OBJ", "👍", T1),
    ]);

    // NO hay burbuja suelta para la reaccion: el hilo conserva UNA sola burbuja (D4/R30).
    expect(burbujas).toHaveLength(1);
    expect(burbujas[0].waMessageId).toBe("wamid.OBJ");
    expect(reaccionesPorWaMessageId.get("wamid.OBJ")).toEqual([{ emoji: "👍", conteo: 1 }]);
  });

  it("una reaccion a un mensaje AUSENTE del hilo se descarta sin burbuja huerfana", () => {
    const { burbujas, reaccionesPorWaMessageId } = agregarReacciones([
      mensaje({ waMessageId: "wamid.OTRO" }),
      reaccion("wamid.NO-ESTA-EN-EL-HILO", "😀", T1),
    ]);

    expect(burbujas).toHaveLength(1);
    expect(reaccionesPorWaMessageId.size).toBe(0);
  });

  it("una reaccion SIN objetivo tampoco produce burbuja", () => {
    const { burbujas } = agregarReacciones([
      mensaje({ waMessageId: "wamid.OBJ" }),
      mensaje({
        waMessageId: "wamid.HUERFANA",
        tipo: "reaccion",
        reaccionAWaMessageId: null,
        reaccionEmoji: "👍",
      }),
    ]);
    expect(burbujas).toHaveLength(1);
  });
});

describe("agregarReacciones — una por autor, la ultima gana (R20)", () => {
  it("el mismo autor reaccionando dos veces deja SOLO la mas reciente", () => {
    const { reaccionesPorWaMessageId } = agregarReacciones([
      mensaje({ waMessageId: "wamid.OBJ" }),
      reaccion("wamid.OBJ", "👍", T1),
      reaccion("wamid.OBJ", "❤️", T2),
    ]);

    expect(reaccionesPorWaMessageId.get("wamid.OBJ")).toEqual([{ emoji: "❤️", conteo: 1 }]);
  });

  it("si la mas reciente es una RETIRADA, el mensaje queda SIN reacciones", () => {
    const { reaccionesPorWaMessageId } = agregarReacciones([
      mensaje({ waMessageId: "wamid.OBJ" }),
      reaccion("wamid.OBJ", "👍", T1),
      reaccion("wamid.OBJ", null, T2), // emoji null = retirada (R5)
    ]);

    expect(reaccionesPorWaMessageId.get("wamid.OBJ")).toBeUndefined();
  });

  it("una retirada seguida de una reaccion nueva vuelve a mostrar la nueva", () => {
    const { reaccionesPorWaMessageId } = agregarReacciones([
      mensaje({ waMessageId: "wamid.OBJ" }),
      reaccion("wamid.OBJ", null, T1),
      reaccion("wamid.OBJ", "😮", T2),
    ]);
    expect(reaccionesPorWaMessageId.get("wamid.OBJ")).toEqual([{ emoji: "😮", conteo: 1 }]);
  });

  it("autores DISTINTOS con el mismo emoji suman conteo, no se pisan (P4)", () => {
    const { reaccionesPorWaMessageId } = agregarReacciones([
      mensaje({ waMessageId: "wamid.OBJ" }),
      reaccion("wamid.OBJ", "👍", T1, "entrante"),
      reaccion("wamid.OBJ", "👍", T2, "saliente"),
    ]);
    expect(reaccionesPorWaMessageId.get("wamid.OBJ")).toEqual([{ emoji: "👍", conteo: 2 }]);
  });

  it("la retirada de UN autor no borra la reaccion viva del otro", () => {
    const { reaccionesPorWaMessageId } = agregarReacciones([
      mensaje({ waMessageId: "wamid.OBJ" }),
      reaccion("wamid.OBJ", "👍", T1, "entrante"),
      reaccion("wamid.OBJ", "❤️", T1, "saliente"),
      reaccion("wamid.OBJ", null, T2, "entrante"),
    ]);
    expect(reaccionesPorWaMessageId.get("wamid.OBJ")).toEqual([{ emoji: "❤️", conteo: 1 }]);
  });
});
