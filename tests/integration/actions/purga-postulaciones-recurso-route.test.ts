import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import type {
  IPurgaPostulacionRecursoService,
  PurgaPostulacionRecursoResultado,
} from "@/lib/interfaces/services/IPurgaPostulacionRecursoService";
import { handlePurgaPostulacionesRecurso } from "@/app/api/cron/purga-postulaciones-recurso/route";

// Feature 253 (P2) — el Controller del cron de purga.
//
// ⚠️ ES UN ENDPOINT QUE BORRA. Por eso la mitad de este archivo es sobre la AUTORIZACION: que sin
// secreto, con secreto equivocado o con el secreto sin configurar el endpoint no llegue ni a
// construir el service. En un endpoint que borra, esa precedencia es la diferencia entre un 401 y
// una perdida de datos.

const SECRETO = "secreto-de-prueba";

function serviceDoble(
  resultado: Partial<PurgaPostulacionRecursoResultado> = {},
): { service: IPurgaPostulacionRecursoService; ejecutar: ReturnType<typeof vi.fn> } {
  const ejecutar = vi.fn().mockResolvedValue({
    borradas: 0,
    corte: "2026-02-20T09:00:00.000Z",
    quedaPendiente: false,
    ...resultado,
  });
  return { service: { ejecutar }, ejecutar };
}

function peticion(authorization?: string): Request {
  return new Request("https://ordenex.app/api/cron/purga-postulaciones-recurso", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("253 / P2 — autorizacion ANTES de cualquier borrado", () => {
  it.each([
    ["sin cabecera", undefined],
    ["cabecera vacia", ""],
    ["sin el esquema Bearer", SECRETO],
    ["con otro token", "Bearer otro-secreto"],
    ["Bearer sin token", "Bearer "],
  ])("%s -> 401 y el service NI SE LLAMA", async (_caso, authorization) => {
    const { service, ejecutar } = serviceDoble();
    const res = await handlePurgaPostulacionesRecurso(peticion(authorization), {
      service,
      getSecret: () => SECRETO,
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it.each([
    ["no configurado", null],
    ["configurado vacio", ""],
  ])(
    "con el secreto %s en el entorno, NADIE puede disparar la purga (fallo seguro)",
    async (_caso, secreto) => {
      const { service, ejecutar } = serviceDoble();
      const res = await handlePurgaPostulacionesRecurso(peticion(`Bearer ${secreto ?? ""}`), {
        service,
        getSecret: () => secreto,
      });

      expect(res.status).toBe(401);
      expect(ejecutar).not.toHaveBeenCalled();
    },
  );

  it("con el secreto correcto: 200 y UNA corrida", async () => {
    const { service, ejecutar } = serviceDoble({ borradas: 4 });
    const res = await handlePurgaPostulacionesRecurso(peticion(`Bearer ${SECRETO}`), {
      service,
      getSecret: () => SECRETO,
    });

    expect(res.status).toBe(200);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});

describe("253 / P2 — la respuesta es auditable y NO lleva PII (R19)", () => {
  it("solo conteos y el corte en ISO", async () => {
    const { service } = serviceDoble({
      borradas: 12,
      corte: "2026-02-20T09:00:00.000Z",
      quedaPendiente: true,
    });
    const res = await handlePurgaPostulacionesRecurso(peticion(`Bearer ${SECRETO}`), {
      service,
      getSecret: () => SECRETO,
    });

    const cuerpo = (await res.json()) as Record<string, unknown>;
    expect(cuerpo).toEqual({
      borradas: 12,
      corte: "2026-02-20T09:00:00.000Z",
      quedaPendiente: true,
    });
    // Ni ids, ni nombres, ni correos, ni el secreto.
    expect(JSON.stringify(cuerpo)).not.toContain(SECRETO);
  });

  it("el reloj se inyecta y llega al service tal cual (el corte lo calcula el service)", async () => {
    const { service, ejecutar } = serviceDoble();
    const now = new Date("2026-08-20T09:00:00.000Z");
    await handlePurgaPostulacionesRecurso(peticion(`Bearer ${SECRETO}`), {
      service,
      getSecret: () => SECRETO,
      now: () => now,
    });
    expect(ejecutar).toHaveBeenCalledWith(now);
  });

  it("un fallo del service sale con codigo de error, no con un 200 mentiroso", async () => {
    const service: IPurgaPostulacionRecursoService = {
      ejecutar: vi.fn().mockRejectedValue(new Error("la base se cayo")),
    };
    const res = await handlePurgaPostulacionesRecurso(peticion(`Bearer ${SECRETO}`), {
      service,
      getSecret: () => SECRETO,
    });

    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe("253 / P2 — el cron esta REGISTRADO y no pisa a los demas", () => {
  const RAIZ = path.join(__dirname, "..", "..", "..");
  const vercel = JSON.parse(fs.readFileSync(path.join(RAIZ, "vercel.json"), "utf8")) as {
    crons: { path: string; schedule: string }[];
  };

  it("aparece en vercel.json con su ruta exacta", () => {
    const entrada = vercel.crons.find(
      (c) => c.path === "/api/cron/purga-postulaciones-recurso",
    );
    expect(entrada).toBeDefined();
    // Diario. Un cron de borrado que corriera cada minuto seria una forma nueva de hacer dano.
    expect(entrada?.schedule).toBe("30 9 * * *");
  });

  it("el archivo de ruta existe donde vercel.json dice", () => {
    expect(
      fs.existsSync(
        path.join(RAIZ, "app", "api", "cron", "purga-postulaciones-recurso", "route.ts"),
      ),
    ).toBe(true);
  });

  it("no se le quito el cron a nadie al anadir este", () => {
    // Los SIETE que ya estaban registrados el 2026-08-20, verificados en `vercel.json` antes de
    // tocarlo. Se comprueba que SIGUEN, no que la lista sea exactamente esta: una ficha futura que
    // anada un cron no tiene por que poner rojo a la 253.
    //
    // ⚠️ `app/api/cron/liberar-reprogramadas/route.ts` EXISTE en el arbol y NO esta en
    // `vercel.json` — no es algo que esta ficha haya cambiado, pero se anota aqui porque al
    // escribir este test se descubrio y no conviene que se pierda.
    const rutas = vercel.crons.map((c) => c.path);
    for (const previo of [
      "/api/cron/corte-diario",
      "/api/cron/generar-gastos-fijos",
      "/api/cron/procesar-jobs",
      "/api/cron/procesar-devueltas-sla",
      "/api/cron/sync-plantillas-whatsapp",
      "/api/cron/purga-pdf-cargas",
      "/api/cron/snapshot-ranking",
    ]) {
      expect(rutas).toContain(previo);
    }
    expect(rutas).toContain("/api/cron/purga-postulaciones-recurso");
    // Y ninguna ruta duplicada: dos entradas para el mismo path serian dos corridas diarias.
    expect(new Set(rutas).size).toBe(rutas.length);
  });
});
