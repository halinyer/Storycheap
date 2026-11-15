export interface CardImagePreset {
  label: string;
  imageUrl: string;
}

export const CARD_IMAGE_PRESETS: CardImagePreset[] = [
  { label: "PlayStation (PNG limpio)", imageUrl: "/cards/playstation.png" },
  { label: "PlayStation PS5 (Diseño plano)", imageUrl: "/cards/playstation-ps5.jpg" },
  { label: "PlayStation (JPG clásico)", imageUrl: "/cards/playstation.jpg" },
  { label: "Nintendo eShop", imageUrl: "/cards/nintendo.png" },
  { label: "Xbox", imageUrl: "/cards/xbox.png" },
  { label: "Xbox Game Pass", imageUrl: "/cards/xbox-gamepass.png" },
  { label: "Steam Wallet", imageUrl: "/cards/steam.png" },
  { label: "Roblox", imageUrl: "/cards/roblox.png" },
  { label: "Free Fire", imageUrl: "/cards/freefire.png" },
  { label: "Valorant VP", imageUrl: "/cards/valorant.png" },
  { label: "League of Legends / Wild Rift", imageUrl: "/cards/leagueoflegends.png" },
  { label: "Riot Access Code", imageUrl: "/cards/riot.png" },
  { label: "Fortnite", imageUrl: "/cards/fortnite.png" },
  { label: "Minecraft", imageUrl: "/cards/minecraft.png" },
  { label: "Battle.net", imageUrl: "/cards/battlenet.png" },
  { label: "World of Warcraft", imageUrl: "/cards/wow.png" },
  { label: "EA Gift Cards / FC", imageUrl: "/cards/ea.png" },
  { label: "PUBG / PUBG Mobile", imageUrl: "/cards/pubg.png" },
  { label: "Mobile Legends", imageUrl: "/cards/mobilelegends.png" },
  { label: "Honor of Kings", imageUrl: "/cards/honorofkings.png" },
  { label: "NetEase Pay", imageUrl: "/cards/netease.png" },
  { label: "Discord", imageUrl: "/cards/discord.png" },
  { label: "Twitch", imageUrl: "/cards/twitch.png" },
  { label: "Meta Quest", imageUrl: "/cards/metaquest.png" },
  { label: "ExitLag", imageUrl: "/cards/exitlag.png" },
  { label: "GameStop", imageUrl: "/cards/gamestop.png" },
  { label: "Eneba", imageUrl: "/cards/eneba.png" },
  { label: "Kinguin", imageUrl: "/cards/kinguin.png" },
  { label: "Razer Gold", imageUrl: "/cards/razer.png" },
  { label: "Google Play", imageUrl: "/cards/googleplay.png" },
  { label: "Apple / App Store & iTunes", imageUrl: "/cards/apple.png" },
  { label: "Amazon", imageUrl: "/cards/amazon.png" },
  { label: "Walmart", imageUrl: "/cards/walmart.png" },
  { label: "Sephora", imageUrl: "/cards/sephora.png" },
  { label: "Airbnb", imageUrl: "/cards/airbnb.png" },
  { label: "Netflix", imageUrl: "/cards/netflix.png" },
  { label: "Disney+", imageUrl: "/cards/disney.png" },
  { label: "Spotify", imageUrl: "/cards/spotify.png" },
  { label: "TikTok", imageUrl: "/cards/tiktok.png" },
  { label: "Bilibili", imageUrl: "/cards/bilibili.png" },
  { label: "Bigo Live", imageUrl: "/cards/bigo.png" },
  { label: "Tinder", imageUrl: "/cards/tinder.png" },
  { label: "Telegram Stars / Premium", imageUrl: "/cards/telegram.png" },
  { label: "Adobe Digital Code", imageUrl: "/cards/adobe.png" },
  { label: "Surfshark", imageUrl: "/cards/surfshark.png" },
  { label: "MasterCard Prepaid", imageUrl: "/cards/mastercard.png" },
  { label: "AstroPay", imageUrl: "/cards/astropay.png" },
  { label: "Rewarble", imageUrl: "/cards/rewarble.png" },
  { label: "Binance", imageUrl: "/cards/binance.png" },
];

export function suggestProductImageUrl(
  productName: string,
  productSlug?: string | null
): string {
  return resolveBrandTheme(productName, productSlug).imageUrl;
}

export interface BrandRedemptionTheme {
  brandName: string;
  imageUrl: string;
  accentHex: string;
  bannerGradient: string;
  borderGlow: string;
  pillClass: string;
  redeemUrl: string | null;
  redeemHost: string | null;
  redeemLabel: string;
  secondaryRedeemUrl?: string | null;
  secondaryRedeemLabel?: string | null;
  importantNote: string;
  steps: string[];
}

const THEME_PALETTES = {
  crimson: {
    bannerGradient: "from-rose-600/30 via-red-950/25 to-[#0e1017]",
    borderGlow: "border-rose-500/35 shadow-[0_20px_60px_-15px_rgba(244,63,94,0.28)]",
    pillClass: "bg-rose-500/20 border-rose-400/35 text-rose-200",
  },
  emerald: {
    bannerGradient: "from-emerald-600/30 via-green-950/25 to-[#0e1017]",
    borderGlow: "border-emerald-500/35 shadow-[0_20px_60px_-15px_rgba(16,185,129,0.28)]",
    pillClass: "bg-emerald-500/20 border-emerald-400/35 text-emerald-200",
  },
  cobalt: {
    bannerGradient: "from-blue-600/30 via-slate-900/30 to-[#0e1017]",
    borderGlow: "border-blue-500/35 shadow-[0_20px_60px_-15px_rgba(59,130,246,0.28)]",
    pillClass: "bg-blue-500/20 border-blue-400/35 text-blue-200",
  },
  sky: {
    bannerGradient: "from-sky-500/30 via-cyan-950/25 to-[#0e1017]",
    borderGlow: "border-sky-500/35 shadow-[0_20px_60px_-15px_rgba(14,165,233,0.28)]",
    pillClass: "bg-sky-500/20 border-sky-400/35 text-sky-200",
  },
  violet: {
    bannerGradient: "from-purple-600/30 via-indigo-950/25 to-[#0e1017]",
    borderGlow: "border-purple-500/35 shadow-[0_20px_60px_-15px_rgba(168,85,247,0.28)]",
    pillClass: "bg-purple-500/20 border-purple-400/35 text-purple-200",
  },
  amber: {
    bannerGradient: "from-amber-500/30 via-orange-950/25 to-[#0e1017]",
    borderGlow: "border-amber-500/35 shadow-[0_20px_60px_-15px_rgba(245,158,11,0.28)]",
    pillClass: "bg-amber-500/20 border-amber-400/35 text-amber-200",
  },
  teal: {
    bannerGradient: "from-teal-500/30 via-emerald-950/25 to-[#0e1017]",
    borderGlow: "border-teal-500/35 shadow-[0_20px_60px_-15px_rgba(20,184,166,0.28)]",
    pillClass: "bg-teal-500/20 border-teal-400/35 text-teal-200",
  },
  slate: {
    bannerGradient: "from-zinc-600/30 via-slate-900/30 to-[#0e1017]",
    borderGlow: "border-zinc-500/35 shadow-[0_20px_60px_-15px_rgba(161,161,170,0.22)]",
    pillClass: "bg-zinc-500/20 border-zinc-400/35 text-zinc-200",
  },
} as const;

type PaletteKey = keyof typeof THEME_PALETTES;

interface SimpleBrandRule {
  match: ReadonlyArray<string | RegExp>;
  brandName: string;
  imageUrl: string;
  accentHex: string;
  palette: PaletteKey;
  redeemUrl: string | null;
  redeemHost: string | null;
  redeemLabel: string;
  importantNote: string;
  steps?: string[];
}

const SIMPLE_BRAND_RULES: SimpleBrandRule[] = [
  {
    match: ["xbox game pass", "game pass"],
    brandName: "Xbox Game Pass",
    imageUrl: "/cards/xbox-gamepass.png",
    accentHex: "#107c10",
    palette: "emerald",
    redeemUrl: "https://redeem.microsoft.com",
    redeemHost: "redeem.microsoft.com",
    redeemLabel: "Canjear en Microsoft Store",
    importantNote: "Verifica que la región de tu cuenta Microsoft coincida con la suscripción adquirida.",
    steps: [
      "Entra a redeem.microsoft.com e inicia sesión en tu cuenta Microsoft.",
      "Pega el código digital de 25 caracteres y haz clic en Siguiente.",
      "Confirma la activación para sumar los meses de Xbox Game Pass a tu perfil.",
    ],
  },
  {
    match: ["google play", "googleplay"],
    brandName: "Google Play",
    imageUrl: "/cards/googleplay.png",
    accentHex: "#00c853",
    palette: "emerald",
    redeemUrl: "https://play.google.com/redeem",
    redeemHost: "play.google.com/redeem",
    redeemLabel: "Canjear en Google Play",
    importantNote: "Tu cuenta Google y la configuración de país de Play Store deben coincidir con la región de la tarjeta.",
  },
  {
    match: ["valorant"],
    brandName: "Valorant VP",
    imageUrl: "/cards/valorant.png",
    accentHex: "#ff4655",
    palette: "crimson",
    redeemUrl: "https://shop.riotgames.com",
    redeemHost: "Cliente de Valorant",
    redeemLabel: "Abrir tienda de Riot",
    importantNote: "Válido según el servidor o región de tu cuenta Riot Games.",
    steps: [
      "Abre Valorant e inicia sesión en tu cuenta de Riot Games.",
      "Haz clic en el ícono de Valorant Points (VP) arriba a la derecha.",
      "Elige 'Prepaid Cards & Codes', pega tu PIN y presiona Enviar.",
    ],
  },
  {
    match: ["league of legends", "wild rift", /\blol\b/],
    brandName: "League of Legends / Wild Rift",
    imageUrl: "/cards/leagueoflegends.png",
    accentHex: "#0ac8b9",
    palette: "teal",
    redeemUrl: "https://www.leagueoflegends.com",
    redeemHost: "Cliente de Riot Games",
    redeemLabel: "Abrir League of Legends",
    importantNote: "Verifica que la región de tu cuenta Riot Games corresponda a la región del código.",
  },
  {
    match: ["riot access", "riot games", /\briot\b/],
    brandName: "Riot Access Code",
    imageUrl: "/cards/riot.png",
    accentHex: "#eb0029",
    palette: "crimson",
    redeemUrl: "https://shop.riotgames.com",
    redeemHost: "Riot Games Client",
    redeemLabel: "Canjear en Riot Games",
    importantNote: "Canjeable dentro del cliente de Valorant, League of Legends, TFT o Legends of Runeterra según región.",
  },
  {
    match: ["fortnite", "vbucks", "v bucks"],
    brandName: "Fortnite",
    imageUrl: "/cards/fortnite.png",
    accentHex: "#38bdf8",
    palette: "sky",
    redeemUrl: "https://www.fortnite.com/vbuckscard",
    redeemHost: "fortnite.com/vbuckscard",
    redeemLabel: "Canjear en Fortnite.com",
    importantNote: "Inicia sesión con tu cuenta Epic Games en fortnite.com/vbuckscard antes de canjear tu PIN.",
  },
  {
    match: ["minecraft", "minecoins"],
    brandName: "Minecraft",
    imageUrl: "/cards/minecraft.png",
    accentHex: "#22c55e",
    palette: "emerald",
    redeemUrl: "https://www.minecraft.net/redeem",
    redeemHost: "minecraft.net/redeem",
    redeemLabel: "Canjear en Minecraft.net",
    importantNote: "Requiere cuenta Microsoft configurada en una región compatible.",
  },
  {
    match: ["battle.net", "battle net", "blizzard"],
    brandName: "Battle.net",
    imageUrl: "/cards/battlenet.png",
    accentHex: "#00aeff",
    palette: "sky",
    redeemUrl: "https://account.battle.net/overview",
    redeemHost: "account.battle.net",
    redeemLabel: "Canjear en Battle.net",
    importantNote: "La divisa y país de tu cuenta Battle.net deben coincidir con la región de la tarjeta.",
  },
  {
    match: ["world of warcraft", /\bwow\b/],
    brandName: "World of Warcraft",
    imageUrl: "/cards/wow.png",
    accentHex: "#f59e0b",
    palette: "amber",
    redeemUrl: "https://account.battle.net/overview",
    redeemHost: "account.battle.net",
    redeemLabel: "Canjear en Battle.net",
    importantNote: "Se acredita tiempo de juego o saldo directamente en tu cuenta World of Warcraft.",
  },
  {
    match: ["ea gift", "ea sports", "electronic arts", /\bea\b/, "battlefield", "apex legends"],
    brandName: "EA Gift Card",
    imageUrl: "/cards/ea.png",
    accentHex: "#ff4747",
    palette: "crimson",
    redeemUrl: "https://www.ea.com/redeem",
    redeemHost: "ea.com/redeem",
    redeemLabel: "Canjear en EA.com",
    importantNote: "Válido para cuentas EA en la región indicada en tu producto.",
  },
  {
    match: ["pubg"],
    brandName: "PUBG / PUBG Mobile",
    imageUrl: "/cards/pubg.png",
    accentHex: "#f2a900",
    palette: "amber",
    redeemUrl: "https://www.midasbuy.com",
    redeemHost: "midasbuy.com",
    redeemLabel: "Canjear en Midasbuy",
    importantNote: "Necesitarás tu Player ID de PUBG o iniciar sesión en el portal oficial correspondiente.",
  },
  {
    match: ["mobile legends"],
    brandName: "Mobile Legends",
    imageUrl: "/cards/mobilelegends.png",
    accentHex: "#3b82f6",
    palette: "cobalt",
    redeemUrl: "https://m.mobilelegends.com",
    redeemHost: "mobilelegends.com",
    redeemLabel: "Portal Mobile Legends",
    importantNote: "Verifica tu ID de usuario y ID de zona antes de completar el canje.",
  },
  {
    match: ["honor of kings"],
    brandName: "Honor of Kings",
    imageUrl: "/cards/honorofkings.png",
    accentHex: "#d97706",
    palette: "amber",
    redeemUrl: "https://www.midasbuy.com",
    redeemHost: "midasbuy.com",
    redeemLabel: "Canjear en Midasbuy",
    importantNote: "Compatible con servidores globales según la edición indicada.",
  },
  {
    match: ["netease"],
    brandName: "NetEase Pay",
    imageUrl: "/cards/netease.png",
    accentHex: "#6366f1",
    palette: "violet",
    redeemUrl: "https://pay.neteasegames.com",
    redeemHost: "pay.neteasegames.com",
    redeemLabel: "Canjear en NetEase Pay",
    importantNote: "Ingresa tu código PIN en la sección NetEase Pay del juego compatible.",
  },
  {
    match: ["discord"],
    brandName: "Discord Nitro",
    imageUrl: "/cards/discord.png",
    accentHex: "#5865f2",
    palette: "violet",
    redeemUrl: "https://discord.com/billing/promotions",
    redeemHost: "discord.com",
    redeemLabel: "Canjear en Discord",
    importantNote: "Entra en Ajustes de Usuario -> Inventario de regalos dentro de Discord para activar tu código.",
  },
  {
    match: ["twitch"],
    brandName: "Twitch",
    imageUrl: "/cards/twitch.png",
    accentHex: "#9146ff",
    palette: "violet",
    redeemUrl: "https://www.twitch.tv/redeem",
    redeemHost: "twitch.tv/redeem",
    redeemLabel: "Canjear en Twitch.tv",
    importantNote: "Verifica que la divisa de tu país sea compatible con las suscripciones y Bits en Twitch.",
  },
  {
    match: ["meta quest", "oculus"],
    brandName: "Meta Quest",
    imageUrl: "/cards/metaquest.png",
    accentHex: "#0081fb",
    palette: "cobalt",
    redeemUrl: "https://secure.oculus.com/redeem-code",
    redeemHost: "meta.com",
    redeemLabel: "Canjear en Meta Quest",
    importantNote: "Válido en cuentas Meta Quest dentro de la región soportada.",
  },
  {
    match: ["exitlag"],
    brandName: "ExitLag",
    imageUrl: "/cards/exitlag.png",
    accentHex: "#ef4444",
    palette: "crimson",
    redeemUrl: "https://www.exitlag.com",
    redeemHost: "exitlag.com",
    redeemLabel: "Canjear en ExitLag.com",
    importantNote: "Activa el código en 'Prepaid Cards' dentro de tu panel de cuenta ExitLag.",
  },
  {
    match: ["gamestop"],
    brandName: "GameStop",
    imageUrl: "/cards/gamestop.png",
    accentHex: "#ef4444",
    palette: "slate",
    redeemUrl: "https://www.gamestop.com",
    redeemHost: "gamestop.com",
    redeemLabel: "Usar en GameStop.com",
    importantNote: "Válido para compras online o en tienda en la región especificada.",
  },
  {
    match: ["eneba"],
    brandName: "Eneba",
    imageUrl: "/cards/eneba.png",
    accentHex: "#9333ea",
    palette: "violet",
    redeemUrl: "https://www.eneba.com/redeem-gift-card",
    redeemHost: "eneba.com",
    redeemLabel: "Canjear en Eneba.com",
    importantNote: "La divisa de la tarjeta Eneba debe coincidir con la región de tu compra.",
  },
  {
    match: ["kinguin"],
    brandName: "Kinguin",
    imageUrl: "/cards/kinguin.png",
    accentHex: "#f59e0b",
    palette: "amber",
    redeemUrl: "https://www.kinguin.net",
    redeemHost: "kinguin.net",
    redeemLabel: "Canjear en Kinguin.net",
    importantNote: "Canjea la clave en la sección Wallet / Gift Cards de tu cuenta Kinguin.",
  },
  {
    match: ["amazon"],
    brandName: "Amazon Gift Card",
    imageUrl: "/cards/amazon.png",
    accentHex: "#ff9900",
    palette: "amber",
    redeemUrl: "https://www.amazon.com/gc/redeem",
    redeemHost: "amazon.com/gc/redeem",
    redeemLabel: "Canjear en Amazon",
    importantNote: "Asegúrate de canjear la tarjeta en la tienda regional correcta (ej. Amazon.com para USA).",
  },
  {
    match: ["walmart"],
    brandName: "Walmart",
    imageUrl: "/cards/walmart.png",
    accentHex: "#0071ce",
    palette: "cobalt",
    redeemUrl: "https://www.walmart.com",
    redeemHost: "walmart.com",
    redeemLabel: "Usar en Walmart.com",
    importantNote: "Válido en Walmart.com y tiendas físicas compatibles según región.",
  },
  {
    match: ["sephora"],
    brandName: "Sephora",
    imageUrl: "/cards/sephora.png",
    accentHex: "#e11d48",
    palette: "slate",
    redeemUrl: "https://www.sephora.com",
    redeemHost: "sephora.com",
    redeemLabel: "Usar en Sephora",
    importantNote: "Aplica el número de tarjeta y PIN en el checkout de Sephora.",
  },
  {
    match: ["airbnb"],
    brandName: "Airbnb",
    imageUrl: "/cards/airbnb.png",
    accentHex: "#ff385c",
    palette: "crimson",
    redeemUrl: "https://www.airbnb.com/gift",
    redeemHost: "airbnb.com/gift",
    redeemLabel: "Canjear en Airbnb",
    importantNote: "Requiere cuenta Airbnb del país y moneda indicados en la tarjeta.",
  },
  {
    match: ["tiktok", "douyin"],
    brandName: "TikTok",
    imageUrl: "/cards/tiktok.png",
    accentHex: "#fe2c55",
    palette: "slate",
    redeemUrl: "https://www.tiktok.com/coin",
    redeemHost: "tiktok.com/coin",
    redeemLabel: "Canjear en TikTok",
    importantNote: "Canjea tus monedas o tarjeta según la región de tu cuenta TikTok.",
  },
  {
    match: ["bilibili"],
    brandName: "Bilibili",
    imageUrl: "/cards/bilibili.png",
    accentHex: "#00a1d6",
    palette: "sky",
    redeemUrl: "https://www.bilibili.tv",
    redeemHost: "bilibili.tv",
    redeemLabel: "Canjear en Bilibili",
    importantNote: "Verifica la región compatible con la recarga de Bilibili antes de canjear.",
  },
  {
    match: ["bigo live", /\bbigo\b/],
    brandName: "Bigo Live",
    imageUrl: "/cards/bigo.png",
    accentHex: "#06b6d4",
    palette: "sky",
    redeemUrl: "https://m.bigo.tv",
    redeemHost: "bigo.tv",
    redeemLabel: "Canjear en Bigo Live",
    importantNote: "Ingresa tu Bigo ID y el código PIN para acreditar los diamantes.",
  },
  {
    match: ["tinder"],
    brandName: "Tinder",
    imageUrl: "/cards/tinder.png",
    accentHex: "#fe3c72",
    palette: "crimson",
    redeemUrl: "https://tinder.com",
    redeemHost: "tinder.com",
    redeemLabel: "Canjear en Tinder",
    importantNote: "Activa el enlace o código de suscripción desde tu navegador con sesión iniciada.",
  },
  {
    match: ["telegram"],
    brandName: "Telegram",
    imageUrl: "/cards/telegram.png",
    accentHex: "#2aabee",
    palette: "sky",
    redeemUrl: "https://fragment.com",
    redeemHost: "t.me / fragment.com",
    redeemLabel: "Canjear para Telegram",
    importantNote: "Asegúrate de ingresar correctamente tu @usuario o seguir las instrucciones del voucher.",
  },
  {
    match: ["adobe"],
    brandName: "Adobe Digital Code",
    imageUrl: "/cards/adobe.png",
    accentHex: "#ff0000",
    palette: "crimson",
    redeemUrl: "https://redeem.adobe.com",
    redeemHost: "redeem.adobe.com",
    redeemLabel: "Canjear en Adobe",
    importantNote: "Inicia sesión con tu Adobe ID en redeem.adobe.com y pega el código de licencia.",
  },
  {
    match: ["surfshark"],
    brandName: "Surfshark VPN",
    imageUrl: "/cards/surfshark.png",
    accentHex: "#1d9a8c",
    palette: "teal",
    redeemUrl: "https://my.surfshark.com",
    redeemHost: "my.surfshark.com",
    redeemLabel: "Canjear en Surfshark",
    importantNote: "Canjea el código en el portal de suscripción de Surfshark para activar tu plan.",
  },
  {
    match: ["mastercard"],
    brandName: "MasterCard Prepaid",
    imageUrl: "/cards/mastercard.png",
    accentHex: "#eb001b",
    palette: "amber",
    redeemUrl: null,
    redeemHost: "Portal emisor de tarjeta",
    redeemLabel: "Activar tarjeta prepaga",
    importantNote: "Sigue las instrucciones de activación incluidas con tu código de tarjeta prepaga.",
  },
  {
    match: ["astropay"],
    brandName: "AstroPay",
    imageUrl: "/cards/astropay.png",
    accentHex: "#f43f5e",
    palette: "crimson",
    redeemUrl: "https://www.astropay.com",
    redeemHost: "astropay.com",
    redeemLabel: "Canjear en AstroPay",
    importantNote: "Ingresa el código del voucher desde la app o cuenta web de AstroPay.",
  },
  {
    match: ["rewarble"],
    brandName: "Rewarble",
    imageUrl: "/cards/rewarble.png",
    accentHex: "#38bdf8",
    palette: "sky",
    redeemUrl: "https://rewarble.com/redeem",
    redeemHost: "rewarble.com/redeem",
    redeemLabel: "Canjear en Rewarble",
    importantNote: "Pega tu voucher en rewarble.com/redeem para transferirlo al método o billetera compatible.",
  },
];

function matchSimpleBrandRule(haystack: string): BrandRedemptionTheme | null {
  for (const rule of SIMPLE_BRAND_RULES) {
    const matched = rule.match.some((pattern) =>
      typeof pattern === "string" ? haystack.includes(pattern) : pattern.test(haystack)
    );
    if (!matched) continue;
    const palette = THEME_PALETTES[rule.palette];
    return {
      brandName: rule.brandName,
      imageUrl: rule.imageUrl,
      accentHex: rule.accentHex,
      bannerGradient: palette.bannerGradient,
      borderGlow: palette.borderGlow,
      pillClass: palette.pillClass,
      redeemUrl: rule.redeemUrl,
      redeemHost: rule.redeemHost,
      redeemLabel: rule.redeemLabel,
      importantNote: rule.importantNote,
      steps: rule.steps ?? [
        "Copia tu código digital arriba usando el botón 'Copiar código'.",
        `Abre ${rule.redeemHost ?? "la plataforma oficial"} e inicia sesión con tu cuenta.`,
        "Ingresa el código PIN recibido y confirma la operación para acreditar el saldo.",
      ],
    };
  }
  return null;
}

export function resolveBrandTheme(
  productName: string,
  productSlug?: string | null
): BrandRedemptionTheme {
  const haystack = `${productName} ${productSlug ?? ""}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  const simpleMatch = matchSimpleBrandRule(haystack);
  if (simpleMatch) {
    return simpleMatch;
  }

  if (haystack.includes("nintendo") || haystack.includes("eshop")) {
    return {
      brandName: "Nintendo eShop",
      imageUrl: "/cards/nintendo.png",
      accentHex: "#e60012",
      bannerGradient: "from-[#e60012]/30 via-[#99000c]/20 to-[#0e1017]",
      borderGlow: "border-rose-500/35 shadow-[0_20px_60px_-15px_rgba(230,0,18,0.28)]",
      pillClass: "bg-rose-500/20 border-rose-400/35 text-rose-200",
      redeemUrl: "https://ec.nintendo.com/redeem",
      redeemHost: "ec.nintendo.com/redeem",
      redeemLabel: "Canjear en Nintendo eShop",
      importantNote:
        "Tu cuenta Nintendo debe estar configurada en Estados Unidos (USA). Puedes canjearlo desde navegador web o directamente en tu consola Nintendo Switch.",
      steps: [
        "Entra a ec.nintendo.com/redeem desde tu navegador o abre Nintendo eShop en tu consola Switch.",
        "Inicia sesión con tu cuenta Nintendo (región Estados Unidos).",
        "Selecciona 'Canjear código', pega los 16 caracteres del PIN y confirma para acreditar tus fondos.",
      ],
    };
  }

  if (haystack.includes("playstation") || haystack.includes("psn")) {
    return {
      brandName: "PlayStation Store",
      imageUrl: "/cards/playstation.png",
      accentHex: "#0070d1",
      bannerGradient: "from-[#0070d1]/35 via-[#003791]/20 to-[#0e1017]",
      borderGlow: "border-blue-500/35 shadow-[0_20px_60px_-15px_rgba(0,112,209,0.28)]",
      pillClass: "bg-blue-500/20 border-blue-400/35 text-blue-200",
      redeemUrl: "https://store.playstation.com",
      redeemHost: "store.playstation.com",
      redeemLabel: "Canjear en PlayStation Store",
      importantNote:
        "Válido únicamente para cuentas PlayStation Network (PSN) registradas con país Estados Unidos (USA).",
      steps: [
        "Entra a store.playstation.com o abre PlayStation Store desde tu consola PS4 o PS5.",
        "Haz clic en tu avatar arriba a la derecha y elige la opción 'Canjear código' (Redeem Code).",
        "Pega el código de 12 dígitos sin guiones y confirma para sumar el saldo a tu monedero PSN.",
      ],
    };
  }

  if (haystack.includes("free fire") || haystack.includes("freefire") || haystack.includes("garena")) {
    return {
      brandName: "Garena Free Fire",
      imageUrl: "/cards/freefire.png",
      accentHex: "#f59e0b",
      bannerGradient: "from-amber-500/30 via-orange-600/15 to-[#0e1017]",
      borderGlow: "border-amber-500/35 shadow-[0_20px_60px_-15px_rgba(245,158,11,0.25)]",
      pillClass: "bg-amber-500/20 border-amber-400/35 text-amber-200",
      redeemUrl: "https://redeem.hype.games",
      redeemHost: "redeem.hype.games / pagostore.garena.com",
      redeemLabel: "Canjear PIN en Hype Redeem",
      secondaryRedeemUrl: "https://pagostore.garena.com",
      secondaryRedeemLabel: "Ir a PagoStore Garena",
      importantNote:
        "Si tu código tiene 36 caracteres con guiones (ej. CE4B2616-4D48-...), se canjea en redeem.hype.games ingresando tu código + tu ID de jugador de Free Fire. Si es un PIN numérico de Garena, se canjea en pagostore.garena.com. (No uses reward.ff.garena.com, esa página es solo para códigos de eventos de 12 letras).",
      steps: [
        "Copia tu código PIN arriba y haz clic en 'Canjear PIN en Hype Redeem' (redeem.hype.games) o entra a pagostore.garena.com.",
        "Pega el código PIN completo (incluyendo los guiones) y escribe tu ID numérico de jugador de Free Fire (lo encuentras en tu perfil dentro del juego).",
        "Verifica que aparezca tu apodo de jugador correcto y confirma el canje: los diamantes + el 10% de bono llegan al instante a tu cuenta.",
      ],
    };
  }

  if (haystack.includes("xbox") || haystack.includes("microsoft") || haystack.includes("game pass")) {
    return {
      brandName: "Xbox / Microsoft Store",
      imageUrl: "/cards/xbox.png",
      accentHex: "#107c10",
      bannerGradient: "from-emerald-600/30 via-green-900/20 to-[#0e1017]",
      borderGlow: "border-emerald-500/35 shadow-[0_20px_60px_-15px_rgba(16,124,16,0.28)]",
      pillClass: "bg-emerald-500/20 border-emerald-400/35 text-emerald-200",
      redeemUrl: "https://redeem.microsoft.com",
      redeemHost: "redeem.microsoft.com",
      redeemLabel: "Canjear en Microsoft Store",
      importantNote:
        "Tu cuenta Microsoft / Xbox debe tener región Estados Unidos (USA) al momento de canjear el código de 25 caracteres.",
      steps: [
        "Haz clic en 'Canjear en Microsoft Store' (redeem.microsoft.com) o abre la tienda en tu consola Xbox.",
        "Inicia sesión con tu cuenta Microsoft donde quieres recibir el saldo.",
        "Pega el código de 25 caracteres, haz clic en Siguiente y confirma la recarga.",
      ],
    };
  }

  if (haystack.includes("steam")) {
    return {
      brandName: "Steam Wallet",
      imageUrl: "/cards/steam.png",
      accentHex: "#38bdf8",
      bannerGradient: "from-sky-600/30 via-slate-800/30 to-[#0e1017]",
      borderGlow: "border-sky-500/35 shadow-[0_20px_60px_-15px_rgba(56,189,248,0.25)]",
      pillClass: "bg-sky-500/20 border-sky-400/35 text-sky-200",
      redeemUrl: "https://store.steampowered.com/account/redeemwalletcode",
      redeemHost: "store.steampowered.com/account/redeemwalletcode",
      redeemLabel: "Canjear en Steam Wallet",
      importantNote:
        "Válido para cuentas de Steam cuya cartera esté configurada en dólares estadounidenses (USD).",
      steps: [
        "Entra directo a store.steampowered.com/account/redeemwalletcode o abre la app de Steam en tu PC.",
        "Ve a 'Juegos' -> 'Canjear un código de la Cartera de Steam'.",
        "Pega tu código en el recuadro y presiona Continuar para sumar el saldo a tu cartera.",
      ],
    };
  }

  if (haystack.includes("roblox") || haystack.includes("robux")) {
    return {
      brandName: "Roblox",
      imageUrl: "/cards/roblox.png",
      accentHex: "#a855f7",
      bannerGradient: "from-purple-600/25 via-zinc-800/30 to-[#0e1017]",
      borderGlow: "border-purple-500/35 shadow-[0_20px_60px_-15px_rgba(168,85,247,0.25)]",
      pillClass: "bg-purple-500/20 border-purple-400/35 text-purple-200",
      redeemUrl: "https://www.roblox.com/redeem",
      redeemHost: "roblox.com/redeem",
      redeemLabel: "Canjear en Roblox.com",
      importantNote:
        "Los códigos de Roblox no se canjean dentro de la app móvil; debes entrar siempre desde el navegador web a roblox.com/redeem.",
      steps: [
        "Abre roblox.com/redeem desde el navegador de tu celular o PC.",
        "Inicia sesión en la cuenta de Roblox donde quieres acreditar tus Robux.",
        "Pega el código PIN en la casilla, pulsa 'Canjear' y luego convierte tu crédito a Robux.",
      ],
    };
  }

  if (haystack.includes("netflix")) {
    return {
      brandName: "Netflix",
      imageUrl: "/cards/netflix.png",
      accentHex: "#e50914",
      bannerGradient: "from-[#e50914]/35 via-red-950/25 to-[#0e1017]",
      borderGlow: "border-red-500/35 shadow-[0_20px_60px_-15px_rgba(229,9,20,0.28)]",
      pillClass: "bg-red-500/20 border-red-400/35 text-red-200",
      redeemUrl: "https://www.netflix.com/redeem",
      redeemHost: "netflix.com/redeem",
      redeemLabel: "Canjear en Netflix.com",
      importantNote:
        "Compatible con cuentas de Netflix según la moneda indicada en la tarjeta (USD o COP).",
      steps: [
        "Entra a netflix.com/redeem desde cualquier navegador web.",
        "Pega el código PIN digital de arriba y haz clic en 'Canjear'.",
        "Inicia sesión en tu cuenta de Netflix para aplicar el saldo directamente a tu membresía.",
      ],
    };
  }

  if (haystack.includes("disney")) {
    return {
      brandName: "Disney / Disney+",
      imageUrl: "/cards/disney.png",
      accentHex: "#0063e5",
      bannerGradient: "from-[#0063e5]/35 via-blue-950/25 to-[#0e1017]",
      borderGlow: "border-sky-500/35 shadow-[0_20px_60px_-15px_rgba(0,99,229,0.3)]",
      pillClass: "bg-sky-500/20 border-sky-400/35 text-sky-200",
      redeemUrl: "https://www.disneyplus.com/redeem",
      redeemHost: "disneyplus.com/redeem / disneygiftcard.com",
      redeemLabel: "Canjear en Disney+",
      secondaryRedeemUrl: "https://www.disneygiftcard.com",
      secondaryRedeemLabel: "Consultar saldo en DisneyGiftCard.com",
      importantNote:
        "Válida en Estados Unidos (USD) para pagar suscripciones de Disney+, compras en DisneyStore.com y parques o experiencias oficiales de Disney.",
      steps: [
        "Copia el código PIN digital de tu tarjeta Disney desde arriba.",
        "Para pagar Disney+, entra a disneyplus.com/redeem o úsala como método de pago (Disney Gift Card) en tu cuenta Disney+ USA.",
        "Para compras en tienda o administrar tu saldo, ingresa el código en disneygiftcard.com o disneystore.com.",
      ],
    };
  }

  if (haystack.includes("spotify")) {
    return {
      brandName: "Spotify Premium",
      imageUrl: "/cards/spotify.png",
      accentHex: "#1db954",
      bannerGradient: "from-[#1db954]/30 via-emerald-950/25 to-[#0e1017]",
      borderGlow: "border-emerald-500/35 shadow-[0_20px_60px_-15px_rgba(29,185,84,0.28)]",
      pillClass: "bg-emerald-500/20 border-emerald-400/35 text-emerald-200",
      redeemUrl: "https://www.spotify.com/redeem",
      redeemHost: "spotify.com/redeem",
      redeemLabel: "Canjear en Spotify.com",
      importantNote:
        "Tu cuenta de Spotify debe estar configurada en región USA. Aplica para planes Spotify Premium Individual.",
      steps: [
        "Entra a spotify.com/redeem e inicia sesión en tu cuenta.",
        "Pega el código PIN recibido y completa la verificación.",
        "Haz clic en 'Canjear' para activar tus meses de Spotify Premium.",
      ],
    };
  }

  if (haystack.includes("apple") || haystack.includes("itunes") || haystack.includes("app store")) {
    return {
      brandName: "Apple Gift Card",
      imageUrl: "/cards/apple.png",
      accentHex: "#60a5fa",
      bannerGradient: "from-indigo-500/25 via-slate-800/30 to-[#0e1017]",
      borderGlow: "border-indigo-400/35 shadow-[0_20px_60px_-15px_rgba(99,102,241,0.25)]",
      pillClass: "bg-indigo-500/20 border-indigo-400/35 text-indigo-200",
      redeemUrl: "https://apps.apple.com/redeem",
      redeemHost: "apps.apple.com/redeem",
      redeemLabel: "Canjear en App Store",
      importantNote:
        "Requiere un Apple ID cuya región de App Store sea Estados Unidos (USA).",
      steps: [
        "Abre la App Store en tu iPhone, iPad o Mac (o haz clic en 'Canjear en App Store').",
        "Toca tu foto de perfil arriba a la derecha y elige 'Canjear tarjeta regalo o código'.",
        "Pulsa 'Introducir el código manualmente' y pega el código de 16 caracteres.",
      ],
    };
  }

  if (haystack.includes("razer")) {
    return {
      brandName: "Razer Gold",
      imageUrl: "/cards/razer.png",
      accentHex: "#44d62c",
      bannerGradient: "from-lime-500/30 via-emerald-950/25 to-[#0e1017]",
      borderGlow: "border-lime-500/35 shadow-[0_20px_60px_-15px_rgba(68,214,44,0.28)]",
      pillClass: "bg-lime-500/20 border-lime-400/35 text-lime-200",
      redeemUrl: "https://gold.razer.com",
      redeemHost: "gold.razer.com",
      redeemLabel: "Canjear en Razer Gold",
      importantNote:
        "Válido para billeteras Razer Gold configuradas en USD Global.",
      steps: [
        "Inicia sesión en gold.razer.com con tu cuenta Razer ID.",
        "Haz clic en 'Reload Now' (Recargar) y selecciona 'Razer Gold PIN'.",
        "Pega tu código PIN y confirma la recarga en tu billetera.",
      ],
    };
  }

  if (haystack.includes("binance") || haystack.includes("usdt")) {
    return {
      brandName: "Binance Gift Card",
      imageUrl: "/cards/binance.png",
      accentHex: "#f0b90b",
      bannerGradient: "from-yellow-500/30 via-amber-950/25 to-[#0e1017]",
      borderGlow: "border-yellow-500/35 shadow-[0_20px_60px_-15px_rgba(240,185,11,0.28)]",
      pillClass: "bg-yellow-500/20 border-yellow-400/35 text-yellow-200",
      redeemUrl: "https://www.binance.com/es/gift-card",
      redeemHost: "binance.com/es/gift-card",
      redeemLabel: "Canjear en Binance",
      importantNote:
        "Se acredita de inmediato sin comisiones en la Billetera de Fondos de tu cuenta Binance.",
      steps: [
        "Abre la app de Binance (Perfil -> Tarjeta de Regalo) o entra a binance.com/es/gift-card.",
        "Toca en 'Canjear' y elige 'Canjear a cripto'.",
        "Pega el código de 16 caracteres para recibir los USDT al instante.",
      ],
    };
  }

  return {
    brandName: "StoryCheap Digital PIN",
    imageUrl: "/cards/nintendo.png",
    accentHex: "#6366f1",
    bannerGradient: "from-indigo-600/30 via-purple-900/20 to-[#0e1017]",
    borderGlow: "border-indigo-500/35 shadow-[0_20px_60px_-15px_rgba(99,102,241,0.25)]",
    pillClass: "bg-indigo-500/20 border-indigo-400/35 text-indigo-200",
    redeemUrl: null,
    redeemHost: null,
    redeemLabel: "Canjear en plataforma oficial",
    importantNote: "Verifica que la región de tu cuenta coincida con la región indicada en tu orden.",
    steps: [
      "Copia tu código digital usando el botón 'Copiar código'.",
      "Inicia sesión en la plataforma oficial correspondiente a tu tarjeta.",
      "Dirígete a la sección 'Canjear código / PIN' y pega los caracteres.",
    ],
  };
}
