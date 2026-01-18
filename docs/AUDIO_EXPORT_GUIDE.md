# Audio Export Guide

This guide documents the audio export functionality in Storyteller, including MP3 export, SFX mixing, and subtitle generation.

## Overview

Storyteller allows users to download their completed stories as MP3 audio files with optional sound effects and synchronized subtitles.

## Features

### MP3 Export

Export your story narration as a high-quality MP3 file:

- **Narration Only**: Clean audio without sound effects (smaller file size)
- **Narration + SFX**: Full audio experience with ambient sounds and effects mixed in

### Subtitle Export

Export word-synchronized subtitles in industry-standard formats:

- **.SRT** (SubRip): Compatible with most media players
- **.VTT** (WebVTT): Web-native format for HTML5 video/audio

### Karaoke Highlighting

During web playback, karaoke-style highlighting shows:
- Current word highlighted with accent color
- Current line with subtle background highlight
- Smooth transitions that follow along with narration

## User Interface

### Reader Page Download

1. Open a story in the Reader
2. Click the **Download (⬇)** button in the top bar
3. Choose your preferred format:
   - **Download MP3 (Narration Only)** - Clean audio
   - **Download MP3 with Sound Effects** - Mixed audio (if SFX available)
   - **Download .SRT** / **Download .VTT** - Subtitles

### Export Modal

The export modal displays:
- Story title and metadata
- Number of scenes and total duration
- Available download options based on content

## API Reference

### Export Endpoints

#### GET /api/recordings/:id/export

Export a recording as downloadable file.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| includeSfx | boolean | false | Mix sound effects into audio |
| format | string | mp3 | Output format: `mp3`, `srt`, or `vtt` |

**Response:**
- **MP3**: `audio/mpeg` binary download
- **SRT**: `text/plain` subtitle file
- **VTT**: `text/vtt` subtitle file

**Example Requests:**
```bash
# Download narration only
GET /api/recordings/abc123/export

# Download with SFX
GET /api/recordings/abc123/export?includeSfx=true

# Download SRT subtitles
GET /api/recordings/abc123/export?format=srt

# Download VTT subtitles
GET /api/recordings/abc123/export?format=vtt
```

#### GET /api/recordings/:id/export-info

Get metadata about available export options.

**Response:**
```json
{
  "recordingId": "abc123",
  "title": "The Dragon's Quest",
  "duration": 1800,
  "segmentCount": 15,
  "hasSfx": true,
  "hasWordTimings": true,
  "availableFormats": ["mp3"],
  "subtitleFormats": ["srt", "vtt"]
}
```

## Technical Details

### Audio Assembly

The export system uses FFmpeg for professional audio processing:

1. **Segment Collection**: Gathers all audio segments from the recording
2. **Crossfade Transitions**: Applies smooth transitions between speakers
3. **Normalization**: Ensures consistent volume levels
4. **SFX Mixing**: Overlays sound effects at correct timestamps

### Assembly Presets

| Preset | Crossfade | Gap | Narrator Gap | Use Case |
|--------|-----------|-----|--------------|----------|
| natural | 100ms | 250ms | 350ms | General narration |
| bedtime | 200ms | 400ms | 500ms | Calm, soothing stories |
| dramatic | 50ms | 150ms | 200ms | Action/drama |
| raw | 0ms | 0ms | 0ms | Testing |

### Subtitle Generation

Subtitles are generated from word timing data:

1. Words are grouped into ~5 second cues
2. Timestamps are calculated from cumulative segment durations
3. Output is formatted per specification (SRT or VTT)

**SRT Format Example:**
```
1
00:00:00,000 --> 00:00:05,230
Once upon a time in a kingdom far away

2
00:00:05,230 --> 00:00:10,450
there lived a young dragon named Ember
```

**VTT Format Example:**
```
WEBVTT

1
00:00:00.000 --> 00:00:05.230
Once upon a time in a kingdom far away

2
00:00:05.230 --> 00:00:10.450
there lived a young dragon named Ember
```

## Sound Effects Integration

### How SFX Works

1. **Recording**: SFX data is stored per-segment with timing information
2. **Web Playback**: SFX plays via separate audio layer (can be toggled)
3. **Export**: SFX is mixed into audio file at correct timestamps

### SFX Toggle During Playback

During web playback, sound effects can be toggled on/off via the SFX button. This does not affect exports - users choose SFX inclusion at download time.

### Export SFX Options

- **Narration Only**: No sound effects included
- **With Sound Effects**: SFX mixed at recorded timestamps and volumes

## Reader Settings

Settings that affect the reading experience are persisted across sessions:

| Setting | Default | Description |
|---------|---------|-------------|
| theme | dark | Color theme (dark, light, sepia, midnight) |
| fontSize | 20px | Text size (14-32px) |
| fontFamily | georgia | Font face |
| lineHeight | 1.8 | Line spacing |
| playbackSpeed | 1.0x | Audio playback rate |
| syncHighlight | true | Enable karaoke highlighting |
| autoPlayNext | true | Auto-advance to next scene |

Settings are stored in `localStorage` under `storyteller_reader_settings`.

## Fullscreen Mode

Enter fullscreen mode for distraction-free reading:

1. Click the **Fullscreen** button in the top bar
2. Controls auto-hide and appear on tap/hover
3. Press **Escape** or click exit button to leave fullscreen

In fullscreen mode:
- Top bar slides away when hidden
- Reading area expands with adjusted padding
- All karaoke highlighting continues working

## Troubleshooting

### Export Fails

- **No recording available**: Story must have completed generation with audio
- **Audio file not found**: Some audio files may be missing; try regenerating
- **FFmpeg not available**: Server needs FFmpeg installed for advanced features

### Subtitles Out of Sync

- Word timings are generated during TTS synthesis
- Minor drift can occur in long recordings
- SRT/VTT files can be edited in text editor to adjust

### Large File Downloads

- Long stories (30+ minutes) may take time to assemble
- Consider downloading narration-only for smaller file size
- Check browser download progress for status

## Browser Compatibility

Export functionality is tested on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Fullscreen API requires modern browser support.
