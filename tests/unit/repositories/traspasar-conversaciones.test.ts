import { describe, it, expect, vi } from "vitest";

import {
  traspasarConversaciones,
  type TraspasarConversacionesTxClient,
} from "@/lib/repositories/traspasar-conversaciones";

// FICHA 427 (T7, design §6.3) — EL CHOKE POINT DEL CHAT, medido por la SENTENCIA que emite.
//
// POR QUE ESTO Y NO SOLO EL TEST DE INTEGRACION: el de integracion (T9.3) comprueba el EFECTO
// —quien queda como dueno del hilo, que `mensajero_leido_at` queda en NULL y que
// `ultimo_entrante_at` no se toca—, que es lo que importa. Este mira la FORMA de la sentencia, y
// cubre lo que un efecto no puede cubrir: que el `SET` **no mencione** una columna. Una columna que
// se escribe con su mismo valor deja el mismo efecto que no escribirla, asi que «no la toca» solo
// se puede afirmar leyendo el SQL.
//
// Se captura el template TAL Y COMO SE EMITE (no un literal copiado a mano): el doble recibe el
// `TemplateStringsArray` de `$queryRaw` y lo reconstituye.

/** Doble que captura la sentencia y sus parametros, sin base. */
function txEspia(filas: { id: string }[] = []) {
  const capturado: { sql: string; params: unknown[] }[] = [];
  const tx = {
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      capturado.push({ sql: strings.join("?"), params: values });
      return Promise.resolve(filas);
    }),
  } as unknown as TraspasarConversacionesTxClient;
  return { tx, capturado };
}

/** El `SET` de la sentencia: de `SET` al primer `WHERE`. */
function setDe(sql: string): string {
  const desde = sql.indexOf("SET");
  const hasta = sql.indexOf("WHERE");
  expect(desde, "la sentencia no tiene SET").toBeGreaterThan(-1);
  expect(hasta, "la sentencia no tiene WHERE").toBeGreaterThan(desde);
  return sql.slice(desde, hasta);
}

describe("427/R18 — el UPDATE va por `orden_id IN (...)`, no por conversacion", () => {
  it("⭑ el `WHERE` filtra por `orden_id IN`, con TODAS las ordenes del lote", async () => {
    // TODAS las conversaciones de esas ordenes, no una por orden: el unico de `chat_conversacion`
    // es `(orden_id, telefono_e164)`, asi que una orden puede tener MAS DE UN hilo.
    const { tx, capturado } = txEspia([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);

    const movidas = await traspasarConversaciones(tx, ["o-1", "o-2"], "u-destino");

    expect(capturado).toHaveLength(1);
    expect(capturado[0].sql).toMatch(/UPDATE\s+"chat_conversacion"/);
    expect(capturado[0].sql).toMatch(/WHERE\s+"orden_id"\s+IN\s*\(/);
    // Tres hilos para dos ordenes: la cifra sale del `RETURNING`, no de `ordenIds.length`.
    expect(movidas).toBe(3);
  });

  it("⭑ el `SET` pone el destino y deja `mensajero_leido_at` en NULL (R19)", async () => {
    const { tx, capturado } = txEspia([{ id: "c1" }]);
    await traspasarConversaciones(tx, ["o-1"], "u-destino");
    const set = setDe(capturado[0].sql);
    expect(set).toMatch(/"mensajero_id"\s*=/);
    expect(set).toMatch(/"mensajero_leido_at"\s*=\s*NULL/i);
    expect(set).toMatch(/"updated_at"\s*=\s*NOW\(\)/i);
    // El destino viaja como PARAMETRO, no interpolado en el texto.
    expect(capturado[0].params).toContain("u-destino");
  });

  it("⭑⭑ el `SET` NO menciona `ultimo_entrante_at`: es la ventana de 24 h del destino", async () => {
    // Es del HILO y del CLIENTE, no del mensajero. Es lo que mantiene abierta la ventana para el
    // destino, que es la MITAD del valor de mover el hilo: sin ella solo podria mandar plantilla.
    const { tx, capturado } = txEspia([{ id: "c1" }]);
    await traspasarConversaciones(tx, ["o-1"], "u-destino");
    expect(setDe(capturado[0].sql)).not.toMatch(/ultimo_entrante_at/);
  });

  it("⭑ el `SET` NO menciona `telefono_e164` ni escribe en `orden`", async () => {
    // Misma frontera que `migrarTelefono`: este UPDATE escribe SOLO en `chat_conversacion`.
    const { tx, capturado } = txEspia([{ id: "c1" }]);
    await traspasarConversaciones(tx, ["o-1"], "u-destino");
    expect(setDe(capturado[0].sql)).not.toMatch(/telefono_e164/);
    expect(capturado[0].sql).not.toMatch(/UPDATE\s+"orden"/);
  });

  it("CONTRAPRUEBA: el extractor del `SET` SI ve una columna cuando esta", () => {
    // Sin esto, los dos `not.toMatch` de arriba pasarian aunque el extractor mirara vacio.
    const mutado = `UPDATE "chat_conversacion" SET "mensajero_id" = ?, "ultimo_entrante_at" = NULL WHERE "orden_id" IN (?)`;
    expect(setDe(mutado)).toMatch(/ultimo_entrante_at/);
  });

  it("NO-OP con lista vacia: ni una sentencia (un `IN ()` no es SQL valido)", async () => {
    const { tx, capturado } = txEspia();
    expect(await traspasarConversaciones(tx, [], "u-destino")).toBe(0);
    expect(capturado).toHaveLength(0);
  });

  it("una orden SIN hilos devuelve 0, y eso no es un error", async () => {
    const { tx } = txEspia([]);
    expect(await traspasarConversaciones(tx, ["o-1"], "u-destino")).toBe(0);
  });
});
