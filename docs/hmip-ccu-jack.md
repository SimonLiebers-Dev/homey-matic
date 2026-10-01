# HmIP und CCU-Jack — Notizen

Gesammeltes Wissen aus der Anbindung einer OpenCCU an Homey. Ergänzt
[`../CLAUDE.md`](../CLAUDE.md) um die Dinge, die nicht den Code betreffen, sondern CCU, CCU-Jack
und das Verhalten der Geräte selbst.

## CCU-Jack

Add-on auf der CCU, das die Datenpunkte per REST und MQTT bereitstellt. Ersetzt die alten
XML-RPC- und RedMatic-Wege, die mit aktueller Firmware nicht mehr zuverlässig funktionieren.

Installation über *Einstellungen → Systemsteuerung → Zusatzsoftware*. Für einen Raspberry Pi 3 ist
das Paket `ccu-jack-ccu3-rm-rp2+3-*.tar.gz` das richtige, für Pi 4/5 `ccu-jack-rm-rp4-*`.

| Port | Zweck |
|---|---|
| 2121 | HTTP, REST-API und Web-UI unter `/ui` |
| 2122 | HTTPS, selbstsigniertes Zertifikat |
| 1883 | MQTT |
| 8883 | MQTT über TLS |

Diese Ports müssen in der CCU-Firewall unter *Port-Freigabe* eingetragen werden, zusätzlich zu den
Einstellungen für XML-RPC- und Script-API. Die Web-UI unter `:2121/ui` ist auch ein
Datenpunkt-Browser und das schnellste Werkzeug, um Kanäle und Werte eines Geräts anzuschauen.

### REST-API (VEAP)

```bash
# Geräteliste
curl -s -u <user>:<pass> http://<CCU>:2121/device

# Gerät: Typ, Kanäle, Firmware
curl -s -u <user>:<pass> http://<CCU>:2121/device/<SERIENNUMMER>

# Kanal: Kanaltyp und verfügbare Datenpunkte
curl -s -u <user>:<pass> http://<CCU>:2121/device/<SERIENNUMMER>/<KANAL>

# Metadaten eines Datenpunkts: Typ, Wertebereich, operations
curl -s -u <user>:<pass> http://<CCU>:2121/device/<SERIENNUMMER>/<KANAL>/<NAME>

# Wert lesen
curl -s -u <user>:<pass> http://<CCU>:2121/device/<SERIENNUMMER>/<KANAL>/<NAME>/~pv

# Wert setzen
curl -X PUT -u <user>:<pass> -d '{"v":0.5}' \
  http://<CCU>:2121/device/<SERIENNUMMER>/<KANAL>/<NAME>/~pv

# Kanalkonfiguration (MASTER-Parametersatz), Hochkommata gegen Shell-Expansion
curl -s -u <user>:<pass> 'http://<CCU>:2121/device/<SERIENNUMMER>/<KANAL>/$MASTER/~pv'
```

Antwort eines `~pv`-Aufrufs: `{"ts":<Millisekunden>,"v":<Wert>,"s":<Qualität>}`. `s: 0` heißt gut.
**`ts: 0` zusammen mit `s: 100` bedeutet, dass der Datenpunkt nie einen echten Wert getragen hat** —
ein sehr nützliches Signal, etwa um zu erkennen, dass nie eine Kalibrierung stattgefunden hat.

Das Feld `operations` in den Metadaten ist eine Bitmaske: `1` lesbar, `2` schreibbar, `4` sendet
Events. Bei `type: "ENUM"` listet `valueList` die Klartextwerte; geschrieben wird der Index.

Dieser direkte Weg ist das wichtigste Debugging-Werkzeug: Er beantwortet die Frage, ob ein Problem
in der Homey-App oder bereits auf CCU-Seite liegt.

### MQTT

```
device/status/<SERIENNUMMER>/<KANAL>/<NAME>     # Statusmeldungen
device/set/<SERIENNUMMER>/<KANAL>/<NAME>        # Schreibzugriffe
```

Nutzlast ist JSON. Die Metadaten eines Datenpunkts enthalten die passenden Topics direkt in den
Feldern `mqttStatusTopic` und `mqttSetTopic`.

## HmIP-BROLL-2

Rollladenaktor für Markenschalter. Kanallayout, ausgelesen an einem realen Gerät mit Firmware
1.10.16:

| Kanal | Typ | Relevante Datenpunkte |
|---|---|---|
| 0 | `MAINTENANCE` | `UNREACH`, `RSSI_DEVICE`, `RSSI_PEER`, `DUTY_CYCLE`, `OPERATING_VOLTAGE`, `ERROR_OVERHEAT`, `ERROR_OVERLOAD` |
| 1, 2 | `KEY_TRANSCEIVER` | `PRESS_SHORT`, `PRESS_LONG`, `PRESS_LONG_START`, `PRESS_LONG_RELEASE` |
| 3 | `SHUTTER_TRANSMITTER` | `LEVEL`, `ACTIVITY_STATE`, `LEVEL_STATUS`, `PROCESS`, `SECTION`, `SELF_CALIBRATION`, `SELF_CALIBRATION_RESULT` |
| 4, 5, 6 | `SHUTTER_VIRTUAL_RECEIVER` | `LEVEL`, `STOP`, `ACTIVITY_STATE`, `LEVEL_STATUS`, `PROCESS`, `SECTION` |
| 7 | `BLIND_WEEK_PROFILE` | `COMBINED_PARAMETER`, Wochenprogramm-Sperren |

Gelesen wird von Kanal 3, geschrieben auf Kanal 4. Das entspricht dem HmIP-BROLL der ersten
Generation, weshalb sich beide denselben Code teilen können.

`LEVEL` ist `FLOAT` im Bereich 0 bis 1.01 mit der Einheit `100%`. `0` ist geschlossen, `1` ist
offen, die Schrittweite beträgt 0,005 (also 0,5 %). **`1.01` ist kein gültiger Positionswert,
sondern der Platzhalter für „Position unbekannt".**

`ACTIVITY_STATE` ist bei HmIP numerisch: `0 = UNKNOWN`, `1 = UP`, `2 = DOWN`, `3 = STABLE`.
BidCos-Geräte liefern an dieser Stelle Strings.

## Kalibrierung

**Ein HmIP-Rollladenaktor kann ohne gültige Kalibrierung keine Zwischenpositionen anfahren.** Er
kennt dann nur die beiden Endlagen, und jede Prozentangabe wird zur Vollfahrt. Die Kalibrierdaten
gehen bei einem Werksreset verloren — also bei jedem Umzug auf eine andere Zentrale.

Zustand prüfen:

```bash
curl -s -u <user>:<pass> http://<CCU>:2121/device/<SERIENNUMMER>/3/SELF_CALIBRATION_RESULT/~pv
```

`{"ts":0,"v":false,"s":100}` heißt: nie kalibriert.

Kalibrierung starten — `SELF_CALIBRATION` ist ein ENUM mit `["STOP","START"]`, Index 1 ist `START`:

```bash
curl -X PUT -u <user>:<pass> -d '{"v":1}' \
  http://<CCU>:2121/device/<SERIENNUMMER>/3/SELF_CALIBRATION/~pv
```

Der Aktor fährt daraufhin selbständig einen kompletten Zyklus und misst die Laufzeiten. Nicht
unterbrechen. Danach steht in `SELF_CALIBRATION_RESULT` ein `true` mit echtem Zeitstempel und
`s: 0`, und Zwischenpositionen funktionieren.

## Umzug Homematic IP Access Point → OpenCCU

Zur Einordnung, warum die Kalibrierung überhaupt verloren ging.

Ein Homematic-IP-Gerät kann immer nur in **einem** System registriert sein. Der Umzug bedeutet pro
Gerät: in der Homematic-IP-App löschen, Werksreset am Gerät, an der neuen Zentrale neu anlernen.
Direktverknüpfungen und Heizgruppen müssen auf der CCU neu aufgebaut werden.

Werksreset bei HmIP: Systemtaste etwa 4 Sekunden drücken, bis die LED schnell orange blinkt,
loslassen, erneut etwa 4 Sekunden drücken, bis die LED grün leuchtet. Erfolgreich war es, wenn
danach sechsmal lang rot geblinkt wird, gefolgt von einmal orange und einmal grün. Nach dem Reset
ist das Gerät etwa drei Minuten im Anlernmodus; ein kurzer Druck auf die Systemtaste startet das
Fenster erneut.

Anlernen an der CCU auf zwei Wegen: online, dann genügt die Systemtaste und die CCU holt den
Schlüssel anhand der SGTIN vom Hersteller-Server; oder lokal, dann werden SGTIN und Key vom
QR-Aufkleber eingegeben. Beide ohne Trennzeichen, beides sind Hexwerte — ein vermeintliches `O` ist
immer eine Null, ein `I` immer eine Eins.

**Nach dem Anlernen kalibrieren.** Sonst beginnt die Fehlersuche von vorn.
