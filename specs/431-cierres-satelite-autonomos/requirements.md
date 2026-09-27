# Ficha 431 — la satélite cierra sola; la aprobación pasa a marca de conciliación

**Zona:** fullstack. **SDD:** sí. **Rama:** `feat/431-cierres-satelite-autonomos`.
**Lleva migración** (dos valores nuevos de `historial_accion_tipo`, cuatro columnas en `cierre_bodega`,
un backfill de datos, dos `CHECK` y el borrado de un índice único), así que **se implementa SOLA** y
**el gate rápido se niega**: el veredicto sale de `./init.sh` completo.

**Es el PUNTO 1 de SF-001.** El diseño acordado y verificado contra el código vive en
`progress/design_sf001_p1_cierres_satelite.md`. Este documento **lo da por cierto y no lo
re-verifica**.

---

## Lo que ya está decidido y firmado (no se reabre)

| # | Decisión del humano (2026-09-15) |
| --- | --- |
| D1 | **La consolidación se QUEDA.** Es el bulto de efectivo que viaja de la satélite a la central y lo único sobre lo que tiene sentido colgar «esto llegó». Lo que cambia es que **deja de ser puerta**. |
| D2 | **La aprobación se transforma en marca de conciliación, no se elimina.** El mismo botón, sin poder de freno: `solicitado` se lee **«Pendiente de conciliar»**, `aprobado` se lee **«Recibido»**, y `rechazado` **se retira de la pantalla y se deja en la base** (cero usos en producción en dos semanas). |
| D3 | **El enum `cierre_estado` NO se toca.** Restricción dura: lo comparten `cierre_dia` y `cierre_bodega`. La marca va en columnas propias. |
| D4 | **El bloqueo se quita en UN solo sitio:** `existeBodegaSateliteBloqueada` deja de devolver `bloqueada` por esa causa. La bandera `porCierreBodega` **se conserva como aviso**, igual que ya se hace con `porMensajeros`. El patrón ya existe. |
| D5 | **Saldo DERIVADO, no ledger nuevo:** suma de `total_general` de las consolidaciones sin conciliar. La marca lleva el **monto recibido**; si llegan ₡485.000 de ₡500.000, la diferencia queda visible como saldo de esa satélite. |
| D6 | **La marca es REVERSIBLE.** No toca el ledger, así que revertirla es segura, y sin eso un «recibido» por error no tiene vuelta atrás. Deja rastro de quién marcó y quién deshizo. |
| D7 | **Submódulo nuevo `/wallet/satelites`**, con el patrón de los dos que ya existen: tabla de saldos → desglose → acciones. **Es alcance añadido sobre el documento firmado**, dicho en voz alta aquí y en el diseño. |
| D8 | **La pantalla nueva pasa por `/design`** antes de implementarse. Aquí se especifica QUÉ hace, no cómo se ve. |
| D9 | **No sale a producción** sin estar seguros de que no daña lo que ya funciona (condición del humano para las cuatro fichas de SF-001). |

## El control que desaparece, y qué lo sustituye

Esta ficha **toca dinero y quita un control**. El documento firmado ya aprobó que el control pase de
preventivo a de seguimiento, pero el efecto concreto hay que decirlo con todas las letras:

> Hoy, la **única** señal que obliga a una satélite a cuadrar antes de seguir trabajando es que, con su
> consolidación pendiente, **no puede asignar ni una orden más**. Esa señal desaparece. Nadie la
> sustituye por otra que frene.

Lo que queda en su lugar, y por eso está en los requisitos y no solo en la prosa:

1. **El control de nivel 1 NO se toca (R5).** Una satélite sigue sin poder consolidar mientras tenga
   cierres del día de sus mensajeros sin resolver. Ese sí es un cuadre, y sigue siendo puerta.
2. **Visibilidad para la satélite (R2, R26).** El aviso deja de decir «no puedes asignar» y pasa a
   decir «tenés N consolidaciones que la central todavía no marcó como recibidas», y la satélite ve
   el estado de cada una de las suyas.
3. **Visibilidad para la central (R17, R21, R23).** El saldo sin conciliar por bodega y **la
   antigüedad de la consolidación más vieja sin marcar**: el número que hoy no existe en ninguna
   pantalla y que es lo que permite perseguir el dinero.
4. **Rastro imborrable (R13).** Marcar y desmarcar quedan en el registro de acciones con su monto.

## Lo que esta ficha NO hace (límites declarados)

1. **No mueve ni un colón.** Marcar «Recibido» y revertirlo **no escriben en ningún libro**
   (`wallet_movimiento`, `wallet_tienda_movimiento`, `pago_mensajero_movimiento`). La marca es
   seguimiento, no contabilidad (R14).
2. **No crea un ledger de satélites.** El saldo es derivado (D5, R19). Si las diferencias resultan
   ser el pan de cada día, el ledger se añade después sin rehacer las pantallas.
3. **No toca el enum `cierre_estado`** (D3), ni el nivel 1 (`cierre_dia`), ni los totales snapshot,
   ni las cascadas de dinero de la ficha 393/396.
4. **No borra el camino de «aprobar/rechazar» del servidor.** Se retira de la pantalla y se vuelve
   **imposible de escribir** contra la base (R15/R16), pero su código no se arranca en esta ficha:
   arrancarlo exigiría quitar dos valores de un enum cerrado y su entrada del censo de historial, lo
   que es mucho riesgo por cero beneficio. Ver Q4.
5. **No cambia quién puede marcar** respecto de quién aprueba hoy (`maestro` **o** `admin`). Ver Q3.
6. **No notifica nada a nadie.** Ni a la satélite cuando la central marca, ni a la central cuando una
   consolidación envejece. No hay correo, ni WhatsApp, ni push (ver Q6/Q7).
7. **No concilia contra el banco.** El sistema no comprueba que el dinero llegó a ninguna cuenta: lo
   afirma una persona con un monto en la mano.
8. **No hay E2E.** Este repo no tiene arnés E2E vivo; la verificación es unitaria, de integración
   contra Postgres real, guardias estáticas y medición en producción (ver `tasks.md`).
9. **No rediseña la consolidación.** Sigue habiendo un acto explícito de la satélite que crea la
   consolidación: es el momento en que el bulto de efectivo sale (ver `design.md §1.3`).

---

## Requisitos (EARS) — 30

### A — La satélite cierra sola

**R1** — MIENTRAS una bodega satélite tenga una o más consolidaciones pendientes de conciliar, el
sistema DEBE permitirle asignar órdenes a sus mensajeros.

**R2** — MIENTRAS una bodega satélite tenga una o más consolidaciones pendientes de conciliar, el
sistema DEBE informárselo a quien la administra como **aviso**, indicando cuántas son, y DEBE dejar
todas las acciones de esa pantalla habilitadas.

**R3** — El sistema DEBE seguir distinguiendo las dos causas —cierres de sus mensajeros y
consolidación pendiente de conciliar— en la información que entrega al borde, de forma que el aviso
pueda nombrar cada una por separado.

**R4** — El sistema NO DEBE impedir la asignación de órdenes de una bodega satélite por ninguna causa
derivada de un cierre, ni de sus mensajeros ni propio.

**R5** — MIENTRAS una bodega satélite tenga cierres del día de sus mensajeros sin resolver, el
sistema DEBE impedirle crear una consolidación nueva, con el mismo motivo accionable de hoy.

**R6** — CUANDO una bodega satélite tenga una o más consolidaciones pendientes de conciliar y
cierres del día aprobados sin consolidar, el sistema DEBE permitirle crear una consolidación nueva.

**R7** — CUANDO se cree una consolidación, el sistema DEBE vincular a ella **todos** los cierres del
día que la componen, o ninguno: nunca DEBE quedar una consolidación vacía ni una cuyos totales
snapshot describan más cierres de los que quedaron vinculados.

### B — La marca de conciliación

**R8** — El sistema DEBE registrar, por consolidación, si el dinero llegó, **cuándo** se marcó,
**quién** lo marcó, **cuánto** se recibió y una **nota** opcional.

**R9** — CUANDO una persona autorizada marque una consolidación como recibida indicando un monto, el
sistema DEBE guardar los cuatro datos de R8 en el mismo acto y DEBE pasar a presentar esa
consolidación como **«Recibido»**.

**R10** — SI el monto recibido está ausente, es negativo o tiene más de dos decimales, ENTONCES el
sistema DEBE rechazar la marca con un error accionable y NO DEBE escribir nada.

**R11** — CUANDO se intente marcar una consolidación que ya está marcada como recibida, el sistema
DEBE responder conflicto y NO DEBE escribir nada.

**R12** — CUANDO una persona autorizada revierta la marca de una consolidación, el sistema DEBE
devolverla a **«Pendiente de conciliar»** y DEBE borrar los cuatro datos de R8.

**R13** — CUANDO se marque una consolidación como recibida o se revierta esa marca, el sistema DEBE
dejar en el registro de acciones una fila con quién, cuándo, sobre qué consolidación y **con el
monto**, en el mismo acto atómico que la escritura.

**R14** — El sistema NO DEBE escribir en ningún libro de dinero al marcar ni al revertir.

**R15** — El sistema NO DEBE admitir, **por ningún camino** —aplicación, script o SQL a mano—, una
consolidación presentada como recibida sin los datos de la marca, ni datos de marca en una
consolidación que no está recibida.

**R16** — El sistema NO DEBE ofrecer en ninguna pantalla la acción de rechazar una consolidación ni el
estado «Rechazado»; las consolidaciones rechazadas históricas DEBEN permanecer en la base.

### C — El saldo, derivado

**R17** — El sistema DEBE derivar el saldo sin conciliar de cada bodega satélite como la suma, sobre
sus consolidaciones no rechazadas, del total consolidado menos el monto recibido.

**R18** — SI el monto recibido de una consolidación es menor que su total consolidado, ENTONCES el
sistema DEBE dejar la diferencia contando en el saldo de esa bodega aunque la consolidación ya esté
marcada como recibida.

**R19** — El sistema NO DEBE guardar el saldo de una bodega satélite en ninguna columna ni tabla: se
deriva en cada lectura.

**R20** — El sistema DEBE entregar todo importe de esta funcionalidad ya cuadrado desde el servidor, y
la pantalla NO DEBE hacer ninguna operación aritmética con dinero.

**R21** — El sistema DEBE indicar, por bodega satélite, cuántas consolidaciones están sin conciliar y
**cuántos días** lleva sin marcar la más antigua de ellas.

**R22** — El sistema DEBE mostrar, por consolidación, cómo se compone su total entre efectivo, SINPE y
transferencia.

### D — Las pantallas

**R23** — DONDE el usuario tenga acceso total, el sistema DEBE ofrecer una vista con el saldo sin
conciliar de todas las bodegas satélite.

**R24** — CUANDO se elija una bodega satélite en esa vista, el sistema DEBE listar sus consolidaciones
con su fecha, su total, su monto recibido, la diferencia y el estado de la marca.

**R25** — DONDE el usuario tenga acceso total, el sistema DEBE permitir marcar como recibida y
revertir la marca desde esa vista.

**R26** — DONDE el usuario administre una bodega satélite, el sistema DEBE mostrarle el estado de
conciliación de las consolidaciones de SU bodega, y NO DEBE permitirle marcarlas ni revertirlas.

**R27** — SI el usuario no tiene acceso total, ENTONCES el sistema NO DEBE entregarle la vista de
saldos de satélites ni atender sus intentos de marcar o revertir.

**R28** — El sistema DEBE nombrar el estado de una consolidación con el vocabulario aprobado
—«Pendiente de conciliar» y «Recibido»— en **todas** las superficies del cierre de bodega, y NO DEBE
volver a usar en ellas el vocabulario de aprobación.

**R29** — El sistema DEBE permitir descargar el conjunto completo filtrado de cada uno de los dos
listados nuevos, con el mismo alcance que la pantalla.

### E — Los datos que ya existen

**R30** — CUANDO se aplique la migración, el sistema DEBE dejar cada consolidación aprobada antes de
esta ficha como recibida por su importe total, con la fecha y la persona de su aprobación original, y
NO DEBE modificar ningún otro dato de esas filas.

---

## Trazabilidad

El mapa `R<n>` → test concreto lo escribe el implementer en `progress/impl_431.md`. `tasks.md` ya
nombra, para cada requisito, el archivo de test donde debe caer y el tipo de prueba (unitaria,
integración contra Postgres, guardia estática o medición en producción). Los requisitos que **no**
se pueden probar con dobles están marcados allí: R7, R15, R17, R18 y R30 se verifican **contra
Postgres real**, porque viven en el `WHERE`, en un `CHECK` o en una migración, y un doble los daría
siempre por buenos.

---

## Preguntas abiertas

**Q1 — Los 32 cierres históricos: ¿se dan por recibidos?**
Propuesta del spec (R30): **sí**, con la fecha y la persona de su aprobación original. Consecuencia
medida de cada opción, con los números del 2026-09-15:
- Darlos por recibidos → la pantalla arranca el primer día en **₡0** y todo lo que aparezca después
  es real.
- Dejarlos sin conciliar → arranca enseñando **₡4.196.897** de deuda de 5 satélites, y el equipo
  empezaría cerrando 32 filas a mano, cada una registrando un «recibido por Fulano hoy» que es falso.
Lo que la propuesta **afirma sin haberlo medido** es que ese dinero llegó: la aprobación de nivel 2
nunca registró la llegada física. Se pide confirmación explícita del humano por ser una afirmación
sobre dinero.

**Q2 — El saldo se deriva de `total_general`, que incluye SINPE y transferencia.**
D5 fija `total_general`. El dato del esquema es que `total_general = efectivo + SINPE +
transferencia`, y **SINPE y transferencia no viajan en el bulto**: ya están en una cuenta. Con D5 tal
cual, el «saldo sin conciliar» mide algo más grande que el efectivo que físicamente falta por llegar.
El spec **mantiene D5** y lo compensa con R22 (la composición visible por consolidación). ¿Se
confirma D5, o el saldo debe medir solo `total_efectivo`?

**Q3 — ¿Quién marca?**
Hoy aprueba `esAccesoTotal` = `maestro` **o** `admin`; el documento firmado dice «el maestro». El
spec mantiene lo que hace el código (R25) para no cambiar permisos en una ficha de dinero. ¿Se
confirma, o la marca es solo del `maestro`?

**Q4 — El camino viejo de aprobar/rechazar.**
Queda en el árbol, fuera de toda pantalla y **imposible de escribir** por el `CHECK` de R15. ¿Se
retira su código en una ficha posterior, o se deja indefinidamente como está?

**Q5 — El vocabulario exacto.**
El spec propone «Pendiente de conciliar», «Recibido», «Monto recibido», «Falta por recibir» y «Sin
conciliar». La guardia de vocabulario ancla estos literales **a mano** (ver `design.md §7`), así que
cambiarlos después cuesta un cambio visible y a propósito. ¿Se aprueban tal cual?

**Q6 — ¿Hay un umbral de antigüedad?**
R21 entrega los días de la consolidación más vieja sin marcar, y nada más: no hay color, ni alerta,
ni bloqueo. Si el humano quiere un umbral («a los N días esto es un problema»), hace falta el número:
el spec no se lo inventa.

**Q7 — ¿La satélite se entera de que la marcaron?**
Hoy no se entera de nada: lo ve si entra a su pantalla (R26). ¿Se quiere aviso cuando la central marca
«Recibido», o cuando marca por un monto **menor** al consolidado? Eso último es el caso en que la
satélite necesita reaccionar y hoy nadie se lo cuenta.

---

## Decisiones del leader sobre las preguntas abiertas (2026-09-16)

### Q2 — EL SALDO MIDE **EFECTIVO**, no `total_general`. Medido.

La pregunta era buena y **cambia el diseño**. Medido contra producción:

| | Importe | % |
| --- | --- | --- |
| `total_general` | ₡ 4.196.897 | 100 % |
| **`total_efectivo`** | **₡ 3.091.107** | **73,7 %** |
| `total_simpe` | ₡ 1.105.790 | 26,3 % |
| `total_transferencia` | ₡ 0 | 0 % |

**Una cuarta parte del consolidado no viaja en el bulto.** El SINPE llega directo a una cuenta. Si el
saldo usara `total_general`, la pantalla enseñaría ₡1,1 M de deuda fantasma que nadie va a entregar
nunca en mano.

**El saldo pendiente = Σ(`total_efectivo` − lo recibido).** El `total_general` sigue mostrándose como
contexto —es lo que la bodega recaudó— pero **no es lo que está pendiente de llegar**.

> **Consecuencia que hay que saber, y que NO resuelve esta ficha.** Cuando la 429 se despliegue y cada
> bodega ponga su propio SINPE, **el SINPE que recaude una satélite dejará de llegar a la central**:
> entrará a la cuenta de la bodega. Eso crea un pendiente nuevo que este diseño no cubre, porque no
> viaja en el bulto ni está en `total_efectivo`. **Queda declarado como límite**; si el negocio lo
> quiere conciliar también, es otra ficha.

### Q1 — Los 32 históricos SE DAN POR RECIBIDOS

`conciliado_at = resuelto_at`, con **nota visible de conciliación retroactiva** para que se distinga de
una conciliación real. El saldo arranca en ₡0 en vez de ₡3.091.107 de efectivo.

**Por qué:** esos 32 se aprobaron en dos semanas de operación normal, con cero rechazos, y el dinero
fluyó. Marcarlos como pendientes enseñaría el primer día una deuda que nadie reconoce, y la pantalla
nacería desacreditada. La nota deja claro que no se verificaron uno a uno.

### Q3 — Marcan y revierten `esAccesoTotal` (maestro **y** admin)

Es exactamente quien aprueba hoy. Estrechar a `maestro` devolvería la dependencia de una sola persona,
que es parte de lo que esta ficha viene a quitar.

### Q4 — Sí se retira el código muerto, pero **el estado se queda en la base**

Se retiran de la interfaz el camino de aprobar/rechazar y la causa `bodega_bloqueada`. **El enum y los
valores no se tocan** —restricción dura, lo comparten los dos niveles— y el histórico sigue legible.

### Q6 — SIN umbral de antigüedad

Se enseña **cuánto lleva** la consolidación más vieja sin conciliar, y nada más. Un umbral que dispare
algo es el bloqueo volviendo por la puerta de atrás, y esta ficha existe para quitarlo. La presión es
visibilidad, no freno.

### Q7 — SÍ, la satélite se entera cuando la marcan por menos

Si la central recibe ₡485.000 de ₡500.000 declarados, **la bodega tiene que verlo en su pantalla**. Es
la mitad que falta de un control de seguimiento: sin eso, la diferencia la descubre la satélite cuando
alguien se la reclama semanas después. No hace falta notificación: basta con que la diferencia esté a la
vista donde ella ya mira.

### Q5 — Vocabulario, ya decidido en el `/design` aprobado

`solicitado` → **«Pendiente de conciliar»** · `aprobado` → **«Recibido»** · una consolidación con
diferencia → **«Recibido incompleto»** · `rechazado` se retira de la pantalla.

---

## Sobre el hallazgo nº 3 del spec: el índice único parcial

**Es el hallazgo que salva la ficha.** `cierre_bodega_zona_solicitado_uq` —una `solicitado` por zona—
sería **el mismo bloqueo mudado de sitio**: la satélite podría asignar, pero no volvería a consolidar
hasta que la central marcase. Se habría entregado una ficha que quita un freno y deja otro equivalente
detrás.

Se acepta la propuesta: el índice se borra y lo que protegía —que dos consolidaciones no se repartan el
mismo conjunto— pasa a un todo-o-nada dentro de la transacción de `crearCierreBodega`.

**Y el gate de nivel 1 se conserva**: si un mensajero tiene cierres sin resolver, eso sigue frenando.
Ese es el control de cuadre que sobrevive, y hay que anclarlo con test para que nadie lo confunda con el
que se está retirando.
