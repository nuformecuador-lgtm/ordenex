import { describe, it, expect } from "vitest";
import { ensureCargaEnTx, type CargaTxClient } from "@/lib/repositories/carga-lote";
import {
  CargaLoteAjenoError,
  CargaNombreDuplicadoError,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import { buildCargaDelegate, errorNombreDuplicado } from "@/tests/fixtures/carga-lote";

// Feature 141 (T18) — helper transaccional del LOTE, con sus DOS ramas excluyentes. Cubre:
//   R15/R16 — el id lo genera el SERVIDOR; ningun valor entrante puede ser el id de una fila
//             nueva (la rama de creacion solo existe con `id === null`).
//   R17     — con token previo se REUTILIZA la fila (solo lectura), sin insertar.
//   R19     — token desconocido o de otro usuario -> CargaLoteAjenoError (403 en el borde).
//   R21/R22 — `name` se persiste al crear; sin nombre queda NULL.
//   R23/R29 — al reutilizar no se reescriben `name` ni `total_files`.
//   R24/R25 — nombre repetido del MISMO usuario -> CargaNombreDuplicadoError; de otro usuario, no.
//   R40     — la fila nace sin `download_url`.
// El `tx` es un doble en memoria del delegate `carga`.

const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tx(delegate: ReturnType<typeof buildCargaDelegate>): CargaTxClient {
  return { carga: delegate } as unknown as CargaTxClient;
}

describe("ensureCargaEnTx — CREACION: el id lo genera el servidor (R15/R16)", () => {
  it("con `id: null` crea la fila con un UUID propio, el actor y el total del lote", async () => {
    const carga = buildCargaDelegate();

    const id = await ensureCargaEnTx(tx(carga), {
      id: null,
      usuarioCargaId: "tienda-1",
      totalFiles: 500,
    });

    expect(id).toMatch(UUID_RE);
    expect(carga.filas.get(id)).toMatchObject({ usuarioCarga: "tienda-1", totalFiles: 500 });
    // El id NO viene del llamador: lo pone el helper en el `create`.
    expect(carga.create.mock.calls[0][0].data.id).toBe(id);
  });

  it("R15: dos creaciones seguidas producen ids DISTINTOS (ninguno es un valor entrante)", async () => {
    const carga = buildCargaDelegate();
    const base = { id: null, usuarioCargaId: "tienda-1", totalFiles: 1 };

    const primero = await ensureCargaEnTx(tx(carga), base);
    const segundo = await ensureCargaEnTx(tx(carga), base);

    expect(primero).not.toBe(segundo);
    expect(carga.filas.size).toBe(2);
  });

  it("R21: persiste el `name` recibido al crear el lote", async () => {
    const carga = buildCargaDelegate();

    const id = await ensureCargaEnTx(tx(carga), {
      id: null,
      usuarioCargaId: "tienda-1",
      totalFiles: 3,
      name: "carga de enero",
    });

    expect(carga.filas.get(id)?.name).toBe("carga de enero");
  });

  it("R22: sin `name` la fila nace con NULL", async () => {
    const carga = buildCargaDelegate();

    const id = await ensureCargaEnTx(tx(carga), {
      id: null,
      usuarioCargaId: "tienda-1",
      totalFiles: 3,
    });

    expect(carga.filas.get(id)?.name).toBeNull();
    expect(carga.create.mock.calls[0][0].data.name).toBeNull();
  });

  it("R40: la fila nace SIN download_url (solo la escribe despues la via API key)", async () => {
    const carga = buildCargaDelegate();

    const id = await ensureCargaEnTx(tx(carga), {
      id: null,
      usuarioCargaId: "tienda-1",
      totalFiles: 3,
    });

    expect(carga.create.mock.calls[0][0].data).not.toHaveProperty("downloadUrl");
    expect(carga.filas.get(id)?.downloadUrl).toBeNull();
  });
});

describe("ensureCargaEnTx — REUTILIZACION: solo lectura (R17/R23)", () => {
  it("R17: con un token propio devuelve el mismo id SIN insertar nada", async () => {
    const carga = buildCargaDelegate([
      { id: TOKEN, usuarioCarga: "tienda-1", name: "enero", totalFiles: 500, downloadUrl: null },
    ]);

    const id = await ensureCargaEnTx(tx(carga), {
      id: TOKEN,
      usuarioCargaId: "tienda-1",
      totalFiles: 2,
      name: "otro nombre",
    });

    expect(id).toBe(TOKEN);
    expect(carga.create).not.toHaveBeenCalled();
    expect(carga.filas.size).toBe(1);
  });

  it("R23/R29: al reutilizar NO se reescriben `name` ni `total_files`", async () => {
    const carga = buildCargaDelegate([
      { id: TOKEN, usuarioCarga: "tienda-1", name: "enero", totalFiles: 500, downloadUrl: null },
    ]);

    await ensureCargaEnTx(tx(carga), {
      id: TOKEN,
      usuarioCargaId: "tienda-1",
      totalFiles: 200, // el tamaño del chunk: NO debe degradar el total de la sesion
      name: "febrero",
    });

    expect(carga.filas.get(TOKEN)).toMatchObject({ name: "enero", totalFiles: 500 });
    expect(carga.update).not.toHaveBeenCalled();
  });

  it("R26: N chunks de la misma sesion comparten UNA sola fila", async () => {
    const carga = buildCargaDelegate();
    const id = await ensureCargaEnTx(tx(carga), {
      id: null,
      usuarioCargaId: "tienda-1",
      totalFiles: 500,
    });

    for (let i = 0; i < 3; i += 1) {
      const reutilizado = await ensureCargaEnTx(tx(carga), {
        id,
        usuarioCargaId: "tienda-1",
        totalFiles: 500,
      });
      expect(reutilizado).toBe(id);
    }

    expect(carga.filas.size).toBe(1);
    expect(carga.create).toHaveBeenCalledTimes(1);
  });
});

describe("ensureCargaEnTx — token invalido (R19)", () => {
  it("token DESCONOCIDO -> CargaLoteAjenoError y no crea ninguna fila con ese id", async () => {
    const carga = buildCargaDelegate();

    await expect(
      ensureCargaEnTx(tx(carga), { id: TOKEN, usuarioCargaId: "tienda-1", totalFiles: 1 }),
    ).rejects.toBeInstanceOf(CargaLoteAjenoError);
    expect(carga.create).not.toHaveBeenCalled();
    expect(carga.filas.has(TOKEN)).toBe(false);
  });

  it("token de OTRO usuario -> CargaLoteAjenoError sin modificar el lote ajeno", async () => {
    const carga = buildCargaDelegate([
      { id: TOKEN, usuarioCarga: "otra-tienda", name: null, totalFiles: 10, downloadUrl: null },
    ]);

    await expect(
      ensureCargaEnTx(tx(carga), { id: TOKEN, usuarioCargaId: "tienda-1", totalFiles: 500 }),
    ).rejects.toBeInstanceOf(CargaLoteAjenoError);
    expect(carga.filas.get(TOKEN)).toMatchObject({ usuarioCarga: "otra-tienda", totalFiles: 10 });
    expect(carga.create).not.toHaveBeenCalled();
  });
});

describe("ensureCargaEnTx — nombre duplicado (R24/R25/R10)", () => {
  it("R24: el MISMO usuario repitiendo nombre -> CargaNombreDuplicadoError con el nombre", async () => {
    const carga = buildCargaDelegate([
      { id: "otro", usuarioCarga: "tienda-1", name: "enero", totalFiles: 5, downloadUrl: null },
    ]);

    await expect(
      ensureCargaEnTx(tx(carga), {
        id: null,
        usuarioCargaId: "tienda-1",
        totalFiles: 3,
        name: "enero",
      }),
    ).rejects.toBeInstanceOf(CargaNombreDuplicadoError);
    await expect(
      ensureCargaEnTx(tx(carga), {
        id: null,
        usuarioCargaId: "tienda-1",
        totalFiles: 3,
        name: "enero",
      }),
    ).rejects.toThrow("enero");
    expect(carga.filas.size).toBe(1); // no queda ninguna fila nueva
  });

  it("R25: OTRO usuario con el mismo nombre SI puede crear su lote", async () => {
    const carga = buildCargaDelegate([
      { id: "otro", usuarioCarga: "tienda-1", name: "enero", totalFiles: 5, downloadUrl: null },
    ]);

    const id = await ensureCargaEnTx(tx(carga), {
      id: null,
      usuarioCargaId: "tienda-2",
      totalFiles: 3,
      name: "enero",
    });

    expect(carga.filas.get(id)).toMatchObject({ usuarioCarga: "tienda-2", name: "enero" });
  });

  it("R10: varios lotes SIN nombre del mismo usuario conviven", async () => {
    const carga = buildCargaDelegate();
    const base = { id: null, usuarioCargaId: "tienda-1", totalFiles: 1 };

    await ensureCargaEnTx(tx(carga), base);
    await ensureCargaEnTx(tx(carga), base);

    expect(carga.filas.size).toBe(2);
  });

  it("traduce el P2002 de Prisma sobre (usuario_carga, name) a CargaNombreDuplicadoError", async () => {
    const carga = buildCargaDelegate();
    carga.create.mockRejectedValueOnce(errorNombreDuplicado());

    await expect(
      ensureCargaEnTx(tx(carga), {
        id: null,
        usuarioCargaId: "tienda-1",
        totalFiles: 1,
        name: "enero",
      }),
    ).rejects.toBeInstanceOf(CargaNombreDuplicadoError);
  });

  it("un error que NO es de unicidad se propaga tal cual (no se disfraza de 409)", async () => {
    const carga = buildCargaDelegate();
    carga.create.mockRejectedValueOnce(new Error("conexion caida"));

    await expect(
      ensureCargaEnTx(tx(carga), {
        id: null,
        usuarioCargaId: "tienda-1",
        totalFiles: 1,
        name: "enero",
      }),
    ).rejects.toThrow("conexion caida");
  });
});
