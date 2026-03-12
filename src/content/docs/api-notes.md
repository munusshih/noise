---
title: 資料來源筆記 / API Notes
---

## 如何閱讀這個面板 / How to Read This Panel

- `即時 / Live`：直接向 API 抓資料；如果連線失敗或來源暫時沒有資料，系統會退回快照，避免聲音中斷。
- `快照 / Snapshot`：使用先前儲存或內建的樣本資料，適合展演、教學與不穩定網路環境。
- `欄位 → 聲音參數`：每個來源都會把一組資料欄位翻成振幅、頻率、相位、偏移、時長、包絡與調變。
- `為什麼算噪音`：這裡的噪音不是「錯誤訊號」，而是環境、治理、基礎設施與尺度差異在同一系統中的殘響。

## 快速對照 / Quick Glossary

- `振幅 / Amplitude`：音量與壓力感。
- `頻率 / Frequency`：音高中心。
- `相位 / Phase`：訊號時間偏移，會影響波形起點與震動感。
- `偏移 / Offset`：讓聲波中心上下偏移，增加偏壓感。
- `時長 / Duration`：每一筆資料停留多久。
- `包絡 / Envelope`：聲音的起音與收尾速度。
- `調變 / Modulation`：波動、擺動、顫動的速度與深度。

## 資料源 / Sources

### USGS 全球地震 / USGS Global Earthquakes

- API：App 先抓 `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson`，再從內部 state 播放排序後的事件。
- 主要欄位 / Fields：`mag`, `depth`, `ageHours`
- 映射 / Mapping：`mag → amplitude / frequency / duration`，`depth → envelope / offset`，`ageHours → phase / modulation`
- 為什麼是噪音 / Why it reads as noise：地殼一直在滑動與釋放能量；把地震當成噪音，是承認穩定本身只是人的感官假設。

### 台灣區域地震 / Taiwan Regional Quakes (CWA-scale)

- API：`https://earthquake.usgs.gov/fdsnws/event/1/query?...&minlatitude=21&maxlatitude=26&minlongitude=119&maxlongitude=123`
- 主要欄位 / Fields：`mag`, `depth`, `ageHours`
- 映射 / Mapping：和全球地震相同，但時間窗與地理範圍縮到台灣。
- 為什麼是噪音 / Why it reads as noise：把尺度縮小後，地殼活動更像區域性的日常背景，而不是單次災變。

### 台大建物 / NTU Buildings (WFS)

- API：`https://map.ntu.edu.tw/geontupublic/wfs?...typeName=ntu_build_name...`
- 主要欄位 / Fields：`x`, `y`, `minuteOfDay`
- 映射 / Mapping：`x → frequency / offset`，`y → phase / modulation`，`minuteOfDay → duration / envelope / amplitude`
- 為什麼是噪音 / Why it reads as noise：固定建物在不同時間帶來不同的聆聽壓力，校園不是中性背景，而是慢速運轉的聲學機器。

### 台北噪音站 / Taipei Noise Stations

- API：Taipei Open Data CSV，經 `allorigins` 代理抓取。
- 主要欄位 / Fields：`zone`, `lon`, `minute`, `stationId`
- 映射 / Mapping：`zone → amplitude / duration`，`lon → frequency / phase`，`minute → offset / modulation / envelope`
- 為什麼是噪音 / Why it reads as noise：誰被量測、如何分區、哪些區域被命名為干擾，本身就是治理技術。

### 台北雨量 / Taipei Rain

- API：`https://wic.heo.taipei/OpenData/API/Rain/Get?...`，經 `allorigins` 代理抓取。
- 主要欄位 / Fields：`rain`, `stationNo`, `recTime`
- 映射 / Mapping：`rain → amplitude / frequency`，`stationNo → phase / offset`，`recTime → duration / modulation / envelope`
- 為什麼是噪音 / Why it reads as noise：雨把路面、排水、交通與行人全部拖進同一個底噪層，讓自然和基礎設施一起發聲。

### 台灣 AQI / Taiwan AQI

- API：`https://data.moenv.gov.tw/api/v2/aqx_p_432?...`
- 主要欄位 / Fields：`aqi`, `pm2.5`, `o3_8hr`, `pm10`, `publishtime`
- 映射 / Mapping：`aqi → amplitude / frequency`，`pm2.5 → offset / envelope`，`o3_8hr → modulation / phase`，`publishtime → duration`
- 為什麼是噪音 / Why it reads as noise：污染常常不可見，但身體會長期承受；這種慢性背景就是生態噪音。

### 亞洲 AQI / WAQI Asia

- API：`https://api.waqi.info/search/?token=demo&keyword=Asia`
- 主要欄位 / Fields：`aqi`, `uid`, `stime | vtime`, `station`
- 映射 / Mapping：`aqi → amplitude / frequency`，`uid → phase / offset`，`time → duration / modulation / envelope`
- 為什麼是噪音 / Why it reads as noise：跨城市比較不是為了單一真相，而是讓被測量的危機與未被承認的危機疊在一起。

### 氣象模型 / Open-Meteo

- API：`https://api.open-meteo.com/v1/forecast?...`
- 主要欄位 / Fields：`temperature_2m`, `precipitation`, `wind_speed_10m`
- 映射 / Mapping：`temperature → frequency / amplitude`，`precipitation → offset / envelope`，`wind → modulation / duration / phase`
- 為什麼是噪音 / Why it reads as noise：天氣不是舞台背景，而是持續改寫你如何感知世界的生成器。

### 事件時間線 / GDELT

- API：`https://api.gdeltproject.org/api/v2/doc/doc?...mode=TimelineVolRaw...`
- 主要欄位 / Fields：`count`, `dayIndex`, `dayOfMonth`
- 映射 / Mapping：`count → amplitude / frequency`，`dayIndex → phase / duration`，`dayOfMonth → offset / modulation / envelope`
- 為什麼是噪音 / Why it reads as noise：新聞事件被命名與被放大的方式，本身就是政治語言的頻譜。

### 太空天氣 / NASA DONKI

- API：`https://api.nasa.gov/DONKI/notifications?...`
- 主要欄位 / Fields：`messageBody length`, `messageType hash`, `issueTime`
- 映射 / Mapping：`body length → amplitude / frequency`，`issueTime age → duration / envelope`，`messageType hash → offset / modulation`，`minute → phase`
- 為什麼是噪音 / Why it reads as noise：遠方宇宙擾動被翻成通知流，顯示太空事件如何滲進地球技術系統。

### 宇宙敘事 / NASA APOD

- API：`https://api.nasa.gov/planetary/apod?...`
- 主要欄位 / Fields：`explanation length`, `title length`, `day`, `media_type hash`
- 映射 / Mapping：`explanation → amplitude / duration`，`title → frequency / envelope`，`day → phase / modulation`，`media_type → offset`
- 為什麼是噪音 / Why it reads as noise：宇宙資料往往必須靠文字敘事才能進入日常，翻譯過程本身就是一層噪音。

### 系外行星 / NASA Exoplanet Archive

- API：Exoplanet Archive TAP，經 `r.jina.ai` 代理取回 JSON。
- 主要欄位 / Fields：`pl_bmasse`, `pl_orbper`, `disc_year`
- 映射 / Mapping：`mass → frequency / amplitude`，`orbital period → duration / modulation`，`discovery year → phase / offset / envelope`
- 為什麼是噪音 / Why it reads as noise：當不可感的遠距天體被資料化，我們面對的是尺度轉譯的噪音，而不是純粹的天文真實。
