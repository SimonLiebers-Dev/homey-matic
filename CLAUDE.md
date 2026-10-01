# CLAUDE.md

Projektgedächtnis für diesen Fork von [twendt/homey-matic](https://github.com/twendt/homey-matic)
— einer Homey-App, die Homematic- und Homematic-IP-Geräte über eine CCU anbindet.

Fork: `SimonLiebers-Dev/homey-matic` · Upstream-Lizenz: MIT · Homey SDK 3 · reines JavaScript, kein TypeScript.

Upstream ist seit Februar 2022 unverändert (Version 0.19.1). Mit einem zeitnahen Merge von
Pull Requests ist nicht zu rechnen — dieser Fork ist als dauerhafte Arbeitsgrundlage gedacht.

## Stand

Branch `feature/hmip-broll-2`. Inhalt:

- Eigener Treiber `drivers/HmIP-BROLL-2/` für den Rollladenaktor HmIP-BROLL-2.
- Die Rollladenlogik liegt in `lib/shutterDevice.js`. `drivers/HmIP-BROLL/device.js`,
  `drivers/HmIP-BROLL-2/device.js` und `drivers/HmIP-FROLL/device.js` sind nur
  Weiterleitungen darauf.
- Drei Verhaltensfixes in dieser geteilten Logik (siehe Fallstricke 7, 9, 10).
- Ein Fix in `lib/HomeMaticCCUJack.js`, der unabhängig vom Gerätetyp jeden CCU-Jack-Nutzer
  betrifft (Fallstrick 4).

## Architektur

| Datei | Zweck |
|---|---|
| `app.js` | App-Einstieg. Liest die Settings, startet Discovery, erzeugt pro CCU eine Bridge. |
| `lib/HomeMaticDiscovery.js` | Findet CCUs per UDP-Broadcast an `255.255.255.255:43439`, Antwort auf Port `48724`. |
| `lib/HomeMaticCCUJack.js` | Bridge über CCU-Jack: REST (Port 2121) zum Lesen, MQTT (1883) für Events und Schreibzugriffe. |
| `lib/HomeMaticCCURPC.js` | Bridge über XML-RPC. Deprecated, funktioniert mit aktueller OpenCCU-Firmware nicht mehr. |
| `lib/HomeMaticCCUMQTT.js` | Bridge über RedMatic/Mosquitto. Ebenfalls deprecated. |
| `lib/driver.js` | Basisklasse aller Treiber, enthält den Pairing-Ablauf. |
| `lib/device.js` | Basisklasse aller Geräte, enthält die CapabilityMap-Mechanik. |
| `lib/shutterDevice.js` | Geteilte Logik der HmIP-Rollladenaktoren. |
| `drivers/<TYP>/` | Pro Gerätetyp: `driver.js`, `device.js`, `driver.compose.json`, `driver.flow.compose.json`, `assets/`. |

`app.json` wird von der Homey CLI aus den `*.compose.json`-Dateien generiert. Nie von Hand
editieren — nach einem Build mitcommitten.

### Wie ein Gerät gefunden wird

`lib/driver.js` vergleicht beim Pairing **exakt per String**:

```js
if (self.homematicTypes.includes(bridgeDevices[interfaceName][i].TYPE))
```

`TYPE` kommt aus dem Feld `type` der CCU-Jack-REST-Antwort. Ein neuer Gerätetyp braucht also
entweder einen Eintrag in `homematicTypes` eines bestehenden Treibers oder einen eigenen Treiber.
Ein eigener Treiber ist vorzuziehen, sobald sich Kanallayout oder Fähigkeiten unterscheiden —
und auch dann, wenn es in der Geräteliste schlicht klarer ist.

### Wie Werte abgebildet werden

`lib/device.js` arbeitet eine `capabilityMap` ab:

```js
"windowcoverings_set": {
    "channel": 3,            // Lesekanal
    "key": "LEVEL",          // Lese-Datenpunkt
    "convert": fn,           // eingehende Werte (Events + Initialwert)
    "set": {
        "key": "LEVEL",      // Schreib-Datenpunkt
        "channel": 4,        // Schreibkanal
        "convert": fn,       // ausgehende Werte
        "convertKey": fn     // Datenpunktname abhängig vom Wert
    }
}
```

Wichtig: `convert` auf oberster Ebene gilt nur für den **Lesepfad**, `set.convert` nur für den
**Schreibpfad**. Die beiden werden leicht verwechselt.

Gibt ein Lese-`convert` `undefined` zurück, überspringt die Basisklasse das Setzen der Capability.
Das ist der einzige saubere Hook, um einen eingehenden Wert zu verwerfen.

## Entwicklung

```bash
npm install
npm i -g homey && homey login
homey app install          # baut und installiert dauerhaft auf dem Homey
homey app run              # Entwicklungsmodus mit Live-Logs, siehe Fallstrick 1
```

**Docker ist Pflicht** für `run`, `build`, `validate` und `publish`. Seit Homey Pro (Early 2023)
laufen Apps containerisiert, und die CLI bildet diese Laufzeitumgebung lokal nach.

Die App-ID ist identisch zur Store-Version. Vor dem ersten CLI-Deploy die Store-App auf dem Homey
deinstallieren.

**Logs** liest man über den Button *Get Logs* auf der App-Einstellungsseite, auch bei
`homey app install`. Die Einstellungen selbst werden nur beim App-Start gelesen — nach jeder
Änderung die App neu starten.

**Codestil:** `drivers/` nutzt 4 Leerzeichen Einrückung, `lib/` nutzt 2. Beim Editieren die
jeweilige Konvention beibehalten.

## Fallstricke

Alles hier hat in der Praxis Zeit gekostet. Vor dem Debuggen einmal durchlesen.

**1. `homey app run` findet die CCU nicht.** Symptom: „Es wurden keine neuen Geräte gefunden",
noch bevor eine Geräteliste kommt. Ursache: Die Discovery ist ein UDP-Broadcast, und der kommt aus
einem Docker-Container mit Bridge-Networking nicht ins LAN. Die Bridge-Auswahl bleibt leer und das
Pairing bricht im ersten Schritt ab. Lösung: `homey app install` (läuft auf dem Homey, also im LAN)
oder `homey app run --network host`. Letzteres ist unter macOS unzuverlässig, weil Docker dort
selbst in einer NAT-VM läuft.

**2. Der Verbindungstyp fällt beim Neuinstallieren auf `use_rpc` zurück.** Symptom im Log:
`Failed to connect: HmIP-RF Error: Unknown XML-RPC tag 'META'`, dazu Interfaces `BidCos-RF`,
`HmIP-RF`, `CUxD`. Der XML-RPC-Pfad ist mit aktueller OpenCCU-Firmware grundsätzlich kaputt.
Nach jeder Installation prüfen, dass in den App-Einstellungen **Use CCU Jack** steht.

**3. CCU-Jack hat eine eigene Benutzerverwaltung**, nicht die der CCU. Die Liste `Users` in
`ccu-jack.cfg` ist bei einer frischen Installation leer, und dann ist **gar keine**
Authentifizierung aktiv — ein trotzdem mitgeschickter Basic-Auth-Header führt zu `401`. Die
Homey-App schickt die Zugangsdaten nur, wenn Benutzer **und** Passwort gesetzt sind. Schnelltest:

```bash
curl -s -o /dev/null -w "ohne: %{http_code}\n" http://<CCU>:2121/device
curl -s -o /dev/null -w "mit:  %{http_code}\n" -u <user>:<pass> http://<CCU>:2121/device
```

**4. `/device` liefert mehr als Geräte.** Das `~links`-Array enthält neben den Einträgen mit
`rel: "device"` auch einen Rückverweis `rel: "collection", href: ".."`. Ohne Filter erzeugt der
einen ungültigen Request, `Promise.all` lehnt ab, und die gesamte Geräteliste scheitert — mit einem
irreführenden `401`, obwohl die Zugangsdaten stimmen. Gefixt in `lib/HomeMaticCCUJack.js`.

**5. `lib/device.js` überschreibt `getCapabilityValue()`** und verdeckt damit die gleichnamige
SDK-Methode. Die Überschreibung liest asynchron von der CCU, setzt die Capability und **gibt nichts
zurück**. Jeder Aufruf liefert `undefined`. Wer den aktuellen Capability-Wert braucht, muss die
Originalmethode direkt aufrufen:

```js
Homey.Device.prototype.getCapabilityValue.call(this, name)
```

**6. Bug in `lib/device.js`:** Im Zweig `if (set.convertChannel)` wird das Ergebnis `key`
zugewiesen statt `channel`. Aktuell nutzt kein Treiber `convertChannel`, deshalb fällt es nicht auf.

**7. `ACTIVITY_STATE` ist bei HmIP numerisch**, nicht `"UP"`/`"DOWN"` wie bei BidCos. Die
Enumeration lautet `0 = UNKNOWN, 1 = UP, 2 = DOWN, 3 = STABLE`. Der ursprüngliche String-Vergleich
traf nie zu, `windowcoverings_state` stand dauerhaft auf `idle`. Gefixt in `lib/shutterDevice.js`,
beide Formen werden behandelt. Damit erledigt hat sich auch ein zweites Symptom: Nach einem Stopp
während der Fahrt löste ein erneutes „hoch" keine Bewegung mehr aus, weil der Capability-Zustand
nie zurücksprang und Homey deshalb den Listener gar nicht erst aufrief.

**8. `setCapabilityOptions()` ersetzt das komplette Options-Objekt.** Ein Aufruf mit
`{ decimals: 0 }` wirft `min`, `max` und `step` weg und macht den Slider unbrauchbar. Schlimmer:
Die Optionen werden **persistent am Gerät** gespeichert. Den Aufruf wieder zu entfernen reicht
nicht — das Gerät muss in Homey gelöscht und neu hinzugefügt werden. Für Anzeigeoptionen stattdessen
`capabilitiesOptions` in der `driver.compose.json` verwenden, das wird beim Build mit den
Standardwerten zusammengeführt.

**9. Der Slider sprang bei jedem Zwischenwert zurück.** Der Aktor meldet während der Fahrt
laufend `LEVEL`, und jeder Wert landete direkt in der Capability. `lib/shutterDevice.js` merkt sich
jetzt die Zielposition, unterdrückt Zwischenwerte während der Fahrt und liest nach `STABLE` die
tatsächliche Position einmal nach. Eine Fahrt per Wandtaster hat kein Ziel und wird weiterhin live
mitgeführt. Ein Timeout von drei Minuten verhindert, dass ein verlorenes Event den Slider einfriert.

**10. Homey rechnet Prozentwerte als `value * 100` ohne Rundung.** Bei 16 der 201 möglichen
HmIP-Positionen ergibt das Anzeigen wie `55.00000000000001 %` — `0.55 * 100` ist in JavaScript
nicht `55`. Eingehende `LEVEL`-Werte werden deshalb auf das 0,5-%-Raster gerundet. Der Wert `1.01`
ist bei HmIP der Platzhalter für „Position unbekannt" und wird auf `1` begrenzt, sonst stünden
101 % in der Kachel.

Die Rundung allein löst die Anzeige nicht: Für 16 der 201 Positionen existiert überhaupt kein
`double`, dessen Multiplikation mit 100 exakt den gewünschten Prozentwert ergibt — auch nicht im
Abstand mehrerer ULP. Der Wert lässt sich also nicht so wählen, dass Homey sauber anzeigt. Deshalb
setzt `drivers/HmIP-BROLL-2/driver.compose.json` zusätzlich `capabilitiesOptions` mit
`decimals: 0`. Das ist der Manifest-Weg, der beim Build mit den Standardwerten zusammengeführt
wird — anders als der Laufzeitaufruf aus Fallstrick 8.

**11. Ein unkalibrierter HmIP-Rollladenaktor kann keine Zwischenpositionen.** Jede Prozentangabe
wird zur Vollfahrt. Das ist kein Softwarefehler — Details und Prozedur in
[`docs/hmip-ccu-jack.md`](docs/hmip-ccu-jack.md). Nach jedem Werksreset neu kalibrieren.

## Testumgebung

- OpenCCU auf einem Raspberry Pi 3, Funkmodul RPI-RF-MOD, CCU-Jack als Add-on
- Homey Pro, App über `homey app install` vom MacBook
- Testgerät: HmIP-BROLL-2, Firmware 1.10.16
- CCU-Firewall: XML-RPC- und Script-API auf „Eingeschränkt", Port-Freigabe `1883;2121;2122`,
  IP-Liste enthält den Homey

Zugangsdaten gehören nicht in dieses Repository.

## Offene Punkte

- **`decimals: 0` verifizieren.** Ob `capabilitiesOptions` im Manifest die Nachkommastellen in der
  Kachel tatsächlich entfernt, ist nicht bestätigt — möglicherweise formatiert Homey den
  Prozentwert unabhängig davon. Falls wirkungslos: die zwei Zeilen aus
  `drivers/HmIP-BROLL-2/driver.compose.json` wieder entfernen, die Anzeige ist kosmetisch. Falls
  der Slider danach seltsam reagiert, Gerät in Homey löschen und neu hinzufügen.
- **`drivers/HmIP-FROLL/device.js`** zeigt jetzt auf `lib/shutterDevice.js`, ist aber **ungetestet**
  — kein Testgerät vorhanden. Das Kanallayout wurde als identisch angenommen, nicht verifiziert.
- **HmIP-FAL230-C6** (Fußbodenheizungsaktor) hat keinen Treiber. Das ist die nächste größere
  Aufgabe. Die Heizungsregelung selbst läuft über CCU-Heizgruppen, gesteuert wird über das
  Wandthermostat — HmIP-WTH-2 ist über den vorhandenen Treiber `HMIP-WTH` bereits abgedeckt. Ein
  eigener Treiber wäre also Komfort, keine Voraussetzung.
- **Upstream-PR** für den CCU-Jack-Filter (Fallstrick 4) wäre unabhängig vom Gerätetyp nützlich.
  Die Codekommentare sind bereits auf Englisch.
- **Restliche Rollläden umziehen.** Pro Gerät: aus der Homematic-IP-App löschen, Werksreset,
  an der OpenCCU anlernen, kalibrieren, in Homey hinzufügen. Ablauf in
  [`docs/hmip-ccu-jack.md`](docs/hmip-ccu-jack.md).
