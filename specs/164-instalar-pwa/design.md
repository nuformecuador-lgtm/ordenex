# Feature 164 — Botón de instalar la PWA y screenshots · design

## 0. Punto de partida (comprobado, no supuesto)

La PWA **ya era instalable en producción** antes de esta feature. Verificado archivo a
archivo: manifest enlazado (`app/layout.tsx:37`), `display: standalone`, iconos 192 y 512
que son PNG reales de esas dimensiones exactas, service worker registrado en producción
(`app/layout.tsx:52-56`) con un `fetch` que cae a `/offline.html` (`public/sw.js:50`), y
HTTPS por Vercel. Los metas de iOS también están.

Faltaban dos cosas, y son las que pidió el humano:

1. **Ninguna vía propia de instalar.** No existía ningún `beforeinstallprompt` en el repo, así
   que todo dependía del gesto del navegador (icono en la barra de direcciones, menú
   "Instalar aplicación"), invisible para quien no lo conoce.
2. **Sin `screenshots` en el manifest**, lo que degrada el diálogo de Android al aviso pequeño.

### Hallazgo que condiciona la verificación

**La instalabilidad no se puede probar en local de ninguna manera.** En desarrollo el script
de registro hace lo contrario (des-registra los SW y borra las caches), y además `sw.js` se
**autodestruye** cuando el hostname es `localhost` o `127.0.0.1` (`public/sw.js:7-9`) sin
mirar `NODE_ENV` — así que ni siquiera `pnpm build && pnpm start` sirve. Hace falta un
despliegue real, un túnel o un hostname que no sea localhost. Ambas cosas son deliberadas
(feature 64: cachear los chunks de Next en dev provoca recarga infinita).

## 1. Piezas

### 1.1 `hooks/useInstalarPwa.ts`

Suscribe `beforeinstallprompt` y `appinstalled`; devuelve `{ disponible, instalar }`.

- `preventDefault()` sobre la oferta (R3): sin él Chrome muestra su propio aviso **además**
  del botón de la app, ofreciendo lo mismo dos veces.
- El `setState` va en el **callback** de la suscripción, no en el cuerpo del efecto: es
  exactamente el caso que `react-hooks/set-state-in-effect` —error en este repo— permite.
- La oferta es de **un solo uso**: el navegador no reentrega el mismo evento. Se descarta
  tanto si el usuario aceptó (ya está instalada) como si rechazó (no se le insiste, R5). Si
  el navegador vuelve a considerarla instalable, emitirá otro evento.
- `instalar()` traga el fallo del diálogo (R6): el navegador ya mostró —o no— su interfaz;
  no hay nada que decirle al usuario.

### 1.2 `components/shared/InstalarPwaButton.tsx`

Devuelve `null` si no hay oferta (R1). **Nunca un botón que no lleva a ninguna parte**: si ya
está instalada, si no cumple criterios o si el navegador no soporta el evento, no ocupa
espacio. Variante `soloIcono` que conserva el `aria-label` completo (R8).

Montado en `components/shared/PageHeader.tsx` junto a la campana: solo icono por debajo de
`sm`, con texto desde `sm`, que es donde el hueco escasea.

### 1.3 Screenshots reales

Tres capturas **reales** de la app corriendo, tomadas con Playwright (ya en el repo) contra
el dev server: `inicio-narrow` y `ingreso-narrow` (540×1170) e `inicio-wide` (1280×720). Se
inyecta CSS que oculta `nextjs-portal` antes de capturar: el indicador de desarrollo de Next
es andamiaje del entorno y **no puede acabar en una imagen publicada** (R18). Cada una se
revisó a ojo antes de declararla.

Las dos narrow comparten proporción porque el navegador lo exige (R15).

### 1.4 `tests/unit/pwa/manifest.test.ts` — guardia nueva

**No existía ningún test del manifest.** Comprueba que cada icono y captura declarado existe
en `public/`, que las dimensiones declaradas son las reales del PNG (leídas de la cabecera
IHDR), que las narrow comparten proporción y que `display` sigue siendo instalable.

Razón de ser: un manifest que miente **no rompe nada visible**. El navegador simplemente
degrada el diálogo, o deja de ofrecer la instalación, en silencio. Es justo la clase de fallo
que ningún humano nota hasta que alguien pregunta "¿por qué ya no se puede instalar?".

## 2. Alternativas descartadas

- **Banner grande de "instala la app"** en vez de un botón en la cabecera. Más visible, pero
  es el patrón que la gente aprende a cerrar sin leer, y hay que gestionar su reaparición.
  Un botón que solo existe cuando se puede instalar no molesta a nadie.
- **Mantener el botón visible siempre**, deshabilitado, cuando no hay oferta. Se descartó:
  un control permanentemente muerto en Safari (donde el evento no existe) es peor que
  ninguno.
- **Detectar `display-mode: standalone`** para ocultar el botón cuando ya está instalada. Es
  redundante: si ya está instalada el navegador no emite la oferta, así que el botón no
  aparece de todos modos. Menos código y menos superficie de hidratación.
- **Generar las screenshots con `sharp`** (como se generaron los iconos) en vez de
  capturarlas. Serían imágenes inventadas presentadas como capturas de la app: eso es
  exactamente lo que un diálogo de instalación no debe hacer.
- **Capturar la app ya autenticada** (la lista del mensajero, que es la pantalla que vende la
  herramienta). No se pudo: no hay `QA_PASSWORD` en `.env` y los e2e están documentados como
  escritos-pero-no-ejecutados por falta de entorno. Queda como mejora obvia para cuando haya
  una sesión de prueba.
