# 手机端单词音频剪映批次操作说明

本目录只用于剪映人工导出准备。本阶段不要覆盖正式 MP3，也不要修改手机端映射。

## 已确认的生产参数

- 每条字幕使用固定 8 秒时槽；起点依次为 0、8、16 秒。
- 源 SRT 相邻时槽无额外空档，但剪映生成的实际朗读应在下一条固定起点前结束，剩余时间就是防串音安全区。
- 源 SRT 不额外添加开头或结尾静音。后续切分以剪映导出的 SRT 实际起止时间为准。
- 后续 FFmpeg 将复用 Laundry 已验证参数：首尾静音保护裁切、`-18 LUFS / -2 dBTP`、24 kHz、单声道、64 kbps MP3。
- 项目记录无法证明最终剪映音色的具体名称：**需要用户在剪映中选择与 Laundry 相同的声音**。不要根据代码中的浏览器 voice 或火山 speaker 名称猜测。

## 每批最少人工步骤

1. 在剪映中新建一个空项目。
2. 导入本批对应的 SRT，确认字幕正文只有英文词或完整词组。
3. 选择与 Zoo、Fruit Shop、Laundry 当前成品一致的英文声音；本项目无法从证据确认具体音色名称。
4. 对全部字幕执行文本朗读，保持统一声音和默认时间顺序。
5. 不添加背景音乐、音效、变速、降噪、转场或其他处理。
6. 一次导出纯音频，同时保留/导出剪映实际生成的匹配 SRT。
7. 使用下表建议文件名，将 MP3 和 SRT 放入对应临时导出目录。
8. 不要逐条切分、命名或移动，也不要直接覆盖 `assets/audio`。后续由 FFmpeg 自动核对、切分、静音处理、响度统一和校验。

## 批次与导出位置

| 批次 | 主题 | 数量 | 导入 SRT | 建议导出 MP3 | 建议导出 SRT | 临时目录 |
|---:|---|---:|---|---|---|---|
| 1 | campus | 77 | `tmp/capcut-mobile-word-batches/01-campus-77.srt` | `01-campus-77-capcut-export.mp3` | `01-campus-77-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/01-campus-77/` |
| 2 | cafe | 77 | `tmp/capcut-mobile-word-batches/02-cafe-77.srt` | `02-cafe-77-capcut-export.mp3` | `02-cafe-77-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/02-cafe-77/` |
| 3 | airport | 85 | `tmp/capcut-mobile-word-batches/03-airport-85.srt` | `03-airport-85-capcut-export.mp3` | `03-airport-85-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/03-airport-85/` |
| 4 | office | 78 | `tmp/capcut-mobile-word-batches/04-office-78.srt` | `04-office-78-capcut-export.mp3` | `04-office-78-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/04-office-78/` |
| 5 | hotel | 78 | `tmp/capcut-mobile-word-batches/05-hotel-78.srt` | `05-hotel-78-capcut-export.mp3` | `05-hotel-78-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/05-hotel-78/` |
| 6 | restaurant | 78 | `tmp/capcut-mobile-word-batches/06-restaurant-78.srt` | `06-restaurant-78-capcut-export.mp3` | `06-restaurant-78-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/06-restaurant-78/` |
| 7 | supermarket | 78 | `tmp/capcut-mobile-word-batches/07-supermarket-78.srt` | `07-supermarket-78-capcut-export.mp3` | `07-supermarket-78-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/07-supermarket-78/` |
| 8 | metro | 78 | `tmp/capcut-mobile-word-batches/08-metro-78.srt` | `08-metro-78-capcut-export.mp3` | `08-metro-78-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/08-metro-78/` |
| 9 | clinic | 78 | `tmp/capcut-mobile-word-batches/09-clinic-78.srt` | `09-clinic-78-capcut-export.mp3` | `09-clinic-78-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/09-clinic-78/` |
| 10 | bank | 78 | `tmp/capcut-mobile-word-batches/10-bank-78.srt` | `10-bank-78-capcut-export.mp3` | `10-bank-78-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/10-bank-78/` |
| 11 | apartment | 78 | `tmp/capcut-mobile-word-batches/11-apartment-78.srt` | `11-apartment-78-capcut-export.mp3` | `11-apartment-78-capcut-export.srt` | `tmp/capcut-mobile-word-batches/exports/11-apartment-78/` |

## 导出完成后的校验原则

- 每批 MP3 与导出 SRT 必须同时存在，文本和顺序必须与对应 JSON 完全一致。
- 自动导入前先验证条数、固定起点、实际结束点、旧目标路径和运行时映射。
- 任一批条数或文本不一致时停止，不强行切分。
- 当前 JSON 中 `finalTargetAudioPath` 与现有手机端映射路径一致，但本阶段绝不覆盖。

