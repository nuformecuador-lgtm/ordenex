# fix: la tarjeta de escaneo, plegada detrás de UN solo componente en toda la app

Rama: `fix/escaner-desplegable-unificado` (desde `origin/dev`). Zona: frontend.
Pedido del humano el 2026-07-31.

## El problema (verificado en código, no asumido)

`components/shared/EscanerGuiaCard.tsx` monta `QrScanner` (html5-qrcode) de forma
incondicional. Solo `/ordenes` lo tenía tras un desplegable
(`app/(app)/ordenes/_components/ReceptorDesplegable.tsx`, montado en
`OrdenesListado.tsx`). El motivo NO es estético y estaba escrito en ese mismo
componente: el panel se **monta y desmonta** (no se oculta por CSS) porque dejarlo
montado significa **la cámara encendida detrás de un panel invisible**.

Consecuencia en el resto de superficies: la cámara estaba activa todo el tiempo que
la pantalla estuviera abierta — en un teléfono, en la calle.

Superficies que montaban el escáner desnudo (comprobadas una a una):

| Superficie | Quién monta la tarjeta |
| --- | --- |
| `/recoleccion` | `RecoleccionModule.tsx` (directo) |
| `/mis-asignaciones` | `RecogerPaqueteCard.tsx` (directo; el módulo solo la incluye) |
| `/recepcion-satelite` | `EscanerRecepcion.tsx` (directo; `RecepcionSateliteModule` solo lo incluye) |

En los tres se envolvió **donde se monta la tarjeta**, no en el módulo padre: así
ningún consumidor futuro puede volver a montar la tarjeta desnuda.

`EscanerRecepcionOrigen` y `EscanerRecepcionBodegaCentral` no se tocaron: ya viven
dentro del desplegable de `OrdenesListado` y no se usan en ningún otro sitio.

## Cambios

### 1. El componente, promovido a compartido

`git mv app/(app)/ordenes/_components/ReceptorDesplegable.tsx` →
`components/shared/EscanerDesplegable.tsx` (historia conservada; el test se movió igual).

- **Nombre:** `EscanerDesplegable`. «Receptor» es vocabulario de `/ordenes`; en
  `/recoleccion` no se recibe, se recolecta. El nombre dice lo que es (el envoltorio
  plegable de una tarjeta de escaneo), no de dónde salió.
- **`label` y `labelAbierto` pasan a ser OBLIGATORIOS.** Antes tenían por defecto
  `"Recibir paquete"` / `"Ocultar receptor"`, o sea el acto de `/ordenes`: con un
  valor por defecto, una pantalla heredaba en silencio el vocabulario de otra. Ahora
  cada superficie nombra su acto.
- La clase de grupo pasa de `group/receptor` a `group/escaner` (y su
  `group-data-[open]/…` correspondiente).
- El comentario de cabecera explica el porqué real (cámara) y deja escrito que el
  plegado por defecto es decisión del humano y no admite prop de excepción.

### 2. Plegado por defecto en TODAS, `/ordenes` incluida

Decisión explícita del humano, ofrecida la alternativa de un `defaultOpen`: **no** se
añadió prop ni excepción por pantalla. `useState(false)` sigue siendo el único estado
inicial posible.

Etiquetas, una por acto:

| Superficie | `label` | `labelAbierto` |
| --- | --- | --- |
| `/ordenes` (`OrdenesListado.tsx`) | `Recibir paquete` | `Ocultar escáner` |
| `/recoleccion` (`RecoleccionModule.tsx`) | `Recolectar en tienda` | `Ocultar escáner` |
| `/mis-asignaciones` (`RecogerPaqueteCard.tsx`) | `Recoger paquete` | `Ocultar escáner` |
| `/recepcion-satelite` (`EscanerRecepcion.tsx`) | `Recibir paquete` | `Ocultar escáner` |

`labelAbierto` se unificó a `Ocultar escáner`: el `Ocultar receptor` anterior era el
mismo vocabulario de `/ordenes` que el pedido señalaba. El `label` de `/ordenes` no
cambia (`Recibir paquete`), así que ningún test suyo lo nota.

Detalle de estado comprobado: la confirmación persistente del último acierto
(`ultima` / `ultimaRecogida` / `ultimaRecibida`) vive **por encima** del desplegable
en los tres componentes, así que plegar apaga la cámara pero no borra el rastro de lo
que se acaba de mover. Hay un test que lo fija.

## Los tests de la feature 167: R7 cambió de FORMA, no de fondo

`tests/components/RecoleccionModule.test.tsx`, describe
**«el escáner está SIEMPRE (R7/R8)»**. Nació de un defecto real: el escáner
desaparecía justo cuando el mensajero lo buscaba ("no veo la forma de recolectar").
**Ningún caso se borró.** El describe pasa a llamarse «el escáner está SIEMPRE
**accesible** (R7/R8)» y lleva un comentario que deja escrito el cambio: de "siempre
montado" a "siempre accesible", por decisión del humano del 2026-07-31.

Cómo queda verificado el mismo requisito:

| Antes | Ahora |
| --- | --- |
| con lista vacía, el escáner sigue montado + el vacío se explica | con lista vacía, **el disparador está** + el vacío se explica (R8) |
| — | con lista vacía, **al abrirlo aparece el escáner completo** (input + botón) |
| con lista vacía el escaneo SÍ se puede confirmar | igual, abriendo primero: el escáner no es decorativo |
| con órdenes, el escáner sigue montado | con órdenes, **el acceso es exactamente el mismo** y al abrir sale la tarjeta |
| — | **nuevo:** plegado la cámara NO está montada; al cerrar se vuelve a desmontar y el acceso sigue |

Los casos de bloqueo (R9) suman ahora que bloqueado **no queda ni el disparador**: no
hay forma de abrir la tarjeta, que es más fuerte que lo que afirmaban antes.

`tests/components/RecoleccionPage.test.tsx` (R6/R7/R9) miraba la región de la tarjeta
para afirmar que el escáner llega montado desde el servidor; ahora mira el
disparador, con el porqué escrito en el helper. Que dentro haya un escáner que
funciona lo fija `RecoleccionModule.test.tsx`, que es donde toca.

Equivalentes en las otras superficies, mismo criterio:

- `tests/components/RecogerPaqueteCard.test.tsx`: helper `renderAbierta` (monta +
  despliega) en los 17 casos; **dos casos nuevos** — arranca plegada con la cámara
  sin montar (`startMock` sin llamar), y al cerrar se desmonta todo el escáner
  mientras el acceso permanece.
- `tests/components/EscanerRecepcion.test.tsx`: helper `renderAbierto` en los 13
  casos; **dos casos nuevos**, los mismos dos.
- `tests/components/MisAsignacionesModule.test.tsx` y
  `RecepcionSateliteModule.test.tsx`: los casos que buscaban la región ahora abren
  primero, o miran el acceso cuando lo que afirman es presencia/ausencia. Los de
  bloqueo/sin-zona suman que tampoco queda el disparador.

## El desmontaje al cerrar, fijado explícitamente

`tests/components/EscanerDesplegable.test.tsx` ya traía
«al cerrar, el contenido se DESMONTA». Se le añadió el caso que comprueba el
**mecanismo**, no solo el DOM:

```
cerrar corre el CLEANUP del hijo: es lo que apaga la cámara
```

Monta un doble mínimo de `QrScanner` con `useEffect(() => apagarCamara, [])` y
verifica que (a) plegado nunca llegó a montarse, (b) abierto no se ha llamado el
cleanup, (c) al cerrar **sí** se llama. Si algún día el panel pasara a ocultarse por
CSS, este caso falla — que es exactamente el defecto que el desplegable cierra.

Además, `RecoleccionModule`, `RecogerPaqueteCard` y `EscanerRecepcion` tienen cada
uno su propio caso de "al cerrar se desmonta" a nivel de superficie.

## Archivos

Producción:
- `components/shared/EscanerDesplegable.tsx` (renombrado desde
  `app/(app)/ordenes/_components/ReceptorDesplegable.tsx`)
- `app/(app)/ordenes/_components/OrdenesListado.tsx`
- `app/(app)/recoleccion/_components/RecoleccionModule.tsx`
- `app/(app)/mis-asignaciones/_components/RecogerPaqueteCard.tsx`
- `app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx`

Tests:
- `tests/components/EscanerDesplegable.test.tsx` (renombrado desde
  `tests/components/ReceptorDesplegable.test.tsx`)
- `tests/components/RecoleccionModule.test.tsx`
- `tests/components/RecoleccionPage.test.tsx`
- `tests/components/RecogerPaqueteCard.test.tsx`
- `tests/components/EscanerRecepcion.test.tsx`
- `tests/components/MisAsignacionesModule.test.tsx`
- `tests/components/RecepcionSateliteModule.test.tsx`

## Evidencia

`pnpm run typecheck` — verde, sin salida de `tsc`:

```
> ordenex@0.1.0 typecheck
> tsc --noEmit
```

`pnpm run lint` — **0 errores**, 20 warnings, todos preexistentes en `tests/**`
(`no-unused-vars`) y ninguno en archivos tocados por este fix (se verificó
`ordenCardsEnReparto` contra `origin/dev`: ya estaba):

```
✖ 20 problems (0 errors, 20 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

Suite completa (`pnpm test`):

```
 Test Files  665 passed (665)
      Tests  8060 passed (8060)
   Duration  188.61s
```

665 archivos, exactamente el baseline. 8060 = 8052 del baseline **+ 8 casos nuevos**,
0 rojos: 1 en `EscanerDesplegable` (cleanup del hijo), 3 en `RecoleccionModule`
(abrir con lista vacía, plegado/desmontaje, confirmación que sobrevive a cerrar y
reabrir), 2 en `RecogerPaqueteCard` y 2 en `EscanerRecepcion`.

## Nota de UX asumida a conciencia

Recibir/recoger/recolectar pasa a costar **un toque más** en las tres pantallas que
antes tenían la tarjeta a la vista. Es el precio directo de que la cámara no esté
encendida de fondo, y es la decisión que el humano tomó explícitamente cuando se le
ofreció la alternativa de abrir por defecto en las pantallas de mensajero.
