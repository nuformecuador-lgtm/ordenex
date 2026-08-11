import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierresBodegaAdminRepository } from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import { CierresBodegaAdminService } from "@/lib/services/CierresBodegaAdminService";
import { libroFinanciero, type LibroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.7 — R15: `aprobarCierreBodega` invalida la cache financiera.
//
// ⚠ ESTE ARCHIVO EXISTE PORQUE «ES IGUAL QUE EL DE DIA» ES EXACTAMENTE COMO SE OLVIDA UNA
// LLAMADA. `aprobarCierre` y `aprobarCierreBodega` viven en DOS servicios distintos
// (`CierresAdminService.ts:421` y `CierresBodegaAdminService.ts:289`), asi que son dos
// invalidaciones, dos origenes y dos tests. Un solo test cubriria uno y dejaria el otro suelto,
// y el suelto serviria dinero rancio en silencio.
//
// MUTACION QUE LO MATA: borrar la invalidacion de `aprobarCierreBodega`. Solo este archivo se
// pone rojo — el de cierre de dia sigue verde, que es la propiedad que importa.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function armarBodega(libro: LibroFinanciero, resultado: "updated" | "conflict" = "updated") {
  const repo = {
    resolverCierreBodega: vi.fn(async () => {
      if (resultado === "updated") {
        await libro.cajaRepo.crearMovimientos({} as never, [
          {
            tipo: "egreso",
            categoria: "egreso_pago_mensajero",
            monto: "2500.00",
            origenTipo: "cierre_dia",
            origenId: "cb1",
          },
        ]);
      }
      return resultado;
    }),
  } as unknown as ICierresBodegaAdminRepository;

  const servicio = new CierresBodegaAdminService(repo, { firmar: vi.fn() } as never, libro.cache);
  return { servicio, repo };
}

describe("R15 · aprobar un cierre de BODEGA invalida la cache financiera", () => {
  it("los cinco pasos, con `aprobarCierreBodega` real en el paso 4", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarBodega(libro);

    // (1)
    libro.moverAlMargen("400.00");
    expect(await libro.consultar()).toBe("400.00");
    // (2) + (3)
    libro.moverAlMargen("30.00");
    expect(await libro.consultar()).toBe("400.00");

    // (4)
    const r = await servicio.aprobarCierreBodega("cb1", MAESTRO);
    expect(r.status).toBe("ok");

    // (5) 400 + 30 + 2500
    expect(
      await libro.consultar(),
      "la invalidacion de `aprobarCierreBodega` NO llego. Este es el escritor que mas facil se " +
        "olvida: parece «el mismo» que el de los cierres de dia y es otro servicio entero.",
    ).toBe("2930.00");
  });

  it("registra SU propio origen, distinto del de los cierres de dia (R24)", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarBodega(libro);

    await servicio.aprobarCierreBodega("cb1", MAESTRO);

    // Con un origen unico para los ocho, el registro sabria que alguien invalido pero no CUAL
    // no lo hizo — que es lo unico para lo que existe.
    expect(libro.cache.invalidaciones.map((i) => i.origen)).toEqual(["ledger_cierre_bodega"]);
  });

  it("un RECHAZO no invalida: no emite ningun movimiento", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarBodega(libro);

    const r = await servicio.rechazarCierreBodega("cb1", "faltan evidencias", MAESTRO);

    expect(r.status).toBe("ok");
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });

  it("un `conflict` tampoco", async () => {
    const libro = libroFinanciero();
    const { servicio } = armarBodega(libro, "conflict");

    const r = await servicio.aprobarCierreBodega("cb1", MAESTRO);

    expect(r.status).toBe("conflict");
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });
});

describe("R15 · el composition root de produccion pasa el puerto de verdad", () => {
  it("`buildCierresBodegaAdminService` construye con `crearAnaliticaCacheDeNext()`", () => {
    const fuente = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "actions", "cierre-bodega.ts"),
      "utf8",
    );
    expect(fuente).toMatch(/new CierresBodegaAdminService\([\s\S]*?crearAnaliticaCacheDeNext\(\)/);
  });
});
