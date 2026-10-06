import { z } from "zod";

// Mensajes POR DEFECTO de zod en español claro, para TODA la app.
//
// Sin esto, cualquier schema sin mensaje propio respondía con el texto de zod en inglés y con su
// jerga («Too small: expected string to have >=1 characters»), y ese texto llegaba tal cual al
// usuario: en los errores de campo de las server actions (`normalizeError` aplana el ZodError) y en
// la validación de cliente de los formularios que reusan el schema.
//
// Se engancha como `localeError`, el escalón MÁS BAJO de zod v4: un mensaje propio del schema
// (`z.string().min(1, "Escribe un nombre")`) o el `error` de un `parse` siguen mandando por encima.
// Esto solo sustituye al texto genérico, nunca a uno redactado a propósito.
//
// zod 4 guarda esta configuración en `globalThis.__zod_globalConfig`: la comparten todas las
// copias de zod de un mismo proceso (y de una misma pestaña), aunque el bundler las duplique. Por
// eso basta con cargar este módulo UNA vez por lado, y se carga desde dos sitios:
//   - servidor: `instrumentation.ts` (`register`, corre antes de atender ninguna petición);
//   - cliente: `components/shared/ZodEnEspanol.tsx`, montado en el layout raíz.
// Hay un test que comprueba que los dos lo cargan, no solo que exista.

/** Texto genérico para lo que no tiene una redacción mejor. */
export const MENSAJE_VALOR_NO_VALIDO = "El valor no es válido";
export const MENSAJE_OBLIGATORIO = "Este campo es obligatorio";

type Issue = Parameters<z.core.$ZodErrorMap>[0];

function numero(n: unknown): string {
  return typeof n === "bigint" ? n.toString() : String(n);
}

function cantidadOpciones(n: string): string {
  return n === "1" ? "una opción" : `${n} opciones`;
}

/** El mapa de errores en español. Exportado para el test. */
export function mensajeZodEs(issue: Issue): string {
  switch (issue.code) {
    case "invalid_type": {
      if (issue.input === undefined || issue.input === null) return MENSAJE_OBLIGATORIO;
      if (issue.expected === "int") return "Debe ser un número entero";
      if (issue.expected === "number" || issue.expected === "bigint") return "Debe ser un número";
      if (issue.expected === "date") return "La fecha no es válida";
      return MENSAJE_VALOR_NO_VALIDO;
    }
    case "too_small": {
      const n = numero(issue.minimum);
      switch (issue.origin) {
        case "string":
          if (n === "1" && issue.inclusive !== false) return MENSAJE_OBLIGATORIO;
          if (issue.exact) return `Debe tener exactamente ${n} caracteres`;
          return `Debe tener al menos ${n} caracteres`;
        case "number":
        case "int":
        case "bigint":
          return issue.inclusive === false ? `Debe ser mayor que ${n}` : `Debe ser como mínimo ${n}`;
        case "array":
        case "set":
          return `Elige al menos ${cantidadOpciones(n)}`;
        case "file":
          return "El archivo es demasiado pequeño";
        case "date":
          return "La fecha es anterior a la permitida";
        default:
          return MENSAJE_VALOR_NO_VALIDO;
      }
    }
    case "too_big": {
      const n = numero(issue.maximum);
      switch (issue.origin) {
        case "string":
          if (issue.exact) return `Debe tener exactamente ${n} caracteres`;
          return `No puede tener más de ${n} caracteres`;
        case "number":
        case "int":
        case "bigint":
          return issue.inclusive === false ? `Debe ser menor que ${n}` : `Debe ser como máximo ${n}`;
        case "array":
        case "set":
          return `Puedes elegir como máximo ${cantidadOpciones(n)}`;
        case "file":
          return "El archivo es demasiado grande";
        case "date":
          return "La fecha es posterior a la permitida";
        default:
          return MENSAJE_VALOR_NO_VALIDO;
      }
    }
    case "invalid_format":
      return issue.format === "email" ? "Escribe un correo válido" : "El formato no es válido";
    case "invalid_value":
      return "Elige una opción válida";
    case "not_multiple_of":
      return `Debe ser múltiplo de ${numero(issue.divisor)}`;
    default:
      return MENSAJE_VALOR_NO_VALIDO;
  }
}

/** Idempotente: cargarlo dos veces deja la misma configuración. */
export function configurarZodEnEspanol(): void {
  z.config({ localeError: mensajeZodEs });
}

configurarZodEnEspanol();
