import { describe, it, expect, vi } from "vitest";
import {
  dedupeKeyGeocodificacion,
  encolarGeocodificacion,
  GEOCODIFICACION_MAX_INTENTOS,
} from "@/lib/services/jobs/geocodificacion-encolado";
import { hashDireccion } from "@/lib/geo/direccion-query";
import type { IJobRepository, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import { loadJobsConfig } from "@/lib/config/jobs";

// Feature 91 (R9, R10, R11, R12, R14, R34) — helper de encolado outbox. El `tx` es un
// doble: aqui se verifica QUE y CON QUE opciones se encola, no la transaccionalidad real
// (eso lo cubre orden-geocode-enqueue.test.ts sobre el repositorio).

const TX = {} as JobTxClient;

function repoFake() {
  const enqueue: IJobRepository["enqueue"] = vi.fn(async () => null);
  return {
    repo: { enqueue } as unknown as IJobRepository,
    enqueue: enqueue as ReturnType<typeof vi.fn<IJobRepository["enqueue"]>>,
  };
}

describe("R9 — no se encola sin direccion geocodificable", () => {
  it.each([
    ["null", null],
    ["vacia", ""],
    ["solo espacios", "     "],
    ["solo tabuladores y saltos", "\t\n  "],
  ])("no encola cuando la direccion es %s", async (_caso, direccion) => {
    const { repo, enqueue } = repoFake();
    await encolarGeocodificacion(repo, TX, { id: "orden-1", direccion });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("SI encola cuando hay direccion con contenido", async () => {
    const { repo, enqueue } = repoFake();
    await encolarGeocodificacion(repo, TX, { id: "orden-1", direccion: "Av. Central 100" });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("R14 — payload sin datos personales", () => {
  it("el payload encolado solo contiene ordenId", async () => {
    const { repo, enqueue } = repoFake();
    await encolarGeocodificacion(repo, TX, { id: "orden-1", direccion: "Av. Central 100" });
    const [tipo, payload] = enqueue.mock.calls[0];
    expect(tipo).toBe("geocodificacion");
    expect(payload).toEqual({ ordenId: "orden-1" });
    // La direccion es dato personal: NO viaja en el payload del job.
    expect(JSON.stringify(payload)).not.toContain("Av. Central 100");
  });

  it("el encolado va DENTRO de la transaccion del writer (4.º argumento tx)", async () => {
    const { repo, enqueue } = repoFake();
    await encolarGeocodificacion(repo, TX, { id: "orden-1", direccion: "Av. Central 100" });
    expect(enqueue.mock.calls[0][3]).toBe(TX);
  });
});

describe("R34 — limite de intentos propio", () => {
  it("el encolado fija maxIntentos en 8, por encima del default de la cola", async () => {
    const { repo, enqueue } = repoFake();
    await encolarGeocodificacion(repo, TX, { id: "orden-1", direccion: "Av. Central 100" });
    const opts = enqueue.mock.calls[0][2] ?? {};
    expect(opts.maxIntentos).toBe(8);
    expect(GEOCODIFICACION_MAX_INTENTOS).toBe(8);
    // Y es ESTRICTAMENTE mayor que el default de la cola (5): con backoff base de 60 s
    // sube la tolerancia a un corte del proveedor de ~15 min a ~4 h.
    expect(GEOCODIFICACION_MAX_INTENTOS).toBeGreaterThan(loadJobsConfig().JOBS_MAX_ATTEMPTS);
  });
});

describe("R12/R13 — forma normativa de la clave de idempotencia", () => {
  const HASH = hashDireccion("Av. Central 100");

  it("la clave es geocodificacion:<ordenId>:<hash8> — los TRES segmentos son obligatorios", () => {
    const clave = dedupeKeyGeocodificacion("orden-1", HASH);
    expect(clave).toBe(`geocodificacion:orden-1:${HASH.slice(0, 8)}`);
    const segmentos = clave.split(":");
    expect(segmentos).toHaveLength(3);
    expect(segmentos[0]).toBe("geocodificacion");
    expect(segmentos[1]).toBe("orden-1");
    expect(segmentos[2]).toHaveLength(8);
    expect(segmentos[2]).toMatch(/^[0-9a-f]{8}$/);
  });

  // ⚠️ TEST DE REGRESION DELIBERADO. Si alguien "simplifica" la clave a
  // `geocodificacion:<ordenId>`, este test se pone rojo. Motivo: el indice unico de
  // `dedupe_key` es parcial pero NO esta acotado por ESTADO del job, y las filas `jobs`
  // no se purgan al completarse -> la fila `done` del primer encolado ocuparia la clave
  // para siempre y corregir la direccion produciria un `ON CONFLICT DO NOTHING`
  // SILENCIOSO: la correccion no se geocodificaria jamas (R13, design §8.3).
  it("NO degenera en la forma sin hash `geocodificacion:<ordenId>`", () => {
    const clave = dedupeKeyGeocodificacion("orden-1", HASH);
    expect(clave).not.toBe("geocodificacion:orden-1");
    expect(clave.split(":").length).toBeGreaterThan(2);
  });

  it("misma orden + misma direccion -> misma clave (idempotente, R12)", () => {
    expect(dedupeKeyGeocodificacion("orden-1", HASH)).toBe(
      dedupeKeyGeocodificacion("orden-1", hashDireccion("AV. CENTRAL   100")),
    );
  });

  it("misma orden + direccion CORREGIDA -> clave DISTINTA (re-geocodificacion posible, R13)", () => {
    const original = dedupeKeyGeocodificacion("orden-1", hashDireccion("Av. Central 100"));
    const corregida = dedupeKeyGeocodificacion("orden-1", hashDireccion("Av. Central 200"));
    expect(corregida).not.toBe(original);
  });

  it("ordenes DISTINTAS con la MISMA direccion -> claves distintas (no colisionan, R6)", () => {
    expect(dedupeKeyGeocodificacion("orden-1", HASH)).not.toBe(
      dedupeKeyGeocodificacion("orden-2", HASH),
    );
  });

  it("el encolado real usa esa clave", async () => {
    const { repo, enqueue } = repoFake();
    await encolarGeocodificacion(repo, TX, { id: "orden-1", direccion: "Av. Central 100" });
    const opts = enqueue.mock.calls[0][2] ?? {};
    expect(opts.dedupeKey).toBe(dedupeKeyGeocodificacion("orden-1", HASH));
  });
});

// R10/R11 — GUARD LATENTE de `update()`. Hoy es estructuralmente inalcanzable end-to-end
// (`actualizarOrdenSchema` es `.strict()` y no admite `direccion`, y `toUpdateData()` no la
// proyecta: design §0/C1). Se verifica la CONDICION del guard a nivel unitario, que es
// exactamente lo que `OrdenRepository.update()` evalua antes de encolar.
function guardDebeEncolar(
  entrante: string | null | undefined,
  almacenada: string | null,
): boolean {
  return entrante !== undefined && entrante !== almacenada;
}

describe("R10 — actualizacion que cambia efectivamente la direccion", () => {
  it("encola cuando la direccion entrante difiere de la almacenada", async () => {
    expect(guardDebeEncolar("Av. Central 200", "Av. Central 100")).toBe(true);

    const { repo, enqueue } = repoFake();
    await encolarGeocodificacion(repo, TX, { id: "orden-1", direccion: "Av. Central 200" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const opts = enqueue.mock.calls[0][2] ?? {};
    // La clave lleva la huella de la direccion NUEVA: no choca con la del primer encolado.
    expect(opts.dedupeKey).toBe(
      dedupeKeyGeocodificacion("orden-1", hashDireccion("Av. Central 200")),
    );
    expect(opts.dedupeKey).not.toBe(
      dedupeKeyGeocodificacion("orden-1", hashDireccion("Av. Central 100")),
    );
  });

  it("tambien encola cuando la orden no tenia direccion y ahora si", () => {
    expect(guardDebeEncolar("Av. Central 100", null)).toBe(true);
  });
});

describe("R11 — actualizacion que no toca la direccion", () => {
  it("no encola cuando el update no toca la direccion ni cuando la deja igual", () => {
    // Campo AUSENTE del update (caso real hoy: el schema ni siquiera lo admite).
    expect(guardDebeEncolar(undefined, "Av. Central 100")).toBe(false);
    // Campo presente con el MISMO valor.
    expect(guardDebeEncolar("Av. Central 100", "Av. Central 100")).toBe(false);
    // Ambos vacios.
    expect(guardDebeEncolar(null, null)).toBe(false);
  });

  it("si la direccion nueva no es geocodificable, el helper no encola aunque el guard pase", async () => {
    expect(guardDebeEncolar("   ", "Av. Central 100")).toBe(true);
    const { repo, enqueue } = repoFake();
    await encolarGeocodificacion(repo, TX, { id: "orden-1", direccion: "   " });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
