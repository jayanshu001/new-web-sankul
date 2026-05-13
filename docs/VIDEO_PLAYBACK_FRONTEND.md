# Video Playback — Frontend (React Native) Integration Guide

## What the backend gives you

For each Video in the category list response, the relevant fields are:

```ts
type VideoItem = {
  _id: string;
  title: string;
  platform: "youtube" | "aws";
  qualities: Array<{
    label: string;   // "1080p" | "720p" | "360p" | "auto"
    height: number;  // 1080 | 720 | 360 | 0 (0 means "player decides", HLS)
    url: string;     // directly playable URL
  }>;
  default: string;   // label of the recommended initial quality
  // ...other Video fields
};
```

**Key principle:** The frontend does NOT need to branch on `platform` for
playback. Every `qualities[i].url` is directly playable by a native player.

The only place `platform` matters is the UI for the quality picker — see
[Quality Picker UX](#quality-picker-ux) below.

---

## Required dependencies

Use `react-native-video` (or `expo-av` if you're on Expo). Both support
HLS (`.m3u8`) and MP4 out of the box on iOS and Android.

```bash
yarn add react-native-video
# iOS: cd ios && pod install
```

Android: ensure ExoPlayer's HLS extension is enabled. With
`react-native-video` ≥ 6, it's included by default.

No special headers are needed — the proxy URL is self-authenticating
via the HMAC token in the query string.

---

## Minimal player component

```tsx
import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import Video from "react-native-video";

type Quality = { label: string; height: number; url: string };

type Props = {
  qualities: Quality[];
  defaultLabel: string;
};

export function LecturePlayer({ qualities, defaultLabel }: Props) {
  const initial = useMemo(
    () => qualities.find((q) => q.label === defaultLabel) ?? qualities[0],
    [qualities, defaultLabel]
  );
  const [selected, setSelected] = useState<Quality>(initial);

  if (!selected) return <Text>No playable source.</Text>;

  return (
    <View style={{ flex: 1 }}>
      <Video
        source={{ uri: selected.url }}
        style={{ width: "100%", aspectRatio: 16 / 9 }}
        controls
        resizeMode="contain"
        // Important: don't restart from 0 when switching qualities.
        // Persist `currentTime` and seek back after source change.
      />

      {qualities.length > 1 && (
        <QualityPicker
          qualities={qualities}
          selected={selected}
          onPick={setSelected}
        />
      )}
    </View>
  );
}

function QualityPicker({
  qualities,
  selected,
  onPick,
}: {
  qualities: Quality[];
  selected: Quality;
  onPick: (q: Quality) => void;
}) {
  return (
    <View style={{ flexDirection: "row", padding: 8, gap: 8 }}>
      {qualities.map((q) => (
        <TouchableOpacity
          key={q.label}
          onPress={() => onPick(q)}
          style={{
            padding: 8,
            backgroundColor: q.label === selected.label ? "#000" : "#eee",
            borderRadius: 6,
          }}
        >
          <Text style={{ color: q.label === selected.label ? "#fff" : "#000" }}>
            {q.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
```

That's it. The same component plays YouTube (proxied) and S3 HLS videos.

---

## Seamless quality switching

Switching `source.uri` on `<Video>` resets playback to 0. To keep position:

```tsx
const playerRef = useRef<VideoRef>(null);
const positionRef = useRef(0);

<Video
  ref={playerRef}
  source={{ uri: selected.url }}
  onProgress={(p) => { positionRef.current = p.currentTime; }}
  onLoad={() => { playerRef.current?.seek(positionRef.current); }}
  ...
/>
```

When the user picks a new quality, `selected` changes → the new source
loads → `onLoad` fires → we seek back to where they were.

---

## Quality Picker UX

| Item | What `qualities[]` looks like | What to show |
|---|---|---|
| YouTube | Multiple entries: `1080p`, `720p`, `480p`, `360p`, ... | A picker. Default highlighted. User picks. |
| AWS (HLS) | Single entry: `{ label: "auto", height: 0, url: ".m3u8" }` | NO picker — hide it. The player auto-adapts via HLS. |

Helper rule: if `qualities.length === 1 && qualities[0].label === "auto"`,
hide the picker.

---

## Error handling

Things that can go wrong and how to handle them in `onError`:

| Symptom | Most likely cause | UX |
|---|---|---|
| 403 from a YouTube URL | The HMAC token expired (>6h since list call). | Refetch the list to get fresh tokens; reload player. |
| 502 from a YouTube URL | YouTube didn't return that specific itag this time. | Fall back to the next-lower quality in `qualities[]`. |
| 401 from any URL | Proxy is mis-wired behind auth on the backend. | Bug — report. Should never happen if backend is correct. |
| Network error | Connectivity / server down. | Standard retry. |

Concrete fallback handler:

```tsx
const onError = useCallback((e: any) => {
  console.log("playback error", e);
  const currentIdx = qualities.findIndex((q) => q.label === selected.label);
  const next = qualities[currentIdx + 1]; // next-lower quality
  if (next) setSelected(next);
  else showToast("Playback failed.");
}, [qualities, selected]);
```

---

## What the frontend should NOT do

- ❌ Don't try to embed YouTube via `react-native-youtube-iframe`. That's the
  thing we explicitly moved away from. The whole point of the proxy is to
  use your own native player.
- ❌ Don't hit `googlevideo.com` URLs directly. You never see them — only
  proxy URLs. If you somehow get a `googlevideo.com` URL, it's a backend bug.
- ❌ Don't add `Authorization` headers to the player's URL request. The
  HMAC token in the query string IS the authorization. Native players
  often can't send custom headers anyway.
- ❌ Don't cache `qualities[].url` longer than 6h. The HMAC token expires.
  Refetch the list when needed.

---

## Migration checklist for existing screens

If you currently embed YouTube via iframe or `react-native-youtube-iframe`:

1. Replace the YouTube embed component with `LecturePlayer` above.
2. Pass `qualities` + `default` directly from the list response. No more
   `youtube_id` is needed on the client.
3. Remove any logic that decrypts a `videoURL` field — the backend now
   returns plain URLs in `qualities[].url`.
4. If you used a separate detail-fetch endpoint for AWS, you can either:
   - Keep it (it returns the same `qualities[]` shape — easy port), or
   - Use the list response directly if it already contains what you need.
5. Test on both iOS and Android with at least one YouTube video and one
   AWS HLS video. Confirm:
   - YouTube plays without 403 / Cannot Open errors.
   - AWS HLS shows no quality picker but plays adaptively.
   - Quality switching on a YouTube video resumes from the previous
     timestamp (within ~1s).

---

## Quick smoke test

```bash
# Fetch the list:
curl -H "Authorization: Bearer <token>" \
  https://api.example.com/api/v1/client/video-categories/<id>/videos

# Pick a qualities[i].url from a YouTube item and hit it directly:
curl -I "<that url>"
# Expect: 200 OK with Content-Type: video/mp4 and Accept-Ranges: bytes.
```

If the curl works, the RN player will work.
