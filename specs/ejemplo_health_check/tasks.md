# Tasks — ejemplo_health_check

- [ ] T001 Crear `app/api/health/route.ts` con el handler GET.
- [ ] T002 Añadir helper de ping a Supabase con timeout de 2s en `lib/supabase/health.ts`.
- [ ] T003 [P] Test: 200 y cuerpo correcto cuando la DB responde (R1, R2).
- [ ] T004 [P] Test: 503 cuando el ping falla o hace timeout (R3).
- [ ] T005 Test: la respuesta de error no filtra secretos ni detalles internos (R4).
- [ ] T006 Correr typecheck + lint + test en verde y registrar salida en progress/impl_ejemplo_health_check.md.
