import { describe, it, expect } from "vitest";
import { ensureCargaEnTx, type CargaTxClient } from "@/lib/repositories/carga-lote";
import { CargaLoteAjenoError } from "@/lib/interfaces/repositories/IOrdenRepository";
import { buildCargaDelegate } from "@/tests/fixtures/carga-lote";

// Feature 141 (T4) — helper transaccional del LOTE. Cubre:
//   R12/R13 — un lote por sesion: el segundo chunk REUTILIZA la fila existente.
//   R17     — lote de OTRO usuario -> CargaLoteAjenoError (el borde lo traduce a 403).
//   R18     — `total_files` no se acumula ni se reescribe entre chunks.
//   R29     — la fila nace SIN `download_url` (ninguna ruta de esta feature la escribe).
// El `tx` es un doble en memoria del delegate `carga` que honra ON CONFLICT DO NOTHING.

const UUID_SESION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function tx(delegate: ReturnType<typeof buildCargaDelegate>): CargaTxClient {
  return { carga: delegate } as unknown as CargaTxClient;
}

describe("ensureCargaEnTx — creacion del lote (R12)", () => {
  it("crea la fila con el id propuesto, el actor de la carga y el total del lote", async () => {
    const carga = buildCargaDelegate();

    const id = await ensureCargaEnTx(tx(carga), {
      id: UUID_SESION,
      usuarioCargaId: "tienda-1",
      totalFiles: 500,
    });

    expect(id).toBe(UUID_SESION);
    expect(carga.filas.get(UUID_SESION)).toMatchObject({
      usuarioCarga: "tienda-1",
      totalFiles: 500,
    });
    // El INSERT es idempotente por construccion (ON CONFLICT DO NOTHING).
    expect(carga.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it("R29: la fila nace SIN download_url (nadie la escribe en esta feature)", async () => {
    const carga = buildCargaDelegate();

    await ensureCargaEnTx(tx(carga), { id: null, usuarioCargaId: "tienda-1", totalFiles: 3 });

    const data = carga.createMany.mock.calls[0][0].data[0];
    expect(data).not.toHaveProperty("downloadUrl");
    expect([...carga.filas.values()][0].downloadUrl).toBeNull();
  });

  it("genera un UUID cuando el id entrante es null (via API key)", async () => {
    const carga = buildCargaDelegate();

    const id = await ensureCargaEnTx(tx(carga), {
      id: null,
      usuarioCargaId: "key-user-1",
      totalFiles: 2,
    });

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(carga.filas.get(id)).toMatchObject({ usuarioCarga: "key-user-1", totalFiles: 2 });
  });
});

describe("ensureCargaEnTx — idempotencia entre chunks (R13/R18)", () => {
  it("R13: el segundo chunk con el MISMO id no crea una fila nueva", async () => {
    const carga = buildCargaDelegate();
    const params = { id: UUID_SESION, usuarioCargaId: "tienda-1", totalFiles: 500 };

    const primero = await ensureCargaEnTx(tx(carga), params);
    const segundo = await ensureCargaEnTx(tx(carga), params);
    const tercero = await ensureCargaEnTx(tx(carga), params);

    expect([primero, segundo, tercero]).toEqual([UUID_SESION, UUID_SESION, UUID_SESION]);
    expect(carga.filas.size).toBe(1);
  });

  it("R18: total_files NO se acumula ni se reescribe aunque lleguen N chunks", async () => {
    const carga = buildCargaDelegate();
    // Los 3 chunks declaran el MISMO total de la sesion (500), no el suyo (200/200/100).
    for (let i = 0; i < 3; i += 1) {
      await ensureCargaEnTx(tx(carga), {
        id: UUID_SESION,
        usuarioCargaId: "tienda-1",
        totalFiles: 500,
      });
    }

    expect(carga.filas.get(UUID_SESION)?.totalFiles).toBe(500);
  });

  it("R18: un chunk que llegara con el total del CHUNK no degrada el valor ya escrito", async () => {
    const carga = buildCargaDelegate();
    await ensureCargaEnTx(tx(carga), { id: UUID_SESION, usuarioCargaId: "t1", totalFiles: 500 });

    await ensureCargaEnTx(tx(carga), { id: UUID_SESION, usuarioCargaId: "t1", totalFiles: 200 });

    expect(carga.filas.get(UUID_SESION)?.totalFiles).toBe(500);
  });
});

describe("ensureCargaEnTx — propietario del lote (R17)", () => {
  it("lanza CargaLoteAjenoError si el lote existente es de otro usuario", async () => {
    const carga = buildCargaDelegate([
      { id: UUID_SESION, usuarioCarga: "otra-tienda", totalFiles: 10, downloadUrl: null },
    ]);

    await expect(
      ensureCargaEnTx(tx(carga), {
        id: UUID_SESION,
        usuarioCargaId: "tienda-1",
        totalFiles: 500,
      }),
    ).rejects.toBeInstanceOf(CargaLoteAjenoError);
    // El lote ajeno NO se modifica.
    expect(carga.filas.get(UUID_SESION)).toMatchObject({
      usuarioCarga: "otra-tienda",
      totalFiles: 10,
    });
  });

  it("el propio dueño reutiliza su lote sin error", async () => {
    const carga = buildCargaDelegate([
      { id: UUID_SESION, usuarioCarga: "tienda-1", totalFiles: 500, downloadUrl: null },
    ]);

    const id = await ensureCargaEnTx(tx(carga), {
      id: UUID_SESION,
      usuarioCargaId: "tienda-1",
      totalFiles: 500,
    });

    expect(id).toBe(UUID_SESION);
  });
});
