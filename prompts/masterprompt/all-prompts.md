# All Prompts - Gemini K07 Long Script Workflow

## 01 - Nap ngu canh cho Gemini

```text
Hay luu toan bo noi dung ben duoi thanh tai lieu tham chieu chinh cho cua so chat nay.

Tu gio, moi yeu cau lien quan den kenh/video nay phai bam theo:
1. Chu de kenh
2. Tep nguoi xem
3. Promise cua kenh
4. Research pack
5. Visual direction
6. Tone of voice
7. Cac dieu can tranh
8. Tieu chuan chat luong script

Khong duoc viet chung chung. Khong duoc bia thong tin ngoai du lieu da nap. Neu thieu du lieu, hay hoi lai hoac ghi ro phan can bo sung.

DU LIEU THAM CHIEU:
[paste promise + audience + research + competitor insight + visual direction]
```

## 02 - Tao Master Script Prompt

```text
Act as a senior YouTube script strategist and long-form AI video producer.

Using the reference material above, create a MASTER SCRIPT PROMPT for this channel.

The master prompt must guide future script writing and include:
1. Channel mission
2. Target audience
3. Core emotional promise
4. Content format
5. Tone of voice
6. Script structure
7. Hook rules
8. Section rules
9. Visual anchor rules
10. Factual accuracy rules
11. Things to avoid
12. Output format

The script must be suitable for long-form voiceover and AI video production.

Return the master prompt in English.
```

## 03 - Tao outline kich ban dai

```text
Use the master prompt and selected topic below.

MASTER PROMPT:
[paste master prompt]

SELECTED TOPIC:
[paste topic]

RESEARCH PACK:
[paste research]

Create a detailed long-form YouTube script outline.

Requirements:
1. Use 5-7 sections depending on the topic.
2. Each section must have a clear purpose.
3. Each section must include one central visual anchor.
4. The opening must create curiosity or emotional tension without clickbait.
5. The structure must support retention from beginning to end.
6. Do not write the full script yet.

Return:
- Video title idea
- Core promise of this video
- Hook angle
- Section-by-section outline
- Visual anchor for each section
- Emotional beat for each section
- Estimated voiceover length
```

## 04 - Viet full script dai

```text
Use the master prompt, research pack, and outline below.

MASTER PROMPT:
[paste master prompt]

RESEARCH PACK:
[paste research]

OUTLINE:
[paste outline]

Write a long-form YouTube voiceover script.

Requirements:
1. Write in [English/Vietnamese].
2. Use [6/7] sections.
3. Each section should be around [target word count] words.
4. Write for natural voiceover, not for a blog post.
5. Use concrete visual anchors in every section.
6. Include emotional beats and soft transitions.
7. Avoid generic self-help phrases.
8. Avoid Wikipedia-style reading.
9. Do not invent facts outside the research pack.
10. End with a quiet reflective close, not a loud CTA, unless the format requires CTA.

Return for each section:
- Section title
- Voiceover script
- Visual notes
- Emotional beat
```

## 05 - Viet tung section

```text
Continue writing ONLY Section [number] of the long-form script.

CONTEXT:
[paste master prompt + outline + previous section summary]

SECTION TO WRITE:
[paste section title/purpose]

Requirements:
1. Around [target word count] words.
2. Keep the same tone and pacing as previous sections.
3. Include specific objects, actions, places, and sensory details.
4. Make the section easy to convert into image/video prompts.
5. End with a soft transition into the next section.
6. Do not summarize. Write the actual voiceover.

Return:
- Section title
- Voiceover script
- Visual anchor
- Transition line
```

## 06 - QA kich ban

```text
Act as a strict YouTube script editor and AI video production director.

CHANNEL PROMISE:
[paste promise]

AUDIENCE INSIGHT:
[paste insight]

RESEARCH PACK:
[paste research]

SCRIPT:
[paste script]

Evaluate:
1. Does the script match the channel promise?
2. Is the hook strong but not misleading?
3. Are all claims supported by the research?
4. Does each section have a clear visual anchor?
5. Are there generic, preachy, or Wikipedia-like lines?
6. Does it sound natural as voiceover?
7. Which parts may hurt retention?
8. Which lines should be cut or rewritten?

Return:
- Critical issues
- Section-by-section notes
- Lines to cut
- Lines to rewrite
- Improved version of the weakest section
```

## 07 - Chuyen script thanh voice co pause

```text
Convert the script below into a voiceover script with natural pauses.

Rules:
1. Keep the original meaning.
2. Add pause markers like [pause 0.5s], [pause 1.0s], [pause 1.3s].
3. Use longer pauses after emotionally heavy lines.
4. Keep sentences easy to pronounce.
5. Avoid overly long sentences.
6. Do not change the structure unless necessary for voice flow.

SCRIPT:
[paste script]
```

## 08 - Chia script thanh script node

```text
Use the script section below and break it into production-ready script nodes.

SCRIPT SECTION:
[paste section]

Rules:
1. Each node should match 1 small voiceover beat.
2. Do not split mechanically by sentence. Split by visual moment.
3. Each node must be easy to turn into an image or video prompt.
4. Keep the order of the original script.
5. Mark whether the node should be: still image, pan/zoom, AI video, or real footage.

Return a table:
- Node number
- Script node
- Voice beat summary
- Visual idea
- Suggested asset type
- Motion note if needed
```
