# Decisión ⟨D11⟩ — `estadoProduccion` de `incidentes` y `sin_gestionar` (feature 175)

**Fecha: 2026-08-03 · Autor: humano · Estado: CERRADA.**

## Por qué esta decisión tiene que existir

La cabecera de `lib/analytics/metrics.ts:5-7` fija una regla sobre su propio contenido:

> El contenido NO es opinion del implementer: es `design.md §3.3`, aprobado ENTERO por
> el humano el 2026-07-30 (D1 «todas») = **15 ids operativos + 8 financieros = 23**.
> Anadir o quitar una metrica exige una decision humana nueva y fechada.

La 175 no añade ni quita métricas, pero **sí cambia el `estadoProduccion` de dos de ellas**, y
ese campo decide qué paneles pinta la 133. Cambiarlo sin ratificación humana sería exactamente
lo que esa línea prohíbe: que el catálogo pase a reflejar la opinión de quien implementa. El
precedente de forma es ⟨D10⟩ (`progress/decision_C2_127.md`).

## Lo decidido

**Q1 — `incidentes`: `declarada` → `producida`. RATIFICADO.**

El motivo es objetivo, no de criterio: la métrica **tiene columna real** en `analytics_daily`
(`db/schema.prisma:1891`) y es el **cuarto término de `DENOMINADOR_GESTIONES`**, o sea que ya
participa en las tres tasas que se sirven hoy. `metrics.ts:220` la marcaba `declarada`, que
significa «sin productor». La consecuencia de dejarlo así **no es cosmética**: la 133 elige
paneles leyendo ese campo, así que ocultaría un panel que sí tiene datos.

**Q2 — `sin_gestionar`: `declarada` → `producida`. RATIFICADO.**

La ficha 175 solo pedía `incidentes`, pero es **el mismo defecto**: la 126 sirve `sin_gestionar`
derivándola del embudo (`AnaliticaOperativaService.ts:88,316-318,348-362`). Dejarla `declarada`
obligaría a la 133 a conocer una excepción que no está escrita en ninguna parte — la peor clase
de regla, la que solo vive en la cabeza de quien la descubrió.

**Consecuencia aceptada, medida antes de decidir:** tras los dos cambios el catálogo se queda
**sin ninguna** métrica `declarada`, y `tests/unit/analytics/metrics.test.ts:273`
(`toBeGreaterThan(0)`) se pone rojo. **No se relaja el guard**: el caso se reexpresa sobre un
catálogo sintético (R4), porque lo que ese test protege es que el filtro *particione*, no que
existan métricas sin productor. Un catálogo enteramente producido es el estado bueno, no un
fallo.

## Alcance de esta decisión — lo que NO autoriza

- **No autoriza añadir ni quitar métricas.** Los 23 ids de ⟨D1⟩ siguen intactos.
- **No autoriza cambiar ninguna cifra.** Verificado antes de decidir: hoy nadie en producción
  lee `estadoProduccion` ni la definición de estados operativa, así que esto alinea el contrato
  con lo que ya se sirve, sin mover un número de pantalla.
- **No es una autorización general sobre `estadoProduccion`.** Cualquier cambio futuro de ese
  campo necesita su propia decisión fechada, y R14 lo exige por test.

## Las otras cinco preguntas de la puerta

Q3 a Q7 **no bloqueaban** y se cierran **con la recomendación escrita en el spec**, ratificadas
en el mismo acto: campos opcionales `universo`/`derivadaDe` en `DefinicionMetrica`; sus nombres
y dominios; la cuarta divergencia (el literal «19 values» cuando el seed tiene 20 desde la 157)
entra en esta feature por vivir dentro del mismo string que ya se reescribe; y el título mentiroso
de `definiciones-catalogo.guardia.test.ts:60-62` se corrige en el mismo PR.

**Q4 — coordinación con la 131.** `tests/unit/analytics/tablero-catalogo-paneles.test.ts:43-44`
afirma literalmente que estas dos métricas son `declarada`, así que esta feature lo pone **rojo
por diseño**. Lo actualiza la **175 en su propio PR**, y **reexpresándolo**: el caso debe seguir
matando la mutación del `filter(estadoProduccion === "producida")` **sin afirmar el valor concreto
del campo**, que es el espíritu de R21 de la 131. Hay que avisar a la sesión de la 131 antes de
mergear.
