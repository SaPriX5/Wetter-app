# Principe Wetter App

Wetter-Web-App (PWA) für iPhone, iPad und Mac. Statische Seite ohne Build, veröffentlicht über GitHub Pages unter https://wetter.sapri.eu

## Funktionen
- Regen-Warner für 2 Stunden, DWD-Radar mit Vollbild
- Stundenverlauf, 16-Tage-Vorhersage mit Unsicherheit, Tagesseiten
- Ort per Suche oder Standort, Favoriten, Offline-Stand

## Installieren
- iPhone/iPad: Safari, Teilen, "Zum Home-Bildschirm"
- Mac: Safari 17+, Ablage, "Zum Dock hinzufügen"; Chrome/Edge: Installieren-Symbol

## Daten und Quellen
DWD ICON-D2 und MOSMIX (über Open-Meteo und Bright Sky), ECMWF IFS (CC BY 4.0), DWD-Radar, Karte OpenFreeMap © OpenStreetMap-Mitwirkende.
Wettersymbole: Meteocons von Bas Milius (MIT, siehe wx/LICENSE-Meteocons.txt). Schrift: Barlow (SIL OFL 1.1, siehe fonts/).
Ort und Favoriten bleiben nur im Browser auf dem Gerät.

## Lokal testen
`python3 -m http.server 8765`, dann http://localhost:8765
