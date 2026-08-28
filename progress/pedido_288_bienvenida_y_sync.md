# Feature 288 — Pedido humano 2026-08-27: bienvenida solo `activo`, y sync solo estados

> Segundo encargo humano sobre la rama `feature/288-picker-variables-plantilla`, posterior al
> del Sheet. Dos cambios independientes que comparten pantalla (`configuracion/plantillas`) y
> que **derogan comportamiento aprobado**, uno de ellos con su test escrito en la afirmacion
> contraria. Aqui queda por escrito qué cambia, qué se rompe a propósito y qué NO cambia
> aunque lo parezca.

## Resumen para el PR

| Qué | Antes | Ahora |
| --- | --- | --- |
| Marcar «mensaje de bienvenida» | Desde **cualquier** estado | **Solo** desde `activo` |
| Salir de `activo` | La marca sobrevivía | **Se desmarca sola** |
| Sincronizar con WhatsApp: importar | Creaba la plantilla local que faltaba | **No crea nada** |
| Sincronizar con WhatsApp: escribir | 2 `updateMany` a ciegas por template | **Solo si algo difiere** |
| Sincronizar con WhatsApp: cuerpo | Lo importaba de Meta al crear | **No se toca nunca** |

---

## 1. El botón de bienvenida, solo para plantillas `activo`

### Qué se deroga

`PlantillaMensajeService.marcarMensajeBienvenida` llevaba escrito, en el código y en un test,
lo contrario de lo que se pide hoy:

> «Se permite desde CUALQUIER estado a propósito. Acotarlo a `activo` obligaría al maestro a
> esperar la aprobación de Meta para poder siquiera declarar su intención, y el momento del
> envío —que es quien tiene que exigir una plantilla enviable— no es este.»

Y el test `plantilla-mensaje-bienvenida.test.ts` lo fijaba con nombre y todo: *«se permite
desde CUALQUIER estado: un borrador sin aprobar también se puede elegir»*.

### Por qué el argumento viejo no se sostiene

Era razonable si el envío de bienvenida tuviera a alguien delante. No lo tiene: sale **solo**
cuando el paquete es recogido. Con una plantilla no enviable marcada, el resultado no es un
error visible sino **silencio** —el cliente no recibe nada y no hay pantalla donde avisarlo—.
«Declarar la intención» y «configurar un silencio» eran, en los hechos, la misma acción.

La marca ahora exige lo mismo que el envío: `activo`.

### Dónde vive el guardia, y por qué ahí

- **Service** (`marcarMensajeBienvenida`): `findById` → `not_found` si no existe →
  `estado_invalido` si no es `activo` → recién entonces escribe. Es la puerta real.
- **No** en el `where` del repositorio: ahí no se puede distinguir «no existe» de «existe pero
  no está activa», y esa diferencia es justo lo que la UI necesita para decir *por qué* no se
  pudo. El `marcarWelcomeMessage` se queda como estaba.
- **UI** (`puedeSerBienvenida`): deshabilita el botón y cambia el tooltip. Es cortesía, no la
  puerta — y por eso el caso `estado_invalido` **sigue manejándose** en el módulo: se llega a
  él cuando el listado en pantalla está viejo.

El botón queda **visible y deshabilitado**, no oculto: es donde cuelga el tooltip que explica
que lo que falta es la aprobación de Meta. Sin él, «no puedo marcarla» no tiene respuesta.

### Lo que NO cambia

- El envío de bienvenida (`whatsapp-bienvenida-handler`) no se toca. Ya exigía una plantilla
  enviable; lo que cambia es que ahora no se puede *configurar* una que no lo sea.
- El envío de bienvenida no exige nada nuevo: ya pedía una plantilla enviable.

---

## 1-bis. Salir de `activo` desmarca la bienvenida

Decisión humana del 2026-08-27, tras plantear el punto abierto: **se desmarca sola**.

### Dónde vive la regla, y por qué ahí

En el **repositorio**, en las dos escrituras que mueven el estado:

- `updateEstado`: la misma escritura que cambia el estado limpia la marca. Por este único
  método pasan los **tres** caminos que mueven el estado —desactivar, enviar a aprobación, y
  el reintento de propagación a Meta—. Ponerla en los services obligaría a que los tres se
  acuerden, y el que se olvide deja la marca colgando de una plantilla no enviable.
- `sincronizarTemplatePorNombre`: cubre el caso que **no pasa por ningún service** — Meta
  mueve un template de `APPROVED` a `REJECTED` y nadie tocó nada en la app. La marca deja de
  ser válida exactamente igual.

Es **una sola escritura**, no dos: no existe una ventana en la que la fila esté ya inactiva y
todavía marcada.

### Dos detalles que no se ven en el diff

1. **`welcomeMessage` entra en la COMPARACIÓN del sync**, no solo en el `data`. Si no, una
   fila cuyo único desajuste fuera la marca se contaría como `sin_cambios` y la marca
   sobreviviría indefinidamente a su plantilla. Hay un test para exactamente ese caso.
2. **Reactivar NO re-marca.** `updateEstado` hacia `activo` no toca `welcomeMessage`. Si lo
   escribiera, tendría que decidir con qué valor: `true` resucitaría una marca que alguien
   retiró; `false` desmarcaría la bienvenida vigente cada vez que se reactiva *otra*
   plantilla. La respuesta correcta es no tocarla.

### El aviso, porque la pérdida es silenciosa

El modal de «Desactivar» dice, **antes** de confirmar, que la plantilla dejará de ser la
bienvenida y que **ninguna otra queda marcada**: hasta que se elija una activa, no se envía
nada al recoger el paquete. Sin esa frase el negocio se queda sin bienvenida en silencio, y el
sitio donde se nota es el cliente que no recibe nada — para entonces ya no hay pantalla donde
avisar. En los caminos que no pasan por ese modal (aprobación, Meta) no hay aviso: son
consecuencia de que la plantilla dejó de ser enviable, no de una decisión sobre la bienvenida.

---

## 2. Sincronizar con WhatsApp: solo estados, solo lo que cambió

### Qué se deroga

El encabezado del service decía «NO crea ni borra filas locales (decision humana: "solo
actualizar existentes")» **mientras el código creaba filas** en el paso 2 (`crearDesdeMeta`).
El comentario describía el pedido; el código hacía otra cosa. Hoy se alinean.

### Qué se borró

- `SincronizarPlantillasWhatsappService`: el paso 2 entero.
- `IPlantillaMensajeRepository.crearDesdeMeta` + `CrearDesdeMetaData` + su implementación.
- `extraerCuerpoDeComponents` y su schema zod: solo servían para importar el cuerpo de Meta.

### La evidencia de por qué

Consultada la base real (Supabase, `plantilla_mensaje`), de 4 plantillas vivas **2 entraron
por importación** y ninguna de las dos es utilizable:

| nombre | estado | variables |
| --- | --- | --- |
| `hello_world` | inactivo | — |
| `ordenex_en_camino` | inactivo | `1`, `2`, `3` |

Las claves `1`,`2`,`3` son los parámetros numerados de Meta. **No están en el catálogo**, así
que `resolverValoresPlantilla` las resuelve a cadena vacía: esa plantilla, de enviarse,
llegaría con huecos. No es un fallo del import — es que un template de Meta no trae la
información que el catálogo local necesita. Dar de alta una plantilla es un acto del maestro,
con su cuerpo y sus variables del catálogo.

### Escribir solo si hay cambios

`sincronizarTemplatePorNombre` devolvía `boolean` y lanzaba **dos `updateMany` a ciegas** en
cada corrida. Con el cron de 24 h eso movía el `updatedAt` de todas las plantillas aunque Meta
no hubiera cambiado nada: el listado se reordenaba solo y «modificada» dejaba de significar
«alguien la tocó».

Ahora lee, compara y devuelve `SincronizarTemplateOutcome`
(`actualizada` | `sin_cambios` | `inexistente`), con **un solo `update` por id** cuando toca.

**Detalle que no se ve en el diff:** el `inactivo` local se resuelve **antes** de comparar. Si
no, una plantilla desactivada aquí pero aprobada en Meta contaría como «cambiada» en cada
corrida y se reescribiría eternamente sin cambiar nada. Hay un test para eso.

### El toast

`"N actualizadas, N creadas"` → `"N actualizadas, N sin cambios"`, con las ignoradas solo si
las hay. Se nombra lo que no cambió a propósito: tras la primera corrida del día lo normal es
`0 actualizadas`, y sin el «N sin cambios» al lado eso se lee como «no funcionó».

---

## Trazabilidad

| Afirmación | Test |
| --- | --- |
| No se marca desde `pending`/`saved_not_aprobation`/`refused`/`inactivo` | `plantilla-mensaje-bienvenida.test.ts` (`it.each`, 4 casos) |
| Sí se marca desde `activo` | idem |
| `not_found` lo decide el `findById`, sin escribir | idem |
| Carrera perdida (borrada entre lectura y SET) → `not_found`, no `estado_invalido` | idem |
| `estado_invalido` llega intacto a la UI, con su `estado` | idem (action) |
| El botón está deshabilitado para los 4 estados no-activos | `PlantillasModule.test.tsx` (`it.each`) |
| `estado_invalido` avisa y revalida | idem |
| Conteos por desenlace | `plantilla-sync-solo-estados.test.ts` |
| Un template que no existe aquí no se crea | idem |
| Todo coincide → ni un `update` | idem |
| Difiere templateId / idioma / estado → un `update` por id | idem |
| `inactivo` no se reactiva ni cuenta como cambio | idem |
| `inactivo` con enlace viejo: se actualiza el enlace, el estado sigue `inactivo` | idem |
| Salir de `activo` limpia la marca, en la MISMA escritura (4 estados) | `plantilla-mensaje-bienvenida.test.ts` (`updateEstado`) |
| Reactivar no toca la marca | idem |
| Meta rechaza la bienvenida → se desmarca sola | `plantilla-sync-solo-estados.test.ts` |
| La marca colgada se limpia aunque nada más difiera | idem |
| La bienvenida vigente y `activo` no se desmarca ni se reescribe | idem |
| El modal de desactivar avisa de la pérdida (y solo cuando toca) | `PlantillasModule.test.tsx` |

## Puntos abiertos (para el humano, no resueltos aquí)

1. **Una plantilla marcada que después se desactiva** conserva la marca de bienvenida. Hoy el
   envío simplemente no sale. ¿Se desmarca sola, se avisa en el listado, o se deja así?
2. **`ordenex_en_camino` y `hello_world`** siguen en la base con variables que no resuelven.
   El sync ya no las volverá a crear, pero tampoco las limpia. ¿Se borran a mano?
3. **El sync ya no trae el cuerpo de Meta.** Si alguien edita un template *en el panel de
   Meta*, el cuerpo local queda desactualizado y nadie lo detecta. Antes tampoco se detectaba
   (el update solo tocaba estado/enlace), así que no es una regresión — pero ahora es una
   decisión explícita y conviene saberla.
