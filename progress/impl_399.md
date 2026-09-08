# Ficha 399 — el aviso de ubicación mandaba a un candado que no existe

Zona frontend, sin spec (`sdd: false`), **sin migración**. Rama `worktree-agent-a87c8432dbdceae1a`.

## El fallo, confirmado en el código antes de tocar nada

Los tres puntos del diagnóstico se comprobaron uno a uno en el árbol real, no en el grafo:

1. **Cierto.** El texto vivía en `GestionarOrdenPanel.tsx` (`MSG_UBICACION_DENEGADA`, una sola
   constante) y solo se disparaba en `captura.estado === "denegado"`, que
   `lib/utils/capturar-ubicacion.ts` devuelve **únicamente con el código 1**. Timeout (3),
   posición no disponible (2) y contexto inseguro salen por `ausente` y **no muestran ese texto**:
   la gestión sigue. La asimetría está intacta — ese archivo **no se ha tocado**.
2. **Cierto.** `public/manifest.json` declara `"display": "standalone"`. Abierta desde el ícono no
   hay barra de direcciones ni candado, y el mensaje mandaba a tocarlo igual.
3. **Cierto y no cubierto:** ni «Ajustes», ni «Aplicaciones», ni «Usar ubicación precisa»
   aparecían en ninguna parte del repo. `grep -rn "candado"` sobre `app/`, `components/`, `lib/` y
   `hooks/` da **un solo** sitio con este mensaje: la línea 85 del panel.

## Qué se hizo

`lib/utils/aviso-ubicacion-denegada.ts` (módulo nuevo) decide el texto a partir de **dos señales
estándar**, y el panel solo lo pide y lo pinta:

| señal | qué aporta |
| --- | --- |
| `matchMedia("(display-mode: standalone \| fullscreen \| minimal-ui)")` | si hay o no barra de direcciones que tocar |
| `navigator.permissions.query({ name: "geolocation" })` | si lo bloqueado es **el sitio**, **el teléfono**, o **nadie todavía** |

Además del toast (que se va solo), los pasos quedan **en la pantalla**, en un `Alert` de shadcn
pegado al botón que acaba de fallar: un aviso que desaparece a los 5 s no sirve para ir a los
Ajustes del teléfono y volver.

## Los cuatro textos, palabra por palabra

**1 · App instalada** (`display-mode` de app; cualquier estado del permiso salvo «sin decidir»)

> Toast: «Para registrar la gestión hace falta tu ubicación. Abriste Ordenex desde su ícono, así
> que el permiso se activa en los Ajustes del teléfono.»
> Título: **Activá la ubicación desde los Ajustes del teléfono**
> 1. Abrí los Ajustes del teléfono (en algunos se llama Configuración).
> 2. Entrá en Aplicaciones y buscá Ordenex.
> 3. Tocá Permisos y después Ubicación.
> 4. Elegí «Permitir solo mientras usás la app» y dejá activado «Usar ubicación precisa».
> 5. Volvé a Ordenex y tocá «Guardar gestión» otra vez.

**2 · Navegador**, con el sitio denegado o sin poder saberlo — *el texto del toast es el de
siempre, palabra por palabra: en un navegador era correcto y no se «corrigió»*

> Toast: «Para registrar la gestión hace falta tu ubicación. Activá el permiso desde el candado de
> la barra de direcciones (Permisos del sitio → Ubicación) y volvé a intentarlo.»
> Título: **Activá la ubicación para este sitio**
> 1. Tocá el candado que está al lado de la dirección web, arriba.
> 2. Entrá en Permisos del sitio y activá Ubicación.
> 3. Volvé acá y tocá «Guardar gestión» otra vez.
> Nota: Si abriste Ordenex desde un enlace de WhatsApp y no ves el candado, tocá los tres puntos y
> elegí «Abrir en Chrome».

**3 · Navegador con el sitio YA concedido** (y aun así código 1 → el bloqueo está por encima)

> Toast: «Para registrar la gestión hace falta tu ubicación. Este sitio ya tiene el permiso, así
> que hay que dárselo al navegador desde los Ajustes del teléfono.»
> Título: **El permiso lo tiene que dar el teléfono**
> 1. Abrí los Ajustes del teléfono (en algunos se llama Configuración).
> 2. Entrá en Aplicaciones y buscá el navegador que estás usando: Chrome, Samsung Internet…
> 3. Tocá Permisos y después Ubicación.
> 4. Elegí «Permitir solo mientras usás la app» y dejá activado «Usar ubicación precisa».
> 5. Volvé acá y tocá «Guardar gestión» otra vez.

**4 · El aviso que nunca se contestó** (`prompt`, los dos contextos)

> Toast: «Para registrar la gestión hace falta tu ubicación. Tocá «Guardar gestión» otra vez y
> elegí «Permitir» cuando el teléfono te pregunte.»
> Título: **Falta que aceptes el aviso de ubicación**
> 1. Tocá «Guardar gestión» otra vez.
> 2. Cuando el teléfono te pregunte por la ubicación, elegí «Permitir».
> Nota (app instalada): Si no te sale ningún aviso, activá la ubicación en los Ajustes del
> teléfono: Aplicaciones → Ordenex → Permisos → Ubicación.
> Nota (navegador): Si no te sale ningún aviso, tocá el candado que está al lado de la dirección
> web y activá Ubicación.

## Lo que aporta `navigator.permissions.query`, y lo que no

**Sí distingue**, y por eso está: `denied` = el sitio está bloqueado (el candado, o la app);
`granted` con código 1 = el sitio tiene permiso y quien lo niega es el teléfono, así que mandar al
candado sería mandar a un interruptor ya encendido; `prompt` = nadie decidió nada y no hay ningún
ajuste que cambiar, solo volver a intentarlo y tocar «Permitir» — que es el caso más frecuente de
llegar aquí sin haber bloqueado nada.

**No siempre está**, y no se fuerza: si `navigator.permissions` no existe, no conoce
`geolocation` o `query` lanza (Safari), el desenlace es `desconocido` y el texto lo decide el
contexto. Nunca lanza ni deja el botón colgado.

**Dentro de la app instalada NO se usa para partir el texto**: el permiso del sitio y el de la
aplicación son el mismo interruptor para quien lo usa, así que `denegado`, `concedido` y
`desconocido` van todos a la misma ruta de Ajustes. Partirlos solo daría dos sitios a los que ir.

## Lo que NO se hizo, y por qué

- **No se detecta el navegador embebido de WhatsApp.** No hay API que lo diga. La única vía es el
  user agent, que es justo lo que una app anfitriona puede reescribir, y WhatsApp además abre unas
  veces en su WebView y otras en una pestaña del navegador —donde el candado SÍ existe—. Una
  detección a medias manda a la gente al sitio equivocado con más confianza que ahora, que es
  exactamente el fallo que esta ficha viene a arreglar. Se cubre con **un** texto que sirve en los
  dos: el candado, más la línea de «Abrir en Chrome» para quien no lo vea.
- **No se distingue Android de iOS.** El caso medido es Android (Samsung) y la ruta que se da es la
  de Android. Con la app en la pantalla de inicio de un iPhone los menús no se llaman exactamente
  así. Queda **declarado como límite conocido**, no inventado. `detectarPlataforma` de
  `lib/utils/navegacion-externa.ts` permitiría partirlo, pero la ruta de iOS habría que adivinarla.
- **No se toca `lib/utils/capturar-ubicacion.ts`.** La asimetría `ausente`/`denegado` de la feature
  193 sigue igual, y con ella el bloqueo de R19.
- **No se toca `feature_list.json` ni `progress/current.md`.**

## Decisiones que tomé yo

1. **El default de la detección cae del lado del navegador.** Sin `matchMedia` (servidor,
   navegador antiguo) se da por `navegador`. No es simetría: `matchMedia` lo tiene cualquier
   navegador capaz de instalar una PWA, así que si falta, lo que hay delante no es una app
   instalada — y además es el texto que ya se venía dando. Tiene su test y su mutación.
2. **El contexto se lee en el manejador del evento, no al renderizar.** Es la respuesta a «que el
   primer render no mienta»: no hay primer render que mienta porque no se pinta nada hasta que la
   captura falla, y para entonces ya se está en el navegador. `window` no se toca durante el SSR.
3. **Los pasos van a la pantalla, no solo al toast.** El pedido era «corto, en pasos»; un toast es
   una sola frase que se va sola, y estos pasos hay que leerlos yendo a Ajustes y volviendo.
4. **«Abrí los Ajustes del teléfono (en algunos se llama Configuración)»**: en One UI (el teléfono
   del caso) se llama Ajustes y en Android de fábrica en es-419 se llama Configuración. Nombrar
   solo uno deja a la mitad buscando un ícono que no existe.
5. **El bloque lleva su título como nombre accesible** (`aria-labelledby`): esta pantalla pinta
   varios `role="alert"` a la vez (errores por campo, fallo del hilo de notas) y sin nombre son
   indistinguibles para un lector de pantalla — y para el test.

## Archivos

| archivo | qué |
| --- | --- |
| `lib/utils/aviso-ubicacion-denegada.ts` | **nuevo.** Elige el texto; detecta contexto y permiso |
| `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` | pide el aviso al denegar y pinta los pasos |
| `tests/unit/utils/aviso-ubicacion-denegada.test.ts` | **nuevo.** 24 casos |
| `tests/components/GestionarOrdenUbicacionContexto.test.tsx` | **nuevo.** 12 casos, en la pantalla |

`tests/components/GestionarOrdenUbicacion.test.tsx` (feature 193) **no se tocó** y sigue verde: su
aserción de que el aviso dice DÓNDE reactivar el permiso no se ha debilitado.

## Mutaciones (4, todas rojas)

Control antes y después de cada una: **36 passed (36)** en los dos archivos. Cada mutación se
comprobó **en disco** antes de correr (`grep` de la línea mutada + `md5sum`), y al revertir el
`md5sum` volvió al del original — o sea que lo que corrió fue el código mutado, no el sano.

| # | mutación | resultado |
| --- | --- | --- |
| M1 | la app instalada vuelve a caer en el texto del candado (**el fallo de campo**) | **8 failed / 28 passed** |
| M2 | el navegador recibe el texto de Ajustes de Android | **9 failed / 27 passed** |
| M3 | sin `matchMedia` la detección cae del lado de «app instalada» | **2 failed / 34 passed** |
| M4 | se deja de mirar la Permissions API (todo `desconocido`) | **5 failed / 31 passed** |

M1 mata, entre otros, «NO manda al candado: en esa pantalla no hay barra de direcciones»; M2 mata
«NO manda a los Ajustes de Android, que aquí no arreglan nada»; M3 mata «sin matchMedia cae del
lado del NAVEGADOR» en los dos archivos.

## Gate

`./init.sh` **completo**, con `.env` copiado del árbol principal, la base migrada
(`prisma migrate deploy` → *No pending migrations*) y `pnpm run db:generate` después.
Log propio: `/tmp/gate-399-a87c8432.log` (12.680 líneas; sin `tail`, con `INIT_EXIT` escrito
DENTRO del log).

```
✓ DATABASE_URL resuelta: los 143 archivos de tests contra Postgres SI se ejecutan
 Test Files  1821 passed (1821)
      Tests  26150 passed | 26 skipped (26176)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1821 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

Los **26 saltados** son los conocidos, y la línea de `DATABASE_URL` confirma que la capa de datos
se ejecutó de verdad: no es el verde vacío de un worktree sin `.env`.
`tests/integration/recuperar-contrasena-form.test.tsx` **no salió rojo** en esta corrida, así que
no hubo nada que aislar y **no se tocó `tests/baseline-rojos.json`**.

El `.env` se borró antes de commitear.
