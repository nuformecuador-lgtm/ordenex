import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { AnaliticaFinancieraActionDeps } from "@/lib/actions/analitica-financiera";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RespuestaFinanciera } from "@/lib/types/analitica-financiera";
import { armarServicio } from "../services/_dobles-analitica-financiera";

// Feature 179 / T2.4 — R20: EL BORDE NO CAMBIA.
//
// La 132, la 133 y la 134 consumen `consultarMetricaFinanciera` y los tipos de
// `lib/types/analitica-financiera.ts`. Esta feature mete una cache DEBAJO del servicio y por
// encima no se entera nadie: ni la aridad, ni el tipo de retorno, ni el cuerpo de la accion.
//
// El unico cambio autorizado es `construirServicio`, que es el composition root — y el ULTIMO
// caso de este archivo comprueba que el cableado esta hecho, porque «no cambiar nada» tambien lo
// cumpliria una feature que no hubiera enchufado la cache.
//
// La accion se ejercita con `deps.service` inyectado: asi no se abre ni una conexion
// (`getPrismaClient` es perezoso y `construirServicio` solo corre si no hay servicio inyectado).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const ACCION = "lib/actions/analitica-financiera.ts";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function deps(service: AnaliticaFinancieraActionDeps["service"]): AnaliticaFinancieraActionDeps {
  return {
    service,
    getActor: async () => MAESTRO,
    logger: { logError: vi.fn() },
    now: new Date("2026-08-02T15:00:00.000Z"),
  };
}

describe("R20 · la Server Action conserva su aridad y su tipo de retorno", () => {
  it("sigue recibiendo dos parametros obligatorios y las deps opcionales", () => {
    // `Function.length` cuenta los parametros ANTERIORES al primero con default: `metricaId` y
    // `filtroRaw`. Anadir un tercero obligatorio —el error tipico al cablear una dependencia
    // nueva— lo subiria a 3 y romperia a la 132/133/134 en typecheck.
    expect(consultarMetricaFinanciera.length).toBe(2);
  });

  it("y devuelve la misma union `RespuestaFinanciera`, con el DTO intacto", async () => {
    const { servicio } = armarServicio({
      caja: [{ categoria: "ingreso_flete", tipo: "ingreso", suma: "300.00" }],
    });

    const r: RespuestaFinanciera = await consultarMetricaFinanciera(
      "ingreso_flete",
      { rango: "dia" },
      deps(servicio),
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("la accion no devolvio ok");
    expect(r.datos.metricaId).toBe("ingreso_flete");
    expect(r.datos.tipo).toBe("vistas");
  });

  it("los otros tres estados del borde siguen saliendo por donde salian", async () => {
    const { servicio } = armarServicio();

    const malFiltro = await consultarMetricaFinanciera("ingreso_flete", { rango: "ayer" }, deps(servicio));
    expect(malFiltro.status).toBe("validation_error");

    const sinActor = await consultarMetricaFinanciera("ingreso_flete", { rango: "dia" }, {
      ...deps(servicio),
      getActor: async () => null,
    });
    expect(sinActor.status).toBe("forbidden");

    // Una metrica que el catalogo concede a `maestro` pero que no es financiera: `error`
    // explicito, nunca ceros.
    const otroDominio = await consultarMetricaFinanciera("entregas", { rango: "dia" }, deps(servicio));
    expect(otroDominio.status).toBe("error");
  });
});

describe("R20 · el unico cambio del borde es el composition root", () => {
  // Sin comentarios: la PROSA que explica el cableado no lo sustituye. Con el archivo crudo,
  // borrar la llamada y dejar el comentario que la menciona dejaria este caso verde.
  const fuente = fs
    .readFileSync(path.join(REPO_ROOT, ACCION), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  it("`construirServicio` envuelve el servicio con la cache", () => {
    // Sin esto, todos los casos de arriba pasarian con la feature SIN cablear: la accion es el
    // unico sitio del arbol donde se construye este servicio, asi que si aqui no se decora, en
    // produccion no hay cache y la feature entera es un modulo muerto.
    expect(fuente).toMatch(/decorarFinancieraConCache\(/);
    expect(fuente).toMatch(/crearAnaliticaCacheDeNext\(\)/);
  });

  it("y el cuerpo de `consultarMetricaFinanciera` no aprendio nada de cache", () => {
    const cuerpo = fuente.slice(fuente.indexOf("export async function consultarMetricaFinanciera"));
    expect(cuerpo).not.toMatch(/decorarFinancieraConCache|IAnaliticaCache|\.envolver\(|next\/cache/);
  });
});
