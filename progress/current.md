# Sesión activa

> Estado vivo de lo que se está trabajando ahora. El leader lo mantiene al día.
> Al cerrar una feature, se resume en history.md y este archivo se limpia.

## Feature en curso
_(ninguna)_ — `login` y `login(home)` cerradas como `done` (ver history.md).
No quedan features `pending` en feature_list.json.

## Plan de la sesión
- [x] Ciclo SDD completo de login y login(home): spec → aprobación → impl → review → done.

## Notas / decisiones tomadas
- Modelos legacy de AGENTS.md (sonnet-4/opus-4.8) mapeados a sonnet/opus/haiku.
- frontend_dev escalado de haiku a sonnet en login(home) por verificación falsa.

## Bloqueos / preguntas abiertas
- DEUDA DE DESPLIEGUE (aceptada, requiere entorno con DB real): ejecutar E2E de
  auth en verde (T017), verificar rechazo RLS con key anon (T004) y rollback de
  migración (T020). Hasta correrlos, CHECKPOINTS no se cumple al 100% pese al
  estado `done`.
