import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierresAdminRepository } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { libroFinanciero, type LibroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.6 — R14: `aprobarCierre` invalida la cache financiera.
//
// Es la operacion que mas dinero mueve del sistema: `resolverCierre` emite, en UNA transaccion,
// el ledger de la caja (42), el de la tienda (43), el del mensajero (44) y el egreso de
// indemnizacion (158). Toca los TRES ledgers y seis de las diez metricas financieras — el dato
// que sostiene D1 (invalidar por dominio en vez de mantener a mano un mapa ledger→metrica).
//
// El doble del repositorio ESCRIBE de verdad en el libro compartido, en el sitio donde el
// repositorio real escribe dentro de su `$transaction`. Lo que queda fuera del alcance de un
// test unitario es el SQL de ese repositorio, no el enganche: la invalidacion se afirma sobre la
// cifra que el tablero sirve despues.
//
// ⚠ SE SEPARA DE R15 A PROPOSITO. `aprobarCierreBodega` vive en OTRO servicio
// (`CierresBodegaAdminService`) aunque escriba por el mismo repositorio de ledger. Un solo test
// cubriria uno y dejaria el otro suelto.
//
// MUTACION QUE LO MATA: borrar la invalidacion de `CierresAdminService.aprobarCierre`. Solo este
// archivo se pone rojo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

/** El repositorio, doble, que escribe en el libro lo que su `$transaction` escribiria. */
function armarCierres(libro: LibroFinanciero, resultado: "updated" | "conflict" = "updated") {
  const repo = {
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    resolverCierre: vi.fn(async () => {
      if (resultado === "updated") {
        // Lo que las seis escrituras de `CierresAdminRepository.ts:665-725` dejan en la caja.
        await libro.cajaRepo.crearMovimientos({} as never, [
          {
            tipo: "egreso",
            categoria: "egreso_pago_mensajero",
            monto: "5000.00",
            origenTipo: "cierre_dia",
            origenId: "c1",
          },
        ]);
      }
      return resultado;
    }),
  } as unknown as ICierresAdminRepository;

  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") };
  const ordenRepo = {
    findEstatusIdByValue: vi.fn(async () => "e1"),
    findUsuarioZonaId: vi.fn(async () => null),
  };
  const liquidacionRepo = {
    obtenerCierreParaPago: vi.fn(async () => null),
    sumarVigentesPorCierre: vi.fn(async () => ({})),
  };

  const servicio = new CierresAdminService(
    repo,
    zonaRepo as never,
    ordenRepo as never,
    { firmar: vi.fn() } as never,
    liquidacionRepo as never,
    libro.cache,
  );
  return { servicio, repo };
}

describe("R14 · aprobar un cierre de dia invalida la cache financiera", () => {
  it("los cinco pasos, con `aprobarCierre` real en el paso 4", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarCierres(libro);

    // (1)
    libro.moverAlMargen("3000.00");
    expect(await libro.consultar()).toBe("3000.00");
    // (2) + (3)
    libro.moverAlMargen("120.00");
    expect(await libro.consultar()).toBe("3000.00");

    // (4)
    const r = await servicio.aprobarCierre("c1", MAESTRO);
    expect(r.status).toBe("ok");

    // (5) 3000 + 120 + 5000
    expect(
      await libro.consultar(),
      "la invalidacion de `aprobarCierre` NO llego: la aprobacion movio los tres ledgers y el " +
        "tablero financiero sigue sirviendo las cifras de antes.",
    ).toBe("8120.00");
  });

  it("registra SU propio origen, distinto del de los cierres de bodega (R24)", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarCierres(libro);

    await servicio.aprobarCierre("c1", MAESTRO);

    expect(libro.cache.invalidaciones.map((i) => i.origen)).toEqual(["ledger_cierre_dia"]);
  });

  it("un `conflict` (el cierre ya estaba resuelto) no invalida: no escribio nada", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarCierres(libro, "conflict");

    const r = await servicio.aprobarCierre("c1", MAESTRO);

    expect(r.status).toBe("conflict");
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });

  it("un rol sin acceso no invalida ni toca el repositorio", async () => {
    const libro = libroFinanciero();
    const { servicio, repo } = armarCierres(libro);

    const r = await servicio.aprobarCierre("c1", { usuarioId: "u-m", rol: "mensajero" });

    expect(r.status).toBe("forbidden");
    expect(repo.resolverCierre).not.toHaveBeenCalled();
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });
});

describe("R14 · el composition root de produccion pasa el puerto de verdad", () => {
  it("`buildService` de `lib/actions/cierres-admin.ts` construye con `crearAnaliticaCacheDeNext()`", () => {
    const fuente = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "actions", "cierres-admin.ts"),
      "utf8",
    );
    expect(fuente).toMatch(/new CierresAdminService\([\s\S]*?crearAnaliticaCacheDeNext\(\)/);
  });
});
