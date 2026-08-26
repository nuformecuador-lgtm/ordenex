# 284-pwa-correcta — tasks.md

Cada task tiene su **criterio de hecho**. `[P]` = puede ir en paralelo con las demás
`[P]` de su bloque. Las dependencias van escritas, no implícitas.

**El orden es el del daño, no el de los números.** Si mañana falta tiempo, lo que
tiene que estar dentro es el **bloque P0**: es lo que rompe en manos de un usuario
justo al desplegar.

| Bloque | Qué es | Si se cae |
| --- | --- | --- |
| **T0** | medir antes de tocar | sin esto, la ficha entera podría estar arreglando algo que no ocurre |
| **P0 · T1–T3** | relevo del SW + purga | el despliegue de mañana rompe la app de quien la tenga abierta |
| **P1 · T4** | `lang="es"` | una línea; lectores de pantalla, corrector y traducción automática |
| **P2 · T5–T7** | manifiesto, metas de iOS, icono 180 | calidad de instalación; **no** rompe a nadie hoy |
| **T8–T12** | gate, mutaciones, medición manual, bitácora | sin esto nada está verificado |

---

## T0 · Medir el estado real antes de tocar una línea

- [ ] **T0.1** Sobre el despliegue **vigente** (Q3), DevTools → Application →
      Service Workers y Cache Storage. Anotar: ¿el SW está `activated`?, nombres de
      caché, **número de entradas de cada una**, y qué hay guardado bajo la clave `/`.
      **Hecho:** los cinco datos escritos en `progress/impl_284-pwa-correcta.md` con
      fecha y URL. Es la línea base **M0** del `design.md` §6.3.
      **Por qué es la primera:** toda la ficha supone que hay cachés creciendo en
      teléfonos, y eso **no está medido**. Si `install` estuviera fallando (H2), no
      habría SW, ni caché, ni defecto 2 — y la conclusión sería otra. En este repo ya
      pasó que un invariante razonado leyendo el código lo desmintió la primera medida.
      → responde **Q8**.
- [ ] **T0.2** `[P]` Contar los `/_next/static/` **distintos** de un recorrido
      completo del mensajero (DevTools → Network, filtro `_next/static`).
      **Hecho:** el número escrito. Si no se puede medir hoy, escribir
      «**sin calibrar**» y usar 200. → alimenta **T2.4** y responde **Q5**.

---

## P0 · El relevo del service worker y la purga

> Todo esto vive en la **rama de producción** de `public/sw.js`. La rama de
> `localhost` (el kill-switch de desarrollo) **no se toca**: R6.

- [ ] **T1** `[P]` Escribir la guardia `tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts`
      con el arnés del `design.md` §6.1: `new Function` con `self`, `caches`, `fetch`,
      `URL` y `Response` como parámetros; `CacheStorage` falso en memoria que conserve
      el **orden de inserción**; eventos con `waitUntil`/`respondWith` **esperados**,
      sin `setTimeout`.
      **Hecho:** el arnés se auto-comprueba —un caso afirma que el fuente leído tiene
      más de 0 bytes y que se registraron los tres manejadores (`install`, `activate`,
      `fetch`)—, de modo que un `sw.js` que no se cargue ponga la guardia **roja** y no
      muda. Precedente obligatorio: en este repo una guardia salió verde con su
      detector roto porque no encontraba **nada**.
      **Depende de:** nada. Puede escribirse antes que T2.
- [ ] **T2** Modificar la rama de producción de `public/sw.js`. Sub-tasks en orden:
  - [ ] **T2.1** Quitar `self.skipWaiting()` de `install`. Conservar el precaché tal
        cual (R12: `/` y `/offline.html`, ni una URL más).
        **Hecho:** el caso «`install` no pide el relevo» de T1 pasa, y pasa el de
        «precachea exactamente dos URLs». (R3, R4, R12)
  - [ ] **T2.2** Subir los nombres de caché a `next-static-v2` / `pages-cache-v2`.
        **Hecho:** el caso de `activate` con las `v1` sembradas las ve **borradas**. (R8)
  - [ ] **T2.3** `activate`: borrar toda caché fuera de la lista vigente **antes** de
        `clients.claim()`; conservar `claim()`.
        **Hecho:** con `next-static-v1`, `pages-cache-v1` y una caché ajena sembradas,
        quedan **sólo** las dos vigentes. (R7)
  - [ ] **T2.4** `fetch` de `/_next/static/`: (a) no cachear si `!response.ok`;
        (b) tras `cache.put`, `event.waitUntil(recortar(cache, TOPE_ESTATICOS))` que
        borra desde la clave **más antigua** hasta dejar `TOPE_ESTATICOS`.
        **Hecho:** los tres casos de T1 pasan —tope respetado, se fueron las más
        antiguas, **la recién guardada sigue estando**— y el de 404 no hace crecer la
        caché. (R9, R10, R11)
  - [ ] **T2.5** Declarar `TOPE_ESTATICOS` como **una sola** constante en la cabecera,
        con el número de T0.2 o con 200 y la palabra «sin calibrar» **en el comentario
        de al lado**.
        **Hecho:** la guardia afirma que la constante existe, es un entero > 0 y que
        **no hay ningún otro número mágico** cumpliendo su papel en el `fetch`. (R13)
  - [ ] **T2.6** Verificar que la rama de producción no contiene `client.navigate`,
        `location.reload` ni `skipWaiting`.
        **Hecho:** el caso de R5 pasa, y el de R6 sigue verde: en `localhost` el SW
        **sigue** limpiando, desregistrándose y renavegando.
      **Depende de:** T0.2 sólo para T2.5. El resto es independiente.
- [ ] **T3** Comprobar que el diff **no** niega el gate rápido: ninguna ruta tocada
      casa `RUTAS_SENSIBLES` ni `NOMBRES_DE_DINERO` (`init.sh:158-159`).
      **Hecho:** `./init.sh --rapido` arranca sin el `fail` de cimientos. (Si lo
      negara, es un dato nuevo y va a la bitácora, no se rodea.)

---

## P1 · El idioma

- [ ] **T4** `[P]` `app/layout.tsx`: `lang="en"` → `lang="es"`. Y guardia
      `tests/unit/guards/html-lang.guardia.test.ts` que recorra el árbol de producción
      buscando **todo** documento HTML completo —`app/**`, `public/**.html`— y exija
      `lang="es"` en cada uno.
      **Hecho:** la guardia afirma que encontró **tres** documentos (el layout raíz,
      `app/api-docs/route.ts` y `public/offline.html`) y que los tres declaran `es`.
      Afirmar el **número** es deliberado: si mañana alguien añade un cuarto documento
      o el escáner deja de encontrarlos, la guardia se pone roja en vez de muda. (R1, R2)

---

## P2 · Manifiesto, iOS e icono

- [ ] **T5** `[P]` `public/manifest.json`: añadir `"id": "/"` y **nada más**.
      **Hecho:** el manifiesto sigue siendo JSON válido y `tests/unit/pwa/manifest.test.ts`
      —que **no se toca**— sigue verde. (R14, R15)
- [ ] **T6** `[P]` Guardia `tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts`:
      - `id === "/"` **exactamente** (con el motivo escrito en el archivo: cualquier
        otro valor cambia la identidad de la app ya instalada);
      - las diez claves de R15 siguen presentes con su valor;
      - **la regla de los atajos** del `design.md` §5, derivada de `SIDEBAR_ITEMS`:
        `rolesConMenu` = unión de `item.roles`; para cada atajo, los roles que llegan a
        su `url` deben **contener** a `rolesConMenu`, salvo que la `url` esté en
        `DESPACHADORAS = ["/dashboard"]` con su motivo escrito;
      - **anti-vacuidad**: un caso que construye un manifiesto **de mentira** con un
        atajo a `/ordenes` y exige que la regla lo **rechace**. Sin eso, la regla
        estaría verde por no haber atajos y no por funcionar.
      **Hecho:** los cuatro casos pasan y el de anti-vacuidad falla al invertirlo.
      (R16, R17, R20)
      **Depende de:** T5.
- [ ] **T7** `[P]` El icono de 180 y las metas:
  - [ ] **T7.1** Generar `public/icons/icon-180.png` reescalando
        `public/icons/icon-512.png` con `sharp`. El script de un solo uso se escribe
        **en un archivo** (no `node -e`: en este repo lo inline pierde una capa de
        escapado) y se **borra** al terminar.
        **Hecho:** el PNG existe, la cabecera IHDR dice **180×180** y se ve el mismo
        icono («ex» blanco y naranja sobre azul marino), no un recorte.
        ⚠️ `scripts/generate-pwa-icons.mjs` **no sirve**: su fuente `public/next.svg`
        ya no está en el árbol. No se arregla aquí (Q6).
  - [ ] **T7.2** `app/layout.tsx`: `apple-touch-icon` → `/icons/icon-180.png`; añadir
        `<meta name="mobile-web-app-capable" content="yes">` **conservando**
        `apple-mobile-web-app-capable`.
        **Hecho:** la guardia de T6 afirma que el PNG referenciado por el `<head>`
        existe y mide lo que declara, y que **las dos** metas están. (R18, R19, R20)
      **Depende de:** T7.2 depende de T7.1.

---

## Verificación

- [ ] **T8** `./init.sh --rapido` en verde, con `INIT_EXIT` escrito **dentro** del log:
      `{ ./init.sh --rapido; echo "INIT_EXIT=$?"; } > gate.log 2>&1`.
      **Hecho:** `INIT_EXIT=0` leído dentro del archivo. Leer el código de salida del
      comando que lo envuelve **no vale**: un `echo` posterior lo tapa y un gate rojo
      llega como «exit code 0». Ya pasó en este repo.
      **Depende de:** T2, T4, T5, T6, T7.
      ⚠️ Antes de la **release** el gate completo (`./init.sh` a secas) es
      **obligatorio**, sin excepción, y sobre el SHA que se despliega.
- [ ] **T9** **Matar las mutaciones.** Aplicar una a una, correr **sólo** la guardia
      afectada, anotar rojo/verde, revertir. Y **un caso de control**: un cambio
      inocuo (reordenar un comentario) que debe salir **verde**.

      | # | Mutación | Debe ponerse roja |
      | --- | --- | --- |
      | 1 | reponer `self.skipWaiting()` en `install` | `pwa-relevo-y-purga` › el relevo |
      | 2 | quitar el borrado de cachés fuera de lista en `activate` | `pwa-relevo-y-purga` › la purga |
      | 3 | `TOPE_ESTATICOS = Infinity` | `pwa-relevo-y-purga` › el tope |
      | 4 | cachear también cuando `!response.ok` | `pwa-relevo-y-purga` › el 404 |
      | 5 | invertir el FIFO (borrar las **últimas** en vez de las primeras) | `pwa-relevo-y-purga` › la recién guardada sigue estando |
      | 6 | `lang="es"` → `lang="en"` | `html-lang` |
      | 7 | añadir un atajo a `/ordenes` en el manifiesto | `pwa-manifiesto-atajos` |
      | 8 | `"id": "/"` → `"id": "/?source=pwa"` | `pwa-manifiesto-atajos` |

      **Hecho:** **8 de 8 muertas** y el control en verde, con la **salida real del
      runner pegada** en la bitácora. En este repo un arnés de mutaciones reportó
      «9/9 supervivientes» **dos veces sin haber ejecutado un solo test**: si no hay
      salida pegada, esta task no está hecha.
      **Depende de:** T8.
- [ ] **T10** **Las comprobaciones manuales M0–M5** del `design.md` §6.3, sobre un
      despliegue **HTTPS que no sea `localhost`** (Q3).
      **Hecho:** las seis filas respondidas con **un número o un nombre** —nunca «se ve
      bien»— en la bitácora. En particular: **M1** dice qué SW está `waiting` y cuál
      `activated`; **M3** dice que las `v1` desaparecieron; **M4** dice cuántas entradas
      quedaron. (R23)
      **Depende de:** el despliegue.
      ⚠️ **No se puede hacer en local.** El SW de producción se autodestruye en
      `localhost`/`127.0.0.1` sin mirar `NODE_ENV` (`public/sw.js:7-9`), así que
      `pnpm build && pnpm start` **tampoco** sirve. Está medido y escrito en
      `progress/current.md:4755-4759`.
- [ ] **T11** **La medición de Lighthouse (M6)**, con el procedimiento del
      `design.md` §7: Chrome de escritorio, incógnito, sesión de **mensajero**,
      dispositivo **Mobile**.
      **Hecho:** en la bitácora quedan escritos **URL, fecha, versión de Chrome,
      versión de Lighthouse** y **el número de cada categoría**; `html-has-lang` y
      `html-lang-valid` en **PASS**; **Accesibilidad ≥ 90**; **0 errores** de
      instalabilidad en Application → Manifest. Si la categoría PWA no existe en esa
      versión, se escribe literalmente «no existe en Lighthouse vX».
      **Si el número no llega al umbral, la ficha no está hecha**: se escribe el número
      que salió y qué auditoría lo baja. (R21, R22)
      **Depende de:** el despliegue.
- [ ] **T12** Bitácora y cierre:
  - [ ] **T12.1** `progress/impl_284-pwa-correcta.md` con el mapa **R → test** de abajo,
        la salida del gate, la de las mutaciones y las mediciones de T0, T10 y T11.
  - [ ] **T12.2** Añadir a `docs/release.md` → «Pendiente para la PRÓXIMA release» lo
        que **sólo** se puede comprobar desplegando: **M1–M4** (el relevo real y el
        tope) y **M6** (Lighthouse), cada uno con su número esperado.
        **Por qué:** ese archivo existe justo porque las comprobaciones que caducan
        acaban siendo casillas de un solo uso dentro del `tasks.md` de una ficha que se
        cierra. Ya pasó tres veces.
  - [ ] **T12.3** Anotar en la ficha de la **285** los dos hallazgos heredados: **H2**
        (el precaché de `/` guarda la página de la sesión de quien instaló, y servir una
        respuesta redirigida a una navegación es un error conocido) y **A7** (dejar de
        cachear `/_next/static/` y confiar en la caché HTTP: elimina la clase entera de
        bug y hay que evaluarlo con el problema del offline entero delante).
  - [ ] **T12.4** Abrir ticket por **Q6**: `scripts/generate-pwa-icons.mjs` no puede
        reproducir los iconos —su fuente `public/next.svg` ya no existe en el árbol—.
        **Hecho:** las cuatro escritas y **commiteadas**. Un informe sin commitear se
        lo lleva el primer `git checkout`; ya pasó tres veces en un día en este repo.

---

## Mapa de trazabilidad · R → test

`✋` = comprobación **manual**, con su criterio en el `design.md`. No se finge
cobertura automática: un service worker no se puede ejercitar entero fuera de un
navegador, y decirlo es parte del trabajo.

| R | Qué se verifica | Dónde |
| --- | --- | --- |
| R1 | el layout raíz declara `lang="es"` | `html-lang.guardia.test.ts` › el layout raíz declara español |
| R2 | los tres documentos HTML de producción declaran `es` | `html-lang.guardia.test.ts` › los tres documentos completos y su censo |
| R3 | `install` no pide el relevo | `pwa-relevo-y-purga.guardia.test.ts` › install no llama skipWaiting |
| R4 | instalar con clientes vivos no borra ninguna caché | `pwa-relevo-y-purga.guardia.test.ts` › instalar no toca las caches existentes |
| R5 | el SW de produccion no navega ni recarga clientes | `pwa-relevo-y-purga.guardia.test.ts` › la rama de produccion no renavega a nadie |
| R6 | el kill-switch de localhost sigue intacto | `pwa-relevo-y-purga.guardia.test.ts` › en localhost limpia y se desregistra |
| R7 | `activate` borra lo que no esta en la lista vigente | `pwa-relevo-y-purga.guardia.test.ts` › activate purga las caches fuera de lista |
| R8 | las `v1` acumuladas se van en el primer activate | `pwa-relevo-y-purga.guardia.test.ts` › las caches v1 desaparecen y las v2 quedan |
| R9 | la caché de estáticos no pasa del tope | `pwa-relevo-y-purga.guardia.test.ts` › el tope recorta las entradas mas antiguas |
| R10 | el recorte no se lleva la recién guardada | `pwa-relevo-y-purga.guardia.test.ts` › la entrada recien guardada sobrevive al recorte |
| R11 | una respuesta no `ok` no se cachea | `pwa-relevo-y-purga.guardia.test.ts` › un 404 no entra en la cache |
| R12 | el precaché sigue siendo dos URLs | `pwa-relevo-y-purga.guardia.test.ts` › install precachea exactamente dos urls |
| R13 | el tope es una constante única y declarada | `pwa-relevo-y-purga.guardia.test.ts` › el tope vive en una sola constante |
| R14 | `id` es exactamente `"/"` | `pwa-manifiesto-atajos.guardia.test.ts` › el id preserva la identidad instalada |
| R15 | no se perdió ninguna clave del manifiesto | `pwa-manifiesto-atajos.guardia.test.ts` › el manifiesto conserva sus diez claves |
| R16 | no hay atajos inalcanzables | `pwa-manifiesto-atajos.guardia.test.ts` › ningun atajo deja fuera a un rol con menu |
| R17 | la regla de los atajos rechaza uno malo | `pwa-manifiesto-atajos.guardia.test.ts` › un atajo a una ruta por rol se rechaza |
| R18 | las dos metas de capacidad están | `pwa-manifiesto-atajos.guardia.test.ts` › el head declara las dos metas de capacidad |
| R19 | el `apple-touch-icon` es un PNG de 180 | `pwa-manifiesto-atajos.guardia.test.ts` › el apple-touch-icon mide 180 |
| R20 | todo PNG referenciado existe y mide lo que dice | `pwa-manifiesto-atajos.guardia.test.ts` › cada png referenciado existe y mide lo declarado |
| R21 | Lighthouse: idioma en PASS y Accesibilidad ≥ 90 | ✋ **M6** — `design.md` §7, número escrito en la bitácora (T11) |
| R22 | 0 errores de instalabilidad | ✋ **M5** — `design.md` §6.3 (T10) |
| R23 | el relevo, comprobado en HTTPS real | ✋ **M1–M4** — `design.md` §6.3 (T10) |
| R24 | los tests corren siempre en el gate rápido | los tres archivos viven en `tests/unit/guards/`; `pnpm run test:guardias` los selecciona sin registrarlos en ninguna lista |

**Requisitos sin test automático: R21, R22, R23** — los tres son medidas en un
navegador contra un despliegue HTTPS. Se declaran así a propósito: en `localhost` el
SW de producción no existe, y la R17 de la ficha 64 ya se aprobó una vez con un
razonamiento («los elementos necesarios están presentes, lo que asegura el puntaje»)
en lugar de con un número. Aquí el número se escribe o la ficha no cierra.

---

## Puerta de aprobación

Este `tasks.md` **no se empieza** hasta que el humano responda las preguntas
abiertas de `requirements.md`. Las que bloquean de verdad son:

- **Q2** (los atajos: 0 con guardia, ficha para la ruta despachadora, o atajos con
  404 asumido) → decide T5/T6.
- **Q3** (dónde se hace la comprobación manual) → decide si T10 y T11 se pueden
  hacer **antes** de desplegar o quedan en `docs/release.md` para después.
- **Q5** (el tope: medido hoy o «sin calibrar») → decide T2.5.
- **Q1** (dar de alta la 284 en `feature_list.json`) → sin eso `./init.sh` falla en
  cuanto la ficha pase a `in_progress`.
