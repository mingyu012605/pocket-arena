import type { GameType } from "../../../shared/protocol";

type ArtworkKind = GameType | "hero-table-tennis" | "hero-racing" | "hero-bowling";

const artworkUrls: Partial<Record<GameType, string>> = {
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

function sketchRelayArtwork(hero: boolean): string {
  const id = hero ? "hero-sketch-relay" : "card-sketch-relay";
  return `
    <svg class="pa-art-svg" viewBox="0 0 640 360" role="img" aria-label="Sketch Relay drawing party with pencils and paper">
      <defs>
        <linearGradient id="${id}-bg" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#FFE8A3"/>
          <stop offset=".52" stop-color="#DDF7FF"/>
          <stop offset="1" stop-color="#FFD6E7"/>
        </linearGradient>
        <filter id="${id}-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="16" stdDeviation="12" flood-color="#7C3AED" flood-opacity=".18"/>
        </filter>
      </defs>
      <rect width="640" height="360" rx="28" fill="url(#${id}-bg)"/>
      <g opacity=".45" fill="none" stroke-linecap="round">
        <path d="M44 72c44-28 86-28 126 0s83 28 130 0" stroke="#38BDF8" stroke-width="9"/>
        <path d="M378 78c29-24 67-24 115 0s78 24 91 0" stroke="#FB7185" stroke-width="8"/>
        <path d="M63 288c86-50 164-48 235 8s157 50 258-18" stroke="#22C55E" stroke-width="10"/>
      </g>
      <g filter="url(#${id}-soft)">
        <rect x="176" y="66" width="292" height="224" rx="24" fill="#FFFDF7" stroke="#FDE68A" stroke-width="10"/>
        <path d="M214 116h176M214 154h128M214 226h178" stroke="#CBD5E1" stroke-width="9" stroke-linecap="round"/>
        <path d="M235 192c32-35 75-35 99 0 22 30 66 28 92-8" fill="none" stroke="#0EA5E9" stroke-width="13" stroke-linecap="round"/>
        <g transform="translate(104 199) rotate(-22)">
          <rect x="0" y="24" width="178" height="34" rx="17" fill="#FACC15"/>
          <path d="M168 24l42 17-42 17z" fill="#92400E"/>
          <path d="M183 31l27 10-27 10z" fill="#111827"/>
          <rect x="20" y="24" width="42" height="34" rx="12" fill="#FB7185"/>
        </g>
        <g transform="translate(430 182) rotate(19)">
          <rect x="0" y="18" width="138" height="30" rx="15" fill="#38BDF8"/>
          <path d="M130 18l35 15-35 15z" fill="#92400E"/>
          <path d="M144 24l21 9-21 9z" fill="#111827"/>
          <rect x="15" y="18" width="36" height="30" rx="11" fill="#A78BFA"/>
        </g>
        <circle cx="143" cy="106" r="25" fill="#22C55E"/>
        <circle cx="497" cy="104" r="21" fill="#FB7185"/>
        <text x="320" y="272" text-anchor="middle" font-family="Arial, sans-serif" font-size="33" font-weight="900" fill="#334155">SKETCH RELAY</text>
      </g>
    </svg>
  `;
}

function pocketGolfArtwork(hero: boolean): string {
  const id = hero ? "hero-pocket-golf" : "card-pocket-golf";
  return `
    <svg class="pa-art-svg" viewBox="0 0 640 360" role="img" aria-label="Pocket Golf golfer on a sunny tropical resort course">
      <defs>
        <linearGradient id="${id}-sky" x1="0" x2="0" y1="0" y2="1">
          <stop stop-color="#1AA9FF"/>
          <stop offset=".5" stop-color="#7FE1FF"/>
          <stop offset="1" stop-color="#DDF7FF"/>
        </linearGradient>
        <linearGradient id="${id}-fairway" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#D8FF75"/>
          <stop offset=".42" stop-color="#77E85F"/>
          <stop offset="1" stop-color="#1FBF72"/>
        </linearGradient>
        <linearGradient id="${id}-green" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#E9FF80"/>
          <stop offset="1" stop-color="#80E84F"/>
        </linearGradient>
        <linearGradient id="${id}-cart" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#FFE55A"/>
          <stop offset=".54" stop-color="#FFC21F"/>
          <stop offset="1" stop-color="#FF9216"/>
        </linearGradient>
        <linearGradient id="${id}-hair" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#27D6EF"/>
          <stop offset=".55" stop-color="#078FC2"/>
          <stop offset="1" stop-color="#075985"/>
        </linearGradient>
        <radialGradient id="${id}-sun" cx="50%" cy="50%" r="50%">
          <stop stop-color="#FFF7B8"/>
          <stop offset=".75" stop-color="#FFD84D"/>
          <stop offset="1" stop-color="#FF9F1C"/>
        </radialGradient>
        <filter id="${id}-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="16" stdDeviation="10" flood-color="#1267CF" flood-opacity=".22"/>
        </filter>
        <filter id="${id}-fast-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="10" stdDeviation="5" flood-color="#082F49" flood-opacity=".28"/>
        </filter>
      </defs>
      <rect width="640" height="360" rx="28" fill="url(#${id}-sky)"/>
      <circle cx="535" cy="56" r="35" fill="url(#${id}-sun)"/>
      <circle cx="535" cy="56" r="58" fill="#FFF2A5" opacity=".28"/>
      <path d="M0 198c82-44 154-46 215-5 54 36 112 35 174-4 81-51 164-48 251 9v162H0z" fill="#35C3F5"/>
      <path d="M0 225c114-36 215-36 304 0 95 38 207 34 336-11v146H0z" fill="#FFF0AA"/>
      <path d="M0 251c101-35 185-39 252-13 66 26 124 25 174-4 60-35 132-37 214-7v133H0z" fill="#51D986"/>
      <path d="M0 296c86-67 180-97 282-91 108 7 211 48 309 124v31H0z" fill="url(#${id}-fairway)"/>
      <path d="M136 360c67-73 145-108 235-106 76 2 151 36 225 106z" fill="#A6F25F" opacity=".72"/>
      <path d="M-8 329c80-30 158-38 234-24 74 14 145 49 213 105H-8z" fill="#28BE76" opacity=".62"/>
      <path d="M318 352c51-65 107-96 169-93 47 2 93 27 137 75v26H318z" fill="#86E954"/>
      <g opacity=".9">
        <path d="M52 93c45-22 88-22 129 0" stroke="#FFFFFF" stroke-width="17" stroke-linecap="round"/>
        <path d="M438 91c35-16 66-16 94 2" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/>
        <path d="M463 86c22-11 42-11 62 1" stroke="#0F3D5E" stroke-width="5" stroke-linecap="round" opacity=".55"/>
      </g>
      <g transform="translate(492 207)">
        <rect x="5" y="12" width="80" height="50" rx="10" fill="#1277C8"/>
        <path d="M-4 12h98l-14-22H14z" fill="#FFFFFF"/>
        <rect x="22" y="26" width="14" height="18" rx="2" fill="#9DE8FF"/>
        <rect x="50" y="26" width="14" height="18" rx="2" fill="#9DE8FF"/>
      </g>
      <g transform="translate(396 223)">
        <ellipse cx="92" cy="41" rx="76" ry="28" fill="url(#${id}-green)"/>
        <ellipse cx="111" cy="47" rx="14" ry="5" fill="#123455" opacity=".5"/>
        <circle cx="110" cy="45" r="6" fill="#09233A"/>
        <path d="M91 36v-74" stroke="#123455" stroke-width="5" stroke-linecap="round"/>
        <path d="M94-36l58 18-58 19z" fill="#FF665E"/>
        <path d="M95-18l44 13" stroke="#FFC72D" stroke-width="4"/>
      </g>
      <g fill="none" stroke-linecap="round">
        <path d="M220 310c58-64 123-94 196-91" stroke="#FFFFFF" stroke-width="8" stroke-dasharray="12 12" opacity=".82"/>
        <path d="M220 310c58-64 123-94 196-91" stroke="#168CF2" stroke-width="3" stroke-dasharray="12 12" opacity=".72"/>
      </g>
      <g>
        <circle cx="220" cy="310" r="10" fill="#FFFFFF"/>
        <circle cx="220" cy="310" r="17" fill="#168CF2" opacity=".28"/>
      </g>
      <g transform="translate(65 203)">
        <rect x="0" y="74" width="126" height="14" rx="7" fill="#FFFFFF" opacity=".65"/>
        <rect x="7" y="86" width="110" height="17" rx="8" fill="#FFFFFF" opacity=".45"/>
        <g transform="translate(0 0)">
          <rect x="18" y="40" width="8" height="54" rx="4" fill="#8B5E34"/>
          <circle cx="22" cy="38" r="19" fill="#23C56D"/>
          <path d="M22 38l-31-4M22 38l29-9M22 38l-2-31M22 38l-21 20M22 38l27 18" stroke="#0E9F60" stroke-width="9" stroke-linecap="round"/>
        </g>
      </g>
      <g transform="translate(520 182)">
        <rect x="18" y="40" width="8" height="62" rx="4" fill="#8B5E34"/>
        <circle cx="22" cy="38" r="20" fill="#23C56D"/>
        <path d="M22 38l-34-6M22 38l31-11M22 38l0-34M22 38L2 62M22 38l30 21" stroke="#0E9F60" stroke-width="10" stroke-linecap="round"/>
      </g>
      <g transform="translate(64 232)" filter="url(#${id}-fast-shadow)">
        <ellipse cx="137" cy="104" rx="136" ry="24" fill="#082F49" opacity=".22"/>
        <g transform="rotate(-13 142 74)">
          <path d="M41 68c13-32 47-51 103-57 54-6 102 8 145 42 12 10 19 24 19 39v22H8V92c0-10 12-18 33-24z" fill="url(#${id}-cart)"/>
          <path d="M54 54c43-21 95-27 158-18 34 5 61 16 82 33H35c3-6 9-11 19-15z" fill="#FFE875"/>
          <path d="M107 37c25-13 57-15 96-7 14 3 24 13 29 28H93c2-8 7-15 14-21z" fill="#168CF2"/>
          <path d="M125 37c24-8 50-8 78 0" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" opacity=".72"/>
          <path d="M16 105h310" stroke="#09233A" stroke-width="16" stroke-linecap="round"/>
          <path d="M58 79c38-13 94-18 168-15" stroke="#FFFBEB" stroke-width="7" stroke-linecap="round" opacity=".9"/>
          <rect x="136" y="88" width="55" height="12" rx="6" fill="#FFFFFF" opacity=".9"/>
          <circle cx="66" cy="116" r="32" fill="#10233A"/>
          <circle cx="253" cy="116" r="32" fill="#10233A"/>
          <circle cx="66" cy="116" r="16" fill="#576F8F"/>
          <circle cx="253" cy="116" r="16" fill="#576F8F"/>
          <circle cx="66" cy="116" r="8" fill="#FFBF2F"/>
          <circle cx="253" cy="116" r="8" fill="#FFBF2F"/>
          <path d="M287 89c22 4 39 12 51 24" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" opacity=".88"/>
          <path d="M28 83c-22 7-38 18-49 32" stroke="#38BDF8" stroke-width="8" stroke-linecap="round" opacity=".85"/>
        </g>
        <g transform="translate(128 0)">
          <circle cx="55" cy="48" r="34" fill="#FAD6A0"/>
          <path d="M25 40c9-27 34-43 65-41 29 3 48 19 57 48-31-17-73-18-122-7z" fill="url(#${id}-hair)"/>
          <path d="M42 11c13-21 33-30 59-29-10 10-17 20-22 31" fill="#11B8E5"/>
          <path d="M79 9c16-16 36-22 60-16-12 9-21 20-28 33" fill="#0B93C4"/>
          <path d="M112 29c18-5 34-3 49 6-13 3-26 9-38 19" fill="#075985"/>
          <circle cx="43" cy="53" r="5" fill="#082F49"/>
          <circle cx="72" cy="53" r="5" fill="#082F49"/>
          <circle cx="41" cy="51" r="2" fill="#FFFFFF"/>
          <circle cx="70" cy="51" r="2" fill="#FFFFFF"/>
          <path d="M46 68c13 10 27 9 42-3" stroke="#082F49" stroke-width="5" stroke-linecap="round" fill="none"/>
          <path d="M26 92c19-21 43-31 72-28 31 4 53 24 66 61l-34 42-102-6z" fill="#0EA5E9"/>
          <path d="M42 90c28 14 60 13 96-2" stroke="#FFFFFF" stroke-width="19" stroke-linecap="round"/>
          <path d="M36 116l-41 48" stroke="#FAD6A0" stroke-width="14" stroke-linecap="round"/>
          <path d="M124 100l60 44" stroke="#FAD6A0" stroke-width="14" stroke-linecap="round"/>
          <path d="M173 135l66 73" stroke="#082F49" stroke-width="8" stroke-linecap="round"/>
          <path d="M206 178l52 11" stroke="#082F49" stroke-width="10" stroke-linecap="round"/>
        </g>
      </g>
      <g opacity=".9">
        <rect x="90" y="53" width="7" height="14" rx="3" fill="#FF665E" transform="rotate(18 93 60)"/>
        <rect x="154" y="33" width="6" height="14" rx="3" fill="#FFC72D" transform="rotate(-18 157 40)"/>
        <rect x="440" y="45" width="7" height="15" rx="3" fill="#22C55E" transform="rotate(26 443 52)"/>
        <rect x="585" y="92" width="6" height="14" rx="3" fill="#A78BFA" transform="rotate(-20 588 99)"/>
        <rect x="497" y="130" width="6" height="14" rx="3" fill="#FF665E" transform="rotate(38 500 137)"/>
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
  else if (kind === "sketch-relay") art.innerHTML = sketchRelayArtwork(hero);
  else if (kind === "pocket-golf") art.innerHTML = pocketGolfArtwork(hero);
  else art.innerHTML = controllerArtwork();
  return art;
}
