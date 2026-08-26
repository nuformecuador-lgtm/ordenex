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

---
---

# RONDA 2 — re-revisión tras los arreglos (2026-08-26)

> La ronda 1 queda **íntegra arriba**, con su veredicto RECHAZADO. Esto es lo que cambió y lo
> que medí yo. SHA re-revisado **`02385e4a`** · merge-base con `origin/dev` sigue en
> **`2b6443f8`** (la rama no ha derivado).

**VEREDICTO FINAL: OK — aprobado con reservas.** Los cuatro bloqueantes están cerrados y
verificados por mí ejecutando, no leyendo. Quedan cinco `menor`, ninguno bloquea el despliegue, y
**una corrección de fondo a una conclusión escrita en el spec** que sí cambia lo que hay que
esperar esta noche (§R2.6).

---

## R2.1 · Mi gate, con el código de salida DENTRO del log

`pnpm run db:generate` antes. Gate **completo**:

    { ./init.sh; echo "INIT_EXIT=$?"; } > gate-284-r2.log 2>&1

    ✓ typecheck paso
    ✓ lint paso
     FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts
       + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
     Test Files  1 failed | 1406 passed (1407)
          Tests  1 failed | 19181 passed | 26 skipped (19208)
       Duration  383.91s
    INIT_EXIT=1

**Delta 0, y aquí no es trámite.** Esta ronda toca `middleware.ts`, que **es una raíz** del grafo
de alcanzabilidad de esa misma guardia: si el cambio del `matcher` hubiera dejado huérfana alguna
Server Action, la lista habría crecido. Volví a sacar la rama de en medio
(`git checkout --detach origin/dev`, `2b6443f8`) y corrí la guardia allí:

     Test Files  1 failed (1)
          Tests  1 failed | 17 passed (18)
       + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]

**No sólo el número: el CONJUNTO es idéntico** —`{obtenerTarifa}` antes y después—, que es la
comprobación que de verdad importa cuando lo que cambia es una raíz del grafo. Es la ficha **275**
y no se toca.

---

## R2.2 · B2 CERRADO — el manifiesto sale 200 y no abre ningún agujero. Medido sobre build de producción.

No me fié del dev server ni de la bitácora: compilé (`pnpm exec next build`, `BUILD_EXIT=0`) y
serví el artefacto real (`pnpm exec next start -p 3998`). **Sin ninguna cookie:**

    /manifest.json                   200      Content-Type: application/json; charset=UTF-8
    /sw.js                           200      Content-Type: application/javascript; charset=UTF-8
    /offline.html                    200
    /icons/icon-512.png              200
    /ordenes                         307  ->  /login?redirect=%2Fordenes
    /dashboard                       307  ->  /login?redirect=%2Fdashboard
    /cierre-dia                      307  ->  /login?redirect=%2Fcierre-dia
    /mis-asignaciones/reparto        307  ->  /login?redirect=%2Fmis-asignaciones%2Freparto
    /wallet                          307  ->  /login?redirect=%2Fwallet
    /api/ordenes                     307  ->  /login?redirect=%2Fapi%2Fordenes
    /configuracion                   307  ->  /login?redirect=%2Fconfiguracion
    /reportes/export.json            307  ->  /login?redirect=%2Freportes%2Fexport.json   <-- EL CASO
    /algo/sw.js                      307  ->  /login?redirect=%2Falgo%2Fsw.js

Y el cuerpo es el bueno: el manifiesto empieza en `{ "id": "/", "name": "Ordenex", …` y el SW en
`// Feature 64 (PWA) — service worker. Feature 284: …`. No es una página de login disfrazada.

**El caso que el coordinador señaló —`/reportes/export.json`— sigue protegido.** Es el sitio
donde un arreglo apresurado abre el agujero, y no está abierto: la exclusión va por **nombre
anclado al primer segmento**, no por extensión.

**Sondas extra que hice yo, buscando el agujero:**

    /Manifest.json        307   (el matcher distingue mayúsculas: no se cuela por el nombre)
    /manifest.json/       308   (normalización de barra final)
    /sw.js.map            404   /offline.html.bak   404   /manifest.json.backup   404
    /api/docs/openapi     200   (público por diseño desde la 106, no lo toca esta ficha)
    /paquete/ABC123       307   /login  200   /postulacion  200   (sin cambios)

Los tres `404` son rutas que la exclusión sí deja pasar por prefijo pero donde **no hay recurso
que servir**: no filtran nada.

**Y la comparación determinista de los dos `matcher`, evaluados como los compila Next:**

    VIEJO: /((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|jpg|…)).*)
    NUEVO: /((?!_next/static|_next/image|favicon.ico|manifest\.json|sw\.js|offline\.html|.*\.(?:svg|jpg|…)).*)

    ruta                      ANTES pasa-guard  DESPUES pasa-guard
    /manifest.json            true              false   <-- CAMBIA
    /sw.js                    true              false   <-- CAMBIA
    /offline.html             true              false   <-- CAMBIA
    /icons/icon-512.png       false             false
    /ordenes                  true              true
    /dashboard                true              true
    /cierre-dia               true              true
    /wallet                   true              true
    /api/ordenes              true              true
    /reportes/export.json     true              true
    /algo/sw.js               true              true
    /configuracion            true              true

**Exactamente tres rutas cambian de lado y ninguna más.** El «antes» además reproduce el `307`
que yo medí en la ronda 1 contra el dev server.

### El `crossorigin`: el razonamiento se sostiene

Decidir **no** añadir `crossorigin="use-credentials"` es correcto, y por un motivo más fuerte que
el que dice la ficha. `use-credentials` sólo sirve para que el manifiesto llegue **cuando está
detrás de la sesión**; usarlo aquí habría sido **tapar el defecto en vez de arreglarlo**: el
manifiesto habría llegado al usuario con sesión y **seguiría fallando para el visitante anónimo**,
que es quien ve la landing y a quien el navegador debe ofrecerle instalar. Con el `matcher`
arreglado el manifiesto responde 200 sin cookies —lo acabo de medir— y es un estático idéntico
para todos, así que pedirlo con credenciales no cambiaría ni una respuesta. La invariante buena
—«el manifiesto tiene que ser alcanzable **sin** credenciales»— es la que quedó vigilada.

---

## R2.3 · B1 CERRADO — el caso real pasa, y lo verifiqué mutándolo

La corrección tiene dos capas y **la que manda es la primera**:

1. **Registro explícito** (`lib/pwa/trabajo-en-curso.ts` + `useDeclararTrabajo`): la superficie
   declara que tiene trabajo sin guardar. Es la respuesta correcta a lo que medí: **el estado que
   se pierde vive en React y desde el DOM no se ve.**
2. **Barrido del DOM arreglado**: mira si el campo **tiene contenido** (`campo.value !== ""`) en
   vez de compararlo con `defaultValue`. Los buscadores (`type="search"`, `role="searchbox"`)
   quedan fuera, con su motivo escrito.

**El caso real está y es real.** `pwa-aviso-sin-recarga.guardia.test.ts` **monta el
`GestionarOrdenPanel` de verdad**, pulsa «Entregar», teclea el recaudo en el input real, y afirma
tres cosas: que `monto.defaultValue === monto.value` —o sea, deja **clavada mi medición** como
sonda permanente—, que `hayTrabajoEnCurso(document)` es `true`, y que `trabajoDeclarado()` es
`["gestion:g1"]`. Un segundo caso monta el panel **y el aviso a la vez** y exige que
«Actualizar ahora» **no exista** mientras «Guardar gestión» sí. Un tercero comprueba que al
desmontar el panel la declaración se retira sola.

**Lo verifiqué matándolo.** Mis mutaciones sobre el código de la ronda 2:

    MUERTA   B1a la declaracion del panel queda inerte
    MUERTA   B1b el bug que el implementer cazo: paso === "resultados"
    MUERTA   B1c hayTrabajoEnCurso ignora el registro
    MUERTA   B1d el barrido VUELVE AL DEFECTO (value vs defaultValue)   <-- la regresión clave
    MUERTA   G3a el banner vuelve abajo
    MUERTA   G3b el banner vuelve a prometer lo que no cumple
    MUERTA   G3c "Ahora no" deja de quitar el aviso
    MUERTA   G1  recargar aunque el relevo lo pidiera otra pestaña
    MUERTA   B2a el matcher vuelve a tragarse el manifiesto
    MUERTA   B2b el matcher afloja POR EXTENSION (.json fuera del guard)
    MUERTA   R3  reponer skipWaiting en install          (regresión ronda 1)
    MUERTA   R11 cachear el estatico aunque no sea ok    (regresión ronda 1)
    MUERTA   RESCATE-INLINE inerte                       (regresión ronda 1)
    MUERTA   R16 atajo a /ordenes                        (regresión ronda 1)
    SUPERVIVIENTE  B1e el barrido ignora las fotos ya elegidas          <-- menor 3
    SUPERVIVIENTE  HOOK sin suscripcion al registro (solo sondeo)       <-- no es defecto
    SUPERVIVIENTE  B2c el link del manifiesto pide credenciales         <-- menor 4
    SUPERVIVIENTE  CONTROL-1 comentario reordenado en sw.js             <-- debe sobrevivir
    SUPERVIVIENTE  CONTROL-2 comentario reordenado en middleware.ts     <-- debe sobrevivir
    arbol limpio al terminar: true

**14 de 17 muertas, con los 2 controles verdes.** `B1d` es la que importa: si alguien vuelve a
escribir `value !== defaultValue`, la guardia se pone roja con el caso del panel real. Y `B1b`
confirma que el caso real **caza de verdad** el error que el propio implementer declaró haber
cometido en ese commit.

De los tres supervivientes, **uno no es defecto**: quitar la suscripción al registro deja el
sondeo cada 3 s, que es una diferencia de latencia y no de seguridad. Los otros dos van abajo
como `menor`.

---

## R2.4 · ¿Queda alguna superficie con trabajo sin declarar? Sí, una, y es menor

Busqué el patrón exacto que hace invisible el trabajo: estado en React que **no deja rastro en el
DOM**. El marcador fiable es `input.value = ""` justo después de elegir un archivo. Hay cuatro
sitios en todo el árbol:

| sitio | ¿cubierto? |
| --- | --- |
| `GestionarOrdenPanel.tsx:467` (panel del mensajero) | **sí**, lo declara |
| `GestionarDesdeAyudaModal.tsx:225` | **sí**, vive dentro de `Modal` → Base UI `Dialog.Popup` → `role="dialog"` |
| `ReportarIncidenteModal.tsx:137` | **sí**, mismo `Modal` |
| `BulkUpload.tsx:228` (carga masiva de órdenes, `OrdenesCargaUpload`) | **NO** |

**La que queda: la carga masiva de órdenes.** `BulkUpload` limpia el input y guarda el archivo y
el progreso (`status`, `progreso: {hechas,total}`) en React, y **no está dentro de un diálogo**.
Un administrador con una importación de miles de filas a medio subir puede ver el aviso y pulsar
«Actualizar ahora». La cobertura parcial que sí tiene: el botón de envío usa `Button loading`, que
pone `aria-busy` (`components/ui/button.tsx:109`), y `OrdenesCargaPreview` pone `aria-busy` al
generar errores — así que **parte** de la ventana está protegida. Lo que no está protegido es el
hueco entre elegir el archivo y arrancar.

Por qué lo dejo en `menor` y no bloquea: no se pierde nada tecleado (el archivo sigue en el disco
y se vuelve a elegir), no es el mensajero ni es dinero, exige que coincidan «hay versión nueva» +
«el admin pulsa actualizar a media importación», y ahora existe «Ahora no». **Un
`useDeclararTrabajo("carga-masiva", …)` en `OrdenesCargaUpload` lo cierra en tres líneas.**

El resto del árbol lo cubre el barrido por contenido: cualquier formulario con un campo escrito,
una casilla marcada, un diálogo abierto, una mutación en vuelo o la cámara del escáner.

---

## R2.5 · Los `menor` de la ronda 2

### menor 1 · `tasks.md`: quedan **12** casillas sin marcar que SÍ están hechas
Sin marcar hay **14**: las dos correctas (**T0.1** y **T0.2**, con «(NO EJECUTADA…)» escrito al
lado, que es exactamente lo que había que hacer) y **doce que sí se hicieron**: T2.1–T2.6, T7.1,
T7.2 y T12.1–T12.4. Las verifiqué una a una en la ronda 1. Se marcaron los epígrafes y no los
sub-items. **No bloquea el despliegue** —el expediente real está en `impl_284.md` y es completo—,
pero deja el `tasks.md` diciendo que doce cosas no se hicieron.

### menor 2 · **R25 y R26 no están en el mapa de trazabilidad de `tasks.md`**
La tabla `R → test` de `tasks.md` termina en R24. Los dos requisitos **nuevos y más
importantes** de la ficha sólo aparecen en `progress/impl_284.md` §5, donde sí están bien
mapeados a `pwa-servida-sin-sesion.guardia.test.ts`. Tienen test; falta la fila.

### menor 3 · La rama del archivo del barrido se quedó sin caso
Desactivar `if ((campo.files?.length ?? 0) > 0) return true;` **no pone roja ninguna guardia**: el
caso «una foto ya elegida y aún sin subir cuenta» de la ronda 1 desapareció en la reescritura. El
comportamiento del panel sigue cubierto por la declaración, así que no hay daño; pero es una rama
sin prueba dentro de la función que decide si se recarga o no.

### menor 4 · La guardia del `crossorigin` no ve la ortografía real
`expect(enlace).not.toContain("crossorigin")` es **sensible a mayúsculas**, y en JSX se escribe
`crossOrigin` (es lo que exigen los tipos de React). Lo comprobé: añadir
`crossOrigin="use-credentials"` al `<link>` deja la guardia **verde**. El caso que existe para
impedir es justo el que no puede ver.

### menor 5 · El precio del barrido por contenido: en pantallas precargadas el aviso no sale nunca
`hayCampoConContenido` devuelve `true` con **cualquier** campo no vacío que no sea un buscador. En
un formulario **precargado** —configuración, edición— eso es siempre, así que ahí el aviso no
aparecerá jamás. Es el lado correcto hacia el que equivocarse, y está escrito en el código; pero
sumado al precio de D1 (quien no pulsa, no actualiza) y al nuevo «Ahora no», un usuario puede
quedarse en una versión vieja bastante más tiempo del que nadie espera. Conviene tenerlo escrito
antes de que alguien lo descubra depurando.

---

## R2.6 · La conclusión que NO me cuadra: «el service worker nunca llegó a instalarse»

`requirements.md` (R25), `middleware.ts` y `impl_284.md` afirman ahora que, por el 307, «el
service worker **tampoco se descargaba**» y «**nada** de lo que hace esta ficha llegaba al
dispositivo». **La medida no sostiene esa conclusión, y creo que es falsa.**

La medición —la mía y la suya— se hizo con `curl` **sin cookies**. Eso es exactamente cómo pide el
navegador **el manifiesto**, y por eso la conclusión sobre el manifiesto es sólida: se descarga
con *credentials mode* `omit` salvo que el `<link>` diga `use-credentials`, así que recibía el
307 **siempre**, y **la PWA nunca se ha podido instalar**. Eso queda en pie y es el hallazgo
grande de esta ficha.

**Pero el service worker no se pide igual.** El fetch del script de un service worker se hace con
*credentials mode* **`same-origin`**: el navegador **sí manda la cookie de sesión**. Y el registro
(`app/layout.tsx`) corre en el `load` de **cualquier** página, incluida la primera después de
iniciar sesión. Para un mensajero con sesión, `/sw.js` respondía **200** y el SW **se instalaba**.
Su `install` precachea `/` y `/offline.html`, que con cookie también daban 200.

Es decir, lo que había ahí fuera es asimétrico y hay que decirlo con precisión:

| | manifiesto | service worker |
| --- | --- | --- |
| cómo lo pide el navegador | **sin** credenciales | **con** credenciales (same-origin) |
| qué recibía | 307 → login | 200, para quien tenía sesión |
| consecuencia | **nunca instalable** | **instalado y activo en la pestaña del navegador** |

**Por qué importa esta noche, y no es una discusión de matices:**

1. Si el SW viejo está activo, **`next-static-v1` existe** en esos dispositivos, y el barrido
   único de R8 tiene trabajo de verdad: **M3 no es vacuo**. Si se despliega creyendo que no hay
   nada que purgar, nadie mirará si las `v1` desaparecieron.
2. El SW viejo es el que llama a `skipWaiting()` + `clients.claim()` **y cachea sin mirar el
   estado**. O sea que el defecto que esta ficha arregla **estaba vivo**, y el despliegue de esta
   noche es justo el disparador que el `design.md` describía. Durante la ventana del despliegue
   manda todavía el SW **viejo**: si un chunk vuelve 404 en ese hueco, lo guarda en `v1`, y el SW
   nuevo lo puede seguir sirviendo porque `caches.match` mira **todas** las cachés hasta que la
   purga corra. **Esa es la razón operativa por la que el `?rescate=sw` tiene que estar a mano
   esta noche**, no la semana que viene.
3. La única medida que zanja esto es **T0.1 / M0** —DevTools → Application → Service Workers sobre
   el despliegue vigente, ANTES de desplegar— y sigue **sin ejecutar**. Con la app aún sin
   desplegar, es literalmente ahora o nunca: después ya no se puede saber qué había.

En este repo ya hay una lección con nombre para esto: una imposibilidad razonada no es una
medida. La conclusión «no había cachés creciendo» es **más fuerte que su evidencia** y está
escrita en el spec como si fuera un hecho medido. **Pedir:** rebajarla a lo que la medida sí
sostiene («la PWA nunca fue instalable; si el SW llegó o no al dispositivo depende de la sesión y
**no se midió**»), y **hacer M0 antes del despliegue** si alguien puede abrir DevTools.

---

## R2.7 · Veredicto final de la ronda 2

**OK — aprobado con reservas. Es desplegable esta noche.**

Los cuatro bloqueantes están cerrados y los verifiqué ejecutando:

| | estado | cómo lo comprobé |
| --- | --- | --- |
| **B1** heurística ciega | **CERRADO** | el panel real montado, con el recaudo tecleado, y 4 mutaciones que lo matan (incluida la que reintroduce el defecto exacto) |
| **B2** manifiesto en 307 | **CERRADO** | build de producción real: 200 en los tres, 307 en todo lo demás, `/reportes/export.json` incluido |
| **B3** spec desalineado | **CERRADO** | R3, R5, R7 y R15 corregidos en su sitio con fecha, y R25/R26 nuevos |
| **B4** casillas sin marcar | **CERRADO en lo esencial** | T0.1/T0.2 quedan sin marcar **y dicen por qué**; faltan 12 sub-items (menor 1) |

**Condiciones para el despliegue de esta noche, en este orden:**

1. **M8 primero**, en cuanto termine el despliegue y **antes de tocar nada más**: los cuatro
   `curl -sI` de `docs/release.md`. Si alguno de los tres devuelve 307, la PWA sigue sin existir
   y el resto de la ficha es decoración.
2. **`?rescate=sw` a mano**, en un papel, con el dominio escrito. Es la salida si un service
   worker deja la app inservible, y esta noche es cuando más probable es (§R2.6, punto 2).
3. **M0 antes de desplegar** si alguien puede abrir DevTools sobre el despliegue vigente. Es la
   última oportunidad de saber qué había.
4. **M1–M5 después**, con la expectativa correcta: **puede** haber `next-static-v1` que purgar.

Y a la vuelta, sin prisa: los cinco `menor` de §R2.5 y la superficie de §R2.4.
