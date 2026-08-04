import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import { recorteDePresentacion } from "@/lib/analytics/presentacion";
import {
  aRaw,
  desdeSearchParams,
} from "@/app/(app)/analitica/_components/operativo/filtro-tablero";
import type { IAnaliticaOperativaService } from "@/lib/interfaces/services/IAnaliticaOperativaService";
import type { ErrorLogger } from "@/lib/errors/logger";
import { AHORA, MAESTRO, TIENDA, consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";

// Feature 133 (T6.6) — R27: LA FRONTERA DEL ORACULO. Quien decide es el BORDE, no la UI.
//
// ┌──────────────────────────────────────────────────────────────────────────────────────┐
// │ ESTE ARCHIVO NO CIERRA NADA. LEER `requirements.md §4` ANTES DE CITARLO.              │
// │                                                                                       │
// │ El hallazgo M-4 de `progress/review_122.md` («un adminTienda puede confirmar POR EL   │
// │ CONTEO si un mensajero concreto trabajo para el») esta declarado ABIERTO en la spec   │
// │ de esta feature y tiene ficha propia: la 182, zona BACKEND. Esta feature es           │
// │ `frontend` y §4 lo deja escrito: es un problema de DATOS, y cerrarlo desde la         │
// │ pantalla seria exactamente el pecado del que la 122 nos aviso.                        │
// │                                                                                       │
// │ QUE HACE R15 (ocultar el selector «Mensajero» a un adminTienda): quitar la COMODIDAD. │
// │ QUE NO HACE: quitar el CANAL. El `mensajero_id` sigue viajando por la URL —que es     │
// │ compartible y editable a mano— y por el argumento de la Server Action, que cualquiera │
// │ puede invocar desde la consola del navegador.                                         │
// │                                                                                       │
// │ Ningun resultado verde de este archivo puede presentarse ni documentarse como cierre  │
// │ de M-4. Lo unico que se afirma aqui es una NEGATIVA: que la respuesta del borde ante  │
// │ un `mensajero_id` inyectado NO DEPENDE de que la barra dibuje o no ese control.       │
// └──────────────────────────────────────────────────────────────────────────────────────┘

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const UUID_INYECTADO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Si el servicio llega a ejecutarse, la decision no se tomo en el borde. */
const SERVICIO_MUDO: IAnaliticaOperativaService = {
  async consultar() {
    throw new Error("el servicio NO debe ejecutarse: la decision es del borde");
  },
};

function loggerMudo(): ErrorLogger {
  return { logError: vi.fn() };
}

/**
 * VIA 1 — la URL. Se construye por el camino REAL de la pantalla
 * (`desdeSearchParams` + `aRaw`, los dos modulos puros que usa el tablero), no a mano: asi
 * lo que se le manda al borde es literalmente lo que produciria un enlace copiado de la
 * pantalla de un maestro y abierto por un adminTienda cuya barra no dibuja ese selector.
 */
const RAW_DESDE_URL = aRaw(
  desdeSearchParams(new URLSearchParams(`rango=dia&mensajero=${UUID_INYECTADO}`)),
);

/** VIA 2 — el argumento de la Server Action, escrito a mano por quien la invoque. */
const RAW_A_MANO = { rango: "dia", mensajero_id: [UUID_INYECTADO] };

describe("Feature 133 (R27) — ocultar el selector no cambia la respuesta del borde", () => {
  it("la premisa es real: a un adminTienda la barra NO le ofrece la faceta «mensajero»", () => {
    const recorte = recorteDePresentacion(TIENDA);
    expect(recorte.alcance).toBe("tienda");
    expect(recorte.facetas).not.toContain("mensajero");
    // Y no por vacio: alguna faceta SI se le ofrece, asi que el `not.toContain` de arriba
    // discrimina de verdad.
    expect(recorte.facetas.length).toBeGreaterThan(0);
  });

  it("la via de la URL produce un `mensajero_id` de verdad: el sondeo llega entero al borde", () => {
    expect(RAW_DESDE_URL).toEqual(RAW_A_MANO);
    expect(RAW_DESDE_URL.mensajero_id).toEqual([UUID_INYECTADO]);
  });

  it("con el selector oculto, el `mensajero_id` inyectado por la URL sigue siendo cosa del borde", async () => {
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: RAW_DESDE_URL },
      {
        service: SERVICIO_MUDO,
        logger: loggerMudo(),
        now: () => AHORA,
        getActor: async () => TIENDA,
      },
    );
    // Lo que responda es su decision; lo que NO puede ser es un `ok` con cifras servidas
    // porque la pantalla creyera haber quitado el filtro al no dibujar el control.
    expect(r).toEqual({ status: "forbidden" });
  });

  it("y la respuesta es la MISMA por las dos vias: URL o argumento de la Server Action", async () => {
    const porUrl = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: RAW_DESDE_URL },
      { service: SERVICIO_MUDO, logger: loggerMudo(), now: () => AHORA, getActor: async () => TIENDA },
    );
    const porArgumento = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: RAW_A_MANO },
      { service: SERVICIO_MUDO, logger: loggerMudo(), now: () => AHORA, getActor: async () => TIENDA },
    );
    // Quitar el control quita la comodidad, no el canal: las dos puertas dan lo mismo.
    expect(porUrl).toEqual(porArgumento);
  });

  it("la decision depende del ACTOR, no de la pantalla: con politica real el mismo raw se acepta", async () => {
    // Frontera del cierre, en el sentido de R27: si el borde respondiera igual a todo el
    // mundo, este archivo estaria afirmando una constante y no una decision. `maestro`
    // manda EXACTAMENTE el mismo `raw` —el que salio de la URL— y pasa.
    let llego = false;
    const service: IAnaliticaOperativaService = {
      async consultar() {
        llego = true;
        return (await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
          consultaDe("entregas", MAESTRO),
        )) as never;
      },
    };
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: RAW_DESDE_URL },
      { service, logger: loggerMudo(), now: () => AHORA, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    expect(llego).toBe(true);
  });
});

describe("Feature 133 (R27) — el borde no puede consultar a la UI aunque quisiera", () => {
  /**
   * La afirmacion de arriba («la decision es del borde») se sostiene sobre un hecho
   * estructural, y este censo lo fija: el camino del dato no importa ni una linea del
   * recorte de presentacion ni de la ruta. Si manana alguien cableara `facetas` hasta el
   * borde para «no repetir la regla», la decision pasaria a depender de un pixel y este
   * caso caeria antes de que eso llegue a produccion.
   */
  const CAMINO_DEL_DATO = [
    "lib/actions/analitica-operativa.ts",
    "lib/analytics/oraculo-mensajero.ts",
    "lib/analytics/consulta.ts",
    "lib/analytics/identidad.ts",
  ];

  it("el censo mira archivos de verdad", () => {
    for (const rel of CAMINO_DEL_DATO) {
      const codigo = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(codigo.length, `${rel} vacio`).toBeGreaterThan(200);
    }
  });

  for (const rel of CAMINO_DEL_DATO) {
    it(`${rel} no importa el recorte de presentacion ni nada de la ruta`, () => {
      const codigo = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(codigo).not.toMatch(/from\s+["']@\/lib\/analytics\/presentacion["']/);
      expect(codigo).not.toMatch(/from\s+["']@\/app\//);
      expect(codigo).not.toMatch(/\brecorteDePresentacion\s*\(/);
    });
  }
});
