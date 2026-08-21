# Feature 237 — La gestión que hace la tienda cuenta como del mensajero

> **Lo que esta ficha cierra, en una frase:** desde la pestaña «Ayuda solicitada» (ficha 236) la
> tienda puede hoy **leer** el problema, **responder** en el hilo y **devolver la orden a la ruta**,
> pero **no puede resolverla**. Esta ficha le da los dos desenlaces que el diseño de la pila le
> concede —**reprogramar** y **rechazar**— y hace que esa gestión **cuente como si la hubiera hecho
> el mensajero**: entra en su cierre, suma un intento y mueve el mismo dinero. Con los **mismos
> requisitos**: evidencia en imagen y motivo en texto.
>
> **Es la ficha más delicada en DINERO de toda la pila.** Un `rechazada` dispara el
> `cobroRechazado` de la feature 56 —dinero real cobrado a la tienda— y suma un intento de entrega
> que adelanta el escalado del cron de SLA (99). Aquí no hay margen para «sale solo».
>
> **Fuentes leídas y verificadas contra el código, no re-derivadas aquí:**
> `progress/design_pila_ayuda_tienda.md` §F3 y §«ADVERTENCIA HEREDADA PARA LA FICHA 237» ·
> `specs/236-ayuda-tienda-novedades/` (entera: es la pantalla sobre la que se construye) ·
> `specs/235-ayuda-tienda-estatus/` (el bloqueo del cierre y sus dos rutas exentas) ·
> `specs/238-confirmacion-fisica-cierre/` y `specs/239-devolucion-espera-cierre/` (la transacción de
> aprobación) · `progress/auditoria_ayuda_tienda.md` §4.
>
> **Base:** `origin/dev` con la **235**, la **236**, la **238** y la **239** ya dentro.

---

## Lo que ya está medido, y lo que NO

**Medido el 2026-08-19** (`progress/medicion_236.md`, producción, MCP solo lectura): **0 órdenes en
`ayuda_tienda`** y **0 en `devuelta`**, sobre 141 vivas en 11 estatus. Consecuencia directa: esta
ficha es **prospectiva** —no hay ninguna gestión de tienda que rescatar ni ningún dato que migrar—
pero **su primer uso real moverá dinero desde el minuto uno**.

⏳ **Esa foto caduca** y **hay números que esta ficha necesita y todavía no tiene**. Están escritos
como **medición pendiente en T0**, con la consulta hecha, y **no se rellenan con supuestos**: en esta
pila medir ya mató una decisión entera antes de llegar a firma.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **el estatus de ayuda** | `ayuda_tienda`: el mensajero pidió ayuda y **el paquete sigue con él, en la calle** (235). |
| **la gestión de la tienda** | La fila de `gestion_orden` que esta ficha crea cuando la tienda reprograma o rechaza desde la pestaña de ayuda. |
| **el mensajero de la orden** | El de `orden.mensajero_asignado_id`, que la solicitud de ayuda **no toca** (235/R6). Es a quien se atribuye la gestión. |
| **la familia de origen** | El `origen_tipo` de la fila de historial. Esta ficha estrena `gestion_tienda_ayuda`. |
| **visita real** | La lista de inclusión `ORIGEN_TIPOS_VISITA_REAL` (`lib/types/orden-historial.ts:171`), sexta condición del criterio único de intento de entrega (`whereIntentosVigentes`). Hoy tiene **un** miembro: `gestion`. |
| **la ventana del cierre** | `cierre_id IS NULL`: mientras la gestión no esté vinculada a un cierre, el mensajero puede deshacerla (67/R2). |
| **las dos rutas exentas** | `vencido → solicitado` y `rechazado → solicitado`, que **no** comprueban órdenes pendientes (111/R9, anti-deadlock). `CierreDiaService.ts:432` y `:447`. |
| **choke point** | `appendCambioEstado`: punto único de escritura de estado, con guardia de transición de fallo cerrado. |

---

## A · Los dos desenlaces y la fila que producen

**R1.** El sistema DEBE permitir a la tienda registrar, sobre una orden en el estatus de ayuda,
**exactamente dos** desenlaces —reprogramación y rechazo— y **ninguno más**.

**R2.** CUANDO la tienda registra uno de esos desenlaces, el sistema DEBE crear **una** gestión de esa
orden con ese resultado, con la **misma forma** que la que produciría el mensajero para ese resultado.

**R3.** CUANDO la tienda registra un desenlace, el sistema DEBE atribuir la gestión **al mensajero que
tiene la orden asignada**, de modo que la gestión entre en el cierre de ese mensajero.

**R4.** CUANDO la tienda registra un desenlace, el sistema DEBE registrar la transición de estado por
el **mismo punto único de escritura** que el resto de transiciones, con **la tienda** como actor.

**R5.** El sistema DEBE registrar esa transición con una **familia de origen propia**, distinta de
todas las existentes y distinta de la del mensajero.

**R6.** El sistema DEBE tratar esa familia como **visita real**, de modo que la gestión de la tienda
sume **un** intento de entrega bajo **exactamente el mismo criterio** que la del mensajero —resultado
contable, gestión vigente y **cierre aprobado**— y **sin un segundo criterio**.

**R7.** El sistema NO DEBE hacer que una orden resuelta por esta vía sume **más de un** intento por
cada cierre aprobado en el que tenga gestión.

**R8.** SI la orden en ayuda no tiene mensajero asignado, ENTONCES el sistema NO DEBE crear ninguna
gestión, NO DEBE cambiar el estado de la orden y NO DEBE atribuir la gestión a nadie.

**R9.** CUANDO la tienda registra un desenlace, el sistema DEBE dejar la gestión **sin vincular a
ningún cierre**, y DEBE dejar que la vincule **el mismo mecanismo** que vincula las del mensajero.

**R10.** CUANDO la tienda registra un desenlace, el sistema NO DEBE modificar el mensajero asignado de
la orden, su prioridad, ni el puntero de «orden en gestión» de ningún usuario.

**R11.** Ninguna escritura de esta feature DEBE convertir un monto a número de coma flotante ni
escribir un importe.

---

## B · Evidencia y motivo — los mismos requisitos

**R12.** El sistema DEBE exigir **al menos una imagen de evidencia** y **un motivo en texto** para
**los dos** desenlaces, y NO DEBE registrar ninguno sin las dos cosas.

**R13.** El sistema DEBE revalidar **en el borde del servidor** el tipo, el tamaño y el número de
imágenes, con **los mismos límites** que la gestión del mensajero, y NO DEBE depender de la interfaz
para hacerlos cumplir.

**R14.** CUANDO la tienda reprograma, el sistema DEBE exigir además una **fecha de reprogramación** no
anterior a mañana en el calendario de Costa Rica, revalidada en el servidor.

**R15.** SI alguna imagen no se puede almacenar, ENTONCES el sistema NO DEBE persistir nada: ni
gestión, ni transición, ni imagen suelta.

**R16.** SI la persistencia falla **después** de almacenar las imágenes, el sistema DEBE retirar las
imágenes ya almacenadas.

**R17.** El sistema DEBE usar **el mismo mecanismo** de subida compensada que la gestión del
mensajero, y NO DEBE introducir un mecanismo distinto para hacer lo mismo.

**R18.** El sistema NO DEBE exigir ni registrar la ubicación de quien gestiona por esta vía.

---

## C · Quién puede, y por dónde

**R19.** El sistema DEBE permitir esta gestión **sólo** a la administración de la tienda dueña de la
orden.

**R20.** El sistema NO DEBE permitir que un mensajero registre una gestión por esta vía, de modo que
no exista un camino que evite las guardas que su propia vía le aplica.

**R21.** El sistema DEBE derivar ese permiso de **la misma declaración** que gobierna quién puede
escribir en el hilo de una orden en el estatus de ayuda, y NO DEBE mantener una segunda tabla de
permisos para esta acción.

**R22.** SI el actor no está autorizado, ENTONCES el sistema NO DEBE revelar si la orden existe, en
qué estado está ni a quién pertenece.

---

## D · El estado, la carrera y la idempotencia

**R23.** MIENTRAS la orden NO esté en el estatus de ayuda, el sistema NO DEBE registrar sobre ella
ninguna gestión por esta vía.

**R24.** El sistema DEBE comprobar el estado de origen **en la misma sentencia que lo muta**, de modo
que no exista ventana entre la comprobación y el efecto.

**R25.** SI la orden dejó de estar en el estatus de ayuda entre la lectura y la escritura, ENTONCES el
sistema NO DEBE afirmar que la gestionó, NO DEBE crear la gestión y NO DEBE registrar ninguna
transición.

**R26.** CUANDO la gestión se registra, el sistema DEBE dejar la orden en el estado que corresponde a
ese resultado según **el mismo mapa único** que usa la gestión del mensajero, y NO DEBE derivarlo de
la coincidencia de nombres.

**R27.** CUANDO la tienda registra un desenlace, el sistema DEBE dejar de listar esa orden en la
superficie de ayuda y DEBE reflejarlo en su total.

**R28.** SI se envían dos peticiones simultáneas sobre la misma orden, ENTONCES el sistema DEBE crear
**a lo sumo una** gestión.

---

## E · El cierre y el dinero

**R29.** El sistema DEBE incluir la gestión de la tienda en el cierre del mensajero **por el mismo
mecanismo** que incluye las gestiones que él mismo registra, sin un camino propio.

**R30.** CUANDO se aprueba el cierre que contiene una gestión de la tienda, el sistema DEBE producir
**exactamente los mismos** movimientos de dinero que produciría una gestión del mensajero con el
mismo resultado sobre la misma orden.

**R31.** El sistema NO DEBE alterar los totales, el pago al mensajero ni el ingreso de bodega ya
congelados en un cierre existente por causa de una gestión posterior de la tienda.

**R32.** SI el mensajero tiene un cierre sin resolver cuando la tienda gestiona, ENTONCES la gestión
DEBE quedar vinculada al **siguiente** cierre de ese mensajero, y a **uno solo**: nunca a ninguno,
nunca a dos.

**R33.** MIENTRAS un mensajero tenga al menos una orden en el estatus de ayuda, el sistema DEBE seguir
impidiéndole **crear** una solicitud de cierre.

**R34.** El sistema DEBE mantener **exentas** de la precondición de «sin pendientes» las dos rutas de
re-solicitud de cierre, y NO DEBE aplicarles esa precondición por causa de esta feature.

**R35.** CUANDO se aprueba el cierre que contiene una gestión de la tienda cuyo paquete vuelve a
bodega, el sistema DEBE exigir la confirmación física de ese paquete **en ese mismo cierre**, con la
misma regla que aplica a las gestiones del mensajero.

**R36.** El sistema NO DEBE cambiar el «total a cobrar del día» del mensajero por causa de una gestión
de la tienda sobre una orden que él llevaba, y DEBE mantener disjuntos sus dos sumandos.

**R37.** El sistema NO DEBE escribir nada nuevo dentro de la transacción de aprobación del cierre por
causa de esta feature, ni alterar el orden de las escrituras que ya ocurren en ella.

---

## F · Deshacer

**R38.** El sistema NO DEBE permitir al mensajero deshacer una gestión que registró la tienda, y SI lo
intenta DEBE decírselo con un mensaje accionable y sin efectos.
> ⚠️ Depende de **D3**. Si D3 se firma al revés, este requisito se sustituye por: «CUANDO el mensajero
> deshace una gestión de la tienda, el sistema DEBE retirar con ella el intento y el dinero que
> aportaba, y DEBE dejar rastro de quién la deshizo».

**R39.** CUANDO una gestión de la tienda queda anulada por cualquier vía, el sistema NO DEBE seguir
contándola como intento de entrega ni como aporte a ningún total de cierre.

---

## G · Lo que ve cada uno

**R40.** CUANDO la tienda resuelve una orden desde la superficie de ayuda, el sistema DEBE dejar de
mostrarla al mensajero en el apartado de ayuda de su portal.

**R41.** El sistema DEBE mostrar al mensajero la gestión de la tienda en el detalle de su cierre del
día, **identificada como hecha por la tienda**, y NO DEBE presentarla como una gestión suya.

**R42.** El sistema NO DEBE añadir al rastreo público del destinatario ningún hito nuevo por causa de
esta feature.

**R43.** El sistema DEBE emitir a los integradores externos **el mismo evento** que emitiría la
gestión del mensajero con ese resultado, y NO DEBE ampliar el vocabulario de estados que les emite.

**R44.** El sistema NO DEBE emitir el aviso interno de «orden rechazada por el destinatario» cuando el
rechazo lo registra la tienda desde la superficie de ayuda.
> ⚠️ Depende de **D4**. Si D4 se firma al revés, este requisito se sustituye por su contrario **y por
> un texto propio**: el aviso de hoy afirma que rechazó el destinatario, y aquí no es cierto.

---

## H · Las superficies exhaustivas, la migración y lo que no cambia

**R45.** El sistema NO DEBE declarar ninguna transición nueva sin un productor en el código, ni dejar
sin declarar ninguna que tenga productor.

**R46.** El sistema NO DEBE exceptuar la familia nueva de la emisión de eventos públicos.

**R47.** Toda migración de esta feature DEBE tener su reversión, y esa reversión DEBE dejar la base en
un estado que el código anterior pueda leer.

**R48.** El sistema NO DEBE cambiar el número de intentos de entrega de ninguna orden que no haya sido
gestionada por esta vía.

**R49.** El sistema NO DEBE cambiar la solicitud de ayuda, el rescate, el corte de la noche ni la
gestión del mensajero.

**R50.** Ningún registro de diagnóstico producido por esta feature DEBE contener el cuerpo del motivo,
datos personales, teléfonos, direcciones, números de guía ni secretos.

---

## Lo que YA funciona y NO se rehace

Se **reutiliza**, no se reescribe:

- **El mapa `resultado → estado destino`** (`lib/types/gestion-destino.ts`, feature 239). Los dos
  resultados de esta ficha ya están declarados ahí; no se escribe un segundo mapa.
- **El punto único de append de estado** (`appendCambioEstado`) con su guardia exhaustiva de
  transiciones. Un estado o una arista sin declarar **rompe el build**.
- **La ventana de escritura del hilo** (`lib/types/ventana-hilo-notas.ts`) y `autorizarSobreHilo`,
  que ya conceden a la tienda y al mensajero acceso sobre `ayuda_tienda` (235/R34).
- **La subida compensada 1..N de evidencias** que hoy vive dentro de `MisAsignacionesService.gestionar`
  (features 119/158). Ver `design.md` §5: **hay que extraerla**, no copiarla.
- **El borde de evidencias** (`evidenciasSchema`, `validarEvidencia`, `GESTION_ALLOWED_MIME`,
  `gestionConfig.MAX_EVIDENCIAS_POR_GESTION`) y el patrón `FormData` + `getAll("evidencia")`.
- **La tabla de acciones de la card** (`ACCIONES_POR_GRUPO`, feature 236): esta ficha añade **dos
  celdas**, no una condición suelta.
- **El molde de la gestión de escritorio de la tienda**: `GestionOrdenRepository.reprogramarDesdeDevuelta`
  (feature 100) ya hace exactamente esta forma —`updateMany` guardado + gestión con el `mensajero_id`
  derivado + append con `actor = adminTienda` y familia propia—.
- **El molde de la pantalla**: `ReportarIncidenteModal` (feature 158), que ya captura causa + motivo +
  1..N fotos desde una pantalla que no es la del mensajero.

## Fuera de alcance

- **Entregar, devolver o reportar incidente desde ayuda.** El diseño firmado (§«Decisiones ya
  firmadas», punto 6) dice **solo reprogramar y rechazar**. Las otras tres aristas **no se declaran**:
  declarar una arista sin productor es el error que «costó el tren 154+155+156».
- **El rechazo manual de la tienda sobre una devolución anclada**, la retirada de «Habilitar» de las
  cards de cierre y la guardia del botón «Notas» → **ficha 240**.
- **Cambiar el bloqueo del cierre o sus dos rutas exentas** (R33/R34). Esta ficha **prueba** la
  consecuencia; no cambia la regla.
- **Unificar el criterio de intento con el anclaje de la devolución.** Las dos guardias que lo impiden
  (`anclaje-vs-intentos`, `deriva-primer-intento`) deben quedar verdes **sin tocarse**.
- **Retirar la segunda copia de la subida de evidencias de `IncidenteAdminService`** (ver D5).
- El **portal del mensajero** más allá de lo que R40/R41 exigen.

---

## Preguntas abiertas — DECISIONES

Cada una lleva **qué se decide**, las opciones, **la recomendación con su porqué** y **qué se rompe si
se elige la otra**. Las marcadas **[FIRMA]** cambian producto, dinero o contrato y **no se implementan
sin respuesta humana**. Ninguna se da por firmada.

---

### D1 · La invariante rota: la gestión que cae en el cierre siguiente. [FIRMA — es la decisión de dinero]

**El hecho, verificado en el código y no supuesto** (detalle completo en `design.md` §1): la frase del
diseño de la pila —«`deshacerGestion` sigue funcionando sin tocarlo, **porque una orden en ayuda
bloquea el cierre**»— es **cierta al crear un cierre** y **falsa en las dos rutas de re-solicitud**
(`CierreDiaService.ts:432` y `:447`), que devuelven **antes** de la precondición de pendientes
(`:456`) y que **sólo cambian `estado`**, sin re-vincular gestiones. En esas dos rutas el cierre ya
existe con sus gestiones dentro, así que una gestión de la tienda posterior nace con `cierre_id = NULL`
y **cae en el cierre siguiente**.

- **(a)** Aceptarlo, **probarlo con un test que lo ejerza** y declarar la consecuencia.
- **(b)** Bloquear a la tienda mientras el mensajero tenga un cierre sin resolver.
- **(c)** Que la re-solicitud vuelva a vincular gestiones y re-snapshotee los totales.
- **(d)** Quitarles la exención a las dos rutas.

**Recomendación: (a).** Tres razones, en orden de peso. (i) **El dinero no se rompe**: los cinco feeds
leen `gestion_orden` por `cierre_id` y la gestión acaba en **un** cierre, sólo que en otro; el snapshot
del cierre viejo ya se congeló sin ella, así que no hay ni doble cobro ni cobro perdido. (ii) Las otras
tres **rompen cosas peores**: (b) hace que la tienda no pueda resolver por un estado del mensajero que
no controla —justo la parálisis que esta ficha viene a quitar—; (c) **reabre el re-snapshot de un
cierre congelado**, que 111/R8 y 109/R28 declaran money-safe con esas palabras; (d) **reabre el
deadlock** que 111/R9 cerró. (iii) Lo que hay que hacer no es código, es **prueba**: la ficha promete
«entra en su cierre» y hay un caso donde entra en **otro**; escribirlo (R32) lo convierte de defecto
sorpresa en comportamiento declarado.

**Qué cuesta (a), dicho aquí y no descubierto en producción:** (1) la gestión aparece en el cierre del
día siguiente, no en el del día en que la tienda actuó; (2) el **intento** no cuenta hasta que ese
cierre se apruebe, así que el escalado del cron SLA se **retrasa** —dirección segura del error—; (3)
la **confirmación física** (238) de ese paquete se pedirá en el cierre siguiente aunque el paquete
vuelva a bodega hoy. Los tres se miden en **T0.2** antes de firmar: si las rutas exentas resultan
frecuentes, la conversación cambia.

---

### D2 · ¿Evidencia obligatoria también al REPROGRAMAR? [FIRMA]

La ficha dice dos cosas que no coinciden: «los **mismos** requisitos que la del mensajero» y
«**evidencia en imagen y motivo en texto**». **El mensajero NO sube evidencia al reprogramar**
(`gestionarSchema`, rama `reprogramada`: sólo fecha y motivo); sí al entregar, devolver, rechazar y
reportar incidente.

- **(a)** Evidencia obligatoria en **los dos** desenlaces de esta ficha.
- **(b)** Evidencia sólo al rechazar, paridad literal con el mensajero.

**Recomendación: (a).** (i) Es la lectura **operativa** de la frase firmada, que enumera los dos
requisitos sin excepción. (ii) La reprogramación del mensajero **ya lleva una prueba de presencia que
la de la tienda no puede tener**: la ubicación es obligatoria en las cinco ramas (193/R6-R12) y la
denegación del permiso **bloquea** el envío. La tienda gestiona desde un escritorio: la imagen —la
captura de la conversación con el cliente, típicamente— es **su sustituto de esa prueba**, no un
adorno. (iii) Reprogramar desde ayuda **suma un intento y mueve el reloj**: dos clicks sin prueba
sobre una orden que la tienda no vio es demasiado barato para lo que cuesta.

**Qué se rompe con (b):** la reprogramación de la tienda queda como la acción más barata de la pila y
la única de las dos con efecto contable y sin rastro propio; y R12 hay que partirlo en dos requisitos
con una excepción que después nadie recuerda por qué está.

---

### D3 · ¿Puede el mensajero DESHACER la gestión de la tienda? [FIRMA — dinero]

**Hallazgo, verificado leyendo las ocho guardias de `deshacerGestion`:** la gestión de la tienda nace
con `mensajero_id = el mensajero` (R3, que es lo que la mete en su cierre) y con `cierre_id = NULL`
(R9). Con eso **pasa todas las guardias**: rol mensajero ✔, la gestión es «suya» (`:550`) ✔, ventana
abierta (`:554`) ✔, es la última ✔, y el estado esperado casa (`ESTADOS_ESPERADOS.reprogramada =
["reprogramada"]`, `.rechazada = ["rechazada"]`). **El mensajero puede revertir la decisión de la
tienda**, y la orden vuelve a `en_reparto` **reasignada a él** — no a `ayuda_tienda`. La tienda **no se
entera**: la fila ya no está en ninguna de sus pestañas.

- **(a)** Dejarlo como está: quien la deshace es el mensajero, como cualquier gestión suya.
- **(b)** Excluir las gestiones de esta familia del deshacer, con mensaje accionable.
- **(c)** Que el deshacer devuelva la orden a `ayuda_tienda` en vez de a `en_reparto`.

**Recomendación: (b).** (i) **Dirección del error.** Con (a) el mensajero puede **borrar en silencio un
`cobroRechazado` que la tienda decidió** y el intento que lo acompaña; con (b) el peor caso es un
rechazo equivocado que sigue su curso —el paquete vuelve a la tienda por el flujo de devolución— y es
**recuperable**. (ii) **Nadie decidió que un actor pueda revertir al otro**: el diseño de la pila dio
la frase por buena sin mirar la guardia de propiedad, y la propiedad aquí es un **medio para que caiga
en su cierre**, no una declaración de autoría. (iii) El coste es acotado y precedentado: el filtro por
familia se resuelve con el mismo `some` sobre el historial que `whereIntentosVigentes` ya usa.

**Qué se rompe con (b):** un rechazo equivocado de la tienda **no tiene deshacer**, y hay que decirlo
en pantalla (R38 lo exige). **Qué se rompe con (a):** la tienda pierde una decisión sin saberlo, y el
dinero se puede retirar sin su consentimiento. **Con (c):** hay que declarar dos aristas más
(`reprogramada → ayuda_tienda`, `rechazada → ayuda_tienda`) que hoy no existen y que reabren un estado
que ya se resolvió; es más grafo por un caso raro.

---

### D4 · El aviso interno de «orden rechazada». [FIRMA — consumidor que filtra por ORIGEN]

**Hallazgo:** el emisor de notificaciones filtra por `destino === "rechazada" && origenTipo ===
"gestion"` (`lib/notificaciones/emitir.ts:131-132`). Un rechazo de la tienda desde ayuda llevará
`origen_tipo = gestion_tienda_ayuda`, así que **no emitirá** ese aviso a los admins y al satélite.
**Es un consumidor que filtra por origen; por eso es un requisito (R44) y no una nota.**

- **(a)** No emitir, y **afirmarlo con un test** para que la ausencia sea decisión y no olvido.
- **(b)** Emitir el mismo aviso con el mismo texto.
- **(c)** Emitir con un texto propio.

**Recomendación: (a).** El texto es «Una orden fue rechazada **por el destinatario**», y aquí eso es
**falso**: rechazó la tienda. Este repo tiene escrito lo que cuesta un dato que miente con formato de
dato (236/D3, la columna «Sin causa registrada»). Y el aviso **no es el mecanismo de nada**: el paquete
llega igual a `por_devolver`/`por_devolver_a_tienda` al aprobar el cierre (139), que es donde bodega lo
ve.

**Qué se pierde con (a), declarado:** los admins no reciben el aviso anticipado de que viene un
rechazo de esta clase. **Qué se rompe con (b):** se le dice a media empresa que un cliente rechazó un
paquete que nadie le llegó a ofrecer. **Qué cuesta (c):** un texto nuevo y ensanchar un filtro que hoy
es una igualdad; es la opción correcta **si el humano quiere el aviso**, y entonces R44 se invierte.

---

### D5 · La maquinaria de evidencias: extraer, y hasta dónde. [FIRMA ligera]

**Hallazgo, contado tal cual:** la ficha pide «reutilizar la maquinaria de `MisAsignacionesService.gestionar`,
no una segunda». **Ya hay dos.** `IncidenteAdminService` (feature 158) tiene su propia
`subir()`/`compensar()`, con el mismo bucle secuencial y la misma compensación. Si la 237 escribe la
suya serían **tres**.

- **(a)** Extraer la subida compensada a un módulo propio y cablear **la 237 y `MisAsignacionesService`**;
  `IncidenteAdminService` queda como **deuda declarada con dueño**.
- **(b)** Extraer y migrar **las tres** en esta ficha.
- **(c)** Escribir una tercera copia.

**Recomendación: (a).** (b) toca la feature 158 entera —servicio, tests de compensación, prefijo de
path propio— dentro de la ficha **más delicada en dinero de la pila**, y engorda el diff que hay que
revisar con cambios que no son de aquí. (a) cumple la letra del encargo (la copia que la ficha nombra
queda unificada), deja el módulo listo para que la 158 entre después en un commit mecánico, y **no
escribe ninguna copia nueva**. (c) está descartada: es exactamente lo que el encargo prohíbe.

**Qué se rompe con (b):** el radio de explosión. **Con (c):** la tercera copia diverge, y la
divergencia en una compensación de Storage se descubre cuando quedan archivos huérfanos.

---

### D6 · Qué ve el mensajero cuando la tienda le resuelve una orden. [FIRMA]

Hoy, en cuanto la orden sale de `ayuda_tienda`, **desaparece de su portal sin explicación**: los tres
grupos de su pantalla son `por_recoger`, `en_reparto` y `ayuda_tienda`. Y a la vez le **aparece una
gestión que él no hizo** en su «Cierre del día», con evidencia y motivo ajenos.

- **(a)** Nada: desaparece, y el rastro es la fila de su cierre del día.
- **(b)** (a) **más** que la fila del cierre diga que la gestionó la tienda (R41).
- **(c)** Un cuarto grupo en su portal, «Resueltas por la tienda».

**Recomendación: (b).** (i) Sin el rótulo, el mensajero ve una gestión suya que no recuerda y **puede
deshacerla por error** —o preguntarse por qué no puede, si D3 se firma como se recomienda—. (ii) El
paquete **sigue en su moto** y tiene que volver a bodega: si no sabe por qué esa orden cambió, el
paquete es lo primero que se pierde. (iii) (c) es un grupo que nace vacío casi siempre y que hay que
mantener en tres superficies del portal; el sitio donde el mensajero ya mira al final del día es su
cierre.

**Qué se rompe con (a):** el mensajero no puede distinguir sus gestiones de las de la tienda en la
única pantalla donde las dos aparecen juntas. **Qué cuesta (b):** la fila del detalle del cierre tiene
que saber la familia de origen de su gestión — una lectura más, del mismo molde que ya usa el criterio
de intento.

---

### D7 · Los textos de la pantalla. [FIRMA]

| Qué | Recomendación | Alternativa |
| --- | --- | --- |
| Rótulo del botón de reprogramar | **«Reprogramar»** | «Reprogramar entrega» |
| Rótulo del botón de rechazar | **«Rechazar»** | «Rechazar entrega» |
| Título de la ventana | **«Resolver la orden por tu cuenta»** | «Gestionar la orden» |
| Aviso fijo de la ventana | **«Esto cuenta como una gestión del mensajero: entra en su cierre del día, suma un intento de entrega y mueve el dinero igual. Por eso pide foto y motivo.»** | *(sin aviso)* |
| Campo de evidencia | **«Fotos de evidencia»** (el mismo de la 158) | «Comprobante» |
| Confirmación | **«La orden quedó reprogramada / rechazada.»** | «Listo» |
| Carrera perdida | **«Esta orden ya no está esperando tu respuesta.»** | «No se pudo gestionar» |

**Por qué el aviso fijo, que es lo único no obvio:** la tienda está a punto de **cobrarse a sí misma**
un rechazo y de gastar un intento de la orden, desde una pantalla donde hasta ayer sólo podía llamar y
escribir. En este repo el motivo de un bloqueo o de una exigencia **se dice con palabras** (238/R27), y
aquí lo que hay que decir es el precio. **Y no se usa el verbo «gestionar» en el rótulo del botón**:
236/D6 lo firmó como **verbo del mensajero**; aquí describe el efecto, en el aviso, no la acción.

**Qué se rompe sin el aviso:** la tienda descubre el cobro en su billetera dos días después, y la
primera reclamación es «yo sólo apreté un botón».

---

### D8 · El tope del motivo. [FIRMA ligera]

`motivoSchema` (el del mensajero) es `z.string().trim().min(1)` — **sin máximo**. La 235 dejó escrita
la lección contraria para la nota de ayuda: tope revalidado en el borde, no sólo en la interfaz.

- **(a)** Reutilizar `motivoSchema` tal cual (paridad con el mensajero) y **declarar** la ausencia de
  tope como deuda heredada y compartida.
- **(b)** Poner un tope sólo en esta vía.

**Recomendación: (a).** (b) crea una divergencia entre dos caminos que la ficha promete idénticos, y
deja el agujero abierto justo donde ya estaba. La ausencia de tope es un problema **de la gestión
entera**, no de esta ficha; cerrarlo aquí a medias es peor que nombrarlo.

**Qué se rompe con (b):** dos reglas para el mismo campo, y la del mensajero —la que más se usa— sigue
sin tope.

---

## Mediciones pendientes que BLOQUEAN la firma (detalle y SQL en `tasks.md` T0)

1. **T0.2 — ¿es teórica la ruta exenta de D1?** Población actual de `cierre_dia` por estado y cuántos
   cierres pasaron por `rechazado → solicitado`. **Si `vencido`/`rechazado` es una población habitual,
   D1 deja de ser un caso de borde.**
2. **T0.3 — ¿cuánto dinero mueve un rechazo?** Rango de `tarifa_zona_mensajero.cobro_rechazado`. Es el
   importe que la tienda se cobra a sí misma con un click.
3. **T0.4 — ¿cuánto se deshace hoy?** Gestiones anuladas sobre el total. Dimensiona D3.
4. **T0.1 — re-medir la población en ayuda** (la foto del 2026-08-19 caduca).

**No se firma D1 ni D3 sin los números delante.** Si un dato no está en `docs/`, `specs/` o el código,
es desconocido.

---

## PUERTA HUMANA PASADA — 2026-08-20

Las ocho decisiones quedan resueltas. **Tres las firmó el humano** (D2, D3, D6 — las que movían
contrato, tocaban otra feature o cambiaban lo que ve un tercero); las cinco restantes las firma el
**leader con la recomendación del spec**. Se dice cuál es cuál.

**Las cuatro mediciones de T0 están hechas** y viven en `progress/impl_237.md`. ⚠️ Se corrieron
**después** de llevar D2/D3/D6 a firma, cuando este spec pedía lo contrario. **Ninguna contradice
las tres firmas, y la de D3 la refuerza.** Queda escrito por si un número cambia.

### Firmadas por el humano

- **D3 — el mensajero NO puede deshacer la gestión de la tienda.** Hoy sí puede: la gestión nace con
  `mensajero_id` = él, así que pasa las ocho guardias, la orden vuelve a `en_reparto` reasignada a él
  —no a `ayuda_tienda`— y **la tienda no se entera**, porque la fila ya no está en ninguna de sus
  pestañas. Con ella se van el intento contado y el cobro.
  **Y los números lo convierten de precaución en necesidad:** «deshacer» **se usa —7 de 57
  gestiones, un 12 %—** y un rechazo mueve **hasta ₡1.000** (media 400). O sea: pasaría de verdad, y
  cada vez borraría en silencio dinero que decidió otra persona.
- **D2 — se exige evidencia en imagen en LOS DOS desenlaces**, reprogramar y rechazar. La
  reprogramación del mensajero ya trae una **prueba de presencia** —la ubicación es obligatoria desde
  la 193— que la tienda **no puede aportar**. Sin imagen, la suya sería la única reprogramación sin
  ningún respaldo, y **cuenta como intento y mueve dinero igual**.
- **D6 — la orden desaparece del portal del mensajero, pero la fila de su cierre del día dice que la
  gestionó la tienda.** Si no, el mensajero **firma un cierre con una gestión que no hizo y una
  evidencia que no subió**, y no puede explicarla si le preguntan.

### Firmadas por el leader, con la recomendación del spec

- **D1 — se acepta que la gestión caiga en el cierre siguiente, y se PRUEBA (R32).** La invariante
  «una orden en ayuda bloquea el cierre» es **cierta al crear y falsa en las dos rutas de
  re-solicitud**, exentas por anti-deadlock (111/R9). Las otras tres opciones o rompen el snapshot
  congelado, o reabren el deadlock, o bloquean a la tienda por un estado del mensajero.
  **T0.2 lo respalda:** **0 cierres en `vencido` y 0 en `rechazado`** sobre 12 — la ruta exenta es un
  **caso de borde, no la normalidad**, así que no hace falta mitigación. Pero **es alcanzable** (235/R25
  deja pedir ayuda estando bloqueado), y por eso el test de R32 no es opcional.
- **D4 — el aviso «orden rechazada por el destinatario» NO se emite, y se afirma con test.** El texto
  sería **falso**: no lo rechazó el destinatario, lo rechazó la tienda. Hay además un hecho técnico
  que lo hace fácil de creer y difícil de notar: el emisor **filtra por `origen_tipo === "gestion"`**,
  así que con la familia nueva no saldría solo. Si el humano quiere un aviso, **hace falta texto
  propio** y es otra decisión.
- **D5 — la maquinaria de evidencias se EXTRAE a módulo** y se cablea desde la 237 y desde
  `MisAsignacionesService`. `IncidenteAdminService` —la segunda copia que **ya existe hoy**— queda
  como **deuda con dueño**, no se arrastra a una tercera.
- **D7 — rótulos «Reprogramar» / «Rechazar», y un aviso fijo que DIGA EL PRECIO**: que la gestión
  entra en el cierre del mensajero, suma un intento y mueve el dinero igual. Con **₡1.000** de tope
  medido, ese aviso no es cortesía.
- **D8 — se reutiliza `motivoSchema` tal cual**, y la ausencia de tope se declara **deuda heredada
  compartida** en vez de divergir sólo aquí. Un tope distinto en una superficie es una diferencia que
  nadie recuerda seis meses después.

### Lo que queda ABIERTO y no bloquea el código

**T0.1** — re-medir la población en ayuda **antes de desplegar**: hoy es 0 sobre 141 porque la 235
no está en producción. Esa foto **caduca**.
