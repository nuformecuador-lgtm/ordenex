import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type { ErrorLogger } from "@/lib/errors/logger";
import { sondeaIdentidadDeMensajero } from "@/lib/analytics/oraculo-mensajero";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import { ETIQUETA_MENSAJERO } from "@/lib/analytics/identidad";
import { AHORA, MAESTRO, TIENDA, consultaDe, cubo, rollupFalso, servicioCon } from "./_fake-operativa";
import type { IAnaliticaOperativaService } from "@/lib/interfaces/services/IAnaliticaOperativaService";

// Feature 126 / T9.5 + T9.6 — R24 y R36 (T0-Q5 = A del 2026-08-02).
//
// EL AGUJERO, verificado: `recortarFiltro` de la 122 (`lib/analytics/consulta.ts`) solo
// interseca LA DIMENSION DEL ALCANCE. Un `adminTienda` esta recortado por `tienda_id`, asi que
// su `mensajero_id: [uuid]` PASA TAL CUAL al `where`. La seudonimizacion le oculta el nombre,
// pero el CONTEO le confirma si ese mensajero trabajo para el; con una lista de uuids
// reconstruye la relacion mensajero↔tienda que D5 de la 122 quiso ocultar.
//
// LAS DOS MUTACIONES DE R24 SON OPUESTAS y las dos son errores:
//   (a) aceptar el filtro y devolver el conteo -> el oraculo sigue abierto;
//   (b) responder `forbidden` pero ADEMAS retirarle la desagregacion seudonima -> se le quita
//       lo que D5 le concedio. Pierde el FILTRO, no la VISTA.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const UUID_SONDEADO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const SERVICIO_MUDO: IAnaliticaOperativaService = {
  async consultar() {
    throw new Error("el servicio NO debe llegar a ejecutarse en un sondeo");
  },
  // Feature 176 — el modo agregado recorre el MISMO oraculo. Este doble tambien lo declara
  // mudo: si alguna vez llegara aqui por la puerta del agregado, el test lo dice a gritos.
  async consultarAgregado() {
    throw new Error("el servicio NO debe llegar a ejecutarse en un sondeo");
  },
};

describe("R24 · un adminTienda no puede sondear por mensajero_id", () => {
  it("un adminTienda no puede sondear por mensajero_id", async () => {
    const logError = vi.fn();
    const logger: ErrorLogger = { logError };
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "dia", mensajero_id: [UUID_SONDEADO] } },
      { service: SERVICIO_MUDO, logger, now: () => AHORA, getActor: async () => TIENDA },
    );
    // Ni conteo, ni cero, ni lista vacia: `forbidden` sin datos.
    expect(r).toEqual({ status: "forbidden" });
  });

  it("y el sondeo se AUDITA, por el mismo camino que R5", async () => {
    const logError = vi.fn();
    await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "dia", mensajero_id: [UUID_SONDEADO] } },
      {
        service: SERVICIO_MUDO,
        logger: { logError },
        now: () => AHORA,
        getActor: async () => TIENDA,
      },
    );
    expect(logError).toHaveBeenCalledTimes(1);
    const registro = logError.mock.calls[0][0] as Record<string, unknown>;
    expect(registro.evento).toBe("analitica_denegado");
    expect(registro.motivo).toBe("filtro_fuera_de_alcance");
    // El uuid que el PROPIO actor envio si queda en el rastro: es lo que pidio, no un dato
    // ajeno, y sin el la auditoria no serviria para investigar el sondeo.
    expect(JSON.stringify(registro)).toContain(UUID_SONDEADO);
  });

  it("un rol de politica REAL sigue pudiendo filtrar por mensajero", async () => {
    // Frontera del cierre: si `sondeaIdentidadDeMensajero` devolviera `true` siempre,
    // romperia a `maestro`, `admin`, `adminSatelite` y al propio `mensajero` (cuyo filtro por
    // si mismo lo ESCRIBE la 122). Quien puede ver el id no gana nada filtrando por el.
    let llego = false;
    const service: IAnaliticaOperativaService = {
      async consultar() {
        llego = true;
        return (await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
          consultaDe("entregas", MAESTRO),
        )) as never;
      },
      // Feature 176 — la interfaz gano `consultarAgregado`; este doble no lo ejercita.
      async consultarAgregado() {
        throw new Error("este doble no sirve el modo agregado");
      },
    };
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "dia", mensajero_id: [UUID_SONDEADO] } },
      { service, logger: { logError: vi.fn() }, now: () => AHORA, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    expect(llego).toBe(true);
  });
});

describe("R24 · lo que pierde es el FILTRO, no la VISTA", () => {
  it("un adminTienda sigue viendo la desagregacion seudonima por mensajero", async () => {
    // Mutacion (b): responder `forbidden` y ADEMAS dejar de emitir las series por mensajero.
    // Aqui el `adminTienda` NO filtra por mensajero, solo desagrega, y eso D5 se lo concedio.
    const cubos = [
      cubo({ fecha: "2026-08-01", mensajeroId: "m-uno", entregas: 4 }),
      cubo({ fecha: "2026-08-01", mensajeroId: "m-dos", entregas: 6 }),
    ];
    const serie = await servicioCon(rollupFalso(cubos)).consultar(
      consultaDe("entregas", TIENDA),
      "mensajero",
    );
    expect(serie.puntos).toHaveLength(2);
    for (const punto of serie.puntos) {
      expect(punto.dimension).toMatch(new RegExp(`^${ETIQUETA_MENSAJERO} \\d+$`));
    }
    // Seudonima, pero COMPLETA: los dos mensajeros con sus numeros.
    expect(serie.puntos.map((p) => p.valor).sort((a, b) => Number(a) - Number(b))).toEqual([4, 6]);
    // Y sin ids reales, que es lo que la desagregacion NO puede costar.
    expect(JSON.stringify(serie)).not.toContain("m-uno");
  });

  it("el borde acepta la desagregacion por mensajero de un adminTienda", async () => {
    let desagregacionRecibida: unknown;
    const service: IAnaliticaOperativaService = {
      async consultar(_c, d) {
        desagregacionRecibida = d;
        return (await servicioCon(rollupFalso([cubo({ fecha: "2026-08-01" })])).consultar(
          consultaDe("entregas", TIENDA),
        )) as never;
      },
      // Feature 176 — la interfaz gano `consultarAgregado`; este doble no lo ejercita.
      async consultarAgregado() {
        throw new Error("este doble no sirve el modo agregado");
      },
    };
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "dia" }, desagregacion: "mensajero" },
      { service, logger: { logError: vi.fn() }, now: () => AHORA, getActor: async () => TIENDA },
    );
    expect(r.status).toBe("ok");
    expect(desagregacionRecibida).toBe("mensajero");
  });
});

describe("R36 · el predicado del oraculo se exporta una sola vez", () => {
  it("el predicado del oraculo se exporta una sola vez", () => {
    // CENSO: `sondeaIdentidadDeMensajero` se DECLARA en un unico archivo de `lib/`. Copiarlo
    // dentro de la Server Action (y borrar el helper) es la mutacion de R36; copiarlo en la
    // 134 reabriria el oraculo por la puerta del CSV, que es el coste que Q5 = A asumio.
    const declaraciones: string[] = [];
    const recorrer = (dir: string): void => {
      const abs = path.join(REPO_ROOT, dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          recorrer(rel);
          continue;
        }
        if (!e.name.endsWith(".ts")) continue;
        const codigo = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
        if (/function\s+sondeaIdentidadDeMensajero\s*\(/.test(codigo)) declaraciones.push(rel);
      }
    };
    recorrer("lib");
    expect(declaraciones).toEqual(["lib/analytics/oraculo-mensajero.ts"]);
  });

  it("y la Server Action lo CONSUME en vez de reimplementarlo", () => {
    const accion = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "actions", "analitica-operativa.ts"),
      "utf8",
    );
    expect(accion).toContain('from "@/lib/analytics/oraculo-mensajero"');
    expect(accion).not.toMatch(/function\s+sondeaIdentidadDeMensajero/);
  });

  it("el predicado es puro y total: se puede probar sin base ni sesion", () => {
    expect(sondeaIdentidadDeMensajero({ rango: "dia", mensajero_id: ["x"] }, "seudonima")).toBe(true);
    expect(sondeaIdentidadDeMensajero({ rango: "dia" }, "seudonima")).toBe(false);
    expect(sondeaIdentidadDeMensajero({ rango: "dia", mensajero_id: ["x"] }, "real")).toBe(false);
  });

  it("un solo uuid basta para sondear: no se mira la longitud de la lista", () => {
    // Con un umbral («solo si pide muchos») el atacante pediria de uno en uno, que ademas es
    // el caso mas barato para el.
    expect(sondeaIdentidadDeMensajero({ rango: "dia", mensajero_id: ["uno"] }, "seudonima")).toBe(
      true,
    );
  });
});
