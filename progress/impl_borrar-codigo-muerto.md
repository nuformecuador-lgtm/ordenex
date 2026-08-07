# Borrar código muerto de UI — tanda 1 (los CONSUMIDORES)

**Rama:** `chore/borrar-codigo-muerto` (desde `origin/dev` @ `3713e743`)
**Fecha:** 2026-08-07 · **Decisión:** humana, tomada hoy
**Alcance:** SOLO la capa de presentación. Las Server Actions que queden huérfanas las borra
la **tanda 2**. El orden es deliberado: borrar el proveedor antes que el consumidor deja el
árbol roto entre tandas.

**Commits:**

| # | Hash | Frente |
|---|------|--------|
| 1 | `1b3dc655` | `chore(ui): borra el arbol de zonas de /configuracion, que ninguna ruta montaba` |
| 2 | `da544b30` | `chore(ui): borra ChatWhatsappPanel, sustituido por el chat flotante` |

---

## 1 · Medición ANTES de tocar nada

Se leyó primero `tests/unit/guards/superficie-de-uso.guardia.test.ts` (PR #300), que es quien
censó estos casos, y se tomó la línea base:

| Medida | Antes |
|---|---|
| Anotaciones `@sin-superficie` en `app/`+`components/`+`lib/`+`hooks/`+`providers/` | **24** |
| De ellas, de COMPONENTE (las que mide R-B) | **5** |
| `pnpm test:guardias` (`vitest run guard`) | **70 archivos / 958 tests, verde** |
| `pnpm run typecheck` | limpio |

Las 5 anotaciones de componente eran exactamente las que la guardia declara en su propio
comentario de R-B («hoy son cinco módulos»): `ZonasModule`, `ZonaForm`, `zonas-columns`,
`ChatWhatsappPanel` y `components/shared/TableFilters.tsx`.

También se verificó **antes** de borrar que ninguna de las dos rutas de reemplazo se veía
afectada: `configuracion/tarifas/page.tsx` monta `ZonasTarifasModule`, y `reparto` monta
`RepartoModule → ChatFlotante → ChatConversacion`.

---

## 2 · `git log -S` — «nació muerto» vs «lo mató un borrado»

**Los dos casos son "lo mató un borrado".** Ninguno nació sin pantalla. Los hashes:

### Frente 1 — el árbol de zonas

```
git log --oneline -S "ZonasModule" -- app components
```

| Hash | Qué hizo |
|---|---|
| `cf4a29b4` | feature 24: lo crea, montado en `configuracion/page.tsx` |
| `3da4764d` | feature 55: reconstruye `ZonaForm` y cablea `centralActual` |
| **`19b9cccf`** | **«remove zones from cofign>user», 2026-07-22 11:03 — LO MATA** |
| `b351ab9a` | la guardia de superficie de uso lo censa (2026-08-05) |

`19b9cccf` toca **un solo archivo**, `app/(app)/configuracion/page.tsx`, y le quita de golpe:
el `import` de `ZonasModule` y de `listarZonas`, la pre-carga entera (`resZonas` →
`zonasData`), la `<section>` con el `<h2>Zonas</h2>`, y cambia la descripción de la página de
«Gestión de usuarios y zonas del sistema» a «Gestión de usuarios del sistema». Es un borrado
coherente y deliberado a nivel de página: **el árbol de componentes se quedó atrás**, 16 días.

Confirmación independiente, en el repo y anterior a este chore: la nota al pie de
`tests/integration/configuracion/zonas-page.test.tsx` ya lo decía por escrito — «la gestión de
zonas se movió de `/configuracion` a `/configuracion/tarifas` (rama flow, commit *remove zones
from config>user*)». La pregunta de producto que la anotación dejaba ABIERTA («¿deliberado o
descuido?») estaba respondida en el árbol; hoy la ratifica el humano.

### Frente 2 — `ChatWhatsappPanel`

```
git log --oneline -S "ChatWhatsappPanel" -- app components
```

Solo **dos** commits, y son el nacimiento y la muerte:

| Hash | Qué hizo |
|---|---|
| `350e8599` | feature 120: crea el panel y lo monta en `GestionarOrdenPanel.tsx` |
| **`6dc18dc2`** | **«visual adjustments», 2026-07-30 15:07 — LO MATA** |

`6dc18dc2` quita de `GestionarOrdenPanel.tsx` el `import { ChatWhatsappPanel … }` y su
`<ChatWhatsappPanel>` (el único montaje que tuvo en toda su vida) y, **en el mismo commit**,
añade `chat-demo/ChatConversacion.tsx`, `chat-demo/ChatFlotante.tsx` y
`chat-demo/ChatOrdenesLista.tsx`. Es decir: fue una **sustitución**, no un descuido. Lo que
faltó fue borrar el sustituido — que es justo lo que hace esta tanda.

**Por qué importa la distinción.** «Nació muerto» habría significado una capacidad que nunca
se cableó (y entonces borrar la UI puede estar tirando una función pedida). «Lo mató un
borrado» significa que hubo pantalla, alguien la retiró a conciencia y dejó el resto colgando.
En los dos frentes es lo segundo, y en los dos existe el sustituto vivo — que es la condición
que hace seguro el borrado.

---

## 3 · Qué se borró

### Frente 1 (`1b3dc655`) — 7 archivos

Producción:
- `app/(app)/configuracion/_components/ZonasModule.tsx`
- `app/(app)/configuracion/_components/ZonaForm.tsx`
- `app/(app)/configuracion/_components/zonas-columns.tsx`

Tests (uno estaba en el encargo; los otros tres aparecieron al buscar):
- `tests/unit/components/zona-form.test.tsx`
- `tests/unit/components/zonas-module.test.tsx`
- `tests/unit/components/zonas-columns.test.tsx`
- `tests/integration/configuracion/zonas-page.test.tsx`

Sobre este último: tras `19b9cccf` le quedaban dos tests que afirmaban la **ausencia** de un
stub que la página ya no podía renderizar (R29). La autorización real de
`configuracion/page.tsx` la cubre `usuarios-page.test.tsx` en sus **dos** caminos (rol no
autorizado y sesión ausente), incluido el `No tienes permiso`, así que no se pierde cobertura.

### Frente 2 (`da544b30`) — 2 archivos

- `app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx`
- `tests/components/ChatWhatsappPanel.test.tsx`

### Modificados (arrastre, no alcance nuevo)

| Archivo | Por qué |
|---|---|
| `tests/integration/configuracion/usuarios-page.test.tsx` | tenía un `vi.mock` de `ZonasModule` (módulo ya inexistente → no resuelve) y un mock de `listarZonas` que aislaba una pre-carga que la página no hace desde `19b9cccf` |
| `tests/unit/descarga/censo-tablas.ts` | tenía registrada la tabla de `ZonasModule`; el registro no puede citar un archivo borrado |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | cuatro totales declarados (ver §5) |
| `tests/unit/descarga/contadores-cabecera.guardia.test.ts` | piso de anti-vacuidad (ver §5) |
| `chat-demo/ChatConversacion.tsx`, `chat-demo/ChatFlotante.tsx`, `RepartoModule.tsx` | tres comentarios afirmaban «los dos conviven» sobre un archivo que dejaba de existir |

**No se tocó `lib/`.** `git diff origin/dev -- lib/` sale **vacío**.

---

## 4 · La trampa de los nombres casi idénticos: verificada

En `lib/actions/whatsapp-envio.ts` conviven `listarPlantillasEnviables` (muerta, la borra la
tanda 2) y `listarPlantillasParaEnvio` (**VIVA**). El test borrado mockeaba **la viva**. Tras
el borrado se comprobó una a una:

- `listarPlantillasParaEnvio` sigue en el archivo (línea 51) y sigue importada y llamada por
  `app/(app)/mis-asignaciones/_components/EnviarPlantillaWhatsappButton.tsx` (líneas 16 y 99);
- `listarPlantillasActivasParaEnvio` (línea 70) y `listarPlantillasEnviables` (línea 90),
  intactas;
- `git diff -- lib/` vacío.

---

## 5 · Guardias: antes / después

| Medida | Antes | Después |
|---|---|---|
| Anotaciones `@sin-superficie` (total) | **24** | **20** |
| — de componente (R-B) | 5 | **1** |
| — de Server Action (R-A) | 19 | 19 (sin tocar) |
| `vitest run guard` | 70 archivos / 958 tests ✅ | **70 / 958 ✅** |

Las 4 anotaciones que desaparecen son exactamente las de los 4 componentes borrados. **No
queda ninguna huérfana**: la guardia caduca las anotaciones que sobreviven a su motivo, y se
quitaron con el código, no después.

La única anotación de componente que queda es `components/shared/TableFilters.tsx` — ver §7.

### Rojos que salieron y por qué (los dos son conteo de censo, no lógica)

1. **`cobertura-tablas.guardia`** — `ZonasModule` montaba un `<DataTable>` censado como
   `fuera`. Al borrar el archivo, el registro citaba algo inexistente y cuatro totales
   declarados dejaron de cuadrar. Ajustados con su motivo escrito:
   `TOTAL_ARCHIVOS_CON_DATATABLE` 31→30, `TOTAL_INSTANCIAS_DATATABLE` 32→31, exclusiones con
   `<DataTable>` 6→5, censo total 33→32. **Las 26 `con_descarga` NO se mueven**, y esa
   asimetría es el dato que importa: lo borrado era una exclusión declarada, no una tabla que
   descargara. Ninguna descarga se pierde. (Caso análogo al de `OrdenesApartado.tsx` del
   2026-07-31, con esa diferencia: aquélla sí descargaba.)

2. **`contadores-cabecera.guardia`** — `expected 30 to be greater than or equal to 31`.
   `ZonasModule` montaba `<Pagination>` y `<DataTable>` en el mismo archivo, así que contaba
   como «pantalla paginada». Piso bajado 31→30. Es la **primera vez que ese número baja**: su
   comentario decía «solo puede SUBIR». Se dejó escrito en el propio archivo que bajarlo solo
   es legítimo cuando se puede **nombrar** la pantalla que desapareció; si vuelve a bajar sin
   nombre, lo que se rompió es el detector.

Ninguna guardia salió roja por lógica ni por una anotación huérfana. Tras los ajustes,
`vitest run guard` vuelve a **70/958 verde**, el mismo número que antes: no se borró ni se
añadió ningún archivo de guardia.

---

## 6 · Verificación

| Paso | Resultado |
|---|---|
| `pnpm run typecheck` tras Frente 1 | **limpio** |
| `pnpm run typecheck` tras Frente 2 | **limpio** |
| `vitest run guard` tras cada frente | **70 archivos / 958 tests, verde** |
| `vitest run tests/integration/configuracion` | 4/4 |
| `vitest run RepartoModule + MisAsignacionesPage + chat-plantilla-nombre` | 97/97 |
| `eslint` sobre los archivos tocados | 0 errores |
| **`./init.sh --rapido`** | **`== init OK ==`, exit 0** — `test:cambiados` 7 archivos/124 tests, `test:guardias` 70/958 |

Sin flakes: ningún test de componente necesitó repetirse en aislado.

Las 48 advertencias de `eslint` (0 errores) son preexistentes; ninguna cae en un archivo
creado o modificado por este chore.

---

## 7 · Lo que hay que saber mañana

### QUÉ QUEDÓ VIVO Y SE PARECE A LO BORRADO

**Zonas.** La gestión de zonas **no se pierde, se mudó**. Lo vivo es
`app/(app)/configuracion/tarifas/_components/ZonasTarifasModule.tsx` + `CrearZonaForm.tsx`,
montados desde `configuracion/tarifas/page.tsx`. No se tocaron. Si alguien busca «el CRUD de
zonas» y no lo encuentra en `configuracion/_components/`, está en `configuracion/tarifas/`.
Nótese que `ZonasTarifasModule` **no** monta `<DataTable>`, y por eso nunca figuró en el censo
de tablas: su ausencia de ese registro **no** significa que esté muerto.

`zonasConfig` (`lib/config/zonas.ts`) **no** queda huérfano: lo usa `lib/types/zona.ts`.

**Chat.** Lo vivo es `chat-demo/ChatFlotante.tsx` + `chat-demo/ChatConversacion.tsx` +
`chat-demo/ChatOrdenesLista.tsx`, montados desde `RepartoModule`. Las Server Actions de
`lib/actions/chat-whatsapp.ts` se conservan **enteras**.

Sobreviven también los dos componentes que `ChatWhatsappPanel` importaba, porque tienen otros
consumidores — se comprobó uno a uno antes de borrar:
- `EnviarPlantillaWhatsappButton` ← `GestionarOrdenPanel.tsx`
- `UbicacionModal` ← `ChatConversacion.tsx`, `pos-card/PosNavBlock.tsx`, `UbicacionTrigger.tsx`

### ⚠️ Trampa de nombres que este borrado NO arregla

**El chat VIVO vive en una carpeta llamada `chat-demo/`, y el comentario que lo monta en
`RepartoModule.tsx` lo llama «MAQUETA».** El que acaba de borrarse tenía el nombre de
producción (`ChatWhatsappPanel`). Cualquiera que llegue con el instinto «lo `demo` es lo
desechable» borrará el chat real. No se ha renombrado porque renombrar una carpeta de UI viva
excede el alcance de un chore de borrado, pero **queda ABIERTO**: o se renombra `chat-demo/` a
algo que no mienta, o se deja escrito por qué se llama así.

### Abierto para la tanda 2

Se confirma, desde el lado del consumidor, que estas quedan sin ningún importador vivo:
- `lib/actions/geo.ts` **entero** (3 anotaciones: `listarProvincias`, `listarCantones`,
  `listarDistritos`) — su único importador era `ZonaForm.tsx`;
- `arbolZonas` de `lib/actions/zonas.ts` — mismo importador. El resto de ese módulo
  (`crearZona`, `obtenerZona`, `borrarZona`, `listarZonas`) **SÍ vive**, por
  `ZonasTarifasModule`.

**Aviso concreto para quien haga la tanda 2:** el texto de esas 4 anotaciones nombra
`configuracion/_components/ZonaForm.tsx`, que **ya no existe**. Si por lo que sea la tanda 2 no
llega a borrarlas, hay que reescribir el motivo: seguirán siendo válidas (nada las volvió
alcanzables, así que la guardia no las caduca) pero apuntarán a un archivo fantasma.

### Ningún consumidor oculto encontrado

Se buscaron consumidores en `app/`, `components/`, `lib/`, `hooks/`, `providers/`, `tests/`,
`e2e/` y `scripts/`. **No apareció ninguno vivo** que el encargo no previera. Lo que sí
apareció, y no estaba en el encargo, fueron **tres tests y dos guardias de censo** (§3, §5).

### Curiosidad, por si vuelve a aparecer

`ZonaForm.tsx` contenía un **byte NUL literal** (offset 12487, dentro del literal
`"\0sin-provincia"`), lo que hacía que `grep` lo tratara como binario y no mostrara sus
coincidencias — `file` lo reportaba como `data`, no como texto. Hubo que usar `grep -a` para
auditarlo. Si otra búsqueda futura «no encuentra» algo que sabes que está, comprueba esto
antes de concluir que el código no existe. El archivo ya no está, pero el patrón puede
repetirse.

### Deuda vecina, NO borrada (fuera de la decisión humana de hoy)

`components/shared/TableFilters.tsx` sigue anotado `@sin-superficie` y su propio motivo dice
«componente genérico de `de69f7d1` (2026-07-13) que ninguna pantalla llegó a usar nunca […]
candidato claro a borrado». Es la **única** anotación de componente que queda en el repo. No
se ha tocado porque **no estaba en el encargo** y no hay decisión humana sobre ella. Queda
**ABIERTO**. Ojo: éste sí parece «nació muerto» (deuda genérica), no «lo mató un borrado»
— habría que confirmarlo con su propio `git log -S` antes de decidir.

---
---

# Borrar código muerto — tanda 2 (los PROVEEDORES)

**Rama:** `chore/borrar-codigo-muerto` · **Fecha:** 2026-08-07 · **Decisión:** humana, la misma
de hoy. Segunda y última tanda: la 1 borró los consumidores de UI, ésta borra las Server Actions
que quedaron sin nadie que las llamara, más tres que nunca lo tuvieron.

**Commits:**

| # | Hash | Frente |
|---|------|--------|
| 3 | `35f3c910` | `chore(actions): borra geo.ts entero y arbolZonas, sin importador desde 19b9cccf` |
| 4 | `364f6358` | `chore(actions): borra el envio de WhatsApp por Meta, que nunca tuvo boton` |
| 5 | `6ab509fa` | `chore(actions): borra marcarNotificacionLeida, que nunca tuvo punto de entrada` |

---

## 8 · `git log -S`: aquí se parte en dos, y ésa es la noticia

La tanda 1 encontró **dos casos y los dos eran «lo mató un borrado»**. La tanda 2 encuentra
**las dos formas**, y la frontera cae exactamente donde separa un descuido de una deuda:

| Símbolo | Veredicto | Commit | Cuánto vivió |
|---|---|---|---|
| `listarProvincias` / `listarCantones` / `listarDistritos` (`geo.ts`) | **lo mató un borrado** | nacen en `40bbab57` (2026-07-12), las mata **`19b9cccf`** (2026-07-22) | 10 días con pantalla |
| `arbolZonas` | **lo mató un borrado** | nace en `26405a8e`/`3da4764d`, la mata **`19b9cccf`** | ídem |
| `listarPlantillasEnviables` | **nació muerta** | `eb50730f`/`2dfd7c50` (2026-07-23) | nunca |
| `enviarPlantillaWhatsapp` | **nació muerta** | `eb50730f`/`2dfd7c50` (2026-07-23) | nunca |
| `marcarNotificacionLeida` | **nació muerta** | `cf4e9e3f` (2026-07-27, feature 146) | nunca |

**Cómo se mide, para que se pueda repetir.** `git log -S "<símbolo>" -- app components` es la
pregunta «¿existió alguna vez una pantalla que nombrara esto?». Para las **tres últimas** la
respuesta es una lista **VACÍA**: ni un solo commit en `app/` ni en `components/` en toda su
vida. No hay ambigüedad posible — no es que se perdiera el consumidor, es que nunca se escribió.

Para las de zonas la lista NO está vacía, y ahí está el matiz que casi se pierde: los commits que
salen son los de `ZonaForm.tsx`, que sí las importaba y llamaba. Lo que las mató no aparece en
ese `-S`, porque `19b9cccf` no tocó ninguno de esos nombres: quitó el **montaje de `ZonasModule`**
de `configuracion/page.tsx`, un nivel más arriba. Es **muerte de segundo orden**, la misma forma
del bug de `rutearABodegaSatelite`, y por eso hace falta la segunda consulta:

```
git log --oneline -S "ZonasModule" -- "app/(app)/configuracion/page.tsx"
19b9cccf 2026-07-22 remove zones from cofign>user
258bd6ad 2026-07-14 fix(64): repone zonas en /configuracion, geografia CR y guarda de catalogo
...
```

(De paso: `258bd6ad` las había **repuesto** el 2026-07-14. O sea que zonas se quitó de
`/configuracion`, se repuso, y se volvió a quitar. El `19b9cccf` no fue un resbalón aislado.)

**Por qué importa la distinción, ahora que salen las dos.** «Lo mató un borrado» dice que hubo
una capacidad en producción y alguien la retiró: la pregunta es si el sustituto la cubre (en
zonas sí, `ZonasTarifasModule`). «Nació muerta» dice que se implementó backend para un botón que
nunca se escribió: la pregunta es de producto, no de regresión, y nadie perdió nada al borrarlo.
Confundirlas es lo que produce el miedo a borrar. Las tres «nacidas muertas» de hoy sostuvieron
un service, dos tipos y sus tests en verde durante meses sin que un usuario pudiera llegar a ellos.

---

## 9 · Qué se borró

### Frente 1 (`35f3c910`) — el resto del árbol de zonas

- `lib/actions/geo.ts` **entero** (3 acciones) — el único módulo de `lib/actions/` que ninguna
  raíz de ruta alcanzaba.
- `tests/integration/actions/geo-action.test.ts` **entero** — sólo cubría el módulo borrado.
- `arbolZonas` de `lib/actions/zonas.ts` (**sólo esa función**) y su import de tipo
  `ArbolZonasResult`.
- De `tests/integration/actions/zonas-action.test.ts`, **sólo lo suyo**: el import, la línea del
  bloque «sin sesión» y el `describe("arbolZonas")`. El resto cubre las acciones vivas.
  `fakeService` conserva `arbol:` porque `IZonaService` sigue declarándolo.

**El resto de `lib/actions/zonas.ts` está vivo y no se tocó:** `crearZona`, `obtenerZona`,
`listarZonas`, `actualizarZona`, `borrarZona`, por `ZonasTarifasModule`.

### Frente 2 (`364f6358`) — el camino Meta de WhatsApp

De `lib/actions/whatsapp-envio.ts`, **exactamente dos funciones**: `enviarPlantillaWhatsapp` y
`listarPlantillasEnviables`. Con ellas cae lo que sólo ellas usaban dentro del archivo: `idSchema`
(y el import de `zod`), `buildEnvioService`, el campo `service` de `WhatsappEnvioDeps` y seis
imports. Ningún test importaba este módulo (el único que lo mockeaba lo borró la tanda 1).

### Frente 3 (`6ab509fa`) — `marcarNotificacionLeida`

- La acción y su anotación en `lib/actions/notificaciones.ts`. La campana pasa de **cinco a
  cuatro** acciones.
- De `tests/integration/actions/notificaciones-action.test.ts` y
  `tests/components/NotificationsBell.test.tsx`, **sólo lo suyo**.

**Dos aserciones se REAPUNTARON en vez de borrarse**, porque no probaban la acción muerta sino
ramas **compartidas** que se habrían quedado sin testigo:

| Aserción | Antes | Ahora | Por qué |
|---|---|---|---|
| R36 «id vacío» | `marcarNotificacionLeida("")` | `descartarNotificacion("")` | la rama de **cadena vacía** de `notificacionIdSchema` vive en `idValidado`, común a las acciones que quedan. La otra prueba de R36 usa `42` (no-texto), que es OTRA rama |
| propagación de `forbidden` | `marcarNotificacionLeida` | `descartarNotificacion` | mismo `toActionError`; sin esto `forbidden` se quedaba sin ningún test en el borde |

---

## 10 · ⚠️ Lo que la guardia se lleva por delante si no miras: sus PROPIAS anclas

Esto no estaba en el encargo y es la trampa que más cerca estuvo de romper la suite. La guardia
de superficie de uso **se ancla en código real** para auto-probarse, y **dos de sus anclas eran
justo lo que había que borrar**:

1. `superficie-de-uso.guardia.test.ts:471` — el caso «el lector de símbolos registra el nombre en
   ORIGEN de un alias» usaba `import { listarProvincias, type ZonaDTO } from "@/lib/actions/geo"`.
   No es prosa: `aristasDeSimbolo` llama a `resolverEspecificador`, que hace `existsSync`. Al
   borrar `geo.ts` el especificador pasa a `no-resuelto`, no se registra arista, y el
   `expect(geo?.nombres).toContain(...)` cae sobre un `undefined`. **Reapuntada a
   `@/lib/actions/zonas`**, que es código vivo y tiene la misma forma (valor + tipo en línea).
2. `superficie-de-uso.guardia.test.ts:586` — la anti-vacuidad del censo afirmaba
   `toContain("lib/actions/notificaciones.ts#marcarNotificacionLeida")`. **Reapuntada a
   `descartarNotificacion`**, que además está **viva**: un ancla viva no vuelve a caer en la
   próxima limpieza, y eso es estrictamente mejor que la que había.

Ninguna de las dos debilita la guardia: prueban lo mismo sobre otro archivo. Pero conviene
saberlo, porque **la guardia que detecta código muerto contiene referencias a código muerto**, y
eso se va a repetir cada vez que alguien borre algo que ella cite. Si un día sale roja por
`no-resuelto` o por un `toContain` de un símbolo, mira primero si el rojo es la guardia
protestando por su propio ancla y no por el árbol.

También se puso al día su prosa de cabecera (línea 23), que citaba `geo.ts` y `arbolZonas` como
ejemplos vigentes de muerte de segundo orden. Se conservan como **el hallazgo** que justifica la
primitiva —es su mejor argumento— pero marcados como ya borrados.

---

## 11 · Huérfanos NUEVOS: nombrados, NO borrados

Borrar una acción deja colgando lo que sólo ella usaba. Se midió uno a uno; **nada de esto se ha
borrado**, porque no está en la decisión humana de hoy.

### El grande: `lib/services/EnvioPlantillaWhatsappService.ts`

**El encargo daba por hecho que seguía vivo. No lo está, y no lo estaba ya.** El encargo decía
que lo usan `ChatWhatsappService.ts`, `whatsapp-chat-envio-handler.ts`, `plantillas-sync.ts` y el
cron. Se comprobó una a una: **las tres únicas menciones que quedan en TODO el código son
comentarios en PROSA** —`ChatWhatsappService.ts:5` y `:406` («mismo patrón que…», «misma cadena
que…») y `whatsapp-chat-envio-handler.ts:35`— y `plantillas-sync.ts` **no lo nombra en absoluto**
(usa `loadWhatsappConfig`, que es otra cosa). Su único importador real era
`enviarPlantillaWhatsapp`. Hoy tiene **cero importadores de producción y cero tests**.

Es exactamente el modo de fallo que esta guardia existe para evitar, aplicado a la medición: un
`grep` cuenta las menciones en comentarios como uso. Por eso el aviso se ha escrito **en la
cabecera del propio archivo**, donde lo verá quien llegue por `grep`, y no sólo aquí.

**Decisión ABIERTA para el humano:** o se cablea el envío server-side por Meta, o se borra. No es
lo mismo que `ChatWhatsappService`, que sí está vivo y es quien manda por Meta de verdad.

### Los demás, por si alguien tira del hilo

| Huérfano | Dónde | Estado |
|---|---|---|
| `ListarEnviablesResult` | `lib/types/whatsapp-envio.ts:52` | sólo lo usaba `listarPlantillasEnviables`. Sin uso |
| `EnviarPlantillaResult` | `lib/types/whatsapp-envio.ts:43` | sólo lo usa el service huérfano de arriba: **la misma isla** |
| `GeoService` + `IGeoService` | `lib/services/`, `lib/interfaces/services/` | sin importador de producción; **conservan sus tests** (`geo-service.test.ts`, gate maestro) |
| `IZonaService.arbol` / `ZonaService.arbol` / `ZonaRepository.arbol` | | sin llamador de producción; conservan tests |
| `INotificacionService.marcarLeida` / `NotificacionRepository.marcarLeida` | | ídem; `notificacion-service.test.ts` lo cubre en varios casos |

**`GeoRepository` NO es huérfano** y era el riesgo obvio: lo usa `lib/actions/filtros-ordenes.ts`
(feature 144) para el catálogo plano de filtros. Borrar `GeoService` no puede arrastrarlo.

---

## 12 · Guardias: antes / después

| Medida | Antes (tanda 2) | Después |
|---|---|---|
| Anotaciones `@sin-superficie` | **20** | **13** |
| — de acción (R-A) | 19 | **12** |
| — de componente (R-B) | 1 | 1 (`TableFilters.tsx`, intacta) |
| `pnpm test:guardias` | **70 archivos / 958 tests ✅** | **70 / 958 ✅** |

Las **7** que desaparecen son exactamente las 7 acciones borradas (3 de `geo.ts` + `arbolZonas` +
2 de whatsapp + `marcarNotificacionLeida`). **No queda ninguna huérfana**, y no es una afirmación
de confianza: el caso «ninguna anotación `@sin-superficie` de acción sobrevive a su motivo» está
verde, y se quitaron **con** el código, en el mismo commit, nunca después.

### Ningún contador de censo se movió — y aquí está el porqué

La tanda 1 avisó de que borrar mueve `cobertura-tablas` y `contadores-cabecera`. **En la tanda 2
no se movió ninguno**: `70 archivos / 958 tests` en la línea base, tras cada uno de los tres
frentes y en el gate final — el mismo número las cinco veces. No hubo nada que ajustar y no se
ajustó nada en silencio. La razón es estructural, no suerte: esos dos censos miden **componentes
con `<DataTable>` y `<Pagination>`**, y esta tanda no ha tocado un solo componente — sólo
`lib/actions/`, `lib/services/` y tests.

**Total de las dos tandas: 24 → 13 anotaciones.** De las 11 que se han ido, 4 eran de componente
(tanda 1) y 7 de acción (tanda 2).

---

## 13 · Verificación

| Paso | Resultado |
|---|---|
| `pnpm run typecheck` línea base | **limpio** |
| `pnpm run typecheck` tras Frente 1 / 2 / 3 | **limpio** las tres veces |
| `pnpm test:guardias` línea base | 70 archivos / 958 tests ✅ |
| `pnpm test:guardias` tras cada frente | **70 / 958 ✅** (×3) |
| `vitest run` zonas-action + geo-service + zona-service | 3 archivos / 43 tests ✅ |
| `vitest run` EnviarPlantilla + chat-whatsapp + chat-plantilla | 3 / 37 ✅ |
| `vitest run` notificaciones-action + NotificationsBell | 2 / 46 ✅ |
| **`./init.sh --rapido`** | **`== init OK ==`, exit 0** |
| — `test:cambiados` | **58 archivos / 687 tests ✅** |
| — `test:guardias` | **70 / 958 ✅** |
| — `lint` | **0 errores**, 48 advertencias (las mismas 48 preexistentes que midió la tanda 1; ninguna cae en un archivo de esta tanda) |

Sin flakes: ningún test necesitó repetirse en aislado.

---

## 14 · Lo que hay que saber mañana

### QUÉ QUEDÓ VIVO Y SE PARECE PELIGROSAMENTE A LO BORRADO

Tres pares de nombres casi idénticos. Los tres pueden costar un incidente de producción:

1. **`lib/actions/geo.ts` (BORRADO) vs `lib/actions/geografia.ts` (VIVO).** El segundo es el que
   usan `configuracion/tarifas/page.tsx`, `ZonasTarifasModule`, `CrearZonaForm` y
   `GeografiaSelector` vía `listarArbolGeografico`. Cuatro letras de diferencia entre el catálogo
   geográfico muerto y el vivo. **Esto no estaba en el aviso del encargo** y es lo que más cerca
   estuvo de un borrado equivocado.
2. **`listarPlantillasEnviables` (BORRADA) vs `listarPlantillasParaEnvio` y
   `listarPlantillasActivasParaEnvio` (VIVAS).** El aviso del encargo era correcto y se verificó
   antes y después: la primera la llama `EnviarPlantillaWhatsappButton.tsx:99`, la segunda
   `chat-demo/ChatConversacion.tsx:21`. Ambas siguen en el archivo. Se dejó escrito **dentro de
   `whatsapp-envio.ts`**, donde hace falta, un «OJO AL NOMBRE» con las tres.
   `repo.listarEnviables()` **tampoco murió**: lo sigue usando `listarPlantillasActivasParaEnvio`.
3. **`EnvioPlantillaWhatsappService` (huérfano) vs `ChatWhatsappService` (VIVO).** El segundo es
   quien manda por Meta de verdad hoy.

`WhatsappCloudClient` **está vivo** y esa parte del encargo se confirmó: `chat-whatsapp.ts:17`,
`whatsapp-chat-envio-handler.ts:17` y `ChatWhatsappService.ts:6` (además de un `Pick<>` en :21).

### Sigue ABIERTO

- **`EnvioPlantillaWhatsappService` + `ListarEnviablesResult` + `EnviarPlantillaResult`** —
  isla sin importador ni test. Cablear o borrar (§11).
- **`GeoService`/`IGeoService`** y los tres métodos `arbol`/`marcarLeida` de §11 — sin llamador
  de producción, con tests. No se tocan sin decisión humana.
- **`components/shared/TableFilters.tsx`** — la única anotación de componente que queda, heredada
  de la tanda 1. Sin decisión.
- **`chat-demo/`** — la carpeta del chat VIVO se sigue llamando «demo» (tanda 1, §7). Sin tocar.

### Y una para el arnés

`./init.sh --rapido` corrió **58 archivos / 687 tests** por `--changed origin/dev`, frente a los
**7 archivos / 124 tests** de la tanda 1. La diferencia no es que esta tanda cambiara más
archivos —cambió menos— sino **dónde**: tocar `lib/actions/` y `lib/services/` arrastra por el
grafo de imports muchísimo más que tocar `app/**/_components/`. Si alguien mide el coste del gate
rápido, que lo mida por capa y no por número de archivos.
