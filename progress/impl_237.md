# impl 237 — la gestión que hace la tienda cuenta como del mensajero

Rama `feature/237-gestion-tienda-ayuda`.
Spec: `specs/237-gestion-tienda-ayuda/{requirements,design,tasks}.md` (R1–R50, T0–Tn).

---

## T0 · Las cuatro mediciones — 2026-08-20, contra producción

Vía **MCP de Supabase, solo lectura**. Cada número con su denominador: un cero sin universo detrás
no dice nada, y en esta pila ya nos ha pasado.

> ⚠️ **Orden en que ocurrió, y hay que decirlo:** el leader llevó **D2, D3 y D6** a firma humana
> **antes** de correr estas consultas, y el spec pedía explícitamente lo contrario («no se firma D1
> ni D3 sin los números delante»). Se midió después. **Los números no contradicen ninguna de las
> tres firmas — y el de M3+M4 refuerza la de D3.** Queda escrito por si algún día uno de estos
> números cambia y hay que releer la decisión sabiendo sobre qué se tomó.

### M1 — la población en ayuda (T0.1)

| medida | valor |
| --- | --- |
| órdenes vivas en `ayuda_tienda` | **0** |
| denominador: órdenes vivas | **141** |

Esperado: la **235** se mergeó en `dev` el 2026-08-19 y **no está desplegada** (producción sale de
`prod`). ⏳ **Caduca**: re-medir antes de desplegar, no antes de mergear.

### M2 — ⚠️ la que decide **D1** (T0.2)

| medida | valor |
| --- | --- |
| cierres en `vencido` | **0** |
| cierres en `rechazado` | **0** |
| denominador: cierres | **12** — y los **12** están `aprobado` |

**La frase que T0.2 exige:** **la ruta exenta es un CASO DE BORDE, no la normalidad.** Ningún cierre
ha estado nunca en `vencido` ni en `rechazado` en producción, así que las dos rutas de re-solicitud
(`vencido → solicitado` y `rechazado → solicitado`) —las que rompen la invariante— **no se han
ejercido jamás**.

**Consecuencia para D1:** «se acepta y se prueba» **se sostiene**. No hace falta hablar de mitigación,
que es lo que T0.2 dejaba condicionado a que fuera la normalidad. **Pero el borde es alcanzable**
—235/R25 deja pedir ayuda estando bloqueado— así que el test de R32 sigue siendo obligatorio: lo que
la medición dice es que hoy no hay volumen, no que sea imposible.

### M3 — cuánto dinero mueve un rechazo (T0.3)

| medida | valor |
| --- | --- |
| `cobro_rechazado` mínimo | **0,00** |
| media | **400,00** |
| **máximo** | **1.000,00** |
| denominador: tarifas | **5** |

**Es el importe que la tienda se cobra a sí misma con un click.** Hasta **₡1.000** por rechazo. Va
literalmente en la conversación de **D3** y en el aviso de **D7**: el texto que le dice a la tienda
«esto cuesta dinero» no es retórica.

### M4 — cuánto se deshace hoy (T0.4)

| medida | valor |
| --- | --- |
| gestiones **anuladas** | **7** |
| denominador: gestiones | **57** |
| gestiones vivas **sin cierre** | **0** |
| de esas, con más de 24 h | **0** |

**«Deshacer» SE USA: 7 de 57, un 12 %.** No es una función dormida — es una de cada ocho gestiones.

**Consecuencia para D3, y refuerza la firma:** si el mensajero pudiera deshacer la gestión de la
tienda, **pasaría de verdad**, no en teoría. Y cada vez que pasara borraría en silencio hasta ₡1.000
que la tienda decidió cobrarse, sin que ella pudiera enterarse porque la orden ya no está en ninguna
de sus pestañas. **Los dos números juntos convierten D3 de precaución en necesidad.**

Los otros dos ceros (0 gestiones sin cierre, 0 de más de 24 h) dan la cota que T0.4 pedía: hoy
**ninguna gestión se queda huérfana de cierre**, así que el escenario de D1 —una gestión que cae en
el cierre siguiente— tampoco tiene precedente en los datos.

---

# BACKEND — T1 a T6, T8, T9.2/T9.3 y T10.1/T10.2 (2026-08-20)

Rama `feature/237-gestion-tienda-ayuda`. **Sin commit.** La pantalla (T7) y el recorrido (T9.1) son
de otro agente y van después, en el MISMO PR.

## Lo que se construyó, por tanda

### T1 · El valor de enum (R5, R47)

- `db/migrations/20260820120000_orden_historial_origen_gestion_tienda_ayuda/` con `migration.sql`
  (`ADD VALUE IF NOT EXISTS`) y `down.sql` que **recrea el tipo con los 29 valores previos**, molde
  literal del down de la 235, con su precondición y su nota de rollback encadenado.
- El valor entra en `db/schema.prisma` y en `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`
  (`lib/types/orden-historial.ts`), con el argumento de §7.3 escrito ahí y en ningún otro sitio.
- **Round-trip REAL contra `localhost:5432`**, no sólo lectura de fichero (salida abajo).

### T2 · La lista que cobra dinero (R6, R7, R43, R46)

- `ORIGEN_TIPOS_VISITA_REAL` pasa a `["gestion", "gestion_tienda_ayuda"]`.
- ⚠️ **El literal está fijado en SEIS sitios, no en dos.** El spec (T2.1) nombra dos
  (`orden-historial-types.test.ts:125` y `criterio-intento-entrega.test.ts:90`); el árbol tiene
  además `anclaje-vs-intentos.guardia.test.ts`, `ayuda-tienda-migration.test.ts`,
  `anclaje-devolucion-migration.test.ts` y `orden-historial-repository.test.ts`. **Los seis se
  actualizaron a mano, con nota fechada**, y ninguno se sustituyó por una derivación de su propia
  fuente. Está dicho aquí porque el diseño §14 sólo preveía dos y quien revise el diff va a ver
  cuatro archivos «de más».
- `ORIGEN_TIPOS_CON_GESTION` y `ORIGENES_SIN_EVENTO_PUBLICO` **no cambian**; sus tests literales
  siguen verdes **sin tocarse** (se corrieron: ver T9.3).

### T3 · Las dos aristas y su inventario (R1, R45)

- `#65 ayuda_tienda -> reprogramada` y `#66 -> rechazada`, `via: "gestion_tienda_ayuda"`. Y ninguna
  más: `entregada`, `devolucion_por_confirmar` e `incidente` siguen sin declarar.
- El bloque «LO QUE **NO** SE DECLARA» se **reescribió**, conservando qué decía y por qué las otras
  tres siguen fuera.
- Inventario: `aristasFlujo 59 → 61`, `paresUnicos 57 → 59`, con las dos filas y su `callSite`.

### T4 · La maquinaria de evidencias, extraída (R15, R16, R17 — D5)

- **`lib/services/evidencias-compensadas.ts`** (NUEVO, sin Prisma y sin `next/*`):
  `subirEvidenciasCompensadas` + `compensarEvidencias`. Bucle **secuencial**, `Date.now()` **dentro
  del bucle** (igual que las dos copias de origen: la extracción no cambia ni un byte de los paths).
- `MisAsignacionesService.gestionar` cableado al módulo. **`mis-asignaciones-evidencias.test.ts`
  quedó VERDE sin tocar ni un caso** — miraba conducta, no estructura.
- **Deuda declarada con dueño (D5-a):** `IncidenteAdminService.subirEvidencias`/`compensar`
  (feature 158) **sigue siendo una segunda copia**. No se arrastró aquí a propósito: tocarla mete la
  158 entera —servicio, tests de compensación, prefijo propio— dentro de la ficha más delicada en
  dinero de la pila. El módulo queda listo para que esa migración sea un commit mecánico.

### T5 · El servicio, el repositorio y el borde

- `GestionOrdenRepository.crearGestionDesdeAyuda`: `updateMany` guardado por `estatusId` →
  `count === 0` ⇒ `null` sin efectos; gestión con `mensajeroId` = **el mensajero** y `cierreId` sin
  escribir; N evidencias en la misma tx; append por el choke point con actor = **la tienda** y
  `origenTipo: "gestion_tienda_ayuda"`. **No toca** `usuario.ordenEnGestionId`,
  `mensajeroAsignadoId`, `prioridad`, ubicación ni ningún importe, y **no encola** reoptimización.
- El INSERT de gestión + hijas se extrajo a `insertarGestionConHijas`, **compartido** con
  `crearGestionYTransicionar`.
- `lib/types/gestion-desde-ayuda.ts`: unión discriminada de **dos** literales, con
  `evidenciasSchema` / `motivoSchema` / `fechaFuturaSchema` **reutilizados** (los dos últimos se
  **exportaron** desde `gestion-orden.ts`, no se copiaron).
- `GestionDesdeAyudaService` con las ocho comprobaciones en el orden del diseño §6.
- `lib/actions/gestion-desde-ayuda.ts` (Server Action, `FormData` + `getAll("evidencia")`).
- **D3 (T5.5):** `deshacerGestion` gana la guardia 3-bis. La lectura vive en
  `CierreDiaRepository.findGestionParaDeshacer`, que devuelve `desdeAyudaTienda` derivado del
  historial **repitiendo el `ordenId`** dentro del filtro (mismo truco de índice que
  `whereIntentosVigentes`; no se creó ningún índice).

### T6 · El dinero y el cierre, afirmados

Sin código de producción nuevo salvo la anotación de D4 en `lib/notificaciones/emitir.ts`.

---

## ⚠️ TRES COSAS QUE HAY QUE LEER ANTES DE REVISAR

### 1. La Server Action va anotada `@sin-superficie`, y ESA ANOTACIÓN HAY QUE BORRARLA en T7

`tests/unit/guards/superficie-de-uso.guardia.test.ts` se puso **rojo**: una Server Action que
ningún módulo alcanzable importa. Es la consecuencia inevitable de secuenciar backend → frontend
dentro del mismo PR. Se anotó junto al export con su motivo y con la instrucción de retirarla.

**La anotación CADUCA por diseño de esa guardia**: en cuanto `NovedadesModule` monte la ventana, la
guardia exige quitarla y se pondrá roja si sigue ahí. **No debe sobrevivir al merge.**

### 2. La medición T0.1 sigue abierta y **bloquea el despliegue, no el merge**

Hoy 0 órdenes en `ayuda_tienda` sobre 141 vivas, porque la 235 no está en producción. Esa foto
caduca: **re-medir antes de desplegar**.

### 3. Deuda D5 y deuda D8, las dos declaradas arriba y en el código

- `IncidenteAdminService` sigue con su copia de la subida compensada (D5-a).
- `motivoSchema` sigue **sin tope de longitud** (D8), y ahora lo comparten dos vías. Está escrito en
  `lib/types/gestion-orden.ts` junto al export y afirmado con un caso en el test del schema, para
  que sea decisión y no olvido.

---

## Mapa `R<n>` → test

> Todos los archivos citados **se comprobaron con `test -f`** uno a uno. Ninguna cita a ciegas.

| Req | Dónde se prueba |
| --- | --- |
| R1 | `tests/unit/types/gestion-desde-ayuda-schema.test.ts` («`entregada`/`devuelta`/`incidente` NO son valores posibles») · `tests/unit/domain/order-status-transiciones.guardia.test.ts` (las cuatro salidas de `ayuda_tienda`, enumeradas) · `tests/integration/db/gestion-tienda-ayuda-migration.test.ts` («la familia produce EXACTAMENTE dos aristas») |
| R2 | `tests/unit/repositories/gestion-desde-ayuda-repository.test.ts` («la MISMA forma de fila», fecha DATE, portada dual-write) |
| R3 💰 | ídem («`mensajero_id` es EL MENSAJERO, NO el actor») + `tests/unit/repositories/gestion-desde-ayuda-cierre.test.ts` (los dos casos end-to-end). **Mutación T8.1** |
| R4 | `gestion-desde-ayuda-repository.test.ts` («actor = LA TIENDA, familia propia, origen = ayuda») |
| R5 | `tests/unit/types/orden-historial-types.test.ts` («la familia está en el SEED y en el enum de la DB») + `tests/integration/db/gestion-tienda-ayuda-migration.test.ts` + el append del test de repositorio |
| R6 💰 | `tests/unit/types/criterio-intento-entrega.test.ts` · `tests/unit/types/orden-historial-types.test.ts` · `tests/unit/services/intentos-entrega-criterio-unico.test.ts` (bloque 237). **Mutación T8.2** |
| R7 | `tests/unit/services/intentos-entrega-criterio-unico.test.ts` («dos gestiones en el mismo cierre siguen sumando 1»; «pedir ayuda + resolver la tienda = 1, no 2») |
| R8 | `tests/unit/services/gestion-desde-ayuda-service.test.ts` («sin mensajero asignado ⇒ conflict y NO se crea gestión») |
| R9 | `gestion-desde-ayuda-repository.test.ts` («`cierreId` NO se escribe») + el e2e de `gestion-desde-ayuda-cierre.test.ts` |
| R10 | `gestion-desde-ayuda-repository.test.ts` («`usuario.update` NO se llama», «`orden.update` tampoco», «el `data` toca únicamente `estatusId`») |
| R11 | ídem («la fila NO lleva ningún importe») + `gestion-desde-ayuda-cierre.test.ts` (importes como **string**) + las dos guardias money-safe verdes sin tocarse (T8.5) |
| R12 | `tests/unit/types/gestion-desde-ayuda-schema.test.ts` (sin motivo / sin foto, en **las dos** ramas) |
| R13 | ídem (MIME, tamaño, tope de lista) + `tests/integration/actions/gestion-desde-ayuda-action.test.ts` («el borde revalida aunque la UI no») |
| R14 | `gestion-desde-ayuda-schema.test.ts` («hoy y ayer no parsean; mañana sí»; día inexistente) + el caso de la action |
| R15 | `tests/unit/services/evidencias-compensadas.test.ts` («falla la #k ⇒ se retiran las k-1 y no se devuelve nada») + el caso del servicio |
| R16 💰 | ídem + `gestion-desde-ayuda-service.test.ts` («el repo devuelve `null` ⇒ se compensa»). **Mutación T8.4** |
| R17 | `tests/unit/services/mis-asignaciones-evidencias.test.ts` **verde tras el cableado, sin tocar un caso** |
| R18 | `gestion-desde-ayuda-repository.test.ts` («NO escribe ubicación») + `gestion-desde-ayuda-service.test.ts` + `gestion-ubicacion-solo-escritura.guardia.test.ts` **verde sin tocarse** |
| R19 | `gestion-desde-ayuda-service.test.ts` («rol ajeno ⇒ forbidden») |
| R20 💰 | ídem («el MENSAJERO ASIGNADO ⇒ forbidden»), con su caso de contraste que afirma que el mensajero SÍ pasa la puerta del hilo — sin él, el paso 2 parecería decorativo |
| R21 | ídem («la puerta es `autorizarSobreHilo` + la ventana») |
| R22 | ídem («tienda ajena y orden inexistente devuelven **lo mismo**») |
| R23 | ídem («orden fuera de `ayuda_tienda` ⇒ conflict, sin tocar el repo ni subir nada») |
| R24 💰 | `gestion-desde-ayuda-repository.test.ts` (el `where` por igualdad) + `gestion-desde-ayuda-cierre.test.ts` («si la orden YA salió de ayuda, no se crea gestión ni se mueve nada»). **Mutación T8.3** |
| R25 | `gestion-desde-ayuda-repository.test.ts` («`count = 0` no deja NI UN rastro») + `gestion-desde-ayuda-service.test.ts` («conflict con el texto de la carrera») |
| R26 | `gestion-desde-ayuda-service.test.ts` («el destino sale del MAPA ÚNICO», comprobando qué `value` se le pidió al catálogo) |
| R27 | `tests/components/GestionarDesdeAyudaModal.test.tsx` — la ventana pide foto y motivo en los dos desenlaces, y el botón queda muerto sin ellos (T7, cerrada el 2026-08-20) |
| R28 | `gestion-desde-ayuda-repository.test.ts` («el SEGUNDO envío simultáneo no crea una segunda») |
| R29 💰 | `gestion-desde-ayuda-cierre.test.ts` (`crearCierre` la vincula, `findGestionesPendientes` la lista, tiene su `cierre_detail`, la de otro mensajero NO entra) |
| R30 💰 | ídem (mismo pago / mismo ingreso / mismos totales por resultado, importes como string; `cobroRechazado` de la tarifa; `reprogramada` money-neutral) |
| R31 | ídem («los totales del cierre en curso no cambian») |
| R32 💰 | `tests/unit/services/gestion-desde-ayuda-cierre-aprobacion.test.ts` (**las DOS rutas exentas, ejercidas**) + `gestion-desde-ayuda-cierre.test.ts` («cae en el siguiente, y en UNO SOLO») |
| R33 | `gestion-desde-ayuda-cierre-aprobacion.test.ts` (`ESTADOS_PENDIENTES` intacto + la creación se rechaza con pendientes) |
| R34 | ídem (las dos rutas exentas ni consultan pendientes) |
| R35 | ídem («`reprogramada` y `rechazada` están en `RESULTADOS_QUE_VUELVEN`»; el `where` del conjunto esperado no mira origen ni actor) |
| R36 | `gestion-desde-ayuda-cierre.test.ts` (los dos sumandos siguen disjuntos, leído del `where` donde vive) |
| R37 | `gestion-desde-ayuda-cierre-aprobacion.test.ts` (censo: ni el repo ni el servicio de aprobación nombran la familia) + las cuatro suites de la transacción **verdes sin modificarse** (T9.3) |
| R38 💰 | `tests/unit/services/cierre-dia-service.test.ts` (bloque «Feature 237 · deshacerGestion») + `tests/unit/repositories/cierre-dia-repository.test.ts` (el `where` de `desdeAyudaTienda`, probado **donde vive**) |
| R39 | `gestion-desde-ayuda-cierre.test.ts` («una gestión de la tienda ANULADA no se vincula») + `intentos-entrega-criterio-unico.test.ts` («anulada ⇒ deja de contar») |
| R40 | `tests/components/RepartoAyudaResueltaPorLaTienda.test.tsx` — la orden sale del portal del mensajero (T7, cerrada el 2026-08-20) |
| R41 | `tests/components/CierreDiaModule.test.tsx` — el badge «La tienda» en la fila del cierre, **emparejado** con una fila del mensajero sin él; y el botón de deshacer **apagado** con su motivo en el `aria-label` (T7, cerrada el 2026-08-20) |
| R42 | `tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts` **verde sin tocarse** (T8.5) |
| R43 | `gestion-desde-ayuda-cierre-aprobacion.test.ts` («no está en `ORIGENES_SIN_EVENTO_PUBLICO`»; el vocabulario público no gana valores) + `tests/unit/types/webhook-eventos.test.ts` **verde sin tocarse** |
| R44 | `gestion-desde-ayuda-cierre-aprobacion.test.ts` («el emisor filtra por igualdad y la ausencia está escrita como decisión en `emitir.ts`») |
| R45 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` y `.connectividad.test.ts` con el inventario actualizado |
| R46 | `tests/unit/types/webhook-eventos.test.ts` **verde sin tocarse** |
| R47 | `tests/integration/db/gestion-tienda-ayuda-migration.test.ts` + el round-trip real contra `localhost:5432` |
| R48 | Las dos guardias del criterio y `anclaje-vs-intentos.guardia.test.ts` verdes (T8.5) + el bloque 237 de `intentos-entrega-criterio-unico.test.ts` (una gestión SIN la familia nueva sigue sin contar) |
| R49 | T9.3, abajo |
| R50 | T9.2, abajo |

---

## T8 · Mutaciones — salida REAL, leída y citada

Método: copia de respaldo del archivo (**nunca `git checkout`**), un script que **falla ruidosamente
si el ancla no existe** —para que una mutación que no se aplica no pueda reportarse como
«superviviente»—, `vitest run` de las suites relacionadas, y restauración verificada por sha256.

**sha256 antes de mutar:**

```
ff76a425aaaba3bc35b728445d7e0a3b6b17928690269796825532d223bee4ea  lib/repositories/GestionOrdenRepository.ts
e24837415226d907d60fd77cd383fb2ca082e53d9ed1f7d6950f6f92cc5af106  lib/types/orden-historial.ts
1a3b0999e30ef7a6bde3682f152ee1e5569ea5e965a33aafd74148f584762f15  lib/services/evidencias-compensadas.ts
```

**sha256 después de restaurar: IDÉNTICOS** (comprobado con `diff` de los dos ficheros de sumas).

### T8.1 💰 — `mensajeroId` → `actorUsuarioId` (la tienda) en `crearGestionDesdeAyuda`

sha del archivo mutado: `04f2e543d4f7f6babc8d40c78f279017a75506d292aa8d16c2bcc0928ada8fcd`

```
     × 💰 R3: `mensajero_id` es EL MENSAJERO de la orden, NO el actor que la registro 6ms
     × R2: `rechazada` produce la MISMA forma de fila que la del mensajero para ese resultado 4ms
     × 💰 end-to-end: la tienda gestiona -> `crearCierre` la vincula al cierre DEL MENSAJERO 8ms
     × 💰 end-to-end: el `cobroRechazado` se congela EN LA FILA que registro la tienda 1ms
      Tests  4 failed | 30 passed (34)
```

El e2e cae con `AssertionError: expected null not to be null` sobre `crearCierre`: con la tienda en
`mensajero_id`, **no se vincula ni una gestión y el cierre ni se crea**. Es exactamente el escenario
«invisible y gratis» que el diseño §13-B describía.

> ⚠️ **La primera versión de T6.1/T6.2 SOBREVIVÍA a esta mutación** y hay que decirlo: sus casos
> partían de una fila ya sembrada, así que ejercían el `where` de `crearCierre` pero no el de quien
> la escribe. Se añadieron **dos casos end-to-end** que arrancan en `crearGestionDesdeAyuda`, y son
> los que ahora caen. Sin la mutación, esos dos casos no existirían.
>
> Lo que **sigue sobreviviendo, a propósito**: los casos de T6.2 que comparan `derivarPagos` /
> `derivarIngresoBodega` / `computeTotales`. Son funciones **puras** que nunca ven el
> `mensajero_id` — ésa es justamente la propiedad que afirman (R30). Por eso se les añadió el caso
> e2e del snapshot, que sí muere.

### T8.2 💰 — quitar `gestion_tienda_ayuda` de `ORIGEN_TIPOS_VISITA_REAL`

sha del archivo mutado: `3f5a2f707bfdb096e93ab069feac9f8602c28d5ba3b7c0085e00c1932db9d030`

```
     × 235/R11: NINGUNA de las dos es VISITA REAL — pedir ayuda no es un intento de entrega 6ms
     × R6: la familia SI esta en `ORIGEN_TIPOS_VISITA_REAL` — al reves que las dos de la 235 4ms
     × R34-a: la lista es EXACTAMENTE `gestion` + `gestion_tienda_ayuda` (la visita y su desenlace) 7ms
     × 'R6: una orden que paso por ayuda y re…' -> 1, identico en drawer, cron y lote 5ms
     × 'R6: lo mismo con `reprogramada` (los …' -> 1, identico en drawer, cron y lote 1ms
     × 'R7: DOS gestiones vigentes de la tien…' -> 1, identico en drawer, cron y lote 1ms
     × R7: pedir ayuda + resolver la tienda = 1 intento, no 2 (la solicitud no cuenta) 0ms
      Tests  7 failed | 49 passed (56)
```

Caen los dos censos literales **y** los casos de conducta del criterio único: sin la familia en la
lista, la gestión de la tienda **no contaría como intento** y la ficha incumpliría su promesa
central en silencio.

### T8.3 — quitar `estatusId` del `where` del `updateMany`

sha del archivo mutado: `01e336e773f543078f924ae8d7cb79f799e4dca8f986bde36fb489e5f802eb52`

```
     × R24: el `where` del `updateMany` es exactamente `{ id, estatusId: ayuda, deletedAt: null }` 9ms
     × 💰 end-to-end: si la orden YA salio de ayuda, no se crea gestion ni se mueve nada (R24/R25) 5ms
      Tests  2 failed | 56 passed (58)
```

> ⚠️ **El doble de Prisma se corrigió por esta mutación, y también hay que decirlo.** La primera
> versión devolvía `count: 0` cuando el `where` no traía `estatusId`, así que el e2e daba rojo por
> **su propia suposición**, no por la mutación: un rojo falso es tan inútil como un verde falso. El
> doble pasó a aplicar el `where` contra el estatus **real** de la orden en el almacén — con la
> guarda fuera, Postgres actualizaría igual y el doble también. El rojo de arriba ya es el
> comportamiento verdadero: la tienda resolvería una orden que el mensajero ya recuperó.

### T8.4 — que `compensarEvidencias` no borre nada

sha del archivo mutado: `795f58070c1873cb511fe70c93a7cae4ca1a3fd0ddf77967c890923dc435042b`

```
     × retira EXACTAMENTE las k-1 ya subidas, propaga el error y no devuelve nada 5ms
     × borra los N paths en UNA llamada 1ms
     × R16: y las fotos ya subidas se COMPENSAN — ni una queda huerfana en el bucket 4ms
     × R16: si la TRANSACCION revienta, tambien se compensa y el error se propaga 2ms
     × R15: si falla la SUBIDA #k, se retiran las k-1 y el repo ni se invoca 1ms
     × borra del storage SOLO las ya subidas y NO invoca al repo; propaga el error 4ms
     × remove con las N evidencias subidas; el error se propaga (no es resultado de dominio) 1ms
      Tests  7 failed | 33 passed (40)
```

Caen los del módulo, los de la 237 **y los de `MisAsignacionesService`** — que es la prueba de que
el cableado de T4.2 es real y no una segunda copia con el mismo nombre.

### T8.5 — guardias completas

`pnpm run test:guardias` (`vitest run guard`): **123 archivos, 1813 tests, 0 fallos.** Las diez
nombradas se corrieron además de forma explícita y aisladas: **10 archivos, 118 tests, verdes.**

```
tests/unit/guards/anclaje-vs-intentos.guardia.test.ts
tests/unit/guards/deriva-primer-intento.guardia.test.ts
tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts
tests/unit/repositories/gestion-ubicacion-solo-escritura.guardia.test.ts
tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts
tests/unit/guards/orden-nota-frontera.guardia.test.ts
tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts
tests/unit/guards/dinero-sin-centimos.guardia.test.ts
tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts
tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts   (R42)
```

`anclaje-vs-intentos` **sí se tocó**, y no es una fusión de criterios: sólo se actualizó el literal
de `ORIGEN_TIPOS_VISITA_REAL` que fijaba por igualdad. Su aserción de fondo —«`anclaje_devolucion`
NO está en la lista»— sigue intacta.

---

## T9.2 · Nada de PII en registros (R50)

Censo de `console.*` sobre los quince archivos de producción nuevos o tocados: **0 en todos**.

```
lib/services/GestionDesdeAyudaService.ts               lib/repositories/GestionOrdenRepository.ts
lib/services/evidencias-compensadas.ts                 lib/repositories/CierreDiaRepository.ts
lib/actions/gestion-desde-ayuda.ts                     lib/services/CierreDiaService.ts
lib/types/gestion-desde-ayuda.ts                       lib/services/MisAsignacionesService.ts
lib/interfaces/services/IGestionDesdeAyudaService.ts   lib/types/orden-historial.ts
lib/interfaces/repositories/IGestionOrdenRepository.ts lib/types/order-status-transiciones.ts
lib/interfaces/repositories/ICierreDiaRepository.ts    lib/types/gestion-orden.ts
lib/notificaciones/emitir.ts
```

El único `throw new Error` con interpolación es
`` `gestion-desde-ayuda: AppErrorCode inesperado ${shape.code}` ``: `shape.code` es un valor del enum
de errores, no un dato de la orden. Los tres mensajes visibles del servicio son **constantes fijas**
y hay un caso que afirma que ninguno interpola motivo, guía, mensajero ni tienda.

## T9.3 · Lo que esta ficha NO toca (R48/R49)

Corridas y **sin modificarse** (`git status --short` sobre las once devolvió vacío):

```
 Test Files  11 passed (11)
      Tests  177 passed (177)
```

`habilitar-novedad-service.test.ts` · `RepartoAyuda.test.tsx` ·
`orden-repository.novedades.test.ts` · `hilo-ventana-alcanzable.guardia.test.ts` ·
`rescate-ayuda-service.test.ts` · `solicitud-ayuda-service.test.ts` ·
`cierres-admin-caja-cod.test.ts` · `cierres-admin-confirmacion-fisica.test.ts` ·
`cierres-admin-anclaje-devolucion.test.ts` · `cierres-admin-indemnizacion.test.ts` ·
`webhook-eventos.test.ts`

## T10.1 / T10.2 · Documentación al día

- `progress/design_pila_ayuda_tienda.md` §F3: la frase de la invariante se **reescribió** (tachada,
  no borrada) separando los **dos hechos** que juntaba, con lo medido y con D1/D3. La «ADVERTENCIA
  HEREDADA PARA LA FICHA 237» pasa a **✅ RESUELTA**, citando R32 y sus dos suites.
- `progress/auditoria_ayuda_tienda.md` §4: cae «la gestión de la tienda que cuenta como del
  mensajero» (y con ella «evidencia y motivo obligatorios» en esta vía). De las nueve ausencias
  queda **una**: el desenlace de las no gestionadas.
- T10.3: los comentarios de `order-status-transiciones.ts:283-291` y `orden-historial.ts:76-78`
  están reescritos. El tercero (`novedad-acciones-catalogo.ts:58-61`) es de **T7**.

---

## Rojos POR DISEÑO que se actualizaron a mano (el diff los va a mostrar)

El diseño §14 previó ocho; el árbol dio **catorce**. Los seis que el spec no había censado:

| Archivo | Qué se puso rojo | Por qué es del diseño y no una regresión |
| --- | --- | --- |
| `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` | el literal `["gestion"]` | tercer sitio del mismo censo cerrado; la aserción de fondo del anclaje no se toca |
| `tests/integration/db/anclaje-devolucion-migration.test.ts` | ídem | cuarto sitio |
| `tests/unit/repositories/orden-historial-repository.test.ts` | ídem, dentro del `where` real | quinto sitio |
| `tests/unit/repositories/orden-repository.test.ts` | las salidas de `ayuda_tienda` (dos → cuatro) | lo que R17(b) vigila (que no lleve a bodega ni a asignación) sigue intacto |
| `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` | el descuento de aristas (21 → 23) | dos aristas nuevas que tocan `ayuda_tienda` |
| `tests/unit/repositories/orden-historial-cobertura.test.ts` | la familia nueva no tenía productor registrado | se registra como punto **#31** (`GestionOrdenRepository.crearGestionDesdeAyuda`); es lo que el archivo ORDENA hacer al llegar el productor |

Y **ocho `down.sql` históricos NO se tocaron**: lo que se ajustó fue el conjunto que sus tests
descuentan del SEED vigente (`AÑADIDOS_EN_O_DESPUES_DEL_<n>`), siguiendo el patrón que ya usaban.
El test de la 235 (`ayuda-tienda-migration.test.ts`) se alineó con ese mismo patrón.

---

## Salidas reales

### Migración: round-trip contra `localhost:5432`

```
$ npx prisma migrate deploy
Applying migration `20260820120000_orden_historial_origen_gestion_tienda_ayuda`
All migrations have been successfully applied.

n = 30
tiene gestion_tienda_ayuda = true

$ pnpm run db:rollback
Aplicando rollback: 20260820120000_orden_historial_origen_gestion_tienda_ayuda
Script executed successfully.
Rollback completado: 20260820120000_orden_historial_origen_gestion_tienda_ayuda

n = 29
tiene gestion_tienda_ayuda = false
carga_masiva,creacion_manual,generacion_guia,asignacion_bodega,ruteo_satelite,recepcion_satelite,
asignacion_satelite,recoleccion,gestion,liberacion_reprogramada,ajuste_estado,deshacer_gestion,
carga_api,liberacion_devuelta_sla,escalado_devuelta_sla,reprogramacion_tienda,recuperacion_manual,
cancelacion_api,corte_sin_gestionar,liberacion_sin_gestionar,recepcion_bodega_central,
devolucion_rechazada,recoleccion_tienda,incidente,deshacer_asignacion,asignacion_recoleccion,
anclaje_devolucion,solicitud_ayuda_tienda,rescate_ayuda_tienda

$ npx prisma migrate deploy   # re-aplicada
n = 30
tiene gestion_tienda_ayuda = true
```

Los 29 del down son **exactamente** los declarados, en su orden, y ni uno más.
**Producción no se tocó.**

### `npx tsc --noEmit`

```
TSC EXIT=0
```
(sin una sola línea de salida)

### `npx eslint .`

```
ESLINT EXIT=0
✖ 97 problems (0 errors, 97 warnings)
```
Los 97 warnings son **preexistentes** (`_input`, `_err`, `_opciones`… en suites ajenas) y ninguno
está en un archivo de esta ficha.

### `npx vitest run` (suite completa, árbol quieto)

```
 Test Files  1227 passed (1227)
      Tests  15981 passed | 26 skipped (16007)
   Duration  324.32s
```

Antes de las correcciones había **5 rojos**; los cinco están explicados arriba (cuatro literales o
recuentos del diseño y la anotación `@sin-superficie`).

---

## Lo que queda ABIERTO para la pantalla (T7)

1. **Borrar la anotación `@sin-superficie`** de `lib/actions/gestion-desde-ayuda.ts` al cablear.
2. **R27, R40 y R41** no tienen test todavía: son de superficie.
3. **Los textos de D7 que el backend ya fija** y la pantalla debe reutilizar, no reescribir:
   - carrera perdida → `MENSAJES_GESTION_DESDE_AYUDA.fueraDeAyuda`
     («Esta orden ya no está esperando tu respuesta.»)
   - sin mensajero → `MENSAJES_GESTION_DESDE_AYUDA.sinMensajero`
   - catálogo incompleto → `MENSAJES_GESTION_DESDE_AYUDA.catalogo`

   Los tres se exportan desde `lib/services/GestionDesdeAyudaService.ts`.
4. **El contrato de la Server Action**: `gestionarDesdeAyuda(formData)` con las claves `ordenId`,
   `resultado` (`reprogramada` | `rechazada`), `motivo`, `fechaReprogramacion` (sólo al reprogramar)
   y **N veces** `evidencia`. Devuelve `GestionarDesdeAyudaResult`
   (`lib/types/gestion-desde-ayuda.ts`).
5. **La ventana valida con el MISMO schema** (`gestionarDesdeAyudaSchema`), que ya viaja al
   navegador (sin `@prisma/client`).
6. **D2 en pantalla**: la foto es obligatoria **también al reprogramar**. Es la única asimetría con
   el panel del mensajero, y el motivo del bloqueo hay que decirlo con palabras.
7. **R25 en pantalla**: con `conflict`, **recargar** — la fila desaparece por el dato, no por
   optimismo. Es literalmente la lección de 236/D8 sobre esta misma card.

## Veredicto

Backend de la 237 completo (T1–T6, T8, T9.2/T9.3, T10.1/T10.2), suite entera verde con el árbol
quieto, cuatro mutaciones con sus rojos citados y el árbol restaurado byte a byte; quedan la
pantalla (T7), el recorrido (T9.1) y **borrar la anotación `@sin-superficie`** al cablearla.

---

# BACKEND (2.ª tanda) — R41/D6: el rótulo llega a la fila del cierre (2026-08-20)

El agente de pantalla paró bien: **el dato no llegaba**. `desdeAyudaTienda` sólo existía en
`findGestionParaDeshacer` (el camino de D3/R38); ni `CierreGestionPendienteRow` ni
`CierreDetalleGestion` lo tenían, y `WITH_DETALLE` no leía historial. Esto lo cierra.

> **Lo que firmó el humano, y es lo que no hay que perder:** la orden desaparece del portal del
> mensajero, **pero la fila de su cierre del día dice que la gestionó la tienda**. Si no, el
> mensajero **firma un cierre con una gestión que no hizo y una evidencia que no subió**, y no
> puede explicarla si le preguntan. Es su dinero (el `cobroRechazado` sale de SU tarifa) y su
> intento de entrega.

## 1. Los dos tipos: están EN SERIE, no en paralelo — hay que tocar los dos

Se comprobó el recorrido real, no se supuso:

```
findGestionesPendientes ──► toPendienteRow ──► CierreGestionPendienteRow
                                                        │
                                                        ▼
                                              toDetalleDTO ──► CierreDetalleGestion ──► pantalla
```

`CierreGestionPendienteRow` es la fila de repositorio y `CierreDetalleGestion` es el DTO que la
pantalla lee: **el flag tiene que cruzar los dos o no llega**. Así que se tocan los dos, y aquí
queda dicho por qué no era «elegir uno».

**Consecuencia que sí conviene saber:** `CierreGestionPendienteRow` tiene **TRES productores**
—`CierreDiaRepository.toPendienteRow` (mensajero), y `toPendienteRowDesdeSnapshot`, que comparten
`CierresAdminRepository` y `CierresBodegaAdminRepository`—. Se declaró el campo **obligatorio**, no
opcional, a propósito: con `desdeAyudaTienda?: boolean` los dos productores de admin no habrían
cambiado y su DTO habría emitido `false` para gestiones que **sí** eran de la tienda — un dato falso
con formato de dato, justo lo que esta pila persigue. Obligatorio, TypeScript obliga a los tres a
decidir. Precio: **37 fixtures de test** ganan una línea (`desdeAyudaTienda: false`), el mismo
radio que tuvieron `esRechazoSla` (102) y `causaIncidente` (158) al nacer.

## 2. El coste, MEDIDO antes de escribirlo

### 2.1 ¿N+1? **No.** +1 consulta, constante

Medido contra `localhost:5432` con el log de consultas de Prisma, sobre `WITH_DETALLE` real:

```
== WITH_DETALLE de hoy:                    15 filas -> 8 consulta(s)
== WITH_DETALLE + historial acotado:       15 filas -> 9 consulta(s)

take=1  -> 1 filas,  9 consultas
take=3  -> 3 filas,  9 consultas
take=15 -> 15 filas, 9 consultas
```

El número **no se mueve con el número de filas**: es una consulta en lote, no una por fila.

### 2.2 Pero la forma OBVIA de escribirlo degradaba el plan — y por eso NO se escribió así

Un `select` anidado de Prisma (que es lo que pedía el camino corto) produce:

```sql
WHERE origen_tipo = $1 AND gestion_orden_id IN (...)
```

`orden_historial_estado` **no tiene índice por `gestion_orden_id`** (la FK no crea índice en
Postgres). Medido con `EXPLAIN` sobre la base local, con `enable_seqscan = off` y el índice
`(actor_usuario_id, origen_tipo, created_at)` invalidado — para preguntar lo que **no** depende del
tamaño de la tabla: *¿existe algún camino por índice para este predicado?*

```
--- (a) SIN orden_id (el select anidado de Prisma)
    Seq Scan on orden_historial_estado  (cost=0.04..8.13 rows=1 width=37)

--- (b) CON orden_id (consulta explícita)
    Bitmap Heap Scan on orden_historial_estado  (cost=8.98..15.11 rows=1 width=37)
```

**(a) no tiene ningún otro camino: cae a Seq Scan** sobre una tabla append-only que crece con CADA
transición del sistema. Su único salvavidas es recorrer entero
`orden_historial_actor_origen_created_idx`, cuya columna guía es `actor_usuario_id` — con el
`origen_tipo` como `Index Cond` sobre un índice que se lee completo.
**(b) entra por `orden_historial_estado_orden_id_created_at_idx`** y toca sólo las filas de esas
órdenes.

➡️ **Se eligió (b)**: una consulta explícita en lote con `ordenId` **delante**, que es exactamente
el truco que documenta `whereIntentosVigentes` y que ya usa `findGestionParaDeshacer`. Mismo número
de round-trips que (a), mejor plan, **y ningún índice nuevo**.

### 2.3 En el camino de ADMIN: **CERO consultas nuevas**

`GESTION_ADMIN_SELECT` **ya leía** `historialEstados` para derivar `esRechazoSla` (102). Lo único
que cambia es que su `where` pasa de una igualdad a un `in` de **dos** familias (y `take: 1 → 2`,
para que una no tape a la otra según el orden de lectura). Dos predicados **puros** sobre el mismo
array. Es la página que más filas trae, así que no se le añadió ninguna consulta.

## 3. Qué significa `false` — decidido y escrito

`false` significa **«no la registró la tienda»**, no «no lo sé», y se puede afirmar con esa fuerza
por una razón **estructural**: la fila de historial se escribe en la **MISMA transacción** que la
gestión, por el choke point. Una gestión de esta familia **siempre** tiene su fila; no existe el
estado «gestión de la tienda a la que le falta el historial».

El único hueco concebible son las gestiones **legadas** anteriores al historial (feature 49), que no
tienen ninguna fila. Para ellas `false` también es **cierto**: son anteriores al estatus
`ayuda_tienda` (235, 2026-08-19), así que ninguna pudo nacer por esta vía. El razonamiento vive en
`lib/utils/gestion-tienda-ayuda-flag.ts`, junto al predicado, con la frase que importa: *si algún día
esa premisa deja de valer, la respuesta honesta sería un tercer valor, no un `false`*.

## 4. Archivos

**Nuevos**
- `lib/utils/gestion-tienda-ayuda-flag.ts` — `ORIGEN_TIPO_GESTION_TIENDA_AYUDA` +
  `esGestionDesdeAyudaTienda` (predicado PURO, molde de `rechazo-sla-flag.ts`).
- `tests/unit/services/gestion-desde-ayuda-rotulo-cierre.test.ts`

**Modificados**
- `lib/interfaces/repositories/ICierreDiaRepository.ts` — `CierreGestionPendienteRow.desdeAyudaTienda`
- `lib/interfaces/services/ICierreDiaService.ts` — `CierreDetalleGestion.desdeAyudaTienda`
- `lib/repositories/CierreDiaRepository.ts` — `marcarDesdeAyudaTienda` (lector en lote) + los dos
  call-sites (`findGestionesPendientes` y `findCierrePropioConGestiones`); `toPendienteRow` recibe el flag
- `lib/repositories/CierresAdminRepository.ts` — `FAMILIAS_DERIVADAS_DEL_HISTORIAL` y la segunda
  derivación en `toPendienteRowDesdeSnapshot`
- `lib/services/CierreDiaService.ts` — passthrough en `toDetalleDTO`
- 37 fixtures de test (+1 línea cada una) y 2 llamadas a `toPendienteRow`

## 5. Los tests, emparejados

Una bandera que siempre vale `true` pasa igual de verde, así que **todos** los casos son
emparejados: dos gestiones en **la misma lectura**, una `true` y otra `false`.

| Dónde | Qué afirma |
| --- | --- |
| `tests/unit/repositories/cierre-dia-repository.test.ts` | la de la tienda `true` y la del mensajero `false` en la misma lectura · sin ninguna, las dos `false` · **el `where` con las tres condiciones y `ordenId` delante** · UNA sola consulta para N filas · sin gestiones no se consulta nada · el detalle de un cierre PROPIO también lo lleva |
| `tests/unit/services/gestion-desde-ayuda-rotulo-cierre.test.ts` | el flag **cruza hasta el DTO** (caso emparejado) · es passthrough, el servicio no re-deriva · las dos banderas del historial son **independientes** · la derivación pura y el significado de `false` · la proyección de admin pide las **dos** familias en **una** relación · caso emparejado sobre el mapper de admin |
| `tests/unit/repositories/gestion-desde-ayuda-cierre.test.ts` | end-to-end: la gestión de la tienda **aparece en `findGestionesPendientes` Y ROTULADA**, junto a una del mensajero que sale `false` |

## 6. Mutaciones

sha256 antes:
```
3f5647a4749361123fbef0c8e9b71f3e4fe57f4951fd7bea79c5f6f512d1228b  lib/repositories/CierreDiaRepository.ts
d5bbbc0e680bdd783a27da27fd4ab31617d7a668852d411ca0fcb354d6ab9658  lib/repositories/CierresAdminRepository.ts
```

### T8.6 💰 — quitar la derivación (`marcarDesdeAyudaTienda` devuelve siempre el conjunto vacío)

mutado: `5e67e9d2955f2860872e047978d4f6f9e5aadb2797d7f32e20a5317d97944966`

```
     × la de la TIENDA llega con `true` y la del MENSAJERO con `false`, en la misma lectura 12ms
     × el `where` lleva las tres condiciones, con `ordenId` DELANTE (el que usa el indice) 1ms
     × UNA sola consulta para las N gestiones (no una por fila) 1ms
     × el detalle de un cierre PROPIO tambien lo lleva, por la misma via 2ms
      Tests  4 failed | 82 passed (86)
```

El mensaje real, que es lo que se vería en pantalla:

```
AssertionError: expected [ [ 'g-tienda', false ], …(1) ] to deeply equal [ [ 'g-tienda', true ], …(1) ]

- Expected
+ Received
     "g-tienda",
-     true,
+     false,
```

Es decir: **la fila del cierre del mensajero diría que la gestión fue suya.**

### T8.7 — quitar la familia nueva del `where` del camino de admin

mutado: `58c363002b3e8503db20a568bf5c9c6af267f6ab8adea732601785f382063d0a`

```
     × la proyeccion pide las dos familias en UNA sola relacion 5ms
AssertionError: expected [ 'escalado_devuelta_sla' ] to deeply equal [ 'escalado_devuelta_sla', …(1) ]
      Tests  1 failed | 7 passed (8)
```

**sha256 tras restaurar: IDÉNTICOS a los de antes** (`diff` de los dos ficheros de sumas, sin salida).

## 7. Un rojo por diseño que el diff va a mostrar

`tests/unit/repositories/cierres-admin-repository.test.ts` fijaba por igualdad el `select` del
historial de la 102 (`{ where: { origenTipo: "escalado_devuelta_sla" }, take: 1, … }`). Se
**actualizó con nota fechada** al `in` de dos familias y `take: 2`. El literal sigue siendo literal:
es el censo de lo que esa consulta puede traer, y por eso no se sustituyó por su propia fuente.
(Los otros dos rojos fueron dobles de Prisma a los que les faltaba `ordenHistorialEstado`.)

## 8. Salidas reales

```
$ npx tsc --noEmit
TSC EXIT=0          (sin una sola línea)

$ npx eslint .
ESLINT EXIT=0
✖ 97 problems (0 errors, 97 warnings)   ← los 97 son preexistentes y ajenos a esta ficha

$ npx vitest run
 Test Files  1230 passed (1230)
      Tests  16040 passed | 26 skipped (16066)
   Duration  327.59s
```

## 9. Lo que queda para la pantalla

El dato ya llega: `CierreDetalleGestion.desdeAyudaTienda`. Falta **pintarlo** en la fila del cierre
del día del mensajero (R41) y el caso de componente que lo lee. El texto no lo fija el backend.

## 10. Tres correcciones a lo escrito arriba, comprobadas al cerrar

1. **El número exacto de fixtures: 35 líneas en 29 archivos de test** (arriba puse «37 fixtures»,
   que era una estimación y no un recuento). Más 2 llamadas a `toPendienteRow` que ganan el segundo
   argumento (`cierre-pagos-lectura.test.ts` y `cierre-detalle-causa-monto.test.ts`).

2. ✅ **La anotación `@sin-superficie` YA NO ESTÁ, y no la quité yo.** La primera tanda la dejó como
   deuda para T7; al cablear el modal, el agente de pantalla la retiró — que es exactamente lo que
   la guardia estaba diseñada para forzar. Comprobado hoy: `lib/actions/gestion-desde-ayuda.ts` no
   contiene la anotación, `GestionarDesdeAyudaModal.tsx` importa `gestionarDesdeAyuda`, y
   `superficie-de-uso.guardia.test.ts` pasa (18 tests). **El punto 1 de «lo que queda abierto para
   la pantalla» de la primera tanda queda CERRADO.**

3. ⚠️ **El árbol estaba COMPARTIDO con el agente de pantalla mientras corrí la suite completa**, y
   hay que decirlo para que nadie lea ese verde como más de lo que es. En el momento de la última
   corrida ya estaban en el árbol, sin commit, `GestionarDesdeAyudaModal.tsx`,
   `NovedadesModule.tsx`, `NovedadAcciones.tsx`, `novedad-acciones-catalogo.ts` y sus tests, más
   `progress/impl_237_frontend.md`.

   Es decir: **`1230 passed / 16040 tests` es el verde del árbol CON las dos mitades dentro**, no el
   de mi diff aislado. Para lo que interesa aquí es la señal buena —backend y pantalla se ven— pero
   **no sustituye al gate del leader sobre el árbol quieto**, y no es una medición de «mi backend
   solo». Los tests que sí son míos se corrieron además aislados, y sus salidas están arriba.

---

## ⚠️ CÓMO LEER ESTOS NÚMEROS — producción es hoy un entorno de PRUEBAS

**Confirmado por el humano el 2026-08-20.** Las mediciones de este archivo salen de la base de
producción, pero **esa base se está usando para probar**, no para operar.

Consecuencia, y es importante para quien lea esto dentro de seis meses:

- Los números **describen fielmente lo que el código hace** — un doble cobro medido es un doble cobro
  real del código, y un `0` con denominador sigue significando que ese camino no se ejerció.
- Lo que **NO** se puede concluir de ellos es **frecuencia operativa**. «Deshacer se usa un 12 %» o
  «el corte sólo barrió 2 órdenes» describen **cómo se ha probado la app**, no cómo la usa la
  operación. Un número bajo puede ser «no pasa» o «nadie lo ha probado aún», y la base no distingue.
- **Los importes cobrados de más no corresponden a dinero real de una tienda real.** Por eso no hay
  devolución que hacer, y por eso el defecto se arregla hacia adelante.

⏳ **El día que producción pase a ser producción de verdad, TODO esto hay que re-medirlo**, y las
conclusiones de frecuencia hay que rehacerlas desde cero.
