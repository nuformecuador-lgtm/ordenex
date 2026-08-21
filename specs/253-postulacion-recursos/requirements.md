# Feature 253 — La postulación de vehículo o bodega deja de ser una maqueta

> **Lo que esta ficha cierra, en una frase:** el modal que la landing pública abre desde «Postular mi
> vehículo» y «Postular mi bodega» **valida, pinta «Postulación enviada» y no envía nada**. Esta
> ficha le da destino real —**tabla propia + panel en el admin**—, protege la escritura pública
> reusando lo que ya funciona, y **pone la guardia que hoy no existe para la landing**, porque un
> `setEnviado(true)` sin envío no rompe ningún test.

---

## 0 · El defecto, verificado en el árbol (no reportado: leído)

`app/_landing/PostularRecursoModal.tsx`

- **:20-35** — la cabecera del archivo se declara a sí misma **MAQUETA**: *«El botón «Enviar
  postulación» valida y pinta la confirmación, pero NO envía nada: todavía no está decidido el
  destino de los datos»*.
- **:115-131** — `handleSubmit` valida con `formSchema` y, si pasa, ejecuta **exactamente dos
  líneas**: `setErrores({})` y `setEnviado(true)`, con `// TODO: aquí va el envío real cuando se
  decida el destino de la postulación`.
- **:141-152** — `enviado === true` pinta **«Postulación enviada. Recibimos tus datos. Nuestro
  equipo te contacta al teléfono o al correo que dejaste.»**

**No falla: miente.** Da acuse de recibo de algo que no ocurrió, en producción, en la landing
pública, a personas que no tienen ninguna otra forma de saberlo. El humano lo descubrió postulando
un vehículo y una bodega y no encontrándolos en ningún sitio: **nunca salieron del navegador**.

**No hay red que lo detecte.** No existe ningún test de `PostularRecursoModal` en el árbol
(censado el 2026-08-20: el símbolo sólo aparece en `LandingPostular.tsx`, `LandingNav.tsx`,
`specs/86-landing-publica/requirements.md` y `feature_list.json`; **cero archivos bajo `tests/`**).
La guardia anti-maqueta que la 240 escribió —`tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts`—
existe **exactamente para esta clase de defecto**, y su ámbito es una constante del archivo:
`const PANTALLA = "app/(app)/novedades"` (:78). **La landing queda fuera.**

## 1 · Lo que ya está decidido, y no se re-litiga

Decisiones del humano del 2026-08-21, transcritas para que la implementación no las reabra:

| # | Decisión | Firmada |
| --- | --- | --- |
| **F1** | **Destino: tabla propia + panel en el admin**, junto a las postulaciones de mensajero. | sí |
| **F2** | **Descartado el correo al equipo.** `lib/services/EmailProvider.ts` es `StubEmailProvider`: su único cuerpo es un `console.info` con metadata. Un destino que no envía **repetiría el defecto**, con la agravante de que esta vez creeríamos haberlo arreglado. | sí |
| **F3** | **Descartado retirar las tarjetas** de la landing. | sí |
| **F4** | **No hay parche intermedio.** La landing se queda como está hasta que el destino esté construido. | sí |
| **F5** | **La ficha corre prisa, y es consecuencia directa de F4:** mientras no entre, **cada persona que postule se va creyendo que lo hizo**. La pérdida es irrecuperable —no hay fila, no hay log, no hay correo— y no se puede medir hacia atrás (ver `design.md` §11/M4). | sí |

## 2 · Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **postulación de recurso** | Lo que esta ficha registra: alguien ofrece **un vehículo o una bodega**. No es una persona buscando empleo ni una cuenta: no hay login, ni documentos, ni aprobación que conceda acceso. |
| **postulación de mensajero** | La feature 21: auto-registro **de una persona** que crea un `usuario` en estado `pendiente` con 5 documentos. Es el otro —y hasta hoy único— camino de escritura pública sin sesión. Se **reusa su forma**, no su tabla (ver `design.md` §14-D). |
| **maqueta** | Un control visible cuyo handler no produce ninguna operación de servidor: sólo pinta o avisa. Definición literal de `specs/240`. |
| **el acuse** | El panel de confirmación «Postulación enviada» que hoy se pinta sin que nada se haya enviado. |
| **atender** | Marcar en el panel que alguien ya se hizo cargo de esa postulación. Es la **única** mutación que un administrador puede hacer sobre una fila. |
| **la guardia de la landing** | La red nueva de esta ficha: la equivalente, para las superficies públicas, de `novedad-acciones-sin-maqueta.guardia.test.ts`. |

---

## A · La landing deja de mentir

**R1.** CUANDO una persona envía el formulario de postulación de recurso desde la landing pública,
el sistema DEBE registrar la postulación de forma persistente y recuperable por la administración
**antes** de mostrar ninguna confirmación.
*Test previsto:* test de componente del modal (el acuse sólo aparece tras un `ok` del doble) + test
de integración de la acción contra la tabla.

**R2.** SI el registro de la postulación no se completa —por validación, por límite de tasa o por
fallo del servidor—, ENTONCES el sistema NO DEBE mostrar el acuse, DEBE explicar en pantalla qué
pasó y qué hacer, y DEBE conservar lo que la persona escribió.
*Test previsto:* un caso de componente **por cada desenlace distinto de `ok`**, verificando que el
acuse NO se pinta y que los valores siguen en los campos.

**R3.** MIENTRAS un envío está en curso, el sistema NO DEBE aceptar un segundo envío del mismo
formulario y DEBE indicar en el botón que está enviando.
*Test previsto:* dos clicks seguidos producen **una sola** invocación de la acción.

**R4.** El sistema DEBE aceptar la postulación de recurso **sin sesión** y NO DEBE conceder sesión,
cookie ni token como resultado de crearla (paridad literal con R22 de la feature 21).
*Test previsto:* test de la acción que afirma que no se leen ni escriben cookies.

**R5.** El sistema DEBE tratar **cada** desenlace posible de la operación con un texto propio en la
pantalla; SI se añade un desenlace nuevo sin su texto, ENTONCES **el typecheck DEBE fallar**.
*Test previsto:* el mapa de textos tipado como `Record<Exclude<Resultado["status"], "ok">, string>`
(mecanismo de `progress/impl_240.md` §9.3) + un test que recorre la unión y exige texto no vacío.

**R6.** El sistema NO DEBE mostrar en el acuse ninguna promesa que no pueda cumplir: el texto DEBE
describir lo que efectivamente ocurrió (la postulación quedó registrada y alguien la revisará).
*Test previsto:* test de componente sobre el texto final, acordado en D9.

**R7.** La landing DEBE conservar sus tres vías de la sección «Sumate a Ordenex» —vehículo y bodega
por modal, «Quiero postularme» a `/postulacion`— y el diseño de las tarjetas NO DEBE cambiar.
*Test previsto:* `tests/components/LandingPage.test.tsx` (existente) sigue verde sin tocarse.

---

## B · La entrada: qué se acepta y qué se rechaza

**R8.** El sistema DEBE aceptar en la postulación de recurso exactamente estos campos: `nombre`,
`telefono`, `correo`, `mensaje` y `tipo`, donde `tipo` sólo puede ser `vehiculo` o `bodega`.
*(Los cuatro primeros son los del `formSchema` real, `PostularRecursoModal.tsx:72-77`; `tipo` es la
prop `RecursoTipo` que hoy sólo elige el copy y no viaja a ninguna parte.)*
*Test previsto:* test del schema zod (campo a campo, y un campo extra se ignora o se rechaza).

**R9.** SI `tipo` no es `vehiculo` ni `bodega`, ENTONCES el sistema DEBE rechazar la postulación
**sin escribir ninguna fila**.
*Test previsto:* test de la acción con `tipo` inventado → `validation_error`, repositorio no llamado.

**R10.** SI `nombre` está vacío tras recortar espacios, ENTONCES el sistema DEBE rechazar con error
**en ese campo**.

**R11.** SI `telefono` tiene menos de 7 caracteres tras recortar espacios, ENTONCES el sistema DEBE
rechazar con error en ese campo. *(Regla de hoy, `:74`. D2 decide si se endurece a sólo dígitos.)*

**R12.** SI `correo` no tiene formato de correo válido, ENTONCES el sistema DEBE rechazar con error
en ese campo; en caso contrario DEBE persistirlo **recortado y en minúsculas**.

**R13.** SI `mensaje` está vacío tras recortar espacios, o **excede el tope máximo configurado**,
ENTONCES el sistema DEBE rechazar con error en ese campo.
*(Hoy no hay tope: un campo de texto libre público sin cota es una puerta abierta. El valor lo fija
D3.)*

**R14.** El sistema DEBE **revalidar en el servidor** exactamente las mismas reglas que el cliente
aplica, y NO DEBE confiar en la validación del cliente.
*Test previsto:* test de la acción invocada directamente con entrada inválida (sin pasar por el
formulario) → `validation_error` y cero escrituras.

**R15.** El sistema DEBE devolver los errores de validación **por campo**, de forma que la pantalla
pueda señalar el campo culpable.
*Test previsto:* la acción devuelve `fieldErrors` con la clave del campo que falló.

---

## C · Abuso: es una escritura PÚBLICA sin sesión

**R16.** El sistema DEBE limitar el número de postulaciones de recurso aceptadas por clave de
control dentro de una ventana temporal configurable. SUPERADO el límite, DEBE rechazar la
postulación **sin escribir ninguna fila**.
*Test previsto:* test de la acción con limitador inyectado: al `RATE_MAX + 1`, `rate_limited` y
repositorio sin llamadas.

**R17.** CUANDO el sistema rechaza una postulación por límite de tasa, la pantalla DEBE decirlo con
un texto **propio**, distinto del error genérico.
*Test previsto:* caso de componente sobre `rate_limited` (cae también bajo R5).

**R18.** El sistema DEBE registrar el intento **siempre** que la validación haya pasado, acierte o
no la escritura, para que el límite no se pueda vaciar provocando fallos.
*Test previsto:* test de orden de operaciones (zod → IP → límite → registrar → servicio), molde de
`tests/unit/actions/postulacion-action.test.ts`.

**R19.** El sistema NO DEBE escribir en registros (logs) el contenido del `mensaje`, el `correo` ni
el `telefono` de una postulación, ni en el camino feliz ni en el de error.
*Test previsto:* test que captura el logger y afirma que ningún argumento contiene los valores.

**R20.** Al persistir, el sistema DEBE normalizar los cuatro campos de texto (recorte de espacios,
correo en minúsculas) y NO DEBE almacenar el valor crudo sin normalizar.
*Test previsto:* test del servicio/repositorio sobre la entrada con espacios y mayúsculas.

---

## D · El destino: la tabla

**R21.** El sistema DEBE persistir cada postulación de recurso con, al menos: `tipo`, `nombre`,
`telefono`, `correo`, `mensaje` y el instante de creación.
*Test previsto:* test del repositorio (doble de Prisma) + test de integración de la migración.

**R22.** La tabla nueva DEBE tener Row Level Security activada **sin políticas** para `anon` y
`authenticated` (acceso sólo por service role), coherente con `usuario`, `orden_nota` y
`plantilla_mensaje`.
*Test previsto:* test estático de la migración (`ENABLE ROW LEVEL SECURITY` presente, `CREATE POLICY`
ausente), molde de `tests/integration/db/postulacion-mensajero-migration.test.ts`.

**R23.** La migración DEBE traer su `down.sql`, que revierte **exactamente** lo que su
`migration.sql` crea.
*Test previsto:* test estático del par up/down + `pnpm run db:rollback` ejecutado y anotado.

**R24.** El sistema NO DEBE crear cuenta de usuario, sesión ni fila en `usuario` como efecto de una
postulación de recurso.
*Test previsto:* test del servicio afirmando que ningún repositorio de usuarios se toca.

**R25.** El sistema DEBE aceptar varias postulaciones de la misma persona (mismo correo o mismo
teléfono) como **filas distintas**, sin unicidad que las colapse: quien tiene un vehículo **y** una
bodega postula dos veces, y quien corrige su mensaje vuelve a enviar.
*Test previsto:* test del repositorio: dos inserciones con el mismo correo no lanzan y producen dos
filas.

**R26.** El sistema DEBE poder listar las postulaciones **pendientes** ordenadas por fecha con una
consulta que use índice, sin recorrer la tabla entera.
*Test previsto:* el `WHERE`/`ORDER BY` se prueba **donde vive** (test de repositorio contra Postgres
real, no contra un doble: un doble no ve el SQL).

---

## E · El panel del admin

**R27.** El sistema DEBE mostrar las postulaciones de recurso a los roles `maestro` y `admin`, y
sólo a ellos (mismo conjunto que autoriza hoy `AprobacionPostulacionService`).
*Test previsto:* test del servicio, un caso por rol del enum `RolValue`.

**R28.** SI el actor no tiene rol autorizado, ENTONCES el sistema NO DEBE devolver ninguna
postulación, NO DEBE revelar cuántas hay y NO DEBE tocar la base.
*Test previsto:* test del servicio: `forbidden` **antes** de llamar al repositorio.

**R29.** El panel DEBE mostrar, por cada postulación pendiente: el tipo (vehículo o bodega), el
nombre, el teléfono, el correo, el mensaje completo y la fecha en que llegó.
*Test previsto:* test de componente del panel con datos de ejemplo.

**R30.** El panel DEBE paginar el listado.
*Test previsto:* test de componente + test del servicio sobre `page`/`pageSize` y su tope.

**R31.** CUANDO un administrador autorizado marca una postulación como atendida, el sistema DEBE
registrar **quién** y **cuándo**, y esa postulación DEBE dejar de aparecer entre las pendientes.
*Test previsto:* test del servicio + test de componente (la fila desaparece tras el refresco).

**R32.** SI una postulación ya está atendida, ENTONCES un segundo intento de marcarla NO DEBE
sobrescribir quién ni cuándo la atendió, y DEBE devolver un desenlace de conflicto distinguible de
«no existe».
*Test previsto:* test del servicio con actualización condicional (`count === 0` → reconsulta →
`conflict` vs `not_found`), molde de `AprobacionPostulacionService.decidir`.

**R33.** El sistema DEBE permitir consultar también las postulaciones **ya atendidas**, para que un
clic equivocado no las haga inalcanzables.
*Test previsto:* test del servicio con el filtro en sus dos valores; test de componente del cambio
de pestaña.

**R34.** SI la operación de atender falla, ENTONCES la pantalla DEBE decirlo con un mensaje visible
y la fila DEBE permanecer. **Ningún control de este panel puede quedarse mudo.**
*(Lección literal de `progress/impl_240.md` §9.1 y de la ficha 248: un botón que no hace nada ni
avisa es el mismo defecto que esta ficha viene a cerrar, una capa más abajo.)*
*Test previsto:* test de componente forzando el error del doble → mensaje visible, fila presente.

**R35.** MIENTRAS no haya postulaciones pendientes, el panel DEBE mostrar un estado vacío que
explique de dónde salen esas postulaciones.
*Test previsto:* test de componente con lista vacía.

**R36.** Ningún texto de la pantalla del administrador DEBE afirmar algo que dejó de ser cierto al
añadir este panel. *(Hoy `AdminMaestroDashboard` se describe entero como «Postulaciones de
mensajeros pendientes».)*
*Test previsto:* test de componente sobre la descripción de la página.

---

## F · La guardia: que el siguiente botón decorativo no pase

> **Por qué esta sección no es opcional.** La 240 arregló un botón que estuvo **ocho días** en
> producción avisando por toast, y escribió la guardia que impide repetirlo… **para `/novedades`**.
> Este botón lleva vivo lo que lleve **porque nadie escribió la equivalente para la landing**. Sin
> esta sección, la ficha arregla un caso y deja el agujero de proceso intacto.

**R37.** El repositorio DEBE tener una guardia que falle CUANDO una superficie interactiva de la
landing pública prometa un resultado sin que ninguna operación de servidor lo produzca.
*Test previsto:* la guardia misma, más su autocomprobación (R41).

**R38.** La guardia DEBE mantener un **censo** de las superficies de envío de la landing en el que
cada entrada declare **o** la Server Action que produce (nombre exacto del `export async function`
y su módulo) **o** un motivo escrito de por qué no produce ninguna, de al menos 20 caracteres y sin
relleno (`TODO`, `pendiente`, `-`).
*Test previsto:* frentes 1 y 3 de la guardia + casos de `faltaDelMotivo`.

**R39.** La guardia DEBE exigir que el productor declarado **exista** (módulo presente, con
`"use server"`, exportando ese símbolo) **y** que algún archivo de la landing lo **importe Y lo
invoque**. Importarlo sin llamarlo NO DEBE contar como cableado.
*(Es la quinta forma de replantar la maqueta, medida el 2026-08-20 en la 240: el import en pie y la
invocación borrada pasaba las dos guardias en verde, y el linter no la caza porque
`"lint": "eslint"` no lleva `--max-warnings=0`.)*
*Test previsto:* frente 2 + el caso `IMPORT_SIN_LLAMADA` de la autocomprobación.

**R40.** La guardia DEBE fallar SI un archivo de la landing declara un formulario de envío que el
censo no nombra, y SI el censo nombra un archivo o una acción que ya no existen.
*(Censo en las dos direcciones: sin la inversa, basta con añadir un modal nuevo sin tocar el censo
para volver al punto de partida; y una excepción que sobrevive a su motivo es basura.)*
*Test previsto:* frentes 4 y 5 + control de anti-vacuidad.

**R41.** La guardia DEBE ejercitar sus detectores contra fuente sintético —sano y con la infracción
plantada— **antes** de afirmar nada sobre el árbol real, incluyendo el caso literal de esta ficha:
un `handleSubmit` que valida y sólo hace `setEnviado(true)`.
*(Una guardia estática rota no falla: **calla**, y su verde se lee igual que el bueno. Ya pasó en
este repo.)*
*Test previsto:* bloque «0 — los detectores no están rotos», molde de la 240.

**R42.** La guardia DEBE seguir siendo seleccionable por `pnpm exec vitest run guard` (nombre de
archivo `*.guardia.test.ts` bajo `tests/unit/guards/`), sin estar registrada en ninguna lista.
*Test previsto:* se comprueba ejecutando `pnpm run test:guardias` y viendo el archivo en la salida.

---

## G · No regresión

**R43.** La postulación de mensajero (features 21, 22 y 23) NO DEBE cambiar de conducta por esta
ficha: ni su acción pública, ni su panel, ni sus textos.
*Test previsto:* las suites existentes de esas features verdes **sin modificarse**.

**R44.** El rastreo público de la landing (feature 229) NO DEBE cambiar de conducta, y su superficie
DEBE quedar declarada en el censo nuevo como productor real, no como excepción.
*Test previsto:* frente 2 de la guardia lo cubre + suite de `rastreo-publico` verde sin tocarse.

---

## Preguntas abiertas

> Ninguna se rellena con un supuesto. Cada una está nombrada en `design.md` con **una recomendación
> y su porqué**; lo que falta es la firma. Las de aquí son las que **no puedo resolver leyendo el
> árbol**.

- **P1 — ¿Qué pasa con las postulaciones ya perdidas?** No hay ninguna fila, ningún log y ningún
  correo: **no son recuperables ni contables**. Lo único conocido es que el humano hizo dos (un
  vehículo y una bodega). ¿Se hace algo —un aviso en la landing, un contacto manual con quien se
  sepa que postuló— o se asume la pérdida y se sigue? *No afecta al código; afecta a personas que
  están esperando una llamada.*

- **P2 — ¿Cuánto tiempo se conservan estos datos?** La tabla guarda nombre, teléfono, correo y un
  texto libre de personas del público. No encuentro en `docs/` ni en `specs/` ninguna política de
  retención ni de borrado para datos personales, así que no la invento. ¿Se borran las atendidas
  pasado un plazo? ¿Nunca?

- **P3 — ¿Quién atiende estas postulaciones, y por dónde entra?** El panel se propone en
  `/dashboard`, que es la pantalla de aterrizaje de `maestro` y `admin`, así que la ven al entrar
  (por eso D6 recomienda **no** añadir aviso en la campana). Si en la operación real esto lo
  atiende alguien que **no** es `maestro` ni `admin`, la respuesta cambia y hay que decirlo antes de
  escribir la autorización.

- **P4 — ¿Desde cuándo vive la maqueta en producción?** No lo sé: ningún spec del árbol la
  autoriza. `specs/86-landing-publica` sólo la menciona en una corrección del 2026-08-20, y
  `feature_list.json` no la nombra fuera de esta ficha. Es medible con `git log --follow` sobre el
  archivo (T0.3) y sirve para dimensionar cuántas personas pudieron pasar por ahí.

- **P5 — ¿El tipo de recurso lo elige el postulante o lo fija la tarjeta?** Hoy lo fija la tarjeta
  (`LandingPostular.tsx:34,46`) y el modal no lo muestra. Se mantiene así salvo objeción: si alguien
  entra por «vehículo» y describe una bodega, el `mensaje` lo dirá y el administrador lo verá. Se
  pregunta porque afecta a si `tipo` es dato de negocio o sólo procedencia del formulario.
