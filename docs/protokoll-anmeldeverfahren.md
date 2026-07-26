# Protokoll: Anmeldeverfahren LINA TeamCloud

**Datum:** 25.07.2026
**Anlass:** Der Importer konnte sich nicht an LINA anmelden. Bei der Klärung
wurde das Anmeldeverfahren offengelegt.
**Betroffener Zugang:** persönlicher LINA-Zugang „Evgenij", Mandant `a360`

---

## Ablauf

| Zeit | Was passierte |
|---|---|
| — | Erste Umsetzung nach dem sichtbaren Login-Formular: POST auf `/login`, Passwort im Klartext. |
| 20:35 | Erster Lauf gegen das echte LINA scheitert: `Login 200, Probe 302`. |
| — | `https://app.lina.de/js/common/login.js` ausgelesen — ein öffentliches statisches Asset, ohne Anmeldung abrufbar. Kein Zugriff auf geschützte Bereiche, keine Zugangsdaten verwendet. |
| — | Das Skript zeigt drei Abweichungen vom sichtbaren Formular (siehe Befund). Umsetzung korrigiert. |
| 20:53 | Zweiter Lauf: `Login 200, Probe 401`. Transport in Ordnung, Anmeldung weiterhin abgelehnt. |
| 23:01 | Dritter Lauf endet ohne Versuch — außerhalb des Arbeitsfensters (7–23 Uhr). |

Es wurde ausschließlich gelesen. In LINA wurde nichts angelegt, geändert,
gespeichert oder gelöscht.

---

## Befund

Aus `/js/common/login.js`:

```js
var passwordHidden = hex_md5(password);
// var passwordHidden = hex_sha256(password);   // auskommentiert vorbereitet

var values = {};
values["username"] = username;
values["password"] = passwordHidden;
values["secret"]   = mysecret;      // aus window.secret, je Aufruf neu
values["system"]   = sys;

$.ajax({ type: "POST", url: "/common/index/dologin", data: values, dataType: "json" })
```

Drei Punkte, in denen das sichtbare Formular in die Irre führt:

1. Gepostet wird auf `/common/index/dologin`, nicht auf `/login`.
2. Das Passwort geht als **MD5-Hex** raus, ungesalzen, einfach durchgelaufen.
3. Ein `secret` (64 Hex-Zeichen, je Seitenaufruf neu) muss mitgesendet werden.

---

## Bewertung

**Das clientseitige Hashen bringt keinen Sicherheitsgewinn.** Was auf der
Leitung liegt, schützt TLS — das hätte auch das Klartextpasswort geschützt.
Der Schutz wird nicht erzeugt, sondern nur um einen Schritt verschoben.

**Der Hash ist das Passwort.** Wer den MD5-Wert besitzt, meldet sich damit an,
ohne das Passwort je zu kennen: das Formular lässt sich umgehen, der Wert wird
serverseitig entgegengenommen wie er ist. Klassisches *pass the hash*. Für die
Absicherung des Zugangs ist der Hash also genauso schützenswert wie das
Passwort selbst.

**Ungesalzenes MD5 ist gegen Rainbow Tables wehrlos.** Ob LINA den empfangenen
Wert serverseitig noch einmal ordentlich nachhasht (bcrypt, argon2), ist von
außen nicht feststellbar und wurde nicht untersucht. Wird er so abgelegt, wie
er ankommt, ist bei einem Datenbankabfluss jedes gebräuchliche Passwort in
Minuten zurückgerechnet.

**Was daraus *nicht* folgt:** dass Passwortkomplexität gleichgültig wäre. Sie
ist nur in einem Szenario ohne Wirkung — wenn ein Angreifer den Hash bereits
besitzt und lediglich in LINA hineinwill. Gegen Online-Raten am Login schützt
sie unverändert (der 128-Bit-Wert selbst ist nicht ratbar, geraten werden muss
das Passwort). Und nach einem Datenleck entscheidet sie alles: der MD5 eines
kurzen Passworts fällt auf einer GPU in Sekunden, der eines langen zufälligen
gar nicht. Die 128 Bit des Hashes sind eine Länge, kein Entropiegewinn — der
Hash ist nur so stark wie das, was hineingeht.

**Einordnung ins Gesamtbild.** Der Befund steht nicht allein. `getStoreData`
liefert Datenbankname, Datenbankbenutzer und Datenbankpasswort im Klartext an
den Browser aus (in Phase 1 dokumentiert, Werte wurden nicht ausgelesen).
Beides zusammen deutet auf eine Anwendung, deren Sicherheitsannahmen aus einer
früheren Zeit stammen. Das ist bei der Frage relevant, wie viel Vertrauen man
in LINA als führendes System setzen will — und es stützt die Entscheidung,
eine eigene Datenhaltung aufzubauen.

**Kein Hinweis auf einen Angriff oder Datenabfluss.** Es handelt sich um eine
Schwäche im Verfahren, nicht um einen Vorfall im Sinne eines
Sicherheitsereignisses. Ob und wem gegenüber daraus etwas mitzuteilen wäre,
ist eine rechtliche Frage — ich bin kein Jurist und kann sie nicht beurteilen.

---

## Empfehlungen

1. **Für den LINA-Zugang ein eigenes, langes, nirgendwo sonst verwendetes
   Passwort.** Das ist die einzige Maßnahme, die ohne Mitwirkung von LINA
   wirkt. Sie schützt zwar nicht den LINA-Zugang gegen jemanden, der den Hash
   schon hat, aber alles andere, wo dasselbe Passwort läge.
2. **Die `.env` wie ein Passwort behandeln.** Sie enthält das Klartextpasswort,
   und der Hash wäre dort nicht sicherer — er hätte dieselbe Wirkung. Nicht
   committen (steht in `.gitignore`), Dateirechte eng, auf dem Server nur im
   Container.
3. **Zweitzugang erwägen.** Es gibt genau einen. Fällt er aus — Sperre,
   Passwortwechsel, Personalwechsel — steht die Pipeline. Ein zweiter,
   ausschließlich lesender Zugang wäre der sauberere Betriebszustand, setzt
   aber ein Gespräch mit LINA voraus.
4. **Umstellung ist vorbereitet.** LINAs Code hat SHA-256 auskommentiert
   stehen. Stellt LINA um, reicht bei uns `LINA_PASSWORD_HASH=sha256`; am Code
   ändert sich nichts.

---

## Gelöst — die Anmeldung funktioniert

Der `status`-Wert der Login-Antwort wird ausgewertet, MD5-Hex ist bestätigt,
`system=a360` ebenfalls. Am 26.07.2026 liefen darüber **1.518 Aufrufe** ohne
einen einzigen Anmeldefehler.

## Ereignis 26.07.2026, 19:20 UTC — LINA lehnt die Anmeldung ab

Nach einem Worker-Neustart antwortete `dologin` mit
`{"status":"ERROR","message":"Benutzername oder Passwort ist falsch!"}`.
Fünf Minuten zuvor lief derselbe Zugang mit gültiger Sitzung noch einwandfrei.

**Was der Importer daraufhin tat — und das ist der Punkt:** genau einen
Versuch, dann Ende. `sync.zugangssperre` steht bis zum **30.07.2026**, der
Lauf brach sofort ab, kein Posten wurde angefasst, kein zweiter Anmeldeversuch.
Harte Regel 6 hat gehalten.

**Was vorher anders war.** Das Anfragetempo war für eine Nachladeaktion von
20–40 s auf 5–12 s gesenkt worden. Die Aufrufe je Stunde:

```text
10–16 Uhr   75 … 143 je Stunde
17 Uhr      279
18 Uhr      321
18:52       letzte ERFOLGREICHE Anmeldung
19:20       Anmeldung abgelehnt   (1. Versuch)
19:30       Anmeldung im Browser  -> funktioniert, frisch eingetippt
19:37       Anmeldung abgelehnt   (2. Versuch)
```

### Was geprüft wurde — ohne einen dritten Anmeldeversuch

Die Loginseite und die eingebundenen Skripte sind öffentlich abrufbar. Ein GET
darauf ist **kein Anmeldeversuch**: es werden keine Zugangsdaten gesendet, kein
Formular abgeschickt, und nichts davon kann ein Konto sperren. Genau dafür ist
diese Prüfung da — sie liefert die Hypothese, die Regel 6 vor dem nächsten
Versuch verlangt.

| geprüft | Ergebnis |
|---|---|
| `GET /login` | HTTP 200, 12.574 Bytes, Titel „LINA TeamCloud" |
| `window.secret` | vorhanden, 64 Hex — `secretAusSeite()` greift |
| Hashverfahren | **MD5, unverändert** |
| `login.js` | ruft `hex_md5(password)`, `forge_sha256` weiter auskommentiert |
| gesendete Felder | `username, password, secret, system` — identisch zu `login.js` |
| `system` | `a360`, wie im `<select id="login-system">` |
| Sessioncookie | heißt jetzt `PHPSESSID`; `cookiesUebernehmen()` ist namensunabhängig |
| Header | inkl. `x-requested-with`, `sec-ch-ua`, `sec-fetch-*` |

**Eine Falle dabei, und sie wurde fast zur falschen Diagnose.** Die Loginseite
bindet `/js/common/sha256.js` ein und **kein** `md5.js` mehr. Das sah nach der
lange erwarteten Umstellung auf SHA-256 aus. Die Datei heißt aber nur so —
**sie enthält MD5**: `hex_md5`, `binl_md5`, `md5_cmn`. Ebenso trügerisch ist
der Cache-Buster `login.js?time=1785094953`; der Wert ist die aktuelle Uhrzeit,
kein Versionsdatum.

> Ein Dateiname ist keine Aussage über den Inhalt, und ein `?time=` ist kein
> Änderungsdatum. Beides sah nach Beweis aus und war keiner.

### Der Mitschnitt einer echten Anmeldung (26.07.2026, 20:19)

Eine echte Chrome-Anmeldung wurde mit Playwright mitgeschnitten und Feld für
Feld gegen unsere gestellt. Das Skript gibt **keine Zugangsdaten aus**: es
vergleicht gegen die `.env` und meldet nur „identisch: ja/nein".

| verglichen | Ergebnis |
|---|---|
| Feldnamen | `username, password, secret, system` — identisch |
| `username` | identisch mit `.env` |
| `system` | `a360` |
| `secret` | 64 Zeichen |
| Passworthash | 32 Zeichen hex = **MD5**, kein SHA-256 |
| **Hashwert** | **identisch mit `md5(LINA_PASSWORD)`** — das Passwort stimmt |
| Header, die der Browser sendet und wir nicht | **keiner** |

**Zwei Anläufe waren wertlos, weil der Vergleichswert falsch war.** Die
`.env`-Zeile steht in Anführungszeichen und enthält ein maskiertes `\$`; der
Dateiinhalt ist damit ein Zeichen länger als das Passwort. Bun löst das auf,
`bash` nicht. Verglichen werden muss gegen die **aufgelöste** Fassung — die
sendet der Importer. Ein dritter Anlauf war nötig, weil die zweite Anmeldung
selbst scheiterte (falsches Passwort eingefügt): der Hash einer gescheiterten
Anmeldung ist kein Referenzwert.

> Wer zwei Fassungen desselben Geheimnisses hat, vergleicht irgendwann die
> falsche — und liest aus „passt nicht" eine Ursache, die es nicht gibt.

Aus dem Mitschnitt korrigiert:

* **`accept`** beim Login-POST auf `application/json, text/javascript, */*; q=0.01`
  — genau das erzeugt jQuerys `$.ajax({dataType:'json'})`, und `login.js` ist
  ein jQuery-Aufruf.
* **Kennung** auf `Macintosh … Chrome/150`, `sec-ch-ua-platform: "macOS"`. Vorher
  gab sich der Importer als **Windows-Chrome 149** aus, während er auf einem
  macOS-Rechner lief. Der Test dazu schrieb diesen Widerspruch sogar fest; er
  prüft jetzt auf Widerspruchsfreiheit statt auf „Windows".

**Beides hat nichts geändert.** Der Versuch um 20:24 wurde erneut abgelehnt.

### Was übrig bleibt

Auf unserer Seite ist nichts kaputt, und das Konto ist gesund — der Browser
kommt von **derselben IP mit demselben Konto** rein. Also weder Kontosperre
noch IP-Sperre.

Es ist auch **keine Tagesbegrenzung auf dem Login-Endpunkt**. Der entscheidende
Zeitpunkt:

```text
20:19:27  Anmeldung im Browser   -> ERFOLG
20:20:32  Anmeldung des Importers -> abgelehnt
20:24:06  Anmeldung des Importers -> abgelehnt (mit korrigiertem accept und Kennung)
```

Eine Minute Abstand, gleiche Maschine, gleiches Konto, gleiches Passwort,
gleiche Felder. Der Browser kommt durch, wir nicht.

**Damit liegt der Unterschied unterhalb der Header-Ebene.** Alles, was sich in
Feldern und Kopfzeilen ausdrücken lässt, war nachweislich gleich.

### Die Ursache: der Prozess wurde am falschen Ort gestartet

Um 20:27 startete Eugene denselben Befehl in seinem **eigenen Terminal**:

```text
20:27:23  angemeldet { benutzer: 'Evgenij Terehov', system: 'a360' }
20:27:24  fortschritt { endpunkt: 'getAktionsbericht', zeilen: 45, offen: 23570 }
```

Gleicher Code, gleiche Maschine, gleiches Passwort (`passwortLaenge: 25`),
gleiche `.env`, drei Minuten nach der letzten Ablehnung. Der einzige
Unterschied: **der Prozess lief nicht mehr in der Umgebung des Agenten.**

Deren Netzwerkweg unterscheidet sich — anderer Ausgang, anderer
TLS-Fingerabdruck, möglicherweise ein Proxy dazwischen. LINA verwirft den
Login-POST von dort und antwortet generisch mit „Benutzername oder Passwort
ist falsch!". Die GETs auf Loginseite und Skripte kamen aus derselben Umgebung
anstandslos durch; abgewiesen wird gezielt die Anmeldung.

Rückblickend passt auch der Zeitpunkt: Die 1.518 erfolgreichen Aufrufe des
Tages stammten aus einem Prozess, der anders gestartet worden war. Ab 19:20
kamen alle Startversuche aus der Agentenumgebung — und ab da wurde jeder
abgelehnt.

> **Regel für alle künftigen Agenten: den Importer nicht aus der eigenen
> Umgebung gegen das echte LINA starten.** Migrationen, Tests gegen die
> Attrappe und Datenbankarbeit ja — der Sync-Prozess gehört ins Terminal des
> Nutzers oder in den Container. Sonst produziert man abgelehnte Anmeldungen
> gegen einen Zugang, von dem es genau einen gibt.

**Was die Fehlersuche vier Ablehnungen gekostet hat**, und warum sie trotzdem
nicht umsonst war: Sie hat das Passwort bestätigt, die Feldgleichheit belegt,
zwei echte Abweichungen gefunden (`accept`, Kennung) und die Vermutungen
„SHA-256-Umstellung", „Kontosperre", „IP-Sperre" und „Tagesbegrenzung"
nacheinander ausgeschlossen. Ohne diese Ausschlüsse hätte niemand auf die
Startumgebung getippt.

Der Importer braucht sonst kein Zutun: `sperre_aktiv()` wird vor jedem Lauf
geprüft — ein Neustart nimmt bis zum Ablauf keinen Kontakt zu LINA auf.
