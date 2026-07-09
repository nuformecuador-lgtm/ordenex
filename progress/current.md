# Sesión activa

> Estado vivo de lo que se está trabajando ahora. El leader lo mantiene al día.
> Al cerrar una feature, se resume en history.md y este archivo se limpia.

## Feature en curso
_(ninguna)_ — `permissions` (3), `role seed` (4), `home - sidebar` (5) y `ordenes`
(6, CRUD backend) cerradas como `done` (ver history.md), más la tarea ad-hoc del
usuario maestro.

Cola pendiente:
- `ordenes - list` (id 7, high): tabla reutilizable data-driven que consume el CRUD.
- `componente carga masiva` (id 8, high): componente de subida de archivo (tipo +
  ruta API + descargar plantilla + cargar).
DEPENDENCIA OPERATIVA viva de la feature 6: geografía NOT NULL con tablas vacías → no
se pueden crear órdenes hasta poblar zona/provincia/canton (tests usan fixtures).

## Plan de la sesión
- [x] Ciclo SDD completo de login y login(home): spec → aprobación → impl → review → done.
- [x] Feature 3 `permissions`: spec → aprobación → impl → review → done.
- [x] Feature 4 `role seed`: spec → aprobación → impl → review → done.
- [x] Feature 5 `home - sidebar`: spec → aprobación → impl → review → done.
- [x] Feature 6 `ordenes` (CRUD): spec → aprobación → impl → review → done.

## Notas / decisiones tomadas
- Modelos legacy de AGENTS.md (sonnet-4/opus-4.8) mapeados a sonnet/opus/haiku.
- Decisión del humano (2026-07-09): TODOS los agentes con `opus`, ignorando la
  gradación por complexity (la tabla resuelve a opus en todas las columnas).
- frontend_dev escalado de haiku a sonnet en login(home) por verificación falsa.

## Bloqueos / preguntas abiertas
- DEUDA DE DESPLIEGUE (aceptada, requiere entorno con DB real): ejecutar E2E de
  auth en verde (T017), verificar rechazo RLS con key anon (T004) y rollback de
  migración (T020). Hasta correrlos, CHECKPOINTS no se cumple al 100% pese al
  estado `done`.
