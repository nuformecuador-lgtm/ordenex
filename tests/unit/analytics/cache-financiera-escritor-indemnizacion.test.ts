import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IIncidenteAdminRepository,
  IncidenteAdminRow,
  ResolverIncidenteRepoResult,
} from "@/lib/interfaces/repositories/IIncidenteAdminRepository";
import { IncidenteAdminService } from "@/lib/services/IncidenteAdminService";
import { libroFinanciero, type LibroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.5 — R13: la indemnizacion de un incidente aprobado invalida.
//
// ⚠ SE ENGANCHA EN EL SERVICIO Y NO EN `IncidenteAdminRepository`, donde esta la escritura
// (`:327`), por dos razones a la vez: aquella escritura vive DENTRO de su `$transaction`
// —invalidar ahi seria antes del commit, R8— y un repositorio no debe conocer un puerto de
// infraestructura de cache. El doble de abajo escribe en el libro compartido en el mismo punto
// en que lo hace el repositorio real, y la invalidacion se afirma sobre la cifra servida.
//
// MUTACION QUE LO MATA: borrar la invalidacion de `IncidenteAdminService.aprobar`. Solo este
// archivo se pone rojo. La mutacion CONTRARIA —invalidar tambien al rechazar o en la rama
// `conflict`— la matan los dos ultimos casos.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const APROBADOR: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function fila(over: Partial<IncidenteAdminRow> = {}): IncidenteAdminRow {
  return {
    incidenteId: "i1",
    ordenId: "o1",
    numGuia: 1234,
    numRemision: "R-1",
    destinatario: "Ana",
    zonaId: "z1",
    zonaNombre: "Zona 1",
    estatusValue: "incidente",
    causa: "perdida",
    motivo: "paquete perdido",
    estado: "solicitado",
    indemnizacion: null,
    ordenMontoCobrar: "20000.00",
    reportadoPor: "u-mensajero", // != aprobador: R51 (quien reporta no aprueba)
    reportadoPorNombre: "Mario",
    resueltoPor: null,
    resueltoPorNombre: null,
    resueltoAt: null,
    motivoRechazo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    evidenciaStoragePaths: [],
    ...over,
  } as IncidenteAdminRow;
}

function armarIncidentes(
  libro: LibroFinanciero,
  opciones: { resultado?: ResolverIncidenteRepoResult; row?: IncidenteAdminRow } = {},
) {
  const resultado = opciones.resultado ?? "updated";
  const repo = {
    findByIdEnAlcance: vi.fn(async () => opciones.row ?? fila()),
    resolver: vi.fn(async (input: { nuevoEstado: string; monto: string | null }) => {
      // Lo que `IncidenteAdminRepository.ts:327` escribe DENTRO de su `$transaction`: el egreso
      // de indemnizacion. Solo en la rama que de verdad lo emite.
      if (resultado === "updated" && input.nuevoEstado === "aprobado" && input.monto !== null) {
        await libro.cajaRepo.crearMovimientos({} as never, [
          {
            tipo: "egreso",
            categoria: "egreso_indemnizacion",
            monto: input.monto,
            origenTipo: "gestion_orden",
            origenId: "g1",
          },
        ]);
      }
      return resultado;
    }),
  } as unknown as IIncidenteAdminRepository;

  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => null),
    findEstatusIdByValue: vi.fn(async () => "e1"),
  };
  const historialRepo = {
    findOrigenesReversion: vi.fn(async () => new Map<string, string>([["o1", "en_ruta"]])),
  };

  const servicio = new IncidenteAdminService(
    repo,
    ordenRepo as never,
    historialRepo as never,
    {} as never,
    { firmar: vi.fn(async () => ({})) } as never,
    libro.cache,
  );
  return { servicio, repo };
}

describe("R13 · una indemnizacion aprobada invalida la cache financiera", () => {
  it("los cinco pasos, con `aprobar` real en el paso 4", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarIncidentes(libro);

    // (1)
    libro.moverAlMargen("700.00");
    expect(await libro.consultar()).toBe("700.00");
    // (2) + (3)
    libro.moverAlMargen("25.00");
    expect(await libro.consultar()).toBe("700.00");

    // (4)
    const r = await servicio.aprobar("i1", "9000.00", APROBADOR);
    expect(r.status).toBe("ok");

    // (5) 700 + 25 + 9000
    expect(
      await libro.consultar(),
      "la invalidacion de la indemnizacion NO llego: el egreso se emitio y el tablero " +
        "financiero sigue sirviendo la cifra anterior.",
    ).toBe("9725.00");
  });

  it("registra SU propio origen (R24)", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarIncidentes(libro);

    await servicio.aprobar("i1", "9000.00", APROBADOR);

    expect(libro.cache.invalidaciones.map((i) => i.origen)).toEqual(["ledger_indemnizacion"]);
  });

  it("un RECHAZO no invalida: no persiste monto y no emite ningun movimiento", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarIncidentes(libro);

    const r = await servicio.rechazar("i1", "no procede", APROBADOR);

    expect(r.status).not.toBe("forbidden");
    expect(libro.filas()).toHaveLength(0);
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });

  it("un reintento sobre algo YA resuelto (`conflict`) tampoco invalida", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarIncidentes(libro, { resultado: "conflict" });

    const r = await servicio.aprobar("i1", "9000.00", APROBADOR);

    expect(r.status).toBe("conflict");
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });

  it("un monto que excede el valor de la orden no llega al repositorio ni invalida", async () => {
    const libro = libroFinanciero();
    const { servicio, repo } = armarIncidentes(libro);

    // El tope de negocio corta ANTES de abrir la transaccion que mueve el dinero.
    const r = await servicio.aprobar("i1", "999999.00", APROBADOR);

    expect(r.status).toBe("validation_error");
    expect(repo.resolver).not.toHaveBeenCalled();
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });
});

describe("R13 · el composition root de produccion pasa el puerto de verdad", () => {
  it("`buildService` de `lib/actions/incidentes.ts` construye con `crearAnaliticaCacheDeNext()`", () => {
    const fuente = fs.readFileSync(path.join(REPO_ROOT, "lib", "actions", "incidentes.ts"), "utf8");
    expect(fuente).toMatch(/new IncidenteAdminService\([\s\S]*?crearAnaliticaCacheDeNext\(\)/);
  });
});
