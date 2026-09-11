import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleAvisoRepartoManana } from "@/app/api/cron/aviso-reparto-manana/route";
import type {
  IRepartoMananaAvisoService,
  RepartoMananaResumen,
} from "@/lib/interfaces/services/IRepartoMananaAvisoService";

// FICHA 413 (T5.2) — Controller del cron del aviso de reparto de mañana. Cubre R33 (401 SIN
// EFECTOS: ni se construye el service ni se toca la DB, tampoco cuando el secreto NO está
// configurado) y R35 (el cuerpo 200 lleva SÓLO conteos y las dos fechas, ninguna clave con un
// identificador de orden, de persona ni de zona).

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SECRET = "s3cr3t-cron";

const RESUMEN: RepartoMananaResumen = {
  fecha: "2026-09-11",
  diaAnunciado: "2026-09-12",
  mensajerosConReparto: 7,
  mensajerosBloqueados: 1,
  avisosEmitidos: 6,
  fallos: 0,
};

function fakeService(
  spy = vi.fn<(now: Date) => Promise<RepartoMananaResumen>>(async () => RESUMEN),
): { service: IRepartoMananaAvisoService; spy: typeof spy } {
  return { service: { ejecutar: spy }, spy };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/cron/aviso-reparto-manana", { method: "GET", headers });
}

describe("413/R33 — sin el secreto correcto, 401 y NINGÚN efecto", () => {
  it("⭑ sin header Authorization -> 401 y el service NO se invoca", async () => {
    const { service, spy } = fakeService();

    const res = await handleAvisoRepartoManana(req(), { getSecret: () => SECRET, service });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("token incorrecto -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();

    const res = await handleAvisoRepartoManana(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service,
    });

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("header mal formado (sin `Bearer`) -> 401 sin efectos", async () => {
    const { service, spy } = fakeService();

    const res = await handleAvisoRepartoManana(req({ authorization: SECRET }), {
      getSecret: () => SECRET,
      service,
    });

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("⭑⭑ secreto NO CONFIGURADO -> 401: el endpoint no queda abierto por faltar la variable", async () => {
    // ES LA MITAD QUE SE OLVIDA. Si el `null` de la configuración se leyera como «no hay que
    // comprobar nada», cualquiera con la URL podría disparar la emisión de la noche.
    const { service, spy } = fakeService();

    const res = await handleAvisoRepartoManana(req({ authorization: "Bearer lo-que-sea" }), {
      getSecret: () => null,
      service,
    });

    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("⭑ y el 401 NO devuelve el secreto ni una pista de él", async () => {
    const res = await handleAvisoRepartoManana(req({ authorization: "Bearer wrong" }), {
      getSecret: () => SECRET,
      service: fakeService().service,
    });

    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });

  it("⭑ ANTI-VACUIDAD: CON el secreto correcto, el service SÍ se invoca", async () => {
    // Sin este caso, un handler que devolviera 401 siempre dejaría los cinco de arriba verdes.
    const { service, spy } = fakeService();

    const res = await handleAvisoRepartoManana(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("413/R35 — el cuerpo 200 lleva SÓLO conteos y fechas", () => {
  it("⭑ las claves son EXACTAMENTE las declaradas, ni una más", async () => {
    // Se enumeran a mano. El día que el servicio gane un campo con un id de orden, de persona o de
    // zona, este aserto se pone rojo ANTES de que ese id cruce a una respuesta que puede quedar en
    // un log de Vercel.
    const { service } = fakeService();

    const res = await handleAvisoRepartoManana(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      "avisosEmitidos",
      "diaAnunciado",
      "fallos",
      "fecha",
      "mensajerosBloqueados",
      "mensajerosConReparto",
    ]);
  });

  it("⭑ y los valores son los del resumen, sin transformar", async () => {
    const { service } = fakeService();

    const res = await handleAvisoRepartoManana(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });

    expect(await res.json()).toEqual({
      fecha: "2026-09-11",
      diaAnunciado: "2026-09-12",
      mensajerosConReparto: 7,
      mensajerosBloqueados: 1,
      avisosEmitidos: 6,
      fallos: 0,
    });
  });

  it("⭑⭑ un campo NUEVO con un id en el resumen NO cruza a la respuesta", async () => {
    // LA PRUEBA DE QUE LA ENUMERACIÓN CAMPO A CAMPO SIRVE PARA ALGO. Se le da al handler un
    // servicio que devuelve un resumen CON un id dentro; si el handler devolviera `resumen` entero
    // (que es la forma cómoda), ese id saldría. Devolviendo campo a campo, no sale.
    const conFuga = {
      ...RESUMEN,
      mensajeroIdMasCargado: "u-carlos-restrepo",
      ordenes: ["orden-1", "orden-2"],
    } as unknown as RepartoMananaResumen;
    const { service } = fakeService(vi.fn(async () => conFuga));

    const res = await handleAvisoRepartoManana(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
    });
    const crudo = JSON.stringify(await res.json());

    expect(crudo).not.toContain("u-carlos-restrepo");
    expect(crudo).not.toContain("orden-1");
    expect(crudo).not.toContain("mensajeroIdMasCargado");
  });

  it("el reloj de la corrida es inyectable, y llega al servicio tal cual", async () => {
    const { service, spy } = fakeService();
    const ahora = new Date("2026-09-12T01:00:00.000Z");

    await handleAvisoRepartoManana(req({ authorization: `Bearer ${SECRET}` }), {
      getSecret: () => SECRET,
      service,
      now: () => ahora,
    });

    expect(spy).toHaveBeenCalledWith(ahora);
  });
});

describe("413/R36 — el composition root de ESTE handler pasa el notificador REAL", () => {
  it("⭑ `notificarRepartoMananaReal` se PASA como argumento, no sólo se importa", () => {
    // La comprobación fuerte vive en `notificacion-notificadores-reales.test.ts`, sobre el fuente
    // SIN imports ni comentarios. Aquí se deja el aserto colocado con su handler, con el mismo
    // criterio: se mira el USO, no el `import`.
    const fuente = fs.readFileSync(
      path.join(ROOT, "app", "api", "cron", "aviso-reparto-manana", "route.ts"),
      "utf8",
    );
    const sinImports = fuente
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("import") && !l.trimStart().startsWith("//"))
      .join("\n");

    expect(sinImports).toContain("notificarRepartoMananaReal");
  });

  it("y construye el repositorio de cierres, sin el cual R42 no podría cumplirse", () => {
    const fuente = fs.readFileSync(
      path.join(ROOT, "app", "api", "cron", "aviso-reparto-manana", "route.ts"),
      "utf8",
    );
    const sinImports = fuente
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("import") && !l.trimStart().startsWith("//"))
      .join("\n");

    expect(sinImports).toContain("new OrdenRepository(prisma)");
    expect(sinImports).toContain("new RepartoMananaRepository(prisma)");
  });
});
