# PT CurveViewer Gen2 — Umsetzungskonzept & Phasenplan

> **Erstellt:** 10.02.2026  
> **Projekt:** PT CurveViewer Gen2  
> **Technologie-Stack:** React 19 + TypeScript + Vite + Zustand + ECharts + ag-grid + @dnd-kit

---

## Inhaltsverzeichnis

1. [Architekturübersicht](#1-architekturübersicht)
2. [Aktueller Umsetzungsstand](#2-aktueller-umsetzungsstand)
3. [Phasenplan](#3-phasenplan)
4. [Detailkonzept je Phase](#4-detailkonzept-je-phase)
5. [Abhängigkeiten & Risiken](#5-abhängigkeiten--risiken)

---

## 1. Architekturübersicht

### Schichtenmodell

```
┌──────────────────────────────────────────────────────┐
│                    UI Layer (React)                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ DataPortal │  │ CurvePlot  │  │  ValueTables   │  │
│  │ (Import,   │  │ (ECharts,  │  │  (ag-grid,     │  │
│  │  TreeView, │  │  Cursors,  │  │  Sync-Scroll,  │  │
│  │  Grouping) │  │  Elements) │  │  Trend-Charts) │  │
│  └────────────┘  └────────────┘  └────────────────┘  │
├──────────────────────────────────────────────────────┤
│                State Layer (Zustand)                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐   │
│  │fileStore │  │groupStore │  │ settingsStore    │   │
│  └──────────┘  └───────────┘  └──────────────────┘   │
├──────────────────────────────────────────────────────┤
│              Services & Utils Layer                   │
│  fileImporter · xmlParser · zpgHandler               │
│  axisAggregator · colorConverter · lttb              │
├──────────────────────────────────────────────────────┤
│              Data Layer (Browser)                     │
│  Float64Arrays · Raw XML · Grouped References        │
└──────────────────────────────────────────────────────┘
```

### Performance-Architektur

- **Float64Array** für Messdaten (kein JSON-Overhead)
- **LTTB-Downsampling** (5.000 Punkte pro Serie)
- **ECharts Canvas Renderer** mit `large: true` und `animation: false`
- **Lazy Loading** der Tabs via `React.lazy` + `Suspense`
- **Batch-Import** (5 Dateien parallel, AbortController)
- **Referenzbasierte Gruppierung** (Kanäle als IDs, kein Kopieren der Daten)

---

## 2. Aktueller Umsetzungsstand

### ✅ Vollständig implementiert

| # | Feature | Komponente |
|---|---------|------------|
| 1 | XML/ZPG Datei-Import (einzeln + Ordner) | `FileImport`, `fileImporter`, `xmlParser`, `zpgHandler` |
| 2 | Drag & Drop (Dateien + Ordner) | `FileImport` |
| 3 | Ladefortschritt mit Abbruch-Funktion | `FileImport`, `fileImporter` |
| 4 | TreeView mit Header-Infos + Kanälen | `DataTreeView` |
| 5 | Kanal-Details (Name, Farbe, Einheit, Punktanzahl) | `DataTreeView` |
| 6 | Grafische Elemente parsen (Lines, Windows, Circles) | `xmlParser`, Types |
| 7 | Set/Actual Values parsen | `xmlParser`, Types |
| 8 | Raw XML Speicherung | `fileStore` |
| 9 | Gruppen erstellen, umbenennen, löschen | `groupStore`, `DataTreeView` |
| 10 | Kanäle zu Gruppen hinzufügen/entfernen | `groupStore`, `DataTreeView` |
| 11 | Kanäle in mehreren Gruppen gleichzeitig | `groupStore` |
| 12 | Ganze Dateien zu Gruppen hinzufügen | `DataTreeView` |
| 13 | Drag & Drop Kanäle/Dateien auf Gruppen | `DataTreeView` (native HTML5 DnD) |
| 14 | Filter im TreeView (Header-Felder, Kanalname, Datum, Freitext) | `DataTreeView` |
| 15 | Sortierung im TreeView | `DataTreeView` |
| 16 | Multi-Achsen Plot mit Y-Achsen-Gruppierung | `CurvePlot` |
| 17 | X-Achsen-Umschaltung via Dropdown | `CurvePlot` |
| 18 | Zoom-Level aus coordSystem Min/Max + Aggregation | `CurvePlot`, `axisAggregator` |
| 19 | Grafische Elemente im Plot (Lines→markLine, Windows→markArea, Circles→graphic) | `CurvePlot` |
| 20 | Sichtbarkeits-Toggles (All/Lines/Windows/Circles/Points) | `CurvePlot`, `settingsStore` |
| 21 | LTTB-Downsampling für Performance | `lttb`, `CurvePlot` |
| 22 | Mauspositions-Datenpanel | `CurvePlot` |
| 23 | Tooltip auf Kurven | `CurvePlot` |
| 24 | Set/Actual Value Tabellen (2x nebeneinander) | `ValueTables` |
| 25 | NOK-Farbgebung (roter Header bei isMarked) | `ValueTables` |
| 25a | **Zeilenumbruch bei zu breitem Text** — Description, Werte und Header umbrechen statt abschneiden (UI + PDF-Export). Dynamische Zeilenhöhe passt sich an. | `ValueTables`, `ValueTables.css` |
| 25b | **Individuelle Spaltenbreiten** — Jede Datei-Spalte + Description-Spalte einzeln per Drag resizebar. | `ValueTables` |
| 26 | Farb-Konvertierung (RGB-Integer → CSS) | `colorConverter` |
| 26a | **LineStyle-Mapping (1–10) → ECharts Dash-Patterns** | `colorConverter` |
| 27 | **Dark/Light Theme Toggle** — Durchgängig über alle Bereiche (DataPortal, CurvePlot, ValueTables). CSS-Variablen-System mit `[data-theme]`, Zustand-Store mit `localStorage`-Persistierung, `useThemeColors` Hook für ECharts-Farben. | `settingsStore`, `App.css`, `useThemeColors`, alle CSS |
| 28 | **ECharts Performance-Optimierungen** — (1) Chart-Instanz wird nur einmal initialisiert statt bei jeder Option-Änderung disposed/neu erstellt, (2) `useDirtyRect: true` für Canvas Dirty-Rectangle-Rendering, (3) `progressive/progressiveThreshold` für inkrementelles Rendering großer Serien, (4) `notMerge: true` + `lazyUpdate: true` für effiziente Option-Updates, (5) Stabile Event-Handler-Refs statt Re-Registrierung, (6) Visibility-Map O(1) statt O(n)-Lookup, (7) Throttled Mousemove (50ms), (8) Pre-allozierte Data-Arrays statt push-Loop, (9) Redundantes doppeltes LTTB-Sampling entfernt, (10) Tooltip `showDelay`, (11) ResizeObserver mit stabilen Refs. | `CurvePlot.tsx` |
| 29 | **Sticky Headers/Description in Value Tables** — Description-Header bleibt bei vertikalem und horizontalem Scrollen fixiert (position: sticky top+left, z-index 5). File-Header-Zeile sticky top. Solider Background statt backdrop-filter. | `ValueTables.css` |
| 30 | **Zeilen-Klick → Trendverlauf + Verteilung (ValueDetailModal)** — Klick auf Description-Zelle öffnet Modal mit: (1) Trend-Chart (Linie+Scatter über alle Dateien, Mean-Linie, Tooltip mit vollständiger Header-Info), (2) Histogramm (Verteilungs-Balkendiagramm mit automatischem Binning), (3) Statistik-Strip (Count, Min, Max, Mean, Std Dev). Glassmorphism-Design, ESC zum Schließen. | `ValueDetailModal.tsx`, `ValueDetailModal.css`, `ValueTables.tsx` |
| 31 | **Color Picker für Kanäle & Gruppen** — Klick auf Farb-Swatch in der Plot-Legende öffnet modernen Color Picker mit: (1) Vordefinierte Farbpalette (30 Farben), (2) Zuletzt verwendete Farben (bis zu 12), (3) Nativer Color Picker + Hex-Eingabe, (4) Gruppen-Farbänderung (alle Kanäle einer Gruppe), (5) Einzelkanal-Farbänderung. Farb-Overrides werden in `settingsStore.plotSettings.colorOverrides` gespeichert und in Series, Data Panel, Cursors, Channel Summary konsistent angewandt. | `ColorPicker.tsx`, `ColorPicker.css`, `PlotLegend.tsx`, `CurvePlot.tsx`, `settingsStore.ts` |
| 31a | **Overlay-Cleanup bei Tab-Wechsel** — Mouse-Data-Panel, Tooltip und Zoom-Drag-Rect werden automatisch zurückgesetzt wenn vom Plot-Tab wegnavigiert wird. Verhindert verwaiste Overlays auf anderen Tabs. `activeTab` wird von `App.tsx` an `settingsStore` synchronisiert. | `CurvePlot.tsx`, `App.tsx`, `settingsStore.ts` |
| 31b | **ActSet Value Status-Mapping** — XML-Status (256/500–504) wird beim Import auf internes Mapping (0=OK, 1=Deactivated, 2=NOK) konvertiert. Deaktivierte Werte (status=1) werden in Tabellen und Trend-Modal ausgeblendet. | `xmlParser.ts`, `ValueTables.tsx`, `ValueDetailModal.tsx` |
| 32 | **X-Sync (Kanal-Referenzierung)** — Alle Kanäle einer Datei können auf einen gemeinsamen Referenzpunkt X=0 verschoben werden. Drei Modi: (1) *Sync to Xmin* — verschiebt basierend auf dem minimalen X-Wert eines Masterkanals, (2) *Sync to Xmax* — verschiebt basierend auf dem maximalen X-Wert, (3) *Sync to Y-Threshold* — verschiebt basierend auf dem ersten Y-Schwellwert-Schnittpunkt des Masterkanals. Masterkanal wird per Y-Achse selektiert (bei Y-Threshold nur Kanäle die in allen Dateien vorhanden sind). Pro Datei wird ein individueller Offset berechnet. Grafische Elemente (Lines, Windows, Circles) werden ebenfalls verschoben. Fortschrittsanzeige während der Berechnung, Reset-Funktion zum sofortigen Zurücksetzen. | `SyncPanel.tsx`, `SyncPanel.css`, `syncService.ts`, `CurvePlot.tsx`, `settingsStore.ts`, `types/index.ts` |

### ⚠️ Teilweise implementiert

| # | Feature | Status | Was fehlt |
|---|---------|--------|-----------|
| T1 | ~~Sticky Headers/Description in Value Tables~~ | ✅ Implementiert | siehe #29 |
| T2 | Gruppen-Selektion im Plot | Zeigt alle Gruppen-Kanäle | Kein per-Group Show/Hide Toggle |
| ~~T3~~ | ~~Status-basiertes Value Styling~~ | ✅ Implementiert | siehe #31b |
| T4 | Grafische Elemente Tooltips | markLine/markArea Labels | Circle-Hover mit HTML-Description fehlt |

### ❌ Noch nicht implementiert

| # | Feature | Priorität |
|---|---------|-----------|
| N1 | **@dnd-kit Integration** (Gruppen/Kanäle umsortieren) | Mittel |
| N2 | **Cursor-Messwerkzeug** (frei positionierbar, anheftend, mehrere Cursor) | Hoch |
| N3 | **ag-grid für Value Tables** (Performance, Sticky, Sync-Scroll) | Hoch |
| N4 | **Synchronisiertes horizontales Scrollen** Set/Act Tables | Hoch |
| ~~N5~~ | ~~**Zeilen-Klick → Trendverlauf + Verteilung**~~ | ✅ Implementiert (siehe #30) |
| N6 | **Post-Process Evaluations** (konfigurierbares Interface, Results) | Niedrig (Komplex) |
| N7 | **Grafische Element Tooltips** (Circle HTML-Descriptions) | Mittel |
| N8 | **Plot-Legende** (Sidebar mit Baumstruktur, Gruppen/Dateien/Kanäle/Elemente, Sichtbarkeit pro Instanz) | Hoch |
| N9 | **Kanal-Summary unter X-Achse** (gruppierter Ein/Aus-Toggle aller gleichnamigen Kanäle) | Hoch |
| N10 | **Zoom-Historie + Presets** (Zurück-Button, gespeicherte Ansichten) | Mittel |
| N11 | **PDF-Export** des Plot-Views | Mittel |
| N12 | **Sprache: ENGLISCH** für gesamte UI | Hoch |
| ~~N13~~ | ~~**X-Sync (Kanal-Referenzierung)**~~ | ✅ Implementiert (siehe #32) |

---

## 3. Phasenplan

```
Phase 1 ──── Phase 2 ──── Phase 3 ──── Phase 4 ──── Phase 5
Stabilisierung  Plot        Value       UX            Post-
& Polish        Erweiterung Tables      Feinschliff   Process
```

### Übersicht

| Phase | Name | Fokus | Status |
|-------|------|-------|--------|
| **Phase 1** | Stabilisierung & Polish | Bestehende Features abrunden, Layout, Code-Qualität | ✅ Abgeschlossen |
| **Phase 2** | Plot-Erweiterungen | Legende, Kanal-Summary, Cursors, Element-Tooltips, Zoom, PDF-Export | 🔵 Offen |
| **Phase 3** | Value Tables Upgrade | ag-grid Integration, Sync-Scroll, Trend-Charts | 🔵 Offen |
| **Phase 4** | UX-Feinschliff | @dnd-kit, Keyboard-Shortcuts, Responsive, Export | 🔵 Offen |
| **Phase 5** | Post-Process Evaluations | Konfigurierbares Auswertungs-Interface | 🔵 Offen |

---

## 4. Detailkonzept je Phase

### Phase 1: Stabilisierung & Polish ✅

**Ziel:** Alle bestehenden Features sind stabil, performant und vollständig.

| Task | Beschreibung | Betrifft |
|------|-------------|----------|
| 1.1 | Import-Pipeline getestet mit großen Datenmengen | `fileImporter` |
| 1.2 | TreeView Filter/Sortierung vollständig | `DataTreeView` |
| 1.3 | Gruppen CRUD komplett (erstellen, umbenennen, löschen, Kanäle zuweisen) | `groupStore`, `DataTreeView` |
| 1.4 | Basis-Plot mit Achsen-Aggregation, Grafischen Elementen, Sichtbarkeitssteuerung | `CurvePlot` |
| 1.5 | Basis Value Tables mit Farben und NOK-Kennzeichnung | `ValueTables` |
| 1.6 | Typ-System vollständig (alle XML-Elemente abgebildet) | `types/index.ts` |

**Status:** ✅ Abgeschlossen — alle oben genannten Features sind implementiert.

---

### Phase 2: Plot-Erweiterungen 🔵

**Ziel:** Der CurvePlot wird zum vollwertigen Analyse-Werkzeug mit Legende, Kanal-Steuerung, Cursors und Export.

#### 2.1 Plot-Legende (Seitenleiste)

**Konzept:**
Rechts neben dem Plot eine ausklappbare Legende/Sidebar, die alle aktiven Daten als Baumstruktur zeigt. Nicht-enthaltene Daten werden hier **nicht** angezeigt.

**Struktur:**
```
Legend Panel (rechts neben ECharts)
├── Groups
│   ├── Group 1 [✓]
│   │   ├── Dataset1.xml
│   │   │   ├── Kanal 1 [✓] ●────
│   │   │   │   ├── Windows
│   │   │   │   │   ├── Window Group 1
│   │   │   │   │   │   └── Window 1
│   │   │   │   │   └── Window Group 2
│   │   │   │   │       └── Window 1
│   │   │   │   ├── Lines
│   │   │   │   │   ├── Line Group 1
│   │   │   │   │   │   └── Line 1
│   │   │   │   │   └── Line Group 2
│   │   │   │   │       └── Line 1
│   │   │   │   └── Circles
│   │   │   │       ├── Circle Group 1
│   │   │   │       │   └── Circle 1
│   │   │   │       └── Circle Group 2
│   │   │   │           └── Circle 1
│   │   │   └── Kanal 2 [✓] ●────
│   │   │       └── ...
│   │   └── Dataset2.xml
│   │       └── ...
│   └── Group 2 [✗]
│       └── ...
├── Ungrouped
│   ├── Dataset3.xml
│   │   ├── Kanal 1 [✓]
│   │   │   └── Windows / Lines / Circles ...
│   │   └── Kanal 2 [✓]
│   └── ...
```

**Interaktionen:**
- **Klick auf Gruppe/Kanal** → Sichtbarkeit togglen (nur innerhalb der jeweiligen Gruppe, da Kanäle mehrfach vorkommen können)
- **Mouse-Over auf Datei/Kanal** → Zugehörige Kurven im Plot hervorheben (opacity anderer Serien reduzieren)
- **Klick auf grafisches Element** (z.B. Window Group 1) → Nur dieses Element ein/ausblenden
- **Collapse/Expand** auf jeder Ebene

**Wichtig:** Da Kanäle in mehreren Gruppen und/oder ungroupiert vorhanden sein können, wirkt eine Sichtbarkeitsänderung **nur auf die jeweilige Gruppeninstanz** — nicht global.

**Technische Umsetzung:**
```typescript
// Sichtbarkeit pro Gruppeninstanz eines Kanals
interface ChannelVisibility {
  groupId: string;      // 'ungrouped' für ungruppierte
  fileId: string;
  channelId: string;
  visible: boolean;
  visibleElements: {
    lines: boolean;
    windows: boolean;
    circles: boolean;
  };
}
```
- Neue Komponente `PlotLegend.tsx` als Sidebar rechts vom ECharts-Container
- State in `settingsStore` verwaltet, reagiert auf Änderungen
- Mouse-Over nutzt ECharts `dispatchAction({ type: 'highlight' / 'downplay' })`

#### 2.2 Kanal-Summary unter der X-Achse

**Konzept:**
Unterhalb der X-Achse eine kompakte Zusammenfassung aller Kanäle. Kanäle mit **identischer `<description>`** werden als **ein einzelner Eintrag** zusammengefasst.

**Verhalten:**
- Klick auf einen Eintrag → **Alle Kanäle mit dieser `description` gemeinsam ein/ausblenden** (inklusive zugeordneter grafischer Elemente: Lines, Windows, Circles)
- Zeigt Farbindikator je Kanal-Beschreibung
- Kompakte Darstellung (Chips/Tags)

**Umsetzung:**
- ECharts Legend-Komponente (built-in) oder custom HTML-Overlay unterhalb der Chart-Area
- Gruppierung via `Map<description, CurveChannel[]>`
- Toggle schaltet alle Serien mit gleicher `description` gleichzeitig

#### 2.3 Cursor-Messwerkzeug

**Konzept:**
- Toolbar-Button "Add Cursor" → erzeugt vertikalen Crosshair
- Jeder Cursor ist frei positionierbar (Drag oder Klick-Position)
- **Modus-Umschaltung je Cursor:**
  - `free` — Crosshair folgt nur der X-Achse, Y frei
  - `snap` — Crosshair heftet sich an ausgewählten Kanal an (X,Y folgt der Kurve)
- Kanal-Auswahl für Snap-Modus via Dropdown am Cursor
- Cursor-Info-Panel zeigt:
  - Cursor-Position (X, Y)
  - Werte aller sichtbaren Kanäle an der Cursor-X-Position
  - Delta zwischen Cursor-Paaren (ΔX, ΔY)

**Technische Umsetzung:**
```typescript
interface CursorState {
  id: string;
  xPosition: number;
  mode: 'free' | 'snap';
  snapChannelId?: string;
  color: string;
}
```
- ECharts `graphic` Layer für die Crosshair-Linien
- Drag-Events auf dem `graphic` Element für Positionierung
- Binary Search in `pointsX` für Snap-Modus (existiert bereits im Data Panel)
- Neuer Store oder settingsStore-Erweiterung für Cursor-State

#### 2.4 Grafische Elemente Tooltips

**Konzept:**
- **Circles:** HTML-Description aus XML als Tooltip beim Hover
  - ECharts `graphic` Elemente unterstützen Mouse-Events
  - Custom Tooltip Overlay positioniert am Circle
- **Lines/Windows:** Beschriftung = `GroupDescription - LineDescription`
  - Bereits als `markLine`/`markArea` Labels teils vorhanden
  - Hover-Tooltip mit vollständiger Info erweitern

**Umsetzung:**
- Event-Handler auf Circle-Graphic-Elementen: `onmouseover` → Tooltip-DIV einblenden
- Tooltip positioniert über `convertToPixel` des ECharts
- HTML-Content (da Descriptions `<b>`, `<br>` enthalten)

#### 2.5 Erweiterte Zoom-Steuerung

**Konzept:**
- **Zoom-Methoden:**
  - Fenster-Zoom (Rechteck aufziehen)
  - Mausrad-Zoom (mit Modifier-Key für X- vs Y-only)
  - Pinch-to-Zoom (Touch-Geräte)
- **Zoom-Historie:**
  - Stack-basierte Navigation: Jede Zoomstufe wird gespeichert
  - "Zurück" Button → vorherige Zoomstufe wiederherstellen
  - "Reset" Button → auf die aggregierten coordSystem-Min/Max zurück
- **Zoom-Presets (optional):**
  - Aktuelle Zoomstufe als benanntes Preset speichern
  - Schneller Wechsel zwischen gespeicherten Ansichten

**Technische Umsetzung:**
```typescript
interface ZoomState {
  history: ZoomLevel[];     // Stack
  presets: ZoomPreset[];    // Gespeicherte Ansichten
  currentIndex: number;
}

interface ZoomLevel {
  xMin: number; xMax: number;
  yRanges: Map<string, { min: number; max: number }>; // je Y-Achse
}
```
- ECharts `dataZoom` Events abfangen → in History pushen
- "Undo Zoom" Button in Toolbar
- Nutzt bestehende ECharts `dataZoom` (inside + slider)

#### 2.7 X-Sync — Kanal-Referenzierung auf Bezugspunkt

**Konzept:**
Alle im Plot sichtbaren Kanäle einer Datei können auf einen gemeinsamen Referenzpunkt X=0 verschoben werden. Ein **Masterkanal** bestimmt dabei den X-Offset, der auf alle Kanäle derselben Datei (auf der aktiven X-Achse) angewandt wird.

**Sync-Modi:**

| Modus | Offset-Bestimmung | Beschreibung |
|-------|-------------------|-------------|
| **Sync to Xmin** | `offset = -min(masterChannel.pointsX)` | Der kleinste X-Wert des Masterkanals wird auf X=0 verschoben. Alle weiteren Punkte verschieben sich relativ dazu. Ideal für zeitbasierte Ausrichtung auf den Startpunkt. |
| **Sync to Xmax** | `offset = -max(masterChannel.pointsX)` | Der größte X-Wert des Masterkanals wird auf X=0 verschoben. Ermöglicht Vergleich von Endpunkten. |
| **Sync to Y-Threshold** | `offset = -xAtFirstCrossing(master, threshold)` | Der X-Wert an dem der Masterkanal erstmals den definierten Y-Schwellwert kreuzt, wird auf X=0 verschoben. Der User gibt den Schwellwert ein. Nur Y-Kanäle die in **allen angezeigten Dateien** existieren sind als Master auswählbar. |

**Regeln & Einschränkungen:**
- Pro **Datei** wird ein **eigener Offset** berechnet (da verschiedene Dateien unterschiedliche Messdaten haben)
- Der Offset wirkt nur auf Kanäle der **aktiven X-Achse** (verschiedene X-Achsen = verschiedene Wertebereiche)
- **Grafische Elemente** (Lines, Windows, Circles) werden ebenfalls um den Datei-Offset verschoben
- Die Masterkanal-Auswahl erfolgt anhand der vorhandenen **Y-Achsen** (ein Kanal pro Achse als Master)
- Bei Y-Threshold: Nur jene Y-Kanäle sind wählbar, die in **allen** sichtbaren Dateien vorhanden sind

**UI-Elemente:**
- **Sync-Toolbar-Sektion** im Plot mit: Modus-Dropdown, Masterkanal-Dropdown, Threshold-Input (nur bei Y-Threshold), "Apply" Button, "Reset" Button
- **Fortschrittsanzeige** (Progress Bar) während der Offset-Berechnung
- **Reset-Funktion** setzt Offsets sofort zurück ohne Neuberechnung (gespeicherte Offsets werden gelöscht)
- **Mode-Beschreibungen** als Tooltips an den Dropdown-Optionen

**Technische Umsetzung:**
```typescript
type SyncMode = 'off' | 'xmin' | 'xmax' | 'ythreshold';

interface SyncState {
  mode: SyncMode;
  masterYAxis: string;         // yName des Master-Kanals
  threshold: number;           // nur für ythreshold
  offsets: Record<string, number>; // fileId → X-Offset
  isCalculating: boolean;
}
```
- Neuer Service `syncService.ts` berechnet Offsets asynchron
- Offsets werden in `settingsStore` gespeichert und im `CurvePlot` beim Rendering auf `data[i][0]` sowie auf grafische Elemente addiert
- Berechnung läuft nicht auf Originaldaten → nur der Offset wird gespeichert, Reset = Offsets löschen

---

#### 2.6 PDF-Export des Plot-Views

**Konzept:**
- Button "Export as PDF" in der Plot-Toolbar
- Exportiert die aktuelle Ansicht (wie im Tab sichtbar) als sauberes PDF
- Inklusive Achsenbeschriftungen, Legende, Titel

**Umsetzung:**
- ECharts `getDataURL()` liefert Canvas als Base64-PNG
- Nutze `jsPDF` Library für PDF-Generierung
- Alternativ: `html2canvas` + `jsPDF` für pixelgenauen Export inkl. Toolbar/Legende
- Seitengröße automatisch an Viewport-Ratio anpassen (Querformat)

---

### Phase 3: Value Tables Upgrade 🔵

**Ziel:** Professionelle, performante Tabellen mit vollem Feature-Set.

#### 3.1 ag-grid Integration

**Konzept:**
- Ersetze die HTML-`<table>` durch ag-grid Community
- **Vorteile:** Virtualisiertes Rendering, Pinned Columns, Sticky Headers nativ

**Spalten-Definition:**
```typescript
// Statische Spalte (gepinnt links)
{ field: 'description', pinned: 'left', headerName: 'Beschreibung' }

// Dynamische Spalten (je Datei)
files.map(file => ({
  field: file.id,
  headerName: file.header.idString,
  headerClass: file.header.isMarked ? 'header-nok' : '',
  cellRenderer: ValueCellRenderer  // Custom: Farben + Bold bei NOK
}))
```

**Zeilen-Daten:**
```typescript
// Union aller Descriptions, sortiert nach rowNumber
rows = allDescriptions.map(desc => ({
  description: desc,
  [fileId1]: setValue/actualValue für diese Description,
  [fileId2]: setValue/actualValue für diese Description,
  ...
}))
```

#### 3.2 Synchronisiertes Scrollen Set/Act Tables

**Konzept:**
- Beide ag-grid Instanzen teilen sich den horizontalen Scroll-Offset
- `onBodyScroll` Event der einen Tabelle → `ensureColumnVisible` / scroll-Position setzen auf der anderen
- Da Spalten = Dateien: identische Spalten-Reihenfolge, synchrone Bewegung
- Jeweilige Description-Spalte ist gepinnt (`pinned: 'left'`) und scrollt nicht mit

#### 3.3 Zeilen-Klick → Trendverlauf + Verteilung

**Konzept:**
- Klick auf eine Value-Zeile öffnet ein Overlay/Modal mit:
  - **Trendchart:** X-Achse = Dateien (chronologisch nach `date`), Y-Achse = Wert der Zeile
  - **Verteilungschart:** Histogramm der Werte über alle Dateien
- Nutzt ECharts (bereits im Projekt)
- Nur sinnvoll für numerische Values (automatische Erkennung via `dataType`)

**Implementierung:**
```
ValueTables.tsx
├── SetValueGrid (ag-grid)
├── ActualValueGrid (ag-grid)
└── TrendModal (bei Zeilen-Klick)
    ├── TrendChart (ECharts Line)
    └── DistributionChart (ECharts Bar/Histogram)
```

---

### Phase 4: UX-Feinschliff 🔵

**Ziel:** Polierte Benutzerführung, professionelle Interaktionen.

#### 4.1 @dnd-kit Integration

**Konzept:**
- Ersetze native HTML5 Drag & Drop durch `@dnd-kit`
- **Vorteile:** Accessibility, Animation, Touch-Support, bessere Drop-Indikatoren

**Szenarien:**
| Drag | Drop | Aktion |
|------|------|--------|
| Kanal | Gruppe | Kanal zur Gruppe hinzufügen |
| Datei | Gruppe | Alle Kanäle der Datei zur Gruppe |
| Gruppe | Gruppe | Gruppen-Reihenfolge ändern |
| Kanal innerhalb Gruppe | Position | Kanal-Reihenfolge in Gruppe ändern |

#### 4.2 Keyboard-Shortcuts

| Shortcut | Aktion |
|----------|--------|
| `Ctrl+I` | Import-Dialog öffnen |
| `Ctrl+G` | Neue Gruppe erstellen |
| `Delete` | Selektierte Kanäle/Dateien entfernen |
| `1/2/3` | Tab wechseln (Portal/Plot/Tables) |
| `Ctrl+A` | Alle Kanäle selektieren |

#### 4.3 Export-Funktionen

- **Plot als PNG/SVG** (ECharts built-in Toolbox)
- **Plot als PDF** → Phase 2.6 (eigene Implementierung mit jsPDF)
- **Tabellen als CSV/Excel** (ag-grid built-in Export)
- **Session speichern/laden** (Gruppen + Settings als JSON)

---

### Phase 5: Post-Process Evaluations 🔵

**Ziel:** Konfigurierbares Auswertungs-Framework für benutzerdefinierte Analysen.

#### 5.1 Architekturkonzept

```
┌──────────────────────────────────────┐
│         Evaluation Engine            │
│  ┌──────────┐  ┌─────────────────┐   │
│  │ Eval-    │  │ Eval-Defintion  │   │
│  │ Registry │  │ (JSON Schema)   │   │
│  └──────────┘  └─────────────────┘   │
│        │              │               │
│  ┌─────▼──────────────▼──────────┐   │
│  │    Eval Runner                │   │
│  │  (Input: Kanaldaten,          │   │
│  │   Config: Parameter,          │   │
│  │   Output: Result + Messwerte) │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
```

#### 5.2 Evaluation Definition

```typescript
interface EvaluationDefinition {
  id: string;
  name: string;
  description: string;
  // Eingabe-Parameter (vom User konfigurierbar)
  parameters: EvalParameter[];
  // Auswertungs-Logik (JavaScript-Funktion als String oder Plugin)
  evaluator: string | ((channels: CurveChannel[], params: Record<string, any>) => EvalResult);
}

interface EvalParameter {
  key: string;
  label: string;
  type: 'number' | 'string' | 'channel-select' | 'range';
  defaultValue: any;
}

interface EvalResult {
  status: 'OK' | 'NOK' | 'WARN';
  value: string | number;
  unit?: string;
  additionalMeasurements?: { description: string; value: any; unit: string }[];
}
```

#### 5.3 UI-Konzept

- **Neuer Tab "Evaluations"** oder Bereich im Plot-Tab
- **Evaluation-Konfigurator:**
  - Liste verfügbarer Auswertungen (eingebaut + benutzerdefiniert)
  - Parameter-Formular je Auswertung
  - Kanal-Zuordnung (welche Kanäle als Input)
  - "Ausführen" Button
- **Result-Tabelle:** Gleiches Format wie Set/Act Value Tables
  - Sollwerte = konfigurierte Parameter
  - Results = Ergebnisse der Auswertung
  - Farben: OK=grün, NOK=rot, WARN=gelb
- **Spätere Erweiterung:** Node-RED-ähnlicher visueller Editor für Auswertungs-Pipelines

#### 5.4 Eingebaute Standard-Auswertungen (Beispiele)

| Auswertung | Input | Output |
|-----------|-------|--------|
| Min/Max Wert | Kanal + Bereich | Min, Max, Position |
| Mittelwert | Kanal + Bereich | Durchschnitt, StdAbw |
| Schwellwert-Prüfung | Kanal + Soll-Bereich | OK/NOK + Abweichung |
| Fläche unter Kurve | Kanal + Bereich | Fläche (Integration) |
| Peak Detection | Kanal + Parameter | Anzahl Peaks, Positionen |

---

## 5. Abhängigkeiten & Risiken

### Technische Abhängigkeiten

| Von | Auf | Begründung |
|-----|-----|------------|
| Phase 2 | Phase 1 | Plot-Basis muss stabil sein |
| Phase 3 | Phase 1 | Value-Datenstrukturen müssen stehen |
| Phase 4 | Phase 1-3 | UX-Polish auf alle Bereiche |
| Phase 5 | Phase 1-3 | Auswertungen brauchen stabile Datenbasis + Tabellen |

### Risiken & Mitigationen

| Risiko | Auswirkung | Mitigation |
|--------|------------|------------|
| ECharts Graphic-Layer Performance bei vielen Circles | Plot wird langsam | Circle-Culling (nur sichtbare rendern), Level of Detail |
| ag-grid Community Einschränkungen | Features fehlen | Evaluierung ob Community ausreicht, ggf. Enterprise |
| Post-Process Security (User-Code ausführen) | XSS/Code Injection | Sandboxed Execution (Web Worker), kein `eval()` |
| Sehr viele Dateien (1000+) | Memory/Performance | Virtual Scrolling im TreeView, Pagination, Lazy Loading der Kurvendaten |

---

## Anhang: AMS ZPoint-CI Style-Spezifikation

### Farbcodierung (LineColor)

Die Farbe wird als einzelner Integer-Wert übergeben, berechnet nach der Formel:

```
Color = (Red × 65536) + (Green × 256) + Blue
```

Wobei Red, Green, Blue jeweils Werte von 0–255 annehmen.  
**Decodierung:** `R = (color >> 16) & 0xFF`, `G = (color >> 8) & 0xFF`, `B = color & 0xFF`

> **Achtung:** Dies ist **RGB**-Reihenfolge (R in den höchsten Bits), **nicht** BGR!

### LineStyle (1–10)

| Wert | Beschreibung | ECharts Dash-Pattern |
|------|-------------|---------------------|
| 1 | Durchgezogen `___________` | `'solid'` |
| 2 | Dichte Punkte `...........` | `[2, 2]` |
| 3 | Spaced Punkte `. . . . .` | `[2, 4]` |
| 4 | Weite Punkte `. . . .` | `[2, 8]` |
| 5 | Kurze Striche `- - - -` | `[6, 4]` |
| 6 | Mittlere Striche `-- -- --` | `[10, 4]` |
| 7 | Lange Striche `--- --- ---` | `[14, 4]` |
| 8 | Kurze Striche, weiter `- - -` | `[6, 8]` |
| 9 | Weite kurze Striche `- -` | `[6, 14]` |
| 10 | Weite mittlere Striche `-- --` | `[10, 10]` |

### LineThickness (1–5)

Direktes Mapping auf Pixelbreite — Wert 1 = dünnste Linie, Wert 5 = dickste Linie.

### Datenstruktur Gauge/Curves

Jeder Gauge enthält:
- `Curves[]` — Array von Kurven mit `Style` (LineColor, LineStyle, LineThickness), `Points[]` (X/Y/Z), `Figures[]` (Lines, Circles, Windows), `Limits[]`, `Values[]`
- `b_Ok` / `b_NOk` — Diagramm-Bewertung

---

## Anhang: ActSet Value Status-Mapping

### Globaler Messwertstatus (XML `<status>`)

Die XML/ZPG-Dateien liefern bei jedem Set/Actual Value einen numerischen `status`-Wert. Dieser wird wie folgt interpretiert:

| Status-Code | Bedeutung |
|-------------|-----------|
| 256 | Deaktiviert |
| 500 | Informativ |
| 501 | OK |
| 502 | NOK |
| 503 | NOK Upper Limit |
| 504 | NOK Lower Limit |

### Konvertierung → internes Mapping

Für die interne Verarbeitung wird der XML-Status auf einen vereinfachten Wert gemappt:

| Interner Status | Bedeutung | Anzeige in Tabellen |
|-----------------|-----------|---------------------|
| 0 | OK | Ja |
| 1 | Deactivated | **Nein** — Zeile wird ausgeblendet |
| 2 | NOK | Ja (farblich hervorgehoben) |

### Regeln

- **Status `deactivated` (1)** wird in den ActSet Value Tabellen **nicht angezeigt** — diese Zeilen werden beim Rendering gefiltert.
- **Status `NOK` (2)** wird visuell hervorgehoben (fett, Farbkodierung gemäß bestehender `isMarked`/NOK-Logik).
- **Weitere Status-Werte** werden im Zuge der **Post-Process Evaluations** (Phase 5) hinzukommen und das Mapping entsprechend erweitert.

---

## Anhang: Technologie-Entscheidungen

| Bereich | Gewählt | Begründung |
|---------|---------|------------|
| Plot-Library | **ECharts** | Canvas-basiert, beste Performance bei großen Datenmengen, SVG optional, Built-in Zoom/Pan/Tooltip |
| State Management | **Zustand** | Minimal, performant, kein Boilerplate, einfache Integration |
| Tabellen | **ag-grid Community** | Virtualisiertes Rendering, Pinned Columns, Built-in Export, kostenlos |
| Drag & Drop | **@dnd-kit** | Accessibility, Keyboard-Support, Touch, beliebige Sortier-Strategien |
| XML Parsing | **fast-xml-parser** | Schnellster JS XML Parser, konfigurierbare Array-Erkennung |
| ZIP Handling | **JSZip** | Bewährt, Streaming-fähig |
| Downsampling | **Custom LTTB** | Largest-Triangle-Three-Buckets — erhält visuell relevante Punkte |
