import { describe, it, expect } from "vitest";

import { ENV_LOG_QUERIES, modoLogQueries } from "@/lib/db/prisma-client";

/** Un entorno mínimo, sin arrastrar el del proceso (que ya trae `NODE_ENV=test`). */
function entorno(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("log de consultas — apagado por defecto", () => {
  it("sin la variable no se imprime nada", () => {
    expect(modoLogQueries(entorno({}))).toBe("off");
  });

  it.each(["", "  ", "0", "false", "off"])("«%s» cuenta como apagado", (valor) => {
    expect(modoLogQueries(entorno({ [ENV_LOG_QUERIES]: valor }))).toBe("off");
  });
});

describe("log de consultas — encendido", () => {
  it.each(["1", "true", "sql", "SQL", " yes "])(
    "«%s» imprime la sentencia, pero NO los parámetros",
    (valor) => {
      expect(modoLogQueries(entorno({ [ENV_LOG_QUERIES]: valor }))).toBe("sql");
    },
  );

  // Los parámetros son un nivel aparte y hay que pedirlos POR SU NOMBRE: llevan datos
  // reales (un `where` del buscador arrastra teléfono y nombre del destinatario). La
  // mutación que este caso mata es tratarlos como un extra del interruptor general.
  it.each(["params", "PARAMS", " params "])("«%s» añade los parámetros", (valor) => {
    expect(modoLogQueries(entorno({ [ENV_LOG_QUERIES]: valor }))).toBe("params");
  });
});

// El candado que de verdad importa: en producción un log por consulta es factura de
// ingesta y ruido que entierra los errores reales. Encenderlo ahí debe costar un
// despliegue, no una variable de entorno cambiada en caliente.
describe("log de consultas — en producción NUNCA", () => {
  it.each(["1", "sql", "params", "true"])(
    "con NODE_ENV=production, «%s» sigue apagado",
    (valor) => {
      expect(
        modoLogQueries(entorno({ NODE_ENV: "production", [ENV_LOG_QUERIES]: valor })),
      ).toBe("off");
    },
  );

  // Anti-vacío: el mismo valor SÍ enciende fuera de producción. Sin esto, el bloque de
  // arriba pasaría igual con una función que devolviera "off" siempre.
  it("el mismo valor sí enciende en desarrollo", () => {
    expect(
      modoLogQueries(entorno({ NODE_ENV: "development", [ENV_LOG_QUERIES]: "params" })),
    ).toBe("params");
  });
});
