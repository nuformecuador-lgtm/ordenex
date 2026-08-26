# review_284 — la PWA correcta (rama `feature/284-pwa`)

Revisor: subagente reviewer · 2026-08-25 · SHA revisado **`a5c6c233`** · merge-base con
`origin/dev` = **`2b6443f8`** (la rama está directamente encima de `dev`, sin deriva).

> **Contexto que manda:** la app sale a uso comercial mañana y esta ficha toca el service
> worker, la única pieza que se queda instalada en el teléfono y no se arregla desplegando otra
> vez. Todo lo que sigue está **medido en esta máquina**, no leído. Donde no pude medir, lo digo.

**VEREDICTO: RECHAZADO.** Dos bloqueantes de comportamiento (uno pierde el dinero que el
mensajero acaba de teclear; el otro deja la app **no instalable**) y dos de expediente.

---

## 1 · Checklist de `CHECKPOINTS.md`

| Punto | Estado |
| --- | --- |
| `requirements.md` con EARS numerados | OK — 24 requisitos |
| `design.md` con alternativas descartadas y su porqué | OK — A1 a A11, once, cada una con su precio |
| `tasks.md` con **todas** las tasks en `[x]` | **NO** — las 40+ casillas siguen en `[ ]` |
| Cada `R<n>` mapea a un test que lo verifica | **NO** — R3 y R5 describen lo contrario de lo que hace el código (B3) |
| `progress/impl_<feature>.md` con el mapa R -> test | OK — `progress/impl_284.md` §5 |
| `pnpm run typecheck` | OK |
| `pnpm run lint` | OK — 0 errores, 100 warnings preexistentes |
| `pnpm test` | 1 rojo **ajeno**, delta 0 medido (§2) |
| E2E para flujos críticos | n/a — no hay harness E2E ejecutable; el design lo declara en §6.2 en vez de fingirlo |
| RLS en tablas nuevas | n/a — la ficha no toca Postgres |
| Migraciones reversibles | n/a — cero migraciones |
| Sin secretos hardcodeados | OK |
| Webhooks con firma e idempotencia | n/a |
| Capas separadas | OK — `lib/pwa/` puro y sin React; el SW no importa del bundle y una guardia comprueba que los dos literales compartidos no divergen |
| Sin hardcode de país, moneda ni cuenta | OK |
| `./init.sh` en verde | **NO** — `INIT_EXIT=1` por el rojo ajeno, delta 0 |
| `review_<feature>.md` con veredicto OK | **NO** — este archivo, RECHAZADO |
| Entrada en `progress/history.md` | **NO** — no existe (cierre del leader) |

---

## 2 · Mi gate, con el código de salida DENTRO del log

`pnpm run db:generate` corrido antes. Gate **completo**, sin `tail` en medio:

    { ./init.sh; echo "INIT_EXIT=$?"; } > gate-284-review.log 2>&1

    == Arnes SDD :: init (modo: completo) ==
    OK node v24.13.0
    OK dependencias presentes
    OK regla max-2-por-zona respetada (in_progress=6)
    OK specs presentes para features sdd en vuelo
    OK typecheck paso
    OK lint paso
     FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts > ninguna Server Action de
           `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
       + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
     Test Files  1 failed | 1405 passed (1406)
          Tests  1 failed | 19166 passed | 26 skipped (19193)
       Duration  385.11s
    FALLO 'pnpm run test'
    INIT_EXIT=1

**Delta 0, medido por mí y no aceptado de la bitácora.** Saqué la rama de en medio
(`git checkout --detach origin/dev`, SHA `2b6443f8`, que **es** la merge-base) y corrí **esa misma
guardia** allí:

     Test Files  1 failed (1)
          Tests  1 failed | 17 passed (18)
       + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]

Antes: 1 rojo, el mismo item. Después: 1 rojo, el mismo item. **Delta 0.** Es la ficha **275** y no
se toca. El diff de la 284 no roza `lib/actions/`.

---

## 3 · Hallazgos

### BLOQUEANTE B1 · La heurística no ve el trabajo del mensajero. Medido.

El implementer declara que `hayTrabajoEnCurso` «se equivoca **siempre hacia esperar**». **No es
cierto en esta app**, y la señal que falla es justo la del dinero.

**La medición.** Sonda con `@testing-library/react` + `userEvent` sobre React 19.2.4 (borrada al
terminar; el árbol quedó limpio):

| caso | `value` | `defaultValue` | `hayTrabajoEnCurso` |
| --- | --- | --- | --- |
| `<input>` **controlado**, tecleado `45000` | `"45000"` | `"45000"` | **`false`** |
| `<textarea>` **controlada**, escrito `cliente ausente` | `"cliente ausente"` | `"cliente ausente"` | **`false`** |
| `<input>` **no controlado**, tecleado `45000` | `"45000"` | `""` | `true` |

**Por qué.** React 19 mantiene `defaultValue` **sincronizado con `value`** en cada commit de un
input o textarea controlado (`setDefaultValue` dentro de `updateInput`/`updateTextarea`; sólo se
salta el caso `type="number"` con el nodo enfocado). Así que la comparación
`campo.value !== campo.defaultValue` (`lib/pwa/actualizacion.ts:98`) es **estructuralmente falsa**
para todo formulario controlado. Y esta app no usa otra cosa: no hay `react-hook-form` en
`package.json`, y el campo del recaudo es
`<Input type="text" inputMode="numeric" value={linea.monto} onChange={...} />`
(`components/shared/DesglosePagoField.tsx:135-140`). Igual `MotivoField`, igual
`fechaReprogramacion`.

**La señal de la foto también está muerta en ese mismo panel.** `handleEvidenciaChange` hace
`input.value = ""` justo después de elegir
(`app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx:437`), así que
`campo.files.length === 0`: las fotos comprimidas viven en el estado `evidencias` de React, no en
el input. La señal 3 —«la foto del comprobante sin subir», textualmente el ejemplo del propio
comentario— no la ve nunca.

**Y la del diálogo tampoco cubre**, porque el panel se pinta **inline** en la página, no dentro de
un modal (`RepartoModule.tsx:633` y `:783`).

**Cómo acaba en recarga.** Mensajero en `/mis-asignaciones/reparto`, modo foco, con el desglose de
recaudo tecleado y dos fotos elegidas. De las cinco señales quedan vivas `aria-busy` (sólo mientras
hay una mutación en vuelo) y `<video>` (sólo con el escáner abierto). Ninguna aplica, así que
`seAvisa = true` y el banner se pinta en `fixed inset-x-0 bottom-0 ... pointer-events-auto`
(`components/shared/AvisoVersionNueva.tsx:42-46`): **encima de la zona del botón «Guardar
gestión»** en un teléfono. Y su texto le dice al mensajero, literalmente:

> «Tu trabajo en pantalla no se pierde: el aviso solo aparece cuando no tienes nada a medias.»

Un toque y se va el desglose de recaudo y las fotos.

**Por qué la guardia está verde.** Su caso G2 monta el formulario a mano y asigna el valor por DOM:
`document.body.innerHTML = '<form><input name="guia" /></form>'` y luego `(...).value = "ORD-99"`
(`tests/unit/guards/pwa-aviso-sin-recarga.guardia.test.ts:169-170`). Eso es un input **no
controlado**: el único caso que la heurística sí detecta. El test mide una forma de formulario que
en esta app no existe.

**Qué falta para cumplir.** Que la regla mire una señal que sí exista en un formulario controlado
—`document.activeElement` dentro de un `<form>`, un `beforeunload` ya registrado, o una marca
explícita que ponga el panel mientras tiene estado sucio— y que el caso de la guardia se construya
**renderizando un componente controlado**, no asignando `.value` a un input suelto. Con la sonda de
arriba se ve rojo en dos líneas.

---

### BLOQUEANTE B2 · `/manifest.json` y `/sw.js` salen 307 a `/login`: la app no es instalable. Medido.

Levanté la app (`next dev`, puerto 3999) y pedí los estáticos de la PWA **sin cookie**, que es
exactamente como los pide el navegador:

    /sw.js               -> HTTP/1.1 307 Temporary Redirect
    /manifest.json       -> HTTP/1.1 307 Temporary Redirect   (-> /login?redirect=%2Fmanifest.json)
    /offline.html        -> HTTP/1.1 307 Temporary Redirect
    /icons/icon-512.png  -> HTTP/1.1 200 OK

El matcher del middleware sólo excluye `_next/static`, `_next/image`, `favicon.ico` y
**extensiones de imagen** (`middleware.ts:98-100`). Los `.json`, `.js` y `.html` de `public/`
**pasan por el guard de sesión** y, sin cookie válida, salen en 307. Los PNG se salvan sólo porque
su extensión está en la lista.

**Consecuencia 1: el manifiesto no lo lee nadie.** El `<link rel="manifest" href="/manifest.json" />`
de `app/layout.tsx:43` **no declara `crossorigin="use-credentials"`**, así que el navegador lo
descarga **sin credenciales**: recibe el 307 y, al seguirlo, HTML de login donde esperaba JSON.
Resultado: error de manifiesto y **la app no se ofrece a instalar a nadie**, con sesión o sin ella.
Con eso **R22 («0 errores de instalabilidad») es falso hoy**, y el `id` de R14, las diez claves de
R15 y la regla de atajos de R16/R17 decoran un archivo que el navegador nunca llega a parsear. No
hay `beforeinstallprompt` en ningún sitio del código, así que tampoco hay botón propio que compense.

Lo incómodo: el propio `design.md` §5/A11 **ya conoce el hecho** —«el manifiesto se descarga sin
credenciales salvo que el `<link>` declare `crossorigin="use-credentials"`»— y lo aplica a un
manifiesto dinámico hipotético sin comprobarlo nunca sobre el manifiesto real que se sirve.

**Consecuencia 2: sin sesión no se puede registrar el SW.**
`navigator.serviceWorker.register('/sw.js')` sobre un 307 falla, y el registro va con
`.catch(() => {})` (`app/layout.tsx:71`): falla mudo. Con sesión sí se sirve —la petición del
script del SW lleva cookies same-origin—, de modo que el SW sólo existe para quien ya inició sesión.

**Esto no es una regresión de la 284** (es anterior), pero **R22 es requisito de esta ficha**, la
ficha se llama «la PWA queda correcta», y el plan manda M5 a *después* de desplegar, o sea al día
en que ya no hay segunda oportunidad de instalar por primera vez. Mi medición dice que **M5 va a
fallar**.

**Qué falta para cumplir.** Que `/manifest.json`, `/sw.js` y `/offline.html` se sirvan sin pasar
por el guard, y que R22 se mida —aunque sea con un `curl -I` sobre el despliegue— **antes** de dar
la ficha por hecha. No lo arreglo yo.

---

### BLOQUEANTE B3 · `requirements.md` sigue afirmando lo contrario de lo que hace el código

Las tres decisiones del humano (D1, D2, D3) llegaron **después** del spec y el spec **no se
actualizó**. Hoy:

- **R3** dice: «MIENTRAS el SW en curso controle al menos un cliente, un SW recién instalado NO
  DEBE tomar el control ni activarse». El código **sí** toma el control con clientes vivos, cuando
  llega `ordenex:relevo-ahora`. El test mapeado a R3 comprueba otra cosa —que `install` no llame a
  `skipWaiting`—, que está bien pero **no es R3**.
- **R5** («el SW no debe recargar la página de ningún cliente») sigue siendo cierta *del SW*, pero
  el sistema **sí** recarga la página: lo hace el hook. Quien lea sólo el spec mañana concluirá que
  no hay ninguna recarga en juego, que es justo el peligro de B1.
- **R7** («al activarse DEBE borrar toda caché fuera de lista») está implementado **condicionado** a
  que no queden ventanas vivas.

Con la trazabilidad como la exige este arnés, **R3 y R5 no están verificados tal y como están
escritos**. La bitácora resuelve el choque diciendo «gana la decisión», y está bien dicho, pero el
`requirements.md` es el documento que sobrevive a la ficha.

**Qué falta:** reescribir R3/R5/R7 con la regla real —relevo **a petición**, purga **condicionada a
cero ventanas de la build anterior**, recarga **sólo de la pestaña que la pidió y sólo sin trabajo
en curso**— y re-apuntar el mapa.

---

### BLOQUEANTE B4 · `tasks.md` con todas las casillas en `[ ]`

`CHECKPOINTS.md` línea 9 lo exige literalmente. Además **T0.1 y T0.2 no se hicieron** y dentro del
`tasks.md` no consta: sólo se cuenta en `impl_284.md` §8. Es de trámite, pero una ficha que se
cierra con las casillas vacías no dice qué se hizo y qué no.

---

### menor M-1 · La purga puede aplazarse para siempre por marcar mal las ventanas

`activate` llena `ventanasDeLaBuildAnterior` con `matchAll({ includeUncontrolled: true })`
(`public/sw.js:148-152`). En el arranque «cerré la app y la volví a abrir», si el `activate` corre
cuando la ventana **nueva** ya existe como cliente no controlado, esa ventana queda marcada como
«de la build anterior»; el `ordenex:pagina-lista` que manda **ella misma** vuelve a encontrarla
viva y `purgarSiSeFueLaBuildAnterior` devuelve `false`. Como `purgaPendiente` vive en memoria y
`activate` no se vuelve a disparar, las `v1` sobreviven toda la vida de ese SW. No rompe nada —el
daño es caché rancia, y `TOPE_ESTATICOS` sigue acotando la `v2`—, pero es exactamente lo que mide
**M3** y hoy está **sin medir**.

### menor M-2 · El límite declarado está subestimado en la bitácora

`impl_284.md` dice que, si el navegador apaga el SW antes de que muera la última página vieja, la
purga «puede llegar **un arranque más tarde**». En rigor `activate` sólo vuelve a correr cuando
**cambia `sw.js`**, así que puede ser «el próximo despliegue que toque el service worker».

### menor M-3 · El banner se planta sobre el botón de guardar

`fixed inset-x-0 bottom-0 ... pointer-events-auto` en un teléfono cae sobre la zona del botón
«Guardar gestión». Por sí solo es incomodidad; combinado con B1 es el mecanismo por el que se
pierde el trabajo.

### menor M-4 · Expediente

- `feature_list.json` no trae `branch` para la 284; las demás fichas sí lo llevan.
- No hay entrada en `progress/history.md`.
- La **285** todavía no existe: H2 y A7 sólo viven dentro de `impl_284.md` §9. Si no se da de alta,
  el hallazgo se va con la ficha.

### menor M-5 · Que los trazados nuevos SEAN Poppins Bold no es reproducible aquí

Reproduje que el icono **que se servía** era Segoe UI (§4.4). Que los `<path>` nuevos vengan de
Poppins Bold descansa en la autocomprobación del extractor del implementer: **en esta máquina no
hay Poppins** —ni en el árbol ni en `C:\Windows\Fonts`—, así que no puedo re-derivar los contornos.
Lo que sí queda cerrado es el modo de fallo: el vector ya no nombra ninguna fuente y el generador
aborta si vuelve a traer `<text>`. Miré los cinco PNG: el monograma es el mismo, la «e» tiene la
apertura y el terminal horizontal de Poppins, y el `maskable` va a sangre y recentrado.

---

## 4 · Lo que verifiqué en verde, ejecutándolo

### 4.1 · Mutaciones: 17 de 17 muertas, control superviviente, árbol limpio

Arnés propio, distinto del del implementer: aborta si el texto a mutar no existe, aborta si el
runner no ejecutó ningún test, revierte con `git checkout --` y comprueba el árbol al final.

    MUERTA   R1  lang del layout raiz                        html-lang
    MUERTA   R3  reponer skipWaiting en install              pwa-relevo-y-purga (x install no llama skipWaiting)
    MUERTA   R7  activate deja de borrar lo fuera de lista   pwa-relevo-y-purga (3 rojos)
    MUERTA   R7b purgar sin mirar si queda una pagina viva   pwa-relevo-y-purga (3 rojos)
    MUERTA   R9  invertir el FIFO                            pwa-relevo-y-purga (2 rojos)
    MUERTA   R13 TOPE_ESTATICOS = Infinity                   pwa-relevo-y-purga (3 rojos)
    MUERTA   R11 cachear el estatico aunque no sea ok        pwa-relevo-y-purga (x un 404 no entra en la cache)
    MUERTA   R11b cachear la navegacion aunque no sea ok     pwa-relevo-y-purga (x las paginas que no son 2xx)
    MUERTA   R2b caches.match -> solo la cache vigente       pwa-relevo-y-purga (x la pagina vieja encuentra sus chunks)
    MUERTA   RESCATE-SW: la bandera deja de consultarse      pwa-relevo-y-purga (2 rojos)
    MUERTA   RESCATE-SW: ya no se des-registra               pwa-relevo-y-purga
    MUERTA   RESCATE-INLINE: sale siempre en la 1a linea     pwa-aviso-sin-recarga
    MUERTA   RESCATE-INLINE fuera del head                   pwa-aviso-sin-recarga
    MUERTA   G2  la regla ignora los campos                  pwa-aviso-sin-recarga (4 rojos)
    MUERTA   G1  recargar aunque lo pidiera otra pestaña     pwa-aviso-sin-recarga
    MUERTA   R14 id -> /?source=pwa                          pwa-manifiesto-atajos
    MUERTA   R16 atajo a /ordenes                            pwa-manifiesto-atajos (2 rojos)
    SUPERVIVIENTE  CONTROL: reordenar un comentario          pwa-relevo-y-purga (25 passed)
    arbol limpio al terminar: true

**El `fetch` que cacheaba sin mirar el estado (R11) está cerrado en sus DOS sitios** —estáticos y
navegaciones— y las dos mutaciones ponen roja su caso.

### 4.2 · El camino de rescate: lo maté, y funciona

- **Mitad del SW.** Lo dejé inerte de dos maneras distintas —quitar `RESCATE_FORZOSO` de la
  condición, y quitar el `unregister`— y la guardia se pone **roja** las dos veces. El caso que lo
  ejercita enciende la bandera sobre el fuente real y afirma `skipWaiting` 1 vez, **0** cachés
  restantes y `unregister` 1 vez, con su par anti-vacuidad (bandera en `false`: ni desregistro ni
  borrado).
- **Mitad inline: verificada sobre el HTML SERVIDO, no sobre el fuente.** Levanté la app y pedí
  `/login`. El IIFE viaja **dentro del `<head>`**, como `<script>` en línea, antes de `</head>` y
  sin depender de ningún chunk:

      bytes head: 3706
      rescate=sw en el HEAD: True
      ...<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png"/>...
      <script>(function () { try { var busqueda = window.location.search || "";
        if (busqueda.indexOf("rescate=sw") === -1) return; ...

  Que es su único motivo de existir: si los chunks están rotos, ese código ya se ejecutó durante el
  parseo del documento. **Límite:** medido sobre el servidor de desarrollo, no sobre una build de
  producción; **M7** sigue siendo la comprobación que lo cierra en un teléfono real.

### 4.3 · La purga y la lectura cruzada de cachés

Verificado ejecutando: con una ventana de la build anterior viva **no se borra nada**
(`next-static-v1` y la caché ajena siguen ahí); la purga aplazada corre en cuanto esa ventana
desaparece; y **con la `v1` todavía presente y la red devolviendo 404, la página vieja sigue
recibiendo su chunk desde la caché vieja** —`caches.match` mira todas las cachés del origen—.
Mutar ese `caches.match` a la caché vigente pone rojo ese caso. El límite declarado (si el
navegador apaga el SW se pierde la marca en memoria) es real y está escrito; ver M-1 y M-2.

### 4.4 · La medición del icono, reproducida

Saqué de git el PNG que la app **servía** (`origin/dev:public/icons/icon-512.png`) y el vector
vigente hasta ayer (`4dc572e3:public/icons/fuente/icon-512.svg`, con
`font-family="Poppins, 'Segoe UI', Arial, sans-serif"`), y rastericé cada variante a 512:

| render del vector vigente con... | píxeles distintos vs. el PNG servido | diferencia media |
| --- | --- | --- |
| **tal cual (la cascada del SVG)** | **0,773 %** | **0,24** |
| **`Segoe UI`** | **0,773 %** | **0,24** |
| `Arial` | 9,603 % | 15,08 |
| `Poppins` (por nombre; no instalada) | 8,930 % | 13,90 |

La cascada y `Segoe UI` dan **el mismo número**, que es la prueba directa de que Poppins no está
instalada y de que el respaldo real era Segoe UI. **Confirmado: el icono que la app servía llevaba
meses generado con la fuente del sistema.** Mis cifras no son idénticas a las de la bitácora
(0,282 / 9,306 / 8,575) porque uso otro umbral por píxel; el orden y la conclusión son los mismos.

**Y la caja de tinta coincide exactamente:** servido `(104,234)-(416,390) 313x157`, nuevo
`(104,234)-(416,390) 313x157`. O sea que la diferencia que queda (2,594 %) **no es de escala ni de
posición: es de letra**, tal y como se afirma.

**El cinturón funciona, y el generador ya no es decorativo:**

- Metí `<text x="0" y="0"></text>` en `icon-any.svg` y corrí el generador:
  `icon-any.svg contiene <text>: el monograma tiene que ir en trazados (<path>).` con `EXIT=1`, y
  el md5 del conjunto de PNG **no cambió**: aborta **antes** de escribir nada.
- Corrido en limpio, el generador reproduce los **cinco** PNG **byte a byte** idénticos a los
  commiteados (`git status` vacío después). Q6 queda de verdad resuelta.

### 4.5 · Los cero atajos y su guardia

La regla se **deriva** de `SIDEBAR_ITEMS` (`rolesConMenu` = unión de `item.roles`;
`rolesQueLlegan(url)` desde los subítems o el `href`), sin una sola lista de roles copiada, y la
única excepción (`DESPACHADORAS = ["/dashboard"]`) va con su motivo escrito en el propio archivo.
El **caso anti-vacuidad funciona de verdad**: se le pasa un manifiesto de mentira con un atajo a
`/ordenes` y lo rechaza **nombrando a `mensajero`**; y comprueba también el sentido contrario
(`/dashboard` pasa; un atajo sin `name` se rechaza). La mutación que mete el atajo en el manifiesto
real pone **rojos dos casos**. El censo por rol se re-deriva —maestro 16, admin 11, adminSatelite 6,
mensajero 6, adminTienda 3— y la intersección sale **vacía**. La regla no está verde por no haber
atajos: está verde porque funciona.

### 4.6 · El resto

- `lang="es"` **en el documento servido**, no sólo en el fuente:
  `<html lang="es" class="poppins_... h-full antialiased">`. Y en el `<head>` servido están **las
  dos** metas de capacidad (una cada una) y el `apple-touch-icon` de 180.
- Los cinco PNG existen y miden lo declarado; el `any` tiene la esquina transparente y el
  `maskable` y el de 180 la tienen opaca —comprobado por píxel, no por el texto del `purpose`—.
- El arnés del SW se **auto-comprueba** (fuente de más de 1000 bytes y los cuatro manejadores
  registrados), que es la lección de la guardia que salió verde con el detector roto.
- `tests/unit/pwa/manifest.test.ts` **no se tocó** y sigue verde; itera sobre `manifest.icons`, así
  que sí cubre los dos iconos nuevos.

---

## 5 · Las dos cosas declaradas sin medir: mi juicio para desplegar mañana

**`TOPE_ESTATICOS = 200` sin calibrar: ACEPTABLE.** El precio de equivocarse es acotado y conocido:
si el tope queda corto, lo que se cae de la caché es lo más viejo y el coste es **una recarga desde
red de un archivo que sigue existiendo en el servidor**. No hay ningún camino por el que un tope mal
puesto rompa a un usuario. Está escrito con la palabra «SIN CALIBRAR» dentro del propio `sw.js`,
hay precedente en el repo (`RUTA_ORIGEN_MAX_KM`) y la re-medición queda como **M4** en
`docs/release.md`. Se despliega con esto.

**Sin línea base del SW en producción: ACEPTABLE COMO INCÓGNITA, pero ya no es la misma
incógnita.** La premisa «hay cachés creciendo en los teléfonos» sigue sin confirmar, y eso por sí
solo no bloquea: purgar de más no rompe nada. **Pero mi medición de B2 la cambia de sitio.** Si
`/manifest.json` sale 307 para todo el mundo y `/sw.js` sale 307 para quien no tiene sesión,
entonces (a) la app no ha podido ofrecerse a instalar y (b) el SW sólo puede existir en el teléfono
de quien inició sesión. Eso hace **más probable** que Q8 se responda «apenas hay SW ahí fuera»
—buena noticia para el riesgo de esta ficha— y **mala** para el lanzamiento, porque significa que
la PWA que se estrena mañana **no se instala**. Esa parte sí bloquea: se mide en un minuto con un
`curl -I` y no debería descubrirse en el teléfono de un mensajero.

---

## 6 · Veredicto

**RECHAZADO.**

Vuelve al implementer, en este orden:

1. **B1** — que `hayTrabajoEnCurso` vea un formulario **controlado**, y que su caso de guardia se
   construya renderizando uno, no asignando `.value` a un input suelto. Es el bloqueante que le
   cuesta dinero a un mensajero.
2. **B2** — que `/manifest.json`, `/sw.js` y `/offline.html` dejen de salir 307, y que R22 se mida
   **antes** de cerrar la ficha.
3. **B3** — `requirements.md` reescrito con la regla real de D1/D2/D3 y el mapa R -> test
   re-apuntado.
4. **B4** — `tasks.md` marcado, con T0.1 y T0.2 anotadas como NO HECHAS dentro del archivo.

**Lo que NO hay que tocar:** el rojo de `superficie-de-uso` es ajeno (ficha 275) y el delta es 0,
medido contra `origin/dev`. La rama no lo causa.

Y lo que sí está bien, y conviene no perderlo en la corrección: el relevo del SW, la purga
condicionada con lectura cruzada de cachés, el `response.ok` obligatorio en los dos caminos, el
camino de rescate en sus dos mitades, la regla de los cero atajos con su anti-vacuidad y el arreglo
del icono con un generador que ya no puede volver a mentir. Eso son 17 mutaciones muertas y una
medición que desmintió meses de un icono equivocado.
