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

## Offen

Die Anmeldung scheitert weiterhin (`Login 200, Probe 401`). Die Antwort auf
den Login-POST — 69 Bytes JSON mit einem `status`-Feld — wird derzeit nicht
ausgewertet; dort steht mit hoher Wahrscheinlichkeit die Ursache. Nächste
Schritte in `PROMPT-login-fix.md`.

Eine naheliegende Hypothese, die noch zu prüfen ist: LINAs `hex_md5` stammt
aus der Paul-Johnston-Bibliothek, die je nach Version vor dem Hashen nach
UTF-8 kodiert oder die Zeichencodes roh nimmt. Node kodiert immer UTF-8. Bei
Sonderzeichen im Passwort ergeben sich daraus zwei verschiedene Hashes.
