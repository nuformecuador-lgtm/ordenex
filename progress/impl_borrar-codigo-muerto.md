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
