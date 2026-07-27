import { describe, it, expect, vi } from "vitest";
import { EtiquetasDescargaService } from "@/lib/services/EtiquetasDescargaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IEtiquetasLotePdfService } from "@/lib/interfaces/services/IEtiquetasLotePdfService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 141 (T27) — orquestacion de la descarga de etiquetas por modo. Cubre:
//   R47 — `consolidate`: UN PDF y su URL persistida en `carga.download_url`.
//   R48 — `individual`: UN PDF por orden y cada URL en el `orden.download_url` de su orden.
//   R49 — una orden sin etiqueta imprimible no aparece -> su `download_url` queda NULL.
//   R50 — sin ordenes creadas no se toca Storage ni la DB.
//   R51 — los errores se PROPAGAN (el best-effort vive en el borde), sin escribir nada.
//   R53/R54 — forma del resultado: `consolidado` vs `porOrden`, nunca ambos.

const ACTOR: Actor = { usuarioId: "key-user-1", rol: "apiKey" };
const CARGA_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function fakePdf(overrides: Partial<IEtiquetasLotePdfService> = {}): IEtiquetasLotePdfService {
  return {
    generarYAlmacenar: vi.fn(async () => ({
      path: "key-user-1/lote.pdf",
      signedUrl: "https://signed.example/lote.pdf",
      expiraEnSegundos: 3600,
    })),
    generarYAlmacenarPorOrden: vi.fn(async () => [
      {
        ordenId: "ord-1",
        path: "key-user-1/1.pdf",
        signedUrl: "https://signed.example/1.pdf",
        expiraEnSegundos: 3600,
      },
      {
        ordenId: "ord-2",
        path: "key-user-1/2.pdf",
        signedUrl: "https://signed.example/2.pdf",
        expiraEnSegundos: 3600,
      },
    ]),
    ...overrides,
  };
}

/** Doble MINIMO del repositorio: solo los dos metodos de persistencia de URLs. */
function fakeRepo(): IOrdenRepository {
  return {
    setCargaDownloadUrl: vi.fn(async () => {}),
    setOrdenesDownloadUrl: vi.fn(async () => {}),
  } as unknown as IOrdenRepository;
}

describe("EtiquetasDescargaService — modo consolidate (R47/R53)", () => {
  it("R47: genera UN PDF y persiste su URL en carga.download_url", async () => {
    const pdf = fakePdf();
    const repo = fakeRepo();

    const out = await new EtiquetasDescargaService(pdf, repo).generarYPersistir({
      modo: "consolidate",
      cargaId: CARGA_ID,
      ordenIds: ["ord-1", "ord-2"],
      actor: ACTOR,
    });

    expect(pdf.generarYAlmacenar).toHaveBeenCalledWith(["ord-1", "ord-2"], ACTOR);
    expect(repo.setCargaDownloadUrl).toHaveBeenCalledWith(
      CARGA_ID,
      "https://signed.example/lote.pdf",
    );
    expect(out.consolidado).toEqual({
      url: "https://signed.example/lote.pdf",
      expiraEnSegundos: 3600,
    });
    // R47: en consolidate NO se escribe ningun `orden.download_url`.
    expect(repo.setOrdenesDownloadUrl).not.toHaveBeenCalled();
    expect(out.porOrden.size).toBe(0);
    expect(pdf.generarYAlmacenarPorOrden).not.toHaveBeenCalled();
  });

  it("R49: sin etiqueta imprimible (null del generador) no persiste nada y devuelve vacio", async () => {
    const pdf = fakePdf({ generarYAlmacenar: vi.fn(async () => null) });
    const repo = fakeRepo();

    const out = await new EtiquetasDescargaService(pdf, repo).generarYPersistir({
      modo: "consolidate",
      cargaId: CARGA_ID,
      ordenIds: ["ord-1"],
      actor: ACTOR,
    });

    expect(out.consolidado).toBeNull();
    expect(repo.setCargaDownloadUrl).not.toHaveBeenCalled();
  });

  it("sin `cargaId` devuelve la URL pero NO intenta persistirla (no inventa fila)", async () => {
    const pdf = fakePdf();
    const repo = fakeRepo();

    const out = await new EtiquetasDescargaService(pdf, repo).generarYPersistir({
      modo: "consolidate",
      cargaId: null,
      ordenIds: ["ord-1"],
      actor: ACTOR,
    });

    expect(out.consolidado?.url).toBe("https://signed.example/lote.pdf");
    expect(repo.setCargaDownloadUrl).not.toHaveBeenCalled();
  });
});

describe("EtiquetasDescargaService — modo individual (R48/R54)", () => {
  it("R48: genera UN PDF por orden y persiste cada URL en SU orden", async () => {
    const pdf = fakePdf();
    const repo = fakeRepo();

    const out = await new EtiquetasDescargaService(pdf, repo).generarYPersistir({
      modo: "individual",
      cargaId: CARGA_ID,
      ordenIds: ["ord-1", "ord-2"],
      actor: ACTOR,
    });

    expect(pdf.generarYAlmacenarPorOrden).toHaveBeenCalledWith(["ord-1", "ord-2"], ACTOR);
    expect(repo.setOrdenesDownloadUrl).toHaveBeenCalledWith([
      { ordenId: "ord-1", url: "https://signed.example/1.pdf" },
      { ordenId: "ord-2", url: "https://signed.example/2.pdf" },
    ]);
    expect([...out.porOrden.entries()]).toEqual([
      ["ord-1", "https://signed.example/1.pdf"],
      ["ord-2", "https://signed.example/2.pdf"],
    ]);
    // R48: en individual `carga.download_url` queda NULL.
    expect(out.consolidado).toBeNull();
    expect(repo.setCargaDownloadUrl).not.toHaveBeenCalled();
    expect(pdf.generarYAlmacenar).not.toHaveBeenCalled();
  });

  it("R49: la orden sin etiqueta imprimible no recibe URL (su download_url queda NULL)", async () => {
    const pdf = fakePdf({
      generarYAlmacenarPorOrden: vi.fn(async () => [
        {
          ordenId: "ord-1",
          path: "key-user-1/1.pdf",
          signedUrl: "https://signed.example/1.pdf",
          expiraEnSegundos: 3600,
        },
      ]),
    });
    const repo = fakeRepo();

    const out = await new EtiquetasDescargaService(pdf, repo).generarYPersistir({
      modo: "individual",
      cargaId: CARGA_ID,
      ordenIds: ["ord-1", "ord-2"],
      actor: ACTOR,
    });

    expect(out.porOrden.has("ord-2")).toBe(false);
    expect(repo.setOrdenesDownloadUrl).toHaveBeenCalledWith([
      { ordenId: "ord-1", url: "https://signed.example/1.pdf" },
    ]);
  });

  it("ninguna etiqueta generada -> persiste una lista vacia (no-op) y devuelve vacio", async () => {
    const pdf = fakePdf({ generarYAlmacenarPorOrden: vi.fn(async () => []) });
    const repo = fakeRepo();

    const out = await new EtiquetasDescargaService(pdf, repo).generarYPersistir({
      modo: "individual",
      cargaId: CARGA_ID,
      ordenIds: ["ord-1"],
      actor: ACTOR,
    });

    expect(out.porOrden.size).toBe(0);
    expect(repo.setOrdenesDownloadUrl).toHaveBeenCalledWith([]);
  });
});

describe("EtiquetasDescargaService — sin ordenes y propagacion de errores (R50/R51)", () => {
  it.each(["consolidate", "individual"] as const)(
    "R50: `ordenIds` vacio en modo %s -> no toca Storage ni DB",
    async (modo) => {
      const pdf = fakePdf();
      const repo = fakeRepo();

      const out = await new EtiquetasDescargaService(pdf, repo).generarYPersistir({
        modo,
        cargaId: CARGA_ID,
        ordenIds: [],
        actor: ACTOR,
      });

      expect(out).toEqual({ consolidado: null, porOrden: new Map() });
      expect(pdf.generarYAlmacenar).not.toHaveBeenCalled();
      expect(pdf.generarYAlmacenarPorOrden).not.toHaveBeenCalled();
      expect(repo.setCargaDownloadUrl).not.toHaveBeenCalled();
      expect(repo.setOrdenesDownloadUrl).not.toHaveBeenCalled();
    },
  );

  it("R51: un fallo de generacion se PROPAGA (el best-effort lo aplica el borde)", async () => {
    const pdf = fakePdf({
      generarYAlmacenar: vi.fn(async () => {
        throw new Error("storage caido");
      }),
    });
    const repo = fakeRepo();

    await expect(
      new EtiquetasDescargaService(pdf, repo).generarYPersistir({
        modo: "consolidate",
        cargaId: CARGA_ID,
        ordenIds: ["ord-1"],
        actor: ACTOR,
      }),
    ).rejects.toThrow("storage caido");
    expect(repo.setCargaDownloadUrl).not.toHaveBeenCalled(); // la columna queda NULL
  });

  it("R51: un fallo al PERSISTIR tambien se propaga (la columna queda NULL)", async () => {
    const pdf = fakePdf();
    const repo = fakeRepo();
    (repo.setOrdenesDownloadUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db caida"),
    );

    await expect(
      new EtiquetasDescargaService(pdf, repo).generarYPersistir({
        modo: "individual",
        cargaId: CARGA_ID,
        ordenIds: ["ord-1"],
        actor: ACTOR,
      }),
    ).rejects.toThrow("db caida");
  });
});
