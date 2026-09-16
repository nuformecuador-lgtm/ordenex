# Revisión — ficha 431 (cierres de satélite autónomos)

**Veredicto: RECHAZADA.** Tres bloqueantes, y **ninguno está en el código**: `tasks.md` sin marcar y
dos documentos de ayuda que ahora mienten. El código y su verificación no se pudieron romper — cinco
mutaciones del reviewer, **cuatro distintas de las del implementador**, y las cinco salieron rojas
donde tenían que salir.

Gate reproducido por el reviewer sobre `9f7747a5`: `INIT_EXIT=0`, 2010/2010 archivos, 29.360 tests,
26 saltados (`AnaliticaPage` 17 + `AnaliticaShell` 9, ninguno de base) y **279 archivos de
`integration/db` ejecutados, cero saltados**.

---

## Lo que el reviewer midió CONTRA LA BASE, no contra el archivo

- **`cierre_bodega_zona_solicitado_uq` NO EXISTE**: borrado de verdad, verificado por `pg_indexes`.
  Era el hallazgo que salvaba la ficha — de sobrevivir, la satélite podría asignar pero **no volver a
  consolidar**: el mismo freno mudado de sitio.
- Los dos `CHECK` con la expresión exacta del diseño, las cuatro columnas, la FK con `ON DELETE
  RESTRICT`, las dos migraciones aplicadas y los dos valores del enum.

## Las cinco mutaciones del reviewer

| # | Mutación | Resultado |
| --- | --- | --- |
| A | El saldo con `total_general` **en la tercera superficie** (`/cierres-admin`), que el implementador NO había mutado | **ROJA** |
| B | Anular el gate de NIVEL 1 | **ROJA** |
| C | `appendAccion(this.prisma)` **en `revertirConciliacion`** (solo se había mutado `marcarConciliado`) | **ROJA solo en la guardia estática** — 80 tests de integración verdes con la mutación puesta |
| D | Quitar `conciliadoAt: null` del `groupBy` de la cola | **ROJA** |
| E | Quitar el `throw` del todo-o-nada de `crearCierreBodega` | **ROJA** |
| F | *Sonda*: ¿el `$transaction` anidado abre SAVEPOINT real? | **SÍ** — sin eso, el «no queda fila» de R7 estaría midiendo otra cosa |

La C confirma en un **segundo** método la trampa ya conocida del repo: esa mutación **no la caza ningún
test de integración** —ahí `this.prisma` *es* el cliente de la transacción del test—, solo la guardia
del censo. Si alguien la retira «porque ya hay integración», el agujero vuelve entero.

## Lo verificado y correcto

**El saldo mide EFECTIVO en las tres superficies.** La fórmula vive en un solo sitio
(`conciliacion-satelite.saldoDe`) con **exactamente 5 llamadores, los 5 sobre `total_efectivo`**.

**El bloqueo fuera y el gate de nivel 1 dentro**, sin confundirse: `bloqueada: false` anclado con un
barrido de 12 combinaciones más anti-vacuidad, y el gate de nivel 1 con un comentario que dice «NO SE
CONFUNDA CON EL QUE LA 431 RETIRA».

**Las siete guardias tocadas: todas aportando el dato, ninguna aflojada.** La de vocabulario **gana
tres casos y no pierde ninguno**, con autocomprobación, canario y contraprueba.

**Ningún test tautológico** entre los 12 archivos nuevos. Los fixtures no importan `saldoDe` para
calcular lo que después afirman.

---

## BLOQUEANTES

**B1 · `tasks.md`: 0 de 30 tareas marcadas.** Y no se arregla marcándolas todas: **T25 y T26(a)-(d) no
están hechas**, y marcarlas sería mentir. El arreglo honesto es marcar las 27 hechas y convertir el
resto en puerta de despliegue explícita. *El `tasks.md` vacío estaba diciendo la verdad por accidente.*

**B2 · `docs/ayuda/satelite/en-bodega.md` dice hoy lo contrario de lo que hace el sistema.** Su párrafo
«La app no te deja asignar… tenés un cierre de bodega pendiente» describe **exactamente el control que
esta ficha quita**, y sus `fuentes` nombran los dos archivos que la ficha cambió. El `README.md` de la
carpeta lo escribe como regla: *«si tocás una pantalla y no tocás su documento, el documento empieza a
mentir»* — y **el asistente solo responde sobre esta carpeta**, así que la respuesta sería falsa.

**B3 · `/wallet/satelites` no tiene documento de ayuda.** Sus tres hermanas sí. Una pantalla nueva de
dinero, con una nota conceptual delicada, sin una línea de ayuda.

---

## PUERTA DE DESPLIEGUE — medido contra producción el 2026-09-16

El reviewer levantó dos riesgos de release. **Los dos medidos por el leader, en solo lectura:**

```sql
select count(*), count(*) filter (where estado='aprobado'),
       count(*) filter (where estado='aprobado' and resuelto_por is null),
       max(updated_at) from cierre_bodega;
```

| | |
| --- | --- |
| Cierres de bodega | **35** |
| Aprobadas | **34** |
| **Aprobadas con `resuelto_por` NULL** | **0** |
| `max(updated_at)` | **`2026-09-16 20:57:20.759`** |
| `max(resuelto_at)` | `2026-09-16 17:10:15.51` |

**REL-2 despejado.** `cierre_bodega_resuelto_por_fkey` es `ON DELETE SET NULL`, así que una fila cuyo
aprobador hubiera sido borrado tendría `resuelto_por` NULL — y el `CHECK` de coherencia la habría hecho
abortar **a mitad del despliegue de producción**. Hay **cero**. La migración no va a abortar por esto.

> **Corrección al `design.md §1.1`:** afirma que `conciliado_por` lleva `ON DELETE RESTRICT` «igual que
> sus hermanas». `solicitado_por` sí; **`resuelto_por` NO, es `SET NULL`**. La elección del código es la
> correcta; la frase del diseño es la que hacía invisible este riesgo.

**REL-1: la referencia CADUCA, y ese es el hallazgo.** Ayer eran 32 cierres; hoy son 35. **Producción
sigue operando**, así que el número de T0 no sirve para T25 si pasa un día. La referencia hay que
capturarla **inmediatamente antes de desplegar**, no ahora — y con `max(updated_at)` delante, para
poder probar después que el backfill no tocó nada más.

**REL-3 · T26 (a)-(d) con datos, en preview.** Es la condición del humano. `cierre_bodega` está vacía
en local y sembrar la cadena entera en una base compartida pondría rojo el gate de otro agente. Los
cuatro pasos tienen medición propia en su capa —las de dinero contra Postgres real—; lo que falta es la
corrida compuesta en el navegador.

---

## Menores

1. `docs/ayuda/oficina/cierres.md` quedó rancio: su sección «Aprobar o rechazar» ya no describe la
   mitad de bodega, y no menciona la marca ni `/wallet/satelites`.
2. **`rechazarCierreBodega` sigue ejecutable y sin pantalla**, y una consolidación `rechazado`
   **desaparece de `/wallet/satelites`**: un camino vivo que puede sacar un bulto de efectivo de la
   pantalla de conciliación. Su hermana `aprobar` ya es imposible de escribir (el `CHECK` la rechaza);
   esta no. Cero usos en producción.
3. Una `rechazado` se lee «Pendiente de conciliar» **y a la vez imprime su motivo de rechazo**: dos
   afirmaciones contradictorias sobre la misma fila. 0 filas en producción.
4. **El `design.md` no se actualizó tras la decisión Q2**: §1.4, §2.1 y §6.2 siguen diciendo
   `total_general`. El código hace lo correcto; el spec en disco contradice la implementación.
5. El mapa R→test del frontend es inexacto en R22 (se cumple, pero por otras dos vías).
6. `MarcarRecibidoDialog` precarga el monto con el efectivo declarado: la conciliación normal es un
   clic. Justificado y medido, pero conviene saberlo.
7. `estado='vencido'` en un `cierre_bodega` contaría íntegro y **no se podría marcar nunca**. Hoy nada
   lo escribe en esa tabla; quedó sin declarar como límite.
