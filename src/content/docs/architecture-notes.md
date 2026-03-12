---
title: 系統架構筆記 / Architecture Notes
---

## 這個專案實際上在做什麼

這不是單純把 API 數字接到一個 `oscillator` 上而已。整個系統比較像一個 `multi-track data sonification engine`：

1. 每條 `track` 各自選一個 `data source`
2. 資料被整理成統一格式 `SourceDatum`
3. `SourceDatum` 再被翻譯成 `SynthesisFrame`
4. `SynthesisFrame` 交給 `Web Audio` 產生聲音
5. 同一條 track 的資料軌跡、聲音參數、實際波形會一起被畫出來

簡化後的資料流如下：

```txt
UI
  -> track-ui.ts
  -> track-datasource.ts
  -> SynthesisFrame
  -> track-engine.ts
  -> AudioContext / ChannelMergerNode / destination
  -> track-visualizer.ts
```

## Core modules

- `track-state.ts`
  定義 `Track`、`TrackRuntime`、`SynthesisFrame`、`DataSourceId`。這裡是整個系統的 shared schema。
- `track-ui.ts`
  負責 DOM、按鈕、滑桿、track card 組裝，以及使用者操作和 state 之間的橋接。
- `track-datasource.ts`
  負責抓 API、做 cache、live/snapshot fallback、把每一筆資料轉成 `SynthesisFrame`。
- `track-engine.ts`
  負責 `AudioContext`、multi-channel routing、`ChannelMergerNode`、speaker channel 分配。
- `track-visualizer.ts`
  負責 canvas 繪圖，把 `dataBuffer`、`synthBuffer`、`AnalyserNode` 的結果畫成可讀的監看畫面。

## Speaker detection 其實是什麼

比較精確地說，這個專案不是在瀏覽器裡「辨識哪一顆實體喇叭叫什麼名字」，而是偵測目前 `audio output device` 可提供幾個 `output channels`，然後把每條 track 明確送到指定 channel。

瀏覽器端可用的關鍵資訊是：

- `AudioDestinationNode.maxChannelCount`
- `destination.channelCount`
- `destination.channelCountMode = "explicit"`
- `destination.channelInterpretation = "discrete"`

這代表系統做的是 `channel routing`，不是 `device discovery`.

## 怎麼知道可以分到幾個聲道

在 `getAudioContext()` 裡，系統會在真正需要聲音時才建立 `AudioContext`。這有兩個原因：

- 避免頁面一開就碰到 browser 的 `autoplay / user gesture` 限制
- 只有在 audio engine 啟動後，`destination.maxChannelCount` 才有意義

啟動後它會：

```txt
1. create AudioContext
2. read destination.maxChannelCount
3. cap to 8 channels
4. set destination to explicit + discrete
5. create ChannelMergerNode(maxChannels)
```

這裡的上限 `8` 是工程上保守的 cap，不是 Web Audio 的理論極限。

## 怎麼把不同 track 分到不同 speaker

每條 track 的 audio graph 大致是：

```txt
source
  -> GainNode
  -> AnalyserNode
  -> ChannelMergerNode[input = outputChannel]
  -> destination
```

關鍵概念：

- `GainNode`
  控制該 track 的 volume。
- `AnalyserNode`
  不只拿來畫圖，也讓 UI 可以看到真正送出去的 waveform。
- `ChannelMergerNode`
  每個 input 對應一個離散輸出 channel。
- `outputChannel`
  是 `Track` 裡的欄位，表示該 track 要送到第幾個 speaker channel。

所以這裡的「分軌」不是 stereo pan，而是更硬的 `discrete output routing`。`Track 1 -> Ch 1`、`Track 2 -> Ch 2`、`Track 3 -> Ch 3` 這樣的方式，比較接近 installation 或 multi-speaker setup。

如果使用者改了輸出聲道，`rerouteTrack()` 會把舊的 analyser connection 拔掉，再接回新的 merger input。

## 為什麼有時候系統只看到 2 channels

這不是 app 算錯，通常是 OS / device routing 的限制：

- macOS 預設常常只提供 stereo output
- 如果沒有選到 `Aggregate Device` 或多聲道 audio interface，browser 只會回報 `2`
- 所以 app 能做的是尊重當前 device 的 `maxChannelCount`

也就是說，這個系統會「讀取目前可用的 channel 數」，但不會越過作業系統替你創造額外 speaker。

## 資料如何進來

每個資料來源最後都被整理成 `SourceDatum`，這個格式的目的，是讓不同 API 在進入聲音引擎之前先變成同一種語言。

`SourceDatum` 會包含：

- `inputKey`
- `inputLabel`
- `inputValue`
- `norm`
- `baseFrequency`
- `context`
- `metrics`
- `sourceMode`

這代表地震、AQI、天氣、NASA、校園建物雖然來自完全不同的 API，進到 sonification 層時都會長得很像。

## Live / Snapshot fallback 怎麼做

這一層的關鍵不是「有抓到就播」，而是「不要因為 API 掛掉整條 track 失聲」。

系統的策略是：

1. 如果使用者選 `live`，先跑 `primaryLoader()`
2. 若 live 資料為空或 fetch 失敗，改跑 `fallbackLoader()`
3. `fallbackLoader()` 會回到 `snapshot`
4. 成功抓到 live 資料後，會把可用資料存回 `localStorage`

對應的重要概念：

- `snapshot` 是可播放的備援資料，不只是 demo 假資料
- `SNAPSHOT_KEY = "noise.track.snapshots.v1"` 用來持久化最近一次可用資料
- live source 每輪播完之後，系統才 refresh 下一批資料，避免每個 tick 都重新 fetch

這個設計讓作品在展演現場、網路不穩、API rate limit、CORS 不穩定的情況下，還是可以繼續發聲。

## API 怎麼翻成聲音

真正的翻譯核心在 `track-datasource.ts` 的 `_buildSynthesisFrame()`。

它不是只算一個 `frequency`，而是一次產生完整的 `SynthesisFrame`：

- `amplitude`
- `frequency`
- `phase`
- `offset`
- `duration`
- `envelopeAttack`
- `envelopeRelease`
- `modulationRate`
- `modulationDepth`

所以一筆資料不是對應一個音高而已，而是對應一個完整的時間性聲音事件。

## Mapping 不是固定模板，而是 source-specific

每個 `data source` 都有自己的 mapping 邏輯。例如：

- 地震 `earthquake`
  `mag -> amplitude / frequency / duration`
  `depth -> envelope / offset`
  `age -> phase / modulation`
- 空污 `taiwan_aqi`
  `aqi -> amplitude / frequency`
  `pm25 -> offset / envelope`
  `o3 -> modulation / phase`
- 建物 `ntu_buildings`
  `x -> frequency`
  `y -> offset / modulation`
  `code / minute -> duration / envelope / amplitude`

這件事很重要，因為這個系統不是 generic dashboard sonifier，而是每個 source 都有自己的聲學語法。

## Normalization 怎麼做

資料不能直接拿原值進合成器，不然不同 API 的尺度會完全失衡。這裡先用 `InputMetric` 的：

- `value`
- `min`
- `max`
- `affects`

把欄位 normalize 到 `0..1`，再進一步計算 synthesis parameter。

如果欄位沒有明確範圍，系統會退回比較保守的 normalization 邏輯，而不是讓極端值直接把整條 track 炸掉。

## `pitch` 與 `speed` 怎麼介入

這兩個不是資料來源欄位，而是使用者對翻譯器本身做的二次控制。

- `pitch`
  透過 `Math.pow(2, pitch / 12)` 做 `semitone` 級的 frequency scaling
- `speed`
  同時影響：
  - `tick interval`
  - `duration scaling`
  - live/snapshot 的播放節奏

所以 `speed` 不是單純快轉 UI，而是直接改變資料進入聲音系統的節拍密度。

## 為什麼有 `discrete` 和 `continuous` 兩種聲音模式

這兩種模式對應兩種不同的資料時間觀：

- `discrete`
  把每一筆資料當成一個 event，產生一個新的 note / gesture
- `continuous`
  維持一個持續發聲的 voice，讓新資料只去 morph 參數

技術上差很多：

### `discrete` mode

每次都會建立新的：

- `OscillatorNode`
- `GainNode` envelope
- `LFO` (`OscillatorNode` + `GainNode`)
- `ConstantSourceNode` for `DC offset`

它比較像 event-based synthesis。

### `continuous` mode

系統會保留一組長存的 `continuousVoice`：

- `osc`
- `lfo`
- `lfoGain`
- `env`
- `offsetSource`
- `offsetGain`

新資料進來時，不重建整個 voice，而是用 `setTargetAtTime()` 去平滑地改變 frequency、detune、amplitude、modulation 等參數。

這樣聽起來會比較像同一個聲體在變形，而不是一顆一顆的 note。

## `offset` 是怎麼做的

很多作品只做 `frequency` 和 `amplitude`，這個專案多做了一個 `offset`，讓波形中心產生偏移。

技術上不是直接去改 raw sample，而是另外建立：

- `ConstantSourceNode`
- `offsetGain`

再把這條 DC-like path 混到 track 的 `GainNode`。這能讓某些資料在聲學上帶出偏壓、傾斜、壓迫感，而不只是一個乾淨的 pitch change。

## `modulation` 是怎麼做的

`modulationRate` 和 `modulationDepth` 會被送到一組 `LFO`：

```txt
LFO OscillatorNode -> GainNode -> main oscillator frequency
```

所以資料欄位不只改主頻率，也改變主頻率如何被晃動。這讓資料變成一種 texture，而不是只有 melody。

## 視覺化不是裝飾，是 debug / reading tool

`track-visualizer.ts` 其實是整套系統的 instrumentation layer。

它同時畫三種東西：

1. `source-specific visualizer`
   例如 earthquake ring、NTU coordinate trace、AQI network pattern
2. `synthesis parameter timeline`
   讓你看 `amp / freq / phase / offset / duration / envelope / modulation`
3. `oscilloscope`
   同時畫 `actual waveform` 和 `model wave`

這裡的 `actual waveform` 來自 `AnalyserNode`，不是純理論值，所以可以檢查 routing 與 synthesis 是否真的有發生。

## 為什麼要分開 `Track` 和 `TrackRuntime`

這個 separation 是架構上很關鍵的一點：

- `Track`
  可序列化、可編輯、屬於 UI / configuration state
- `TrackRuntime`
  不可序列化、只存在於 audio engine 執行時，包含真正的 Web Audio nodes

這樣做的好處：

- UI state 比較乾淨
- track card 可以重畫而不必把 node graph 塞進 DOM state
- reroute / stop / remove 時可以精準清掉 runtime，不污染 track config

## 為什麼要保留 `dataBuffer`、`synthBuffer`、`latestFrame`

這三層資料用途不同：

- `dataBuffer`
  保留原始輸入值趨勢
- `synthBuffer`
  保留翻譯後的聲音參數歷史
- `latestFrame`
  給 mapping panel、wave model、文字狀態使用

如果只有最後一個數字，你只能聽到結果，無法檢查 translation 過程。這些 buffer 讓系統可以被閱讀、被 debug、也被展示。

## 跟外部 API 整合時的實務處理

不是每個資料源都直接有乾淨 JSON 或良好 CORS，因此這個專案有一些 pragmatic adapter：

- 部分 CSV / third-party source 會經過 `allorigins`
- 某些文字或表格型資料會透過 `r.jina.ai`
- `CACHE` 會避免每次都重抓同樣資料
- `LIVE_SERIES` 會保留最近一段 live sequence，讓資料視覺化與播放更穩定

這部分很 backend，但它其實直接決定作品能不能穩定運作。

## 目前這套架構最重要的限制

- Browser 只能知道 `channel count`，不能知道每顆 speaker 的真實身份與空間位置
- multi-channel 是否成功，仍依賴 OS audio routing 與外部硬體
- 某些 public API 可能會改 schema、限流、失效，所以 `snapshot fallback` 不是可有可無
- 現在的 mapping 是 hand-crafted rules，不是 machine learning model

這些限制不是缺點而已，它們其實也是作品的一部分：資料、平台、硬體、治理規則一起決定了你最後聽到什麼。

## 如果之後要擴充，最應該怎麼做

新增新資料源時，最穩的方式不是直接在 UI 加下拉選單，而是照這個順序做：

1. 在 `track-state.ts` 增加新的 `DataSourceId`
2. 在 `track-datasource.ts` 寫 `loadXxx()`，把外部資料整理成 `SourceDatum`
3. 在 `_buildSynthesisFrame()` 加上該 source 的 mapping 規則
4. 在 `track-visualizer.ts` 補一個對應的 source-specific visualizer
5. 補 `snapshot` 資料，確保離線或 API 失敗時仍可播放

這樣新增的 source 才會同時具備：

- 聲音
- 視覺化
- fallback
- 可讀的 mapping
- 可維護的架構位置
