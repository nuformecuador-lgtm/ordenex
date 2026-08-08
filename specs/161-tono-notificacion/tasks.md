# Feature 161 — Tono breve para notificaciones in-app · tasks

`[P]` = puede ir en paralelo con las de su mismo bloque.

## T1 — Generador del tono
- [x] **T1.1** `lib/audio/tono-notificacion.ts`: constantes del tono, `obtenerContexto()`
      perezoso con guardas de SSR y de navegador sin soporte, `reproducirTono()` con dos
      osciladores y rampa de salida, `prepararAudio()` idempotente por gesto,
      `reiniciarAudioParaTests()`.
      **Hecho**: el módulo compila, no importa React y no lanza sin `AudioContext`.
- [x] **T1.2** `[P]` `lib/audio/preferencia-sonido.ts`: leer/guardar con `try/catch`,
      ausencia = activado.
      **Hecho**: devuelve `true` con almacenamiento roto y no lanza.

## T2 — Disparo
- [x] **T2.1** `hooks/useTonoAlIncrementar.ts` (depende de T1.1 y T1.2).
      **Hecho**: el primer dato cargado no suena; solo suena al subir; respeta la preferencia.
- [x] **T2.2** `hooks/usePreferenciaSonido.ts` con `useSyncExternalStore` (depende de T1.2).
      **Hecho**: sin discrepancia de hidratación y sin `setState` en efecto (`pnpm lint` es
      error, no aviso, para `react-hooks/set-state-in-effect`).

## T3 — Enganches (dependen de T2.1)
- [x] **T3.1** `components/shared/NotificationsBell.tsx`: llamada al hook con `noLeidas` +
      toggle `Volume2`/`VolumeX` en la cabecera del popover con nombre accesible.
- [x] **T3.2** `[P]` contar entrantes del hilo y pasarlos al hook. Se implementó en
      `ChatWhatsappPanel.tsx`; ese panel se borró el 2026-08-07 (`da544b30`, lo sustituye el chat
      flotante) **y el enganche se fue con él**: la feature quedó con una sola superficie y el
      mensajero dejó de oír el tono en producción. Repuesto en
      `chat/ChatConversacion.tsx` por `4a862356`, que es hoy la única superficie viva del hilo.

## T4 — Tests (trazabilidad R → test)

| R | Test |
|---|---|
| R1 | `tono-notificacion.test.ts` › no crea ningún `Audio` ni pide red |
| R2 | `tono-notificacion.test.ts` › emite dos notas, la segunda más aguda, total ≤ 300 ms |
| R3 | `tono-notificacion.test.ts` › cada nota programa una rampa de atenuación |
| R4 | `tono-notificacion.test.ts` › sin `AudioContext` no lanza ni emite |
| R5 | `tono-notificacion.test.ts` › dos reproducciones reutilizan el mismo contexto |
| R6 | `tono-notificacion.test.ts` › contexto suspendido dispara `resume` |
| R7 | `tono-notificacion.test.ts` › `prepararAudio` registra un solo listener aunque se llame varias veces |
| R8 | `tono-notificacion.test.ts` › el módulo se ejercita sin montar componentes (todo el archivo) |
| R9 | `tono-notificacion.test.ts` › sin `window` no crea contexto ni lanza |
| R10 | `useTonoAlIncrementar.test.tsx` › suena al subir el contador |
| R11 | `useTonoAlIncrementar.test.tsx` › la primera evaluación con dato cargado no suena |
| R12 | `useTonoAlIncrementar.test.tsx` › no suena al bajar ni al repetirse |
| R13 | `useTonoAlIncrementar.test.tsx` › un salto de 3 suena una sola vez |
| R14 | `useTonoAlIncrementar.test.tsx` › con preferencia en `off` no suena |
| R15 | `preferencia-sonido.test.ts` › sin valor guardado devuelve activado |
| R16 | `preferencia-sonido.test.ts` › lo guardado se recupera · `usePreferenciaSonido.test.tsx` › el cambio se refleja y se propaga entre pestañas |
| R17 | `preferencia-sonido.test.ts` › almacenamiento que lanza degrada a activado |
| R18 | `NotificationsBell.test.tsx` › el toggle expone su estado en el nombre accesible y persiste |
| R19 | `NotificationsBell.test.tsx` › suena cuando sube el total sin leer |
| R20 | `NotificationsBell.test.tsx` › marcar todas como leídas no suena |
| R21 | `ChatConversacionTono.test.tsx` › R21: un mensaje entrante nuevo en el refresco suena |
| R22 | `ChatConversacionTono.test.tsx` › R22: un saliente nuevo no suena |
| R23 | `ChatConversacionTono.test.tsx` › R23/R24: abrir el chat sobre un hilo con entrantes previos no suena |
| R24 | `useTonoAlIncrementar.test.tsx` › el primer dato cargado no suena; una lectura fallida no borra la referencia · `NotificationsBell.test.tsx` › no suena al montar aunque el servidor devuelva no leídas · `ChatConversacionTono.test.tsx` › R24: la PRIMERA carga del hilo no suena, aunque llegue con varios entrantes |

- [x] **T4.1** `tests/unit/audio/tono-notificacion.test.ts` (R1–R9).
- [x] **T4.2** `[P]` `tests/unit/audio/preferencia-sonido.test.ts` (R15–R17).
- [x] **T4.3** `[P]` `tests/unit/hooks/useTonoAlIncrementar.test.tsx` (R10–R14, R24).
- [x] **T4.3-bis** `[P]` `tests/unit/hooks/usePreferenciaSonido.test.tsx` (R15–R16, incluida
      la sincronización entre pestañas).
- [x] **T4.4** ampliar `tests/components/NotificationsBell.test.tsx` (R18–R20).
- [x] **T4.5** `[P]` R21–R23 del chat. Se escribieron dentro de
      `tests/components/ChatWhatsappPanel.test.tsx` y se borraron con el panel (`da544b30`), que es
      cómo esta feature perdió su prueba sin que nada se pusiera rojo. Recuperados y ampliados en
      `tests/components/ChatConversacionTono.test.tsx` (`4a862356`), que añade además el caso
      aislado de R24.

## T5 — Verificación
- [x] **T5.1** `pnpm test`: 6347 tests, 6333 verdes. Las 14 rojas son PREVIAS a esta feature
      (MisAsignacionesModule/Page: KPIs animados y filtros cantón/distrito, trabajo en curso
      de la rama `ux`); medido retirando el enganche del chat: mismas 14. `pnpm typecheck`
      limpio salvo 2 errores previos de los archivos `_Tmp*` sin commitear.
- [x] **T5.2** `pnpm lint`: 0 errores (11 avisos previos).
- [ ] **T5.3** En pantalla: campana suena una sola vez al llegar una notificación; marcar
      todas como leídas → silencio; toggle en off → silencio; recargar con no-leídas
      pendientes → **no** suena.
- [ ] **T5.4** En pantalla: chat flotante abierto sobre un hilo + entrante insertado en
      `chat_mensaje` → suena en el siguiente tick de 10 s. (Decía "panel de gestión abierto",
      que era la superficie de `ChatWhatsappPanel`; desde `da544b30` la superficie viva es
      `ChatFlotante` → `chat/ChatConversacion.tsx`, montado por `RepartoModule`.)
- [ ] **T5.5** MANUAL, no lo cubren los tests: móvil real. iOS Safari exige gesto y suspende
      el contexto al ir a background (design §6). No dar la feature por buena sin esto.
