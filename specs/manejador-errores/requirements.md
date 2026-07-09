# Feature 10 — Manejador de errores global (backend) — requirements.md

## Contexto

El backend de Ordenex sigue el patron Controller (Server Action / Route Handler) ->
Service -> Repository (`docs/architecture.md`). Hoy cada capa comunica el resultado
con un objeto discriminado por un campo `status`:

- Los **services** (`OrdenService`, `AuthService`) devuelven resultados de dominio
  como `{ status: "ok", ... }`, `{ status: "validation_error", fieldErrors }`,
  `{ status: "forbidden" }`, `{ status: "not_found" }`, `{ status: "conflict" }`,
  etc. (ver `lib/interfaces/services/IOrdenService.ts`, `lib/types/orden.ts`,
  `lib/types/auth.ts`).
- Los errores **inesperados** se propagan con `throw` (p. ej. cualquier excepcion
  que no sea `NumRemisionDuplicadoError` en `OrdenService.crear`). Hoy nadie los
  captura de forma central: revientan como error 500 de Next sin forma comun.
- Errores de dominio tipados existentes: `NumRemisionDuplicadoError`,
  `CatalogoInvalidoError`, `UsuarioDuplicadoError`
  (`lib/interfaces/repositories/*`).

Esta feature crea, **sin migrar aun a los consumidores** (eso lo hara la feature 12),
un manejador de errores central que:

1. Define una **estructura de error comun y tipada** para todas las respuestas.
2. Provee un **wrapper central** que ejecuta la logica de un endpoint / Server
   Action, captura errores esperados e inesperados y los normaliza a esa estructura.
3. **Mapea** cada categoria de error (validacion, no autenticado, no autorizado,
   no encontrado, conflicto, error interno) a la estructura comun.
4. **No filtra detalles sensibles** (stack, mensajes internos, PII, secretos) en la
   respuesta de errores internos.
5. Es **compatible** con el contrato `{ status }` ya usado: la forma comun se expresa
   como una variante de resultado con `status: "error"` que convive con
   `status: "ok"` sin obligar a reescribir los tipos existentes.

Alcance: backend puro. No se toca UI, componentes ni paginas. No se cambia el
comportamiento funcional de features existentes.

---

## Requisitos (EARS)

### Estructura de error comun

**R1** — El sistema DEBE exponer un tipo comun de error de aplicacion (en adelante
`AppErrorShape`) que contenga, como minimo, los campos: `status` (literal `"error"`),
`code` (identificador estable de categoria, tipo enum de string), `message` (texto
legible y seguro para cliente) y `details` (opcional, estructurado; p. ej.
`fieldErrors`).

**R2** — El sistema DEBE definir un conjunto cerrado y tipado de codigos de error
(`AppErrorCode`) en notacion **UPPER_SNAKE**, que cubra al menos: `VALIDATION_ERROR`,
`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` e `INTERNAL`. Estos codigos son
**distintos** de los literales de `status` de dominio (`"validation_error"`,
`"unauthenticated"`, etc.) y no deben confundirse con ellos: el puente entre ambos lo
provee R16.

**R3** — El sistema DEBE asociar a cada `AppErrorCode` un codigo HTTP de referencia
(p. ej. `VALIDATION_ERROR`->422, `UNAUTHORIZED`->401, `FORBIDDEN`->403, `NOT_FOUND`->404,
`CONFLICT`->409, `INTERNAL`->500) accesible de forma programatica, sin acoplar la
estructura de error a HTTP en capas que no son HTTP.

**R4** — La estructura de error comun DEBE usar `status: "error"` como discriminante,
de modo que un resultado `{ status: "ok", ... }` y un resultado de error puedan
convivir en una union discriminada por `status` sin colisionar con los literales
`status` ya existentes (`"ok"`, `"validation_error"`, `"forbidden"`, `"not_found"`,
`"conflict"`, `"unauthenticated"`).

### Errores de dominio tipados

**R5** — El sistema DEBE proveer una clase base de error de aplicacion
(`AppError`) que lleve un `code: AppErrorCode` y un `message` seguro, de la que
puedan derivar errores de dominio especificos.

**R6** — CUANDO se instancie un `AppError` (o subclase) con un `code` dado, el sistema
DEBE poder producir su `AppErrorShape` correspondiente preservando `code`, `message`
y `details` (si los tuviera).

### Wrapper central de captura

**R7** — El sistema DEBE proveer una funcion/wrapper central (en adelante
`withErrorHandler`) que reciba una operacion asincrona (y, opcionalmente, un
`ErrorLogger` inyectado) y devuelva su resultado si tiene exito, o un `AppErrorShape`
normalizado si la operacion lanza.

**R8** — CUANDO la operacion envuelta se completa sin lanzar, el wrapper DEBE devolver
el valor original sin modificarlo (paso transparente, sin envolver el exito).

**R9** — CUANDO la operacion envuelta lanza una instancia de `AppError` (o subclase),
el wrapper DEBE devolver un `AppErrorShape` con el `code`, `message` y `details` de esa
instancia.

**R10** — CUANDO la operacion envuelta lanza un error de dominio conocido pero que NO
extiende `AppError` (p. ej. `NumRemisionDuplicadoError`, `UsuarioDuplicadoError`,
`CatalogoInvalidoError`), el wrapper DEBE mapearlo al `AppErrorCode` que corresponda
(`CONFLICT` para duplicados, `VALIDATION` para catalogo invalido) segun un registro de
mapeo declarado.

**R11** — CUANDO la operacion envuelta lanza un `ZodError`, el wrapper DEBE producir un
`AppErrorShape` con `code = VALIDATION` y colocar los `fieldErrors` aplanados en
`details`, sin exponer la traza interna.

**R12** — CUANDO la operacion envuelta lanza cualquier error NO reconocido (inesperado),
el wrapper DEBE producir un `AppErrorShape` con `code = INTERNAL` y un `message`
generico fijo (p. ej. "Error interno del servidor").

### No fuga de detalles sensibles

**R13** — SI el error normalizado es de codigo `INTERNAL`, ENTONCES el `AppErrorShape`
resultante NO DEBE contener el mensaje original de la excepcion, ni su `stack`, ni
`details` derivados de la excepcion cruda.

**R14** — El sistema DEBE registrar (log) el error original completo de un error
`INTERNAL` por un canal de servidor (no en la respuesta), sin incluir secretos ni PII
en el mensaje de log, para permitir diagnostico sin filtrarlo al cliente.

**R14a** — El sistema DEBE definir una interfaz minima de logging de errores
(`ErrorLogger`, con un metodo tipo `logError(...)`) que el manejador reciba por
**inyeccion**, y proveer una implementacion por defecto basada en `console.error` del
servidor. La inyeccion DEBE permitir enchufar otra implementacion (p. ej. Sentry o
Vercel) sin modificar el codigo del manejador ni de `normalizeError`.

**R14b** — CUANDO no se inyecta un `ErrorLogger`, el sistema DEBE usar la implementacion
por defecto (`console.error`) para registrar los errores `INTERNAL`.

**R15** — Para errores NO `INTERNAL` (validacion, no autenticado, no autorizado, no
encontrado, conflicto), el `message` del `AppErrorShape` DEBE ser un texto **fijo en
espanol**, controlado por el sistema, SIN capa de internacionalizacion (i18n) ni claves
de traduccion, y NUNCA la concatenacion directa de datos de entrada del usuario ni de
detalles de infraestructura.

### Compatibilidad con el contrato existente

**R16** — El sistema DEBE proveer un mapeo entre los `status` de dominio ya usados por
services/actions (`"validation_error"`, `"unauthenticated"`, `"forbidden"`,
`"not_found"`, `"conflict"`) y los `AppErrorCode` correspondientes, para que la
feature 12 pueda migrar los switch/case sin ambiguedad.

**R17** — El manejador NUEVO DEBE poder importarse y usarse sin modificar el
comportamiento observable de las Server Actions existentes (`login`, `verifyChallenge`,
`logout`, `crearOrden`, `obtenerOrden`, `listarOrdenes`, `actualizarOrden`,
`borrarOrden`); es decir, mientras un consumidor no lo adopte, sus resultados no
cambian.

**R18** — DONDE se use en un Route Handler (`app/api/**`), el sistema DEBE ofrecer un
helper que convierta un `AppErrorShape` en una respuesta HTTP (`NextResponse`) con el
codigo de estado derivado de R3 y el cuerpo igual al `AppErrorShape`.

### Calidad y tipado

**R19** — El manejador NO DEBE usar `any` sin justificacion explicita en comentario, y
DEBE compilar bajo TypeScript `strict` (consistente con `docs/conventions.md`).

**R20** — El manejador NO DEBE tener `catch` vacios: todo error capturado se normaliza,
se registra o se re-propaga con contexto (consistente con `docs/conventions.md`).

---

## Trazabilidad

Todos los requisitos R1..R20 se mapean a tests en `tasks.md` (bloque "Mapa R -> test").

---

## Preguntas abiertas (para el humano)

Resueltas por el humano e incorporadas al spec:

- Logging (R14/R14a/R14b): logger **inyectable** via interfaz `ErrorLogger`, con
  implementacion por defecto `console.error`.
- Codigos (R2): `AppErrorCode` en **UPPER_SNAKE**, distintos de los literales de dominio.
- Mensajes (R15): texto **fijo en espanol**, sin i18n.

- **Ubicacion canonica del codigo:** se propone `lib/errors/` (nuevo). Confirmar que no
  se prefiere `lib/utils/errors.ts` o `lib/types/errors.ts`.
