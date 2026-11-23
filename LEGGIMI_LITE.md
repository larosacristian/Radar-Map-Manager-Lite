# Radar Map Manager Lite — Guida in italiano

Questa è una versione generica e locale di Radar Map Manager per integrare uno o più radar in Home Assistant tramite ESPHome. È derivata dal progetto MIT [Moe8383/radar_map_manager](https://github.com/Moe8383/radar_map_manager), tag v1.3.12. Licenza e attribuzione conservate.

## Funzioni

- Mappa interattiva dall'alto con posizione dei bersagli.
- Fusione dei bersagli visti da più radar, zone virtuali, conteggio persone e sensori di occupazione.
- Calibrazione software di posizione, rotazione, altezza di montaggio e scale.
- Visualizzazione dell'altezza solo quando è disponibile una vera coordinata Z.
- Esempi di automazioni luci e scene RGB, indipendenti dai radar.
- Editor visuale delle piantine con misure in metri, pareti, porte, finestre e mobili. Funziona anche senza radar e salva in Home Assistant.

La mappa è **2D con eventuale quota Z**; non ricostruisce pareti o mobili in 3D.

## Sicurezza

Nessuna porta UDP aperta, nessun comando MQTT, nessun abbinamento proprietario, PIN memorizzato, controllo diretto via IP o aggiornamento firmware cloud. L'integrazione legge solamente le entità di Home Assistant. L'importazione elimina i vecchi campi hardware e altre chiavi sconosciute.

Sono stati eseguiti test unitari e verifiche statiche; **manca il collaudo con Home Assistant e radar reali**. Non usare gli avvisi di caduta come sistema di sicurezza.

## Installazione

1. Esegui un **backup completo di Home Assistant**.
2. Se hai già Radar Map Manager originale, sostituisci la sua cartella: i due progetti condividono il dominio `radar_map_manager` e non possono coesistere. Se HACS gestisce l'originale, evita che lo reinstalli automaticamente.
3. Installa il repository da **HACS → ⋮ → Repository personalizzati → Integrazione** e scarica.
4. Riavvia Home Assistant.
5. In **Impostazioni → Dispositivi e servizi** aggiungi **Radar Map Manager Lite (ESPHome)** (se già configurato, usa l'istanza esistente).
6. In una dashboard aggiungi una scheda Manuale:

   ```yaml
   type: custom:radar-map-card
   map_group: default
   ```

### Disegnare la stanza senza ESP32

La schermata **Impostazioni → Dispositivi e servizi → Radar Map Manager Lite** mostra l'hub e le entità: l'editor non è lì. Lo trovi aprendo la **scheda Radar Map** che hai inserito nella dashboard al punto 6.

1. Dopo aver aggiornato l'integrazione a **1.4.0**, **riavvia Home Assistant** e ricarica completamente la pagina della dashboard (Ctrl+F5 da PC).
2. Nella scheda premi **🏠** in alto a destra, vicino all'ingranaggio **⚙️**. Il disegno si apre anche quando non ci sono radar.
3. Inserisci le misure in metri, ad esempio **10 m di lunghezza × 4 m di larghezza**, e premi **Applica dimensioni**.
4. Seleziona **Parete**, **Porta** o **Finestra**, poi clicca il punto iniziale e quello finale sul disegno. Per aggiungere **Divano**, **Tavolo**, **Cucina**, ecc., basta un clic.
5. Usa **Seleziona / sposta** per trascinare gli oggetti, oppure inserisci coordinate e dimensioni esatte nei campi dell'elemento selezionato.
6. Premi **Salva in Home Assistant**. Pareti e arredi compariranno come sfondo della mappa e rimarranno salvati ai riavvii di HA.

Sono disponibili **Annulla ultima modifica**, **Elimina selezionato**, griglia con aggancio a 10 cm, **Esporta JSON** e **Importa JSON**. Per iniziare con una stanza dimostrativa scarica [`examples/floorplan_10x4.json`](examples/floorplan_10x4.json), quindi usa **Importa JSON** nell'editor. L'importazione tramite editor cambia solo la piantina: non cancella radar, zone o altre configurazioni.

Nota: le tre zone di presenza (sinistra, centro e destra) sono gestite separatamente dalle pareti e dai mobili. Finché l'ESP32 e i radar non sono programmati, puoi costruire la piantina ma non vedrai persone o distanze in tempo reale. La visualizzazione è **2D dall'alto**.

Se usi l'installazione manuale, copia `custom_components/radar_map_manager` in `/config/custom_components/radar_map_manager` e riavvia HA.

## Entità ESPHome necessarie

Per un radar identificato da `room_radar_left`:

```text
sensor.room_radar_left_target_1_x
sensor.room_radar_left_target_1_y
sensor.room_radar_left_target_1_z   # facoltativo
```

Sono supportati più bersagli (`target_2`, `target_3`, ecc.). Le unità devono essere corrette: `mm`, `cm` o `m`. Se il firmware pubblica solo `sensor.room_radar_left_distance`, puoi mostrare una distanza indicativa, ma non determinare una zona laterale in modo affidabile.

Da **Strumenti per sviluppatori → Azioni** esegui `radar_map_manager.add_radar`:

```yaml
radar_name: room_radar_left
map_group: default
```

Ripeti per ogni altro radar. Il prefisso deve coincidere esattamente con quello delle entità ESPHome.

## Mappa di esempio per due radar

Il file `examples/dual_radar_room_10x4.json` è **dimostrativo**, non è una planimetria reale:

| Zona | Intervallo x nella mappa |
|---|---|
| area_left | 0–35% |
| area_center | 35–65% |
| area_right | 65–100% |

I radar di esempio sono in posizione centrale e orientati verso lati opposti, con altezza iniziale di 2,5 m. Le rotazioni (±90°), le scale e i confini delle zone devono essere adattati alle dimensioni, al montaggio e al comportamento dei tuoi dispositivi.

Per importare la mappa: copia il contenuto JSON ed esegui `radar_map_manager.import_config`, campo `config_json`. **Attenzione: sostituisce la configurazione delle mappe esistenti.**

Sensori di esempio dopo l'importazione:

```text
binary_sensor.rmm_default_area_left_occupancy
binary_sensor.rmm_default_area_center_occupancy
binary_sensor.rmm_default_area_right_occupancy
sensor.rmm_default_area_left_count
sensor.rmm_default_area_center_count
sensor.rmm_default_area_right_count
sensor.rmm_default_master
```

Verifica con una persona in ogni zona che posizione e occupazione siano corrette. Regola la distanza di fusione per evitare duplicati dove due radar si sovrappongono. Prova anche lo spegnimento di un radar per verificare la rimozione delle tracce.

## Automazioni

In `examples/occupancy_lighting.yaml` e `examples/rgb_scenes.yaml` trovi esempi con entità volutamente inventate (prefisso `demo_`). **Sostituiscile** prima di abilitarli. Per gli elettrodomestici usa la presenza come condizione supplementare, non come unico comando di accensione.

Non sono inserite informazioni private, indirizzi di rete, credenziali o dettagli di abitazioni reali.
