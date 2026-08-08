# Feature 161 — Tono breve para notificaciones in-app · design

> ## ⚠️ UNA DE LAS DOS SUPERFICIES DE ESTE DISEÑO YA NO EXISTE
>
> **Qué pasó (2026-08-07):** el commit `da544b30` borró
> `app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx` —decisión humana correcta: lo
> sustituye el chat flotante—. Ese panel era una de las **dos** superficies que D1 declara y uno de
> los dos consumidores del hook: **el enganche del tono se fue con él**, y con él se fue también su
> archivo de test, donde vivía el bloque R21–R23. El mensajero dejó de oír el tono del chat y así
> salió a producción (release #314). Lo encontró una tarea de contabilidad horas después, no una
> alerta.
>
> **Dónde vive hoy:** el enganche está repuesto en
> `app/(app)/mis-asignaciones/_components/chat/ChatConversacion.tsx` (`4a862356`, PR #318), dentro
> de `ChatFlotante` y montado por `RepartoModule`. Se verificó que tiene la misma forma que el panel
> borrado: mismo `listarHiloChat` con polling de 10 s, mismo `hiloOk` y mismos mensajes con
> `direccion: "entrante"`. Las pruebas están en `tests/components/ChatConversacionTono.test.tsx`, y
> el mapa `R → test` de `tasks.md` ya apunta ahí.
>
> **Por qué el resto de este documento NO se reescribe.** `design.md` es el registro de lo que se
> diseñó **entonces**, igual que un `down.sql` es la foto de su migración. Cambiar
> `ChatWhatsappPanel.tsx` por `ChatConversacion.tsx` en §1, §3 y §4 borraría justo la información
> que explica **por qué** el tono se rompió: que la feature colgaba de un componente que otra
> decisión, legítima y ajena, podía retirar. Léelo con esta nota delante. Una cita rota se repara o
> se anota; una decisión histórica se anota, nunca se reescribe.
>
> **Qué lo vigila ahora:** `tests/unit/guards/test-citado-desaparecido.guardia.test.ts` — si el mapa
> `R → test` de una ficha apunta a un test que existió y hoy no está, la suite se pone roja en el
> mismo commit que lo borra. Bitácora: `progress/impl_guardia-citas-rotas.md`.

## 0. Decisiones del humano (puerta previa al spec, 2026-07-30)

La feature nace de una pregunta: *¿cómo agrego un tono breve, o Google trae algo por
defecto?* La respuesta técnica que la origina: **no hay API para invocar el tono del
sistema desde JS**. El tono nativo solo aparece con la Notification API (feature 162); para
un aviso in-app hay que producir el sonido uno mismo.

- **D1 — Superficies**: campana de notificaciones (feature 146) y hilo de chat del
  mensajero (features 120/121). Los toasts genéricos quedan fuera: los dispara una acción
  del propio usuario, que ya sabe que ocurrió.
- **D2 — Sintetizado, no archivo**: `AudioContext` con dos osciladores. Cero assets, cero
  peso de red, funciona offline con la PWA sin tocar `public/sw.js`, y el timbre se ajusta
  editando números. Alternativa descartada en §5.
- **D3 — La notificación del sistema se registra, no se implementa**: feature 162.

## 1. Estado del repo que condiciona el diseño

- **Cero audio hoy**: ningún `.mp3`/`.wav`/`.ogg` en `public/`, ningún `new Audio`, ningún
  `AudioContext`, ninguna infraestructura de desbloqueo por gesto.
- **Sin realtime**: el aviso llega por polling SWR. Campana cada 60 s
  (`hooks/useNotificaciones.ts:63`, `notificacionesConfig.REFRESH_INTERVAL_MS`); hilo de
  chat cada 10 s (`ChatWhatsappPanel.tsx:40`). Supabase Realtime está descartado
  explícitamente (R47 de la 146). El tono se cuelga del tick, no de un canal.
- **Sin tabla de preferencias de usuario**: `specs/146-campana-notificaciones/design.md:503`
  las declara fuera de alcance. De ahí que la preferencia sea por dispositivo (R16).
- **Criterio de fallo heredado**: la campana degrada en silencio ante cualquier error
  (R48 de la 146). El tono adopta el mismo criterio (R4, R6, R17).

## 2. Piezas nuevas

### 2.1 `lib/audio/tono-notificacion.ts` — generador, sin React (R8)

Singleton perezoso. API pública:

| Función | Contrato |
|---|---|
| `reproducirTono()` | Emite las dos notas. Nunca lanza (R4, R6). |
| `prepararAudio()` | Registra, **una sola vez por carga**, un listener de primer gesto que crea y reanuda el contexto (R7). Idempotente. |
| `reiniciarAudioParaTests()` | Solo para tests: limpia el singleton y la marca de listener. |

- `obtenerContexto()` interno: devuelve `null` si no hay `window` (R9) o si el navegador no
  expone `AudioContext` ni `webkitAudioContext` (R4). Crea el contexto la primera vez y lo
  reutiliza (R5).
- Constantes del tono agrupadas arriba del archivo (`NOTAS`, `DURACION_NOTA_S`,
  `GANANCIA_PICO`) para que ajustar el timbre sea editar números: 880 Hz → 1174.66 Hz
  (A5 → D6), 90 ms por nota, total 180 ms < 300 ms (R2), ganancia pico 0.12.
- Cada nota: un `OscillatorNode` sinusoidal + su `GainNode`, con
  `exponentialRampToValueAtTime` hasta un valor casi nulo para que no chasquee (R3). El
  navegador libera los nodos al `stop()`; no hace falta desconexión manual.
- **Por qué el desbloqueo por gesto es obligatorio**: la política de autoplay hace nacer el
  contexto en `suspended`; sin gesto previo el tono no se oye. `prepararAudio()` usa
  `{ once: true, passive: true }` sobre `pointerdown` y `keydown` de `window`, y una bandera
  de módulo para no acumular listeners cuando hay varias superficies montadas (R7).

### 2.2 `lib/audio/preferencia-sonido.ts` — preferencia por dispositivo

- Clave `ordenex:sonido-notificaciones`, valores `"on"` / `"off"`; ausencia = activado
  (R15).
- `leerPreferenciaSonido()` y `guardarPreferenciaSonido(activado)`, ambas envueltas en
  `try/catch`: en modo privado o con almacenamiento bloqueado se comporta como activado y
  no lanza (R17).
- Se separa del generador porque el generador no debe saber de preferencias, y así el
  toggle de la campana puede leerla sin arrastrar el contexto de audio.

### 2.2-bis `hooks/usePreferenciaSonido.ts` — la preferencia como fuente externa

La campana se renderiza también en servidor, donde `localStorage` no existe. Leer la
preferencia en el primer render daría **discrepancia de hidratación** en el dispositivo
silenciado, y leerla en un efecto con `setState` incumple la regla
`react-hooks/set-state-in-effect` que este repo tiene como **error**, no aviso. Se usa
`useSyncExternalStore` con `getServerSnapshot = () => true`, que es la API que React ofrece
justo para esto. Efecto lateral útil: al suscribirse también al evento `storage`,
silenciar en una pestaña silencia las demás.

### 2.3 `hooks/useTonoAlIncrementar.ts` — disparo

`useTonoAlIncrementar(contador: number, opciones?: { activo?: boolean }): void`

Firma real: `useTonoAlIncrementar(contador: number | null): void`.

- `null` significa **dato aún no disponible** (primer render antes de que resuelva el fetch,
  o lectura fallida) y se ignora por completo: no suena y **no fija referencia** (R24). Sin
  esto, la primera carga se leería como un salto de 0 a N y sonaría al abrir un hilo con
  mensajes previos — lo detectaron los tests de R23, no el diseño inicial. Salir *antes* de
  tocar la referencia también evita perderla por un fallo transitorio: si `null` la
  sobrescribiera, la subida real siguiente se leería como "primera evaluación" y el aviso se
  perdería en silencio.
- `useRef<number | null>(null)` con el valor previo. **Primera evaluación con dato cargado
  solo registra** (R11): es lo que evita que recargar la página con no-leídas pendientes
  pite.
- Emite solo si `contador > previo` (R10, R12), una vez por transición aunque el salto sea
  de varias unidades (R13).
- Consulta la preferencia en el momento de emitir, no al montar, para que apagar el sonido
  tenga efecto inmediato sin remontar (R14).
- `useEffect` de montaje llama `prepararAudio()`.
- Hook único para las dos superficies: la lógica de "subió el contador" es idéntica, y así
  R10–R14 se testean una vez.

## 3. Enganches (cambios mínimos en código existente)

- **`components/shared/NotificationsBell.tsx`** — `useTonoAlIncrementar(noLeidas)`.
  `noLeidas` ya lo expone `useNotificaciones` (`:74`): no se toca el hook, ni las Server
  Actions, ni el repositorio. R20 sale gratis del propio diseño: marcar todas baja el
  contador a 0 y descartar lo baja o lo deja igual, y las bajadas no suenan. Además se
  añade el toggle `Volume2`/`VolumeX` en la cabecera del popover, junto a "Marcar todas
  como leídas" (R18).
- **`app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx`** — se deriva
  `entrantes = mensajes.filter((m) => m.direccion === "entrante").length` y se pasa al
  hook. `mensajes` ya está en `:188` y `:192` ya recorre por dirección. Contar **solo
  entrantes** es lo que da R22 (un saliente propio no mueve el contador) y R23 (el primer
  render solo registra).

## 4. Límite declarado (debe quedar visible, no insinuado al revés)

`ChatWhatsappPanel` está montado **solo mientras el mensajero tiene abierto el panel de
gestión de esa orden**. Con el panel cerrado no hay polling del hilo y no suena nada. El
aviso global "te llegó un mensaje" viviría en
`mis-asignaciones/_components/chat-demo/ChatFlotante.tsx`, pero su contador `sinLeer` es
**dato quemado** (`chat-demo-data.ts:51,119,124,150,157,171`) y no existe noción de
"mensaje leído" para el chat, a diferencia de `notificacion_lectura`, que sí es tabla
(`db/schema.prisma:1503`). Cablearlo es otra feature.

## 5. Alternativas descartadas

- **Archivo `.mp3`/`.ogg` en `public/sounds/` + `new Audio()`** — más control del timbre
  exacto, pero exige conseguir un audio con licencia libre, sumarlo al repo, decidir si se
  precachea en `public/sw.js` para que funcione offline, y `HTMLAudioElement` sufre la
  misma política de autoplay igual. Peor relación coste/beneficio para dos notas.
- **`navigator.vibrate` en vez de sonido** — no lo pidió el humano, no funciona en iOS y
  no resuelve el caso del operador en escritorio.
- **Sonido en `useToast`** — el 90 % de los toasts los dispara el propio usuario; sonarían
  como ruido, no como aviso.
- **Preferencia en base de datos, por cuenta** — exigiría tabla, migración y Server Action
  para un interruptor. `localStorage` es proporcionado; el precio (no viaja entre
  dispositivos) queda declarado en R16.
- **Esperar realtime para disparar el tono** — descartado por D3 de la feature 146; el
  polling ya existente es suficiente y no añade infraestructura.

## 6. Riesgo conocido

iOS Safari es el caso hostil: exige gesto para el contexto y lo suspende al pasar a
background. R6 (reanudar antes de emitir) lo mitiga, pero **la prueba que vale es un móvil
real**; queda como task de verificación manual, no como algo que los tests demuestren.
