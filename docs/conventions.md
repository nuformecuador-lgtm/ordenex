# docs/conventions.md — Estilo, nombres y errores

## TypeScript
- `strict: true`. Prohibido `any` salvo justificación explícita en comentario.
- Tipos de dominio en `lib/types.ts` o colocados junto al módulo que los usa.
- Validación de entrada externa con un validador (p. ej. zod) en el borde.

## Nombres
- Archivos: `kebab-case.ts`. Componentes React: `PascalCase.tsx`.
- Funciones y variables: `camelCase`. Constantes de entorno: `UPPER_SNAKE`.
- Tablas y columnas Supabase: `snake_case`.

## Estilo
- Formateo con la config del repo (Prettier/ESLint). No se discute manualmente.
- Funciones cortas y con una sola responsabilidad. Si necesita comentario para
  explicar qué hace, probablemente hay que partirla.

## Manejo de errores
- Nada de `catch` vacíos. Un error o se maneja o se propaga con contexto.
- Errores de integración externa se envuelven con un mensaje que diga qué
  operación falló y con qué entrada (sin filtrar secretos).
- En webhooks y crons, todo error relevante notifica por el canal definido.

## Commits
- Un commit por task lógica completada, no un mega-commit al final.
- Mensaje: `feat(<feature>): <qué>` / `fix(...)` / `test(...)` / `chore(...)`.

## Tests
- Nombre del test describe el comportamiento, no la función:
  `devuelve 401 cuando el token es invalido`, no `test handler`.
- Cada requisito `R<n>` del spec tiene su test correspondiente.
