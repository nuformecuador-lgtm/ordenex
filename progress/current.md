# Sesión activa

> Estado vivo de lo que se está trabajando ahora. El leader lo mantiene al día.
> Al cerrar una feature, se resume en history.md y este archivo se limpia.

## Feature en curso
`ordenes` (id 6, HIGH) — Fase 2 (impl) en curso. Spec aprobada por el humano (44 req).
CRUD de órdenes (backend). `permissions` (3), `role seed` (4) y `home - sidebar` (5)
cerradas como `done`. Cola: `ordenes - list` (id 7, high) después.

Modelo aprobado: 6 tablas nuevas (order_status catálogo con seed 7 valores; geografía
jerárquica vacía zona→provincia→canton→distrito; orden). `orden`: num_guia
Int autoincrement unique, num_remision string unique (usuario), estatus FK→order_status
default `en_bodega`, tienda_id FK→Usuario not null, zona/provincia/canton_id NOT NULL,
distrito_id + notas nullable, producto, peso, telefono_dest, destinatario, soft delete,
created_at/updated_at. CRUD por rol (maestro/admin full; adminTienda solo lo suyo;
mensajero solo lee + cambia estatus).
DEPENDENCIA OPERATIVA documentada: geografía NOT NULL + tablas vacías → no se crean
órdenes hasta poblar zona/provincia/canton; tests siembran geografía en fixtures.

## Plan de la sesión
- [x] Ciclo SDD completo de login y login(home): spec → aprobación → impl → review → done.
- [x] Feature 3 `permissions`: spec → aprobación → impl → review → done.
- [x] Feature 4 `role seed`: spec → aprobación → impl → review → done.
- [x] Feature 5 `home - sidebar`: spec → aprobación → impl → review → done.
- [ ] Feature 6 `ordenes` (CRUD): spec → aprobación → impl → review → done.

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
