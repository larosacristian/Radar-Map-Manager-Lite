# Firmware per 2 LD6004 e un ESP32-C3

Questo esempio ESPHome pubblica in Home Assistant le coordinate X/Y/Z fino a tre bersagli per ciascun radar, la presenza, il numero di bersagli e alcuni controlli di calibrazione. La mappa e le zone virtuali sono gestite separatamente da Radar Map Manager Lite.

## Prima di iniziare

- Richiede **ESPHome 2026.11 beta o successiva** con componente `ld6004` integrato. Nella versione stabile 2026.10 l'integrazione `ld6004` non è presente. Se non vuoi utilizzare una beta, attendi il rilascio stabile prima di compilare.
- Il file `dual_ld6004_esp32c3.yaml` è un **modello generico** per `esp32-c3-devkitm-1` e per le schede che espongono davvero i GPIO 4, 5, 6 e 7. Verifica il pinout del modello esatto e le periferiche eventualmente collegate a quei pin.
- Servono alimentazione adatta, cavetto USB dati, ESPHome Device Builder (beta), Home Assistant e due sensori HLK-LD6004.
- Non collegare gli elettrodomestici direttamente all'ESP; la presenza deve guidare automazioni Home Assistant solo dopo averne provato i falsi positivi e l'assenza di rilevamento.

## Collegamenti proposti

| ESP32-C3 (esempio) | LD6004 sinistro | LD6004 destro |
|---|---|---|
| GPIO4 TX | RX0, pin 3 | — |
| GPIO5 RX | TX0, pin 4 | — |
| GPIO6 TX | — | RX0, pin 3 |
| GPIO7 RX | — | TX0, pin 4 |
| GND | GND, pin 6 o 10 | GND, pin 6 o 10 |
| Alimentatore esterno 3,3 V stabilizzato | 3.3V, pin 1 o 7 | 3.3V, pin 1 o 7 |

**Attenzione:** ogni LD6004 richiede **3,1–3,5 V**, non 5 V; può assorbire fino a **600 mA**. Due radar possono quindi richiedere 1,2 A complessivi (escluso l'ESP32). Usa un alimentatore 3,3 V ben stabilizzato con margine sufficiente, ad esempio 2 A o superiore, con masse in comune. Non alimentare due moduli dal pin 3V3 della scheda C3 senza aver verificato il regolatore. Non collegare fra loro i TX dei radar. Non collegare le due alimentazioni 3,3 V di sorgenti diverse senza un progetto elettrico appropriato.

Pin e alimentazione del modulo: [documentazione ESPHome LD6004](https://next.esphome.io/components/sensor/ld6004/).

## Prima installazione

1. In Home Assistant apri **ESPHome Device Builder (beta)**. È necessario per il supporto LD6004 finché la versione stabile non lo include.
2. Crea un nuovo dispositivo ESP32-C3 e apri il suo editor YAML.
3. Sostituisci la configurazione con il contenuto di [`dual_ld6004_esp32c3.yaml`](dual_ld6004_esp32c3.yaml), adeguando il modello della scheda e i GPIO solo dopo averli identificati.
4. In `secrets.yaml` di ESPHome inserisci localmente (mai su GitHub):

   ```yaml
   wifi_ssid: "IL_TUO_WIFI_2_4_GHZ"
   wifi_password: "PASSWORD_WIFI_DA_INSERIRE"
   radar_api_key: "CHIAVE_BASE64_GENERATA_LOCALMENTE"
   ```

   La chiave `radar_api_key` dev'essere una chiave **base64 di 32 byte**. Il Device Builder può averne già generata una quando hai creato il dispositivo: riutilizza quella per questo dispositivo. Altrimenti puoi generarla su un computer con `openssl rand -base64 32`. Non usare la stringa di esempio. Conserva la chiave perché Home Assistant la richiederà.
5. Fai **Validate**. Risolvi gli eventuali errori prima di procedere; non ignorare errori su `ld6004` (di solito indicano una versione ESPHome troppo vecchia).
6. Collega via **USB dati** l'ESP32-C3 al computer, premi **Install** e scegli il metodo seriale/USB (oppure scarica il `.bin` e usa [ESPHome Web](https://web.esphome.io/) da Chrome/Edge). Al primo caricamento serve il cavo; i successivi possono avvenire via rete.
7. In **Impostazioni → Dispositivi e servizi → ESPHome**, aggiungi il dispositivo rilevato e inserisci la chiave API se richiesta.

## Controllo degli stati

In **Strumenti per sviluppatori → Stati** cerca queste entità (i nomi precisi possono cambiare se modifichi `friendly_name` o se HA possiede nomi precedenti):

```text
binary_sensor.room_radar_left_presence
binary_sensor.room_radar_right_presence
sensor.room_radar_left_target_count
sensor.room_radar_right_target_count
sensor.room_radar_left_target_1_x
sensor.room_radar_left_target_1_y
sensor.room_radar_left_target_1_z
sensor.room_radar_right_target_1_x
sensor.room_radar_right_target_1_y
sensor.room_radar_right_target_1_z
```

Con una sola persona che si muove nella stanza, almeno uno dei contatori deve cambiare e, se il radar la traccia, anche le coordinate X/Y/Z. Quando una traccia non è attiva, alcune coordinate potrebbero risultare `unknown`; non interpretare `unknown` come zero.

**Nota sui nomi:** l'esempio usa `friendly_name: Room` per favorire gli entity ID `room_radar_left_*` e `room_radar_right_*` richiesti dal JSON demo. Controlla sempre gli entity ID effettivi in Home Assistant: la loro creazione e i suffissi dipendono anche dal registro entità già esistente.

## Collegamento a Radar Map Manager Lite

1. In **Strumenti per sviluppatori → Azioni** esegui l'azione `radar_map_manager.add_radar` due volte, una con `radar_name: room_radar_left`, una con `radar_name: room_radar_right`, entrambe con `map_group: default`.
2. Usa la scheda Lovelace `type: custom:radar-map-card` / `map_group: default`.
3. Se desideri la pianta dimostrativa di 10 × 4 m, importa il JSON in `examples/dual_radar_room_10x4.json` **solo dopo aver salvato la configurazione precedente**: l'importazione sostituisce le mappe esistenti.
4. Calibra un radar per volta. Montaggio side a 2,5 m: verifica che le coordinate e le rotazioni della mappa corrispondano a persone in punti noti, poi calibra la fusione dell'area tavolo. Le aree hardware `detection_area_0/1` sono distinte dalle zone virtuali della mappa.
5. Solo dopo aver verificato l'affidabilità, abilita gli esempi di automazione luci / RGB, sostituendo gli entity ID dimostrativi con le vere luci di casa.

Se i sensori non pubblicano coordinate, verifica: alimentazione 3,3 V, massa in comune, TX/RX incrociati, modo radar `normal`, switch `Coordinate Reporting` acceso, UART 115200 8N1, log ESPHome e antenna rivolta verso l'area da rilevare.

## Privacy e sicurezza

Il firmware comunica con Home Assistant mediante API ESPHome cifrata e aggiorna l'ESP tramite OTA cifrata usando la stessa chiave. Non avvia server web, server UDP, invii cloud o servizi di discovery esterni al normale ESPHome. Il repository contiene solo segnaposto pubblici, mai credenziali. Perdita della chiave richiede una nuova configurazione/flash fisico.

**Stato del collaudo:** configurazione verificata con documentazione tecnica, ma non ancora compilata nel Device Builder beta e non testata su hardware reale. Le coordinate e il risultato di presenza non vanno usati per applicazioni di sicurezza.
