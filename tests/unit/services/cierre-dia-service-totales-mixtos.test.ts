import { describe, it, expect, vi } from "vitest";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type {
  CierreGestionPendienteRow,
  CrearCierreInput,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { calcularSplitPago } from "@/lib/utils/cuenta-por-pagar";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";
import { conPagos } from "@/tests/fixtures/cierre-pagos";

/**
 * Feature 212 (T12, R29) — la `E` del `min(P, E)` con un cierre MIXTO.
 *
 * `cierre_dia.total_efectivo` no es un número de pantalla: es la `E` con la que la feature 44
 * decide cuánto del pago debido `P` se le entrega YA al mensajero (porque ya lo tiene en la
 * mano, en efectivo) y cuánto le queda a deber Ordenex. Antes de esta ficha, una entrega de
 * ₡8.000 cobrada 5.000 en efectivo + 3.000 por transferencia metía los 8.000 ENTEROS en `E`:
 * el sistema creía que el mensajero llevaba encima 3.000 que en realidad estaban en una cuenta
 * bancaria, y le liquidaba de más contra un efectivo inexistente.
 *
 * **La fórmula no cambia y aquí no se toca.** `calcularSplitPago` sigue siendo la fuente única
 * de `min(P, E)` (feature 44) y `derivarPendienteCierre` la de la 172. Lo único que esta ficha
 * mueve es el VALOR de `E` que se congela al solicitar el cierre — y eso es lo que estos casos
 * fijan: primero que `crearCierre` recibe "5000.00", y después qué pasa con el dinero de una
 * persona cuando recibe eso en vez de "8000.00".
 */

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const TARIFA: PagoTarifa = { cobroEntregado: "6000.00", cobroRechazado: "0.00" };

/** La entrega MIXTA del design §4: ₡8.000 = 5.000 efectivo + 3.000 transferencia. */
function entregaMixta(): CierreGestionPendienteRow {
  return conPagos(
    {
      gestionId: "g-mixta",
      ordenId: "o-1",
      numGuia: 1,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: null,
      zonaNombre: "Cartago",
      provinciaNombre: "Cartago",
      cantonNombre: "Central",
      distritoNombre: null,
      producto: "Caja",
      tiendaNombre: "Tienda X",
      resultado: "entregada",
      montoRecibido: "8000.00",
      // R19: con dos líneas, la columna deprecada queda NULL. El desglose es la verdad.
      metodoPago: null,
      motivo: null,
      fechaReprogramacion: null,
      evidenciaStoragePath: null,
      pagoMensajero: null,
      ingresoBodegaRechazo: null,
      esRechazoSla: false,
      causaIncidente: null,
      indemnizacion: null,
    },
    [
      { metodo: "efectivo", monto: "5000.00" },
      { metodo: "transferencia", monto: "3000.00" },
    ],
  );
}

function fakeRepo(gestiones: CierreGestionPendienteRow[]) {
  // El tipo va en el genérico y no en un parámetro sin usar: `mock.calls[0][0]` sigue siendo
  // un `CrearCierreInput` tipado (que es lo que miden las aserciones de abajo) sin dejar un
  // argumento muerto que ESLint marque.
  const crearCierre = vi.fn<(input: CrearCierreInput) => Promise<string>>(async () => "c1");
  const repo: ICierreDiaRepository = {
    findGestionesPendientes: vi.fn(async () => gestiones),
    contarOrdenesPendientesGestion: vi.fn(async () => 0),
    existeCierreSolicitado: vi.fn(async () => false),
    existeCierreVencido: vi.fn(async () => false),
    transicionarVencidoASolicitado: vi.fn(async () => true),
    existeCierreRechazado: vi.fn(async () => false),
    transicionarRechazadoASolicitado: vi.fn(async () => true),
    crearCierre,
    findCierresByMensajero: vi.fn(async () => []),
    findCierrePropioConGestiones: vi.fn(async () => null),
    findCierresByMensajeroPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findGestionParaDeshacer: vi.fn(async () => null),
    findUltimaGestionNoAnuladaId: vi.fn(async () => null),
    anularGestionYDevolverAGestion: vi.fn(async () => true),
  };
  return { repo, crearCierre };
}

function newService(repo: ICierreDiaRepository) {
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-cartago"),
    findUsuarioVehiculoId: vi.fn(async () => null),
    findEstatusIdByValue: vi.fn(async () => "s-reparto"),
    findMensajerosBloqueados: vi.fn(async () => new Set<string>()),
  } as unknown as IOrdenRepository;
  const tarifaZonaRepo: ITarifaZonaMensajeroRepository = {
    resolvePagoTarifa: vi.fn(async () => TARIFA),
  };
  const signedUrls: ISignedUrlProvider = {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async () => ({})),
  };
  return new CierreDiaService(repo, zonaRepo, ordenRepo, signedUrls, tarifaZonaRepo);
}

describe("R29 — `crearCierre` congela como `E` SOLO la parte cobrada en efectivo", () => {
  it("un cierre con una entrega mixta de ₡8.000 snapshotea totalEfectivo = 5000.00", async () => {
    const { repo, crearCierre } = fakeRepo([entregaMixta()]);

    const r = await newService(repo).solicitarCierre(MENSAJERO);

    expect(r.status).toBe("ok");
    const input = crearCierre.mock.calls[0][0];
    expect(input.totales).toEqual({
      efectivo: "5000.00", // NO "8000.00": los 3.000 de transferencia no están en su bolsillo
      simpe: "0.00",
      transferencia: "3000.00",
      general: "8000.00",
    });
  });

  it("R32: la forma del snapshot no cambia — siguen siendo los mismos cuatro totales", async () => {
    const { repo, crearCierre } = fakeRepo([entregaMixta()]);

    await newService(repo).solicitarCierre(MENSAJERO);

    expect(Object.keys(crearCierre.mock.calls[0][0].totales).sort()).toEqual([
      "efectivo",
      "general",
      "simpe",
      "transferencia",
    ]);
  });

  it("el general sigue siendo el dinero recaudado completo: la mixta no PIERDE dinero", async () => {
    // La contraprueba del caso anterior: recortar `E` no puede significar que 3.000 colones
    // desaparezcan del cierre. Cambian de balde, no de existencia.
    const { repo, crearCierre } = fakeRepo([entregaMixta()]);

    await newService(repo).solicitarCierre(MENSAJERO);

    const { totales } = crearCierre.mock.calls[0][0];
    expect(totales.general).toBe("8000.00");
    expect(totales.efectivo).not.toBe(totales.general);
  });
});

describe("R29 — el `min(P, E)` del pago al mensajero se calcula con ESA `E`", () => {
  /** `P` = el pago devengado que snapshotea el mismo cierre (feature 39). */
  async function snapshotDelCierre() {
    const { repo, crearCierre } = fakeRepo([entregaMixta()]);
    await newService(repo).solicitarCierre(MENSAJERO);
    const input = crearCierre.mock.calls[0][0];
    return { E: input.totales.efectivo, P: input.totalPagoMensajero };
  }

  it("con P = 6.000 y E = 5.000, se le entregan 5.000 y quedan 1.000 pendientes", async () => {
    const { E, P } = await snapshotDelCierre();
    expect(P).toBe("6000.00"); // una entregada a 6.000 de tarifa
    expect(E).toBe("5000.00");

    // La FÓRMULA es la de la 44, intacta: solo cambia con qué E se la alimenta.
    expect(calcularSplitPago(P, E)).toEqual({
      devengado: "6000.00",
      pagado: "5000.00", // min(P, E) = el efectivo que de verdad lleva encima
      pendiente: "1000.00", // lo que Ordenex le queda debiendo
    });
  });

  it("con la `E` INFLADA del modelo viejo (8.000) se le pagaría de más y no quedaría deuda", async () => {
    // Este caso NO prueba el código nuevo: mide el DAÑO que evita, y es la razón de que el
    // reparto por método sea money-critical. Con E = 8.000 el sistema creería que el mensajero
    // tiene en la mano los 6.000 del pago y liquidaría el cierre entero contra un efectivo
    // que en 3.000 colones no existe.
    const inflado = calcularSplitPago("6000.00", "8000.00");
    expect(inflado.pagado).toBe("6000.00");
    expect(inflado.pendiente).toBe("0.00");

    const { E, P } = await snapshotDelCierre();
    const correcto = calcularSplitPago(P, E);
    expect(correcto.pagado).not.toBe(inflado.pagado);
    expect(correcto.pendiente).not.toBe(inflado.pendiente);
  });

  it("el pendiente del cierre (172) hereda la misma `E`, sin reimplementar la regla", async () => {
    const { E, P } = await snapshotDelCierre();
    // Sin pagos vigentes contra el cierre todavía.
    expect(derivarPendienteCierre(P, E, "0.00")).toBe("1000.00");
    // Y si ya se le entregaron 400 de esos 1.000, quedan 600.
    expect(derivarPendienteCierre(P, E, "400.00")).toBe("600.00");
  });

  it("una entrega de UN solo método sigue comportándose exactamente igual que antes", async () => {
    // No-regresión: el 99% de los cierres son de método único y su `E` no se mueve un céntimo.
    const soloEfectivo = conPagos({ ...entregaMixta(), metodoPago: "efectivo" }, [
      { metodo: "efectivo", monto: "8000.00" },
    ]);
    const { repo, crearCierre } = fakeRepo([soloEfectivo]);

    await newService(repo).solicitarCierre(MENSAJERO);

    const input = crearCierre.mock.calls[0][0];
    expect(input.totales.efectivo).toBe("8000.00");
    expect(calcularSplitPago(input.totalPagoMensajero, input.totales.efectivo).pendiente).toBe(
      "0.00",
    );
  });
});
