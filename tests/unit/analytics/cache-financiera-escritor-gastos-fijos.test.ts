import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import { GeneracionGastosFijosService } from "@/lib/services/GeneracionGastosFijosService";
import { handleGenerarGastosFijos } from "@/app/api/cron/generar-gastos-fijos/route";
import { libroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.4 — R12: el cron de gastos fijos invalida, y SOLO si genero egresos.
//
// El paso 4 corre `handleGenerarGastosFijos` REAL —el route handler entero, con su guardia de
// `CRON_SECRET`— y no el servicio a pelo: es el camino que se ejecuta en produccion cada
// madrugada. El servicio entra por `deps.service`, que es la inyeccion que el propio handler ya
// ofrece; asi el test no necesita base de datos ni entorno.
//
// El cron es un ROUTE HANDLER, o sea que corre DENTRO de un request de Next: `revalidateTag`
// funciona ahi y no hace falta encolar nada (`requirements.md §0.b` corrige aqui a la ficha).
//
// MUTACION QUE LO MATA: borrar la invalidacion -> el primer caso rojo. Y la mutacion CONTRARIA
// —invalidar siempre, sin mirar `egresosGenerados`— la mata el segundo: vaciar la cache
// financiera cada madrugada sin haber movido un centimo es coste sin motivo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SECRETO = "s3cr3t0-de-cron";
const AHORA = new Date("2026-08-10T06:00:00.000Z");

function peticion(): Request {
  return new Request("https://ordenex.co/api/cron/generar-gastos-fijos", {
    headers: { authorization: `Bearer ${SECRETO}` },
  });
}

function plantilla(over: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id: "p1",
    concepto: "Alquiler",
    monto: "1200.00",
    activa: true,
    periodicidadUnidad: "dias",
    periodicidadCantidad: 1,
    fechaCobro: "2026-08-01",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function repoDePlantillas(activas: GastoFijoPlantillaDTO[]): IGastoFijoPlantillaRepository {
  return {
    async listarActivas() {
      return activas;
    },
  } as unknown as IGastoFijoPlantillaRepository;
}

describe("R12 · el cron de gastos fijos invalida la cache financiera", () => {
  it("los cinco pasos, con `handleGenerarGastosFijos` real en el paso 4", async () => {
    const libro = libroFinanciero();
    const servicio = new GeneracionGastosFijosService(
      repoDePlantillas([plantilla()]),
      libro.cajaRepo,
      {} as never,
      libro.cache,
    );

    // (1)
    libro.moverAlMargen("800.00");
    expect(await libro.consultar()).toBe("800.00");
    // (2) + (3)
    libro.moverAlMargen("50.00");
    expect(await libro.consultar()).toBe("800.00");

    // (4) EL CRON REAL
    const res = await handleGenerarGastosFijos(peticion(), {
      getSecret: () => SECRETO,
      service: servicio,
      now: () => AHORA,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ egresosGenerados: 1 });

    // (5) 800 + 50 + 1200
    expect(
      await libro.consultar(),
      "la invalidacion del cron de gastos fijos NO llego: los egresos del dia se escribieron y " +
        "el tablero financiero sigue sirviendo la cifra de ayer.",
    ).toBe("2050.00");
  });

  it("una corrida con CERO egresos generados no invalida", async () => {
    const libro = libroFinanciero();
    const servicio = new GeneracionGastosFijosService(
      repoDePlantillas([]), // ninguna plantilla activa -> ningun egreso
      libro.cajaRepo,
      {} as never,
      libro.cache,
    );

    const res = await handleGenerarGastosFijos(peticion(), {
      getSecret: () => SECRETO,
      service: servicio,
      now: () => AHORA,
    });
    expect(await res.json()).toMatchObject({ egresosGenerados: 0 });

    // Vaciar la cache financiera cada madrugada sin haber movido dinero es coste sin motivo, y
    // este caso es lo unico que impide la mutacion «invalidar siempre».
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });

  it("una REEJECUCION del mismo dia tampoco: `skipDuplicates` inserta 0 filas", async () => {
    const libro = libroFinanciero();
    const servicio = new GeneracionGastosFijosService(
      repoDePlantillas([plantilla()]),
      libro.cajaRepo,
      {} as never,
      libro.cache,
    );

    await servicio.ejecutarGeneracion(AHORA);
    const trasLaPrimera = libro.cache.invalidaciones.length;
    expect(trasLaPrimera).toBe(1);

    // Idempotencia por `(origen_tipo, origen_id, categoria)`: la segunda corrida no escribe.
    const segunda = await servicio.ejecutarGeneracion(AHORA);
    expect(segunda.egresosGenerados).toBe(0);
    expect(libro.cache.invalidaciones).toHaveLength(trasLaPrimera);
  });

  it("registra SU propio origen, no uno generico (R24)", async () => {
    const libro = libroFinanciero();
    const servicio = new GeneracionGastosFijosService(
      repoDePlantillas([plantilla()]),
      libro.cajaRepo,
      {} as never,
      libro.cache,
    );

    await servicio.ejecutarGeneracion(AHORA);

    expect(libro.cache.invalidaciones.map((i) => i.origen)).toEqual(["ledger_gastos_fijos"]);
  });
});

describe("R12 · el composition root de produccion pasa el puerto de verdad", () => {
  it("`buildService` del route handler construye con `crearAnaliticaCacheDeNext()`", () => {
    const fuente = fs.readFileSync(
      path.join(REPO_ROOT, "app", "api", "cron", "generar-gastos-fijos", "route.ts"),
      "utf8",
    );
    expect(fuente).toMatch(/new GeneracionGastosFijosService\([\s\S]*?crearAnaliticaCacheDeNext\(\)/);
  });
});
