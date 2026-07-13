import type { GameType } from "../../../shared/protocol";

type ArtworkKind = GameType | "hero-table-tennis" | "hero-racing" | "hero-bowling";

const artworkUrls: Record<GameType, string> = {
  racing: new URL("../assets/launcher/card-racing.webp", import.meta.url).href,
  "table-tennis": new URL("../assets/launcher/card-table-tennis.webp", import.meta.url).href,
  bowling: new URL("../assets/launcher/card-bowling.webp", import.meta.url).href,
  tennis: new URL("../assets/launcher/card-tennis.webp", import.meta.url).href,
  "rhythm-battle": new URL("../assets/launcher/card-rhythm-battle.webp", import.meta.url).href,
  "controller-test": new URL("../assets/launcher/card-controller-test.webp", import.meta.url).href
};

const heroArtworkUrls: Partial<Record<ArtworkKind, string>> = {
  "hero-table-tennis": new URL("../assets/launcher/hero-table-tennis.webp", import.meta.url).href,
  "table-tennis": new URL("../assets/launcher/hero-table-tennis.webp", import.meta.url).href
};

function stadiumBackground(id: string): string {
  return `
    <defs>
      <linearGradient id="${id}-sky" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#AEEBFF"/>
        <stop offset="0.56" stop-color="#EAFBFF"/>
        <stop offset="1" stop-color="#D9F8CE"/>
      </linearGradient>
      <linearGradient id="${id}-grass" x1="0" x2="1">
        <stop offset="0" stop-color="#74E7A1"/>
        <stop offset="1" stop-color="#22C978"/>
      </linearGradient>
      <linearGradient id="${id}-sun" x1="0" x2="1">
        <stop offset="0" stop-color="#FFD94A"/>
        <stop offset="1" stop-color="#FF9F1C"/>
      </linearGradient>
      <filter id="${id}-soft" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#0E74A0" flood-opacity=".18"/>
      </filter>
    </defs>
    <rect width="640" height="360" rx="28" fill="url(#${id}-sky)"/>
    <circle cx="532" cy="58" r="28" fill="url(#${id}-sun)"/>
    <circle cx="532" cy="58" r="44" fill="#FFD94A" opacity=".2"/>
    <g opacity=".34" stroke="#168CF2" stroke-width="4">
      <path d="M24 104c86-62 167-69 245-20s161 41 260-24"/>
      <path d="M28 132c96-48 172-47 238 3s152 48 288-13"/>
    </g>
    <g opacity=".72">
      <rect x="38" y="122" width="90" height="46" rx="8" fill="#55C6F5"/>
      <rect x="136" y="105" width="118" height="63" rx="9" fill="#7BDCF7"/>
      <rect x="416" y="112" width="114" height="58" rx="9" fill="#65CFF4"/>
      <rect x="536" y="130" width="62" height="38" rx="7" fill="#94E8FF"/>
    </g>
    <g fill="#16345B" opacity=".18">
      <circle cx="72" cy="170" r="7"/><circle cx="96" cy="168" r="7"/><circle cx="120" cy="171" r="7"/>
      <circle cx="450" cy="170" r="7"/><circle cx="474" cy="168" r="7"/><circle cx="498" cy="171" r="7"/>
    </g>
    <path d="M0 250c98-45 213-60 346-42 94 13 192 35 294 69v83H0z" fill="url(#${id}-grass)"/>
    <path d="M0 238c138 28 245 29 320 4 96-33 202-36 320-8v44c-121-29-229-27-323 7-83 30-189 27-317-8z" fill="#FFFFFF" opacity=".68"/>
  `;
}

function racingArtwork(hero: boolean): string {
  const id = hero ? "hero-racing" : "card-racing";
  return `
    <svg class="pa-art-svg" viewBox="0 0 640 360" role="img" aria-label="Stylized racing car on a bright arena track">
      ${stadiumBackground(id)}
      <g filter="url(#${id}-soft)">
        <path d="M70 252c82-70 190-117 324-142 94-17 157-3 188 36 32 40-2 88-102 143" fill="none" stroke="#FFD76B" stroke-width="22" stroke-linecap="round"/>
        <path d="M76 252c86-61 194-101 324-121 84-13 137-3 159 29 24 34-10 73-102 119" fill="none" stroke="#59C7F8" stroke-width="10" stroke-linecap="round"/>
        <path d="M92 249c100-47 195-74 286-80 74-5 134 1 180 18" fill="none" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round" opacity=".88"/>
        <path d="M440 236l134-22" stroke="#25AEEB" stroke-width="15" stroke-dasharray="18 14"/>
        <g transform="translate(246 131) rotate(-9)">
          <path d="M48 63c20-31 64-47 130-48l71 20c11 3 18 12 19 24l2 24H24c3-7 11-14 24-20z" fill="#FF9F1C"/>
          <path d="M84 35h93l37 15H61c5-6 13-11 23-15z" fill="#FF665E"/>
          <path d="M130 18c25 0 42 12 50 34h-85c4-21 15-32 35-34z" fill="#16345B"/>
          <rect x="0" y="76" width="292" height="13" rx="6" fill="#16345B"/>
          <circle cx="58" cy="91" r="31" fill="#203755"/>
          <circle cx="230" cy="91" r="31" fill="#203755"/>
          <circle cx="58" cy="91" r="12" fill="#9DE8FF"/>
          <circle cx="230" cy="91" r="12" fill="#9DE8FF"/>
          <path d="M52 57c45-13 103-20 174-22" stroke="#16345B" stroke-width="8"/>
        </g>
      </g>
      <g fill="#FF665E"><circle cx="91" cy="71" r="6"/><circle cx="166" cy="50" r="5"/><circle cx="581" cy="87" r="6"/></g>
    </svg>
  `;
}

function tableTennisArtwork(hero: boolean): string {
  const id = hero ? "hero-paddle" : "card-paddle";
  return `
    <svg class="pa-art-svg" viewBox="0 0 640 360" role="img" aria-label="Cartoon table tennis athlete swinging a paddle">
      ${stadiumBackground(id)}
      <g filter="url(#${id}-soft)">
        <path d="M96 232h392l-40 71H55z" fill="#168CF2"/>
        <path d="M115 225h414l-41 36H74z" fill="#25D3ED"/>
        <path d="M300 230v63" stroke="#FFFFFF" stroke-width="8" stroke-dasharray="10 9"/>
        <path d="M345 118c-68 39-103 78-104 117" fill="none" stroke="#FFFFFF" stroke-width="16" stroke-linecap="round" opacity=".86"/>
        <path d="M349 116c-70 42-107 83-110 122" fill="none" stroke="#FF75B5" stroke-width="7" stroke-linecap="round"/>
        <circle cx="414" cy="82" r="44" fill="#FFFFFF"/>
        <circle cx="414" cy="82" r="28" fill="#FFE87A"/>
        <g transform="translate(280 84)">
          <circle cx="63" cy="45" r="31" fill="#8C4B32"/>
          <path d="M28 92c13-27 33-41 59-42 33 6 53 26 62 60l-35 26-79-7z" fill="#FFFFFF"/>
          <path d="M70 56c17 5 31 20 42 45" stroke="#168CF2" stroke-width="20" stroke-linecap="round"/>
          <path d="M48 111c-21 9-41 22-59 39" stroke="#F5A46B" stroke-width="18" stroke-linecap="round"/>
          <path d="M113 87c24-10 48-14 72-12" stroke="#F5A46B" stroke-width="18" stroke-linecap="round"/>
          <g transform="translate(174 48) rotate(20)">
            <rect x="24" y="50" width="14" height="58" rx="7" fill="#8C4B32"/>
            <circle cx="31" cy="37" r="34" fill="#FF665E"/>
            <circle cx="31" cy="37" r="23" fill="#FF9F1C"/>
          </g>
          <path d="M38 35c15-32 64-38 87 1-25-7-51-5-87-1z" fill="#16345B"/>
          <circle cx="53" cy="47" r="4" fill="#16345B"/><circle cx="77" cy="48" r="4" fill="#16345B"/>
          <path d="M54 65c12 8 24 8 36 0" stroke="#16345B" stroke-width="5" stroke-linecap="round"/>
        </g>
        <g transform="translate(102 118) scale(.8)">
          <circle cx="64" cy="34" r="24" fill="#6B8BC6"/>
          <path d="M32 73c12-24 31-36 56-36 24 5 41 19 50 43l-31 25-60-5z" fill="#FFCF33"/>
          <path d="M91 66l62-20" stroke="#FF8D4D" stroke-width="14" stroke-linecap="round"/>
        </g>
      </g>
    </svg>
  `;
}

function bowlingArtwork(hero: boolean): string {
  const id = hero ? "hero-bowling" : "card-bowling";
  return `
    <svg class="pa-art-svg" viewBox="0 0 640 360" role="img" aria-label="Bowling ball rolling toward pins in a bright arena">
      ${stadiumBackground(id)}
      <g filter="url(#${id}-soft)">
        <path d="M92 284c144-72 286-80 426-24" fill="none" stroke="#FFE08A" stroke-width="45" stroke-linecap="round"/>
        <path d="M100 281c128-54 261-61 398-19" fill="none" stroke="#FFFFFF" stroke-width="28" stroke-linecap="round"/>
        <circle cx="230" cy="206" r="58" fill="#38BDF8"/>
        <circle cx="207" cy="184" r="8" fill="#FFFFFF"/><circle cx="228" cy="177" r="7" fill="#FFFFFF"/><circle cx="224" cy="202" r="6" fill="#FFFFFF"/>
        <g transform="translate(365 109)">
          <path d="M34 14h28l8 150H26z" fill="#FFFFFF"/>
          <path d="M41 62h23" stroke="#FF665E" stroke-width="12"/>
          <path d="M100 0h28l8 164H92z" fill="#FFFFFF"/>
          <path d="M107 62h23" stroke="#25D3ED" stroke-width="12"/>
          <path d="M166 24h28l8 140h-44z" fill="#FFFFFF"/>
          <path d="M173 79h23" stroke="#FFC72D" stroke-width="12"/>
        </g>
      </g>
    </svg>
  `;
}

function tennisArtwork(): string {
  return `
    <svg class="pa-art-svg" viewBox="0 0 640 360" role="img" aria-label="Tennis player swinging on a sunny court">
      ${stadiumBackground("card-tennis")}
      <g filter="url(#card-tennis-soft)">
        <path d="M94 263h452l-82 62H130z" fill="#2BB7F4"/>
        <path d="M320 256v59" stroke="#FFFFFF" stroke-width="7"/>
        <circle cx="462" cy="95" r="30" fill="#D7FF5A"/>
        <path d="M428 103c-94 22-156 65-186 129" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" fill="none" opacity=".86"/>
        <path d="M431 103c-94 24-156 67-186 130" stroke="#FF9F1C" stroke-width="6" stroke-linecap="round" fill="none"/>
        <g transform="translate(226 113)">
          <circle cx="62" cy="36" r="28" fill="#9B5B3F"/>
          <path d="M38 79c11-23 29-35 54-36 26 6 43 23 52 51l-26 27-68-8z" fill="#FFFFFF"/>
          <path d="M83 68l72-32" stroke="#F5A46B" stroke-width="16" stroke-linecap="round"/>
          <path d="M42 98l-48 46" stroke="#F5A46B" stroke-width="16" stroke-linecap="round"/>
          <ellipse cx="174" cy="25" rx="38" ry="24" fill="none" stroke="#16345B" stroke-width="9" transform="rotate(-22 174 25)"/>
          <path d="M142 39l-24 20" stroke="#16345B" stroke-width="9" stroke-linecap="round"/>
          <path d="M40 30c12-29 56-37 82-3-24-5-48-3-82 3z" fill="#16345B"/>
        </g>
      </g>
    </svg>
  `;
}

function rhythmArtwork(): string {
  return `
    <svg class="pa-art-svg" viewBox="0 0 640 360" role="img" aria-label="Colorful rhythm bars and dancers in a music sport arena">
      ${stadiumBackground("card-rhythm")}
      <g filter="url(#card-rhythm-soft)">
        <path d="M102 274c132-80 286-83 462-7" fill="none" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round" opacity=".78"/>
        <g transform="translate(159 113)">
          <rect x="0" y="70" width="54" height="118" rx="26" fill="url(#card-rhythm-bar1)"/>
          <rect x="80" y="22" width="64" height="166" rx="31" fill="url(#card-rhythm-bar2)"/>
          <rect x="174" y="58" width="58" height="130" rx="29" fill="url(#card-rhythm-bar3)"/>
        </g>
        <defs>
          <linearGradient id="card-rhythm-bar1" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#FF665E"/><stop offset="1" stop-color="#2BB7F4"/></linearGradient>
          <linearGradient id="card-rhythm-bar2" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#FF77A8"/><stop offset="1" stop-color="#168CF2"/></linearGradient>
          <linearGradient id="card-rhythm-bar3" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#FF9F1C"/><stop offset="1" stop-color="#25D3ED"/></linearGradient>
        </defs>
        <path d="M436 129v88m0-88c25 12 46 10 64-6v86" stroke="#16345B" stroke-width="14" stroke-linecap="round" fill="none"/>
        <circle cx="436" cy="223" r="22" fill="#FFC72D"/><circle cx="500" cy="214" r="22" fill="#FF665E"/>
      </g>
    </svg>
  `;
}

function controllerArtwork(): string {
  return `
    <svg class="pa-art-svg" viewBox="0 0 640 360" role="img" aria-label="Phone controller with bright button indicators">
      ${stadiumBackground("card-controller")}
      <g filter="url(#card-controller-soft)">
        <rect x="173" y="128" width="294" height="140" rx="52" fill="#DDF7FF" stroke="#97DDF9" stroke-width="8"/>
        <rect x="223" y="177" width="26" height="26" rx="4" fill="#168CF2"/>
        <rect x="266" y="177" width="26" height="26" rx="4" fill="#168CF2"/>
        <circle cx="394" cy="186" r="20" fill="#FF665E"/>
        <circle cx="438" cy="205" r="16" fill="#FFC72D"/>
        <path d="M207 115c28-35 195-38 226-2" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" opacity=".9"/>
        <path d="M162 90c-22 18-36 38-43 62m356-66c28 16 46 37 54 65" stroke="#25D3ED" stroke-width="8" stroke-linecap="round" opacity=".8"/>
      </g>
    </svg>
  `;
}

export function createSportArtwork(kind: ArtworkKind, compact = false): HTMLDivElement {
  const art = document.createElement("div");
  art.className = `pa-art ${compact ? "is-compact" : "is-hero"} pa-art-${kind}`;
  const src = compact ? artworkUrls[kind as GameType] : heroArtworkUrls[kind] ?? artworkUrls[kind as GameType];
  if (src) {
    const img = document.createElement("img");
    img.className = "pa-art-img";
    img.src = src;
    img.alt = "";
    img.decoding = "async";
    img.loading = "eager";
    art.appendChild(img);
    return art;
  }
  const hero = !compact;
  if (kind === "racing" || kind === "hero-racing") art.innerHTML = racingArtwork(hero);
  else if (kind === "table-tennis" || kind === "hero-table-tennis") art.innerHTML = tableTennisArtwork(hero);
  else if (kind === "bowling" || kind === "hero-bowling") art.innerHTML = bowlingArtwork(hero);
  else if (kind === "tennis") art.innerHTML = tennisArtwork();
  else if (kind === "rhythm-battle") art.innerHTML = rhythmArtwork();
  else art.innerHTML = controllerArtwork();
  return art;
}
