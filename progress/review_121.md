# Review — Feature 121: Ubicación compartida por el cliente en el chat de WhatsApp

> Reviewer del arnés SDD. Rama `flow`. Spec `specs/121-ubicacion-chat-whatsapp/`.
> Fecha: 2026-07-24. NO se editó código; solo verificación.

## Veredicto: **APROBADO** (0 bloqueantes)

Feature aditiva sobre la 120, correctamente implementada backend + frontend. Los 16
requisitos EARS están cubiertos por tests reales (no vacíos), 156/156 verdes, typecheck
limpio para los archivos de la 121, decisiones F1.4 (P1/P2/P3) y D1/D2 respetadas.

---

## Checklist CHECKPOINTS / arnés

- [x] `requirements.md` (16 R EARS), `design.md` (5 alternativas descartadas), `tasks.md` con mapa R→test.
- [x] Cada R1–R16 mapea a un test concreto que lo ejercita (verificado abriendo los tests).
- [x] `progress/impl_121_backend.md` + `impl_121_frontend.md` contienen el mapa R→test.
- [x] Typecheck: 0 errores atribuibles a la 121 (25 errores totales, TODOS ajenos — ver abajo).
- [x] Tests de la feature + ripple 120: 156/156 verdes.
- [x] Migración versionada con `down.sql` (patrón enum recreado, feature 106).
- [x] Sin secretos nuevos; sin variables de entorno nuevas (design §6).
- [x] Webhook conserva firma/idempotencia de la 120 (dedupe por `wa_message_id` intacto).
- [x] Capas separadas: borde tipado (zod) → service → repo (solo Prisma) → action → UI.
- [x] Sin `console.*` con PII (coords/número) en los 5 archivos núcleo de la 121.
- [x] RLS: migración aditiva, no toca RLS (heredada de la 120).
- [ ] Bookkeeping del leader pendiente (tasks `[ ]`, history) — no bloqueante, ver deuda.

## Tabla R → test

| R | Cubierto | Test |
| --- | --- | --- |
| R1 | Sí | `whatsapp-webhook.test.ts` :: R1 normaliza type=location a tipo ubicacion con lat/lng |
| R2 | Sí | `whatsapp-webhook.test.ts` :: R2 descarta name/address sin romper el parseo |
| R3 | Sí | `whatsapp-webhook.test.ts` :: `esCoordenadaValida` (rango/NaN/Infinity) + 3 casos R3 degrada a otro |
| R4 | Sí | `chat-whatsapp-service.test.ts` R4 + `chat-mensaje-repository.test.ts` persiste lat/lng |
| R5 | Sí | service R5/R6 deduplicada no re-sella + repo dedupe (count 0) omite reenvío |
| R6 | Sí | service R6 entrante nuevo sella `ultimo_entrante_at`; deduplicado no re-sella |
| R7 | Sí | `chat-mensaje-ubicacion-migration.test.ts` (ADD VALUE/IF NOT EXISTS/55P04, DROP COLUMN, enum recreado, schema) |
| R8 | Sí | `chat-whatsapp-actions.test.ts` R8 lat/lng en ubicacion y null en los demás |
| R9 | Sí | `ChatWhatsappPanel.test.tsx` burbuja de ubicación = botón clicable, texto no |
| R10 | Sí | `ChatWhatsappPanel.test.tsx` abre Dialog con minimapa |
| R11 | Sí | `ChatWhatsappPanel.test.tsx` GPS lazy al abrir → 2 puntos al minimapa |
| R12 | Sí | `ChatWhatsappPanel.test.tsx` sin GPS: 1 punto + aviso, no bloquea + `UbicacionMapa.test.tsx` 1 marcador |
| R13 | Sí | `ChatWhatsappPanel.test.tsx` cierra (Escape) sin recargar, hilo vivo |
| R14 | Sí | `UbicacionMapa.test.tsx` `next/dynamic({ ssr:false })` capturado + 2 marcadores |
| R15 | Sí | webhook/service `no vuelca lat/lng ni número a console` + panel `no vuelca coordenadas` (queryByText null) |
| R16 | Sí | `chat-whatsapp-actions.test.ts` R16 forbidden hilo de otro mensajero (scope reutilizado) |

## Decisiones F1.4 / D1-D2 (verificadas en código)

- **P1 (solo lat/lng):** `metaMessageSchema.location` valida solo `latitude/longitude`; el strip
  zod descarta `name`/`address`. El insert solo lleva `latitud`/`longitud`. Cumple.
- **P2 (burbuja text-xs + pin):** `ChatWhatsappPanel.tsx` L125-139 → botón `MapPin` + "Ubicación
  compartida" en `text-xs`, `aria-label`, coords solo en `onClick`, nunca al DOM. Cumple.
- **P3 (GPS lazy al abrir):** `abrirUbicacion()` llama `pedirUbicacion()` al pulsar la burbuja,
  no al montar el panel. Cumple.
- **D1 (GPS en vivo, no bloqueante):** `useUbicacionActual` (`Coords {lat,lng}` = `UbicacionPunto`);
  aviso `role=status` con copy según `denegado` si resuelve `null`. Cumple.
- **D2 (solo visualizar):** no hay botón de adopción de coordenadas; el service no toca envío. Cumple.

## Componente nuevo `components/ui/dialog.tsx` (superficie reutilizable)

- Modelado sobre `@base-ui/react/dialog` (mismo primitivo que `sheet.tsx`), NO radix. Consistente
  con el stack. `@base-ui/react` YA es dependencia declarada en `package.json` (^1.6.0): sin deps nuevas.
- Accesibilidad: `Dialog.Root/Portal/Backdrop/Popup` de base-ui aporta focus trap + Escape (test R13
  confirma cierre por Escape); `DialogTitle`/`DialogDescription` cablean aria; botón de cierre con
  `aria-label="Cerrar"` + `sr-only`. Sin hallazgos.

## Hallazgos

### Bloqueantes (MAYORES): ninguno.

### Menores (deuda, no bloqueantes):

1. **menor — migración no aplicada contra DB real.** El test R7 (`chat-mensaje-ubicacion-migration.test.ts`)
   valida la FORMA estática del SQL por regex (patrón heredado de la 106), no un
   apply/rollback real. Los criterios "Hecho" de A2/A3 en `tasks.md` ("la migración aplica en DB
   de test", "`pnpm db:rollback` deja el esquema como antes") no se ejecutaron; el impl documenta
   aplicación manual post-merge (igual que la 120, `.env` = DB compartida). Consistente con la
   práctica del repo, pero CHECKPOINTS pide que `db:rollback` funcione: queda pendiente ejecutarlo
   al aplicar la migración en el aterrizaje. La forma up/down es correcta (GOTCHA 55P04, `IF NOT
   EXISTS`, enum recreado sin `ubicacion`, precondición 0 filas documentada).

2. **menor — bookkeeping del leader.** `tasks.md` conserva las casillas en `[ ]` (CHECKPOINTS pide
   `[x]`); `progress/impl_121.md` se dividió en `impl_121_backend.md` + `impl_121_frontend.md` (G2
   nombra un único archivo). No afecta código ni trazabilidad (el mapa R→test está completo en ambos).
   Corresponde al leader marcarlas y añadir la entrada a `progress/history.md`.

## Salida de verificación (real)

Tests (feature 121 + ripple 120):
```
pnpm vitest run tests/unit/types/whatsapp-webhook.test.ts \
  tests/unit/services/chat-whatsapp-service.test.ts \
  tests/unit/repositories/chat-mensaje-repository.test.ts \
  tests/unit/actions/chat-whatsapp-actions.test.ts \
  tests/integration/db/chat-mensaje-ubicacion-migration.test.ts \
  tests/unit/repositories/chat-conversacion-repository.test.ts \
  tests/components/ChatWhatsappPanel.test.tsx \
  tests/components/UbicacionMapa.test.tsx \
  tests/components/MisAsignacionesModule.test.tsx
=> Test Files  9 passed (9) | Tests  156 passed (156)
```

Typecheck (`pnpm exec tsc --noEmit`): 25 errores totales, **0 de la 121**. Todos ajenos, WIP de
otras sesiones en `flow`:
- `lib/auth/google-adc-token.ts`, `lib/auth/google-wif-token.ts` -> `google-auth-library` / `@vercel/oidc` sin instalar.
- `tests/unit/auth/middleware.test.ts` -> `Promise<NextResponse>` (middleware modificado por otra sesión).

Filtro sobre archivos de la 121 (whatsapp-webhook / ChatMensaje / ChatWhatsapp / Ubicacion /
dialog / ubicacion-mapa): 0 errores.

`./init.sh` completo NO se corrió: la rama `flow` lo pone rojo por el ruido ajeno de typecheck
descrito arriba (no-121). Se midieron los tests de la feature en su lugar (briefing).
