# Feature 161 — Tono breve para notificaciones in-app · implementación

**Fecha:** 2026-07-30 · **Rama base:** `ux` (árbol de trabajo con cambios ajenos sin commitear)
**Estado:** implementada y verificada por tests; verificación en pantalla y en móvil PENDIENTE.

## De dónde sale

Pregunta del humano: *¿cómo agrego un tono breve para notificaciones, o Google trae algo por
defecto?* La respuesta que define la feature: **no hay API para invocar el tono del sistema
desde JS**. El tono nativo solo existe con la Notification API (registrada como **feature
162**, no implementada por decisión explícita). Para el aviso in-app hay que generar el
sonido, y se sintetiza en vez de enviar un archivo (D2).

Alcance cerrado antes del spec: campana + chat del mensajero; toasts fuera.

## Archivos

**Nuevos**
- `lib/audio/tono-notificacion.ts` — generador (dos osciladores, rampa de salida, desbloqueo
  por primer gesto, singleton perezoso). Sin React.
- `lib/audio/preferencia-sonido.ts` — preferencia por dispositivo en `localStorage`.
- `hooks/usePreferenciaSonido.ts` — la preferencia como fuente externa
  (`useSyncExternalStore`), para no romper la hidratación ni incumplir
  `react-hooks/set-state-in-effect`, que en este repo es **error**.
- `hooks/useTonoAlIncrementar.ts` — disparo por delta del contador.
- `specs/161-tono-notificacion/{requirements,design,tasks}.md`.
- Tests: `tests/unit/audio/{tono-notificacion,preferencia-sonido}.test.ts`,
  `tests/unit/hooks/{useTonoAlIncrementar,usePreferenciaSonido}.test.tsx`.

**Modificados**
- `components/shared/NotificationsBell.tsx` — llamada al hook + toggle `Volume2`/`VolumeX`
  en la cabecera del popover.
- `app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx` — cuenta entrantes y los
  pasa al hook (3 líneas efectivas).
- `tests/components/{NotificationsBell,ChatWhatsappPanel}.test.tsx` — bloques nuevos.
- `feature_list.json` — altas 161 y 162 (solo altas, LF).

## Requisito nuevo que apareció implementando: R24

El diseño inicial decía "el primer render no suena". **Estaba mal**: el primer render ocurre
ANTES de que resuelva el fetch, así que la línea base era 0 y la primera carga se leía como
un salto de 0 a N — es decir, abrir un hilo con mensajes previos sonaba, y recargar la página
con avisos pendientes también. **Lo detectó el test de R23, no el diseño.**

Corrección: el contador es `number | null`; `null` = dato no disponible y se ignora sin fijar
referencia. Se sale ANTES de tocar la referencia a propósito: si `null` la sobrescribiera, la
subida real siguiente se leería como "primera evaluación" y el aviso se perdería en silencio.
Quedó como **R24** en requirements y §2.2 del design.

## Trazabilidad

R1–R24 mapeados uno a uno en `specs/161-tono-notificacion/tasks.md` §T4. Ningún requisito sin
test.

## Verificación ejecutada

- `pnpm vitest run` de los 5 archivos de la feature: **72 verdes**.
- `pnpm test` completo: **6347 tests, 6333 verdes, 14 rojas**. Las 14 son **PREVIAS**, no de
  esta feature: `MisAsignacionesModule.test.tsx` (13) y `MisAsignacionesPage.test.tsx` (1),
  por los KPIs animados (`KpiValorAnimado`, archivo sin commitear) y los filtros
  cantón/distrito de la 117, ambos trabajo en curso de la rama `ux`. **Medido, no supuesto**:
  retirando el enganche del chat y volviendo a correr esos dos archivos salen las **mismas
  14**.
- `pnpm typecheck`: limpio salvo 2 errores previos de `_TmpSincronizarPlantillasButton.tsx` y
  `_TmpProbarJobsButton.tsx`, que importan módulos de acciones inexistentes (WIP ajeno).
- `pnpm lint`: **0 errores**, 11 avisos previos.

### 7 mutaciones, las 7 muertas

| Mutación | Rojos |
|---|---|
| M1 quitar la guarda de dato no disponible | 1 |
| M2 quitar la guarda de primera evaluación | 12 |
| M3 sonar también al bajar (`===` en vez de `<=`) | 4 |
| M4 ignorar la preferencia de silencio | 3 |
| M5 la campana pasa el conteo crudo, sin mirar carga/error | 1 |
| M6 el chat pasa el conteo sin esperar a que cargue el hilo | 3 |
| M7 el chat cuenta todos los mensajes, no solo los entrantes | 1 |

M1 es la que importa metodológicamente: **en su primera versión sobrevivió**, porque
`null <= n` coacciona a 0 y el resultado coincidía. El test se reescribió para atacar lo que
la guarda realmente protege —no perder la referencia tras un fallo transitorio— y entonces
murió.

## Lo que NO está verificado

- **En pantalla**: no se levantó la app. Los tests prueban CUÁNDO se pide el tono, no que se
  oiga.
- **Móvil real, en particular iOS Safari**: exige gesto y suspende el contexto al pasar a
  background. R6 lo mitiga, pero es la prueba que vale y está sin hacer (T5.5).
- **Modo oscuro y lectores de pantalla** para el toggle nuevo.

## Límite de la feature, declarado y no disimulado

`ChatWhatsappPanel` solo está montado mientras el mensajero tiene abierto el panel de gestión
de ESA orden. **Con el panel cerrado no hay polling del hilo y no suena nada.** El aviso
global "te llegó un mensaje" exigiría un contador real de no leídos: el de
`chat-demo/chat-demo-data.ts` es dato quemado y no hay tabla equivalente a
`notificacion_lectura` para mensajes de chat. Es otra feature.

Tampoco suena para el mensajero por la campana: `specs/146-campana-notificaciones/design.md:506`
deja el rol `mensajero` fuera de su alcance, así que hoy no recibe nada por ahí.
